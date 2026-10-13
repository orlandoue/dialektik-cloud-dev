export function present<T>(value: T | null | undefined): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('LLM_REQUIRED_VALUE_MISSING');
  return value;
}
export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
export function assertLLMActive(signal: AbortSignal, closed = false): void {
  if (signal.aborted || closed) throw new Error('LLM_ABORTED');
}
