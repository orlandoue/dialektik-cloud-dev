import { isUlid, type Ulid } from '@dialektik/database';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { Database } from '@dialektik/database';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { ModerationAuthService, type ModerationIdentity } from './moderation-auth.service.js';
import { ModerationDatabaseService } from './moderation-database.service.js';
import { ModerationHttpError } from './moderation-http.error.js';

type Decision = 'ACCEPT_FOR_GROUPING' | 'NEEDS_EVIDENCE' | 'REJECT';
const DECISIONS: readonly Decision[] = ['ACCEPT_FOR_GROUPING', 'NEEDS_EVIDENCE', 'REJECT'];
const identityId = (value: unknown): Ulid => {
  if (typeof value !== 'string' || !isUlid(value))
    throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
  return value as Ulid;
};

@Injectable()
export class HeadlineReviewService {
  constructor(
    @Inject(CoreDatabaseService) private readonly reader: CoreDatabaseService,
    @Inject(ModerationAuthService) private readonly auth: ModerationAuthService,
    @Inject(ModerationDatabaseService)
    private readonly writer: ModerationDatabaseService,
  ) {}

  ensureEnabled() {
    if (process.env.DIALEKTIK_HEADLINE_REVIEW_ENABLED !== 'true') throw new NotFoundException();
  }

  async authorizeEditor(authorization: string | undefined): Promise<ModerationIdentity> {
    this.ensureEnabled();
    const identity = await this.auth.authenticate(authorization);
    if (identity.role !== 'editor') throw new ModerationHttpError(403, 'MOD_FORBIDDEN');
    const result = await sql<{ allowed: boolean }>`select exists (
      select 1 from public.editorial_single_editor_authorizations
      where editor_user_id=${identity.userId} and revoked_at is null) as allowed`.execute(
      this.reader.database,
    );
    if (result.rows[0]?.allowed !== true) throw new ModerationHttpError(403, 'MOD_FORBIDDEN');
    return identity;
  }

  async authorizeContextEditor(authorization: string | undefined): Promise<ModerationIdentity> {
    if (process.env.DIALEKTIK_CONTEXT_PAIR_ENABLED !== 'true') throw new NotFoundException();
    return this.authorizeEditor(authorization);
  }

  async listContextPairs(authorization: string | undefined) {
    const identity = await this.authorizeContextEditor(authorization);
    const result = await sql<{
      attemptId: Ulid;
      relation: string;
      leftTitle: string;
      leftSource: string;
      leftUrl: string;
      leftPublishedAt: Date;
      rightTitle: string;
      rightSource: string;
      rightUrl: string;
      rightPublishedAt: Date;
      reviewDecision: string | null;
    }>`select a.id as "attemptId",o.relation,lv.headline as "leftTitle",ls.name as "leftSource",
        la.url_canonical as "leftUrl",lv.published_at as "leftPublishedAt",
        rv.headline as "rightTitle",rs.name as "rightSource",ra.url_canonical as "rightUrl",
        rv.published_at as "rightPublishedAt",d.decision as "reviewDecision"
      from public.headline_context_pair_attempts a
      join public.headline_context_pair_outcomes o on o.attempt_id=a.id and o.outcome='VALIDATED' and o.relation<>'UNRELATED'
      join public.articles la on la.id=a.left_article_id join public.sources ls on ls.id=la.source_id
      join public.live_article_versions lv on lv.id=a.left_version_id
      join public.articles ra on ra.id=a.right_article_id join public.sources rs on rs.id=ra.source_id
      join public.live_article_versions rv on rv.id=a.right_version_id
      left join public.headline_context_pair_decisions d on d.attempt_id=a.id
      where public.dialektik_context_title_authorized(a.left_article_id,a.left_version_id,a.left_grant_id,a.left_title_sha256,${identity.userId})
        and public.dialektik_context_title_authorized(a.right_article_id,a.right_version_id,a.right_grant_id,a.right_title_sha256,${identity.userId})
        and (d.decision is null or d.decision in ('KEEP_FOR_REVIEW','NEEDS_EVIDENCE'))
      order by a.created_at desc,a.id desc limit 50`.execute(this.reader.database);
    return result.rows.map((row) => ({
      attemptId: row.attemptId,
      relation: row.relation,
      reviewDecision: row.reviewDecision,
      left: {
        title: row.leftTitle,
        sourceName: row.leftSource,
        url: row.leftUrl,
        publishedAt: row.leftPublishedAt.toISOString(),
      },
      right: {
        title: row.rightTitle,
        sourceName: row.rightSource,
        url: row.rightUrl,
        publishedAt: row.rightPublishedAt.toISOString(),
      },
    }));
  }

  async decideContextPair(
    authorization: string | undefined,
    attemptValue: unknown,
    commandValue: unknown,
    raw: unknown,
  ) {
    const identity = await this.authorizeContextEditor(authorization);
    const attemptId = identityId(attemptValue),
      commandId = identityId(commandValue);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 1 ||
      !('decision' in raw) ||
      typeof raw.decision !== 'string' ||
      !['KEEP_FOR_REVIEW', 'NEEDS_EVIDENCE', 'DISMISS'].includes(raw.decision)
    )
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    const decision = raw.decision;
    const writer = this.writer.database;
    try {
      return await writer
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (tx) => {
          await this.recheck(tx, identity);
          await sql`select set_config('dialektik.actor_id',${identity.userId},true),
          set_config('dialektik.actor_type','editor',true)`.execute(tx);
          const inserted = await sql<{ id: Ulid; attemptId: Ulid; decision: string }>`
          insert into public.headline_context_pair_decisions(id,attempt_id,reviewed_by,decision,decided_at)
          values (${commandId},${attemptId},${identity.userId},${decision},date_trunc('milliseconds',clock_timestamp()))
          on conflict do nothing returning id,attempt_id as "attemptId",decision`.execute(tx);
          if (inserted.rows[0]) return inserted.rows[0];
          const prior = await sql<{
            id: Ulid;
            attemptId: Ulid;
            reviewedBy: Ulid;
            decision: string;
          }>`
          select id,attempt_id as "attemptId",reviewed_by as "reviewedBy",decision
          from public.headline_context_pair_decisions where id=${commandId} or attempt_id=${attemptId} limit 1`.execute(
            tx,
          );
          const row = prior.rows[0];
          if (
            row?.id === commandId &&
            row.attemptId === attemptId &&
            row.reviewedBy === identity.userId &&
            row.decision === decision
          )
            return { id: row.id, attemptId: row.attemptId, decision: row.decision };
          throw new ModerationHttpError(409, 'MOD_IDEMPOTENCY_CONFLICT');
        });
    } catch (error) {
      if (error instanceof ModerationHttpError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (
        typeof code === 'string' &&
        ['23503', '23505', '23514', '40001', 'P0001', 'P0002'].includes(code)
      )
        throw new ModerationHttpError(409, 'MOD_STALE_CONTEXT');
      throw error;
    }
  }

  async list(authorization: string | undefined) {
    await this.authorizeEditor(authorization);
    const result = await sql<{
      attemptId: Ulid;
      headline: string;
      sourceName: string;
      canonicalUrl: string;
      publishedAt: Date;
      extraction: unknown;
    }>`select a.id as "attemptId", v.headline, s.name as "sourceName", article.url_canonical as "canonicalUrl",
        v.published_at as "publishedAt", outcome.extraction
      from public.headline_ai_attempts a
      join public.headline_ai_attempt_outcomes outcome on outcome.attempt_id=a.id and outcome.outcome='VALIDATED'
      join public.headline_ai_source_grants g on g.id=a.grant_id and g.revoked_at is null
        and g.valid_from<=clock_timestamp() and (g.expires_at is null or g.expires_at>clock_timestamp())
      join public.articles article on article.id=a.article_id and article.origin='LIVE_REAL'
      join public.sources s on s.id=article.source_id
      join public.live_article_versions v on v.id=a.article_version_id and v.id=(
        select id from public.live_article_versions where article_id=article.id order by version_number desc limit 1)
      where g.source_policy_id=(select id from public.live_source_policies where source_id=g.source_id
        order by recorded_at desc,id desc limit 1)
        and not exists(select 1 from public.headline_ai_review_decisions d where d.attempt_id=a.id)
      order by a.created_at desc,a.id desc limit 50`.execute(this.reader.database);
    return result.rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt.toISOString(),
    }));
  }

  async sources(authorization: string | undefined) {
    await this.authorizeEditor(authorization);
    const result = await sql<{
      sourceId: Ulid;
      sourceName: string;
      canonicalDomain: string;
      endpoint: string;
      rightsEvidenceUrl: string;
      authorizationReference: string;
      grantId: Ulid | null;
      current: boolean;
    }>`select s.id as "sourceId", s.name as "sourceName", s.canonical_domain as "canonicalDomain",
        p.policy->>'endpoint' as endpoint, p.policy->>'rightsEvidenceUrl' as "rightsEvidenceUrl",
        p.policy->>'authorizationReference' as "authorizationReference", g.id as "grantId",
        coalesce(g.source_policy_id=p.id and g.valid_from<=clock_timestamp()
          and (g.expires_at is null or g.expires_at>clock_timestamp()),false) as current
      from public.sources s join public.live_source_policies p on p.source_id=s.id and p.id=(
        select id from public.live_source_policies where source_id=s.id order by recorded_at desc,id desc limit 1)
      left join public.headline_ai_source_grants g on g.source_id=s.id and g.revoked_at is null
      where s.origin='LIVE_REAL' and p.active and p.rights_class='LIVE_READY' and p.storage_policy='METADATA_ONLY'
        and p.policy->>'rightsReviewStatus'='APPROVED' and p.policy->>'endpoint' like 'https://%'
        and p.policy->>'endpoint' <> 'https://supabase.com'
        and p.policy->>'rightsEvidenceUrl' like 'https://%' and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
        and length(trim(coalesce(p.policy->>'authorizationReference',''))) between 1 and 256
        and exists(select 1 from public.articles a join public.live_article_versions v on v.article_id=a.id
          join public.live_acquisition_receipts r on r.id=v.receipt_id and r.disposition='PERSISTED'
            and r.source_id=s.id and r.exclusion_id=a.live_exposure_id and r.canonical_url=a.url_canonical
          where a.source_id=s.id and a.origin='LIVE_REAL')
      order by s.name,s.id limit 100`.execute(this.reader.database);
    return result.rows;
  }

  async setSourceGrant(
    authorization: string | undefined,
    sourceValue: unknown,
    commandValue: unknown,
    raw: unknown,
  ) {
    const identity = await this.authorizeEditor(authorization);
    const sourceId = identityId(sourceValue);
    const commandId = identityId(commandValue);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 1 ||
      !('action' in raw) ||
      !['ENABLE', 'REVOKE'].includes(String(raw.action))
    )
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    const writer = this.writer.database;
    try {
      return await writer
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (tx) => {
          await this.recheck(tx, identity);
          await sql`select set_config('dialektik.actor_id',${identity.userId},true),
          set_config('dialektik.actor_type','editor',true)`.execute(tx);
          if (raw.action === 'REVOKE') {
            const result = await sql<{
              grantId: Ulid;
            }>`update public.headline_ai_source_grants
            set revoked_at=clock_timestamp() where source_id=${sourceId} and approved_by=${identity.userId}
              and revoked_at is null returning id as "grantId"`.execute(tx);
            if (!result.rows[0]) throw new ModerationHttpError(409, 'MOD_STALE_CONTEXT');
            return { sourceId, enabled: false };
          }
          const result = await sql<{
            grantId: Ulid;
          }>`insert into public.headline_ai_source_grants
          (id,source_id,source_policy_id,approved_by,authorization_reference,rights_evidence_url,
            provider,scope,derived_scope,valid_from,expires_at,revoked_at,created_at)
          select ${commandId},s.id,p.id,${identity.userId},p.policy->>'authorizationReference',
            p.policy->>'rightsEvidenceUrl','CLOUDFLARE_WORKERS_AI','HEADLINE_ONLY','EDITORIAL_REVIEW_ONLY',
            clock_timestamp(),null,null,clock_timestamp()
          from public.sources s join public.live_source_policies p on p.source_id=s.id and p.id=(
            select id from public.live_source_policies where source_id=s.id order by recorded_at desc,id desc limit 1)
          where s.id=${sourceId} and s.origin='LIVE_REAL' and p.active and p.rights_class='LIVE_READY'
            and p.storage_policy='METADATA_ONLY' and p.policy->>'rightsReviewStatus'='APPROVED'
            and p.policy->>'endpoint' like 'https://%' and p.policy->>'endpoint' <> 'https://supabase.com'
            and p.policy->>'rightsEvidenceUrl' like 'https://%' and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
            and length(trim(coalesce(p.policy->>'authorizationReference',''))) between 1 and 256
            and exists(select 1 from public.articles a join public.live_article_versions v on v.article_id=a.id
              join public.live_acquisition_receipts r on r.id=v.receipt_id and r.disposition='PERSISTED'
                and r.source_id=s.id and r.exclusion_id=a.live_exposure_id and r.canonical_url=a.url_canonical
              where a.source_id=s.id and a.origin='LIVE_REAL')
          on conflict do nothing returning id as "grantId"`.execute(tx);
          if (result.rows[0]) return { sourceId, enabled: true };
          const replay = await sql<{
            id: Ulid;
          }>`select id from public.headline_ai_source_grants
          where id=${commandId} and source_id=${sourceId} and approved_by=${identity.userId}
            and revoked_at is null`.execute(tx);
          if (replay.rows[0]) return { sourceId, enabled: true };
          throw new ModerationHttpError(409, 'MOD_STALE_CONTEXT');
        });
    } catch (error) {
      if (error instanceof ModerationHttpError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (typeof code === 'string' && ['23503', '23505', '23514', '40001', 'P0001'].includes(code))
        throw new ModerationHttpError(409, 'MOD_STALE_CONTEXT');
      throw error;
    }
  }

  async decide(
    authorization: string | undefined,
    attemptValue: unknown,
    commandValue: unknown,
    raw: unknown,
  ) {
    const identity = await this.authorizeEditor(authorization);
    const attemptId = identityId(attemptValue);
    const commandId = identityId(commandValue);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 1 ||
      !('decision' in raw) ||
      typeof raw.decision !== 'string' ||
      !DECISIONS.includes(raw.decision as Decision)
    )
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    const decision = raw.decision as Decision;
    const writer = this.writer.database;
    try {
      return await writer
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (tx) => {
          await this.recheck(tx, identity);
          await sql`select set_config('dialektik.actor_id',${identity.userId},true),
          set_config('dialektik.actor_type','editor',true)`.execute(tx);
          const inserted = await sql<{
            id: Ulid;
            attemptId: Ulid;
            decision: Decision;
          }>`
          insert into public.headline_ai_review_decisions(id,attempt_id,reviewed_by,decision,decided_at)
          values (${commandId},${attemptId},${identity.userId},${decision},clock_timestamp())
          on conflict do nothing returning id,attempt_id as "attemptId",decision`.execute(tx);
          if (inserted.rows[0]) return inserted.rows[0];
          const prior = await sql<{
            id: Ulid;
            attemptId: Ulid;
            reviewedBy: Ulid;
            decision: Decision;
          }>`
          select id,attempt_id as "attemptId",reviewed_by as "reviewedBy",decision
          from public.headline_ai_review_decisions where id=${commandId} or attempt_id=${attemptId} limit 1`.execute(
            tx,
          );
          const row = prior.rows[0];
          if (
            row?.id === commandId &&
            row.attemptId === attemptId &&
            row.reviewedBy === identity.userId &&
            row.decision === decision
          )
            return {
              id: row.id,
              attemptId: row.attemptId,
              decision: row.decision,
            };
          throw new ModerationHttpError(409, 'MOD_IDEMPOTENCY_CONFLICT');
        });
    } catch (error) {
      if (error instanceof ModerationHttpError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (typeof code === 'string' && ['23503', '23505', '23514', '40001', 'P0001'].includes(code))
        throw new ModerationHttpError(409, 'MOD_STALE_CONTEXT');
      throw error;
    }
  }

  private async recheck(tx: Transaction<Database>, identity: ModerationIdentity): Promise<void> {
    const result =
      identity.kind === 'beta'
        ? await sql<{ allowed: boolean }>`select exists (
          select 1 from public.editorial_beta_identities binding
          join public.private_beta_testers beta on beta.user_id=binding.auth_user_id
          join public.users u on u.id=binding.editorial_user_id
          join public.editorial_single_editor_authorizations e on e.editor_user_id=u.id
          where binding.auth_user_id=${identity.authUserId}::uuid and u.id=${identity.userId}
            and binding.enabled and binding.revoked_at is null and beta.enabled and beta.revoked_at is null
            and u.role='editor' and e.revoked_at is null and to_timestamp(${identity.tokenExpiresAt})>clock_timestamp()
        ) as allowed`.execute(tx)
        : await sql<{ allowed: boolean }>`select exists (
          select 1 from public.moderation_auth_sessions session join public.users u on u.id=session.user_id
          join public.editorial_single_editor_authorizations e on e.editor_user_id=u.id
          where session.id=${identity.sessionId} and session.token_hash=${identity.tokenHash}
            and session.revoked_at is null and session.expires_at>clock_timestamp()
            and u.id=${identity.userId} and u.role='editor' and e.revoked_at is null
        ) as allowed`.execute(tx);
    if (result.rows[0]?.allowed !== true) throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
  }
}
