import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';

export const OFFICIAL_VOTE_ADAPTER_VERSION = 'camara-vote-record-v1';
export const OFFICIAL_VOTE_DETAIL_BASE_URL =
  'https://opendata.camara.cl/camaradiputados/WServices/WSLegislativo.asmx/retornarVotacionDetalle';
export const OFFICIAL_VOTE_MAX_RESPONSE_BYTES = 512_000;

export interface OfficialVoteDetail {
  readonly sourceRecordId: string;
  readonly description: string;
  readonly sourceDateRaw: string;
  readonly totalYes: number;
  readonly totalNo: number;
  readonly totalAbstention: number;
  readonly totalExcused: number;
  readonly result: string | null;
  readonly quorum: string | null;
  readonly responseSha256: string;
  readonly sourceRecordUrl: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return null;
}

function requiredScalar(row: Record<string, unknown>, key: string, max: number): string {
  const value = scalar(row[key]);
  if (!value || value.length > max) throw new Error('INVALID_OFFICIAL_VOTE_SHAPE');
  return value;
}

function total(row: Record<string, unknown>, key: string): number {
  const value = requiredScalar(row, key, 4);
  if (!/^\d{1,4}$/u.test(value) || Number(value) > 1000)
    throw new Error('INVALID_OFFICIAL_VOTE_TOTAL');
  return Number(value);
}

/** Parse and project only the small aggregate portion of the public vote record. */
export function parseOfficialVoteDetail(
  payload: Uint8Array,
  expectedRecordId: string,
): OfficialVoteDetail {
  if (!/^\d{1,12}$/u.test(expectedRecordId)) throw new Error('INVALID_OFFICIAL_VOTE_ID');
  if (payload.byteLength === 0 || payload.byteLength > OFFICIAL_VOTE_MAX_RESPONSE_BYTES)
    throw new Error('OFFICIAL_VOTE_RESPONSE_SIZE');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('OFFICIAL_VOTE_DTD_REJECTED');
  try {
    SyntaxValidator.validate(xml);
  } catch {
    throw new Error('INVALID_OFFICIAL_VOTE_XML');
  }
  let depth = 0;
  for (const match of xml.matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
    if (match[0].startsWith('</')) depth--;
    else if (!match[0].endsWith('/>')) depth++;
    if (depth > 32) throw new Error('OFFICIAL_VOTE_XML_NESTING');
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    htmlEntities: false,
  });
  const root = record(parser.parse(xml));
  const vote = record(root.Votacion);
  const sourceRecordId = requiredScalar(vote, 'Id', 12);
  if (sourceRecordId !== expectedRecordId) throw new Error('OFFICIAL_VOTE_ID_MISMATCH');
  const description = requiredScalar(vote, 'Descripcion', 1000);
  const sourceDateRaw = requiredScalar(vote, 'Fecha', 32);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(sourceDateRaw) ||
    !Number.isFinite(Date.parse(`${sourceDateRaw}Z`))
  )
    throw new Error('OFFICIAL_VOTE_DATE_NOT_SOURCE_LOCAL');
  const optionalText = (key: string): string | null => {
    const value = scalar(vote[key]);
    return value && value.length <= 200 ? value : null;
  };
  const responseSha256 = createHash('sha256').update(payload).digest('hex');
  return Object.freeze({
    sourceRecordId,
    description,
    sourceDateRaw,
    totalYes: total(vote, 'TotalSi'),
    totalNo: total(vote, 'TotalNo'),
    totalAbstention: total(vote, 'TotalAbstencion'),
    totalExcused: total(vote, 'TotalDispensado'),
    result: optionalText('Resultado'),
    quorum: optionalText('Quorum'),
    responseSha256,
    sourceRecordUrl: `${OFFICIAL_VOTE_DETAIL_BASE_URL}?prmVotacionId=${sourceRecordId}`,
  });
}

export async function readBoundedResponse(
  response: Response,
  maxBytes = OFFICIAL_VOTE_MAX_RESPONSE_BYTES,
): Promise<Uint8Array> {
  const announcedLength = response.headers.get('content-length');
  if (announcedLength && /^\d+$/u.test(announcedLength) && Number(announcedLength) > maxBytes)
    throw new Error('OFFICIAL_VOTE_RESPONSE_SIZE');
  if (!response.body) throw new Error('OFFICIAL_VOTE_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalLength += value.byteLength;
      if (totalLength > maxBytes) {
        await reader.cancel();
        throw new Error('OFFICIAL_VOTE_RESPONSE_SIZE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
