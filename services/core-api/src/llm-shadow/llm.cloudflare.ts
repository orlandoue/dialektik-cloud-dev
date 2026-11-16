import { performance } from 'node:perf_hooks';
import { assertLLMActive, isAborted } from './llm.assert.js';
import type {
  LLMGeneration,
  LLMProviderDiagnostics,
  LLMResponseDiagnosticCategory,
  LLMResponseFieldType,
  LLMUsage,
  StructuredLLMTransport,
} from './llm.contracts.js';
import {
  CLOUDFLARE_PROVIDER_TYPE,
  type CloudflareProviderProfile,
} from './llm.cloudflare-config.js';
import { EXTRACTION_PROMPT, RELATION_PROMPT } from './llm.schema.js';
import type { ProviderResilience } from './llm.resilience.js';
import { ProviderFailure } from './llm.resilience.js';

const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts/';
const MAX_RESPONSE_BYTES = 262144;
const MAX_ERROR_BYTES = 8192;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

class CloudflareProviderFailure extends ProviderFailure {
  constructor(
    status: number | null,
    readonly code: string,
    category: 'HTTP' | 'NETWORK' | 'INCOMPLETE' | 'SCHEMA',
  ) {
    super(status, category, code);
    this.message = code;
  }
}

function safeProviderError(status: number | null, category: string): Error {
  if (status === 401 || status === 403) return new Error('LLM_CREDENTIAL_REJECTED');
  if (status === 404) return new Error('LLM_MODEL_UNAVAILABLE');
  if (status === 408) return new Error('LLM_TIMEOUT');
  if (status === 429) return new Error('LLM_RATE_LIMIT');
  if (status !== null && status >= 500) return new Error('LLM_PROVIDER_FAILED');
  if (category === 'NETWORK') return new Error('LLM_TRANSPORT_FAILED');
  if (category === 'INCOMPLETE') return new Error('LLM_PROVIDER_INCOMPLETE');
  return new Error('LLM_PROVIDER_REJECTED');
}

async function cloudflareErrorCode(response: Response): Promise<number | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ERROR_BYTES) return null;
      chunks.push(value);
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isRecord(payload) || !Array.isArray(payload.errors)) return null;
    for (const error of payload.errors) {
      if (isRecord(error) && typeof error.code === 'number' && Number.isSafeInteger(error.code))
        return error.code;
    }
    return null;
  } catch {
    return null;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel().catch(() => undefined);
  }
}

function stableProviderError(status: number, code: number | null): string {
  if (code === 3036) return 'LLM_FREE_NEURON_QUOTA_EXHAUSTED';
  if (code === 3040) return 'LLM_PROVIDER_CAPACITY_EXCEEDED';
  if (code === 5035) return 'LLM_MODEL_REQUIRES_PAID_PLAN';
  return safeProviderError(status, 'HTTP').message;
}

