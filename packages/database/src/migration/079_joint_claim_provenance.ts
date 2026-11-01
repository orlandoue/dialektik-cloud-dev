import { sql, type Migration } from 'kysely';

export const jointClaimProvenanceDdl = String.raw`
create table public.live_semantic_joint_claims (
  id dialektik_ulid primary key,
  attempt_id dialektik_ulid not null references public.live_semantic_joint_scope_attempts(id),
  article_id dialektik_ulid not null references public.articles(id),
  side text not null check (side in ('left','right')),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  quoted_text text not null check (char_length(quoted_text) between 1 and 300),
  char_start integer not null check (char_start >= 0),
  char_end integer not null check (char_end > char_start and char_end-char_start <= 300),
  assertion_text text not null check (char_length(btrim(assertion_text)) between 1 and 300),
  created_at timestamptz(3) not null,
  unique (attempt_id,side),
  unique (attempt_id,article_id)
);
create function public.dialektik_validate_joint_claim_provenance() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
begin
  if not exists (
    select 1 from public.live_semantic_joint_scope_attempts a
    join public.live_semantic_joint_scope_outcomes o on o.attempt_id=a.id and o.outcome='VALIDATED'
    join public.articles article on article.id=new.article_id
    where a.id=new.attempt_id and o.result->>'scopeAligned'='true' and o.result->>'status'='ALIGNED'
      and ((new.side='left' and a.left_article_id=new.article_id and a.left_input_sha256=new.input_sha256)
        or (new.side='right' and a.right_article_id=new.article_id and a.right_input_sha256=new.input_sha256))
      and encode(extensions.digest(convert_to(article.text_original,'UTF8'),'sha256'),'hex')=new.input_sha256
      and substring(article.text_original from new.char_start+1 for new.char_end-new.char_start)=new.quoted_text
      and char_length(new.quoted_text)=new.char_end-new.char_start
      and o.result->new.side->>'quotedText'=new.quoted_text
      and (o.result->new.side->>'charStart')::integer=new.char_start
      and (o.result->new.side->>'charEnd')::integer=new.char_end
      and o.result->new.side->>'assertionText'=new.assertion_text
      and public.dialektik_live_semantic_route_allowed(new.article_id,new.input_sha256,
        'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct')
  ) then raise exception using errcode='23514',message='JOINT_CLAIM_PROVENANCE_INVALID'; end if;
  return new;
end $$;
create trigger joint_claim_validate before insert on public.live_semantic_joint_claims
for each row execute function public.dialektik_validate_joint_claim_provenance();
create function public.dialektik_preserve_joint_claim_provenance() returns trigger
language plpgsql as $$ begin
  raise exception using errcode='55000',message='JOINT_CLAIM_PROVENANCE_IMMUTABLE';
end $$;
create trigger joint_claim_immutable before update or delete on public.live_semantic_joint_claims
for each row execute function public.dialektik_preserve_joint_claim_provenance();
alter table public.live_semantic_joint_claims enable row level security;
revoke all on public.live_semantic_joint_claims from public,anon,authenticated,service_role;
grant select on public.live_semantic_joint_claims to dialektik_core_app;
grant select,insert on public.live_semantic_joint_claims to dialektik_headline_ai_writer;
create policy joint_claims_core_read on public.live_semantic_joint_claims for select to dialektik_core_app using(true);
create policy joint_claims_ai_read on public.live_semantic_joint_claims for select to dialektik_headline_ai_writer using(true);
create policy joint_claims_ai_insert on public.live_semantic_joint_claims for insert to dialektik_headline_ai_writer with check(true);
`;
export const jointClaimProvenanceMigration: Migration = {
  async up(database) { await sql.raw(jointClaimProvenanceDdl).execute(database); },
  async down() { throw new Error('Joint claim provenance is forward-only.'); },
};
