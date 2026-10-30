import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('rss_once', Path(__file__).with_name('ingest.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IngestionOperationTests(unittest.TestCase):
    def test_channel_catalog_contains_six_press_sources_and_32_video_sources(self):
        self.assertEqual(len(module.CHILE_SOURCE_IDS), 6)
        self.assertEqual(len(module.YOUTUBE_SOURCE_IDS), 32)
        self.assertEqual(len(set(module.SOURCE_IDS)), 38)

    def test_feedburner_is_allowed_only_for_the_reviewed_biobio_endpoint(self):
        source = {
            'id': module.BIOBIO_ID,
            'canonical_domain': 'biobiochile.cl',
            'endpoint': module.BIOBIO_FEED,
        }
        self.assertIn('feeds.feedburner.com', module.allowed_fetch_hosts(source))
        source['endpoint'] = 'https://feeds.feedburner.com/other/feed'
        self.assertNotIn('feeds.feedburner.com', module.allowed_fetch_hosts(source))

    def test_sql_quotes_hostile_source_text_inside_an_unpredictable_dollar_tag(self):
        sql = module.sql_for([{'headline': "O'Reilly $metadata_ingestion$ <synthetic>"}], True)
        tag = re.search(r'do (\$dialektik_[a-f0-9]{32}\$)', sql).group(1)
        self.assertEqual(sql.count(tag), 2)
        self.assertIn("O''Reilly $metadata_ingestion$", sql)
        self.assertTrue(sql.strip().endswith('rollback;'))

    def test_apply_requires_simulation_and_clears_the_private_batch_after_commit(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'SUPABASE_ACCESS_TOKEN': 'fixture-secret'}):
            module.RUN_DIR = Path(directory)
            module.PREPARED = module.RUN_DIR / 'prepared.json'
            module.DRY_RUN = module.RUN_DIR / 'dry-run.json'
            module.BATCH_KEY = module.RUN_DIR / 'batch-key.bin'
            module.create_batch_key()
            self.assertEqual(module.BATCH_KEY.stat().st_mode & 0o777, 0o600)
            items = []
            for index, source in enumerate(module.SOURCE_IDS):
                items.append({'sourceId': source, 'canonicalUrl': f'https://fixture.invalid/{index}',
                    'articleId': f'{index * 3 + 1:026d}', 'receiptId': f'{index * 3 + 2:026d}',
                    'versionId': f'{index * 3 + 3:026d}', 'storagePolicy': 'METADATA_AND_FEED_EXCERPT',
                    'excerpt': 'Authorized synthetic excerpt'})
            manifest = {'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'targetDate': dt.datetime.now(module.ZoneInfo('America/Santiago')).date().isoformat(),
                'expectedArticleCount': len(items), 'matchedArticleCount': len(items), 'items': items}
            manifest['signature'] = module.signature(manifest)
            module.write_private_json(module.PREPARED, manifest)
            with patch.object(module, 'query', return_value=[]) as query:
                with self.assertRaisesRegex(RuntimeError, 'CURRENT_BATCH_MUST_PASS_DRY_RUN'):
                    module.write(False)
                module.write(True)
                self.assertTrue(query.call_args.args[0].strip().endswith('rollback;'))
                modified = json.loads(module.PREPARED.read_text())
                modified['items'][0]['canonicalUrl'] += '/changed'
                module.write_private_json(module.PREPARED, modified)
                with self.assertRaisesRegex(RuntimeError, 'PREPARED_BATCH_SIGNATURE_INVALID'):
                    module.write(True)
                module.write_private_json(module.PREPARED, manifest)
                module.write(False)
                self.assertFalse(module.DRY_RUN.exists())
                self.assertFalse(module.PREPARED.exists())
                self.assertFalse(module.BATCH_KEY.exists())

    def test_metadata_only_rows_cannot_retain_feed_excerpts(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'SUPABASE_ACCESS_TOKEN': 'fixture-secret'}):
            module.RUN_DIR = Path(directory)
            module.PREPARED = module.RUN_DIR / 'prepared.json'
            module.DRY_RUN = module.RUN_DIR / 'dry-run.json'
            module.BATCH_KEY = module.RUN_DIR / 'batch-key.bin'
            module.create_batch_key()
            today = dt.datetime.now(module.ZoneInfo('America/Santiago')).date().isoformat()
            manifest = {
                'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'targetDate': today,
                'expectedArticleCount': 1,
                'matchedArticleCount': 1,
                'items': [{'sourceId': module.SOURCE_IDS[0], 'canonicalUrl': 'https://fixture.invalid/item',
                           'articleId': '0' * 26, 'receiptId': '1' * 26, 'versionId': '2' * 26,
                           'storagePolicy': 'METADATA_ONLY', 'excerpt': 'unauthorized excerpt'}],
            }
            manifest['signature'] = module.signature(manifest)
            module.write_private_json(module.PREPARED, manifest)
            with patch.object(module, 'query') as query:
                with self.assertRaisesRegex(RuntimeError, 'PREPARED_BATCH_CONTAINS_UNAUTHORIZED_EXCERPT'):
                    module.write(True)
                query.assert_not_called()

    def test_local_signature_does_not_use_the_proxy_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            module.RUN_DIR = Path(directory)
            module.BATCH_KEY = module.RUN_DIR / 'batch-key.bin'
            module.create_batch_key()
            with patch.dict('os.environ', {'SUPABASE_ACCESS_TOKEN': 'first-proxy-marker'}):
                first = module.signature({'items': ['example']})
            with patch.dict('os.environ', {'SUPABASE_ACCESS_TOKEN': 'second-proxy-marker'}):
                self.assertEqual(first, module.signature({'items': ['example']}))
            module.create_batch_key()
            self.assertNotEqual(first, module.signature({'items': ['example']}))


if __name__ == '__main__':
    unittest.main()
