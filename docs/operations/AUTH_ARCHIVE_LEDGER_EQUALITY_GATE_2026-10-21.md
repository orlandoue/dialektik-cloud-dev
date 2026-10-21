# Auth migration archive equality gate — 21 October 2026

The real protected replay failed at `RESTORE_MANAGED_AUTH_DATA`, with the native Auth migration ledger a plausible **unproven** duplicate cause. DEV and a seeded local target each contain 82 Auth migration versions, but that does not prove the original **archive** has the same set.

This branch implements an **independent, fail-closed exact-set comparison** for the native `pg_restore` `COPY auth.schema_migrations (version)` payload from an allowed 27-table Auth archive. It never logs individual versions or their fingerprints. CLI commands:

```text
python3 scripts/operations/auth_archive_ledger_gate.py prepare --toc-in auth.toc --toc-out auth-migration-only.toc
pg_restore --data-only --use-list auth-migration-only.toc --file auth-versions.sql managed-auth.dump
psql -XAt -c 'select version from auth.schema_migrations order by version' > seeded-target-versions.txt
python3 scripts/operations/auth_archive_ledger_gate.py compare --archive-sql auth-versions.sql --target-versions seeded-target-versions.txt
```

All input and output above MUST remain inside an approved isolated runner with the original authenticated ciphertext and zero network interfaces attached to the database. The `prepare` command checks exact count of 27 Auth TABLE DATA entries and selects only the Auth migration table. The `compare` command requires exactly 82 unique numerical versions in both extracts and equality of the complete sets.

**This branch only tests on 27 synthetic tables/82 fake versions using native PostgreSQL17 pg_dump+pg_restore, with negative tests.** It does not use or decrypt the real ciphertext, modify the protected replay workflow, restore personal Auth data, skip source migrations, apply 043/044, or activate writers.

After independent review, this check can be added immediately before the protected Auth restore attempt; only a real archive-target equality PASS can authorize the separately reviewed 26-table derived TOC mechanism. R0 still requires application ledger/data and login/ACL/rollback and backup consistency before any writer activation.
