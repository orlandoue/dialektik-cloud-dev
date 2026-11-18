/**
 * Science topics from each source's own fixed taxonomy, never from AI:
 * OpenAlex's field and subfield of the primary topic, arXiv's primary
 * category, and Europe PMC as a whole for health. A source without a
 * taxonomy (SciELO through Crossref) leaves the topic empty: the study still
 * appears in «Todos» and, when it applies, in «Hecha en Chile».
 */
export const STUDY_TOPICS = [
  'salud', 'astronomia', 'biologia', 'medioambiente', 'arqueologia', 'ciencias_exactas', 'tecnologia', 'sociedad',
] as const;
export type StudyTopic = (typeof STUDY_TOPICS)[number];

export const isStudyTopic = (value: unknown): value is StudyTopic =>
  typeof value === 'string' && (STUDY_TOPICS as readonly string[]).includes(value);

/** OpenAlex's 26 fields. Physics, chemistry and mathematics are «Ciencias exactas». */
const OPENALEX_FIELDS: Record<string, StudyTopic | null> = {
  'agricultural and biological sciences': 'biologia',
  'arts and humanities': 'sociedad',
  'biochemistry, genetics and molecular biology': 'biologia',
  'business, management and accounting': 'sociedad',
  'chemical engineering': 'ciencias_exactas',
  'chemistry': 'ciencias_exactas',
  'computer science': 'tecnologia',
  'decision sciences': 'tecnologia',
  'dentistry': 'salud',
  'earth and planetary sciences': 'medioambiente',
  'economics, econometrics and finance': 'sociedad',
  'energy': 'tecnologia',
  'engineering': 'tecnologia',
  'environmental science': 'medioambiente',
  'health professions': 'salud',
  'immunology and microbiology': 'salud',
  'materials science': 'ciencias_exactas',
  'mathematics': 'ciencias_exactas',
  'medicine': 'salud',
  'neuroscience': 'salud',
  'nursing': 'salud',
  'pharmacology, toxicology and pharmaceutics': 'salud',
  'physics and astronomy': 'ciencias_exactas',
  'psychology': 'sociedad',
  'social sciences': 'sociedad',
  'veterinary': 'biologia',
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null;

/** `primary_topic` of an OpenAlex work: subfield first, then field. */
export function openAlexTopic(primaryTopic: unknown): StudyTopic | null {
  if (primaryTopic === null || typeof primaryTopic !== 'object') return null;
  const topic = primaryTopic as { subfield?: { display_name?: unknown }; field?: { display_name?: unknown } };
  const subfield = text(topic.subfield?.display_name);
  if (subfield !== null) {
    if (subfield === 'astronomy and astrophysics' || subfield === 'space and planetary science') return 'astronomia';
    if (/archa?eolog|^history$|^classics$/u.test(subfield)) return 'arqueologia';
  }
  const field = text(topic.field?.display_name);
  return field === null ? null : OPENALEX_FIELDS[field] ?? null;
}

/** arXiv primary category, e.g. «astro-ph.GA» or «q-bio.PE». */
export function arxivTopic(category: string | null | undefined): StudyTopic | null {
  const c = text(category);
  if (c === null) return null;
  if (c.startsWith('astro-ph')) return 'astronomia';
  if (c === 'physics.ao-ph' || c === 'physics.geo-ph') return 'medioambiente';
  if (c === 'physics.med-ph') return 'salud';
  if (c === 'physics.bio-ph' || c.startsWith('q-bio')) return 'biologia';
  if (c === 'physics.soc-ph' || c === 'physics.ed-ph' || c === 'physics.hist-ph' || c.startsWith('econ') || c.startsWith('q-fin')) return 'sociedad';
  if (c.startsWith('cs.') || c.startsWith('eess')) return 'tecnologia';
  if (c.startsWith('math') || c.startsWith('stat')) return 'ciencias_exactas';
  if (/^(cond-mat|hep-|nucl-|gr-qc|quant-ph|physics|nlin)/u.test(c)) return 'ciencias_exactas';
  return null;
}
