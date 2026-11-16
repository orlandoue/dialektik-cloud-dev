# Dialektik Flutter application

This directory contains the Flutter private-beta reader, including Supabase
authentication, live headline links, the source directory, Events and
Contradictions. RSS previews show publisher headlines and original links without
persisting article bodies or creating semantic results.

See the repository-level `README.md` for bootstrap, quality, specification
authority, and blocker information. Start Flutter work from `app/AGENTS.md` and
use `docs/SPEC_INDEX.md` to load only the relevant API/UX/design/accessibility
sources.

## Android signing

Debug builds use the local Android debug key. Release builds require a real
keystore supplied outside the repository through these environment variables:

- `DIALEKTIK_ANDROID_KEYSTORE_PATH`
- `DIALEKTIK_ANDROID_KEYSTORE_PASSWORD`
- `DIALEKTIK_ANDROID_KEY_ALIAS`
- `DIALEKTIK_ANDROID_KEY_PASSWORD`

Release tasks fail if any value is missing. Never commit keystores or passwords;
use a stable, protected signing key for updates to installed production builds.
