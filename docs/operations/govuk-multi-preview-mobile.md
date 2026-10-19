# Dialektik — GOV.UK multi-publication read-only pilot

- Core DEV: authenticated GET `/live/preview/govuk` returns up to 7 strictly allowlisted official RSH GOV.UK news releases, sorted by publication date.
- Sources: UK government official Content API; identity, publisher, schema, dates, robots.txt and source rights gate remain enforced server side; no fulltext body returned.
- Mobile: compact GOV.UK headlines inside **Actualidad**, external links per item, one attribution and visible "vista previa" / nonpersisted disclaimer. Not the authoritative persistent Article list.
- Scope: private beta only; `DIALEKTIK_GOVUK_PREVIEW_ENABLED` remains explicitly required on Core, flag compiled only for the DEV APK.
- Verified: Core independent official API smoke succeeded on GitHub Actions run 39336327913 with `OFFICIAL_VERIFIED_ITEM_COUNT=7`, `PERSISTENCE=NONE`, `FULLTEXT_RETURNED=NO`.
- Still pending: actual Android pilot screenshot of multiple headlines. Supabase backup has passed decryption and hash tests, but full managed-platform restore remains blocked; do not apply migrations 043/044 or persist news before the restore gate and an independently scoped approval.

Preview is not Chilean news acquisition, does not imply that 50 inventoried Chilean media have rights approval, and is not an event clustering demonstration.
