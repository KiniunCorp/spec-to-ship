import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineeringExecutionHandoff, EngineeringExecutionTaskHandoff, ExecutionCommandTemplate, RuntimeConfig } from '../types/index.js';
import { commandExists, runShell } from './shell.js';
import { resolveExecutionTemplate } from './config.js';

export interface TaskExecutionResult {
  executed: number;
  completed: number;
  failed: number;
  mode: 'manual' | 'shell';
  taskReport: string;
}

export function executeOpenSpecTasks(
  worktreePath: string,
  runtimeConfig: RuntimeConfig,
  handoff: EngineeringExecutionHandoff,
): TaskExecutionResult {
  const tasksPath = path.join(worktreePath, 'openspec', 'changes', handoff.changeId, 'tasks.md');
  const content = readFileSync(tasksPath, 'utf8');
  const lines = content.split('\n');
  const selected = handoff.tasks.slice(0, Math.max(1, runtimeConfig.execution.maxTasksPerRun));

  if (selected.length === 0) {
    return {
      executed: 0,
      completed: 0,
      failed: 0,
      mode: runtimeConfig.execution.mode,
      taskReport: 'No persisted slice tasks were available for execution.',
    };
  }

  let completed = 0;
  let failed = 0;
  const reportLines: string[] = [];
  const template = resolveExecutionTemplate(runtimeConfig);
  const timeoutMs = runtimeConfig.execution.timeoutMs;
  const globalAllowlist = new Set(runtimeConfig.execution.allowedCommands || []);

  for (const task of selected) {
    if (runtimeConfig.execution.mode === 'manual') {
      reportLines.push(`- SKIP (manual): ${task.taskId} - ${task.title}`);
      continue;
    }

    const executionEnv = buildTaskEnv(task, handoff, worktreePath);
    let run;

    if (template) {
      if (!commandExists(template.command, worktreePath)) {
        failed += 1;
        reportLines.push(`- FAIL: ${task.taskId} - ${task.title}`);
        reportLines.push(`  setup: executable '${template.command}' not found in PATH.`);
        if (template.provider === 'opencode') {
          reportLines.push(
            '  action: update config/execution.templates.json (opencode_* command/args) to match your OpenCode CLI install.',
          );
        } else {
          reportLines.push(
            `  action: install '${template.command}' or switch execution.templateId in config/runtime.json.`,
          );
        }
        if (runtimeConfig.execution.stopOnFailure) break;
        continue;
      }

      const validationError = validateTemplateExecution(template, globalAllowlist);
      if (validationError) {
        failed += 1;
        reportLines.push(`- FAIL: ${task.taskId} - ${task.title}`);
        reportLines.push(`  security: ${validationError}`);
        if (runtimeConfig.execution.stopOnFailure) break;
        continue;
      }

      const args = template.args.map((arg) => renderTemplate(arg, executionEnv));
      const env = renderEnv(template.env || {}, executionEnv);
      run = runShell(
        template.command,
        args,
        worktreePath,
        true,
        {
          ...executionEnv,
          ...env,
        },
        template.timeoutMs || timeoutMs,
      );
    } else {
      if (!runtimeConfig.execution.allowUnsafeRawCommand) {
        failed += 1;
        reportLines.push(`- FAIL: ${task.taskId} - ${task.title}`);
        reportLines.push('  security: raw command execution disabled; configure a valid execution.templateId in config/runtime.json');
        reportLines.push(
          '  action: choose one of codex_*, claude_*, opencode_* (or enable raw commands explicitly, not recommended).',
        );
        if (runtimeConfig.execution.stopOnFailure) break;
        continue;
      }

      const rawCommand = runtimeConfig.execution.commandTemplate;
      if (!rawCommand.trim()) {
        failed += 1;
        reportLines.push(`- FAIL: ${task.taskId} - ${task.title}`);
        reportLines.push('  security: empty raw command template');
        if (runtimeConfig.execution.stopOnFailure) break;
        continue;
      }
      const rawValidation = validateRawCommand(rawCommand, globalAllowlist);
      if (rawValidation) {
        failed += 1;
        reportLines.push(`- FAIL: ${task.taskId} - ${task.title}`);
        reportLines.push(`  security: ${rawValidation}`);
        if (runtimeConfig.execution.stopOnFailure) break;
        continue;
      }

      run = runShell(
        'bash',
        ['-lc', rawCommand],
        worktreePath,
        true,
        executionEnv,
        timeoutMs,
      );
    }

    if (run.status === 0) {
      markTaskCompleted(lines, task.taskId);
      completed += 1;
      reportLines.push(`- OK: ${task.taskId} - ${task.title}`);
    } else {
      failed += 1;
      reportLines.push(`- FAIL: ${task.taskId} - ${task.title}`);
      reportLines.push(`  stderr: ${(run.stderr || run.stdout).trim().slice(0, 500)}`);
      if (runtimeConfig.execution.stopOnFailure) {
        break;
      }
    }
  }

  writeFileSync(tasksPath, `${lines.join('\n')}\n`, 'utf8');

  return {
    executed: selected.length,
    completed,
    failed,
    mode: runtimeConfig.execution.mode,
    taskReport: reportLines.join('\n'),
  };
}

