const SAFE_MESSAGES = new Set([
  'PERSISTENCE_FAILED',
  'RIGHTS_DENIED',
  'INPUT_INVALID',
  'NORMALIZATION_FAILED',
  'PROSPECTIVE_RUN_ABORTED',
  'PROSPECTIVE_RETAINED_INPUT_MISMATCH',
  'PROSPECTIVE_RUN_REGISTRATION_MISMATCH',
]);

/** PostgreSQL DETAIL can contain a failing full-text row; never preserve the raw cause. */
export function bodyFreePersistenceError(error: unknown, fallback: string): Error {
  const message =
    error instanceof Error && SAFE_MESSAGES.has(error.message) ? error.message : fallback;
  const rawCode =
    error !== null && typeof error === 'object'
      ? (error as Record<string, unknown>).code
      : undefined;
  const code = typeof rawCode === 'string' && /^[0-9A-Z]{5}$/.test(rawCode) ? rawCode : undefined;
  const safe = new Error(
    message,
    code === undefined ? undefined : { cause: { databaseCode: code } },
  );
  if (code !== undefined) Object.defineProperty(safe, 'code', { value: code, enumerable: true });
  return safe;
}
