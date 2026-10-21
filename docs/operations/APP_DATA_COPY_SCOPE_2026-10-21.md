# RESTORE-GATE: structural first COPY error scope (2026-10-21)

The protected authentic replay [39557506837](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39557506837) reached `RESTORE_MANAGED_AUTH_DATA=PASS`, exact 82 Auth-version equality PASS and application migration ledger PASS, then failed first application `data.sql` COPY with `AUTH_DATA_DUPLICATE_KEY`. The failing relation was **not** established. A prior strategy of speculatively skipping internal history was rejected.

Supabase documentation confirms `supabase db dump --data-only` excludes managed schemas by default, notably Auth and Storage. Accordingly a Storage seed collision is **only a hypothesis**, not a justified fix. See https://supabase.com/docs/reference/cli/introduction and https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore .

This patch builds a structural diagnostic that accepts *only* the first `psql:/tmp/dialektik_restore_real/data.sql:<line>: ERROR: duplicate key...` and compares the internally reported source line number to an explicitly bounded native PostgreSQL `COPY ... FROM stdin;` block. It emits exactly one fixed, nonidentifying scope:

- `APPLICATION_PUBLIC_COPY`;
- `MANAGED_MIGRATION_LEDGER_CANDIDATE`;
- `OTHER_MANAGED_COPY`;
- `OTHER_OR_UNSUPPORTED_SCHEMA_COPY`;
- an explicit non-attributable or fail-closed state.

No field names, table names, raw SQL, values, personal data, line numbers or identifiers leave the protected runner. A positive system-ledger classification is **NOT** authorization to skip, truncate or overwrite that ledger. Exact complete source/target table-row equality and downstream validation would still be necessary.

This branch intentionally **does not decrypt authentic data**, modify production/DEV, or change the protected restore script. CI proves structural mapping/redaction on fake inputs and networkless PostgreSQL 17.11 native `pg_dump`/`psql` syntax, with atomic rollback. A separate gated integration/replay review is required before using it against the real backup.
