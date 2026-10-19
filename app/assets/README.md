# Asset infrastructure

Only `asset_catalog.json` is bundled in Phase 0. It records availability and
prevents a missing source from being mistaken for a loadable asset.

- `brand/` remains empty because `dialektik-master.svg` is an external blocker.
- `icons/` remains empty because functional icons come from `phosphor_flutter`.
- `placeholders/` and `backgrounds/` remain empty until their authoritative
  geometry is complete enough to produce without interpretation.
- `media/` and `illustrations/` are empty by design.

No Flutter-logo or approximate Dialektik branding belongs in these directories.