function count(usage: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

const fieldType = (value: unknown, present = true): LLMResponseFieldType => {
  if (!present) return 'MISSING';
  if (value === null) return 'NULL';
  if (typeof value === 'string') return 'STRING';
  if (Array.isArray(value)) return 'ARRAY';
  if (typeof value === 'number') return 'NUMBER';
  if (typeof value === 'boolean') return 'BOOLEAN';
  return 'OBJECT';
};

function emptyDiagnostics(
  stage: LLMProviderDiagnostics['stage'],
  diagnosticCategory: LLMResponseDiagnosticCategory | null,
  patch: Partial<LLMProviderDiagnostics> = {},
): LLMProviderDiagnostics {
  return Object.freeze({
    stage,
    responseEnvelopeVariant: 'NOT_PARSED',
    diagnosticCategory,
    completionStatus: 'UNKNOWN',
    contentCharacterCount: null,
    jsonParseStatus: 'NOT_ATTEMPTED',
    fieldTypes: Object.freeze({
      resultResponse: 'MISSING',
      resultChoices: 'MISSING',
      firstChoiceMessage: 'MISSING',
      messageRole: 'MISSING',
      messageContent: 'MISSING',
      messageReasoningContent: 'MISSING',
    }),
    reasoningContentPresent: null,
    finishReason: 'NOT_APPLICABLE',
    schemaIssueCode: null,
    schemaErrorKeyword: null,
    schemaErrorPath: null,
    ...patch,
  });
}

export class CloudflareResponseFailure extends Error {
  constructor(
    code: string,
    readonly providerDiagnostics: LLMProviderDiagnostics,
    readonly httpStatus: number | null = null,
  ) {
    super(code);
    this.name = 'CloudflareResponseFailure';
  }
}

export function cloudflareDiagnosticsFromError(error: unknown): LLMProviderDiagnostics | null {
  return error instanceof CloudflareResponseFailure ? error.providerDiagnostics : null;
}

function failure(
  code: string,
  diagnosticCategory: LLMResponseDiagnosticCategory,
  diagnostics: LLMProviderDiagnostics,
  httpStatus: number | null = null,
): CloudflareResponseFailure {
  return new CloudflareResponseFailure(
    code,
    Object.freeze({ ...diagnostics, diagnosticCategory }),
    httpStatus,
  );
}

function finishReason(value: unknown): LLMProviderDiagnostics['finishReason'] {
  if (value === 'stop') return 'STOP';
  if (value === 'length') return 'LENGTH';
  if (value === 'content_filter') return 'CONTENT_FILTER';
  if (value === 'tool_calls') return 'TOOL_CALLS';
  if (value === 'function_call') return 'FUNCTION_CALL';
  return 'UNKNOWN';
}

function decodeAssistantContent(
  content: unknown,
  diagnostics: LLMProviderDiagnostics,
): { output: unknown; diagnostics: LLMProviderDiagnostics } {
  if (typeof content !== 'string') {
    throw failure('LLM_RESPONSE_INVALID', 'ASSISTANT_CONTENT_MISSING', diagnostics);
  }
  const withLength = Object.freeze({ ...diagnostics, contentCharacterCount: content.length });
  if (!content.trim()) {
    throw failure('LLM_RESPONSE_INVALID', 'ASSISTANT_CONTENT_EMPTY', withLength);
  }
  let output: unknown;
  try {
    output = JSON.parse(content) as unknown;
  } catch {
    throw failure(
      'LLM_RESPONSE_INVALID',
      'ASSISTANT_CONTENT_NON_JSON',
      Object.freeze({ ...withLength, stage: 'JSON_DECODE', jsonParseStatus: 'FAILED' }),
    );
  }
  return {
    output,
    diagnostics: Object.freeze({
      ...withLength,
      stage: 'JSON_DECODE',
      jsonParseStatus: 'SUCCEEDED',
    }),
  };
}

function responseModelMatches(value: unknown, expectedModel: string): boolean {
  if (typeof value !== 'string') return false;
  const canonical = expectedModel.startsWith('@cf/') ? expectedModel.slice(4) : expectedModel;
  const leaf = canonical.split('/').at(-1);
  return value === expectedModel || value === canonical || (leaf !== undefined && value === leaf);
}

function normalizeResponsesResult(
  result: Record<string, unknown>,
  expectedModel: string,
): {
  output: unknown;
  diagnostics: LLMProviderDiagnostics;
  usage: Record<string, unknown>;
} {
  const outputItems: unknown[] = Array.isArray(result.output) ? (result.output as unknown[]) : [];
  const reasoningPresent = outputItems.some((item) => isRecord(item) && item.type === 'reasoning');
  const base = emptyDiagnostics('PROVIDER_RESULT', null, {
    responseEnvelopeVariant: 'CLOUDFLARE_RUN_RESPONSES_API',
    completionStatus: result.status === 'completed' ? 'COMPLETE' : 'INCOMPLETE',
    reasoningContentPresent: reasoningPresent,
    finishReason: 'NOT_APPLICABLE',
  });
  if (result.status === 'failed') {
    throw failure('LLM_PROVIDER_FAILED', 'PROVIDER_ERROR', base);
  }
  if (result.status !== 'completed') {
    throw failure('LLM_PROVIDER_INCOMPLETE', 'ASSISTANT_OUTPUT_INCOMPLETE', base);
  }
  if (
    Object.prototype.hasOwnProperty.call(result, 'model') &&
    !responseModelMatches(result.model, expectedModel)
  ) {
    throw failure('LLM_RESPONSE_INVALID', 'PROVIDER_MODEL_MISMATCH', base);
  }
  if (!Array.isArray(result.output)) {
    throw failure(
      'LLM_RESPONSE_INVALID',
      'ASSISTANT_CONTENT_MISSING',
      Object.freeze({ ...base, stage: 'ASSISTANT_CONTENT' }),
    );
  }
  const unsupportedItems = outputItems.filter(
    (item) => !isRecord(item) || (item.type !== 'reasoning' && item.type !== 'message'),
  );
  if (unsupportedItems.length > 0) {
    throw failure('LLM_PROVIDER_INCOMPLETE', 'ASSISTANT_OUTPUT_INCOMPLETE', base);
  }
  const messages = outputItems.filter((item) => isRecord(item) && item.type === 'message');
  const message = messages[0];
  if (messages.length !== 1 || !isRecord(message) || message.role !== 'assistant') {
    throw failure(
      'LLM_PROVIDER_INCOMPLETE',
      'ASSISTANT_OUTPUT_INCOMPLETE',
      Object.freeze({ ...base, stage: 'ASSISTANT_CONTENT' }),
    );
  }
  if (
    (Object.prototype.hasOwnProperty.call(message, 'status') && message.status !== 'completed') ||
    (Object.prototype.hasOwnProperty.call(message, 'phase') && message.phase !== 'final_answer')
  ) {
    throw failure(
      'LLM_PROVIDER_INCOMPLETE',
      'ASSISTANT_OUTPUT_INCOMPLETE',
      Object.freeze({ ...base, stage: 'ASSISTANT_CONTENT', completionStatus: 'INCOMPLETE' }),
    );
  }
  if (!Array.isArray(message.content) || message.content.length === 0) {
    throw failure(
      'LLM_RESPONSE_INVALID',
      'ASSISTANT_CONTENT_MISSING',
      Object.freeze({ ...base, stage: 'ASSISTANT_CONTENT' }),
    );
  }
  const textBlocks = message.content.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.type === 'output_text' && typeof item.text === 'string',
  );
  if (textBlocks.length !== message.content.length || textBlocks.length === 0) {
    throw failure(
      'LLM_RESPONSE_INVALID',
      'ASSISTANT_CONTENT_MISSING',
      Object.freeze({ ...base, stage: 'ASSISTANT_CONTENT' }),
    );
  }
  const content = textBlocks.map((item) => item.text as string).join('');
  const decoded = decodeAssistantContent(
    content,
    Object.freeze({ ...base, stage: 'ASSISTANT_CONTENT' }),
  );
  return {
    output: decoded.output,
    diagnostics: decoded.diagnostics,
    usage: isRecord(result.usage) ? result.usage : {},
  };
}

