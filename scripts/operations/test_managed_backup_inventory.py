#!/usr/bin/env python3
"""Non-sensitive, offline regression tests for Supabase managed backup inventory."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from managed_backup_inventory import audit, sanitize_roles_sql,validate_source_untouched

def toc(schema, names):
    return "\n".join(f"{i}; 0 123 TABLE DATA {schema} {name} postgres"
                     for i,name in enumerate(names,1))

AUTH=toc("auth",["users","identities","sessions","refresh_tokens",
                  "schema_migrations","audit_log_entries"])
LEDGER=toc("supabase_migrations",["schema_migrations"])

class ManagedBackupContract(unittest.TestCase):
    def test_requires_actual_managed_auth_data_toc(self):
        got=audit(AUTH,LEDGER)
        self.assertEqual(got["auth_required_tables_present"],4)
        self.assertFalse(got["restoration_verified"])

    def test_fail_closed_if_auth_users_missing(self):
        with self.assertRaisesRegex(ValueError,"MANAGED_AUTH_CRITICAL_TABLES_MISSING"):
            audit(toc("auth",["identities","sessions","refresh_tokens"]),LEDGER)

    def test_fail_closed_if_refresh_tokens_missing(self):
        with self.assertRaisesRegex(ValueError,"MANAGED_AUTH_CRITICAL_TABLES_MISSING"):
            audit(toc("auth",["users","identities","sessions"]),LEDGER)

    def test_fail_closed_if_migration_ledger_not_exported(self):
        with self.assertRaisesRegex(ValueError,"MIGRATION_LEDGER_TABLE_MISSING"):
            audit(AUTH,"")

    def test_wrong_schema_not_accepted(self):
        with self.assertRaisesRegex(ValueError,"MANAGED_AUTH_CRITICAL_TABLES_MISSING"):
            audit(toc("public",["users","identities","sessions","refresh_tokens"]),LEDGER)

    def test_dangerous_cross_schema_toc_rejected(self):
        with self.assertRaisesRegex(ValueError,"CROSS_SCHEMA_ARCHIVE_CONTENT_FORBIDDEN"):
            audit(AUTH,LEDGER+"\n"+toc("auth",["users"]))

    def test_comments_never_authenticate_dump_data(self):
        with self.assertRaisesRegex(ValueError,"MANAGED_AUTH_CRITICAL_TABLES_MISSING"):
            audit("; 1; 0 123 TABLE DATA auth users postgres\n",LEDGER)

    def test_only_exact_safe_restore_session_setting_sanitized(self):
        before="SET log_min_messages = warning;\nCREATE ROLE foo NOLOGIN;\n" \
               "ALTER ROLE foo BYPASSRLS;\n" \
               "SET search_path = public;\n"
        after,n=sanitize_roles_sql(before)
        self.assertEqual(n,1)
        self.assertIn("CREATE ROLE foo NOLOGIN",after)
        self.assertIn("ALTER ROLE foo BYPASSRLS",after)  # do NOT silently delete security semantics!
        self.assertIn("SET search_path = public;",after)
        self.assertNotIn("SET log_min_messages = warning;",after)
        self.assertEqual(before,sanitize_roles_sql(before)[0].replace(
          "-- ISOLATED_RESTORE_ONLY: stripped nonprivileged log_min_messages SET\n",
          "SET log_min_messages = warning;\n"))

    def test_non_session_parameter_mutation_not_removed(self):
        before="ALTER ROLE foo SET log_min_messages = fatal;\n" \
               "DO $$ BEGIN RAISE EXCEPTION 'log_min_messages'; END $$;\n"
        after,n=sanitize_roles_sql(before)
        self.assertEqual(after,before)
        self.assertEqual(n,0)

    def test_source_digest_verification_fails_closed(self):
        with tempfile.TemporaryDirectory() as p:
            f=Path(p)/"source"
            f.write_bytes(b"ciphertext-example")
            good=hashlib.sha256(f.read_bytes()).hexdigest()
            validate_source_untouched(f,good)
            f.write_bytes(b"ciphertext-changed")
            with self.assertRaisesRegex(ValueError,"SOURCE_ARTIFACT_MODIFIED"):
                validate_source_untouched(f,good)

if __name__=="__main__":
    unittest.main()
