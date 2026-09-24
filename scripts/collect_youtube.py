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
from datetime import datetime, timezone
from pathlib import Path


API_BASE = "https://www.googleapis.com/youtube/v3"
ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = Path(os.environ.get("DASHBOARD_DATA_PATH", ROOT / "src" / "data.json"))
RECENT_VIDEO_LIMIT = 30
HISTORY_LIMIT = 24 * 180

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
    observed_at = now.replace(minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")
    channel_ids = [channel_id for _, channel_id in CHANNELS]
    aliases = {channel_id: name for name, channel_id in CHANNELS}

    channel_payload = api_get(
        "channels",
        part="snippet,statistics,contentDetails,brandingSettings",
        id=",".join(channel_ids),
        maxResults=50,
    )
    channel_map = {item["id"]: item for item in channel_payload.get("items", [])}

    uploads = {}
    playlist_items = []
    failures = []
    for channel_id in channel_ids:
        item = channel_map.get(channel_id)
        if not item:
            failures.append({"channelId": channel_id, "error": "channel_not_returned"})
            continue
        playlist_id = item.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        uploads[channel_id] = playlist_id
        if not playlist_id:
            failures.append({"channelId": channel_id, "error": "uploads_playlist_missing"})
            continue
        try:
            payload = api_get(
                "playlistItems",
                part="snippet,contentDetails",
                playlistId=playlist_id,
                maxResults=RECENT_VIDEO_LIMIT,
            )
            for row in payload.get("items", []):
                video_id = row.get("contentDetails", {}).get("videoId")
                if video_id:
                    playlist_items.append({"channelId": channel_id, "videoId": video_id})
        except Exception as exc:  # retain other channels when one playlist fails
            failures.append({"channelId": channel_id, "error": type(exc).__name__})

    video_ids = list(dict.fromkeys(row["videoId"] for row in playlist_items))
    video_map = {}
    for batch in chunks(video_ids, 50):
        payload = api_get(
            "videos",
            part="snippet,contentDetails,statistics,liveStreamingDetails,status",
            id=",".join(batch),
            maxResults=50,
        )
        video_map.update({item["id"]: item for item in payload.get("items", [])})

    recent_rows = []
    videos_by_channel = {channel_id: [] for channel_id in channel_ids}
    for link in playlist_items:
        item = video_map.get(link["videoId"])
        if not item:
            continue
        snippet = item.get("snippet", {})
        stats = item.get("statistics", {})
        duration_seconds = iso_duration_seconds(item.get("contentDetails", {}).get("duration"))
        published_at = snippet.get("publishedAt")
        row = {
            "channelId": link["channelId"],
            "channel": aliases[link["channelId"]],
            "videoId": item["id"],
            "title": snippet.get("title") or "未命名视频",
            "publishedAt": published_at,
            "publishedDate": published_at[:10] if published_at else None,
            "viewCount": number(stats.get("viewCount")),
            "likeCount": number(stats.get("likeCount")),
            "commentCount": number(stats.get("commentCount")),
            "durationSeconds": duration_seconds,
            "formatHint": "短视频候选" if duration_seconds is not None and duration_seconds <= 180 else "长视频/直播候选",
            "thumbnail": (snippet.get("thumbnails", {}).get("medium") or snippet.get("thumbnails", {}).get("default") or {}).get("url"),
            "url": f"https://www.youtube.com/watch?v={item['id']}",
            "isLive": snippet.get("liveBroadcastContent") == "live",
            "concurrentViewers": number(item.get("liveStreamingDetails", {}).get("concurrentViewers")),
        }
        recent_rows.append(row)
        videos_by_channel[link["channelId"]].append(row)

    current_rows = []
    for channel_id in channel_ids:
        item = channel_map.get(channel_id)
        if not item:
            continue
        snippet = item.get("snippet", {})
        stats = item.get("statistics", {})
        videos = sorted(videos_by_channel[channel_id], key=lambda row: row.get("publishedAt") or "", reverse=True)
        published = [parse_time(row["publishedAt"]) for row in videos if row.get("publishedAt")]
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

    try:
        previous = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        history = previous.get("queries", {}).get("channel_history", {}).get("rows", [])
    except (FileNotFoundError, json.JSONDecodeError):
        previous = {}
        history = []

    # Idempotent within an hour, so reruns update instead of duplicating the snapshot.
    history = [row for row in history if row.get("observedAt") != observed_at]
    history.extend({
        "observedAt": observed_at,
        "date": observed_at[:10],
        "channelId": row["channelId"],
        "channel": row["channel"],
        "subscriberCount": row["subscriberCount"],
        "channelViewCount": row["channelViewCount"],
        "videoCount": row["videoCount"],
    } for row in current_rows)
    history = sorted(history, key=lambda row: (row.get("observedAt", ""), row.get("channelId", "")))[-HISTORY_LIMIT * len(CHANNELS):]

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
        {"scope": "本看板快照", "metric": "24 小时/7 天变化、历史趋势、停更天数", "availability": "采集后计算", "note": "不是 API 历史字段；从首次成功采集起累计"},
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
        "filters": [],
        "queries": {
            "channel_current": {"rows": current_rows, "source": source("YouTube Data API v3 · channels.list + derived cadence", "channels.list", definitions)},
            "channel_history": {"rows": history, "source": source("Repository snapshots · one observation per channel per collection hour", "local snapshot history", definitions[:2])},
            "recent_videos": {"rows": recent_rows, "source": source("YouTube Data API v3 · playlistItems.list + videos.list", "playlistItems.list, videos.list", [
                {"label": "视频播放数", "definition": "采集时的公开 statistics.viewCount。", "componentIds": ["recent-videos", "recent-performance"]},
                {"label": "视频点赞/评论", "definition": "采集时公开可见的 statistics.likeCount/commentCount。", "componentIds": ["recent-videos"]},
            ])},
            "capability_matrix": {"rows": capability_rows, "source": source("YouTube Data API v3 / YouTube Analytics API 官方字段能力说明", "official documentation", [])},
            "collection_health": {"rows": [{"observedAt": observed_at, "channelsExpected": len(CHANNELS), "channelsCollected": len(current_rows), "videosCollected": len(recent_rows), "failureCount": len(failures), "failures": failures}], "source": source("Collector runtime", "scripts/collect_youtube.py", [])},
        },
    }
    DATA_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"generatedAt": output["generatedAt"], "channels": len(current_rows), "videos": len(recent_rows), "failures": failures}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"collector failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise
