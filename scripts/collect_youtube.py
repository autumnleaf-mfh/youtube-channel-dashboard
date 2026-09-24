#!/usr/bin/env python3
"""Collect public YouTube channel/video metrics into the dashboard snapshot."""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


API_BASE = "https://www.googleapis.com/youtube/v3"
ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = Path(os.environ.get("DASHBOARD_DATA_PATH", ROOT / "src" / "data.json"))
RECENT_VIDEO_LIMIT = 30
HK_TZ = timezone(timedelta(hours=8))
RECENT_VIDEO_AGE = timedelta(days=7)
DAILY_VIDEO_AGE = timedelta(days=30)
FULL_INVENTORY_INTERVAL = timedelta(days=7)

CHANNELS = [
    ("Amber聊财", "UCMM38YQdOaUiXMFlWzbRlXw"),
    ("Amber放大镜", "UCZNlDT4tKgZS8R6sDuJWwMA"),
    ("小鹿财经 Deer Finance", "UCsWtmTG0UkpuGeeAno4jiGQ"),
    ("财经小鹿 Finance Deer", "UCTueeHImxv4uLBQKsDEMqjQ"),
    ("Leo财经", "UCNX9-jzOH4KMbIeuWK8LZaw"),
    ("羅拉财富观", "UCsXJXZI4J_N9r8H9TsORmlA"),
    ("艾莉说", "UC9veOeKEZhexYxmMXF_RwCQ"),
    ("文叔聊财", "UCmhqWEDoPgrg9J129nGuQkQ"),
    ("阿诚聊焦点", "UCS1ZlOZTJhOxvWXr3b1v9GA"),
    ("财经有一套", "UCQAo0ws95p-uN7gr0OOHoXg"),
    ("Maple的理财森林", "UC5lCKye2u8Q0BoE5ggY9myw"),
    ("Alec財有意思", "UCIj1v-XeGVGaR8rOkipW4gQ"),
    ("熱股追蹤", "UC8RxFK0DNEz8Ad2DPIt3Bog"),
]


def api_get(resource: str, **params):
    params["key"] = os.environ["YOUTUBE_API_KEY"]
    url = f"{API_BASE}/{resource}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "faatchoi-youtube-dashboard/1.0"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def chunks(values, size):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def number(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def average(values):
    clean = [value for value in values if isinstance(value, (int, float))]
    return round(sum(clean) / len(clean)) if clean else None


