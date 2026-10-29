const COMMON_HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&amp;': '&',
  '&quot;': '"',
  '&#34;': '"',
  '&#39;': "'",
  '&ndash;': '–',
  '&#8220;': '“',
  '&#8221;': '”',
});

/** Decode the small, explicit HTML entity set used in publisher RSS titles. */
export function decodeCommonHtmlEntities(value: string): string {
  let decoded = value;
  // RSS/XML feeds occasionally double-escape titles (for example
  // `&amp;#34;`). Resolve at most three layers and stop as soon as stable.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&(amp|quot|ndash|#34|#39|#8220|#8221);/giu, (entity) =>
      COMMON_HTML_ENTITIES[entity.toLowerCase()] ?? entity,
    );
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}
