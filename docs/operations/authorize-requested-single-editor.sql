-- Run as the migration administrator after migration 045 has been installed.
-- This records the project owner's explicit choice on 2026-10-28. It does not
-- approve source rights, create editorial evidence, or publish a decision.
begin;

do $$
declare
  requested_editor constant dialektik_ulid := '01M4YDQK00ED1T0R0R1AND0VE1';
begin
  if not exists (
    select 1 from public.users editor
    join public.editorial_beta_identities binding on binding.editorial_user_id = editor.id
    join public.private_beta_testers beta on beta.user_id = binding.auth_user_id
    where editor.id = requested_editor and editor.role = 'editor'
      and binding.enabled is true and binding.revoked_at is null
      and beta.enabled is true and beta.revoked_at is null
  ) then
    raise exception 'requested editor must have an active linked beta identity';
  end if;

  if exists (
    select 1 from public.editorial_single_editor_authorizations
    where revoked_at is null and editor_user_id <> requested_editor
  ) then
    raise exception 'a different single editor authorization is already active';
  end if;

  if not exists (
    select 1 from public.editorial_single_editor_authorizations
    where revoked_at is null and editor_user_id = requested_editor
  ) then
    insert into public.editorial_single_editor_authorizations
      (id, editor_user_id, decision_reference)
    values (
      public.dialektik_generate_ulid(), requested_editor,
      'Project owner explicitly selected a single-editor workflow on 2026-10-28'
    );
  end if;
end
$$;

commit;
