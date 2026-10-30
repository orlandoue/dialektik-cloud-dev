import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  Module,
  Query,
  type DynamicModule,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@dialektik/database';
import { parseUlid } from '@dialektik/database';
import {
  EphemeralGraphInspectorController,
  EphemeralGraphInspectorRepository,
} from './ephemeral.graph-inspector.js';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { assertLiveDatabase } from '../live/live.sync.js';
import { assertExactQueryKeys } from '../public-api/public-api.validation.js';

interface InspectorRow {
  id: string;
  headline: string | null;
  canonical_url: string | null;
  source_id: string;
  source_name: string;
  content_access_mode: string;
  processing_state: string;
  version_id: string | null;
  version_number: number | null;
  acquired_content_hash: string | null;
  normalized_input_hash: string | null;
  title_input_hash: string | null;
  normalization_version: string | null;
  input_codepoint_length: number | null;
  title_codepoint_length: number | null;
  acquired_at: Date | null;
  envelope_id: string | null;
  provider_type: string | null;
  provider_version: string | null;
  provider_run_id: string | null;
  input_provenance: string | null;
  candidate_commit: string | null;
  runtime_python: string | null;
  runtime_model: string | null;
  reproducibility_class: string | null;
  processed_at: Date | null;
  source_version_status: string | null;
}

/** Read-only development projection. It never selects persisted_body or acquired bytes. */
export class EphemeralInspectorRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async read() {
    return this.database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        await sql`set transaction read only`.execute(tx);
        const rows = await sql<InspectorRow>`
        select a.id, case when (case when p.id is not null then p.redisplay is true
          else legacy.active is true and legacy.rights_class='LIVE_READY' and legacy_receipt.authorized is true end)
          then coalesce(v.original_title,m.headline) else null end as headline,
          case when (case when p.id is not null then p.external_source_link is true
          else legacy.active is true and legacy.rights_class='LIVE_READY' and legacy_receipt.authorized is true end)
          then a.url_canonical else null end as canonical_url, s.id as source_id, s.name as source_name,
          coalesce(vp.content_access_mode,p.content_access_mode,'METADATA_ONLY') as content_access_mode,
          case when failure.failed_at > coalesce(pr.recorded_at,e.processed_at,'-infinity'::timestamptz)
            then 'PROCESSING_FAILED' else coalesce(pr.processing_state,case when p.metadata_storage and p.fulltext_acquisition and p.fulltext_machine_processing
            and p.derived_semantic_persistence and p.content_access_mode <> 'METADATA_ONLY'
            then 'ELIGIBLE_UNPROCESSED' else 'NOT_ELIGIBLE' end) end as processing_state,
          v.id as version_id, v.version_number, v.acquired_content_hash, v.normalized_input_hash,
          v.title_input_hash, v.normalization_version, v.input_codepoint_length, v.title_codepoint_length, v.acquired_at,
          e.id as envelope_id, e.provider_type, e.provider_version, e.provider_run_id,
          run.input_provenance, run.candidate_commit, run.runtime_python, run.runtime_model,
          coalesce(ref.reproducibility_class,e.reproducibility_class) as reproducibility_class,
          e.processed_at, ref.source_version_status
        from articles a join sources s on s.id=a.source_id
        left join lateral (select headline from live_article_versions where article_id=a.id
          order by version_number desc limit 1) m on true
        left join lateral (select * from content_access_policies where source_id=s.id
          order by recorded_at desc,id desc limit 1) p on true
        left join lateral (select * from live_source_policies where source_id=s.id
          order by recorded_at desc,id desc limit 1) legacy on true
        left join lateral (select true as authorized from live_acquisition_receipts
          where exclusion_id=a.live_exposure_id and source_id=s.id and policy_id=legacy.id
          and disposition='PERSISTED' limit 1) legacy_receipt on true
        left join lateral (select * from observed_article_content_versions where article_id=a.id
          order by version_number desc limit 1) v on true
        left join content_access_policies vp on vp.id=v.policy_id
        left join lateral (select * from semantic_processing_records where article_version_id=v.id
          order by recorded_at desc,sequence_number desc,id desc limit 1) pr on true
        left join lateral (select * from semantic_envelopes where article_version_id=v.id
          order by processed_at desc,id desc limit 1) e on true
        left join semantic_provider_runs run on run.id=e.provider_run_id
        left join lateral (select failed_at from semantic_processing_failures where article_id=a.id
          order by failed_at desc,id desc limit 1) failure on true
        left join lateral (select * from semantic_refetch_verifications where article_version_id=v.id
          order by verified_at desc,id desc limit 1) ref on true
        where a.origin='LIVE_REAL' order by a.captured_at,a.id
      `.execute(tx);
        const articles = [];
        for (const row of rows.rows) {
          const evidence =
            row.envelope_id === null
              ? []
              : await tx
                  .selectFrom('evidence_fingerprints')
                  .select(['field', 'field_hash', 'span_start', 'span_end', 'span_hash'])
                  .where('envelope_id', '=', parseUlid(row.envelope_id))
                  .orderBy('id')
                  .execute();
          const proposals =
            row.envelope_id === null
              ? []
              : await tx
                  .selectFrom('semantic_article_proposals')
                  .select([
                    'action',
                    'reason_code',
                    'proposed_occurrence_key',
                    'proposed_thread_key',
                    'partial_occurrence_creation',
                  ])
                  .where('envelope_id', '=', parseUlid(row.envelope_id))
                  .orderBy('id')
                  .execute();
          const applicability =
            row.envelope_id === null
              ? []
              : await tx
                  .selectFrom('semantic_candidate_applicability')
                  .select(['scope', 'target_key', 'outcome'])
                  .where('envelope_id', '=', parseUlid(row.envelope_id))
                  .orderBy('id')
                  .execute();
          const observations =
            row.envelope_id === null
              ? []
              : await tx
                  .selectFrom('derived_semantic_observations')
                  .select([
                    'observation_key',
                    'decision',
                    'applicability',
                    'proposed_occurrence_key',
                    'proposed_thread_key',
                  ])
                  .where('envelope_id', '=', parseUlid(row.envelope_id))
                  .orderBy('id')
                  .execute();
          // Evidence text redisplay is independent from retaining a minimal quote.
          // Until a redisplay-specific projection is authenticated, expose locators only.
          articles.push({
            id: row.id,
            headline: row.headline,
            canonical_url: row.canonical_url,
            source: { id: row.source_id, name: row.source_name },
            content_access_mode: row.content_access_mode,
            semantic_processing_state: row.processing_state,
            body: null,
            authoritative_semantic_assignment: 'UNASSIGNED',
            version:
              row.version_id === null
                ? null
                : {
                    id: row.version_id,
                    version_number: row.version_number,
                    acquired_content_hash: row.acquired_content_hash,
                    normalized_input_hash: row.normalized_input_hash,
                    title_input_hash: row.title_input_hash,
                    normalization_version: row.normalization_version,
                    input_codepoint_length: row.input_codepoint_length,
                    title_codepoint_length: row.title_codepoint_length,
                    observed_at: row.acquired_at?.toISOString(),
                  },
            envelope:
              row.envelope_id === null
                ? null
                : {
                    id: row.envelope_id,
                    provider_type: row.provider_type,
                    provider_version: row.provider_version,
                    provider_run_id: row.provider_run_id,
                    input_provenance: row.input_provenance,
                    candidate_commit: row.candidate_commit,
                    runtime_python: row.runtime_python,
                    runtime_model: row.runtime_model,
                    reproducibility_class: row.reproducibility_class,
                    processed_at: row.processed_at?.toISOString(),
                    source_version_status: row.source_version_status ?? 'UNVERIFIED',
                    evidence: evidence.map((locator) => ({ ...locator, retained_quote: null })),
                    observations,
                    article_proposals: proposals,
                    candidate_applicability: applicability,
                  },
          });
        }
        return {
          authority: 'SHADOW_NOT_AUTHORITATIVE',
          body_retention: 'NO_EPHEMERAL_BODY',
          articles,
        };
      });
  }
}

