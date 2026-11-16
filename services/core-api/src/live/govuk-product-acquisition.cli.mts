import { parseGovUkAcquisitionArgs } from './govuk-product-acquisition.cli-contract.js';
import { acquireGovUkRshMetadataOnce } from './govuk-product-acquisition.js';
import {
  persistGovUkRshMetadataWithInvoker,
  readGovUkRshInvokerConfig,
} from './govuk-rsh-one-shot-invoker.js';

async function main(): Promise<void> {
  const mode = parseGovUkAcquisitionArgs(process.argv.slice(2));
  const invokerConfig = mode === 'persist'
    ? (() => {
        if (process.env.DIALEKTIK_GOVUK_RSH_PERSIST_ENABLED !== '1') {
          throw new Error('GOVUK_RSH_PERSIST_DISABLED');
        }
        return readGovUkRshInvokerConfig();
      })()
    : undefined;
  const acquiredAt = new Date();
  const metadata = await acquireGovUkRshMetadataOnce({ recordedAt: acquiredAt });
  if (mode === 'persist') {
    const result = await persistGovUkRshMetadataWithInvoker(metadata, invokerConfig!);
    process.stdout.write(
      JSON.stringify({
        event: 'govuk_rsh_metadata_one_shot',
        result_state: result.result_state,
        source_item_id: metadata.sourceItemId,
        canonical_url: metadata.canonicalUrl,
        metadata_hash: metadata.metadataHash,
        automatic_retry: false,
      }) + '\n',
    );
    return;
  }
  process.stdout.write(
    JSON.stringify({
      event: 'govuk_rsh_metadata_dry_run',
      source: 'Regulator of Social Housing',
      source_item_id: metadata.sourceItemId,
      canonical_url: metadata.canonicalUrl,
      published_at: metadata.publishedAt,
      modified_at: metadata.modifiedAt,
      title: metadata.title,
      discovery_channel: 'official_api',
      metadata_only: true,
      body_persisted: false,
      acquisition_persisted: false,
    }) + '\n',
  );
}
function safeOperationErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'GOVUK_RSH_OPERATION_FAILED';
  if (/^[A-Z0-9_]+$/u.test(error.message)) return error.message;
  if (error.name === 'TypeError' && error.message === 'fetch failed') {
    const cause = error.cause;
    const causeCode =
      cause !== null && typeof cause === 'object' && 'code' in cause
        ? String(cause.code)
        : '';
    const safeNetworkCodes = new Set([
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
    ]);
    return safeNetworkCodes.has(causeCode)
      ? 'GOVUK_RSH_NETWORK_' + causeCode
      : 'GOVUK_RSH_NETWORK_UNAVAILABLE';
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 'GOVUK_RSH_REQUEST_TIMEOUT';
  }
  return 'GOVUK_RSH_OPERATION_FAILED';
}

main().catch((error: unknown) => {
  process.stderr.write(safeOperationErrorCode(error) + '\n');
  process.exitCode = 1;
});
