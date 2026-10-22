import unittest
from scripts.operations.storage_seeded_ledger_gate import source_toc, exact_compare, semantic_migration_compare, StorageGateError, extract_source_rows
SAMPLE_TOC=(
  "; Archive header\n"
  "3652; 0 0 TABLE DATA storage migrations storage_admin\n"
  "3653; 0 0 TABLE DATA storage buckets storage_admin\n"
  "3654; 0 0 TABLE DATA storage objects storage_admin\n"
)
ROWS=[f"{i}\tname-{i}\thash-{i}\t2026-10-21 10:00:00" for i in range(1,75)]
SOURCE="-- synthetic only\nCOPY storage.migrations (id, name, hash, executed_at) FROM stdin;\n"+"\n".join(ROWS)+"\n\\.\n"
class StorageSeededGateTests(unittest.TestCase):
  def test_only_single_target_entry_enabled(self):
    a=source_toc(SAMPLE_TOC,exclude=False)
    self.assertIn("3652; 0 0 TABLE DATA storage migrations",a)
    self.assertIn(";3653; 0 0 TABLE DATA storage buckets",a)
    b=source_toc(SAMPLE_TOC,exclude=True)
    self.assertIn(";3652; 0 0 TABLE DATA storage migrations",b)
    self.assertIn("3653; 0 0 TABLE DATA storage buckets",b)
  def test_all_four_fields_must_match_not_only_version(self):
    exact_compare(SOURCE,"\n".join(reversed(ROWS))+"\n")
    with self.assertRaises(StorageGateError):
      exact_compare(SOURCE,"\n".join(ROWS[:-1]+[ROWS[-1].replace("hash-74","DIFFERENT")]))
    with self.assertRaises(StorageGateError):
      exact_compare(SOURCE,"\n".join(ROWS[:-1]+[ROWS[-1].replace("10:00:00","10:00:01")]))
  def test_safe_categories_cannot_reveal_data(self):
    for rows,category in (
      (ROWS[:-1]+[ROWS[-1].replace("10:00:00","10:00:01")],
       "STORAGE_MIGRATION_TIMESTAMP_ONLY_MISMATCH"),
      (ROWS[:-1]+[ROWS[-1].replace("hash-74","changed")],
       "STORAGE_MIGRATION_NAME_OR_HASH_MISMATCH"),
      (ROWS[:-1]+[ROWS[-1].replace("74\tname","75\tname")],
       "STORAGE_MIGRATION_ID_SET_MISMATCH"),
      (ROWS[:-1],"STORAGE_TARGET_ROW_COUNT_OR_COLUMNS_MISMATCH"),
    ):
      with self.assertRaises(StorageGateError) as exc:
        exact_compare(SOURCE,"\n".join(rows))
      self.assertEqual(str(exc.exception),category)
      self.assertNotIn("name-74",str(exc.exception))
      self.assertNotIn("hash-74",str(exc.exception))
  def test_only_timestamp_difference_is_semantically_compatible(self):
    semantic_migration_compare(SOURCE,"\n".join(ROWS))
    semantic_migration_compare(SOURCE,"\n".join(
       ROWS[:-1]+[ROWS[-1].replace("10:00:00","10:00:01")]))
    for changed in (
      ROWS[:-1]+[ROWS[-1].replace("hash-74","other-hash")],
      ROWS[:-1]+[ROWS[-1].replace("name-74","other-name")],
      ROWS[:-1],
    ):
      with self.assertRaises(StorageGateError):
        semantic_migration_compare(SOURCE,"\n".join(changed))
  def test_forward_one_newer_storage_migration_preserves_all_source_signatures(self):
    forward="75\tlocal-forward-migration\t"+"a"*40+"\t2026-10-22 01:00:00"
    semantic_migration_compare(SOURCE,"\n".join(ROWS+[forward]))
    for rows in (
      ROWS[:-1]+[forward],
      ROWS+[forward.replace("75\t","74\t")],
      ROWS+[forward.replace("75\t","0\t")],
      ROWS+[forward.replace("a"*40,"f"*39)],
      ROWS+[forward,forward.replace("75\t","76\t")],
      ROWS[:-1]+[ROWS[-1].replace("hash-74","modified")]+[forward],
    ):
      with self.assertRaises(StorageGateError):
        semantic_migration_compare(SOURCE,"\n".join(rows))
  def test_mismatched_target_count_or_duplicate_id_fails(self):
    with self.assertRaises(StorageGateError): exact_compare(SOURCE,"\n".join(ROWS[:-1]))
    with self.assertRaises(StorageGateError): exact_compare(SOURCE,"\n".join(ROWS[:-1]+[ROWS[0]]))
  def test_malformed_source_and_unexpected_schema_table_fails(self):
    with self.assertRaises(StorageGateError): extract_source_rows(SOURCE.replace("\\.\n",""))
    with self.assertRaises(StorageGateError):
      extract_source_rows(SOURCE.replace("storage.migrations","storage.buckets"))
    with self.assertRaises(StorageGateError):
      source_toc(SAMPLE_TOC+SAMPLE_TOC,exclude=False)
if __name__=="__main__": unittest.main()
