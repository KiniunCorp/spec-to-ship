import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveLocalS2SControlRoot, resolveLocalS2SRuntimeRoot, resolveLocalS2SWorktreesRoot, resolveLocalS2SRepoWorktreesRoot } from '../../runtime/worktree-provider.js';
import { detectGitTopLevel } from '../../onboarding/root-resolver.js';

export function expandHomePath(value: string): string {
  if (!value.startsWith('~')) return value;
  if (value === '~') return userHomePath();
  return path.join(userHomePath(), value.slice(2));
}

export function userHomePath(): string {
  return path.resolve(process.env.HOME || homedir());
}

export function resolvePotentialPath(inputPath: string): string | null {
  const trimmed = String(inputPath || '').trim();
  if (!trimmed) return null;
  const isPathLike =
    trimmed.includes('/')
    || trimmed.startsWith('.')
    || trimmed.startsWith('~')
    || path.isAbsolute(trimmed);
  if (!isPathLike) return null;
  return path.resolve(expandHomePath(trimmed));
}

export function resolveAppPath(inputPath: string): string {
  const raw = String(inputPath || '').trim();
  if (!raw || raw === '.') {
    return process.cwd();
  }
  return path.resolve(expandHomePath(raw));
}

export function normalizeComparablePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const trailing: string[] = [];
  let current = resolved;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    trailing.unshift(path.basename(current));
    current = parent;
  }
  let canonicalBase = current;
  try {
    canonicalBase = realpathSync(current);
  } catch {
    canonicalBase = current;
  }
  return path.resolve(canonicalBase, ...trailing);
}

export function globalS2SHomePath(): string {
  return resolveLocalS2SControlRoot();
}

export function globalRuntimeHomePath(): string {
  return resolveLocalS2SRuntimeRoot(globalS2SHomePath());
}

export function globalWorktreesHomePath(): string {
  return resolveLocalS2SWorktreesRoot({ controlRoot: globalS2SHomePath() });
}

export function defaultManagedWorktreesRootPath(appRoot: string): string {
  return resolveLocalS2SRepoWorktreesRoot({ repoRoot: appRoot });
}

export function managedLLMWorkspaceDir(appRoot: string): string {
  return path.join(globalS2SHomePath(), 'llm-workspaces', projectBackupKey(appRoot));
}

export function ensureManagedLLMWorkspace(appRoot: string): string {
  const dir = managedLLMWorkspaceDir(appRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectBackupKey(appRoot: string): string {
  const normalized = path.resolve(appRoot);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function isPathEqualOrInside(candidatePath: string, parentPath: string): boolean {
  const candidate = normalizeComparablePath(candidatePath);
  const parent = normalizeComparablePath(parentPath);
  if (candidate === parent) return true;
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function findNearestProjectRoot(startPath: string): string | null {
  const gitTopLevel = findGitTopLevel(startPath);
  const normalizedGitTopLevel = gitTopLevel ? normalizeComparablePath(gitTopLevel) : null;
  let current = normalizeComparablePath(startPath);
  if (!normalizedGitTopLevel) {
    const hasLocalProjectConfig = existsSync(path.join(current, '.s2s', 'project.json'));
    return hasLocalProjectConfig ? current : null;
  }
  while (true) {
    const hasProjectConfig = existsSync(path.join(current, '.s2s', 'project.json'));
    if (hasProjectConfig) return current;
    if (normalizedGitTopLevel && current === normalizedGitTopLevel) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function findGitTopLevel(startPath: string): string | null {
  return detectGitTopLevel(startPath);
}
