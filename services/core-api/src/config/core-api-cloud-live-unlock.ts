/**
 * Parche de desbloqueo controlado para `services/core-api/src/config/core-api-config.ts`
 * y `services/core-api/src/live/live.sync.ts`.
 *
 * Resuelve los dos bloqueos que impedían la persistencia hacia Supabase Cloud desde Render:
 * 1. Permite `SEMANTIC_MODE = 'live_cloud'` o `'unassigned'` en producción únicamente cuando
 *    `ALLOW_CLOUD_LIVE_INGESTION === 'true'` y el destino es un host autorizado de Supabase.
 * 2. Mantiene bloqueado de forma estricta (`fail-closed`) cualquier intento de usar `'fixture'`
 *    (datos sintéticos) en producción.
 */

export type SemanticMode = 'disabled' | 'fixture' | 'unassigned' | 'live_cloud';

export interface CoreApiCloudConfig {
  nodeEnv: string;
  semanticMode: SemanticMode;
  allowCloudLiveIngestion: boolean;
  databaseUrl: string;
  liveWriterDatabaseUrl?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalDatabaseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAuthorizedSupabaseCloudUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    // Acepta conexión directa o Supavisor Transaction Pooler del proyecto dialektik-dev
    return (
      host.endsWith('.supabase.co') ||
      host.endsWith('.pooler.supabase.com')
    );
  } catch {
    return false;
  }
}

export function loadCoreApiConfig(
  env: Record<string, string | undefined> = process.env,
): CoreApiCloudConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const allowCloudLiveIngestion = env.ALLOW_CLOUD_LIVE_INGESTION === 'true';
  const requestedMode = (env.SEMANTIC_MODE ||
    (nodeEnv === 'production' ? 'disabled' : 'fixture')) as SemanticMode;

  if ((requestedMode as string) === 'v10_11') {
    throw new Error(
      'V10.11 activation is not authorized. Use SEMANTIC_MODE=fixture for development or live_cloud for authorized cloud ingestion.',
    );
  }

  if (!['disabled', 'fixture', 'unassigned', 'live_cloud'].includes(requestedMode)) {
    throw new Error(
      `Unsupported SEMANTIC_MODE "${requestedMode}". Allowed values: disabled, fixture, unassigned, live_cloud.`,
    );
  }

  // Regla inquebrantable: JAMÁS permitir datos sintéticos ('fixture') en producción
  if (nodeEnv === 'production' && requestedMode === 'fixture') {
    throw new Error(
      'CRITICAL: SEMANTIC_MODE=fixture is strictly forbidden in production to prevent synthetic data contamination.',
    );
  }

  const targetUrl =
    env.LIVE_WRITER_DATABASE_URL ||
    env.LIVE_SHADOW_DATABASE_URL ||
    env.DATABASE_URL ||
    '';

  // En producción, permitir 'live_cloud' o 'unassigned' solo si ALLOW_CLOUD_LIVE_INGESTION=true
  if (
    nodeEnv === 'production' &&
    (requestedMode === 'live_cloud' || requestedMode === 'unassigned')
  ) {
    if (!allowCloudLiveIngestion) {
      throw new Error(
        'Cloud live ingestion in production requires ALLOW_CLOUD_LIVE_INGESTION=true.',
      );
    }
    if (!isAuthorizedSupabaseCloudUrl(targetUrl)) {
      throw new Error(
        'Cloud live ingestion requires an authorized Supabase PostgreSQL host (*.supabase.co or *.pooler.supabase.com).',
      );
    }
  }

  // En entorno local sin flag cloud, mantener el aislamiento en loopback
  if (
    requestedMode === 'unassigned' &&
    !allowCloudLiveIngestion &&
    (!targetUrl || !isLocalDatabaseUrl(targetUrl))
  ) {
    throw new Error(
      'LIVE_SHADOW unassigned mode requires either a local PostgreSQL target or ALLOW_CLOUD_LIVE_INGESTION=true with an authorized Supabase target.',
    );
  }

  return {
    nodeEnv,
    semanticMode: requestedMode,
    allowCloudLiveIngestion,
    databaseUrl: env.DATABASE_URL || '',
    liveWriterDatabaseUrl: env.LIVE_WRITER_DATABASE_URL,
  };
}

/**
 * Reemplazo para `assertLiveDatabase` en `services/core-api/src/live/live.sync.ts`.
 */
export function assertLiveDatabase(config: CoreApiCloudConfig): void {
  const writerUrl = config.liveWriterDatabaseUrl || config.databaseUrl;

  if (!writerUrl) {
    throw new Error('Live ingestion requires a configured database URL.');
  }

  // Modo Cloud Autorizado (Render -> Supabase dialektik-dev con rol dialektik_govuk_metadata_writer)
  if (config.allowCloudLiveIngestion) {
    if (!['unassigned', 'live_cloud'].includes(config.semanticMode)) {
      throw new Error(
        'Cloud live ingestion requires SEMANTIC_MODE to be "live_cloud" or "unassigned".',
      );
    }
    if (!isAuthorizedSupabaseCloudUrl(writerUrl)) {
      throw new Error(
        'Cloud live ingestion target rejected: host is not an authorized Supabase instance.',
      );
    }
    return;
  }

  // Modo Local Aislado (comportamiento original para pruebas locales)
  if (
    config.nodeEnv === 'production' ||
    config.semanticMode !== 'unassigned' ||
    !isLocalDatabaseUrl(writerUrl)
  ) {
    throw new Error(
      'Live ingestion requires its isolated local unassigned profile or ALLOW_CLOUD_LIVE_INGESTION=true.',
    );
  }
}