// Readers of the daily Science harvest, on recorded answers of each source.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  parseOpenAlexWork, parseEuropePmcResult, parseArxivFeed, parseScieloOai, harvestOpenAlex, harvestArxiv,
} = await import('../dist/science/harvest/harvest-sources.js');
const { runHarvest, reportMarkdown } = await import('../dist/science/harvest/harvest.js');

const openAlexWork = {
  doi: 'https://doi.org/10.1016/J.EXAMPLE.2026.01',
  display_name: 'Glaciares andinos y caudal en Chile central',
  type: 'article',
  publication_date: '2026-11-02',
  language: 'es',
  is_retracted: false,
  open_access: { is_oa: true },
  primary_location: { source: { display_name: 'Revista de Ejemplo' } },
  authorships: [
    { author: { display_name: 'Ana María Pérez' }, institutions: [{ display_name: 'Universidad de Chile', country_code: 'CL' }] },
    { author: { display_name: 'John Smith' }, institutions: [{ display_name: 'MIT', country_code: 'US' }] },
  ],
  abstract_inverted_index: { 'Los': [0], 'glaciares': [1], 'retroceden.': [2] },
};

test('OpenAlex: a work with a Chilean institution becomes a study made in Chile', () => {
  const study = parseOpenAlexWork(openAlexWork);
  assert.equal(study.doi, '10.1016/j.example.2026.01');
  assert.equal(study.review, 'peer_reviewed');
  assert.equal(study.authors, 'Pérez AM, Smith J');
  assert.equal(study.institution, 'Universidad de Chile');
  assert.equal(study.abstract, 'Los glaciares retroceden.');
  assert.equal(study.abstract_source, 'OpenAlex');
  assert.equal(study.access, 'Abierto');
  assert.equal(study.made_in_chile, true);
  assert.equal(study.harvest_source, 'openalex_cl');
  assert.equal(parseOpenAlexWork({ ...openAlexWork, doi: null }), null);
  assert.equal(parseOpenAlexWork({ ...openAlexWork, type: 'preprint' }).review, 'preprint');
});

test('OpenAlex: the request carries the key, the Chile filter and a cap', async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(new URL(url));
    return { ok: true, status: 200, async text() {
      return JSON.stringify({ results: Array.from({ length: 100 }, (_, i) => ({ ...openAlexWork, doi: `10.1000/x${urls.length}-${i}` })),
        meta: { next_cursor: `c${urls.length}` } });
    }, async json() { return {}; } };
  };
  const batch = await harvestOpenAlex({ fetcher, now: new Date('2026-11-16T12:00:00Z'), days: 30, limit: 150,
    openAlexApiKey: 'k', contactEmail: 'contacto@example.org', arxivCategories: [] });
  assert.equal(batch.studies.length, 150);
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get('api_key'), 'k');
  assert.match(urls[0].searchParams.get('filter'), /authorships\.institutions\.country_code:CL,from_publication_date:2026-10-17/u);
});

test('Europe PMC: preprints and retractions are recognised', () => {
  const base = {
    doi: '10.1101/2026.10.01.123456', title: 'Vacunación escolar en Chile.', source: 'PPR',
    authorString: 'Pérez A, Soto M.', firstPublicationDate: '2026-10-02', abstractText: '<h4>Objetivo</h4>Medir la cobertura.',
    affiliation: 'Pontificia Universidad Católica de Chile, Santiago, Chile', isOpenAccess: 'Y',
    bookOrReportDetails: { publisher: 'medRxiv' },
  };
  const preprint = parseEuropePmcResult(base);
  assert.equal(preprint.review, 'preprint');
  assert.equal(preprint.title, 'Vacunación escolar en Chile');
  assert.equal(preprint.abstract, 'Objetivo Medir la cobertura.');
  assert.equal(preprint.abstract_source, 'Europe PMC');
  assert.equal(preprint.journal, 'medRxiv');
  assert.equal(preprint.made_in_chile, true);
  const retracted = parseEuropePmcResult({ ...base, source: 'MED', journalInfo: { journal: { title: 'Rev Med Chil' } },
    pubTypeList: { pubType: ['Journal Article', 'Retracted Publication'] } });
  assert.equal(retracted.retracted, true);
  assert.equal(retracted.review, 'peer_reviewed');
});

const arxivFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2611.01234v2</id>
    <published>2026-11-10T18:00:00Z</published>
    <title>  A new population of
      dwarf galaxies </title>
    <summary>We report thirty dwarf galaxies.</summary>
    <author><name>María González</name><arxiv:affiliation>Universidad de Chile</arxiv:affiliation></author>
    <author><name>Lee Chen</name></author>
  </entry>
  <entry><id>http://arxiv.org/abs/2601.00001v1</id><published>2026-01-01T00:00:00Z</published><title>Old</title></entry>
