# Supabase 2.121.0: synchronized recovery compatibility contract

## Evidence
- Protected real-data replay 39722488573 (source synchronized backup): public/Auth/app/Storage PASS; Realtime failed closed because source migration count 91, local Supabase 2.120.0 target 88.
- Synthetic clean target with Supabase CLI 2.121.0: Realtime 91, Auth 82, Storage 75, PostgreSQL 17 and exactly 10 managed Storage tables. It is a newer target; not an exact physical clone.
- Previous source Storage ledger: 74 migration IDs/names/hashes; timestamps differ. No other source Storage tables hold rows.

## Scoped changes
- Pin CLI 2.121.0 in the protected offline restore workflow, not in the Render deployment.
- Retain all 74 original Storage ID/name/hash triplets, and accept at most one extra local migration whose integer ID is strictly newer and whose SHA-1 signature is well-formed. Missing/replaced/modified source versions and more than one extra are hard failures.
- Preserve the target's preseeded Storage ledger unchanged and omit only that identical/forward-compatible `TABLE DATA storage migrations` entry from a temporary pg_restore TOC. Do not modify the source backup, insert history or ALTER managed schema.
- Continue to require exact Realtime **version SET equality** (not only count), RLS and Auth API, role and rollback checks, and no Docker network interfaces before opening ciphertext.

## Remaining gaps / explicit gates
- 7 synthetic negative/positive unit tests passed, including future count 75, changed hash/name, missing rows, duplicate or older additional ID.
- **No genuine offline backup replay has been performed with this branch.** It needs a newly authorized protected run after independent code review; do not infer that the extra Storage migration is compatible with all service versions merely from counts.
- Vault table ownership, external Storage file objects, historical execution timestamps and live Render credential rotation remain outside the proven acceptance set.
- This work does NOT activate 043/044, writer LOGIN, scheduled Chilean acquisition, semantic event grouping or public contradicton claims.

## Parallel launch
- The real Render API has independent read-only beta smoke PASS (39726448110). Beta Android invite expansion may proceed after signed APK, privacy/onboarding, login/revocation and support readiness from the separate product checkout. This workstream must not be blocked by unrelated optional public-release features.