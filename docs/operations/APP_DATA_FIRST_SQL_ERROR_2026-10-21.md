# Application data restore: first error isolation and atomic rollback — 2026-10-21

Protected **authentic** isolated replay [39553386507](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39553386507) restored roles, privileged parameter grant, schema, **82/82 Auth ledger equality**, 26 managed Auth data tables and the 50-entry application migration ledger: all PASS.

The next step `RESTORE_APPLICATION_DATA` FAILED. The old classified output was only `MULTIPLE_INCOMPATIBLE_CATEGORIES`: scanning a whole verbose private `psql` transcript with broad regexes is not enough to identify the first SQL error and must not be interpreted as evidence of several separate root causes.

This branch adds `first_sql_error_category`, which emits ONE **fixed** public classification for the first `ERROR:`/`FATAL:` diagnostic line in the private log and ignores other diagnostic content. Raw logs, schema/table names, row bodies, credentials, values, SQL, line numbers and content hashes must never be exported. Original full-log classifier remains unchanged for comparison. On the same failure, `psql --single-transaction` rolls back this entire application data stage in the disposable isolated target; no remote write.

CI runs synthetic fake SQL through a PostgreSQL 17 networkless container to prove rollback and safe classification, and negative unittest fixtures containing fake secrets. **This does not rerun the real Auth backup**. Another real run would require renewed and explicit owner authorization and the environment's protections. Recovery Gate #4 remains NO_GO; do not enable writer/migrations or live ingestion.

Caution: First error may still be unrecognized or not the only data inconsistency. Do not auto-repair from a category; investigate with carefully limited offline diagnostics and preserve the original source backup immutable.
