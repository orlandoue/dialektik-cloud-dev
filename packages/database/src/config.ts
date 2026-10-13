
export function databaseUrlFromEnvironment(
  environment: NodeJS.ProcessEnv,
  kind: 'development' | 'test',
): string {
  const variable = kind === 'development' ? 'DATABASE_URL' : 'TEST_DATABASE_URL';
  const configured = environment[variable];
  if (configured !== undefined && configured.trim() !== '') {
    return configured;
  }
  if (kind === 'test') {
    throw new Error('TEST_DATABASE_URL is required for isolated test databases.');
  }
  throw new Error(`${variable} is required.`);
}
