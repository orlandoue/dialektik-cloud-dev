import unittest
from inspect_role_guc_shape import bounded_shapes

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

    def test_no_matching_parameter(self):
        parsed=bounded_shapes("CREATE ROLE anon;")
        self.assertEqual(sum(parsed.values()),0)

if __name__=="__main__":unittest.main()
