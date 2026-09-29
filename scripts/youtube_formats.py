"""Classify uploads from YouTube's public Videos/Shorts/Live tabs, not duration.

Only positively observed tab membership is evidence. Missing tabs, failed pages,
unseen IDs and conflicting membership remain unknown; no negative inference.
"""
import json
import re
import subprocess
import shutil
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

TABS = {"shorts": "short", "videos": "long", "streams": "live"}
MAX_PAGES = 8


def fetch_json_or_html(url, body=None):
    executable = shutil.which("curl.exe") or shutil.which("curl")
    if not executable:
        raise RuntimeError("curl_unavailable")
    command = [executable, "--fail", "--silent", "--show-error", "--location", "--max-time", "25"]
    proxy = urllib.request.getproxies().get("https")
    if proxy:
        command += ["--proxy", proxy]
    if body is not None:
        command += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
    command.append(url)
    result = subprocess.run(command, input=json.dumps(body).encode() if body is not None else None, capture_output=True, timeout=30)
    if result.returncode:
        # Do not expose proxy credentials or raw transport diagnostics.
        raise RuntimeError(f"youtube_tab_transport_{result.returncode}")
    if len(result.stdout) > 12_000_000:
        raise ValueError("youtube_tab_response_too_large")
    return result.stdout.decode("utf-8")


def initial_data(html):
    match = re.search(r"(?:var\s+)?ytInitialData\s*=\s*", html)
    if not match:
        raise ValueError("youtube_initial_data_missing")
    return json.JSONDecoder().raw_decode(html[match.end():])[0]


def walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def tab_items(content, tab):
    ids, continuations = set(), []
    for node in walk(content):
        if tab == "shorts":
            reel = node.get("reelItemRenderer")
            if reel and reel.get("videoId"):
                ids.add(reel["videoId"])
            lockup = node.get("shortsLockupViewModel")
            if lockup:
                for command in walk(lockup):
                    endpoint = command.get("reelWatchEndpoint", {})
                    if endpoint.get("videoId"):
                        ids.add(endpoint["videoId"])
                    url = command.get("url", "")
                    if isinstance(url, str) and re.fullmatch(r"/shorts/[A-Za-z0-9_-]{11}", url):
                        ids.add(url.rsplit("/", 1)[1])
        elif "videoRenderer" in node:
            video = node["videoRenderer"]
            if video.get("videoId"):
                ids.add(video["videoId"])
        elif tab != "shorts" and "lockupViewModel" in node:
            video = node["lockupViewModel"]
            if video.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO" and video.get("contentId"):
                ids.add(video["contentId"])
        continuation = node.get("continuationItemRenderer", {}).get("continuationEndpoint", {})
        if continuation.get("commandMetadata", {}).get("webCommandMetadata", {}).get("apiUrl") == "/youtubei/v1/browse":
            token = continuation.get("continuationCommand", {}).get("token")
            if token:
                continuations.append(token)
    return {value for value in ids if re.fullmatch(r"[A-Za-z0-9_-]{11}", value)}, continuations


def scan_tab(channel_id, tab, wanted):
    url = f"https://www.youtube.com/channel/{channel_id}/{tab}"
    html = fetch_json_or_html(url)
    data = initial_data(html)
    identity = data.get("metadata", {}).get("channelMetadataRenderer", {}).get("externalId")
    if identity != channel_id:
        raise ValueError("youtube_channel_identity_mismatch")
    tabs = data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", [])
    selected = next((item.get("tabRenderer") for item in tabs if item.get("tabRenderer", {}).get("selected")), None)
    selected_url = (selected or {}).get("endpoint", {}).get("commandMetadata", {}).get("webCommandMetadata", {}).get("url", "")
    if not selected or selected_url.rstrip("/").rsplit("/", 1)[-1] != tab:
        return {}, "tab_absent"
    ids, tokens = tab_items(selected.get("content", {}), tab)
    context_match = re.search(r'"INNERTUBE_CONTEXT"\s*:\s*', html)
    context = json.JSONDecoder().raw_decode(html[context_match.end():])[0] if context_match else None
    seen_tokens = set()
    pages = 1
    while tokens and pages < MAX_PAGES and not wanted.issubset(ids):
        token = tokens[0]
        if not context or token in seen_tokens:
            break
        seen_tokens.add(token)
        payload = json.loads(fetch_json_or_html("https://www.youtube.com/youtubei/v1/browse", {"context": context, "continuation": token}))
        # Restrict extraction to appended tab content, never recommendation shelves.
        actions = payload.get("onResponseReceivedActions", []) + payload.get("onResponseReceivedEndpoints", [])
        content = [action["appendContinuationItemsAction"]["continuationItems"] for action in actions if "appendContinuationItemsAction" in action]
        new_ids, tokens = tab_items(content, tab)
        ids.update(new_ids)
        pages += 1
    return {video_id: {"format": TABS[tab], "sourceUrl": url} for video_id in ids & wanted}, "partial" if tokens else "complete"


