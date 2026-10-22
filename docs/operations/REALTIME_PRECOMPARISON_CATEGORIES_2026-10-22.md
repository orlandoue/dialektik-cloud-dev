# Realtime pre-comparison failure classifier — October 22, 2026

The authentic offline replay [39721467833](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39721467833) restored Auth, application, and Storage. It failed on Realtime 91-version comparison *before* emitting the previously added version set differences. The cause could be local migration count divergence, duplicate/invalid COPY, or source serialization; a version-set mismatch is NOT yet established.

This helper reports strictly allowlisted, fixed parser failure class names; if valid target rows are not 91, it may additionally report **only the bounded integer count** 0..200, never raw version IDs, timestamps, SQL or user rows. The source archive, exact-match requirement, and protected no-network workflow remain unchanged. Do not skip or rewrite Realtime history, or claim full recovery, until lineage compatibility is proved.
