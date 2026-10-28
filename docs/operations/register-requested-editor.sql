-- Applied to dialektik-dev on 2026-10-28 UTC. Retained for review and recovery.
-- Register the editorial identity explicitly supplied by the project owner.
-- The current schema supports role 'editor' and stores only id, role and time;
-- it does not store the supplied handle, name, email or account status.
-- This record does not create a moderation session or link a Supabase account.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  existing_role public.user_role;
begin
  select role into existing_role from public.users
  where id = '01M4YDQK00ED1T0R0R1AND0VE1' for update;
  if found then
    if existing_role <> 'editor'::public.user_role then
      raise exception 'Requested editorial ID already exists with a different role';
    end if;
  else
    insert into public.users (id, role, created_at)
    values ('01M4YDQK00ED1T0R0R1AND0VE1', 'editor'::public.user_role, now());
  end if;
end
$$;

commit;
