import { GOVUK_RSH_WRITER_ROLE } from './govuk-product-acquisition.js';

export type GovUkAcquisitionMode = 'dry-run' | 'persist';

export function parseGovUkAcquisitionArgs(args: readonly string[]): GovUkAcquisitionMode {
  const values = new Map<string, string>();
  let once = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--once') {
      if (once) throw new Error('GOVUK_RSH_CLI_ARGUMENTS_INVALID');
      once = true;
      continue;
    }
    if (arg !== '--source' && arg !== '--mode') throw new Error('GOVUK_RSH_CLI_ARGUMENTS_INVALID');
    const value = args[index + 1];
    if (!value || values.has(arg)) throw new Error('GOVUK_RSH_CLI_ARGUMENTS_INVALID');
    values.set(arg, value);
    index += 1;
  }
  if (!once || values.get('--source') !== 'govuk-rsh') {
    throw new Error('GOVUK_RSH_CLI_ARGUMENTS_INVALID');
  }
  const mode = values.get('--mode');
  if (mode !== 'dry-run' && mode !== 'persist') {
    throw new Error('GOVUK_RSH_CLI_ARGUMENTS_INVALID');
  }
  return mode;
}

/** Restricts this writer CLI to the verified DEV session pooler and its dedicated login. */
export function validateGovUkWriterDatabaseUrl(raw: string): URL {
  let url: URL;
  let username: string;
  try {
    url = new URL(raw);
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error('GOVUK_RSH_WRITER_TARGET_DENIED');
  }
  const poolerHost = 'aws-0-us-east-1.pooler.supabase.com';
  const poolerIdentity =
    url.hostname === poolerHost &&
    username === GOVUK_RSH_WRITER_ROLE + '.vclsswwfhljczxgnsciq';
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.pathname !== '/postgres' ||
    url.port !== '5432' ||
    url.search !== '' ||
    url.hash !== '' ||
    !poolerIdentity ||
    !url.password
  ) {
    throw new Error('GOVUK_RSH_WRITER_TARGET_DENIED');
  }
  return url;
}
