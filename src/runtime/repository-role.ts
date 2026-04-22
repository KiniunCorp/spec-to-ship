import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type RepositoryRole = 's2s-source' | 'user-project';

const SOURCE_PACKAGE_NAME = 'spec-to-ship';

export function detectRepositoryRole(repoRoot: string): RepositoryRole {
  return isSpecToShipSourceRepo(repoRoot) ? 's2s-source' : 'user-project';
}

export function isSpecToShipSourceRepo(repoRoot: string): boolean {
  const normalizedRoot = path.resolve(repoRoot);
  const packageJsonPath = path.join(normalizedRoot, 'package.json');
  if (!existsSync(packageJsonPath)) return false;

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
    if (String(pkg.name || '').trim() !== SOURCE_PACKAGE_NAME) return false;
  } catch {
    return false;
  }

  return existsSync(path.join(normalizedRoot, 'internal', 'self-host'));
}

export function assertUserProjectTarget(repoRoot: string, action: string): void {
  if (!isSpecToShipSourceRepo(repoRoot)) return;
  throw new Error(buildSourceRepoManagedProjectError(repoRoot, action));
}

export function buildSourceRepoManagedProjectError(repoRoot: string, action: string): string {
  const normalizedRoot = path.resolve(repoRoot);
  return [
    `Cannot ${action} in the spec-to-ship source repository: ${normalizedRoot}.`,
    'This repository is the product source, not a user project managed by `.s2s`.',
    'Develop spec-to-ship using the repo-root governance files and validate onboarding/runtime flows in an external test or app repository.',
    'If a local `.s2s/` was created here accidentally, remove it with `npm run selfhost:clean`.',
  ].join(' ');
}
