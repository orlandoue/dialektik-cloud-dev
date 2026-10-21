# RESTORE-GATE: allowlisted managed-schema first COPY diagnosis (2026-10-21)

Protected authentic fourth replay [39647607914](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39647607914) reached actual application COPY with first SQL error DUPLICATE_KEY and first COPY scope OTHER_MANAGED_COPY.

Auth replay, exact original archive 82-version equality, application migration ledger, role privileges and schema all passed. Cleanup passed. This only establishes a generic managed schema, NOT table content equivalence or permission to omit any data.

The parser returns one of OTHER_AUTH_COPY, OTHER_STORAGE_COPY, OTHER_REALTIME_COPY, OTHER_SUPABASE_MIGRATIONS_COPY for a non-ledger COPY, else fixed legacy categories. Only Supabase's well-known built-in schema names are distinguished; arbitrary table and column identifiers, SQL and row values remain suppressed.

No backup is decrypted by this branch CI. The protected script still aborts on the first failed COPY. An additional owner-authorized isolated replay is needed to classify the true source schema. Once known, table-specific exact equality/replay compatibility must be independently proven before considering data reconciliation. No remote DEV writes or writer activation.
