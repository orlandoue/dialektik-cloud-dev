const LOCAL_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SAFE_DATABASE_NAME = /^dialektik_(?:dev|test)(?:_[a-z0-9]+)*$/u;

export function authorizedLocalRebuildTarget(
  databaseUrl: URL,
  authorization: string | undefined,
): string {
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname)) {
    throw new Error('Refusing rebuild. The database host must be local.');
  }
  if (!SAFE_DATABASE_NAME.test(databaseName) || authorization !== databaseName) {
    throw new Error(
      'Refusing rebuild. Target must start with dialektik_dev or dialektik_test, ' +
        'and DIALEKTIK_ALLOW_DATABASE_REBUILD must exactly equal its name.',
    );
  }
  return databaseName;
}