@Injectable()
export class EphemeralInspectorService {
  constructor(
    @Inject(EphemeralInspectorRepository) private readonly repository: EphemeralInspectorRepository,
  ) {}
  read() {
    return this.repository.read();
  }
}

@Controller('shadow/semantic')
export class EphemeralInspectorController {
  constructor(
    @Inject(EphemeralInspectorService) private readonly service: EphemeralInspectorService,
  ) {}
  @Get('content')
  @Header('Cache-Control', 'no-store')
  read(@Query() query: Readonly<Record<string, unknown>>) {
    assertExactQueryKeys(query, []);
    return this.service.read();
  }
}

@Module({})
export class EphemeralInspectorModule {
  static register(config: Readonly<CoreApiConfig>): DynamicModule {
    if (config.nodeEnvironment === 'production' || config.semanticMode !== 'unassigned')
      return { module: EphemeralInspectorModule };
    assertLiveDatabase(config);
    return {
      module: EphemeralInspectorModule,
      controllers: [EphemeralInspectorController, EphemeralGraphInspectorController],
      providers: [
        {
          provide: EphemeralGraphInspectorRepository,
          inject: [CoreDatabaseService],
          useFactory: (database: CoreDatabaseService) =>
            new EphemeralGraphInspectorRepository(database.database),
        },
        {
          provide: EphemeralInspectorRepository,
          inject: [CoreDatabaseService],
          useFactory: (database: CoreDatabaseService) =>
            new EphemeralInspectorRepository(database.database),
        },
        EphemeralInspectorService,
      ],
    };
  }
}
