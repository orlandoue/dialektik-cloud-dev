// C2 lookup: what the reader writes, and the candidates that come back.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { classifyLookup, searchByTitle, resolveArxiv } = await import('../dist/science/study-lookup.js');

test('a DOI, a link with a DOI, an arXiv link or a title are told apart', () => {
  const cases = [
    ['10.7326/M18-2101', { kind: 'doi', doi: '10.7326/m18-2101' }],
    ['https://doi.org/10.7326/M18-2101', { kind: 'doi', doi: '10.7326/m18-2101' }],
    ['https://www.acpjournals.org/doi/10.7326/M18-2101?utm=x', { kind: 'doi', doi: '10.7326/m18-2101' }],
    ['https://link.springer.com/article/10.1007%2Fs10654-019-00512-4', { kind: 'doi', doi: '10.1007/s10654-019-00512-4' }],
    ['Ver (doi: 10.1016/S0140-6736(97)11096-0).', { kind: 'doi', doi: '10.1016/s0140-6736(97)11096-0' }],
    ['https://arxiv.org/abs/2401.12345v3', { kind: 'doi', doi: '10.48550/arxiv.2401.12345' }],
    ['https://arxiv.org/pdf/2401.12345.pdf', { kind: 'doi', doi: '10.48550/arxiv.2401.12345' }],
    ['arXiv:2401.12345', { kind: 'doi', doi: '10.48550/arxiv.2401.12345' }],
    ['https://www.nature.com/articles/s41586-024-00001-x', { kind: 'link_without_doi' }],
    ['  Measles, mumps,   rubella vaccination and autism ', { kind: 'title', text: 'Measles, mumps, rubella vaccination and autism' }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(classifyLookup(input), expected, input);
});

const crossref = { message: { items: [
  { DOI: '10.7326/M18-2101', title: ['Measles, Mumps, Rubella Vaccination and Autism'], author: [{ family: 'Hviid', given: 'Anders' }],
    'container-title': ['Annals of Internal Medicine'], published: { 'date-parts': [[2019, 4, 16]] }, type: 'journal-article' },
  { DOI: '10.1000/second', title: ['Second'], type: 'posted-content' },
] } };
const openalex = { results: [
  { doi: 'https://doi.org/10.7326/m18-2101', display_name: 'Duplicate of the first', publication_year: 2019 },
  { doi: 'https://doi.org/10.1000/openalex', display_name: 'From OpenAlex', publication_year: 2020, type: 'article',
    authorships: [{ author: { display_name: 'Ana Pérez' } }] },
] };
const arxiv = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.12345v1</id>
  <published>2024-01-22T00:00:00Z</published><title>A preprint</title><summary>Abstract.</summary>
  <author><name>Lee Chen</name></author></entry></feed>`;

function fetcherFor(urls) {
  return async (url) => {
    urls.push(new URL(url));
    const body = url.includes('crossref') ? JSON.stringify(crossref) : url.includes('openalex') ? JSON.stringify(openalex) : arxiv;
    return { ok: true, status: 200, async text() { return body; } };
  };
}

test('a title returns three candidates, one per source first, without repeats', async () => {
  const urls = [];
  const found = await searchByTitle('measles mumps rubella autism', fetcherFor(urls), { openAlexApiKey: 'k', contactEmail: 'contacto@example.org' });
  assert.deepEqual(found.map((c) => c.doi), ['10.7326/m18-2101', '10.1000/openalex', '10.48550/arxiv.2401.12345']);
  assert.deepEqual(found[0], { doi: '10.7326/m18-2101', title: 'Measles, Mumps, Rubella Vaccination and Autism', authors: 'Hviid A',
    journal: 'Annals of Internal Medicine', year: 2019, review: 'peer_reviewed' });
  assert.equal(found[2].review, 'preprint');
  const byHost = Object.fromEntries(urls.map((u) => [u.hostname, u]));
  assert.equal(byHost['api.crossref.org'].searchParams.get('query.bibliographic'), 'measles mumps rubella autism');
  assert.equal(byHost['api.crossref.org'].searchParams.get('mailto'), 'contacto@example.org');
  assert.equal(byHost['api.openalex.org'].searchParams.get('api_key'), 'k');
  assert.equal(byHost['export.arxiv.org'].searchParams.get('search_query'), 'ti:"measles mumps rubella autism"');
  // Only metadata APIs are called.
  assert.ok(urls.every((u) => ['api.crossref.org', 'api.openalex.org', 'export.arxiv.org'].includes(u.hostname)));
});

test('one source down still leaves the others', async () => {
  const fetcher = async (url) => (url.includes('crossref')
    ? { ok: false, status: 503, async text() { return ''; } }
    : { ok: true, status: 200, async text() { return url.includes('openalex') ? JSON.stringify(openalex) : arxiv; } });
  const found = await searchByTitle('autism', fetcher);
  assert.deepEqual(found.map((c) => c.doi), ['10.7326/m18-2101', '10.48550/arxiv.2401.12345', '10.1000/openalex']);
});

test('an arXiv DOI is described by arXiv itself', async () => {
  const urls = [];
  const study = await resolveArxiv('10.48550/arxiv.2401.12345', fetcherFor(urls));
  assert.equal(urls[0].searchParams.get('id_list'), '2401.12345');
  assert.equal(study.title, 'A preprint');
  assert.equal(study.review, 'preprint');
  assert.equal(study.abstract_source, 'arXiv');
  assert.equal('harvest_source' in study, false);
  assert.equal(await resolveArxiv('10.7326/m18-2101', fetcherFor([])), null);
});
