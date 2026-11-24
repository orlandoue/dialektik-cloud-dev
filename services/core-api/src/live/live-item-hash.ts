import { createHash } from 'node:crypto';

/**
 * The evidence hash of one feed item (receipts' raw_payload_hash).
 *
 * Until 24 Nov 2026 every item of a feed carried the hash of the whole feed
 * document, so any change to the feed (a new item, lastBuildDate) made every
 * item look changed and wrote a new receipt for each one on every poll:
 * 26,785 receipts for 1,388 items in a day, and the full scans of that
 * table spent Supabase's disk budget.
 *
 * Now the hash covers only what identifies and describes the item: its id in
 * the source, its canonical URL (tracking parameters already removed) and its
 * headline, excerpt and declared modification time, normalized. A feed that
 * rewrites pubDate or reorders items no longer changes it; a real edit does
 * (and also makes a new article version, which always cites a new receipt).
 * The prefix says which rule made the hash: rows are append-only and keep
 * the feed hash of their time.
 */
export const ITEM_HASH_PREFIX = 'item:v1:';

export function normalizeHashText(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return text.normalize('NFC').replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/giu, ' ').replace(/\s+/gu, ' ').trim();
}

export function itemEvidenceHash(item: {
  readonly sourceItemId: string | null;
  readonly canonicalUrl: string | null;
  readonly headline: string | null;
  readonly excerpt: string | null;
  readonly originalModifiedAt: string | null;
}): string {
  const canonical = JSON.stringify([
    1,
    (item.sourceItemId ?? '').trim(),
    item.canonicalUrl ?? '',
    normalizeHashText(item.headline),
    normalizeHashText(item.excerpt),
    (item.originalModifiedAt ?? '').trim(),
  ]);
  return `${ITEM_HASH_PREFIX}${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
