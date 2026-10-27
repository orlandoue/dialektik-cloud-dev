# Realtime 91 target pin — protected full restore preflight

The authentic synchronized backup [39722488573](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39722488573) already restores application, Auth and Storage, but stopped before touching Realtime data: local Supabase CLI 2.120.0 seeds only 88 migration versions, while the protected archive holds 91. **Never invent three missing migrations or silently exclude them.**

Independent, no-secret, synthetic [local compatibility CI 39819605174](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39819605174) found pinned **Supabase CLI 2.121.0** seeds **91 Realtime migration versions**, 82 Auth migrations and the same 10 managed Storage tables. The preceding version 2.120.0 reproducibly seeded 88. This proves matching counts, **not identical version identifiers**.

This branch updates only the five references to the CLI version in the protected genuine restore workflow, including cleanup/retry, retaining exact owner authorization marker, protected environment, disconnected Docker network before any ciphertext is downloaded, and full Auth, Storage, Realtime, Vault, RLS, rollback and synthetic GoTrue checks. A separate synthetic-only CI asserts all those invariant checks.

The **next authentic offline replay must compare all 91 Realtime migration version identifiers exactly**, before excluding its single preseeded ledger COPY entry. A count-only match does not authorize restoring protected data or bypassing a mismatch. If a version differs, fail closed and provide only a non-identifying count/category. No remote DEV DDL/DML, no Render deploy or migration 043/044.
