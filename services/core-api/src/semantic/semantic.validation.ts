export function requireSemanticValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Incomplete semantic data.');
  return value;
}
export function canonicalSemanticJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalSemanticJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonicalSemanticJson(child))
        .join(',') +
      '}'
    );
  }
  if (value === undefined)
    throw new Error('Semantic observations must not contain undefined fields.');
  return JSON.stringify(value);
}
