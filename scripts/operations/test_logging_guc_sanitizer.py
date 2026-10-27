import unittest
from managed_backup_inventory import sanitize_roles_sql


class RestoreLoggingGucTests(unittest.TestCase):
    def test_removes_only_literal_log_min_messages_session_and_role_config(self):
        source = (
            "SET log_min_messages = 'fatal';\n"
            "ALTER ROLE postgres SET log_min_messages TO 'warning';\n"
            'ALTER ROLE "platform""role" IN DATABASE "postgres" SET log_min_messages = notice;\n'
            "ALTER DATABASE postgres SET log_min_messages TO 'error';\n"
        )
        sanitized, count = sanitize_roles_sql(source)
        self.assertEqual(count, 4)
        self.assertNotIn("SET log_min_messages", sanitized)
        self.assertEqual(sanitized.count("ISOLATED_REPLAY_ONLY"), 4)

    def test_preserves_exact_create_and_alter_role_security_attributes(self):
        source = (
            "CREATE ROLE ordinary NOLOGIN;\n"
            "ALTER ROLE ordinary WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\n"
            "ALTER ROLE ordinary SET statement_timeout = '5s';\n"
            "ALTER ROLE ordinary SET log_min_messages = 'fatal';\n"
            "GRANT ordinary TO authenticated;\n"
            "REVOKE ALL ON SCHEMA public FROM PUBLIC;\n"
        )
        sanitized, count = sanitize_roles_sql(source)
        self.assertEqual(count, 1)
        for original_line in source.splitlines():
            if "SET log_min_messages" not in original_line:
                self.assertIn(original_line, sanitized)

    def test_never_removes_unrecognized_value_or_multiple_statements(self):
        source = (
            "SET log_min_messages = 'off';\n"
            "ALTER ROLE foo SET log_min_messages = 'warning'; SELECT pg_sleep(1);\n"
            "ALTER ROLE foo SET log_min_messages = 'warning' -- no delimiter\n"
            "ALTER ROLE foo WITH LOGIN SET log_min_messages = 'warning';\n"
        )
        sanitized, count = sanitize_roles_sql(source)
        self.assertEqual(count, 0)
        self.assertEqual(sanitized, source)

    def test_does_not_remove_privileged_other_postgresql_settings(self):
        source = (
            "ALTER ROLE foo SET search_path = 'public';\n"
            "SET session_replication_role = replica;\n"
            "ALTER ROLE foo SET log_statement = 'none';\n"
            "ALTER ROLE foo SET row_security = off;\n"
            "ALTER ROLE foo SET log_min_messages = 'notice';\n"
        )
        s,n = sanitize_roles_sql(source)
        self.assertEqual(n, 1)
        for line in source.splitlines()[:4]:
            self.assertIn(line, s)

    def test_log_min_messages_is_case_insensitive_but_tightly_bounded(self):
        source = (
            "alter role x set LOG_MIN_MESSAGES to 'DEBUG5';\n"
            "SET log_min_messages TO default;\n"
            "ALTER DATABASE db_name SET log_min_messages = panic;\n"
        )
        s,n = sanitize_roles_sql(source)
        self.assertEqual(n, 3)
        self.assertNotIn("log_min_messages", s.lower())

    def test_multiline_alter_role_directives_remain_unchanged(self):
        source = "ALTER ROLE foo\n SET log_min_messages = warning;\n"
        s,n = sanitize_roles_sql(source)
        self.assertEqual(n, 0)
        self.assertEqual(s, source)

    def test_overly_large_unexpected_role_file_fails_closed(self):
        source = "SET log_min_messages TO warning;\n" * 49
        with self.assertRaisesRegex(ValueError, "TOO_MANY_ISOLATED_REPLAY_LOGGING_OVERRIDES"):
            sanitize_roles_sql(source)

    def test_derived_copy_never_rewrites_original_text(self):
        source = "SET log_min_messages = warning;\nALTER ROLE foo WITH NOLOGIN;\n"
        s,n = sanitize_roles_sql(source)
        self.assertEqual(n, 1)
        self.assertEqual(source, "SET log_min_messages = warning;\nALTER ROLE foo WITH NOLOGIN;\n")
        self.assertIn("ALTER ROLE foo WITH NOLOGIN;", s)


if __name__=="__main__":
    unittest.main()
