import unittest
from scripts.operations.realtime_seeded_ledger_gate import compare,filter_toc,source_versions,RealtimeGateError
TOC="; archive\n500; 0 0 TABLE DATA realtime messages admin\n501; 0 0 TABLE DATA realtime schema_migrations admin\n502; 0 0 TABLE DATA realtime subscription admin\n"
ROWS=[f"{i}\t2026-10-21 11:11:11" for i in range(1,92)]
SQL="COPY realtime.schema_migrations (version, inserted_at) FROM stdin;\n"+"\n".join(ROWS)+"\n\\.\n"
class RealtimeGateTests(unittest.TestCase):
 def test_select_and_exclude_one_ledger(self):
  selected=filter_toc(TOC,exclude=False)
  self.assertIn("501; 0 0 TABLE DATA realtime schema_migrations",selected)
  self.assertIn(";500; 0 0 TABLE DATA realtime messages",selected)
  other=filter_toc(TOC,exclude=True)
  self.assertIn(";501; 0 0 TABLE DATA realtime schema_migrations",other)
  self.assertIn("500; 0 0 TABLE DATA realtime messages",other)
 def test_equal_versions_timestamp_variation_permitted(self):
  compare(SQL,"\n".join(reversed(ROWS)))
  compare(SQL,"\n".join(r.replace("11:11:11","12:12:12") for r in ROWS))
 def test_missing_duplicate_or_different_version_denied(self):
  for rows in (ROWS[:-1],ROWS[:-1]+[ROWS[0]],ROWS[:-1]+[ROWS[-1].replace("91\t","99\t")]):
   with self.assertRaises(RealtimeGateError):compare(SQL,"\n".join(rows))
 def test_bad_copy_and_toc_denied(self):
  for bad in (SQL.replace("realtime.schema_migrations","realtime.messages"),
              SQL.replace("\\.\n",""),SQL.replace("91\t","oops\t")):
   with self.assertRaises(RealtimeGateError):source_versions(bad)
  for bad in (TOC+TOC,TOC.replace("TABLE DATA realtime messages","TABLE DATA public articles")):
   with self.assertRaises(RealtimeGateError):filter_toc(bad,exclude=True)
 def test_no_values_in_errors(self):
  with self.assertRaises(RealtimeGateError) as e:compare(SQL,"\n".join(ROWS[:-1]))
  self.assertNotIn("2026-10-21",str(e.exception))
  self.assertNotIn("91\t",str(e.exception))
if __name__=="__main__":unittest.main()
