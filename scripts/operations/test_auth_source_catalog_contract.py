import unittest
from auth_source_catalog_contract import SOURCE_AUTH_CATALOG,compare

def source_rows():
    return "\n".join(f"{name}|{count}|{digest}" for name,(count,digest)
                     in SOURCE_AUTH_CATALOG.items())

class AuthCatalogContractTests(unittest.TestCase):
    def test_identical_metadata_is_exact(self):
        got=compare(source_rows())
        self.assertEqual(got["source_tables"],27)
        self.assertTrue(got["exact_catalog_compatibility"])
        self.assertFalse(got["data_restore_completed"])

    def test_detects_column_count_difference(self):
        rows=source_rows().replace("users|35|","users|36|")
        got=compare(rows)
        self.assertEqual(got["column_count_mismatches"],1)
        self.assertFalse(got["exact_catalog_compatibility"])

    def test_detects_default_or_type_difference(self):
        rows=source_rows().replace(
            SOURCE_AUTH_CATALOG["users"][1],
            "0"*32)
        got=compare(rows)
        self.assertEqual(got["full_column_default_fingerprint_mismatches"],1)
        self.assertEqual(got["column_count_mismatches"],0)

    def test_missing_source_table_is_not_pass(self):
        rows="\n".join(x for x in source_rows().splitlines()
                       if not x.startswith("users|"))
        got=compare(rows)
        self.assertEqual(got["missing_source_tables"],1)
        self.assertFalse(got["same_name_catalog_only"])

    def test_unexpected_catalog_identifier_rejected(self):
        with self.assertRaisesRegex(ValueError,"INVALID_LOCAL_AUTH_CATALOG_ENTRY"):
            compare(source_rows()+"\nusers|1|"+("f"*32))

    def test_rejects_unexpected_row_format(self):
        with self.assertRaisesRegex(ValueError,"INVALID_LOCAL_CATALOG_FORMAT"):
            compare('fake_user_private_email_or_token')

if __name__=="__main__":unittest.main()
