import {
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { parseUlid, type Database } from '@dialektik/database';
import { assertExactQueryKeys, parseUlidParameter } from '../public-api/public-api.validation.js';
import { invalidRequest } from '../public-api/public-api.error.js';

interface GraphRunRow {
  run_id: string;
  snapshot_id: string;
  run_identity: string;
  input_provenance: string;
  provider_type: string;
  provider_version: string;
  candidate_commit: string | null;
  runtime_python: string | null;
  runtime_model: string | null;
  sealed_at: Date;
  llm: unknown;
}
interface GraphInputRow {
  id: string;
  headline: string | null;
  canonical_url: string | null;
  published_at: Date | null;
  source_id: string;
  source_name: string;
  publisher_family: string | null;
  declared_upstream: string | null;
  content_access_mode: string;
  version_id: string;
  version_number: number;
  acquired_content_hash: string;
  normalized_input_hash: string;
  title_input_hash: string;
  normalization_version: string;
  input_codepoint_length: number;
  title_codepoint_length: number;
  acquired_at: Date;
  envelope_id: string;
  reproducibility_class: string;
  processed_at: Date;
  source_version_status: string;
}

/** Exact sealed proposal snapshot. Never reads body columns or changes LIVE assignment. */
export class EphemeralGraphInspectorRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async read(runId?: string) {
    return this.database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        await sql`set transaction read only`.execute(tx);
        const rows = await sql<GraphRunRow>`
        select r.id as run_id, g.id as snapshot_id, r.run_identity, r.input_provenance,
          r.provider_type, r.provider_version, r.candidate_commit, r.runtime_python, r.runtime_model,
          seal.sealed_at, cfg.configuration as llm
        from semantic_shadow_graph_snapshots g
        join semantic_shadow_graph_seals seal on seal.snapshot_id=g.id
        join semantic_provider_runs r on r.id=g.provider_run_id
        left join llm_shadow_run_configurations cfg on cfg.provider_run_id=r.id
        where g.authority='SHADOW_NOT_AUTHORITATIVE'
        order by seal.sealed_at desc,g.id desc
      `.execute(tx);
        const projectRun = ({ llm, ...run }: GraphRunRow) => ({
          ...run,
          sealed_at: run.sealed_at.toISOString(),
          ...(llm === null ? {} : { llm }),
        });
        const runs = rows.rows.map(projectRun);
        const selected =
          runId === undefined
            ? (rows.rows.find((run) => run.llm !== null) ??
              rows.rows.find(
                (run) => run.run_identity === 'PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1',
              ) ??
              rows.rows[0])
            : rows.rows.find((run) => run.run_id === runId);
        if (runId !== undefined && !selected)
          throw new NotFoundException('Sealed shadow run not found.');
        if (!selected)
          return {
            authority: 'SHADOW_NOT_AUTHORITATIVE',
            body_retention: 'NO_BODY_REDISPLAY',
            runs,
            selected: null,
          };
        const snapshotId = parseUlid(selected.snapshot_id);
        const result = await sql<GraphInputRow>`
        select a.id,
          case when (case when p.id is not null then p.redisplay is true
            else legacy.active is true and legacy.rights_class='LIVE_READY' and legacy_receipt.authorized is true end)
            then v.original_title else null end as headline,
          case when (case when p.id is not null then p.external_source_link is true
            else legacy.active is true and legacy.rights_class='LIVE_READY' and legacy_receipt.authorized is true end)
            then v.canonical_url else null end as canonical_url,
          v.published_at, s.id as source_id, s.name as source_name,
          legacy.policy->>'publisherFamily' as publisher_family,
          case when p.redisplay is true then m.declared_upstream else null end as declared_upstream,
          vp.content_access_mode, v.id as version_id, v.version_number,
          v.acquired_content_hash, v.normalized_input_hash, v.title_input_hash, v.normalization_version,
          v.input_codepoint_length, v.title_codepoint_length, v.acquired_at,
          e.id as envelope_id, coalesce(ref.reproducibility_class,e.reproducibility_class) as reproducibility_class,
          e.processed_at, coalesce(ref.source_version_status,'UNVERIFIED') as source_version_status
        from semantic_shadow_graph_inputs i
        join observed_article_content_versions v on v.id=i.article_version_id
        join semantic_envelopes e on e.id=i.envelope_id and e.article_version_id=v.id
          and e.provider_run_id=${parseUlid(selected.run_id)}
        join articles a on a.id=v.article_id join sources s on s.id=a.source_id
        join content_access_policies vp on vp.id=v.policy_id
        left join lateral (select * from content_access_policies where source_id=s.id
          order by recorded_at desc,id desc limit 1) p on true
        left join lateral (select * from live_source_policies where source_id=s.id
          order by recorded_at desc,id desc limit 1) legacy on true
        left join lateral (select true as authorized from live_acquisition_receipts
          where exclusion_id=a.live_exposure_id and source_id=s.id and policy_id=legacy.id
          and disposition='PERSISTED' limit 1) legacy_receipt on true
        left join lateral (select declared_upstream from live_article_versions where article_id=a.id
          and recorded_at<=v.acquired_at order by version_number desc limit 1) m on true
        left join lateral (select * from semantic_refetch_verifications where article_version_id=v.id
          order by verified_at desc,id desc limit 1) ref on true
        where i.snapshot_id=${snapshotId} and a.event_id is null
        order by v.published_at,a.id
      `.execute(tx);
        const expected = await tx
          .selectFrom('semantic_shadow_graph_inputs')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('snapshot_id', '=', snapshotId)
          .executeTakeFirstOrThrow();
        if (result.rows.length !== Number(expected.count)) {
          throw new ConflictException('Sealed shadow input projection is unavailable.');
        }
        const inputs = [];
        for (const row of result.rows) {
          const envelopeId = parseUlid(row.envelope_id);
          const evidence = await tx
            .selectFrom('evidence_fingerprints')
            .select(['field', 'field_hash', 'span_start', 'span_end', 'span_hash'])
            .where('envelope_id', '=', envelopeId)
            .orderBy('id')
            .execute();
          const observations = await tx
            .selectFrom('derived_semantic_observations')
            .select([
              'observation_key',
              'decision',
              'applicability',
              'proposed_occurrence_key',
              'proposed_thread_key',
            ])
            .where('envelope_id', '=', envelopeId)
            .orderBy('id')
            .execute();
          const proposals = await tx
            .selectFrom('semantic_article_proposals')
            .select([
              'action',
              'reason_code',
              'proposed_occurrence_key',
              'proposed_thread_key',
              'partial_occurrence_creation',
            ])
            .where('envelope_id', '=', envelopeId)
            .orderBy('id')
            .execute();
          const applicability = await tx
            .selectFrom('semantic_candidate_applicability')
            .select(['scope', 'target_key', 'outcome'])
            .where('envelope_id', '=', envelopeId)
            .orderBy('id')
            .execute();
          const llm = await tx
            .selectFrom('llm_shadow_observations')
            .select('structured_output')
            .where('envelope_id', '=', envelopeId)
            .executeTakeFirst();
          inputs.push({
            published_at: row.published_at?.toISOString() ?? null,
            publisher_family: row.publisher_family,
            declared_upstream: row.declared_upstream,
            article: {
              id: row.id,
              headline: row.headline,
              canonical_url: row.canonical_url,
              source: { id: row.source_id, name: row.source_name },
              content_access_mode: row.content_access_mode,
              semantic_processing_state: 'PROCESSED_SHADOW',
              body: null,
              authoritative_semantic_assignment: 'UNASSIGNED',
              version: {
                id: row.version_id,
                version_number: row.version_number,
                acquired_content_hash: row.acquired_content_hash,
                normalized_input_hash: row.normalized_input_hash,
                title_input_hash: row.title_input_hash,
                normalization_version: row.normalization_version,
                input_codepoint_length: row.input_codepoint_length,
                title_codepoint_length: row.title_codepoint_length,
                observed_at: row.acquired_at.toISOString(),
              },
              envelope: {
                id: row.envelope_id,
                ...(llm ? { llm: llm.structured_output } : {}),
                provider_type: selected.provider_type,
                provider_version: selected.provider_version,
                provider_run_id: selected.run_id,
                input_provenance: selected.input_provenance,
                candidate_commit: selected.candidate_commit,
                runtime_python: selected.runtime_python,
                runtime_model: selected.runtime_model,
                reproducibility_class: row.reproducibility_class,
                processed_at: row.processed_at.toISOString(),
                source_version_status: row.source_version_status,
                evidence: evidence.map((locator) => ({ ...locator, retained_quote: null })),
                observations,
                article_proposals: proposals,
                candidate_applicability: applicability,
              },
            },
          });
        }
        const occurrences = await tx
          .selectFrom('semantic_shadow_graph_occurrences')
          .select(['occurrence_key as key', 'thread_key', 'article_ids', 'generation_hash'])
          .where('snapshot_id', '=', snapshotId)
          .orderBy('occurrence_key')
          .execute();
        const threads = await tx
          .selectFrom('semantic_shadow_graph_threads')
          .select(['thread_key as key', 'occurrence_keys', 'article_ids', 'generation_hash'])
          .where('snapshot_id', '=', snapshotId)
          .orderBy('thread_key')
          .execute();
        return {
          authority: 'SHADOW_NOT_AUTHORITATIVE',
          body_retention: 'NO_BODY_REDISPLAY',
          runs,
          selected: {
            run: projectRun(selected),
            inputs,
            occurrences,
            threads,
          },
        };
      });
  }
}

@Controller('shadow/semantic')
export class EphemeralGraphInspectorController {
  constructor(
    @Inject(EphemeralGraphInspectorRepository)
    private readonly repository: EphemeralGraphInspectorRepository,
  ) {}
  @Get('graph')
  @Header('Cache-Control', 'no-store')
  read(@Query() query: Readonly<Record<string, unknown>>) {
    assertExactQueryKeys(query, ['run_id']);
    if (query.run_id !== undefined && typeof query.run_id !== 'string') throw invalidRequest();
    const runId = query.run_id === undefined ? undefined : parseUlidParameter(query.run_id);
    return this.repository.read(runId);
  }
}
