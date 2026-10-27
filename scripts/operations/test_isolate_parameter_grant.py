import unittest
from isolate_parameter_grant import split_grant, _COMMENT

class ExactIsolatedParameterGrantTests(unittest.TestCase):
    def test_preserves_all_roles_and_grants_exactly(self):
        src=(
            'CREATE ROLE foo NOLOGIN;\n'
            'ALTER ROLE foo WITH NOBYPASSRLS NOSUPERUSER NOCREATEROLE;\n'
            'GRANT SET ON PARAMETER "log_min_messages" TO "foo";\n'
            'GRANT foo TO authenticated;\n'
            'REVOKE ALL ON SCHEMA public FROM PUBLIC;\n'
        )
        normal,privileged=split_grant(src)
        self.assertEqual(privileged,'GRANT SET ON PARAMETER "log_min_messages" TO "foo";\n')
        self.assertEqual(normal.replace(_COMMENT+'\n',privileged,1),src)
        self.assertIn('ALTER ROLE foo WITH NOBYPASSRLS NOSUPERUSER',normal)
        self.assertIn('GRANT foo TO authenticated',normal)
        self.assertIn('REVOKE ALL ON SCHEMA public FROM PUBLIC',normal)
    def test_fails_closed_if_source_has_no_parameter_grant(self):
        with self.assertRaisesRegex(ValueError,"EXACTLY_ONE_PARAMETER_GRANT_REQUIRED"):
            split_grant("CREATE ROLE foo NOLOGIN;\n")
    def test_fails_closed_if_parameter_grant_is_not_full_line(self):
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LOG_PARAMETER_SQL_SHAPE"):
            split_grant('GRANT SET ON PARAMETER "log_min_messages" TO foo; DROP ROLE postgres;\n')
    def test_fails_closed_if_source_revokes_instead_of_grants(self):
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LOG_PARAMETER_SQL_SHAPE"):
            split_grant('REVOKE SET ON PARAMETER "log_min_messages" FROM foo;\n')
    def test_does_not_silently_skip_unrelated_set_or_password(self):
        src=(
            'ALTER ROLE foo WITH LOGIN PASSWORD ''synthetic_no_real_secret'';\n'
            'GRANT SET ON PARAMETER "log_min_messages" TO foo WITH GRANT OPTION;\n'
            'SET search_path = public;\n'
        )
        normal,grant=split_grant(src)
        self.assertIn("ALTER ROLE foo WITH LOGIN PASSWORD",normal)
        self.assertIn("SET search_path = public;",normal)
        self.assertIn("WITH GRANT OPTION",grant)
    def test_disallows_unquoted_guc_or_unrecognized_role_format(self):
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LOG_PARAMETER_SQL_SHAPE"):
            split_grant("GRANT SET ON PARAMETER log_min_messages TO foo;\n")
    def test_disallows_more_than_one_grant(self):
        src=("GRANT SET ON PARAMETER \"log_min_messages\" TO foo;\n"*2)
        with self.assertRaisesRegex(ValueError,"EXACTLY_ONE_PARAMETER_GRANT_REQUIRED"):
            split_grant(src)
    def test_preserves_crlf_source_byte_semantics(self):
        src="CREATE ROLE foo NOLOGIN;\r\nGRANT SET ON PARAMETER \"log_min_messages\" TO foo;\r\n"
        normal,grant=split_grant(src)
        self.assertEqual(normal.replace(_COMMENT+"\r\n",grant,1),src)
    def test_rejects_comments_instead_of_executable_privilege(self):
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LOG_PARAMETER_SQL_SHAPE"):
            split_grant('-- GRANT SET ON PARAMETER "log_min_messages" TO foo;\n')

if __name__=="__main__":
    unittest.main()
