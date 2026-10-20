import unittest
from classify_private_restore_error import category

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
    def test_fail_closed_on_empty_or_unknown(self):
        self.assertEqual(category(""),"NO_REDACTED_LOG_CAPTURED")
        self.assertEqual(category("return code 1"),"UNKNOWN_NON_SQL_FAILURE")
        self.assertEqual(category("ERROR: something not recognized"),"UNKNOWN_SQL_FAILURE")

if __name__=="__main__":
    unittest.main()
