import unittest
from auth_data_copy_equivalence import remove_proven_identical_auth_copies, GateFailure

A = (
    "-- general header\n"
    "COPY auth.users (id, email) FROM stdin;\n"
    "a1\tprivate-user@example.invalid\n"
    "a2\tsecond-user@example.invalid\n"
    "\\.\n"
    "\n"
    "COPY public.sources (id, name) FROM stdin;\n"
    "source-1\tPUBLIC RECORD\n"
    "\\.\n"
)
B = (
    "-- archived original auth\n"
    "COPY auth.users (id, email) FROM stdin;\n"
    "a2\tsecond-user@example.invalid\n"
    "a1\tprivate-user@example.invalid\n"
    "\\.\n"
)


class ExactAuthCopyGate(unittest.TestCase):
    def fail_code(self, general, archive, expected):
        with self.assertRaises(GateFailure) as context:
            remove_proven_identical_auth_copies(general, archive)
        self.assertEqual(context.exception.code, expected)
        self.assertNotIn('private-user@example.invalid', context.exception.code)

    def test_exact_records_in_any_order_and_preserve_public_copy(self):
        out, count=remove_proven_identical_auth_copies(A, B)
        self.assertEqual(count, 1)
        self.assertIn('COPY public.sources', out)
        self.assertIn('source-1\tPUBLIC RECORD', out)
        self.assertNotIn('COPY auth.users', out)
        self.assertNotIn('private-user@example.invalid', out)

    def test_mutated_auth_row_must_fail_closed(self):
        self.fail_code(A.replace('a1\tprivate-user@example.invalid',
                                 'a1\tchanged-email@example.invalid'),
                       B, 'AUTH_COPY_ROWS_NOT_IDENTICAL')

    def test_archive_missing_auth_table_rejected(self):
        self.fail_code(A, "COPY auth.sessions (id) FROM stdin;\ns1\n\\.\n",
                       'AUTH_COPY_NOT_COVERED_BY_ARCHIVE')

    def test_different_auth_columns_rejected(self):
        x=B.replace('(id, email)', '(email, id)')
        self.fail_code(A, x, 'AUTH_COPY_COLUMNS_NOT_IDENTICAL')

    def test_duplicate_general_auth_table_rejected(self):
        self.fail_code(A+B, B, 'AUTH_COPY_TABLE_REPEATED')

    def test_general_without_auth_copy_rejected(self):
        self.fail_code('COPY public.sources (id) FROM stdin;\ns1\n\\.\n',
                       B, 'AUTH_GENERAL_DUMP_HAS_NO_AUTH_COPY')

    def test_unterminated_copy_never_emits_partial_output(self):
        self.fail_code('COPY auth.users (id, email) FROM stdin;\na1\\tprivate\n',
                       B, 'AUTH_COPY_TERMINATOR_MISSING')

    def test_archive_non_auth_copy_rejected(self):
        self.fail_code(A, B+'COPY public.sources (id) FROM stdin;\ns1\n\\.\n',
                       'AUTH_ARCHIVE_CONTAINS_NON_AUTH_COPY')

    def test_auth_sequence_equal_proven_before_removal(self):
        line="SELECT pg_catalog.setval('auth.refresh_tokens_id_seq', 2, true);\n"
        out, count=remove_proven_identical_auth_copies(A+line,B+line)
        self.assertEqual(count, 1)
        self.assertNotIn("refresh_tokens_id_seq",out)

    def test_auth_sequence_different_fails_closed(self):
        good="SELECT pg_catalog.setval('auth.refresh_tokens_id_seq', 2, true);\n"
        bad="SELECT pg_catalog.setval('auth.refresh_tokens_id_seq', 5, true);\n"
        self.fail_code(A+bad,B+good,'AUTH_SEQUENCE_VALUES_NOT_IDENTICAL')

    def test_multiple_auth_tables_preserved_if_copies_identical(self):
        extra="COPY auth.sessions (id) FROM stdin;\nkey-1\n\\.\n"
        out, count=remove_proven_identical_auth_copies(A+extra,B+extra)
        self.assertEqual(count,2)
        self.assertNotIn("auth.sessions",out)

    def test_malformed_copy_fails_closed(self):
        self.fail_code(A.replace('COPY auth.users (id, email) FROM stdin;',
                       'COPY auth.users FROM stdin;'),
                       B,'AUTH_COPY_UNRECOGNIZED_STATEMENT')

    def test_duplicate_row_multiset_matters(self):
        longer=A.replace('a2\tsecond-user@example.invalid\n',
                          'a1\tprivate-user@example.invalid\n')
        self.fail_code(longer,B,'AUTH_COPY_ROWS_NOT_IDENTICAL')


if __name__=="__main__":
    unittest.main()
