/**
 * Isolated product transport failure handling. The closed candidate boundary
 * does not call or register this utility. Tests supply authored local doubles.
 * Its result remains raw and is never mapped into observations or a graph.
 */
export async function boundedShadowTransportProbe(
  probe: (signal: AbortSignal) => Promise<unknown>,
  timeoutMilliseconds: number,
): Promise<Readonly<Record<string, unknown>>> {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1)
    throw new Error('INVALID_PROVIDER_TIMEOUT');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('CANDIDATE_PROVIDER_TIMEOUT'));
      }, timeoutMilliseconds);
    });
    const raw = await Promise.race([probe(controller.signal), timeout]);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new Error('MALFORMED_SHADOW_TRANSPORT_OUTPUT');
    return raw as Readonly<Record<string, unknown>>;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
