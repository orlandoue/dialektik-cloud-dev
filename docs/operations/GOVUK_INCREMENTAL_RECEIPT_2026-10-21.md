# GOV.UK incremental read-only CI snapshots — 2026-10-21

Scope: strictly read-only change classification for two official GOV.UK publishers.
Before this change, every discovery classified all candidates as NEW against
an empty previous array. Now the GitHub workflow looks up the latest successful
run of its own branch/workflow, downloads its retained two-publisher receipt,
validates the exact publisher identities, canonical URLs, SHA256 metadata
hashes and provenance-free comparison fields, then derives NEW/UPDATED/UNCHANGED.

FIRST run has comparisonMode BOOTSTRAP_UNVERIFIED_HISTORY. Subsequent successful
CI runs have PREVIOUS_SUCCESSFUL_CI_SNAPSHOT, so NEW means absent from the
immediate previous capped search snapshot, not newly published globally.
Both modes explicitly have publicationFreshnessEstablished=false and
completeHistoricalLedger=false. If a prior successful run's artifact has
expired, is malformed, or exceeds 3 days, the workflow fails closed.

Run concurrency is serialized on the branch, with actions:read only.
No full text is copied. No database URL/token is supplied. Cron remains
disabled until the workflow exists in the default branch and the operator
specifically enables its variable. The artifact expires after 3 days;
it is a bounded temporary comparison and not a persistence substitute.

RESTORE-GATE #4 remains NO_GO and semantic generation remains prohibited.
