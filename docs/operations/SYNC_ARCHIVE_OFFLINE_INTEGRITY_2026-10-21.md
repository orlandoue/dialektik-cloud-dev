# Independent offline verification of the synchronized DEV encrypted artifact

Captured data artifact from actual protected run 39671122200 (ID 12380605449) spans six schema scopes with one exported MVCC snapshot and GPG AES256. This new independent verification:
- downloads only that exact existing encrypted GitHub artifact;
- decrypts in a protected transient runner without a DEV database connection;
- parses a strict exact nine-file tar allowlist, rejects non-files/symlinks and unexpected paths;
- recalculates every SHA-256 from the manifest and requires the snapshot scope declarations;
- verifies native PostgreSQL 17 pg_restore catalogs for all six archives in networkless containers and rechecks 27 managed Auth tables plus the migration history archive;
- never prints or uploads data records, hashes, Auth IDs, SQL, or passphrases;
- securely discards temporary decrypted files.

This is NOT full database restore verification; no transactional replay of the new public/full and managed archive together is performed here. Globals, Auth runtime configuration, Storage binaries and a live Core credential cutover remain separate acceptance obligations. Existing authentic legacy backup has been fully restored including isolated GoTrue synthetic login; this new synchronized capture requires its own restoration gate before any release claim.
