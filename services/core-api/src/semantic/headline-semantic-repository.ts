import { generateUlid, type Database, type Ulid } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import type {
  HeadlineSemanticGrant,
  HeadlineSemanticHooks,
  HeadlineSemanticInput,
} from './headline-semantic-runner.js';

interface GrantRow {
  sourceId: string;
  policyId: string;
  decisionId: string;
  approvedBy: string;
  authorizationReference: string;
  rightsEvidenceUrl: string;
  active: boolean;
  rightsReviewStatus: string;
  storagePolicy: string;
  allowCloudflareHeadline: boolean;
  allowDerivedEditorialReview: boolean;
  validFrom: Date;
  expiresAt: Date | null;
}

/** Dedicated writer connection; the usual Core reader never gains write access. */
export class HeadlineSemanticRepository {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly editorId: Ulid,
    private readonly model: string,
    private readonly configHash: string,
  ) {}

  /** Only current, unquarantined publisher metadata with an explicit title grant is eligible. */
  async eligible(limit: number): Promise<HeadlineSemanticInput[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30)
      throw new Error('HEADLINE_LIMIT_INVALID');
    const result = await sql<HeadlineSemanticInput>`
      select a.id::text as "articleId", v.id::text as "versionId", s.id::text as "sourceId",
        p.id as "policyId", s.canonical_domain as "canonicalDomain",
        a.url_canonical as "canonicalUrl", v.headline
      from public.articles a join public.sources s on s.id=a.source_id and s.origin='LIVE_REAL'
      join public.live_article_versions v on v.article_id=a.id and v.id=(
        select id from public.live_article_versions where article_id=a.id order by version_number desc limit 1)
      join public.live_acquisition_receipts r on r.id=v.receipt_id and r.source_id=s.id
        and r.disposition='PERSISTED' and r.exclusion_id=a.live_exposure_id and r.canonical_url=a.url_canonical
      join public.live_source_policies p on p.source_id=s.id and p.id=(
        select id from public.live_source_policies where source_id=s.id order by recorded_at desc,id desc limit 1)
        and p.active and p.rights_class='LIVE_READY' and p.storage_policy='METADATA_ONLY'
        and p.policy->>'rightsReviewStatus'='APPROVED'
      join public.headline_ai_source_grants g on g.source_id=s.id and g.source_policy_id=p.id
        and g.revoked_at is null and g.valid_from<=clock_timestamp()
        and (g.expires_at is null or g.expires_at>clock_timestamp())
        and g.provider='CLOUDFLARE_WORKERS_AI' and g.scope='HEADLINE_ONLY'
        and g.derived_scope='EDITORIAL_REVIEW_ONLY'
      where a.origin='LIVE_REAL' and char_length(v.headline) between 1 and 512
        and btrim(v.headline)<>'' and v.headline !~ '[[:cntrl:]]'
        and (a.url_canonical like ('https://' || s.canonical_domain || '/%')
          or a.url_canonical like ('https://www.' || s.canonical_domain || '/%'))
        and coalesce((select case
        when jsonb_typeof(q.policy->'quarantinedArticleIds')='array'
        then not (q.policy->'quarantinedArticleIds' @> jsonb_build_array(a.id::text)) else false end
        from public.live_source_policies q where q.source_id=a.source_id and q.policy ? 'quarantinedArticleIds'
        order by q.recorded_at desc,q.id desc limit 1),true)
        and not exists(select 1 from public.headline_ai_attempts attempted
          where attempted.article_version_id=v.id and attempted.grant_id=g.id
            and attempted.model=${this.model} and attempted.config_sha256=${this.configHash})
      order by v.published_at desc,a.id desc limit ${limit}
    `.execute(this.database);
    return result.rows;
  }

  hooks(): HeadlineSemanticHooks {
    let leased: Kysely<Database> | null = null;
    const connection = () => {
      if (leased === null) throw new Error('HEADLINE_RIGHTS_LEASE_REQUIRED');
      return leased;
    };
    return {
      withRightsLease: async (input, signal, work) => {
        if (leased !== null || signal.aborted) throw new Error('HEADLINE_RIGHTS_LEASE_INVALID');
        return this.database.connection().execute(async (db) => {
          const lockKey = `headline-grant:${input.sourceId}`;
          await sql`select pg_advisory_lock(hashtextextended(${lockKey},0))`.execute(db);
          leased = db;
          try {
            if (signal.aborted) throw new Error('HEADLINE_ABORTED');
            return await work();
          } finally {
            leased = null;
            const result = await sql<{ unlocked: boolean }>`
              select pg_advisory_unlock(hashtextextended(${lockKey},0)) as unlocked
            `.execute(db);
            if (result.rows[0]?.unlocked !== true) throw new Error('HEADLINE_RIGHTS_UNLOCK_FAILED');
          }
        });
      },
      currentGrant: async (input): Promise<HeadlineSemanticGrant | null> => {
        const result = await sql<GrantRow>`
          select g.source_id::text as "sourceId", g.source_policy_id as "policyId",
            g.id::text as "decisionId", g.approved_by::text as "approvedBy",
            g.authorization_reference as "authorizationReference", g.rights_evidence_url as "rightsEvidenceUrl",
            (p.active and g.revoked_at is null) as active,
            p.policy->>'rightsReviewStatus' as "rightsReviewStatus", p.storage_policy as "storagePolicy",
            (g.provider='CLOUDFLARE_WORKERS_AI' and g.scope='HEADLINE_ONLY') as "allowCloudflareHeadline",
            (g.derived_scope='EDITORIAL_REVIEW_ONLY') as "allowDerivedEditorialReview",
            g.valid_from as "validFrom", g.expires_at as "expiresAt"
          from public.headline_ai_source_grants g
          join public.live_source_policies p on p.id=g.source_policy_id and p.source_id=g.source_id
          join public.users u on u.id=g.approved_by and u.role='editor'
          join public.editorial_single_editor_authorizations e on e.editor_user_id=u.id and e.revoked_at is null
          where g.source_id=${input.sourceId} and g.source_policy_id=${input.policyId}
            and g.revoked_at is null and p.id=(select id from public.live_source_policies
              where source_id=g.source_id order by recorded_at desc,id desc limit 1)
          order by g.created_at desc,g.id desc limit 1
        `.execute(connection());
        const row = result.rows[0];
        if (!row) return null;
        return {
          ...row,
          rightsReviewStatus: row.rightsReviewStatus === 'APPROVED' ? 'APPROVED' : 'PENDING',
          storagePolicy:
            row.storagePolicy === 'METADATA_ONLY' ? 'METADATA_ONLY' : 'METADATA_AND_FEED_EXCERPT',
          validFrom: row.validFrom.toISOString(),
          expiresAt: row.expiresAt?.toISOString() ?? null,
        };
      },
      reserveAttempt: async (input: HeadlineSemanticInput, titleHash: string) => {
        const id = generateUlid({ now: Date.now });
        const grant = await sql<{
          id: Ulid;
        }>`select id from public.headline_ai_source_grants
          where source_id=${input.sourceId} and source_policy_id=${input.policyId} and revoked_at is null
          order by created_at desc,id desc limit 1`.execute(connection());
        if (!grant.rows[0]) throw new Error('HEADLINE_RIGHTS_DENIED');
        await sql`insert into public.headline_ai_attempts
          (id,grant_id,source_id,source_policy_id,article_id,article_version_id,requested_by,title_sha256,model,config_sha256,created_at)
          values (${id},${grant.rows[0].id},${input.sourceId},${input.policyId},${input.articleId},${input.versionId},
            ${this.editorId},${titleHash},${this.model},${this.configHash},clock_timestamp())`.execute(
          connection(),
        );
        return id;
      },
      finishAttempt: async (id, outcome, extraction, rejectionCode) => {
        const payload = extraction === undefined ? null : JSON.stringify(extraction);
        await sql`insert into public.headline_ai_attempt_outcomes(attempt_id,outcome,extraction,recorded_at,rejection_code)
          values (${id},${outcome},${payload}::jsonb,clock_timestamp(),${rejectionCode ?? null})`.execute(
          connection(),
        );
      },
    };
  }
}
