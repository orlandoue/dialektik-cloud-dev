# One PostgreSQL exported snapshot for application + Auth + ledger

Prior actual protected recoveries [39651747003](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39651747003) and [39665084546](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39665084546) verify that the multi-export archive is **restorable**. They do **not** prove all independent exports used a single point-in-time consistent database snapshot.

This independent branch demonstrates an authentic PostgreSQL primitive using **only fabricated data**:
- One transaction starts at REPEATABLE READ READ ONLY and exports `pg_export_snapshot()`.
- Three separate `pg_dump --snapshot=ID` sessions capture application, Auth and migration history against the same snapshot.
- Source tables receive writes between exporting and dumping to simulate actual concurrency.
- Another disposable database receives each archive, and all restored tables contain the **pre-write** rows; current source contains the **post-write** rows.
- Docker has **no network** and none of the existing encrypted backup or production database credentials are used.

This proves the required PostgreSQL mechanism, **not** a single consistent 2026-10-20 capture. A real protected capture must use `pg_dump --snapshot` across all relevant data objects, guard TLS/target identity, extension/custom objects and restore compatibility, include all Auth/ledger data, role grants and a signed manifest, and store only encrypted outputs. It must be followed by a full isolated genuine replay and Auth API proof. Supabase CLI multiple `db dump` commands do not currently supply a common exported snapshot in the original protected workflow. A separate role/global grant export cannot automatically claim MVCC synchronization.

Supabase managed physical backups/PITR may provide a simpler verified route if the plan and owner's budget permit. No extra Supabase project or bill has been created.
