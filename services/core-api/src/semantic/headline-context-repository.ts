import { generateUlid, type Database, type Ulid } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import { rankContextPairs, type ContextHeadline } from './headline-context-pairs.js';
import type { ContextPairHooks } from './headline-context-runner.js';
import type { HeadlineSemanticGrant } from './headline-semantic-runner.js';

type CandidateRow = Omit<ContextHeadline, 'publishedAt'> & { publishedAt: Date };
type GrantRow = Omit<
  HeadlineSemanticGrant,
  'rightsReviewStatus' | 'storagePolicy' | 'validFrom' | 'expiresAt'
> & {
  rightsReviewStatus: string;
  storagePolicy: string;
  validFrom: Date;
  expiresAt: Date | null;
};

export class HeadlineContextRepository {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly editorId: Ulid,
    private readonly model: string,
    private readonly configHash: string,
  ) {}

  /** Candidate ranking never treats publication time as the date of an occurrence. */
  async nextPair(): Promise<Readonly<{ left: ContextHeadline; right: ContextHeadline }> | null> {
    const candidates = await sql<CandidateRow>`
      select a.id::text as "articleId",v.id::text as "versionId",s.id::text as "sourceId",
        p.id as "policyId",s.canonical_domain as "canonicalDomain",a.url_canonical as "canonicalUrl",
        v.headline,v.published_at as "publishedAt",g.id::text as "grantId"
      from public.articles a join public.sources s on s.id=a.source_id and s.origin='LIVE_REAL'
      join public.live_article_versions v on v.article_id=a.id and v.id=(
        select id from public.live_article_versions where article_id=a.id order by version_number desc limit 1)
      join public.live_acquisition_receipts r on r.id=v.receipt_id and r.disposition='PERSISTED'
        and r.source_id=s.id and r.exclusion_id=a.live_exposure_id and r.canonical_url=a.url_canonical
      join public.live_source_policies p on p.source_id=s.id and p.id=(
        select id from public.live_source_policies where source_id=s.id order by recorded_at desc,id desc limit 1)
        and p.active and p.rights_class='LIVE_READY' and p.storage_policy='METADATA_ONLY'
        and p.policy->>'rightsReviewStatus'='APPROVED'
      join public.headline_ai_source_grants g on g.source_id=s.id and g.source_policy_id=p.id
        and g.revoked_at is null and g.valid_from<=clock_timestamp()
        and (g.expires_at is null or g.expires_at>clock_timestamp())
        and g.provider='CLOUDFLARE_WORKERS_AI' and g.scope='HEADLINE_ONLY' and g.derived_scope='EDITORIAL_REVIEW_ONLY'
      join public.users approver on approver.id=g.approved_by and approver.role='editor'
      join public.editorial_single_editor_authorizations approval on approval.editor_user_id=approver.id and approval.revoked_at is null
      where a.origin='LIVE_REAL' and v.published_at is not null and char_length(v.headline) between 1 and 512
        and btrim(v.headline)<>'' and v.headline !~ '[[:cntrl:]]'
        and (a.url_canonical like ('https://' || s.canonical_domain || '/%')
          or a.url_canonical like ('https://www.' || s.canonical_domain || '/%'))
        and coalesce((select case when jsonb_typeof(q.policy->'quarantinedArticleIds')='array'
          then not (q.policy->'quarantinedArticleIds' @> jsonb_build_array(a.id::text)) else false end
          from public.live_source_policies q where q.source_id=a.source_id and q.policy ? 'quarantinedArticleIds'
          order by q.recorded_at desc,q.id desc limit 1),true)
      order by v.published_at desc,a.id desc limit 150`.execute(this.database);
    if (candidates.rows.length < 2) return null;
    const versionIds = candidates.rows.map((row) => row.versionId);
    const attempted = await sql<{
      leftVersion: string;
      rightVersion: string;
      leftGrant: string;
      rightGrant: string;
    }>`
      select left_version_id::text as "leftVersion",right_version_id::text as "rightVersion",
        left_grant_id::text as "leftGrant",right_grant_id::text as "rightGrant"
      from public.headline_context_pair_attempts where model=${this.model} and config_sha256=${this.configHash}
        and left_version_id::text=any(${versionIds}::text[]) and right_version_id::text=any(${versionIds}::text[])
    `.execute(this.database);
    const seen = new Set(
      attempted.rows.map((row) =>
        [row.leftVersion, row.rightVersion, row.leftGrant, row.rightGrant].join(':'),
      ),
    );
    const inputs = candidates.rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt.toISOString(),
    }));
    const pair = rankContextPairs(inputs).find(
      ({ left, right }) =>
        !seen.has([left.versionId, right.versionId, left.grantId, right.grantId].join(':')),
    );
    return pair ? { left: pair.left, right: pair.right } : null;
  }

  hooks(): ContextPairHooks {
    let leased: Kysely<Database> | null = null;
    const connection = () => {
      if (!leased) throw new Error('CONTEXT_RIGHTS_LEASE_REQUIRED');
      return leased;
    };
    return {
      withRightsLeases: async (left, right, signal, work) => {
        if (leased || signal.aborted) throw new Error('CONTEXT_RIGHTS_LEASE_INVALID');
        return this.database.connection().execute(async (db) => {
          const keys = [left.sourceId, right.sourceId]
            .sort()
            .map((source) => `headline-grant:${source}`);
          const locked: string[] = [];
          try {
            for (const key of keys) {
              await sql`select pg_advisory_lock(hashtextextended(${key},0))`.execute(db);
              locked.push(key);
            }
            leased = db;
            if (signal.aborted) throw new Error('CONTEXT_ABORTED');
            return await work();
          } finally {
            leased = null;
            let unlockFailed = false;
            for (const key of locked.reverse()) {
              try {
                const result = await sql<{
                  unlocked: boolean;
                }>`select pg_advisory_unlock(hashtextextended(${key},0)) as unlocked`.execute(db);
                if (result.rows[0]?.unlocked !== true) unlockFailed = true;
              } catch {
                unlockFailed = true;
              }
            }
            if (unlockFailed) throw new Error('CONTEXT_RIGHTS_UNLOCK_FAILED');
          }
        });
      },
      currentGrant: async (input): Promise<HeadlineSemanticGrant | null> => {
        const result =
          await sql<GrantRow>`select g.source_id::text as "sourceId",g.source_policy_id as "policyId",
          g.id::text as "decisionId",g.approved_by::text as "approvedBy",g.authorization_reference as "authorizationReference",
          g.rights_evidence_url as "rightsEvidenceUrl",(p.active and g.revoked_at is null) as active,
          p.policy->>'rightsReviewStatus' as "rightsReviewStatus",p.storage_policy as "storagePolicy",
          (g.provider='CLOUDFLARE_WORKERS_AI' and g.scope='HEADLINE_ONLY') as "allowCloudflareHeadline",
          (g.derived_scope='EDITORIAL_REVIEW_ONLY') as "allowDerivedEditorialReview",g.valid_from as "validFrom",g.expires_at as "expiresAt"
        from public.headline_ai_source_grants g join public.live_source_policies p on p.id=g.source_policy_id and p.source_id=g.source_id
        join public.users u on u.id=g.approved_by and u.role='editor'
        join public.editorial_single_editor_authorizations e on e.editor_user_id=u.id and e.revoked_at is null
        where g.id=${input.grantId} and g.source_id=${input.sourceId} and g.source_policy_id=${input.policyId}
          and g.revoked_at is null and p.id=(select id from public.live_source_policies
            where source_id=g.source_id order by recorded_at desc,id desc limit 1)`.execute(
            connection(),
          );
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
      reserveAttempt: async (left, right, leftHash, rightHash) => {
        const id = generateUlid({ now: Date.now });
        await sql`insert into public.headline_context_pair_attempts
          (id,left_article_id,left_version_id,left_grant_id,left_title_sha256,right_article_id,right_version_id,
           right_grant_id,right_title_sha256,requested_by,model,config_sha256,created_at)
          values (${id},${left.articleId},${left.versionId},${left.grantId},${leftHash},${right.articleId},${right.versionId},
            ${right.grantId},${rightHash},${this.editorId},${this.model},${this.configHash},date_trunc('milliseconds',clock_timestamp()))`.execute(
          connection(),
        );
        return id;
      },
      finishAttempt: async (id, outcome, relation) => {
        const anchor = relation?.anchor;
        await sql`insert into public.headline_context_pair_outcomes
          (attempt_id,outcome,relation,left_start,left_end,right_start,right_end,recorded_at,model_relation)
          values (${id},${outcome},${relation?.relation ?? null},${anchor?.leftStart ?? null},${anchor?.leftEnd ?? null},
            ${anchor?.rightStart ?? null},${anchor?.rightEnd ?? null},date_trunc('milliseconds',clock_timestamp()),
            ${relation?.modelRelation ?? null})`.execute(connection());
      },
    };
  }
}
