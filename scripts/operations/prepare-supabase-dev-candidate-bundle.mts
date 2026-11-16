import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import * as candidatePlanNamespace from '../../packages/database/src/migration/supabase-dev-candidate-plan.js';

// The repository is CommonJS while this one-off exporter is ESM (.mts). With
// tsx, importing the TypeScript module through its `.js` source mapping exposes
// its CommonJS exports under `default` instead of as ESM named exports. Resolve
// that namespace explicitly without changing package-wide module semantics.
const candidatePlanModule = (
  (candidatePlanNamespace as unknown as { default?: unknown }).default ??
  candidatePlanNamespace
) as typeof import('../../packages/database/src/migration/supabase-dev-candidate-plan.js');
const {
  createSupabaseDevCandidatePlan,
  SUPABASE_DEV_BASELINE_VERSION,
  SUPABASE_DEV_PROJECT_REF,
} = candidatePlanModule;

const root = process.cwd();
const remediationDirectory = resolve(
  root,
  'docs/operations/dev-deployment-remediation',
);
const outputArgs = process.argv.slice(2);
let requestedOutputDirectory = 'docs/operations/dev-deployment-remediation/payloads';
let requestedSnapshotPath = 'docs/operations/dev-deployment-remediation/remote-readonly-snapshot.json';
for (let index = 0; index < outputArgs.length; index += 2) {
  const option = outputArgs[index];
  const value = outputArgs[index + 1];
  if (value === undefined || value === '') {
    throw new Error('Usage: prepare-supabase-dev-candidate-bundle.mts [--snapshot-file <repo-relative-json>] [--output-dir <new-relative-directory>]');
  }
  if (option === '--output-dir') requestedOutputDirectory = value;
  else if (option === '--snapshot-file') requestedSnapshotPath = value;
  else throw new Error('Usage: prepare-supabase-dev-candidate-bundle.mts [--snapshot-file <repo-relative-json>] [--output-dir <new-relative-directory>]');
}
function resolveRepoRelativePath(candidate: string, label: string): string {
  if (isAbsolute(candidate)) throw new Error(`${label} must be relative to the repository.`);
  const resolved = resolve(root, candidate);
  const relativeToRoot = relative(root, resolved);
  if (
    relativeToRoot === '..' || relativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToRoot)
  ) throw new Error(`${label} must remain inside the repository.`);
  return resolved;
}
const outputDirectory = resolveRepoRelativePath(requestedOutputDirectory, 'Candidate output directory');
const snapshotPath = resolveRepoRelativePath(requestedSnapshotPath, 'Snapshot file');
const outputRelativeToRemediation = relative(remediationDirectory, outputDirectory);
if (
  outputRelativeToRemediation === '' ||
  outputRelativeToRemediation === '..' ||
  outputRelativeToRemediation.startsWith(`..${sep}`) ||
  isAbsolute(outputRelativeToRemediation)
) {
  throw new Error('Candidate output directory must be a new subdirectory of dev-deployment-remediation.');
}
const snapshotBytes = await readFile(snapshotPath);
const snapshot = JSON.parse(snapshotBytes.toString('utf8')) as unknown;
const plan = createSupabaseDevCandidatePlan(snapshot);

// The script only exports reviewed SQL. It has no database connection and
// deliberately refuses to overwrite earlier evidence.
await mkdir(remediationDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: false });
const artifacts = [];
for (const candidate of plan) {
  for (const [direction, sql] of [['up', candidate.upSql], ['down', candidate.downSql]] as const) {
    const file = `${candidate.sequence}_${candidate.sourceMigrationName}_${direction}.sql`;
    const bytes = Buffer.from(sql, 'utf8');
    await writeFile(resolve(outputDirectory, file), bytes, { flag: 'wx' });
    artifacts.push({
      file,
      direction,
      sequence: candidate.sequence,
      mcpMigrationName: candidate.mcpMigrationName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
    });
  }
}
const manifest = {
  schemaVersion: 1,
  mode: 'EXPORT_ONLY_NO_DATABASE_CONNECTION',
  projectRef: SUPABASE_DEV_PROJECT_REF,
  readOnlySnapshot: relative(root, snapshotPath).split(sep).join('/'),
  readOnlySnapshotSha256: createHash('sha256').update(snapshotBytes).digest('hex'),
  expectedBaselineLatestVersion: SUPABASE_DEV_BASELINE_VERSION,
  remoteOperation: 'NONE',
  remoteApplyAuthorized: 'NO',
  includedSequences: ['043', '044'],
  artifacts,
  forbiddenAutomaticActions: [
    'npm run db:migrate',
    'supabase db push',
    'supabase db reset --linked',
    'supabase migration repair',
    'automatic execution of any SQL payload',
  ],
  executionRequiresSeparateExplicitAuthorization: true,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(resolve(outputDirectory, 'manifest.json'), manifestBytes, { flag: 'wx' });
process.stdout.write(
  JSON.stringify({
    mode: manifest.mode,
    outputDirectory: relative(root, outputDirectory).split(sep).join('/'),
    projectRef: manifest.projectRef,
    sequences: manifest.includedSequences,
    artifacts: artifacts.map(({ file, sha256, bytes }) => ({ file, sha256, bytes })),
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  }) + '\n',
);