</feed>`;

test('arXiv: preprints get their DataCite DOI and stay within the window', async () => {
  const batch = parseArxivFeed(arxivFeed);
  assert.equal(batch.studies[0].doi, '10.48550/arxiv.2611.01234');
  assert.equal(batch.studies[0].title, 'A new population of dwarf galaxies');
  assert.equal(batch.studies[0].review, 'preprint');
  assert.equal(batch.studies[0].abstract_source, 'arXiv');
  assert.equal(batch.studies[0].made_in_chile, true);
  const fetcher = async () => ({ ok: true, status: 200, async text() { return arxivFeed; }, async json() { return {}; } });
  const recent = await harvestArxiv({ fetcher, now: new Date('2026-11-16T00:00:00Z'), days: 30, limit: 100, arxivCategories: ['astro-ph.GA'] });
  assert.deepEqual(recent.studies.map((s) => s.doi), ['10.48550/arxiv.2611.01234']);
});

const oai = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><ListRecords>
  <record><header><identifier>oai:scielo:S0034-98872026000100001</identifier></header>
    <metadata><oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title xml:lang="en">Influenza in Chile</dc:title>
      <dc:title xml:lang="es">Influenza en Chile</dc:title>
      <dc:creator>Rojas, Pedro</dc:creator><dc:creator>Muñoz, Carla Andrea</dc:creator>
      <dc:description xml:lang="es">Estudio de casos de influenza.</dc:description>
      <dc:source>Revista médica de Chile v.154 n.1 2026</dc:source>
      <dc:date>2026-01-15</dc:date>
      <dc:identifier>http://www.scielo.cl/scielo.php?pid=S0034</dc:identifier>
      <dc:identifier>10.4067/S0034-98872026000100001</dc:identifier>
      <dc:language>es</dc:language>
    </oai_dc:dc></metadata></record>
  <record><header><identifier>oai:scielo:S2</identifier></header>
    <metadata><oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>Sin DOI</dc:title></oai_dc:dc></metadata></record>
  <record><header status="deleted"><identifier>oai:scielo:S3</identifier></header></record>
  <resumptionToken>token-2</resumptionToken>
</ListRecords></OAI-PMH>`;

test('SciELO: only records with a DOI enter; Spanish title and abstract first', () => {
  const page = parseScieloOai(oai);
  assert.equal(page.studies.length, 1);
  assert.equal(page.skipped, 1);
  assert.equal(page.resumptionToken, 'token-2');
  const [study] = page.studies;
  assert.equal(study.doi, '10.4067/s0034-98872026000100001');
  assert.equal(study.title, 'Influenza en Chile');
  assert.equal(study.authors, 'Rojas P, Muñoz CA');
  assert.equal(study.journal, 'Revista médica de Chile');
  assert.equal(study.abstract_source, 'SciELO');
  assert.equal(study.abstract_language, 'es');
});

test('a dry run reads every source, keeps going when one fails and reports it', async () => {
  const fetcher = async (url) => {
    if (url.includes('scielo')) return { ok: false, status: 503, async text() { return ''; }, async json() { return {}; } };
    const body = url.includes('openalex') ? JSON.stringify({ results: [openAlexWork], meta: { next_cursor: null } })
      : url.includes('europepmc') ? JSON.stringify({ resultList: { result: [] }, nextCursorMark: '*' })
      : arxivFeed;
    return { ok: true, status: 200, async text() { return body; }, async json() { return {}; } };
  };
  const report = await runHarvest(null, { fetcher, now: new Date('2026-11-16T00:00:00Z'), days: 30, limit: 50,
    arxivCategories: ['astro-ph.GA'] });
  assert.equal(report.status, 'partial');
  assert.equal(report.sources.openalex_cl.fetched, 1);
  assert.equal(report.sources.arxiv.fetched, 1);
  assert.match(report.sources.scielo_cl.error, /503/u);
  const markdown = reportMarkdown(report);
  assert.match(markdown, /Cosecha de Ciencia: parcial \(ensayo, sin base\)/u);
  assert.match(markdown, /\| SciELO Chile \| 0 \| 0 \| 0 \| 0 \| scielo answered 503 \|/u);
});

test('a source of records without DOI stops after a bounded number of pages', async () => {
  const { MAX_PAGES } = await import('../dist/science/harvest/harvest-sources.js');
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: true, status: 200, async text() {
      return JSON.stringify({ results: [{ ...openAlexWork, doi: null }], meta: { next_cursor: `c${calls}` } });
    }, async json() { return {}; } };
  };
  const batch = await harvestOpenAlex({ fetcher, now: new Date(), days: 30, limit: 100, arxivCategories: [] });
  assert.equal(calls, MAX_PAGES);
  assert.equal(batch.skipped, MAX_PAGES);
});
