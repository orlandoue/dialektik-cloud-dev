import { describe, expect, it } from 'vitest';
import { acquireGovUkHousingReadOnlyPreview } from '../src/live/govuk-housing-live-preview.js';
import { readFileSync } from 'node:fs';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const pathA = '/government/news/housing-inspection-one';
const pathB = '/government/news/housing-inspection-two';
const pubs = {
  'regulator-of-social-housing': {
    path: pathA, name: 'Regulator of Social Housing',
    id: '123e4567-e89b-42d3-a456-426614174001',
  },
  'ministry-of-housing-communities-local-government': {
    path: pathB, name: 'Ministry of Housing, Communities and Local Government',
    id: '123e4567-e89b-42d3-a456-426614174002',
  },
} as const;
function publisherFor(path: string) {
  return Object.values(pubs).find(x => x.path === path);
}
function response(data: unknown, mime = 'application/json') {
  return new Response(mime === 'text/plain' ? data as string : JSON.stringify(data), {
    status: 200, headers: { 'content-type': mime },
  });
}
function fixture(overrides: { readonly forged?: boolean; readonly blocked?: boolean;
                              readonly duplicate?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher = async (url: string | URL | Request) => {
    const u = new URL(url.toString());
    calls.push(u.href);
    if (u.origin !== 'https://www.gov.uk') throw new Error('escaped fixed origin');
    if (u.pathname === '/robots.txt') {
      return response(overrides.blocked ? 'User-agent: *\nDisallow: /api/search.json\n'
        : 'User-agent: *\nAllow: /\n', 'text/plain');
    }
    if (u.pathname === '/api/search.json') {
      const p = pubs[u.searchParams.get('filter_organisations') as keyof typeof pubs];
      if (!p) throw new Error('unknown publisher');
      return response({ results: [{ link: overrides.duplicate ? pathA : p.path }] });
    }
    if (u.pathname.startsWith('/api/content/')) {
      const path = u.pathname.slice('/api/content'.length);
      const p = publisherFor(path);
      if (!p) throw new Error('unknown document');
      return response({
        base_path: path, schema_name: 'news_article', document_type: 'press_release',
        locale: 'en', content_id: p.id,
        title: 'Housing inspection update in distinct district',
        first_published_at: '2026-10-21T09:00:00Z',
        public_updated_at: '2026-10-21T10:00:00Z',
        links: { organisations: [{ title: overrides.forged ? 'Other publisher' : p.name }] },
        details: { body: '<p>Private full-text must never leave API.</p>' },
      });
    }
    throw new Error('unexpected endpoint');
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

describe('authenticated-only housing preview body and provenance rules', () => {
  it('returns actual two independently verified source identities and only metadata', async () => {
    const { calls, fetcher } = fixture();
    const result = await acquireGovUkHousingReadOnlyPreview(fetcher, NOW);
    expect(result.verified_publishers).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(new Set(result.items.map(x => x.source_id)).size).toBe(2);
    expect(result.persisted).toBe(false);
    expect(result.generated_events).toBe(false);
    expect(result.generated_contradictions).toBe(false);
    expect(result.items.every(x => x.semantic_assignment === 'UNASSIGNED')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Private full-text');
    expect(result.items.every(x => /^[a-f0-9]{64}$/.test(x.evidence_hash))).toBe(true);
    expect(calls.length).toBe(5);
  });
  it('refuses blocked robots, spoofed issuing entity and same URL under two publishers', async () => {
    for (const options of [{ blocked: true }, { forged: true }, { duplicate: true }]) {
      const { fetcher } = fixture(options);
      await expect(acquireGovUkHousingReadOnlyPreview(fetcher, NOW))
        .rejects.toThrow('GOVUK_HOUSING_PREVIEW_VERIFICATION_FAILED');
    }
  });
  it('rejects source review expiry and all incomplete outputs', async () => {
    const { fetcher } = fixture();
    await expect(acquireGovUkHousingReadOnlyPreview(fetcher, new Date('2026-12-02T12:00:00Z')))
      .rejects.toThrow('GOVUK_HOUSING_PREVIEW_VERIFICATION_FAILED');
  });
  it('controller requires a beta bearer guard and explicit operator opt-in', () => {
    const source = readFileSync('services/core-api/src/live/private-beta-live.controller.ts', 'utf8');
    expect(source).toContain('@UseGuards(PrivateBetaAuthGuard)');
    expect(source).toContain("@Get('preview/govuk/housing')");
    expect(source).toContain("DIALEKTIK_GOVUK_HOUSING_PREVIEW_ENABLED !== 'true'");
    expect(source).not.toContain('service_role');
  });
});
