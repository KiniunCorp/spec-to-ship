import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { RuntimeConfig, RuntimeWorkspacePaths } from '../types/index.js';

export function resolveWorkspacePaths(config: RuntimeConfig, appName?: string): RuntimeWorkspacePaths {
  const workspaceBase = path.resolve(process.cwd(), config.workspace.basePath);
  const resolvedAppName = normalizeName(appName || config.workspace.projectDirName || 'my-app');
  const worktreesDirName = normalizeName(config.workspace.worktreesDirName || `${resolvedAppName}-worktrees`);

  const orchestratorRepoPath = path.resolve(workspaceBase, config.workspace.orchestratorDirName || '.');
  const projectRepoPath = config.workspace.projectRepoPath
    ? path.resolve(config.workspace.projectRepoPath)
    : path.resolve(workspaceBase, resolvedAppName);
  const worktreesRootPath = config.workspace.worktreesRootPath
    ? path.resolve(config.workspace.worktreesRootPath)
    : path.resolve(workspaceBase, worktreesDirName);

  return {
    basePath: workspaceBase,
    orchestratorRepoPath,
    projectRepoPath,
    worktreesRootPath,
  };
}

export function ensureWorkspaceLayout(paths: RuntimeWorkspacePaths): string[] {
  const created: string[] = [];

  for (const dir of [paths.basePath, paths.worktreesRootPath]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  return created;
}

function normalizeName(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'my-app';
}
