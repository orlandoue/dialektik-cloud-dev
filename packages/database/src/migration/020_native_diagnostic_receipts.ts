import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
-- Prospective only: no historical run or acquisition record is rewritten.
create function dialektik_canonical_native_json(value jsonb) returns text
language plpgsql immutable strict as $$
declare result text;
begin
  if jsonb_typeof(value)='object' then
    select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || dialektik_canonical_native_json(item), ',' order by key collate "C"),'') || '}'
      into result from jsonb_each(value) pair(key,item);
  elsif jsonb_typeof(value)='array' then
    select '[' || coalesce(string_agg(dialektik_canonical_native_json(item), ',' order by ordinal),'') || ']'
      into result from jsonb_array_elements(value) with ordinality pair(item,ordinal);
  else result := value::text;
  end if;
  return result;
end;
$$;
create table semantic_native_diagnostic_receipts (
  provider_run_id dialektik_ulid primary key references semantic_provider_runs(id),
  snapshot_id dialektik_ulid not null unique references semantic_shadow_graph_snapshots(id),
  canonical_receipt text not null check (octet_length(canonical_receipt) between 2 and 4194304),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[a-f0-9]{64}$'),
  native_output_sha256 text not null check (native_output_sha256 ~ '^[a-f0-9]{64}$'),
  projection_sha256 text not null check (projection_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz(3) not null
);
create function dialektik_validate_native_diagnostic_receipt() returns trigger language plpgsql as $$
declare receipt jsonb; entry jsonb; path_token text; run semantic_provider_runs;
  keys text[]; known_keys text[] := array[
    'artifact','extractions','anchor_extractions','version','hashes','article_decisions','occurrence_memberships',
    'thread_memberships','occurrence_generations','thread_generations','candidate_applicability','article_id',
    'source_id','position','action','reason','occurrence_id','thread_id','partial_occurrence_creation','observation_ids',
    'thread_anchor_id','occurrence_comparisons','thread_comparisons','occurrence_applicability','thread_applicability',
    'occurrence','thread','outcome','prior_family','incoming_family','references','role','normalized_value_sha256',
    'span','field','start','end','source_sha256','span_sha256','observations','anchor','facts','issues','identity',
    'evolving','context','observation_id','available_at','relation_type','instance_identifier','bounded','knowledge',
    'value','supports','rule','process_type','boundary','anchor_id','extractor_version','extractor_rule_id','syndication_group','semantic_type','classification','metadata_dependencies','left','right','left_sha256','right_sha256','operator','comparison'];
  safe_tokens text[] := array[
    'update_occurrence','new_occurrence_in_existing_thread','new_thread','ambiguous',
    'no_bounded_occurrence_observation','multi_observation_article_requires_decomposition','multiple_identity_matches',
    'occurrence_thread_incompatibility','no_automatic_occurrence_reparent','unique_occurrence_match',
    'thread_match_all_children_distinct','occurrence_identity_unknown','thread_identity_unknown',
    'unresolved_prior_thread_comparison','unresolved_prior_occurrence_comparison','grounded_process_distinct_from_all_prior',
    'MATCH','DISTINCT','UNKNOWN','match','distinct','unknown','APPLICABLE','INAPPLICABLE','UNKNOWN_APPLICABILITY',
    'OBSERVED','CONFLICTING','UNOBSERVED','observed','conflicting','unobserved',
    'missing_unresolved_or_conflicting_class','compatible_typed_family','explicit_disjoint_typed_families','family_overlap_unresolved',
    'fixture','institutional_act','incident','explicit_instance','fixture_series','notification_process','numbered_session',
    'legal_case','investigation','operation','explicit_process','scheduled_fixture','institutional_decision','physical_incident',
    'identified_action','bounded_action','bounded_series','bounded_notification_dispute','bounded_process','title','body',
    'home','away','competition','authority','decision_action','process_object','incident_kind','site','namespace','round',
    'jurisdiction','target','origin_month','regulation','regulation_month','process_key','decision_day',
    'phase3v10.11-applicability-replay-v1','phase3v10.11-namespace-compatibility-v1',
    'phase3v10.9-grounded-extractor-v1','phase3v10.10-scoped-anchor-v1','identity','evolving','context','retained_observation','DIRECT','DERIVED',
    'direct_lexical','modal_marker_v1','calendar_date_v1','relative_day_v1','explicit_roles_schedule_v1','court_lexical_v1',
    'ruling_lexical_v1','scoped_visitation_object_v1','dated_court_act_v1','assembly_lexical_v1','explicit_namespaced_action_v1',
    'existing_schema_adapter','explicit_origin_month_v1','integer_regulation_number_v1','explicit_regulation_month_v1','originating_directive_scope_v1',
    'process_boundary','event_day','quantity','edition','leg','scheduled_day','venue','occurrence_day','primary_target',
    'modality:conditional','modality:expected','modality:confirmed','modality:cancelled','modality:denied','modality:retrospective','modality:completed','modality:planned',
    'missing_bounded_process_anchor','ambiguous_or_conflicting_process_anchor','incomparable_process_namespace_or_type',
    'incomplete_shared_process_scope','bounded_process_scope_contradiction','same_bounded_process_scope','same_identifier_conflicting_identity','unreconciled_schedule_venue_conflict'];
begin
  perform dialektik_reserve_semantic_scope('PROVIDER_RUN',new.provider_run_id);
  perform dialektik_reserve_semantic_scope('GRAPH',new.snapshot_id);
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  if not exists (select 1 from semantic_shadow_graph_snapshots where id=new.snapshot_id and provider_run_id=new.provider_run_id)
    or new.recorded_at < run.created_at or not exists (select 1 from semantic_shadow_graph_inputs where snapshot_id=new.snapshot_id)
    or exists (select 1 from semantic_shadow_graph_inputs i join observed_article_content_versions v on v.id=i.article_version_id
      join content_access_policies p on p.id=v.policy_id where i.snapshot_id=new.snapshot_id and not p.derived_semantic_persistence) then
    raise exception using errcode='23514', message='native diagnostic receipt requires an open exact rights-qualified graph';
  end if;
  receipt := new.canonical_receipt::jsonb;
  select array_agg(key order by key) into keys from jsonb_object_keys(receipt) key;
  if keys is distinct from array['canonicalization','fields','nativeOutputSha256','projectionSha256','schemaVersion','sourceTextRetention']
    or receipt->>'schemaVersion' is distinct from 'provider-native-diagnostics-v1' or receipt->>'canonicalization' is distinct from 'sorted-json-utf8-v1'
    or receipt->>'sourceTextRetention' is distinct from 'HASH_ONLY' or receipt->>'nativeOutputSha256' is distinct from new.native_output_sha256
    or receipt->>'projectionSha256' is distinct from new.projection_sha256
    or dialektik_canonical_native_json(receipt) <> new.canonical_receipt
    or encode(digest(convert_to(new.canonical_receipt,'UTF8'),'sha256'),'hex') <> new.canonical_sha256
    or jsonb_typeof(receipt->'fields') is distinct from 'array' or jsonb_array_length(receipt->'fields') not between 1 and 100000
    or (select count(distinct item->>'path') from jsonb_array_elements(receipt->'fields') item) <> jsonb_array_length(receipt->'fields') then
    raise exception using errcode='23514', message='native diagnostic receipt must be canonical complete typed accounting';
  end if;
  for entry in select item from jsonb_array_elements(receipt->'fields') item loop
    if jsonb_typeof(entry) <> 'object' or not (entry ?& array['path','nativeKind','outcome','projection','reason'])
      or (select count(*) from jsonb_object_keys(entry) key where key not in ('path','nativeKind','outcome','projection','reason','value','sha256')) > 0
      or jsonb_typeof(entry->'path') <> 'string' or char_length(entry->>'path') > 2048
      or jsonb_typeof(entry->'nativeKind') is distinct from 'string' or jsonb_typeof(entry->'outcome') is distinct from 'string'
      or jsonb_typeof(entry->'projection') is distinct from 'string' or jsonb_typeof(entry->'reason') is distinct from 'string'
      or entry->>'nativeKind' not in ('object','array','string','number','boolean','null','absent')
      or entry->>'projection' not in ('MODELED','NOT_MODELED')
      or entry->>'projection' is distinct from (case when (entry->>'path') ~ '^/artifact/article_decisions/[0-9]+/(article_id|position|action|reason|occurrence_id|thread_id|partial_occurrence_creation|observation_ids(/[0-9]+)?|thread_anchor_id)$'
        or (entry->>'path') ~ '^/artifact/article_decisions/[0-9]+/(occurrence|thread)_(applicability|comparisons)/(occurrence|thread):[a-f0-9]{24}(/[0-9]+)?/outcome$'
        or (entry->>'path') ~ '^/artifact/article_decisions/[0-9]+/(occurrence|thread)_(applicability|comparisons)/(occurrence|thread):[a-f0-9]{24}(/[0-9]+)?/references/[0-9]+/span/(article_id|source_id|field|start|end|source_sha256|span_sha256)$'
        then 'MODELED' else 'NOT_MODELED' end)
      or entry->>'reason' not in ('STRUCTURAL_SEMANTIC_VALUE','SOURCE_TEXT_RETENTION_DENIED','UNMODELED_NATIVE_FIELD','NOT_EMITTED_BY_PROVIDER') then
      raise exception using errcode='23514', message='native diagnostic field has invalid structural accounting';
    end if;
    foreach path_token in array string_to_array(entry->>'path','/') loop
      if path_token <> '' and not (path_token=any(known_keys) or path_token ~ '^(0|[1-9][0-9]*)$'
        or path_token ~ '^(occurrence|thread):[0-9a-f]{24}$' or path_token ~ '^key-sha256:[0-9a-f]{64}$') then
        raise exception using errcode='23514', message='native diagnostic keys may not retain arbitrary source text';
      end if;
    end loop;
    if entry->>'outcome'='PERSISTED_NATIVE_VALUE' then
      if not entry ? 'value' or entry ? 'sha256' or entry->>'nativeKind'='absent'
        or jsonb_typeof(entry->'value') not in ('string','number','boolean','null')
        or entry->>'reason' <> 'STRUCTURAL_SEMANTIC_VALUE'
        or ((entry->>'nativeKind') in ('array','object') and (jsonb_typeof(entry->'value') <> 'number' or (entry->>'value') !~ '^(0|[1-9][0-9]*)$'))
        or ((entry->>'nativeKind') not in ('array','object') and jsonb_typeof(entry->'value') <> entry->>'nativeKind')
        or ((entry->>'nativeKind') not in ('array','object') and (entry->>'path') like '%/key-sha256:%')
        or ((entry->>'path') ~ '/(value|instance_identifier)(/|$)' and jsonb_typeof(entry->'value')='string') then
        raise exception using errcode='23514', message='source-derived text cannot be retained in native diagnostics';
      end if;
      if jsonb_typeof(entry->'value')='string' and not (((entry->>'path') ~ '/(action|reason|outcome|prior_family|incoming_family|role|field|knowledge|relation_type|process_type|version|extractor_version|semantic_type|classification|rule|extractor_rule_id)$' and (entry->>'value')=any(safe_tokens))
        or ((entry->>'path') ~ '/reason$' and (entry->>'value') ~ '^v10_7:(home|away|competition|edition|round|leg|authority|decision_action|process_object|decision_day|incident_kind|site|occurrence_day|primary_target|relation_type|explicit_identifier_or_namespace|shared_identifier_namespace|explicit_identifier|supported_occurrence_class|tournament_key_or_schedule_key|prior_same_class_observation|unambiguous_prior_explicit_identifier)(,(home|away|competition|edition|round|leg|authority|decision_action|process_object|decision_day|incident_kind|site|occurrence_day|primary_target|relation_type|explicit_identifier_or_namespace|shared_identifier_namespace|explicit_identifier|supported_occurrence_class|tournament_key_or_schedule_key|prior_same_class_observation|unambiguous_prior_explicit_identifier))*$')
        or ((entry->>'path') ~ '/issues(/[0-9]+)?$' and (entry->>'value')=any(array['multiple_modal_markers_retained','conflicting_event_dates','missing_or_conflicting_competition','conflicting_current_editions','ambiguous_session_scope','ambiguous_process_identifiers','ambiguous_process_scope','multiple_foreground_processes','conflicting_round_scope']))
        or ((entry->>'path') ~ '/(normalized_value_sha256|source_sha256|span_sha256|left_sha256|right_sha256|thread_anchor_id|observation_id|anchor_id|observation_ids(/[0-9]+)?)$' and (entry->>'value') ~ '^[0-9a-f]{64}$')
        or ((entry->>'path') ~ '^/artifact/hashes/[a-z_]+$' and (entry->>'value') ~ '^[0-9a-f]{64}$')
        or ((entry->>'path') ~ '/(occurrence_id|thread_id)$' and (entry->>'value') ~ '^(occurrence|thread):[0-9a-f]{24}$')
        or ((entry->>'path') ~ '^/artifact/(occurrence|thread)_(memberships|generations)/[0-9]+/(1|2)$' and (entry->>'value') ~ '^(occurrence|thread):[0-9a-f]{24}$')
        or ((entry->>'path') ~ '^/artifact/(occurrence|thread)_generations/[0-9]+/2$' and (entry->>'value') ~ '^[0-9a-f]{64}$')
        or ((entry->>'path') ~ '(/article_id$|^/artifact/(occurrence|thread)_memberships/[0-9]+/1$)' and exists (select 1 from semantic_shadow_graph_inputs i
          join observed_article_content_versions v on v.id=i.article_version_id where i.snapshot_id=new.snapshot_id and v.article_id::text=entry->>'value'))
        or ((entry->>'path') ~ '/source_id$' and exists (select 1 from semantic_shadow_graph_inputs i
          join observed_article_content_versions v on v.id=i.article_version_id where i.snapshot_id=new.snapshot_id and v.source_id::text=entry->>'value'))
        or ((entry->>'path') ~ '/available_at$' and (entry->>'value') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|\+00:00)$')) then
        raise exception using errcode='23514', message='native diagnostic text requires an explicit safe semantic token';
      end if;
    elsif entry->>'outcome'='HASH_ONLY' then
      if entry ? 'value' or not entry ? 'sha256' or jsonb_typeof(entry->'sha256') is distinct from 'string' or (entry->>'sha256') !~ '^[0-9a-f]{64}$'
        or entry->>'reason' not in ('SOURCE_TEXT_RETENTION_DENIED','UNMODELED_NATIVE_FIELD') or entry->>'nativeKind' in ('array','object','absent') then
        raise exception using errcode='23514', message='hash-only diagnostics cannot carry retained values';
      end if;
    elsif entry->>'outcome' in ('OMITTED_RIGHTS_POLICY','NOT_EMITTED') then
      if entry ? 'value' or entry ? 'sha256' or (entry->>'outcome'='NOT_EMITTED' and (entry->>'nativeKind'<>'absent' or entry->>'reason'<>'NOT_EMITTED_BY_PROVIDER'))
        or (entry->>'outcome'='OMITTED_RIGHTS_POLICY' and entry->>'reason'<>'SOURCE_TEXT_RETENTION_DENIED') then
        raise exception using errcode='23514', message='omission accounting cannot carry a native value';
      end if;
    else raise exception using errcode='23514', message='native diagnostic retention outcome is invalid';
    end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(receipt->'fields') item where item->>'path'='' and item->>'nativeKind'='object')
    or exists (
      with nodes as (select item, item->>'path' path, regexp_replace(item->>'path','/[^/]*$','') parent_path from jsonb_array_elements(receipt->'fields') item),
      children as (select parent_path, count(*) count from nodes where path<>'' and item->>'outcome'<>'NOT_EMITTED' group by parent_path)
      select 1 from nodes n left join nodes p on p.path=n.parent_path left join children c on c.parent_path=n.path
      where (n.item->>'nativeKind' in ('array','object') and (n.item->>'value')::numeric <> coalesce(c.count,0))
        or (n.path<>'' and (p.path is null or p.item->>'nativeKind' not in ('object','array')))
        or (n.path<>'' and p.item->>'nativeKind'='array' and (regexp_replace(n.path,'^.*/','') !~ '^(0|[1-9][0-9]*)$'
          or case when regexp_replace(n.path,'^.*/','') ~ '^(0|[1-9][0-9]*)$' then regexp_replace(n.path,'^.*/','')::numeric >= (p.item->>'value')::numeric else true end))) then
    raise exception using errcode='23514', message='native diagnostic ledger requires all emitted children and exact container counts';
  end if;
  return new;
end;
$$;
create trigger semantic_native_diagnostics_validate before insert on semantic_native_diagnostic_receipts
  for each row execute function dialektik_validate_native_diagnostic_receipt();
create trigger semantic_native_diagnostics_immutable before update or delete on semantic_native_diagnostic_receipts
  for each row execute function dialektik_semantic_content_append_only();
create trigger semantic_native_diagnostics_no_truncate before truncate on semantic_native_diagnostic_receipts
  for each statement execute function dialektik_semantic_content_append_only();
comment on column evidence_fingerprints.input_hash is 'Legacy SQL name: SHA256 of complete acquired response bytes; Core acquiredContentHash. Never the normalized body hash.';
comment on column evidence_fingerprints.normalized_input_hash is 'SHA256 of exact normalized original body field; Core normalizedInputHash. Distinct from acquiredContentHash.';
`;

export const nativeDiagnosticReceiptsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
};