def ratio(numerator, denominator):
    if not denominator:
        return None
    return round(numerator / denominator, 6)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def utc_iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def three_hour_observation(now):
    local = now.astimezone(HK_TZ)
    bucket = local.replace(hour=(local.hour // 3) * 3, minute=0, second=0, microsecond=0)
    return utc_iso(bucket)


def week_key(value):
    local = value.astimezone(HK_TZ)
    year, week, _ = local.isocalendar()
    return year, week


def collection_tier(published_at, now):
    age = max(timedelta(0), now - published_at)
    if age <= RECENT_VIDEO_AGE:
        return "3h"
    if age <= DAILY_VIDEO_AGE:
        return "daily"
    return "weekly"


def video_due(published_at, last_observed_at, now):
    if last_observed_at is None:
        return True
    tier = collection_tier(published_at, now)
    local_now = now.astimezone(HK_TZ)
    local_last = last_observed_at.astimezone(HK_TZ)
    if tier == "3h":
        return (local_last.date(), local_last.hour // 3) != (local_now.date(), local_now.hour // 3)
    if tier == "daily":
        return local_last.date() != local_now.date()
    return week_key(local_last) != week_key(local_now)


def history_bucket(observed_at, now):
    observed = parse_time(observed_at)
    age = max(timedelta(0), now - observed)
    local = observed.astimezone(HK_TZ)
    if age <= RECENT_VIDEO_AGE:
        return "3h", local.date().isoformat(), local.hour // 3
    if age <= DAILY_VIDEO_AGE:
        return "daily", local.date().isoformat()
    year, week = week_key(observed)
    return "weekly", year, week


def compact_history(rows, identity_fields, now):
    compacted = {}
    for row in sorted(rows, key=lambda item: item.get("observedAt", "")):
        if not row.get("observedAt"):
            continue
        identity = tuple(row.get(field) for field in identity_fields)
        compacted[identity + history_bucket(row["observedAt"], now)] = row
    return sorted(compacted.values(), key=lambda row: (row.get("observedAt", ""), *(row.get(field, "") for field in identity_fields)))


def playlist_record(channel_id, channel_name, item):
    snippet = item.get("snippet", {})
    details = item.get("contentDetails", {})
    video_id = details.get("videoId") or snippet.get("resourceId", {}).get("videoId")
    published_at = details.get("videoPublishedAt") or snippet.get("publishedAt")
    if not video_id or not published_at:
        return None
    return {
        "channelId": channel_id,
        "channel": channel_name,
        "videoId": video_id,
        "title": snippet.get("title") or "未命名视频",
        "publishedAt": published_at,
        "publishedDate": published_at[:10],
        "thumbnail": (snippet.get("thumbnails", {}).get("medium") or snippet.get("thumbnails", {}).get("default") or {}).get("url"),
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


def metric_record(item, catalog_row, channel_name, observed_at):
    snippet = item.get("snippet", {})
    stats = item.get("statistics", {})
    duration_seconds = iso_duration_seconds(item.get("contentDetails", {}).get("duration"))
    published_at = snippet.get("publishedAt") or catalog_row.get("publishedAt")
    thumbnail = (snippet.get("thumbnails", {}).get("medium") or snippet.get("thumbnails", {}).get("default") or {}).get("url") or catalog_row.get("thumbnail")
    return {
        "observedAt": observed_at,
        "channelId": catalog_row["channelId"],
        "channel": channel_name,
        "videoId": item["id"],
        "title": snippet.get("title") or catalog_row.get("title") or "未命名视频",
        "publishedAt": published_at,
        "publishedDate": published_at[:10] if published_at else None,
        "viewCount": number(stats.get("viewCount")),
        "likeCount": number(stats.get("likeCount")),
        "commentCount": number(stats.get("commentCount")),
        "durationSeconds": duration_seconds,
        "formatHint": "短视频候选" if duration_seconds is not None and duration_seconds <= 180 else "长视频/直播候选",
        "thumbnail": thumbnail,
        "url": f"https://www.youtube.com/watch?v={item['id']}",
        "isLive": snippet.get("liveBroadcastContent") == "live",
        "concurrentViewers": number(item.get("liveStreamingDetails", {}).get("concurrentViewers")),
    }


def iso_duration_seconds(value):
    # YouTube durations are ISO 8601 values such as PT12M08S.
    if not value or not value.startswith("P"):
        return None
    total = 0
    current = ""
    in_time = False
    for char in value[1:]:
        if char == "T":
            in_time = True
            continue
        if char.isdigit() or char == ".":
            current += char
            continue
        if not current:
            continue
        amount = float(current)
        current = ""
        if char == "D":
            total += amount * 86400
        elif in_time and char == "H":
            total += amount * 3600
        elif in_time and char == "M":
            total += amount * 60
        elif in_time and char == "S":
            total += amount
    return round(total)


def source(label, endpoint, definitions):
    return {
        "label": label,
        "endpoint": endpoint,
        "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metricDefinitions": definitions,
    }


def main():
    if not os.getenv("YOUTUBE_API_KEY", "").strip():
        raise SystemExit("YOUTUBE_API_KEY is required")

    now = datetime.now(timezone.utc)
    observed_at = three_hour_observation(now)
    channel_ids = [channel_id for _, channel_id in CHANNELS]
    aliases = {channel_id: name for name, channel_id in CHANNELS}

    try:
        previous = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        previous = {}
    previous_queries = previous.get("queries", {})
    previous_catalog = previous_queries.get("video_catalog", {}).get("rows", [])
    previous_video_history = previous_queries.get("video_history", {}).get("rows", [])
    previous_channel_history = previous_queries.get("channel_history", {}).get("rows", [])
    inventory_scanned_at = previous.get("collectorState", {}).get("inventoryFullScanAt")
    full_inventory_scan = not previous_catalog or not inventory_scanned_at
    if inventory_scanned_at:
        try:
            full_inventory_scan = now - parse_time(inventory_scanned_at) >= FULL_INVENTORY_INTERVAL
        except ValueError:
            full_inventory_scan = True

    channel_payload = api_get(
        "channels",
        part="snippet,statistics,contentDetails,brandingSettings",
        id=",".join(channel_ids),
        maxResults=50,
    )
    channel_map = {item["id"]: item for item in channel_payload.get("items", [])}

    catalog_by_video = {
        row["videoId"]: row for row in previous_catalog
        if row.get("videoId") and row.get("channelId") in set(channel_ids)
    }
    failures = []
    for channel_id in channel_ids:
        item = channel_map.get(channel_id)
        if not item:
            failures.append({"channelId": channel_id, "error": "channel_not_returned"})
            continue
        playlist_id = item.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        if not playlist_id:
            failures.append({"channelId": channel_id, "error": "uploads_playlist_missing"})
            continue
        try:
            page_token = None
            while True:
                params = {
                    "part": "snippet,contentDetails",
                    "playlistId": playlist_id,
                    "maxResults": 50,
                }
                if page_token:
                    params["pageToken"] = page_token
                payload = api_get("playlistItems", **params)
                for item_row in payload.get("items", []):
                    row = playlist_record(channel_id, aliases[channel_id], item_row)
                    if row:
                        catalog_by_video[row["videoId"]] = row
                page_token = payload.get("nextPageToken")
                if not full_inventory_scan or not page_token:
                    break
        except Exception as exc:  # retain other channels when one playlist fails
            failures.append({"channelId": channel_id, "error": type(exc).__name__})

    catalog_rows = sorted(catalog_by_video.values(), key=lambda row: (row.get("publishedAt", ""), row["videoId"]), reverse=True)
    latest_observation_by_video = {}
    for row in sorted(previous_video_history, key=lambda item: item.get("observedAt", "")):
        if row.get("videoId") and row.get("channelId") in set(channel_ids):
            latest_observation_by_video[row["videoId"]] = row
    due_catalog_rows = []
    for row in catalog_rows:
        try:
            published_at = parse_time(row["publishedAt"])
        except (KeyError, TypeError, ValueError):
            continue
        last_row = latest_observation_by_video.get(row["videoId"])
        last_observed = parse_time(last_row["observedAt"]) if last_row and last_row.get("observedAt") else None
        if video_due(published_at, last_observed, now):
            due_catalog_rows.append(row)

    due_by_video = {row["videoId"]: row for row in due_catalog_rows}
    video_map = {}
    for batch in chunks(list(due_by_video), 50):
        payload = api_get(
            "videos",
            part="snippet,contentDetails,statistics,liveStreamingDetails,status",
            id=",".join(batch),
            maxResults=50,
        )
        video_map.update({item["id"]: item for item in payload.get("items", [])})

    new_video_observations = []
    for video_id, item in video_map.items():
        catalog_row = due_by_video[video_id]
        row = metric_record(item, catalog_row, aliases[catalog_row["channelId"]], observed_at)
        new_video_observations.append(row)
        latest_observation_by_video[video_id] = row
        catalog_by_video[video_id] = {key: row[key] for key in ("channelId", "channel", "videoId", "title", "publishedAt", "publishedDate", "thumbnail", "url")}

    tracked_channel_ids = set(channel_ids)
    video_history = [row for row in previous_video_history if row.get("channelId") in tracked_channel_ids]
    refreshed_video_ids = {row["videoId"] for row in new_video_observations}
    video_history = [
        row for row in video_history
        if not (row.get("observedAt") == observed_at and row.get("videoId") in refreshed_video_ids)
    ]
    video_history.extend(new_video_observations)
    video_history = sorted(video_history, key=lambda row: (row.get("observedAt", ""), row.get("videoId", "")))

    catalog_rows = sorted(catalog_by_video.values(), key=lambda row: (row.get("publishedAt", ""), row["videoId"]), reverse=True)
    recent_rows = []
    videos_by_channel = {channel_id: [] for channel_id in channel_ids}
    for channel_id in channel_ids:
        channel_catalog = [row for row in catalog_rows if row["channelId"] == channel_id][:RECENT_VIDEO_LIMIT]
        for catalog_row in channel_catalog:
            latest = latest_observation_by_video.get(catalog_row["videoId"])
            row = {**catalog_row, **(latest or {})}
            recent_rows.append(row)
            videos_by_channel[channel_id].append(row)

    current_rows = []
    for channel_id in channel_ids:
        item = channel_map.get(channel_id)
        if not item:
            continue
        snippet = item.get("snippet", {})
        stats = item.get("statistics", {})
        videos = sorted(videos_by_channel[channel_id], key=lambda row: row.get("publishedAt") or "", reverse=True)
        all_channel_videos = [row for row in catalog_rows if row["channelId"] == channel_id]
        published = [parse_time(row["publishedAt"]) for row in all_channel_videos if row.get("publishedAt")]
        gaps = [(published[index] - published[index + 1]).total_seconds() / 86400 for index in range(len(published) - 1)]
        recent5 = videos[:5]
        views5 = [row["viewCount"] for row in recent5 if row["viewCount"] is not None]
        likes5 = [row["likeCount"] for row in recent5 if row["likeCount"] is not None]
        comments5 = [row["commentCount"] for row in recent5 if row["commentCount"] is not None]
        total_recent_views = sum(views5)
        total_recent_engagement = sum(likes5) + sum(comments5)
        last_published = published[0] if published else None
        current_rows.append({
            "channelId": channel_id,
            "channel": aliases[channel_id],
            "youtubeTitle": snippet.get("title") or aliases[channel_id],
            "customUrl": snippet.get("customUrl"),
            "channelUrl": f"https://www.youtube.com/channel/{channel_id}",
            "thumbnail": (snippet.get("thumbnails", {}).get("high") or snippet.get("thumbnails", {}).get("default") or {}).get("url"),
            "subscriberCount": None if stats.get("hiddenSubscriberCount") else number(stats.get("subscriberCount")),
            "hiddenSubscriberCount": bool(stats.get("hiddenSubscriberCount")),
            "channelViewCount": number(stats.get("viewCount")),
            "videoCount": number(stats.get("videoCount")),
            "lastPublishedAt": last_published.isoformat().replace("+00:00", "Z") if last_published else None,
            "daysSinceUpload": round((now - last_published).total_seconds() / 86400, 1) if last_published else None,
            "uploads7d": sum(1 for value in published if (now - value).total_seconds() <= 7 * 86400),
            "uploads30d": sum(1 for value in published if (now - value).total_seconds() <= 30 * 86400),
            "uploads90d": sum(1 for value in published if (now - value).total_seconds() <= 90 * 86400),
            "averageUploadGapDays": round(statistics.mean(gaps[:19]), 1) if gaps else None,
            "recent5AverageViews": average(views5),
            "recent5MedianViews": round(statistics.median(views5)) if views5 else None,
            "recent5AverageLikes": average(likes5),
            "recent5EngagementRate": ratio(total_recent_engagement, total_recent_views),
        })

    # Idempotent within a Hong Kong three-hour bucket. Older points are compacted
    # to one daily observation after seven days and one weekly observation after 30 days.
    history = [
        row for row in previous_channel_history
        if row.get("observedAt") != observed_at and row.get("channelId") in tracked_channel_ids
    ]
    history.extend({
        "observedAt": observed_at,
        "date": observed_at[:10],
        "channelId": row["channelId"],
        "channel": row["channel"],
        "subscriberCount": row["subscriberCount"],
        "channelViewCount": row["channelViewCount"],
        "videoCount": row["videoCount"],
    } for row in current_rows)
    history = compact_history(history, ("channelId",), now)

    definitions = [
        {"label": "订阅数", "definition": "频道公开订阅数；YouTube 会把公开值按三位有效数字取整，隐藏订阅数时为空。", "componentIds": ["channel-table", "subscriber-trend"]},
        {"label": "频道总播放", "definition": "频道 statistics.viewCount；口径由 YouTube 定义，包含适用格式的公开观看。", "componentIds": ["channel-table", "view-trend"]},
        {"label": "更新频率", "definition": "最近 30 个上传条目计算的 7/30/90 日发布数与相邻发布时间平均间隔。", "componentIds": ["channel-table", "cadence-ranking"]},
        {"label": "近 5 条平均播放", "definition": "每个频道最新 5 个公开视频的公开 viewCount 算术平均。", "componentIds": ["channel-table", "recent-performance"]},
        {"label": "互动率", "definition": "最新 5 条视频的 (点赞数 + 评论数) / 播放量；并非 YouTube Studio 互动率。", "componentIds": ["channel-table"]},
    ]
    capability_rows = [
        {"scope": "公开 Data API", "metric": "频道名称、简介、头像、创建时间、国家/地区", "availability": "可获取", "note": "部分字段由频道自行填写，可能为空"},
        {"scope": "公开 Data API", "metric": "订阅数、频道总播放、公开视频数", "availability": "可获取", "note": "订阅数可能隐藏且公开值会取整"},
        {"scope": "公开 Data API", "metric": "视频标题、发布时间、时长、缩略图、播放/点赞/评论", "availability": "可获取", "note": "部分计数或视频状态可能不可见"},
        {"scope": "公开 Data API", "metric": "直播状态、当前同时在线人数", "availability": "直播时可获取", "note": "仅在直播详情返回时存在"},
        {"scope": "本看板快照", "metric": "频道与视频历史趋势", "availability": "采集后计算", "note": "视频发布 7 天内每 3 小时、8–30 天每日、30 天以上每周记录；不是 API 历史字段"},
        {"scope": "频道主 OAuth + Analytics API", "metric": "观看时长、平均观看时长、订阅增减、流量来源、地区/设备", "availability": "需频道授权", "note": "只能读取获授权频道"},
        {"scope": "频道主 OAuth + Analytics API", "metric": "展示次数、点击率、观众留存、独立观众、收入", "availability": "需频道授权", "note": "具体可用性受报表维度、权限与数据阈值限制"},
        {"scope": "公开 API", "metric": "竞品真实收入、精确留存、精确公开订阅增减", "availability": "不可获取", "note": "不得用估算值冒充官方数据"},
    ]

    output = {
        "title": "YouTube 频道增长雷达",
        "status": "live",
        "surface": "dashboard",
        "id": previous.get("id", "dashboard:b83467ee-4db4-420a-b3db-b7e7989515d7"),
        "buildStatus": "complete",
        "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "collectorState": {
            "inventoryFullScanAt": utc_iso(now) if full_inventory_scan else inventory_scanned_at,
            "videoSamplingPolicy": {"within7Days": "3h", "within30Days": "daily", "olderThan30Days": "weekly"},
        },
        "filters": [],
        "queries": {
            "channel_current": {"rows": current_rows, "source": source("YouTube Data API v3 · channels.list + derived cadence", "channels.list", definitions)},
            "channel_history": {"rows": history, "source": source("Repository snapshots · 3-hour, daily, and weekly retention", "local snapshot history", definitions[:2])},
            "video_catalog": {"rows": catalog_rows, "source": source("YouTube uploads playlists · full weekly inventory plus newest-page discovery", "playlistItems.list", [])},
            "video_history": {"rows": video_history, "source": source("YouTube Data API v3 · tiered public video observations", "videos.list", [
                {"label": "视频播放历史", "definition": "视频发布 7 天内每 3 小时、8–30 天每日、30 天以上每周保存公开 viewCount。", "componentIds": ["video-trend"]},
                {"label": "点赞/评论历史", "definition": "与播放量使用相同分层频率保存公开 likeCount/commentCount。", "componentIds": ["video-trend"]},
            ])},
            "recent_videos": {"rows": recent_rows, "source": source("Latest stored observation for each channel's newest 30 uploads", "video_catalog + video_history", [
                {"label": "视频播放数", "definition": "该视频最近一次分层采集时的公开 statistics.viewCount。", "componentIds": ["recent-videos", "recent-performance"]},
                {"label": "视频点赞/评论", "definition": "采集时公开可见的 statistics.likeCount/commentCount。", "componentIds": ["recent-videos"]},
            ])},
            "capability_matrix": {"rows": capability_rows, "source": source("YouTube Data API v3 / YouTube Analytics API 官方字段能力说明", "official documentation", [])},
            "collection_health": {"rows": [{"observedAt": observed_at, "channelsExpected": len(CHANNELS), "channelsCollected": len(current_rows), "videoCatalogCount": len(catalog_rows), "videosRefreshed": len(new_video_observations), "videosDisplayed": len(recent_rows), "fullInventoryScan": full_inventory_scan, "failureCount": len(failures), "failures": failures}], "source": source("Collector runtime", "scripts/collect_youtube.py", [])},
        },
    }
    DATA_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"generatedAt": output["generatedAt"], "channels": len(current_rows), "videoCatalog": len(catalog_rows), "videosRefreshed": len(new_video_observations), "videosDisplayed": len(recent_rows), "fullInventoryScan": full_inventory_scan, "failures": failures}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"collector failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise
