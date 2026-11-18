import { sql, type Kysely } from 'kysely';

import { comparePolls, pollTitle, readPoll, splitTitle, type PollPairVerdict, type PollText } from './poll-measurement.js';

/** On unless DIALEKTIK_POLL_DUEL_RULE is «off»: it can be switched off without a deploy. */
export function pollDuelRuleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DIALEKTIK_POLL_DUEL_RULE ?? 'on').trim().toLowerCase() !== 'off';
}

export interface PollSide {
  readonly articleId: string;
  readonly sourceId: string;
  readonly text: PollText;
}

export const pollRejectCode = (verdict: PollPairVerdict): string | null =>
  verdict.kind === 'different' ? `PAIR_POLL_${verdict.reason.toUpperCase()}` : null;

/**
 * Logs a veto or a «Distinta cifra» duel. Before migration 097 exists the
 * log is skipped and the rule still applies.
 */
export async function recordPollDecision(
  db: Kysely<unknown>,
  stage: 'candidate' | 'promotion',
  left: PollSide,
  right: PollSide,
  verdict: PollPairVerdict,
): Promise<void> {
  const outcome = verdict.kind === 'different' ? 'veto' : verdict.kind === 'same_measurement' && verdict.differentFigure ? 'distinta_cifra' : null;
  if (outcome === null) return;
  const reason = verdict.kind === 'different' ? verdict.reason : null;
  const [l, r] = [readPoll(left.text), readPoll(right.text)];
  try {
    await sql`insert into public.duel_poll_decisions(stage, outcome, reason, left_article_id, right_article_id,
        left_outlet, right_outlet, left_title, right_title, left_pollster, right_pollster)
      values (${stage}, ${outcome}, ${reason}, ${left.articleId}, ${right.articleId},
        (select name from public.sources where id::text = ${left.sourceId}), (select name from public.sources where id::text = ${right.sourceId}),
        ${left.text.title.slice(0, 300)}, ${right.text.title.slice(0, 300)}, ${l.pollster}, ${r.pollster})`.execute(db);
  } catch (error) {
    // 23505: already logged (Core cannot read the log, so no ON CONFLICT);
    // 42P01: migration 097 not applied yet.
    const code = (error as { code?: string }).code;
    if (code !== '23505' && code !== '42P01') throw error;
  }
}

/** The promotion side: «Título. Bajada…» as stored in text_original. */
export const promotionText = (textOriginal: string, publishedAt: Date): PollText => splitTitle(textOriginal, publishedAt);

/** A poll event's title names its pollster; other titles are unchanged. */
export function titleForPoll(title: string, left: PollText, right: PollText): string {
  const verdict = comparePolls(left, right);
  const pollster = readPoll(left).pollster;
  return verdict.kind === 'same_measurement' && pollster !== null ? pollTitle(title, pollster) : title;
}

/**
 * Retention: rows older than 30 days. Row security only lets moderation
 * sessions read the log, and only lets old rows be deleted.
 */
export async function purgePollDecisions(db: Kysely<unknown>): Promise<void> {
  try {
    await db.transaction().execute(async (tx) => {
      await sql`select set_config('dialektik.science_moderator', 'on', true)`.execute(tx);
      await sql`delete from public.duel_poll_decisions where decided_at < now() - interval '30 days'`.execute(tx);
    });
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error;
  }
}
