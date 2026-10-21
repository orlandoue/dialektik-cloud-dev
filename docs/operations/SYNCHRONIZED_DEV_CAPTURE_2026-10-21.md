# Same-MVCC-state DEV capture, 2026-10-21

The earlier DEV backup is **restorable** but independently captured Supabase CLI dumps were not bound to a single PostgreSQL MVCC snapshot.

The new protected capture opens one read-only REPEATABLE READ transaction and exports the snapshot identifier, then six pg_dump clients use the same --snapshot value. It captures public full schema/data and data-only Auth, supabase_migrations, Storage, Realtime and Vault. It uses the same verified DEV pooler identity, explicit verify-full TLS certificate pin and PostgreSQL 17 client as the proven backup capture. All output is GPG AES256 encrypted before GitHub upload; only selected expected encrypted files may become an artifact.

**Limits:** this is a synchronized database row-data copy, not yet a certified complete operational recovery. PostgreSQL role globals and server settings are NOT synchronized by MVCC; external Storage objects and Auth service configuration are NOT included. Even if capture succeeds, a new authentic isolated replay, API Auth login and role cutover validation are still necessary. Retention inside GitHub is not independent off-site custody.

The actual acquisition workflow remains opt-in: it triggers only on the protected recovery branch, protected GitHub environment dialektik-dev-backup, and exact signed marker EXECUTE_SYNCHRONIZED_DEV_DATA_CAPTURE_20261021. The static CI and feature branch never connect to DEV or use secrets. No writes, no historical migration changes, no Article 043/044 and no writer LOGIN.
