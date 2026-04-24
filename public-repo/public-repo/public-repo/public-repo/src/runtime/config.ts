import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import path from 'node:path';
import type {
  ExecutionCommandTemplate,
  RuntimeConfig,
  WorkspaceBootstrapOptions,
  WorkspaceBootstrapResult,
} from '../types/index.js';
import { assertUserProjectTarget } from './repository-role.js';
import { installWorkspaceGuardrails } from './workspace-guardrails.js';

const DEFAULT_CONFIG: RuntimeConfig = {
  productName: 'spec-to-ship',
  defaultBranch: 'main',
  guardrailPolicy: 'strict',
  workspace: {
    basePath: '.',
    orchestratorDirName: '.',
    projectDirName: 'my-app',
    worktreesDirName: 'my-app-worktrees',
  },
  github: {
    remoteName: 'origin',
    autoPush: true,
    autoPR: true,
    autoMerge: false,
  },
  execution: {
    mode: 'shell',
    templateId: 'codex_strict',
    commandTemplate: '',
    maxTasksPerRun: 3,
    stopOnFailure: true,
    timeoutMs: 1200000,
    allowedCommands: ['codex', 'claude', 'opencode', 'just', 'pnpm', 'node', 'git'],
    allowUnsafeRawCommand: false,
  },
  costControl: {
    enabled: false,
    budgetUsd: 0,
    warnThresholdPct: 80,
    hardStopThresholdPct: 100,
  },
  chatObservability: {
    sessionBannerEnabled: true,
    wrapperPrefixEnabled: false,
    wrapperPrefixTemplate: '▶ S2S ACTIVE · project: ${PROJECT_ALIAS} · stage: ${STAGE}',
  },
  versioning: {
    enforceSemverBumpOnDelivery: true,
    requireChangelogUpdate: true,
    manifestFile: 'package.json',
    changelogFile: 'CHANGELOG.md',
  },
};

export function loadRuntimeConfig(): RuntimeConfig {
  const configPath = getRuntimeConfigPath();
  try {
    const content = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content) as Partial<RuntimeConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      guardrailPolicy: normalizeGuardrailPolicy(parsed.guardrailPolicy),
      workspace: {
        ...DEFAULT_CONFIG.workspace,
        ...(parsed.workspace || {}),
      },
      github: {
        ...DEFAULT_CONFIG.github,
        ...(parsed.github || {}),
      },
      execution: {
        ...DEFAULT_CONFIG.execution,
        ...(parsed.execution || {}),
      },
      costControl: {
        ...DEFAULT_CONFIG.costControl,
        ...(parsed.costControl || {}),
      },
      chatObservability: {
        ...DEFAULT_CONFIG.chatObservability,
        ...(parsed.chatObservability || {}),
      },
      versioning: {
        ...DEFAULT_CONFIG.versioning,
        ...(parsed.versioning || {}),
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function normalizeGuardrailPolicy(value: unknown): RuntimeConfig['guardrailPolicy'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'warn' || normalized === 'prompt') return normalized;
  return 'strict';
}

export function getRuntimeConfigPath(): string {
  return resolve(process.cwd(), 'config', 'runtime.json');
}

export function saveRuntimeConfig(config: RuntimeConfig): void {
  const configPath = getRuntimeConfigPath();
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function loadExecutionTemplates(): ExecutionCommandTemplate[] {
  const templatesPath = resolve(process.cwd(), 'config', 'execution.templates.json');
  try {
    const content = readFileSync(templatesPath, 'utf8');
    const parsed = JSON.parse(content) as ExecutionCommandTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resolveExecutionTemplate(config: RuntimeConfig): ExecutionCommandTemplate | null {
  const templateId = String(config.execution.templateId || '').trim();
  if (!templateId) return null;
  const templates = loadExecutionTemplates();
  return templates.find((template) => template.id === templateId) || null;
}

export function bootstrapWorkspace(options: WorkspaceBootstrapOptions): WorkspaceBootstrapResult {
  const appName = normalizeName(options.appName || 'my-app');
  const runtime = loadRuntimeConfig();
  const configPath = getRuntimeConfigPath();

  const workspaceBase = path.resolve(process.cwd(), runtime.workspace.basePath || '.');
  const appRepoPath = path.resolve(workspaceBase, options.appRepoPath || appName);
  const worktreesRootPath = path.resolve(workspaceBase, options.worktreesRootPath || `${appName}-worktrees`);
  assertUserProjectTarget(appRepoPath, 'use workspace bootstrap with the source repository as the target app repo');

  const createdDirectories: string[] = [];
  const createIfMissing = options.createIfMissing !== false;

  if (createIfMissing) {
    for (const dir of [appRepoPath, worktreesRootPath]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        createdDirectories.push(dir);
      }
    }
  }

  const workdirPath = path.dirname(appRepoPath);
  const orchestratorDirName = path.relative(workdirPath, process.cwd()) || '.';
  const orchestratorPath = path.resolve(workdirPath, orchestratorDirName);

  const next: RuntimeConfig = {
    ...runtime,
    workspace: {
      ...runtime.workspace,
      basePath: workdirPath,
      orchestratorDirName,
      projectDirName: path.basename(appRepoPath),
      worktreesDirName: path.basename(worktreesRootPath),
      projectRepoPath: appRepoPath,
      worktreesRootPath,
    },
  };

  saveRuntimeConfig(next);
  const guardrails = installWorkspaceGuardrails({
    workdirPath,
    orchestratorPath,
    appRepoPath,
    worktreesRootPath,
  });

  return {
    appName,
    appRepoPath,
    worktreesRootPath,
    configPath,
    createdDirectories,
    guardrails,
    updated: true,
  };
}

function normalizeName(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'my-app';
}
