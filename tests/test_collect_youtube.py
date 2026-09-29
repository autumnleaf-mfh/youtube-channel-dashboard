import importlib.util
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "collect_youtube.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("collect_youtube", MODULE_PATH)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class SamplingPolicyTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 24, 10, 10, tzinfo=timezone.utc)

    def test_three_hour_bucket_uses_hong_kong_time(self):
        self.assertEqual(collector.three_hour_observation(self.now), "2026-09-24T10:00:00Z")

    def test_recent_video_is_due_in_next_three_hour_bucket(self):
        published = self.now - timedelta(days=2)
        same_bucket = datetime(2026, 9, 24, 10, 5, tzinfo=timezone.utc)
        previous_bucket = datetime(2026, 9, 24, 9, 59, tzinfo=timezone.utc)
        self.assertFalse(collector.video_due(published, same_bucket, self.now))
        self.assertTrue(collector.video_due(published, previous_bucket, self.now))

    def test_eight_to_thirty_day_video_is_daily(self):
        published = self.now - timedelta(days=8)
        same_hk_day = datetime(2026, 9, 24, 2, 0, tzinfo=timezone.utc)
        previous_hk_day = datetime(2026, 9, 23, 15, 59, tzinfo=timezone.utc)
        self.assertFalse(collector.video_due(published, same_hk_day, self.now))
        self.assertTrue(collector.video_due(published, previous_hk_day, self.now))

    def test_older_video_is_weekly(self):
        published = self.now - timedelta(days=60)
        same_week = self.now - timedelta(days=1)
        previous_week = self.now - timedelta(days=7)
        self.assertFalse(collector.video_due(published, same_week, self.now))
        self.assertTrue(collector.video_due(published, previous_week, self.now))

    def test_channel_history_compacts_by_age(self):
        rows = []
        for hours in (1, 4, 7):
            rows.append({"channelId": "a", "observedAt": collector.utc_iso(self.now - timedelta(hours=hours)), "value": hours})
        for hours in (8 * 24 + 1, 8 * 24 + 8):
            rows.append({"channelId": "a", "observedAt": collector.utc_iso(self.now - timedelta(hours=hours)), "value": hours})
        compacted = collector.compact_history(rows, ("channelId",), self.now)
        self.assertEqual(len(compacted), 4)
        self.assertEqual([row["value"] for row in compacted if row["value"] > 100], [193])


class InventoryTests(unittest.TestCase):
    def run_inventory(self, fail_second_page=False):
        stamp = collector.utc_iso(datetime.now(timezone.utc) - timedelta(hours=1))
        old = {"channelId": "a", "channel": "Old handle", "videoId": "removed", "publishedAt": stamp}
        previous = {"collectorState": {"inventoryFullScanAt": stamp}, "queries": {
            "channel_current": {"rows": [{"channelId": "a", "channel": "Old handle"}]},
            "video_catalog": {"rows": [old, {**old, "channelId": "deleted-channel", "videoId": "deleted-video"}]},
            "video_history": {"rows": [{**old, "observedAt": stamp, "viewCount": 123}]},
        }}
        calls = []

        def api(resource, **params):
            calls.append((resource, params))
            if resource == "channels":
                return {"items": [{"id": key, "snippet": {"title": title}, "statistics": {"videoCount": "2", "subscriberCount": "5", "viewCount": "123"}, "contentDetails": {"relatedPlaylists": {"uploads": key}}} for key, title in [("a", "新频道名"), ("b", "新增频道")]]}
            if resource == "playlistItems":
                channel = params["playlistId"]
                second = bool(params.get("pageToken"))
                if channel == "a" and second and fail_second_page:
                    raise TimeoutError("fixture")
                video_id = channel + ("2" if second else "1")
                payload = {"items": [{"snippet": {"title": video_id}, "contentDetails": {"videoId": video_id, "videoPublishedAt": stamp}}]}
                if channel == "a" and not second:
                    payload["nextPageToken"] = "second"
                return payload
            if resource == "videos":
                return {"items": [{"id": video_id, "statistics": {"viewCount": "10"}} for video_id in params["id"].split(",")]}
            raise AssertionError(resource)

        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "data.json"
            snapshot.write_text(json.dumps(previous), encoding="utf-8")
            with patch.object(collector, "DATA_PATH", snapshot), patch.object(collector, "CHANNELS", [("Alias a", "a"), ("Alias b", "b")]), patch.object(collector, "api_get", api), patch.object(collector, "refresh_formats", return_value=([], {}, [])), patch.dict(os.environ, {"YOUTUBE_API_KEY": "fixture"}), contextlib.redirect_stdout(io.StringIO()):
                collector.main()
            return json.loads(snapshot.read_text(encoding="utf-8")), calls

    def test_added_channel_forces_full_inventory_and_current_titles(self):
        data, calls = self.run_inventory()
        self.assertTrue(data["queries"]["collection_health"]["rows"][0]["fullInventoryScan"])
        self.assertEqual({row["videoId"] for row in data["queries"]["video_catalog"]["rows"]}, {"a1", "a2", "b1"})
        self.assertTrue(any(params.get("pageToken") == "second" for _, params in calls))
        for key in ("channel_current", "channel_history", "video_catalog", "video_history", "recent_videos"):
            for row in data["queries"][key]["rows"]:
                self.assertIn(row["channelId"], ("a", "b"))
                self.assertEqual(row["channel"], {"a": "新频道名", "b": "新增频道"}[row["channelId"]])
        self.assertIn("removed", {row["videoId"] for row in data["queries"]["video_history"]["rows"]})

    def test_failed_playlist_preserves_previous_inventory(self):
        data, _ = self.run_inventory(fail_second_page=True)
        self.assertEqual({row["videoId"] for row in data["queries"]["video_catalog"]["rows"]}, {"removed", "b1"})
        self.assertEqual(data["queries"]["collection_health"]["rows"][0]["failureCount"], 1)


if __name__ == "__main__":
    unittest.main()
