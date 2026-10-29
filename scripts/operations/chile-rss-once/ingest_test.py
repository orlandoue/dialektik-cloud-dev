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
    def test_sql_quotes_hostile_source_text_inside_an_unpredictable_dollar_tag(self):
        sql = module.sql_for([{'headline': "O'Reilly $metadata_ingestion$ <synthetic>"}], True)
        tag = re.search(r'do (\$dialektik_[a-f0-9]{32}\$)', sql).group(1)
        self.assertEqual(sql.count(tag), 2)
        self.assertIn("O''Reilly $metadata_ingestion$", sql)
        self.assertTrue(sql.strip().endswith('rollback;'))

    def test_apply_requires_a_successful_simulation_of_the_signed_batch(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'SUPABASE_ACCESS_TOKEN': 'fixture-secret'}):
            module.RUN_DIR = Path(directory)
            module.PREPARED = module.RUN_DIR / 'prepared.json'
            module.DRY_RUN = module.RUN_DIR / 'dry-run.json'
            items = []
            for index, source in enumerate(module.SOURCE_IDS):
                items.append({'sourceId': source, 'canonicalUrl': f'https://fixture.invalid/{index}',
                    'articleId': f'{index * 3 + 1:026d}', 'receiptId': f'{index * 3 + 2:026d}',
                    'versionId': f'{index * 3 + 3:026d}'})
            manifest = {'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'items': items}
            manifest['signature'] = module.signature(manifest)
            module.write_private_json(module.PREPARED, manifest)
            with patch.object(module, 'query', return_value=[]) as query:
                with self.assertRaisesRegex(RuntimeError, 'CURRENT_BATCH_MUST_PASS_DRY_RUN'):
                    module.write(False)
                module.write(True)
                self.assertTrue(query.call_args.args[0].strip().endswith('rollback;'))
                module.write(False)
                self.assertFalse(module.DRY_RUN.exists())
            modified = json.loads(module.PREPARED.read_text())
            modified['items'][0]['canonicalUrl'] += '/changed'
            module.write_private_json(module.PREPARED, modified)
            with self.assertRaisesRegex(RuntimeError, 'PREPARED_BATCH_SIGNATURE_INVALID'):
                module.write(True)


if __name__ == '__main__':
    unittest.main()
