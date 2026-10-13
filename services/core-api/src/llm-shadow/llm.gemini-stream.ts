import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import type { GeminiProviderProfile } from './llm.provider-config.js';
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const statuses = [
  'queued',
  'in_progress',
  'completed',
  'incomplete',
  'failed',
  'cancelled',
  'requires_action',
  'budget_exceeded',
];
const names = [
  'interaction.created',
  'interaction.status_update',
  'interaction.completed',
  'interaction.incomplete',
  'interaction.failed',
  'error',
  'step.start',
  'step.delta',
  'step.stop',
];
const stepTypes = [
  'model_output',
  'thought',
  'user_input',
  'function_call',
  'function_result',
  'google_search_call',
  'google_search_result',
];
const tokenFields = [
  'total_input_tokens',
  'total_output_tokens',
  'total_thought_tokens',
  'total_tokens',
] as const;
export class CompletenessCollector {
  private readonly started = performance.now();
  private firstSSEMs: number | null = null;
  private firstModelDeltaMs: number | null = null;
  private terminalMs: number | null = null;
  private finishReason: string | null = null;
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';
  private output = '';
  private readonly steps = new Map<number, string>();
  private readonly trace: {
    type: string;
    elapsedMs: number;
    index: number | null;
    stepType: string | null;
    deltaType: string | null;
    modelTextCharacters: number;
    status: string | null;
  }[] = [];
  private bytes = 0;
  private deltas = 0;
  private orphanTextDeltas = 0;
  private toolSteps = 0;
  private completedSeen = false;
  private terminalSeen = false;
  private errorSeen = false;
  private doneSeen = false;
  private finalStatus: string | null = null;
  private framingError: string | null = null;
  private readonly usage: Record<(typeof tokenFields)[number], number | null> = {
    total_input_tokens: null,
    total_output_tokens: null,
    total_thought_tokens: null,
    total_tokens: null,
  };
  private ended = false;
  constructor(private readonly maxOutputTokens: number) {}
  push(bytes: Buffer): void {
    if (this.ended) throw Error('SSE_ALREADY_FINALIZED');
    this.bytes += bytes.length;
    if (this.bytes > 262144) throw Error('SSE_BYTE_LIMIT');
    this.buffer += this.decoder.write(bytes);
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(this.buffer);
      if (!boundary) break;
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const lines = frame.split(/\r?\n/);
      const data = lines
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      this.firstSSEMs ??= Math.round(performance.now() - this.started);
      if (data === '[DONE]') {
        this.doneSeen = true;
        continue;
      }
      const named =
        lines
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim() ?? '';
      this.consume(JSON.parse(data) as unknown, named);
    }
  }
  private consume(value: unknown, named: string): void {
    if (this.trace.length >= 1000) throw Error('SSE_EVENT_LIMIT');
    const event = object(value),
      interaction = object(event.interaction);
    const rawType = typeof event.event_type === 'string' ? event.event_type : named;
    const type = names.includes(rawType) ? rawType : 'OTHER';
    const step = object(event.step),
      delta = object(event.delta);
    const index =
      typeof event.index === 'number' &&
      Number.isSafeInteger(event.index) &&
      event.index >= 0 &&
      event.index < 1000
        ? event.index
        : null;
    const rawStatus = event.status ?? interaction.status;
    const status = typeof rawStatus === 'string' && statuses.includes(rawStatus) ? rawStatus : null;
    if (status) this.finalStatus = status;
    const rawReason = event.finish_reason ?? interaction.finish_reason ?? step.finish_reason;
    if (
      typeof rawReason === 'string' &&
      [
        'STOP',
        'MAX_TOKENS',
        'LENGTH',
        'TOKEN_LIMIT',
        'stop',
        'max_tokens',
        'max_output_tokens',
        'length',
        'budget_exceeded',
      ].includes(rawReason)
    )
      this.finishReason = rawReason;
    if (type === 'step.start' && index !== null && typeof step.type === 'string') {
      const t = stepTypes.includes(step.type) ? step.type : 'OTHER';
      this.steps.set(index, t);
      if (/call|result/.test(t)) this.toolSteps++;
    }
    const stepType = index === null ? null : (this.steps.get(index) ?? null);
    let modelTextCharacters = 0;
    if (type === 'step.delta' && delta.type === 'text' && typeof delta.text === 'string') {
      if (stepType === 'model_output') {
        if (this.output.length + delta.text.length > 16384) throw Error('SSE_OUTPUT_LIMIT');
        this.output += delta.text;
        this.deltas++;
        this.firstModelDeltaMs ??= Math.round(performance.now() - this.started);
        modelTextCharacters = delta.text.length;
      } else if (stepType === null) this.orphanTextDeltas++;
    }
    for (const candidate of [event.usage, interaction.usage, object(event.metadata).total_usage]) {
      const u = object(candidate);
      for (const f of tokenFields) {
        const count = u[f];
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
          this.usage[f] = count;
      }
    }
    if (type === 'interaction.completed') {
      this.completedSeen = true;
      this.terminalSeen = true;
    }
    if (type === 'interaction.incomplete') {
      this.finalStatus = 'incomplete';
      this.terminalSeen = true;
    }
    if (type === 'interaction.failed') {
      this.finalStatus = 'failed';
      this.terminalSeen = true;
    }
    if (type === 'error') {
      this.errorSeen = true;
      this.terminalSeen = true;
    }
    if (
      type === 'interaction.status_update' &&
      status &&
      ['incomplete', 'failed', 'cancelled', 'requires_action', 'budget_exceeded'].includes(status)
    )
      this.terminalSeen = true;
    if (this.terminalSeen) this.terminalMs ??= Math.round(performance.now() - this.started);
    // Only public structural metadata; never text/signatures from thought/error payloads.
    this.trace.push({
      type,
      elapsedMs: Math.round(performance.now() - this.started),
      index,
      stepType,
      deltaType: delta.type === 'text' ? 'text' : delta.type === 'thought' ? 'thought' : null,
      modelTextCharacters,
      status,
    });
  }
  finish(networkError: string | null = null) {
    if (this.ended) throw Error('SSE_ALREADY_FINALIZED');
    this.ended = true;
    this.buffer += this.decoder.end();
    if (this.buffer.trim()) this.framingError = 'UNTERMINATED_SSE_FRAME';
    this.buffer = '';
    let parsed: unknown = null;
    let jsonParseResult = 'NOT_ATTEMPTED_NO_TERMINAL';
    if (this.terminalSeen) {
      try {
        parsed = JSON.parse(this.output) as unknown;
        jsonParseResult = 'VALID';
      } catch {
        jsonParseResult = 'INVALID';
      }
    }
    const out = this.usage.total_output_tokens,
      thoughts = this.usage.total_thought_tokens;
    const exhausted =
      this.finalStatus === 'incomplete' &&
      !networkError &&
      !this.errorSeen &&
      !this.framingError &&
      !this.orphanTextDeltas &&
      !this.toolSteps &&
      out !== null &&
      thoughts !== null &&
      out + thoughts >= this.maxOutputTokens;
    const complete =
      this.completedSeen &&
      this.finalStatus === 'completed' &&
      !this.errorSeen &&
      !this.framingError &&
      !networkError &&
      !this.orphanTextDeltas &&
      !this.toolSteps &&
      jsonParseResult === 'VALID';
    const mechanism = complete
      ? 'COMPLETE_OUTPUT'
      : exhausted
        ? 'TOKEN_BUDGET_EXHAUSTED'
        : this.errorSeen || networkError || !this.terminalSeen
          ? 'STREAM_TERMINATED_BEFORE_COMPLETION'
          : this.completedSeen &&
              this.finalStatus === 'completed' &&
              jsonParseResult === 'INVALID' &&
              !this.framingError &&
              !this.orphanTextDeltas &&
              !this.toolSteps
            ? 'PROVIDER_RETURNED_INCOMPLETE_JSON_DESPITE_COMPLETED_STATUS'
            : 'UNKNOWN';
    const result = {
      SSEEvents: this.trace.length,
      firstSSEMs: this.firstSSEMs,
      firstModelDeltaMs: this.firstModelDeltaMs,
      terminalMs: this.terminalMs,
      finishReason: this.finishReason,
      prematureEOF: !this.terminalSeen && networkError === null,
      configuredMaxOutputTokens: this.maxOutputTokens,
      modelOutputTextDeltas: this.deltas,
      orphanTextDeltas: this.orphanTextDeltas,
      assembledCharacters: this.output.length,
      assembledOutputSha256: sha(this.output),
      output: this.output,
      trace: this.trace,
      completedSeen: this.completedSeen,
      terminalSeen: this.terminalSeen,
      doneSeen: this.doneSeen,
      finalStatus: this.finalStatus,
      usage: this.usage,
      jsonParseResult,
      complete,
      mechanism,
      framingError: this.framingError,
      networkError,
      toolSteps: this.toolSteps,
      hiddenThoughtContentRetained: false,
      parsed: complete ? parsed : null,
    };
    this.output = '';
    this.steps.clear();
    return result;
  }
}
export async function auditNativeStream(
  body: Readonly<Record<string, unknown>>,
  key: string,
  signal: AbortSignal,
  profile?: GeminiProviderProfile,
) {
  if (body.store !== false || body.background !== false || body.stream !== true)
    throw Error('SSE_STORAGE_CONFIG_INVALID');
  const generation = object(body.generation_config);
  const maxTokens = profile?.config.maxOutputTokens ?? 1024;
  const thinking = profile?.thinkingLevel ?? 'low';
  if (
    (profile && body.model !== profile.config.model) ||
    generation.max_output_tokens !== maxTokens ||
    generation.thinking_level !== thinking ||
    generation.thinking_summaries !== 'none'
  )
    throw Error('SSE_UNAUTHORIZED_CONFIG_CHANGE');
  const collector = new CompletenessCollector(maxTokens),
    started = performance.now();
  return new Promise<
    ReturnType<CompletenessCollector['finish']> & {
      httpStatus: number | null;
      headersMs: number | null;
      elapsedMs: number;
    }
  >((resolve) => {
    let settled = false,
      httpStatus: number | null = null,
      headersMs: number | null = null;
    const finalize = (code: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const result = collector.finish(code);
      if (result.output.includes(key)) {
        result.output = '';
        result.assembledCharacters = 0;
        result.assembledOutputSha256 = sha('');
        result.parsed = null;
        result.complete = false;
        result.mechanism = 'UNKNOWN';
        result.networkError = 'SECRET_ECHO_REJECTED';
      }
      resolve({
        ...result,
        httpStatus,
        headersMs,
        elapsedMs: Math.round(performance.now() - started),
      });
    };
    const req = request(
      {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: '/v1beta/interactions',
        method: 'POST',
        agent: false,
        headers: {
          'x-goog-api-key': key,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
      },
      (response) => {
        httpStatus = response.statusCode ?? null;
        headersMs = Math.round(performance.now() - started);
        if (
          httpStatus !== 200 ||
          !String(response.headers['content-type']).includes('text/event-stream')
        ) {
          finalize('HTTP_OR_CONTENT_TYPE_ERROR');
          response.destroy();
          return;
        }
        response.on('data', (chunk: Buffer) => {
          if (settled) {
            chunk.fill(0);
            return;
          }
          try {
            collector.push(chunk);
          } catch {
            finalize('SSE_FRAME_OR_LIMIT_ERROR');
            response.destroy();
          } finally {
            chunk.fill(0);
          }
        });
        response.on('end', () => finalize(null));
        response.on('aborted', () => finalize('RESPONSE_ABORTED'));
        response.on('error', () => finalize('NETWORK_ERROR'));
      },
    );
    const abort = () => {
      finalize('ABORTED');
      req.destroy();
    };
    const timer = setTimeout(() => {
      finalize('TIMEOUT');
      req.destroy();
    }, profile?.config.timeoutMs ?? 55000);
    signal.addEventListener('abort', abort, { once: true });
    req.on('error', () => finalize('NETWORK_ERROR'));
    if (signal.aborted) abort();
    else req.end(JSON.stringify(body));
  });
}
