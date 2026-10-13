import { createHash } from 'node:crypto';
export async function listGeminiModels(targets: readonly string[], request: typeof fetch = fetch) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw Error('GEMINI_API_KEY_REQUIRED');
  const started = performance.now();
  let response: Response | undefined;
  const chunks: Uint8Array[] = [];
  let buffer: Buffer | null = null;
  try {
    response = await request(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      {
        method: 'GET',
        redirect: 'error',
        headers: { 'x-goog-api-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (response.status !== 200)
      return {
        httpStatus: response.status,
        authenticated: false,
        models: targets.map((model) => ({ model, visible: false })),
        elapsedMs: Math.round(performance.now() - started),
        enumerationComplete: false,
      };
    const reader = response.body?.getReader();
    if (!reader) throw Error('LLM_MODEL_LIST_INVALID');
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2097152) {
        value.fill(0);
        await reader.cancel();
        throw Error('LLM_MODEL_LIST_BOUND');
      }
      chunks.push(value);
    }
    buffer = Buffer.concat(chunks);
    const text = buffer.toString('utf8');
    if (text.includes(key)) throw Error('LLM_SECRET_ECHO');
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw Error('LLM_MODEL_LIST_INVALID');
    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.models)) throw Error('LLM_MODEL_LIST_INVALID');
    const rows = data.models;
    const models = targets.map((model) => {
      const found = rows.find(
        (v: unknown) =>
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          (v as Record<string, unknown>).name === 'models/' + model,
      ) as Record<string, unknown> | undefined;
      return {
        model,
        visible: !!found,
        operations:
          found && Array.isArray(found.supportedGenerationMethods)
            ? found.supportedGenerationMethods.filter(
                (v: unknown): v is string =>
                  typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(v),
              )
            : [],
      };
    });
    return {
      httpStatus: 200,
      authenticated: true,
      models,
      enumerationComplete: !data.nextPageToken,
      elapsedMs: Math.round(performance.now() - started),
      catalogSha256: createHash('sha256').update(buffer).digest('hex'),
    };
  } catch {
    return {
      httpStatus: response?.status ?? null,
      authenticated: false,
      models: targets.map((model) => ({ model, visible: false })),
      elapsedMs: Math.round(performance.now() - started),
      enumerationComplete: false,
    };
  } finally {
    chunks.forEach((c) => c.fill(0));
    buffer?.fill(0);
    await response?.body?.cancel().catch(() => undefined);
  }
}
