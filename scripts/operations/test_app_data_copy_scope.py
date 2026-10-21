import unittest
from app_data_copy_scope import first_duplicate_copy_scope

PATH = "psql:/tmp/dialektik_restore_real/data.sql:"
ERROR = ' ERROR: duplicate key value violates unique constraint "secret_index"'
def error_at(n, message=ERROR):
    return PATH+str(n)+":"+message

class ApplicationCopyScopeRedaction(unittest.TestCase):
    def test_public_copy_redacts_row_and_table(self):
        sql='-- source\nCOPY public.secret_people (id,name) FROM stdin;\n1\tPRIVATE PERSON\n\\.\n'
        result=first_duplicate_copy_scope(error_at(4),sql)
        self.assertEqual(result,"APPLICATION_PUBLIC_COPY")
        self.assertNotIn("secret_people",result)
        self.assertNotIn("PRIVATE PERSON",result)

    def test_storage_and_realtime_ledgers_are_hypotheses_not_skip_permission(self):
        self.assertEqual(first_duplicate_copy_scope(error_at(3),
            'COPY storage.migrations (id) FROM stdin;\n17\n\\.\n'),
            "MANAGED_MIGRATION_LEDGER_CANDIDATE")
        self.assertEqual(first_duplicate_copy_scope(error_at(3),
            'COPY "realtime"."schema_migrations" (version) FROM stdin;\n17\n\\.\n'),
            "MANAGED_MIGRATION_LEDGER_CANDIDATE")
        self.assertEqual(first_duplicate_copy_scope(error_at(3),
            'COPY auth.users (id) FROM stdin;\n17\n\\.\n'),
            "OTHER_MANAGED_COPY")

    def test_first_error_only_never_overridden_by_second_failure(self):
        raw=error_at(2)+"\n"+error_at(5)
        sql=('COPY public.secret_one (id) FROM stdin;\n1\n\\.\n'
             'COPY storage.migrations (id) FROM stdin;\n1\n\\.\n')
        self.assertEqual(first_duplicate_copy_scope(raw,sql),"APPLICATION_PUBLIC_COPY")

    def test_no_arbitrary_error_or_nonduplicate_classification(self):
        sql='COPY public.anything (id) FROM stdin;\n1\n\\.\n'
        self.assertEqual(first_duplicate_copy_scope('ERROR: private error',sql),
            "FIRST_ERROR_LOCATION_UNAVAILABLE")
        self.assertEqual(first_duplicate_copy_scope(
            error_at(3,' ERROR: violates foreign key constraint "secret"'),sql),
            "FIRST_ERROR_NOT_DUPLICATE_KEY")

    def test_unknown_copy_syntax_and_no_copy_fail_closed(self):
        self.assertEqual(first_duplicate_copy_scope(error_at(2),
            'COPY "private;content" (id) FROM stdin;\n1\n\\.\n'),
            "FIRST_ERROR_OUTSIDE_COPY")
        self.assertEqual(first_duplicate_copy_scope(error_at(9),
            'COPY public.anything (id) FROM stdin;\n1\n'),
            "FIRST_ERROR_COPY_UNRESOLVED")
        self.assertEqual(first_duplicate_copy_scope(error_at(2),
            "INSERT INTO public.anything values (1);\n"),
            "FIRST_ERROR_OUTSIDE_COPY")

    def test_other_schema_never_prints_name(self):
        got=first_duplicate_copy_scope(error_at(3),
            'COPY secret_internal.private_table (secret) FROM stdin;\nanything\n\\.\n')
        self.assertEqual(got,"OTHER_OR_UNSUPPORTED_SCHEMA_COPY")
        self.assertNotIn("secret_internal",got)
        self.assertNotIn("private_table",got)

if __name__=="__main__":
    unittest.main()
