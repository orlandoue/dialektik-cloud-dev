import { sql, type Migration } from "kysely";

/** Least-privilege role for the OD-12 moderation commands only. */
const MODERATION_WRITER_SQL = String.raw`
-- No login or membership is created here. An administrator provisions a
-- separate service login out of band and never grants this role to the reader.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dialektik_moderation_writer') then
    create role dialektik_moderation_writer
      nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (select 1 from pg_roles where rolname = 'dialektik_moderation_writer'
    and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'Existing moderation writer role has unexpected privileges';
  end if;
end
$$;

grant usage on schema public to dialektik_moderation_writer;
grant insert on public.moderation_tasks to dialektik_moderation_writer;
grant update (assigned_to, state, resolution_reason, resolved_at)
  on public.moderation_tasks to dialektik_moderation_writer;
grant insert on public.moderation_review_proposals to dialektik_moderation_writer;
grant update (state, decided_at, decided_by, decision_reason)
  on public.moderation_review_proposals to dialektik_moderation_writer;
grant insert on public.moderation_review_proposal_members,
  public.moderation_command_receipts, public.candidate_classes,
  public.candidate_class_members, public.relationships,
  public.relationship_endpoints, public.audit_entries
  to dialektik_moderation_writer;
grant update (state) on public.candidate_classes to dialektik_moderation_writer;

-- Live installations have RLS on these tables. Existing read policies remain
-- associated with the reader role, inherited by the dedicated service login.
do $$
declare p record;
begin
  select polcmd, polroles, pg_get_expr(polwithcheck, polrelid) as condition into p
    from pg_policy where polrelid = 'public.relationships'::regclass
      and polname = 'moderation_writer_r01a_insert';
  if not found then
    create policy moderation_writer_r01a_insert on public.relationships
      for insert to dialektik_moderation_writer
      with check (
        rel_type = 'R01a' and publication_state = 'published'
        and moderation_proposal_id is not null
      );
  elsif p.polcmd <> 'a' or p.polroles <> array['dialektik_moderation_writer'::regrole::oid]
    or regexp_replace(lower(p.condition), '[[:space:]]', '', 'g') <>
      regexp_replace(lower('((rel_type = ''R01a''::relationship_type) AND (publication_state = ''published''::relationship_publication_state) AND (moderation_proposal_id IS NOT NULL))'), '[[:space:]]', '', 'g') then
    raise exception 'Existing moderation relationship policy has unexpected permissions';
  end if;

  select polcmd, polroles, pg_get_expr(polwithcheck, polrelid) as condition into p
    from pg_policy where polrelid = 'public.relationship_endpoints'::regclass
      and polname = 'moderation_writer_r01a_endpoints_insert';
  if not found then
    create policy moderation_writer_r01a_endpoints_insert on public.relationship_endpoints
      for insert to dialektik_moderation_writer
      with check (exists (
        select 1 from public.relationships relationship
        where relationship.id = relationship_endpoints.relationship_id
          and relationship.rel_type = 'R01a'
          and relationship.publication_state = 'published'
          and relationship.moderation_proposal_id is not null
      ));
  elsif p.polcmd <> 'a' or p.polroles <> array['dialektik_moderation_writer'::regrole::oid]
    or regexp_replace(lower(p.condition), '[[:space:]]', '', 'g') <>
      regexp_replace(lower('(EXISTS ( SELECT 1 FROM relationships relationship WHERE (((relationship.id)::text = (relationship_endpoints.relationship_id)::text) AND (relationship.rel_type = ''R01a''::relationship_type) AND (relationship.publication_state = ''published''::relationship_publication_state) AND (relationship.moderation_proposal_id IS NOT NULL))))'), '[[:space:]]', '', 'g') then
    raise exception 'Existing moderation endpoint policy has unexpected permissions';
  end if;
end
$$;

do $$
begin
  if pg_has_role('dialektik_core_app', 'dialektik_moderation_writer', 'MEMBER') then
    raise exception 'the read-only Core role must not inherit moderation writes';
  end if;
end
$$;
`;

export const moderationWriterScopeMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(MODERATION_WRITER_SQL).execute(database);
  },
  down(): Promise<void> {
    throw new Error("Moderation writer scope is forward-only.");
  },
};
