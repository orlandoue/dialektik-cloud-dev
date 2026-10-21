import unittest
from classify_private_restore_error import category, parameter_marker, safe_report

class PrivateRestoreDiagnosis(unittest.TestCase):
    def test_duplicate_role_does_not_reveal_role_name(self):
        self.assertEqual(category('psql:file.sql:19: ERROR: role "private_person" already exists'),
                         "EXISTING_ROLE_COLLISION")
    def test_missing_role(self):
        self.assertEqual(category("psql:file.sql:17: ERROR: role \"secret_role\" does not exist"),
                         "MISSING_DEPENDENT_ROLE")
    def test_config_permission(self):
        self.assertEqual(category("ERROR: permission denied to set parameter \"log_min_messages\""),
                         "PARAMETER_PERMISSION")
    def test_generic_permission(self):
        self.assertEqual(category("ERROR: permission denied for schema private"),
                         "INSUFFICIENT_PRIVILEGE")
    def test_ambiguous_multiple_errors(self):
        self.assertEqual(category("ERROR: permission denied\nERROR: role \"x\" already exists"),
                         "MULTIPLE_INCOMPATIBLE_CATEGORIES")
    def test_parameter_name_allowlisted_only(self):
        log='ERROR: permission denied to set parameter "log_min_messages"'
        self.assertEqual(parameter_marker(log),"LOG_MIN_MESSAGES")
        self.assertEqual(safe_report(log)["REDACTED_POSTGRES_PARAMETER"],"LOG_MIN_MESSAGES")

    def test_other_parameter_never_leaks_name_or_content(self):
        log='ERROR: permission denied for parameter "private_sensitive_variable"'
        self.assertEqual(parameter_marker(log),"NON_ALLOWLISTED_PARAMETER")
        self.assertNotIn("private_sensitive_variable",repr(safe_report(log)))

    def test_parameter_not_in_message_fails_closed(self):
        self.assertEqual(parameter_marker("ERROR: permission denied to set parameter"),"UNAVAILABLE")
        self.assertEqual(parameter_marker("ERROR: permission denied for schema private"),"NOT_APPLICABLE")

    def test_client_min_messages_known_safe_category(self):
        self.assertEqual(parameter_marker("ERROR: permission denied to set parameter client_min_messages"),
                         "CLIENT_MIN_MESSAGES")

    def test_auth_data_duplicate_key_redacts_identifier(self):
        raw='pg_restore: error: COPY failed for table "secret_auth_table": ERROR: duplicate key value violates unique constraint "private_key"'
        self.assertEqual(category(raw),"AUTH_DATA_DUPLICATE_KEY")
        self.assertNotIn("secret_auth_table",repr(safe_report(raw)))

    def test_auth_data_foreign_key(self):
        self.assertEqual(category('pg_restore: error: COPY failed: ERROR: insert or update on table "x" violates foreign key constraint "y"'),"AUTH_DATA_FOREIGN_KEY")

    def test_auth_data_missing_relation(self):
        self.assertEqual(category('pg_restore: error: could not execute query: ERROR: relation "private.x" does not exist'),"AUTH_DATA_RELATION_MISSING")

    def test_auth_data_null_constraint(self):
        self.assertEqual(category('ERROR: null value in column "id" violates not-null constraint'),"AUTH_DATA_NULL_CONSTRAINT")

    def test_auth_data_bad_value(self):
        self.assertEqual(category('ERROR: invalid input syntax for type uuid: "never_expose_value"'),"AUTH_DATA_INVALID_VALUE")
        self.assertNotIn("never_expose_value",repr(safe_report('ERROR: invalid input syntax for type uuid: "never_expose_value"')))

    def test_auth_data_column_count_mismatch(self):
        self.assertEqual(category('pg_restore: error: COPY failed: ERROR: extra data after last expected column'),"AUTH_DATA_COLUMN_MISMATCH")

    def test_auth_data_multiple_errors_is_unknown_safe(self):
        self.assertEqual(category('ERROR: duplicate key value violates unique constraint\nERROR: violates foreign key constraint'),"MULTIPLE_INCOMPATIBLE_CATEGORIES")

    def test_fail_closed_on_empty_or_unknown(self):
        self.assertEqual(category(""),"NO_REDACTED_LOG_CAPTURED")
        self.assertEqual(category("return code 1"),"UNKNOWN_NON_SQL_FAILURE")
        self.assertEqual(category("ERROR: something not recognized"),"UNKNOWN_SQL_FAILURE")

if __name__=="__main__":
    unittest.main()
