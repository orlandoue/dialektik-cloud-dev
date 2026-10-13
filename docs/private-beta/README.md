# Dialektik private beta access

## Access model

- Core protects every `/v1/*` route with a Supabase Auth access token.
- Core verifies ES256 signature, the project issuer, `authenticated` audience,
  expiration, issued-at, subject UUID, authenticated role, and non-anonymous
  status against the project's public JWKS using `jose`.
- Core checks `public.private_beta_testers` on each request. Disabling or
  revoking a row takes effect on the next request.
- `/health/live` and `/health/ready` remain public for Render monitoring.
- Moderation continues to use its independent database-backed moderation
  session. Personal-owner administration and semantic controllers remain
  unregistered in production.
- The Flutter app contains only the Supabase publishable key. It never contains
  a secret/service-role key. Passwords are sent only to Supabase Auth over HTTPS;
  access and refresh tokens stay in process memory and are cleared on sign-out.
  A cold app restart requires a fresh sign-in.

## Invite and authorize a tester

1. Invite the tester in Supabase Dashboard → Authentication → Users. Do not
   enable public self-registration for this private beta.
2. After the invited user exists, copy the user's UUID from that page.
3. In the Supabase SQL Editor, add only that UUID:

   ```sql
   insert into public.private_beta_testers (user_id)
   values ('<invited-user-uuid>');
   ```

4. Revoke immediately when needed:

   ```sql
   update public.private_beta_testers
   set enabled = false, revoked_at = clock_timestamp()
   where user_id = '<invited-user-uuid>';
   ```

The client roles have no table privileges. Core has read-only access to active
rows. Do not grant the tester a database role or a privileged API key.

## Cloud Android build

Use a publishable key copied from Supabase Dashboard → Project Settings → API
Keys. It is public client configuration, not an administrator secret.

```powershell
flutter build apk --release `
  --dart-define=DIALEKTIK_API_BASE_URL=https://dialektik-core-dev.onrender.com `
  --dart-define=DIALEKTIK_SUPABASE_URL=https://vclsswwfhljczxgnsciq.supabase.co `
  --dart-define=DIALEKTIK_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_key> `
  --dart-define=DIALEKTIK_SEMANTIC_MODE=disabled
```

The API origin must be HTTPS in production builds. The publishable key is
compiled into the Android client as intended by Supabase; never substitute a
secret or `service_role` key.

## Synthetic-only acceptance fixture

`app/test/fixtures/private_beta_demo/scenario.json` in the product checkout is
test-only. Its `example.test` URLs, article titles, events, and contradiction
are marked `DEMO/TEST`; it is not an API seed, cloud fixture, news acquisition,
or semantic result.
