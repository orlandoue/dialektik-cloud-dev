# Dialektik Core role rotation drill — isolated proof and real cutover gate

This experiment uses **entirely fabricated** PostgreSQL 17.11 roles and SCRAM credentials, Docker `--network none`, no Supabase DEV account, no authentic backup, and no Render deployment.

It proves that:
- An old Core login and a next Core login can both SELECT source/article metadata without INSERT, DELETE or BYPASSRLS.
- SCRAM rejects a wrong password (the target cannot simply accept any password through TRUST).
- After the old Core role becomes NOLOGIN for **new connections**, the next role still serves reads.
- Re-enabling the old role provides a reversible login fallback in the synthetic clone.

This does **NOT** certify zero service downtime, terminate existing sessions or rotate actual Render/Core secrets. A real zero-interruption cutover must be planned separately with a second least-privilege role, RLS/privilege matrix diff, Render secret deployment and health probes, authenticated private-beta smoke, new connection confirmation, revocation of old credentials, rollback windows and owner sign-off. No real credentials must be posted to issues/CI. The dedicated GOV.UK writer remains NOLOGIN until the separate 043/044 deployment gates. Recovery gate #4 remains open pending Auth API, consistent snapshot recovery and actual service cutover.
