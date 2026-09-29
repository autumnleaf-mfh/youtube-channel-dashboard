import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import channel_avatars as avatars


class AvatarTests(unittest.TestCase):
    def test_cache_reuse_and_changed_source(self):
        old = {'channelId': 'a', 'avatarDataUrl': 'data:image/png;base64,YQ==', 'avatarSourceUrl': 'same'}
        rows = [{'channelId': 'a', 'thumbnail': 'same'}]
        with patch.object(avatars, 'fetch_avatar') as fetch:
            avatars.cache_avatars(rows, [old])
            fetch.assert_not_called()
        self.assertEqual(rows[0]['avatarDataUrl'], old['avatarDataUrl'])
        rows[0]['thumbnail'] = 'changed'
        with patch.object(avatars, 'fetch_avatar', return_value='data:image/jpeg;base64,Yg==') as fetch:
            avatars.cache_avatars(rows, [old])
            fetch.assert_called_once_with('changed')
        self.assertEqual(rows[0]['avatarSourceUrl'], 'changed')

    def test_failures_keep_previous_or_allow_initial_fallback(self):
        old = {'channelId': 'a', 'avatarDataUrl': 'data:image/png;base64,YQ==', 'avatarSourceUrl': 'old'}
        rows = [{'channelId': 'a', 'thumbnail': 'new'}, {'channelId': 'b', 'thumbnail': 'new'}]
        with patch.object(avatars, 'fetch_avatar', side_effect=ValueError('offline')):
            avatars.cache_avatars(rows, [old])
        self.assertEqual(rows[0]['avatarDataUrl'], old['avatarDataUrl'])
        self.assertNotIn('avatarDataUrl', rows[1])

    def test_reject_other_origins(self):
        for url in ['http://yt3.ggpht.com/test', 'https://example.com/test', 'https://yt3.ggpht.com@localhost/test']:
            with self.assertRaises(ValueError):
                avatars.fetch_avatar(url)
