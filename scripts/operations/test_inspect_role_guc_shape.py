import unittest
from inspect_role_guc_shape import bounded_shapes, physical_guc_shapes

class PrivateSqlShapeTests(unittest.TestCase):
    def test_shape_of_role_alter_does_not_return_identity(self):
        parsed=bounded_shapes('ALTER ROLE "do_not_disclose" SET log_min_messages TO ''fatal'';')
        self.assertEqual(parsed["ROLE_ALTER"],1)
        self.assertNotIn("do_not_disclose", repr(parsed))

    def test_session_set_statement(self):
        parsed=bounded_shapes("SET log_min_messages = warning;")
        self.assertEqual(parsed["SESSION_SET"],1)

    def test_multi_line_role_sql_is_classified_without_reconstructing_it(self):
        parsed=bounded_shapes("ALTER ROLE\n postgres\n SET log_min_messages = 'warning';")
        self.assertEqual(parsed["ROLE_ALTER"],1)

    def test_set_config_function(self):
        parsed=bounded_shapes("SELECT pg_catalog.set_config('log_min_messages','warning',true);")
        self.assertEqual(parsed["SET_CONFIG_FUNCTION"],1)

    def test_unknown_fragment_is_generic(self):
        parsed=bounded_shapes("something with log_min_messages;")
        self.assertEqual(parsed["OTHER_OR_MULTILINE"],1)

    def test_denies_unbounded_diagnostic(self):
        with self.assertRaisesRegex(ValueError,"ROLE_SQL_DIAGNOSTIC_INPUT_SIZE_LIMIT"):
            bounded_shapes("X"*12_000_001)

    def test_physical_shape_exposes_only_fixed_boolean_counts(self):
        text='ALTER ROLE "private_identity" SET "log_min_messages" TO \'warning\';'
        observed=physical_guc_shapes(text)
        self.assertEqual(observed["LINE_STARTS_ALTER_ROLE"],1)
        self.assertEqual(observed["LINE_HAS_SET_ANYWHERE"],1)
        self.assertEqual(observed["GUC_IDENTIFIER_DOUBLE_QUOTED"],1)
        self.assertEqual(observed["GUC_LINE_ENDS_SEMICOLON"],1)
        self.assertNotIn("private_identity",str(observed))

    def test_physical_shape_distinguishes_comments_and_multiline(self):
        text='-- mention log_min_messages\nALTER ROLE foo\n SET log_min_messages = warning;'
        observed=physical_guc_shapes(text)
        self.assertEqual(observed["LINE_STARTS_COMMENT"],1)
        self.assertEqual(observed["LINE_STARTS_SET"],1)
        self.assertEqual(observed["LINE_STARTS_ALTER_ROLE"],0)

    def test_database_alter_and_system_are_separate_safe_categories(self):
        db=physical_guc_shapes('ALTER DATABASE "test_db" SET "log_min_messages" TO warning;')
        sys=physical_guc_shapes('ALTER SYSTEM SET "log_min_messages" TO warning;')
        self.assertEqual(db["LINE_STARTS_ALTER_DATABASE"],1)
        self.assertEqual(sys["LINE_STARTS_ALTER_SYSTEM"],1)

    def test_no_matching_parameter(self):
        parsed=bounded_shapes("CREATE ROLE anon;")
        self.assertEqual(sum(parsed.values()),0)

if __name__=="__main__":unittest.main()
