# Dialektik DEV — password recovery rollout

## Scope

Isolated change to the existing Core service: public HTTPS page
`GET /auth/recover` on `https://dialektik-core-dev.onrender.com`.
No database migrations, user deletions, password changes, or migration
history updates. This does not change the Flutter APK.

## Deployment prerequisites

1. Confirm `codex/secure-password-recovery-20261019` CI SUCCESS and review the PR.
2. In the protected Render environment editor for **dialektik-core-dev**, set
   `DIALEKTIK_SUPABASE_PUBLISHABLE_KEY` to the **DEV project's**
   `sb_publishable_...` key. Never set service_role, secret API keys,
   database credentials, or any Auth admin tokens in the web page.
   This publishable key is intentionally sent to browser clients.
3. Merge only the reviewed recovery changes to
   `codex/v7i-operational-product-pipeline`, the live Render autodeploy
   branch, after explicit approval. Confirm build, /health/live and
   /health/ready are both 200.
4. Confirm the recovery endpoint responds 200 over HTTPS and has
   Cache-Control: no-store, Referrer-Policy: no-referrer, nonce-based CSP.
   If the publishable key is missing/invalid, this endpoint responds 503.
5. **Supabase Dashboard > Authentication > URL Configuration**:
   add this **exact** allowed redirect URL:
   `https://dialektik-core-dev.onrender.com/auth/recover`.
   Keep Site URL unchanged for this rollout. Do not set Site URL to Render
   API root or localhost. A dedicated client-side recovery route is used.
6. Test from a browser by opening the same HTTPS recovery page, entering the
   authorized beta email, and requesting a fresh link. Do NOT request a reset
   from the Supabase Dashboard's generic reset action: that action might use
   the existing Site URL instead of the dedicated redirect_to parameter.
7. Open the latest recovery email (older links may be consumed or expired),
   set a NEW password on the secure page, and sign in to the Android APK
   using the same existing email. Confirm private beta access is retained.

## Implementation

The browser posts the email directly to Supabase `/auth/v1/recover` with an
explicit `redirect_to` pointing to this HTTPS route. Supabase sends its
one-time email and redirects back with recovery credentials in the URL
fragment (implicit browser flow), not in the HTTP request to Core. On load,
the page removes the fragment immediately, validates the Supabase session
using `GET /auth/v1/user`, and submits the new password directly to
`PUT /auth/v1/user` using the verified bearer token.

The page does not send passwords or tokens to Core, does not store auth
credentials in local/session storage, loads no third-party scripts/fonts,
and disallows framing and external connections besides the selected Supabase
Auth origin. Do not paste password-reset URLs, token fragments, or passwords
into tickets, chat messages, logs, or CI artifacts.

## Stop and rollback

If recovery fails, do not delete the existing Supabase Auth user: the
`public.private_beta_testers` foreign key uses ON DELETE RESTRICT and
the authorization record is tied to that existing user UUID. Preserve the
previous Render deployment and revert only the recovery code/config
through its reviewed release process if necessary.

Do not claim real password-reset E2E PASS until a new link actually reaches
the deployed HTTPS page, allows a successful password update, and the APK
logs in with the existing beta-allowlisted user.
