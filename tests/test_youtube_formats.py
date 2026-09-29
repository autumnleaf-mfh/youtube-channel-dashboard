import json
import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import youtube_formats as formats


class YouTubeFormatTests(unittest.TestCase):
    def test_tab_renderers_are_positive_evidence_only(self):
        content = [{"shortsLockupViewModel": {"onTap": {"reelWatchEndpoint": {"videoId": "abcdefghijk"}}}},
                   {"lockupViewModel": {"contentId": "12345678901", "contentType": "LOCKUP_CONTENT_TYPE_VIDEO"}},
                   {"videoRenderer": {"videoId": "oldvid12345"}}, {"watchEndpoint": {"videoId": "notcount123"}}]
        self.assertEqual(formats.tab_items(content, "shorts")[0], {"abcdefghijk"})
        self.assertEqual(formats.tab_items(content, "videos")[0], {"12345678901", "oldvid12345"})

    def test_conflicting_tabs_do_not_become_long(self):
        entries = {"a": [{"format": "short", "sourceUrl": "shorts"}, {"format": "long", "sourceUrl": "videos"}]}
        self.assertEqual(formats.resolve_observations(entries, {}, "today")["a"]["format"], "unknown")

    def test_failed_scan_preserves_confirmed_and_unknown(self):
        now = datetime(2026, 9, 29, tzinfo=timezone.utc)
        previous = [{"videoId": "a", "format": "short", "status": "confirmed", "classificationMethod": "youtube_channel_tab_membership", "checkedAt": "yesterday"}]
        catalog = [{"videoId": "a", "channelId": "channel"}, {"videoId": "b", "channelId": "channel", "durationSeconds": 600}]
        with patch.object(formats, "scan_tab", side_effect=TimeoutError):
            rows, state, errors = formats.refresh_formats(catalog, previous, now=now)
        self.assertEqual([r["format"] for r in rows], ["short", "unknown"])
        self.assertEqual(len(errors), 3)
        with patch.object(formats, "scan_tab") as scan:
            formats.refresh_formats(catalog, rows, state, now + timedelta(minutes=30))
            scan.assert_not_called()
        with patch.object(formats, "scan_tab", return_value=({}, "tab_absent")) as scan:
            formats.refresh_formats(catalog, rows, state, now + timedelta(days=1))
            self.assertEqual(scan.call_count, 3)

    def test_pagination_and_channel_identity(self):
        channel = "UCexample"
        token = {"continuationItemRenderer": {"continuationEndpoint": {"commandMetadata": {"webCommandMetadata": {"apiUrl": "/youtubei/v1/browse"}}, "continuationCommand": {"token": "page2"}}}}
        initial = {"metadata": {"channelMetadataRenderer": {"externalId": channel}}, "contents": {"twoColumnBrowseResultsRenderer": {"tabs": [{"tabRenderer": {"selected": True, "endpoint": {"commandMetadata": {"webCommandMetadata": {"url": "/@channel/shorts"}}}, "content": [token]}}]}}}
        html = 'var ytInitialData = ' + json.dumps(initial) + '; "INNERTUBE_CONTEXT": {"client": {"clientName": "WEB"}}'
        more = {"onResponseReceivedActions": [{"appendContinuationItemsAction": {"continuationItems": [{"reelItemRenderer": {"videoId": "abcdefghijk"}}]}}]}
        with patch.object(formats, "fetch_json_or_html", side_effect=[html, json.dumps(more)]) as fetch:
            rows, status = formats.scan_tab(channel, "shorts", {"abcdefghijk"})
        self.assertEqual(rows["abcdefghijk"]["format"], "short")
        self.assertEqual(status, "complete")
        self.assertEqual(fetch.call_count, 2)
        with patch.object(formats, "fetch_json_or_html", return_value=html):
            with self.assertRaises(ValueError): formats.scan_tab("wrong-channel", "shorts", set())


if __name__ == "__main__": unittest.main()
