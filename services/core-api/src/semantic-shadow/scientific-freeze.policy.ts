/** Owner scientific closure. Reopening requires a new explicit scientific decision. */
export const V10_11_SCIENTIFIC_STATE = 'SCIENTIFICALLY_FROZEN' as const;
export function assertV10_11ExecutionAuthorized(): void {
  throw new Error('V10_11_SCIENTIFICALLY_FROZEN_EXECUTION_FORBIDDEN');
}
