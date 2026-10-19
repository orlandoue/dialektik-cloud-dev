# Flutter application scope

Follow the root [`AGENTS.md`](../AGENTS.md). This file adds rules only for
`app/`; do not load SQL migrations for a Flutter-only task unless the task
explicitly crosses the persistence boundary.

## Local authority

Use [`docs/SPEC_INDEX.md`](../docs/SPEC_INDEX.md) to select the affected sources:

- `API_SPEC_v1.md` for client-visible DTOs, absent fields, and request behavior.
- UX Flows and the product Architecture Decision for navigation and surfaces.
- Design System, Component Library, Surface/Color, and Accessibility specs for
  only the components/tokens being changed.
- State Matrix when rendering state; keep all seven dimensions independent.
- `QA_SPEC_v1.md` for Flutter acceptance, accessibility, and design prohibitions.
- `docs/architecture/Dialektik_OD_12_Moderation_Authority_Decision_v1.md`
  for the internal Phase-6 moderator/editor interaction boundary.

Do not use database types or migrations as the public client contract.

## Owned paths

- `lib/app/`: bootstrap, shell, routing/composition when authorized.
- `lib/core/`: client infrastructure and accessibility foundations.
- `lib/design_system/`: tokens, themes, components, assets, and safety checks.
- `lib/shared/`: semantics-free shared primitives.
- `assets/`: approved asset catalog and delivered assets only.
- `test/`: unit/widget and negative invariant fixtures.
- `tool/`: deterministic Flutter quality and safety commands.

## Local rules

- Flutter lives here; keep product UI out of backend/database packages.
- Public UI follows current Design System, UX, API, and accessibility authority.
- Never imply epistemic meaning through color, opacity, size, weight, order,
  count, animation, elevation, or prominence.
- The seven public no-conclusions from the Architecture Decision remain
  mandatory; do not soften or replace them.
- Categories are discovery/navigation, not epistemic filters or quality labels.
- Render `ClaimSpan`, `Assertion`, and `ClaimInterpretation` according to their
  exact roles; an interpretation is never a source quote.
- Do not expose internal scores, projection ratios, third-party evaluations, or
  evidence/source-volume shortcuts.
- The client never gains unrestricted authoritative database writes. Use
  public/Core API contracts, not Supabase table APIs or database internals.
- Preserve offline/cache-ready boundaries when data repositories and caching
  are implemented; UI widgets must not become persistence owners.
- Do not fabricate missing brand assets. `dialektik-master.svg` remains external.
- Product screens and Phase 2 work require an approved active execution plan.

## Focused commands

From the repository root:

```powershell
npm run quality:flutter
```

From `app/` while iterating:

```powershell
flutter pub get
dart format --output=none --set-exit-if-changed lib test tool
flutter analyze
flutter test --test-randomize-ordering-seed=0
dart run tool/check_design_invariants.dart
dart run tool/quality.dart
```

Never weaken invariant fixtures or accessibility assertions to make a widget
pass. Escalate to root authority when a UI request changes an API field,
epistemic presentation rule, no-conclusion, or undefined product behavior.
