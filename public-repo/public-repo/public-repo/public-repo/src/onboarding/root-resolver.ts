import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface OnboardingRootResolution {
  requestedPath: string;
  gitRoot: string | null;
  isGitRepository: boolean;
  isGitSubdirectory: boolean;
  recommendedRoot: string;
}

export function resolveOnboardingRoot(startPath: string): OnboardingRootResolution {
  const requestedPath = path.resolve(startPath);
  const gitRoot = detectGitTopLevel(requestedPath);
  const isGitRepository = Boolean(gitRoot);
  const isGitSubdirectory = Boolean(gitRoot && path.resolve(gitRoot) !== requestedPath);
  const recommendedRoot = gitRoot ? path.resolve(gitRoot) : requestedPath;

  return {
    requestedPath,
    gitRoot,
    isGitRepository,
    isGitSubdirectory,
    recommendedRoot,
  };
}

export function detectGitTopLevel(startPath: string): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: startPath,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });
  if ((result.status ?? 1) !== 0) return null;
  const out = String(result.stdout || '').trim();
  return out ? path.resolve(out) : null;
}

