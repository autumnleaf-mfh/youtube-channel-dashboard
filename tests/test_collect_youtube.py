import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "collect_youtube.py"
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


if __name__ == "__main__":
    unittest.main()
