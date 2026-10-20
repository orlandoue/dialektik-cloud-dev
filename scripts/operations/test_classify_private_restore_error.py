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

    def test_fail_closed_on_empty_or_unknown(self):
        self.assertEqual(category(""),"NO_REDACTED_LOG_CAPTURED")
        self.assertEqual(category("return code 1"),"UNKNOWN_NON_SQL_FAILURE")
        self.assertEqual(category("ERROR: something not recognized"),"UNKNOWN_SQL_FAILURE")

if __name__=="__main__":
    unittest.main()
