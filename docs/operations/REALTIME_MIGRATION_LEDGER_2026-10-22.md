# Realtime migration ledger strict compatibility - 2026-10-22

The sixth authentic disconnected restore run 39718242474 recovered Auth, public application, and Storage successfully but stopped on Realtime with first error category AUTH_DATA_DUPLICATE_KEY. This does not by itself prove the conflicting row is the migration ledger.

DEV read-only: realtime.schema_migrations(version bigint, inserted_at timestamp) contains 91 entries. The script selects only this table data COPY from the encrypted archive with a strict TOC and compares exactly 91 unique versions against the seeded target. Only if the entire version set matches can it exclude precisely that single ledger COPY from a derived TOC. All other Realtime COPYs remain and have normal transaction failure behavior. Source inserted_at timestamps are not recreated: the result explicitly declares that limitation.

Any missing/additional/changed version, unexpected schema COPY or malformed row is NO_GO. No original backup bytes, remote SQL, secrets, grants or user data are altered by this feature branch. The real replay requires the separately authorized GitHub protected-environment flow and a distinct approval marker.
