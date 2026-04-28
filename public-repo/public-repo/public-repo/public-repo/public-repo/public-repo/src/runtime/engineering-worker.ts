import { commandExists, runShell } from './shell.js';
import { materializeOpenSpecChange } from './openspec-bridge.js';
import { executeOpenSpecTasks } from './task-executor.js';
import type { EngineeringExecutionHandoff, RuntimeConfig } from '../types/index.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveExecutionTemplate } from './config.js';

export interface EngineeringWorkerResult {
  worktreePath: string;
  openspecFiles: string[];
  verifyPassed: boolean;
  verifyOutput: string;
  executionReport: string;
  taskExecutionFailed: boolean;
}

export function runEngineeringWorker(
  projectRepoPath: string,
  handoff: EngineeringExecutionHandoff,
  runtimeConfig: RuntimeConfig,
  dryRun = false,
): EngineeringWorkerResult {
  if (dryRun) {
    const syntheticPath = `${projectRepoPath}/../<worktree-for-${handoff.changeId}>`;
    return {
      worktreePath: syntheticPath,
      openspecFiles: [],
      verifyPassed: true,
      verifyOutput: 'Dry-run: no worktree or validation executed.',
      executionReport: 'Dry-run: no task execution attempted.',
      taskExecutionFailed: false,
    };
  }

  if (!commandExists('just', projectRepoPath)) {
    throw new Error('The target app repository must provide `just` (required by the engineering delivery flow).');
  }

  normalizeWorkspaceConfig(projectRepoPath);

  const template = resolveExecutionTemplate(runtimeConfig);
  const provider = template?.provider || 'codex';
  const changeCmd = runShell('just', ['change-worktree', handoff.changeId, provider], projectRepoPath, true);
  if (changeCmd.status !== 0) {
    throw new Error(`Failed to create/use worktree: ${changeCmd.stderr || changeCmd.stdout}`);
  }
  const worktreePath = extractWorktreePath(changeCmd.stdout) || projectRepoPath;

  const openspecFiles = materializeOpenSpecChange(worktreePath, handoff);
  const taskExecution = executeOpenSpecTasks(worktreePath, runtimeConfig, handoff);

  // Ensure the worktree has dependencies available before running verification.
  const installer = resolveInstaller(worktreePath);
  const installCmd = runShell(installer.command, installer.args, worktreePath, true);
  const installOutput = `${installCmd.stdout}\n${installCmd.stderr}`.trim();

  const verifyCmd = runShell('just', ['agent-verify'], worktreePath, true);
  const verifyPassed = installCmd.status === 0 && verifyCmd.status === 0 && taskExecution.failed === 0;
  const verifyOutput = [
    `[${installer.command} ${installer.args.join(' ')}]`,
    installOutput,
    '',
    `[just agent-verify]`,
    `${verifyCmd.stdout}\n${verifyCmd.stderr}`.trim(),
  ]
    .join('\n')
    .trim();

  return {
    worktreePath,
    openspecFiles,
    verifyPassed,
    verifyOutput,
    executionReport: taskExecution.taskReport,
    taskExecutionFailed: taskExecution.failed > 0,
  };
}

function resolveInstaller(worktreePath: string): { command: string; args: string[] } {
  const pnpmLock = path.join(worktreePath, 'pnpm-lock.yaml');
  const npmLock = path.join(worktreePath, 'package-lock.json');
  const yarnLock = path.join(worktreePath, 'yarn.lock');

  if (existsSync(pnpmLock) && commandExists('pnpm', worktreePath)) {
    return { command: 'pnpm', args: ['install', '--frozen-lockfile'] };
  }
  if (existsSync(yarnLock) && commandExists('yarn', worktreePath)) {
    return { command: 'yarn', args: ['install', '--frozen-lockfile'] };
  }
  if (existsSync(npmLock) && commandExists('npm', worktreePath)) {
    return { command: 'npm', args: ['ci'] };
  }
  if (commandExists('pnpm', worktreePath)) {
    return { command: 'pnpm', args: ['install'] };
  }
  if (commandExists('npm', worktreePath)) {
    return { command: 'npm', args: ['install'] };
  }
  if (commandExists('yarn', worktreePath)) {
    return { command: 'yarn', args: ['install'] };
  }
  return { command: 'npm', args: ['install'] };
}

function normalizeWorkspaceConfig(projectRepoPath: string): void {
  const repoName = path.basename(projectRepoPath);
  const cfgPath = path.join(projectRepoPath, 'config', 'workspace.paths.json');
  if (!existsSync(cfgPath)) return;

  try {
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
      project_dir_name?: string;
      workdir_dir_name?: string;
      worktrees_root?: string;
    };
    const json = {
      project_dir_name:
        String(parsed.project_dir_name || '').includes('__APP_SLUG__') || !String(parsed.project_dir_name || '').trim()
          ? repoName
          : parsed.project_dir_name,
      workdir_dir_name:
        String(parsed.workdir_dir_name || '').includes('__APP_SLUG__') || !String(parsed.workdir_dir_name || '').trim()
          ? `${repoName}-workdir`
          : parsed.workdir_dir_name,
      worktrees_root:
        String(parsed.worktrees_root || '').includes('__APP_SLUG__') || !String(parsed.worktrees_root || '').trim()
          ? `../${repoName}-worktrees`
          : parsed.worktrees_root,
    };
    writeFileSync(cfgPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  } catch {
    // Ignore malformed config and let app-level scripts handle defaults.
  }
}

function extractWorktreePath(output: string): string {
  const lines = String(output || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('path:')) {
      return trimmed.slice('path:'.length).trim();
    }
  }
  return '';
}
