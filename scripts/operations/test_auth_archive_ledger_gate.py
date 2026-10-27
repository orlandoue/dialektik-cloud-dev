import unittest
from auth_archive_ledger_gate import compare, migration_only_toc, GateFailure
VERSIONS = [str(i).zfill(14) for i in range(1,83)]
SRC = ("SET client_encoding = 'UTF8';\nCOPY auth.schema_migrations (version) FROM stdin;\n" +
       "\n".join(VERSIONS) + "\n\\.\n")
TGT = "\n".join(reversed(VERSIONS)) + "\n"
TOC = ';\n' + ''.join(f'{i}; 0 1 TABLE DATA auth {name} postgres\n'
                        for i,name in enumerate(['schema_migrations']+[f'table_{i}' for i in range(26)],1))
class AuthArchiveGateTests(unittest.TestCase):
    def test_equal_values_pass(self):
        compare(SRC,TGT)
    def test_one_changed_version_fails(self):
        with self.assertRaisesRegex(GateFailure,'SET_MISMATCH'):
            compare(SRC,TGT.replace(VERSIONS[0]+'\n','99999999999999\n'))
    def test_no_migration_copy_fails(self):
        with self.assertRaises(GateFailure):
            compare('SET client_encoding = UTF8;\n',TGT)
    def test_malformed_archive_fails(self):
        with self.assertRaises(GateFailure):
            compare(SRC.replace(VERSIONS[8],r'\x41'),TGT)
    def test_duplicate_fails(self):
        with self.assertRaises(GateFailure):
            compare(SRC.replace(VERSIONS[20],VERSIONS[19]),TGT)
    def test_truncated_copy_fails(self):
        with self.assertRaises(GateFailure):
            compare(SRC.removesuffix('\\.\n'),TGT)
    def test_archive_multiple_copies_fail(self):
        with self.assertRaises(GateFailure):
            compare(SRC+SRC,TGT)
    def test_target_duplicate_fail(self):
        with self.assertRaises(GateFailure):
            compare(SRC,TGT.replace(VERSIONS[0]+'\n',VERSIONS[1]+'\n'))
    def test_prepare_keeps_exactly_one_auth_migration_line(self):
        o=migration_only_toc(TOC)
        self.assertEqual(len([x for x in o.splitlines() if x and not x.startswith(';')]),1)
        self.assertIn('TABLE DATA auth schema_migrations',o)
    def test_incorrect_toc_inventory_fails(self):
        with self.assertRaisesRegex(GateFailure,'INVENTORY'):
            migration_only_toc(TOC.replace('TABLE DATA auth table_25','TABLE DATA auth table_24'))
if __name__=='__main__': unittest.main()