function buildTaskEnv(
  task: EngineeringExecutionTaskHandoff,
  handoff: EngineeringExecutionHandoff,
  worktreePath: string,
): Record<string, string> {
  const allowedPaths = handoff.allowedPaths.length > 0 ? handoff.allowedPaths.join(', ') : 'none recorded';
  const outOfScopePaths = handoff.outOfScopePaths.length > 0 ? handoff.outOfScopePaths.join(', ') : 'none recorded';
  const acceptanceChecks = handoff.acceptanceChecks.length > 0 ? handoff.acceptanceChecks.join('; ') : 'none recorded';
  const dependencySummary = task.dependencyIds.length > 0 ? task.dependencyIds.join(', ') : 'none';
  const openspecRoot = path.join('openspec', 'changes', handoff.changeId);
  const strictPrompt = [
    `Implement slice ${handoff.sliceId} (${handoff.sliceTitle}) for change ${handoff.changeId} in the current repository.`,
    `Current task: ${task.taskId} - ${task.title}`,
    `Task summary: ${task.summary}`,
    `Task dependencies: ${dependencySummary}`,
    `Allowed paths: ${allowedPaths}`,
    `Out of scope: ${outOfScopePaths}`,
    `Acceptance checks: ${acceptanceChecks}`,
    `Use the materialized OpenSpec handoff under ${openspecRoot}/ and keep work aligned with the resolved slice context below.`,
    '',
    handoff.sliceContextDocument,
    '',
    'Requirements:',
    '- Apply minimal viable code changes.',
    '- Update/add tests as needed.',
    '- Keep changes aligned with the resolved slice task subset and OpenSpec artifacts.',
    '- Ensure lint/test/build pass.',
  ].join('\n');

  const fastPrompt = [
    `Implement quickly: ${task.taskId} - ${task.title}.`,
    `Stay inside allowed paths (${allowedPaths}) and preserve build stability.`,
  ].join('\n');

  return {
    AGP_TASK: `${task.taskId} - ${task.title}: ${task.summary}`,
    AGP_TASK_ID: task.taskId,
    AGP_TASK_TITLE: task.title,
    AGP_TASK_SUMMARY: task.summary,
    AGP_CHANGE_ID: handoff.changeId,
    AGP_PROJECT_ID: handoff.projectId,
    AGP_SPEC_ID: handoff.specId,
    AGP_SLICE_ID: handoff.sliceId,
    AGP_RUN_ID: handoff.runId || '',
    AGP_WORKTREE_PATH: worktreePath,
    AGP_ALLOWED_PATHS: allowedPaths,
    AGP_OUT_OF_SCOPE_PATHS: outOfScopePaths,
    AGP_ACCEPTANCE_CHECKS: acceptanceChecks,
    AGP_SLICE_CONTEXT: handoff.sliceContextDocument,
    AGP_PROMPT_STRICT: strictPrompt,
    AGP_PROMPT_FAST: fastPrompt,
  };
}

function markTaskCompleted(lines: string[], taskId: string): void {
  const pattern = new RegExp(`^(\\s*-\\s+\\[)\\s(\\]\\s+${escapeRegExp(taskId)}\\b.*)$`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index >= 0) {
    lines[index] = lines[index].replace(pattern, '$1x$2');
  }
}

function renderTemplate(value: string, env: Record<string, string>): string {
  return String(value || '').replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => env[name] ?? '');
}

function renderEnv(templateEnv: Record<string, string>, env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(templateEnv)) {
    out[key] = renderTemplate(value, env);
  }
  return out;
}

function validateTemplateExecution(template: ExecutionCommandTemplate, allowlist: Set<string>): string {
  if (!/^[a-zA-Z0-9._/-]+$/.test(template.command)) {
    return `invalid command name '${template.command}'`;
  }
  if (!allowlist.has(template.command)) {
    return `command '${template.command}' not allowed by runtime allowlist`;
  }
  if (!template.allowedCommands.includes(template.command)) {
    return `command '${template.command}' not allowed by template allowlist`;
  }
  return '';
}

function validateRawCommand(command: string, allowlist: Set<string>): string {
  const trimmed = String(command || '').trim();
  if (!trimmed) return 'raw command is empty';
  if (/[;&|`><]/.test(trimmed)) return 'raw command contains forbidden shell operators';
  const first = trimmed.split(/\s+/)[0] || '';
  if (!/^[a-zA-Z0-9._-]+$/.test(first)) return `invalid raw command executable '${first}'`;
  if (!allowlist.has(first)) return `raw command '${first}' not allowed by runtime allowlist`;
  return '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
