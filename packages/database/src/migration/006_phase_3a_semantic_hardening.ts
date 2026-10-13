import { sql, type Migration } from 'kysely';

/**
 * Phase 3A corrects semantic-infrastructure identity and lifecycle defects
 * without changing Event authority or Article membership. Existing immutable
 * artefacts are retained; only the permitted proposal lifecycle state is
 * normalized when legacy Phase-3 rows have more than one active generation.
 */
const PHASE_3A_HARDENING_SQL = String.raw`
do $$
declare feature_identity_constraint text;
begin
  select constraint_row.conname into feature_identity_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'event_intelligence_features'::regclass
    and constraint_row.contype = 'u'
    and pg_get_constraintdef(constraint_row.oid, true)
      = 'UNIQUE (article_id, event_id, representation_id, feature_version)';

  if feature_identity_constraint is null then
    raise exception 'Phase 3A expected the Phase-3 feature identity constraint';
  end if;

  execute format(
    'alter table event_intelligence_features drop constraint %I',
    feature_identity_constraint
  );
end;
$$;

alter table event_intelligence_features
  add constraint event_intelligence_features_provenance_key
  unique (article_id, event_id, representation_id, feature_version, embedding_id);

-- Legacy Phase-3 state permitted different active rows for one Article when
-- model/config changed. Preserve every row and normalize only those active
-- groups into a deterministic newest-to-oldest linear lineage before adding
-- the one-current-generation constraint.
with ranked_active as (
  select
    id,
    article_id,
    row_number() over (
      partition by article_id order by created_at desc, id desc
    ) as active_rank,
    count(*) over (partition by article_id) as active_count,
    lead(id) over (
      partition by article_id order by created_at desc, id desc
    ) as immediately_prior_id
  from event_intelligence_proposals
  where state = 'active'
)
update event_intelligence_proposals proposal
set
  state = case when ranked_active.active_rank = 1 then 'active'::semantic_proposal_state
               else 'superseded'::semantic_proposal_state end,
  supersedes_id = ranked_active.immediately_prior_id
from ranked_active
where proposal.id = ranked_active.id
  and ranked_active.active_count > 1;

do $$
begin
  if exists (
    select 1
    from event_intelligence_proposals proposal
    join event_intelligence_proposals predecessor on predecessor.id = proposal.supersedes_id
    where proposal.article_id <> predecessor.article_id
  ) then
    raise exception 'Phase 3A cannot infer a cross-Article semantic proposal lineage';
  end if;
end;
$$;

alter table event_intelligence_proposals
  add constraint event_intelligence_proposals_supersedes_article_fk
  foreign key (supersedes_id, article_id)
  references event_intelligence_proposals(id, article_id);

create unique index event_intelligence_proposals_one_active_per_article
  on event_intelligence_proposals (article_id)
  where state = 'active';
create unique index event_intelligence_proposals_no_lineage_branch
  on event_intelligence_proposals (supersedes_id)
  where supersedes_id is not null;

-- A proposal is immutable diagnostic history.  Phase 3A permits exactly the
-- lifecycle update used by runtime supersession; every content mutation (and
-- every other state transition) is rejected by PostgreSQL.
create function dialektik_prevent_semantic_proposal_history_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.state = 'active' and new.state = 'superseded' then
    new.state := old.state;
    if new is distinct from old then
      raise exception 'semantic proposal history is immutable except active to superseded';
    end if;
    new.state := 'superseded';
    return new;
  end if;
  raise exception 'semantic proposal history is immutable except active to superseded';
end;
$$;

create trigger event_intelligence_proposals_history_immutable
before update on event_intelligence_proposals
for each row execute function dialektik_prevent_semantic_proposal_history_mutation();

alter table semantic_reprocessing_runs
  add column representation_config_version text,
  add column embedding_provider_id text,
  add column embedding_config_version text;

alter table semantic_reprocessing_runs
  add constraint semantic_reprocessing_runs_optional_identity_nonempty check (
    (representation_config_version is null or btrim(representation_config_version) <> '')
    and (embedding_provider_id is null or btrim(embedding_provider_id) <> '')
    and (embedding_config_version is null or btrim(embedding_config_version) <> '')
  );

-- Query ranking happens across all eligible Events before the bounded page is
-- selected. The title index supports the PostgreSQL FTS portion of that stage;
-- temporal/event-activity filtering remains explicit in the repository query.
create index events_semantic_title_fts
  on events using gin (to_tsvector('simple', title_descriptive));
`;

export const phase3aSemanticHardeningMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_3A_HARDENING_SQL).execute(database);
  },
};
