/**
 * Canonical source offsets are zero-based half-open Unicode code-point
 * intervals. Array.from is intentional: direct JavaScript string indexing is
 * UTF-16-code-unit based and would misaddress non-BMP source text.
 */
export const UNICODE_CODE_POINT_OFFSET_ENCODING = 'unicode_code_point_v1' as const;

function codePoints(source: string): string[] {
  return Array.from(source);
}

export function unicodeCodePointLength(source: string): number {
  return codePoints(source).length;
}

export function unicodeCodePointSlice(source: string, start: number, end: number): string {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error('Canonical offsets must be integers.');
  }
  const points = codePoints(source);
  if (start < 0 || end < start || end > points.length) {
    throw new Error('Canonical offsets are out of source bounds.');
  }
  return points.slice(start, end).join('');
}
