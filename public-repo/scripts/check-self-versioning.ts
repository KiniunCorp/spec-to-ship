import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const cliPath = path.join(repoRoot, 'src', 'cli.ts');

type Semver = {
  major: number;
  minor: number;
  patch: number;
  pre: string;
  build: string;
};

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

const IGNORED_PATH_PREFIXES = ['.s2s/', 'worklogs/', 'node_modules/'];

function main(): void {
  const failures: string[] = [];
  const pkgVersion = readPackageVersion(packageJsonPath, failures);
  const cliConstants = readCliVersionConstants(cliPath, failures);
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';

  if (pkgVersion && !parseSemver(pkgVersion)) {
    failures.push(`package.json version '${pkgVersion}' is not valid SemVer.`);
  }

  if (pkgVersion && cliConstants.CLI_VERSION && cliConstants.CLI_VERSION !== pkgVersion) {
    failures.push(`src/cli.ts CLI_VERSION (${cliConstants.CLI_VERSION}) must match package.json (${pkgVersion}).`);
  }
  if (pkgVersion && cliConstants.TEMPLATE_VERSION && cliConstants.TEMPLATE_VERSION !== pkgVersion) {
    failures.push(`src/cli.ts TEMPLATE_VERSION (${cliConstants.TEMPLATE_VERSION}) must match package.json (${pkgVersion}).`);
  }
  if (pkgVersion && cliConstants.DEFAULT_MIN_CLI_VERSION && cliConstants.DEFAULT_MIN_CLI_VERSION !== pkgVersion) {
    failures.push(
      `src/cli.ts DEFAULT_MIN_CLI_VERSION (${cliConstants.DEFAULT_MIN_CLI_VERSION}) must match package.json (${pkgVersion}).`,
    );
  }

  if (pkgVersion && !changelog.includes(`## ${pkgVersion}`)) {
    failures.push(`CHANGELOG.md must include a '## ${pkgVersion}' section.`);
  }

  const relevantChanges = listRelevantChanges();
  const baseRef = resolveBaseRef();
  const previousVersion = pkgVersion ? readBasePackageVersion(baseRef, failures) : '';

  if (relevantChanges.length > 0 && pkgVersion && previousVersion) {
    const currentParsed = parseSemver(pkgVersion);
    const previousParsed = parseSemver(previousVersion);
    if (!previousParsed) {
      failures.push(`Base package version '${previousVersion}' is not valid SemVer.`);
    } else if (!currentParsed || compareSemver(currentParsed, previousParsed) <= 0) {
      failures.push(
        `Repository changes require a version bump. package.json must increase from ${previousVersion} to a newer SemVer value.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('Self versioning policy failed:\n');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  const scope = relevantChanges.length > 0 ? `${relevantChanges.length} relevant changed file(s)` : 'no relevant pending diff';
  const baseSummary = previousVersion ? `base=${previousVersion}` : 'base=unavailable';
  console.log(`Self versioning policy passed (${scope}; current=${pkgVersion || 'unknown'}; ${baseSummary}).`);
}

function runGit(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function readPackageVersion(filePath: string, failures: string[]): string {
  try {
    const content = JSON.parse(readFileSync(filePath, 'utf8')) as { version?: unknown };
    return String(content.version || '').trim();
  } catch {
    failures.push('Failed to read package.json version.');
    return '';
  }
}

function readCliVersionConstants(filePath: string, failures: string[]): Record<string, string> {
  if (!existsSync(filePath)) {
    failures.push('src/cli.ts not found.');
    return {};
  }
  const content = readFileSync(filePath, 'utf8');
  const names = ['CLI_VERSION', 'TEMPLATE_VERSION', 'DEFAULT_MIN_CLI_VERSION'] as const;
  const values: Record<string, string> = {};

  for (const name of names) {
    const match = content.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`));
    if (!match) {
      failures.push(`src/cli.ts is missing ${name}.`);
      continue;
    }
    values[name] = String(match[1] || '').trim();
  }

  return values;
}

function resolveBaseRef(): string {
  const githubBase = String(process.env.GITHUB_BASE_REF || '').trim();
  const candidates = githubBase
    ? [`origin/${githubBase}`, githubBase, 'origin/main', 'main']
    : ['origin/main', 'main'];

  for (const candidate of candidates) {
    const probe = runGit(['rev-parse', '--verify', candidate]);
    if (probe.ok) return candidate;
  }

  return '';
}

function readBasePackageVersion(baseRef: string, failures: string[]): string {
  if (!baseRef) return '';
  const mergeBase = runGit(['merge-base', 'HEAD', baseRef]);
  if (!mergeBase.ok || !mergeBase.stdout) return '';

  const baseManifest = runGit(['show', `${mergeBase.stdout}:package.json`]);
  if (!baseManifest.ok || !baseManifest.stdout) return '';

  try {
    const parsed = JSON.parse(baseManifest.stdout) as { version?: unknown };
    return String(parsed.version || '').trim();
  } catch {
    failures.push(`Failed to parse package.json from merge-base against ${baseRef}.`);
    return '';
  }
}

function listRelevantChanges(): string[] {
  const changed = new Set<string>();

  for (const file of listGitFiles(['diff', '--name-only', 'HEAD'])) {
    changed.add(file);
  }
  for (const file of listGitFiles(['ls-files', '--others', '--exclude-standard'])) {
    changed.add(file);
  }

  const baseRef = resolveBaseRef();
  if (baseRef) {
    const mergeBase = runGit(['merge-base', 'HEAD', baseRef]);
    if (mergeBase.ok && mergeBase.stdout) {
      for (const file of listGitFiles(['diff', '--name-only', `${mergeBase.stdout}...HEAD`])) {
        changed.add(file);
      }
    }
  }

  return [...changed]
    .map((file) => normalizePath(file))
    .filter(Boolean)
    .filter((file) => !IGNORED_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)));
}

function listGitFiles(args: string[]): string[] {
  const result = runGit(args);
  if (!result.ok || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .map((line) => normalizePath(line))
    .filter(Boolean);
}

function normalizePath(value: string): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function parseSemver(value: string): Semver | null {
  const match = String(value || '').trim().match(SEMVER_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: String(match[4] || ''),
    build: String(match[5] || ''),
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre);
}

main();
