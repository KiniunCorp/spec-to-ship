import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RuntimeConfig } from '../types/index.js';
import { runShell } from './shell.js';

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export interface DeliveryVersioningResult {
  manifestFile: string;
  previousVersion?: string;
  nextVersion: string;
  bumpType: 'initial' | 'major' | 'minor' | 'patch' | 'prerelease' | 'build';
  changelogUpdated: boolean;
  note: string;
}

export function enforceVersioningBeforeDelivery(
  repoPath: string,
  config: RuntimeConfig,
  stagedFiles: readonly string[],
): DeliveryVersioningResult | null {
  const enforcementEnabled = config.versioning?.enforceSemverBumpOnDelivery !== false;
  if (!enforcementEnabled) return null;
  if (stagedFiles.length === 0) return null;

  const manifestFile = normalizeRepoRelativePath(config.versioning?.manifestFile, 'package.json');
  const changelogFile = normalizeRepoRelativePath(config.versioning?.changelogFile, 'CHANGELOG.md');
  const requireChangelog = config.versioning?.requireChangelogUpdate !== false;
  const stagedSet = new Set(stagedFiles.map((item) => normalizePathForGit(item)));
  const manifestPath = path.join(repoPath, manifestFile);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[versioning] Missing manifest '${manifestFile}'. ` +
      'Define a SemVer manifest or disable runtime.versioning.enforceSemverBumpOnDelivery.',
    );
  }

  const nextVersion = readVersionFromPackageManifest(manifestPath, manifestFile);
  const previousVersion = readVersionFromGitHead(repoPath, manifestFile);
  const parsedNext = parseSemverStrict(nextVersion);
  if (!parsedNext) {
    throw new Error(
      `[versioning] Invalid SemVer in ${manifestFile}: '${nextVersion}'. ` +
      'Expected MAJOR.MINOR.PATCH per semver.org.',
    );
  }

  let bumpType: DeliveryVersioningResult['bumpType'] = 'initial';
  if (previousVersion) {
    const parsedPrevious = parseSemverStrict(previousVersion);
    if (!parsedPrevious) {
      throw new Error(
        `[versioning] Invalid previous SemVer in HEAD ${manifestFile}: '${previousVersion}'.`,
      );
    }
    const comparison = compareSemver(parsedNext, parsedPrevious);
    if (comparison <= 0) {
      throw new Error(
        `[versioning] Version bump required before commit/push/PR. ` +
        `${manifestFile} must increase from ${previousVersion} to a newer SemVer value.`,
      );
    }
    bumpType = classifyBump(parsedPrevious, parsedNext);
  }

  if (!stagedSet.has(manifestFile)) {
    throw new Error(
      `[versioning] Version bump required. '${manifestFile}' must be part of the staged changes.`,
    );
  }

  enforceLockfilePolicy(repoPath, manifestFile, stagedSet);

  if (requireChangelog) {
    const changelogPath = path.join(repoPath, changelogFile);
    if (!existsSync(changelogPath)) {
      throw new Error(
        `[versioning] Missing changelog '${changelogFile}'. ` +
        'Create/update it for each version bump or disable runtime.versioning.requireChangelogUpdate.',
      );
    }
    if (!stagedSet.has(changelogFile)) {
      throw new Error(
        `[versioning] '${changelogFile}' must be updated and staged with the version bump.`,
      );
    }
  }

  const note = previousVersion
    ? `version bump: ${previousVersion} -> ${nextVersion} (${bumpType})`
    : `version set: ${nextVersion} (${bumpType})`;

  return {
    manifestFile,
    previousVersion: previousVersion || undefined,
    nextVersion,
    bumpType,
    changelogUpdated: requireChangelog,
    note,
  };
}

function enforceLockfilePolicy(
  repoPath: string,
  manifestFile: string,
  stagedSet: Set<string>,
): void {
  if (manifestFile !== 'package.json') return;
  const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']
    .filter((name) => existsSync(path.join(repoPath, name)));
  if (lockfiles.length === 0) return;
  const hasAnyLockfileStaged = lockfiles.some((name) => stagedSet.has(name));
  if (!hasAnyLockfileStaged) {
    throw new Error(
      `[versioning] Lockfile update required with package.json version bump. ` +
      `Expected one of: ${lockfiles.join(', ')}.`,
    );
  }
}

function readVersionFromGitHead(repoPath: string, manifestFile: string): string {
  const headExists = runShell('git', ['rev-parse', '--verify', 'HEAD'], repoPath, true);
  if (headExists.status !== 0) return '';
  const snapshot = runShell('git', ['show', `HEAD:${manifestFile}`], repoPath, true);
  if (snapshot.status !== 0) return '';
  return extractVersionFromManifest(snapshot.stdout, manifestFile);
}

function readVersionFromPackageManifest(filePath: string, manifestFile: string): string {
  const content = readFileSync(filePath, 'utf8');
  return extractVersionFromManifest(content, manifestFile);
}

function extractVersionFromManifest(content: string, manifestFile: string): string {
  if (manifestFile.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content) as { version?: unknown };
      return String(parsed.version || '').trim();
    } catch {
      throw new Error(`[versioning] Invalid JSON in ${manifestFile}.`);
    }
  }
  return '';
}

function normalizeRepoRelativePath(value: string | undefined, fallback: string): string {
  const normalized = normalizePathForGit(String(value || '').trim() || fallback);
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('../')) return fallback;
  return normalized;
}

function normalizePathForGit(value: string): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  pre: string;
  build: string;
};

function parseSemverStrict(value: string): ParsedSemver | null {
  const raw = String(value || '').trim();
  const match = raw.match(SEMVER_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: String(match[4] || ''),
    build: String(match[5] || ''),
  };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre);
}

function classifyBump(
  previous: ParsedSemver,
  next: ParsedSemver,
): DeliveryVersioningResult['bumpType'] {
  if (next.major > previous.major) return 'major';
  if (next.minor > previous.minor) return 'minor';
  if (next.patch > previous.patch) return 'patch';
  if (next.pre !== previous.pre) return 'prerelease';
  return 'build';
}