def resolve_observations(observations, previous, now_iso):
    result = {}
    for video_id, entries in observations.items():
        formats = {entry["format"] for entry in entries}
        # Shorts + Videos disagreement must not silently become long-form.
        kind = next(iter(formats)) if len(formats) == 1 else "unknown"
        result[video_id] = {"videoId": video_id, "format": kind, "checkedAt": now_iso,
                            "sourceUrls": sorted({entry["sourceUrl"] for entry in entries}),
                            "classificationMethod": "youtube_channel_tab_membership",
                            "status": "confirmed" if kind != "unknown" else "conflicting_tabs"}
    for video_id, row in previous.items():
        result.setdefault(video_id, row)
    return result


def refresh_formats(catalog, previous_rows, previous_state=None, now=None):
    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    wanted_ids = {row["videoId"] for row in catalog}
    previous = {row["videoId"]: row for row in previous_rows if row.get("videoId") in wanted_ids
                and row.get("classificationMethod") == "youtube_channel_tab_membership"}
    state = dict(previous_state or {})
    grouped = {}
    for row in catalog:
        grouped.setdefault(row["channelId"], set()).add(row["videoId"])
    jobs = []
    for channel_id, ids in grouped.items():
        last = state.get(channel_id, {})
        try:
            age = now - datetime.fromisoformat(last["checkedAt"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            age = timedelta(days=99)
        changed = sorted(ids) != last.get("videoIds")
        pending = any(previous.get(video_id, {}).get("format") not in ("long", "short", "live") for video_id in ids)
        # Known classifications: weekly validation. Pending: daily, not every 30 min.
        if changed or age >= (timedelta(days=1) if pending else timedelta(days=7)):
            jobs.extend((channel_id, tab, ids) for tab in TABS)
    observations, errors, outcomes = {}, [], {}
    def run(job):
        channel_id, tab, ids = job
        try:
            rows, status = scan_tab(channel_id, tab, ids)
            return channel_id, tab, rows, status
        except Exception as error:
            return channel_id, tab, {}, type(error).__name__
    with ThreadPoolExecutor(max_workers=3) as pool:
        for channel_id, tab, rows, status in pool.map(run, jobs):
            outcomes.setdefault(channel_id, {})[tab] = status
            if status not in ("complete", "partial", "tab_absent"):
                errors.append({"channelId": channel_id, "tab": tab, "error": status})
            for video_id, row in rows.items():
                observations.setdefault(video_id, []).append(row)
    resolved = resolve_observations(observations, previous, stamp)
    rows = []
    for video in catalog:
        row = resolved.get(video["videoId"], {"videoId": video["videoId"], "format": "unknown", "status": "not_confirmed", "sourceUrls": []})
        rows.append({**row, "channelId": video["channelId"]})
    for channel_id, tabs in outcomes.items():
        state[channel_id] = {"checkedAt": stamp, "videoIds": sorted(grouped[channel_id]), "tabs": tabs}
    return rows, state, errors


def format_query(rows):
    return {"rows": rows, "source": {
        "title": "YouTube public channel tab membership",
        "classificationMethod": "youtube_channel_tab_membership",
        "metricDefinitions": [{"label": "YouTube 视频类型", "definition": "Shorts 标签下的视频为短视频；Videos 标签为普通视频；Live 标签为直播/回放。仅正向确认成员关系，不按时长推断；未获取或冲突的分类为待确认。"}],
        "evidenceFlow": [{"title": "YouTube 频道分类", "detail": "读取各频道 /shorts、/videos、/streams 的已选标签内容及分页；每条分类保存 sourceUrls 与 checkedAt。分类失败保留历史已确认结果，新视频不推断。"}],
    }}


if __name__ == "__main__":
    import argparse
    from pathlib import Path
    from collections import Counter
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--merge-report", type=Path)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    if args.merge_report:
        report = json.loads(args.merge_report.read_text(encoding="utf-8"))
        active_ids = {row["videoId"] for row in snapshot["queries"]["video_catalog"]["rows"]}
        rows = [row for row in report["query"]["rows"] if row["videoId"] in active_ids]
        snapshot["queries"]["video_formats"] = format_query(rows)
        snapshot.setdefault("collectorState", {})["formatClassification"] = report["state"]
        snapshot["collectorState"]["formatClassificationErrors"] = report["errors"]
        args.snapshot.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"merged": len(rows), "snapshot": str(args.snapshot)}))
        raise SystemExit(0)
    if not args.output:
        parser.error("--output is required unless --merge-report is used")
    rows, state, errors = refresh_formats(snapshot["queries"]["video_catalog"]["rows"],
        snapshot["queries"].get("video_formats", {}).get("rows", []),
        snapshot.get("collectorState", {}).get("formatClassification", {}))
    report = {"query": format_query(rows), "state": state, "errors": errors}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"counts": dict(Counter(row["format"] for row in rows)), "errors": errors, "output": str(args.output)}))
