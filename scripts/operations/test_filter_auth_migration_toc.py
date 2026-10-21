import unittest
from filter_auth_migration_toc import prepare

NAMES=[
 "audit_log_entries","custom_oauth_providers","flow_state","identities",
 "instances","mfa_amr_claims","mfa_challenges","mfa_factors",
 "mfa_recovery_code_sets","mfa_recovery_codes","oauth_authorizations",
 "oauth_client_states","oauth_clients","oauth_consents","one_time_tokens",
 "refresh_tokens","saml_providers","saml_relay_states","schema_migrations",
 "scim_tokens","scim_users","sessions","sso_domains","sso_providers",
 "users","webauthn_challenges","webauthn_credentials"
]
def toc(names=NAMES):
    return "; source archive fixture NOT REAL\n" + "".join(
        f"{i}; 0 123 TABLE DATA auth {name} postgres\n"
        for i,name in enumerate(names,1))

class AuthRestoreTocTests(unittest.TestCase):
    def test_exactly_one_seeded_table_excluded(self):
        src=toc()
        out,stats=prepare(src)
        self.assertEqual(stats["excluded_auth_migration_entries"],1)
        self.assertFalse(stats["source_target_version_equality_verified_here"])
        self.assertEqual(out.count(";19; 0 123 TABLE DATA auth schema_migrations"),1)
        self.assertIn("25; 0 123 TABLE DATA auth users postgres",out)
        self.assertEqual(out.replace(";19; 0 123 TABLE DATA auth schema_migrations",
                                     "19; 0 123 TABLE DATA auth schema_migrations"),src)

    def test_26_others_unchanged(self):
        src=toc()
        out,_=prepare(src)
        for line in src.splitlines():
            if "TABLE DATA auth schema_migrations " not in line:
                self.assertIn(line,out)

    def test_bad_or_missing_inventory_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"AUTH_ARCHIVE_TABLE_INVENTORY"):
            prepare(toc(NAMES[:-1]))

    def test_duplicate_migration_entry_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"AUTH_ARCHIVE_TABLE_INVENTORY"):
            prepare(toc(NAMES+["schema_migrations"]))

    def test_wrong_schema_migration_is_never_excluded(self):
        src=toc().replace("TABLE DATA auth schema_migrations",
                          "TABLE DATA public schema_migrations")
        with self.assertRaisesRegex(ValueError,"AUTH_ARCHIVE_TABLE_INVENTORY"):
            prepare(src)

    def test_source_backup_bytes_not_modified(self):
        src=toc()
        prepare(src)
        self.assertIn("19; 0 123 TABLE DATA auth schema_migrations",src)
        self.assertNotIn(";19; 0 123 TABLE DATA auth schema_migrations",src)

if __name__=="__main__":
    unittest.main()