function normalizeRunResult(
  payload: unknown,
  expectedModel: string,
  responsesApiAllowed: boolean,
): {
  output: unknown;
  diagnostics: LLMProviderDiagnostics;
  usage: Record<string, unknown>;
} {
  if (!isRecord(payload)) {
    throw failure(
      'LLM_RESPONSE_INVALID',
      'CLOUDFLARE_ENVELOPE_INVALID',
      emptyDiagnostics('CLOUDFLARE_ENVELOPE', 'CLOUDFLARE_ENVELOPE_INVALID', {
        responseEnvelopeVariant: 'UNKNOWN',
      }),
    );
  }
  if (payload.success !== true) {
    throw failure(
      'LLM_PROVIDER_FAILED',
      'PROVIDER_ERROR',
      emptyDiagnostics('CLOUDFLARE_ENVELOPE', 'PROVIDER_ERROR', {
        responseEnvelopeVariant: 'UNKNOWN',
      }),
    );
  }
  if (!isRecord(payload.result)) {
    throw failure(
      'LLM_RESPONSE_INVALID',
      'PROVIDER_RESULT_MISSING',
      emptyDiagnostics('PROVIDER_RESULT', 'PROVIDER_RESULT_MISSING', {
        responseEnvelopeVariant: 'UNKNOWN',
      }),
    );
  }
  const result = payload.result;
  if (
    responsesApiAllowed &&
    (Object.prototype.hasOwnProperty.call(result, 'status') ||
      Object.prototype.hasOwnProperty.call(result, 'output'))
  ) {
    return normalizeResponsesResult(result, expectedModel);
  }
  const hasResponse = Object.prototype.hasOwnProperty.call(result, 'response');
  const hasChoices = Object.prototype.hasOwnProperty.call(result, 'choices');
  const fieldTypes = Object.freeze({
    resultResponse: fieldType(result.response, hasResponse),
    resultChoices: fieldType(result.choices, hasChoices),
    firstChoiceMessage: 'MISSING' as LLMResponseFieldType,
    messageRole: 'MISSING' as LLMResponseFieldType,
    messageContent: 'MISSING' as LLMResponseFieldType,
    messageReasoningContent: 'MISSING' as LLMResponseFieldType,
  });
  const base = emptyDiagnostics('PROVIDER_RESULT', null, {
    responseEnvelopeVariant: 'UNKNOWN',
    fieldTypes,
  });

  // The account Run route carries both the generic result.response shape and
  // model-specific result.choices chat completions. Never parse an arbitrary
  // OpenAI-compatible top-level envelope on this route.
  if (hasResponse && (typeof result.response === 'string' || isRecord(result.response))) {
    if (typeof result.response === 'string') {
      const decoded = decodeAssistantContent(
        result.response,
        Object.freeze({
          ...base,
          stage: 'ASSISTANT_CONTENT',
          responseEnvelopeVariant: 'CLOUDFLARE_RUN_RESPONSE',
          completionStatus: 'COMPLETE',
          jsonParseStatus: 'NOT_ATTEMPTED',
        }),
      );
      return {
        output: decoded.output,
        diagnostics: decoded.diagnostics,
        usage: isRecord(result.usage) ? result.usage : isRecord(payload.usage) ? payload.usage : {},
      };
    }
    return {
      output: result.response,
      diagnostics: Object.freeze({
        ...base,
        stage: 'JSON_DECODE',
        responseEnvelopeVariant: 'CLOUDFLARE_RUN_RESPONSE',
        completionStatus: 'COMPLETE',
        contentCharacterCount: JSON.stringify(result.response).length,
        jsonParseStatus: 'STRUCTURED_OBJECT',
      }),
      usage: isRecord(result.usage) ? result.usage : isRecord(payload.usage) ? payload.usage : {},
    };
  }

  if (hasChoices) {
    const choices = result.choices;
    const firstChoice: unknown = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(firstChoice) ? firstChoice.message : undefined;
    const reasoningPresent =
      isRecord(message) && Object.prototype.hasOwnProperty.call(message, 'reasoning_content');
    const reason = isRecord(firstChoice) ? finishReason(firstChoice.finish_reason) : 'UNKNOWN';
    const choiceFields = Object.freeze({
      ...fieldTypes,
      firstChoiceMessage: fieldType(message, isRecord(firstChoice) && 'message' in firstChoice),
      messageRole: fieldType(
        isRecord(message) ? message.role : undefined,
        isRecord(message) && 'role' in message,
      ),
      messageContent: fieldType(
        isRecord(message) ? message.content : undefined,
        isRecord(message) && 'content' in message,
      ),
      messageReasoningContent: fieldType(
        isRecord(message) ? message.reasoning_content : undefined,
        reasoningPresent,
      ),
    });
    const diagnostics = emptyDiagnostics('ASSISTANT_CONTENT', null, {
      responseEnvelopeVariant: 'CLOUDFLARE_RUN_CHAT_COMPLETION',
      fieldTypes: choiceFields,
      reasoningContentPresent: reasoningPresent,
      finishReason: reason,
      completionStatus: reason === 'STOP' ? 'COMPLETE' : 'INCOMPLETE',
    });
    if (
      !Array.isArray(choices) ||
      choices.length !== 1 ||
      !isRecord(firstChoice) ||
      !isRecord(message) ||
      message.role !== 'assistant'
    ) {
      throw failure('LLM_PROVIDER_INCOMPLETE', 'ASSISTANT_OUTPUT_INCOMPLETE', diagnostics);
    }
    if (reason !== 'STOP') {
      throw failure('LLM_PROVIDER_INCOMPLETE', 'ASSISTANT_OUTPUT_INCOMPLETE', diagnostics);
    }
    if (typeof message.content !== 'string') {
      throw failure('LLM_RESPONSE_INVALID', 'ASSISTANT_CONTENT_MISSING', diagnostics);
    }
    const decoded = decodeAssistantContent(message.content, diagnostics);
    return {
      output: decoded.output,
      diagnostics: decoded.diagnostics,
      usage: isRecord(result.usage) ? result.usage : isRecord(payload.usage) ? payload.usage : {},
    };
  }

  if (hasResponse) {
    throw failure(
      'LLM_RESPONSE_INVALID',
      'ASSISTANT_CONTENT_MISSING',
      Object.freeze({ ...base, stage: 'ASSISTANT_CONTENT' }),
    );
  }

  throw failure('LLM_RESPONSE_INVALID', 'PROVIDER_RESULT_MISSING', base);
}

