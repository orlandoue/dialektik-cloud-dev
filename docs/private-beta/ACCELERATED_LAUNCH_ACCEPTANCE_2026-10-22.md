# Dialektik: beta readiness and accelerated distribution (2026-10-22)

## Truthful current positioning
Private Android beta with an authenticated, manually curated Chilean multi-publisher event and an independent read-only GOV.UK metadata preview. This is **not** an autonomous Chilean news feed, persisted semantic event grouping, or contradiction engine.

Render Core DEV runs on Free with one instance; the existing private-beta tester ledger restricts API access. Supabase DEV has zero persisted sources, articles, events and acquisition receipts, and writer NOLOGIN. The app's Flutter checkout and its APK are separate from this cloud-only repository; this PR cannot certify Android release signing or users' sessions.

## Minimum gate for the next 20 invited beta testers
- Core live and database ready 200; unauthenticated feed, contradictions, news and editorial preview all 401.
- Real Android signed-release APK hash/provenance and install/uninstall test on at least two devices (must be attested from the product checkout).
- Tested sign-in, sign-out, crash logging without secrets, invite revocation, a clear Private Beta/Editorial Preview label, and privacy/support contact before inviting anyone.
- Invite people only with consent; maintain a revocable ledger and record feedback without collecting passwords.
- No public self-registration before rate limiting, abuse controls and RLS re-audit.

## Separate gate for public automatic-news claims
- Permission/rights for multiple Chilean editorial sources and repeatable metadata acquisition into real database with idempotent receipts.
- Reliable independent event grouping with false-merge precision/abstention tests, real provenance and traceable contradictions.
- Safe backup recovery + roles, migrations 043/044 and an auditable writer, then monitored rollout.

## Wording allowed now
Dialektik, beta privada: exploramos cómo contrastar distintas fuentes que cubren un mismo acontecimiento y conocer su procedencia. Estamos incorporando fuentes verificadas y validando el análisis automático.

Do not claim realtime AI contradiction detection or nationwide live coverage; neither is proved.

This branch performs read-only public GET requests only; it does not deploy Render, change Supabase, send notifications, invite users or publish an APK.