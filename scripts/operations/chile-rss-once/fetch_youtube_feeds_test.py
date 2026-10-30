import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'youtube_fetch', Path(__file__).with_name('fetch_youtube_feeds.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class YouTubeFeedFetchTests(unittest.TestCase):
    def test_catalog_has_32_unique_reviewed_youtube_feed_endpoints(self):
        channels = module.channel_catalog()
        self.assertEqual(len(channels), 32)
        self.assertEqual(len({entry['source_id'] for entry in channels}), 32)
        for channel in channels:
            self.assertTrue(channel['source_id'].startswith('01M4YDQK00YT'))
            self.assertTrue(channel['atom_feed_endpoint'].startswith(
                'https://www.youtube.com/feeds/videos.xml?'))

    def test_rejects_an_endpoint_outside_the_youtube_atom_host_before_network_access(self):
        channel = {
            'atom_feed_endpoint': 'https://attacker.example/feeds/videos.xml?channel_id=UC1',
        }
        with patch.object(module.urllib.request, 'urlopen') as open_url:
            with self.assertRaisesRegex(ValueError, 'SOURCE_ENDPOINT_IDENTITY_INVALID'):
                module.fetch(channel)
            open_url.assert_not_called()


if __name__ == '__main__':
    unittest.main()