/** Workers AI REST transport. Real Articles remain behind the existing route grants. */
export class CloudflareWorkersAITransport implements StructuredLLMTransport {
  readonly kind = 'external' as const;
  readonly name = 'cloudflare-workers-ai-rest';
  readonly providerType = CLOUDFLARE_PROVIDER_TYPE;
  #accountId: string;
  #apiToken: string;

  constructor(
    readonly profile: CloudflareProviderProfile,
    private readonly request: typeof fetch = fetch,
    env: Readonly<Record<string, string | undefined>> = process.env,
    private readonly systemInstructionOverride?: string,
    private readonly resilience?: ProviderResilience,
  ) {
    this.#accountId = (env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
    this.#apiToken = (env.CLOUDFLARE_API_TOKEN ?? '').trim();
    if (!/^[a-f0-9]{32}$/i.test(this.#accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID_REQUIRED');
    if (!this.#apiToken) throw new Error('CLOUDFLARE_API_TOKEN_REQUIRED');
  }

  async generate(
    stage: 'extraction' | 'relation',
    input: unknown,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<LLMGeneration> {
    assertLLMActive(signal);
    if (!isRecord(schema)) throw new Error('LLM_SCHEMA_INVALID');
    if (!this.resilience) return this.generateOnce(stage, input, schema, signal);
    try {
      return (
        await this.resilience.run(
          [this.profile],
          () => this.generateOnce(stage, input, schema, signal),
          signal,
          { maxAttemptsPerModel: 1, maxTotalAttempts: 1 },
        )
      ).value;
    } catch (error) {
      if (isAborted(signal)) throw new Error('LLM_ABORTED');
      if (error instanceof ProviderFailure) {
        if (
          error.providerCode === 'LLM_FREE_NEURON_QUOTA_EXHAUSTED' ||
          error.providerCode === 'LLM_PROVIDER_CAPACITY_EXCEEDED' ||
          error.providerCode === 'LLM_MODEL_REQUIRES_PAID_PLAN'
        )
          throw new Error(error.providerCode);
        throw safeProviderError(error.status, error.category);
      }
      throw error;
    }
  }

  private async generateOnce(
    stage: 'extraction' | 'relation',
    input: unknown,
    schema: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<LLMGeneration> {
    assertLLMActive(signal);
    const started = performance.now();
    const instruction =
      this.systemInstructionOverride ??
      (stage === 'extraction' ? EXTRACTION_PROMPT : RELATION_PROMPT);
    let inputText: string;
    try {
      inputText = typeof input === 'string' ? input : JSON.stringify(input);
    } catch {
      throw new Error('LLM_REQUEST_INVALID');
    }
    if (typeof inputText !== 'string') throw new Error('LLM_REQUEST_INVALID');
    const systemContent =
      this.profile.outputMode === 'prompt-schema-v1'
        ? `${instruction}\n\nReturn only one JSON object conforming to this JSON Schema. Do not include Markdown fences or prose.\n${JSON.stringify(schema)}`
        : instruction;
    const responsesApi = this.profile.protocol === 'workers-ai-run-responses-v1';
    const body: Record<string, unknown> = responsesApi
      ? {
          instructions: systemContent,
          input: [{ role: 'user', content: inputText }],
          max_output_tokens: this.profile.config.maxOutputTokens,
          reasoning: { effort: 'low' },
          tools: [],
          store: false,
          stream: false,
        }
      : {
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: inputText },
          ],
          max_completion_tokens: this.profile.config.maxOutputTokens,
          tools: [],
          store: false,
          stream: false,
        };
    if (!responsesApi && this.profile.outputMode === 'workers-json-schema-v1') {
      body.response_format = { type: 'json_schema', json_schema: schema };
    }
    let serializedBody: string;
    try {
      serializedBody = JSON.stringify(body);
    } catch {
      throw new Error('LLM_REQUEST_INVALID');
    }
    const requestBytes = Buffer.byteLength(serializedBody, 'utf8');
    if (this.profile.maxRequestBytes !== null && requestBytes > this.profile.maxRequestBytes)
      throw new Error('LLM_REQUEST_BOUND');
    const endpoint =
      API_ROOT + encodeURIComponent(this.#accountId) + '/ai/run/' + this.profile.config.model;
    const timeoutSignal = AbortSignal.timeout(this.profile.config.timeoutMs);
    const requestSignal = AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: requestSignal,
        headers: {
          authorization: `Bearer ${this.#apiToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: serializedBody,
      });
    } catch {
      if (isAborted(signal)) throw new Error('LLM_ABORTED');
      if (timeoutSignal.aborted) {
        if (this.resilience) throw new CloudflareProviderFailure(408, 'LLM_TIMEOUT', 'HTTP');
        throw new Error('LLM_TIMEOUT');
      }
      if (this.resilience)
        throw new CloudflareProviderFailure(null, 'LLM_TRANSPORT_FAILED', 'NETWORK');
      throw new Error('LLM_TRANSPORT_FAILED');
    }
    if (!response.ok) {
      const providerCode = await cloudflareErrorCode(response);
      const code = stableProviderError(response.status, providerCode);
      if (this.resilience)
        throw new CloudflareProviderFailure(
          response.status,
          code,
          response.status === 408 || response.status === 429 || response.status >= 500
            ? 'HTTP'
            : 'SCHEMA',
        );
      throw new Error(code);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw failure(
        'LLM_RESPONSE_INVALID',
        'CLOUDFLARE_ENVELOPE_INVALID',
        emptyDiagnostics('HTTP_TRANSPORT', 'CLOUDFLARE_ENVELOPE_INVALID'),
        response.status,
      );
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let bytes: Buffer | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error('LLM_RESPONSE_BOUND');
      }
      bytes = Buffer.concat(chunks);
      let payload: unknown;
      try {
        payload = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw failure(
          'LLM_RESPONSE_INVALID',
          'CLOUDFLARE_ENVELOPE_INVALID',
          emptyDiagnostics('CLOUDFLARE_ENVELOPE', 'CLOUDFLARE_ENVELOPE_INVALID', {
            responseEnvelopeVariant: 'UNKNOWN',
            jsonParseStatus: 'FAILED',
          }),
          response.status,
        );
      }
      const normalized = normalizeRunResult(
        payload,
        this.profile.config.model,
        this.profile.protocol === 'workers-ai-run-responses-v1',
      );
      const output = normalized.output;
      if (JSON.stringify(output).includes(this.#apiToken)) {
        throw failure(
          'LLM_RESPONSE_INVALID',
          'RESPONSE_REDACTION_REJECTED',
          Object.freeze({
            ...normalized.diagnostics,
            diagnosticCategory: 'RESPONSE_REDACTION_REJECTED',
          }),
          response.status,
        );
      }
      const usage = normalized.usage;
      const safeUsage: LLMUsage = {
        inputTokens: count(usage, 'prompt_tokens', 'input_tokens', 'total_input_tokens'),
        outputTokens: count(usage, 'completion_tokens', 'output_tokens', 'total_output_tokens'),
        totalTokens: count(usage, 'total_tokens'),
        cost: null,
      };
      assertLLMActive(signal);
      return {
        output,
        usage: safeUsage,
        httpStatus: response.status,
        elapsedMs: Math.max(0, Math.round(performance.now() - started)),
        providerDiagnostics: normalized.diagnostics,
      };
    } catch (error) {
      if (error instanceof CloudflareProviderFailure) throw error;
      if (error instanceof Error && /^LLM_[A-Z_]+$/.test(error.message)) throw error;
      if (isAborted(signal)) throw new Error('LLM_ABORTED');
      if (timeoutSignal.aborted) {
        if (this.resilience) throw new CloudflareProviderFailure(408, 'LLM_TIMEOUT', 'HTTP');
        throw new Error('LLM_TIMEOUT');
      }
      throw new Error('LLM_RESPONSE_INVALID');
    } finally {
      for (const chunk of chunks) chunk.fill(0);
      bytes?.fill(0);
      await reader.cancel().catch(() => undefined);
    }
  }

  dispose(): void {
    this.#apiToken = '';
    this.#accountId = '';
  }

  toJSON(): object {
    return {
      provider: this.name,
      providerType: this.providerType,
      model: this.profile.config.model,
      version: this.profile.config.providerVersion,
      credential: '[REDACTED]',
    };
  }
}

export async function verifyCloudflareToken(
  token: string,
  request: typeof fetch = fetch,
): Promise<Readonly<{ valid: boolean; httpStatus: number }>> {
  if (!token.trim()) throw new Error('CLOUDFLARE_API_TOKEN_REQUIRED');
  let response: Response;
  try {
    response = await request('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      method: 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch {
    throw new Error('CLOUDFLARE_TOKEN_VERIFICATION_FAILED');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return Object.freeze({ valid: false, httpStatus: response.status });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return Object.freeze({ valid: false, httpStatus: response.status });
  }
  const valid =
    isRecord(payload) &&
    payload.success === true &&
    isRecord(payload.result) &&
    payload.result.status === 'active';
  return Object.freeze({ valid, httpStatus: response.status });
}
