import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveDesignContextHandoff } from '../agents/design.js';
import { ensureProjectDir, writeArtifact } from '../artifacts/store.js';
import type {
  ExecutionTraceabilityRecord,
  EngineeringExecutionHandoff,
  EngineeringExecOptions,
  EngineeringExecResult,
  GitOperationResult,
  RuntimeConfig,
  SliceContextDocumentOptions,
  WorkArtifactReference,
  WorkRunEvidence,
} from '../types/index.js';
import {
  completeExecutionRun,
  createExecutionRun,
  listRunsByStatus,
  markExecutionRunVerifying,
  requireChange,
  requireNextExecutableSlice,
  requireRun,
  requireSlice,
  requireSpec,
  startExecutionRun,
} from '../ledger/index.js';
import { loadRuntimeConfig, resolveExecutionTemplate } from './config.js';
import { buildChangeBranchName, ensureOrInitGitRepository, executeGitDelivery } from './github-operator.js';
import { detectGuardrailConflicts, hasBlockingGuardrailConflict } from './guardrail-conflicts.js';
import { assertUserProjectTarget } from './repository-role.js';
import { ensureWorkspaceLayout, resolveWorkspacePaths } from './workspace-manager.js';
import { runEngineeringWorker } from './engineering-worker.js';

export interface EngineeringExecChatNativeStartResult {
  contextPackage: string;
  runId: string;
  sliceId: string;
  branchName: string;
}

/**
 * Chat-native engineering_exec initiation.
 * Finds the next ready slice, creates + starts an execution run, writes SLICE_CONTEXT.md,
 * and returns a context package for the orchestrating chat AI to act on.
 * No LLM or worktree is spawned — the chat AI implements the slice directly.
 */
export function startEngineeringExecChatNativeRun(
  projectId: string,
  appRoot: string,
): EngineeringExecChatNativeStartResult {
  // Recovery: if a run is already in progress, resume it rather than starting a new one
  // for a different slice. This handles the case where --submit previously failed.
  const existingRunningRuns = listRunsByStatus(projectId, 'running')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (existingRunningRuns.length > 0) {
    const run = existingRunningRuns[0];
    const handoff = buildEngineeringExecutionHandoff(projectId, {
      sliceId: run.sliceId,
      runId: run.id,
      provider: run.provider || 'claude',
      branchName: run.branchName,
      projectRepoPath: appRoot,
    });
    writeArtifact(projectId, 'SLICE_CONTEXT.md', handoff.sliceContextDocument);
    const contextPackage = renderEngineeringExecChatContextPackage(handoff, appRoot);
    return { contextPackage, runId: run.id, sliceId: run.sliceId, branchName: run.branchName ?? '' };
  }

  const selectedSlice = requireNextExecutableSlice(projectId, { projectWide: true });
  const branchProvider = 'claude';
  const branchName = buildChangeBranchName(selectedSlice.changeId, branchProvider);

  const created = createExecutionRun(projectId, selectedSlice.id, {
    provider: branchProvider,
    branchName,
    resultSummary: `Created chat-native execution run for slice '${selectedSlice.id}'.`,
  });
  const runId = created.run.id;
  startExecutionRun(projectId, runId, {
    branchName,
    resultSummary: `Chat-native execution started for slice '${selectedSlice.id}'.`,
  });

  const handoff = buildEngineeringExecutionHandoff(projectId, {
    sliceId: selectedSlice.id,
    runId,
    provider: branchProvider,
    branchName,
    projectRepoPath: appRoot,
  });
  writeArtifact(projectId, 'SLICE_CONTEXT.md', handoff.sliceContextDocument);

  const contextPackage = renderEngineeringExecChatContextPackage(handoff, appRoot);
  return { contextPackage, runId, sliceId: selectedSlice.id, branchName };
}

function renderEngineeringExecChatContextPackage(
  handoff: EngineeringExecutionHandoff,
  appRoot: string,
): string {
  const sliceLabel = [handoff.sliceId, handoff.sliceTitle].filter(Boolean).join(' — ');
  const lines: string[] = [
    `=== S2S TASK: engineering_exec stage ===`,
    '',
    'OBJECTIVE',
    `Implement ${sliceLabel}`,
    '',
    'SLICE CONTEXT',
    handoff.sliceContextDocument.trim(),
    '',
    'DELIVERY INSTRUCTIONS',
    `- Repository: ${appRoot}`,
    `- Work on branch: \`${handoff.branchName}\``,
    '- Stay within the allowed paths; do not touch out-of-scope paths',
    '- Run the project\'s verification commands (tests, lint) when implementation is complete',
    '- Create a pull request targeting the default branch',
    '',
    'WHEN DONE',
    `Run: s2s stage engineering_exec --submit`,
    '=========================',
  ];
  return lines.join('\n');
}

export function deriveChangeId(projectId: string, fallback = 'implement-backlog'): string {
  const normalized = String(projectId || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

export async function runEngineeringExecution(projectId: string, options: EngineeringExecOptions = {}): Promise<EngineeringExecResult> {
  ensureProjectDir(projectId);

  const config = applyWorkspaceOverrides(loadRuntimeConfig(), options);
  const appName = sanitizeName(options.appName || config.workspace.projectDirName || projectId);
  const requestedChangeId = normalizeOptional(options.changeId);
  const requestedSliceId = normalizeOptional(options.sliceId);
  const selectedSlice = requestedSliceId
    ? requireSlice(projectId, requestedSliceId)
    : requireNextExecutableSlice(projectId, requestedChangeId ? { changeId: requestedChangeId } : {});
  if (requestedChangeId && requestedChangeId !== selectedSlice.changeId) {
    throw new Error(
      `engineering_exec received changeId '${requestedChangeId}' that does not match slice '${selectedSlice.id}' (change '${selectedSlice.changeId}').`,
    );
  }
  const changeId = sanitizeName(selectedSlice.changeId || requestedChangeId || deriveChangeId(projectId));
  const template = resolveExecutionTemplate(config);
  const branchProvider = template?.provider || 'custom';
  const branchName = buildChangeBranchName(changeId, branchProvider);
  const dryRun = Boolean(options.dryRun);

  const paths = resolveWorkspacePaths(config, appName);
  assertUserProjectTarget(paths.projectRepoPath, 'run engineering_exec against the source repository');
  ensureWorkspaceLayout(paths);
  enforceStrictGuardrailPolicy(config, paths.projectRepoPath);
  let repoInitialized = false;
  let hasRemote = false;
  if (!dryRun) {
    const repoState = ensureOrInitGitRepository(paths.projectRepoPath, {
      defaultBranch: config.defaultBranch,
      initializeIfMissing: options.initializeLocalGitIfMissing !== false,
      remoteName: options.gitRemoteName || config.github.remoteName,
      remoteUrl: options.gitRemoteUrl,
    });
    repoInitialized = repoState.initialized;
    hasRemote = repoState.hasRemote;
  }

  const generatedArtifacts: string[] = [];
  let runId: string;
  let resolvedWorktreePath: string | undefined;

  const syncNote = buildEngineeringSyncNote(paths.projectRepoPath, changeId, appName);
  const targetFile = path.join(paths.projectRepoPath, 'ENGINEERING_EXECUTION.md');
  writeArtifact(projectId, 'EngineeringExecutionTarget.txt', `${targetFile}\n`);
  generatedArtifacts.push('EngineeringExecutionTarget.txt');

  if (!dryRun) {
    // Persist a deterministic handoff note in the app repo branch.
    // This allows the engineering runtime to keep traceability across repos.
    mkdirSync(path.dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, syncNote, 'utf8');
  }

  const created = createExecutionRun(projectId, selectedSlice.id, {
    provider: branchProvider,
    branchName,
    resultSummary: dryRun
      ? `Prepared dry-run execution for slice '${selectedSlice.id}'.`
      : `Created execution run for slice '${selectedSlice.id}'.`,
  });
  runId = created.run.id;
  startExecutionRun(projectId, runId, {
    branchName,
    resultSummary: `Execution started for slice '${selectedSlice.id}'.`,
  });

  const handoff = buildEngineeringExecutionHandoff(projectId, {
    sliceId: selectedSlice.id,
    runId,
    appName,
    projectRepoPath: paths.projectRepoPath,
    provider: branchProvider,
    branchName,
  });
  writeArtifact(projectId, 'SLICE_CONTEXT.md', handoff.sliceContextDocument);
  generatedArtifacts.push('SLICE_CONTEXT.md');

  try {
    const worker = runEngineeringWorker(paths.projectRepoPath, handoff, config, dryRun);
    generatedArtifacts.push(...worker.openspecFiles.map((file) => path.relative(process.cwd(), file)));
    writeArtifact(projectId, 'EngineeringVerifyOutput.md', worker.verifyOutput);
    generatedArtifacts.push('EngineeringVerifyOutput.md');
    writeArtifact(projectId, 'EngineeringTaskExecutionReport.md', worker.executionReport);
    generatedArtifacts.push('EngineeringTaskExecutionReport.md');

    const evidence = buildRunEvidence(projectId, worker.openspecFiles);
    const traceabilityArtifactFile = 'ExecutionTraceability.md';
    const traceabilityArtifactPath = path.join('.s2s', 'artifacts', projectId, traceabilityArtifactFile);
    resolvedWorktreePath = worker.worktreePath;
    markExecutionRunVerifying(projectId, runId, {
      branchName,
      worktreePath: worker.worktreePath,
      evidence,
      resultSummary: `Verification completed for slice '${selectedSlice.id}'.`,
    });

    const deliveryConfig: RuntimeConfig =
      dryRun || hasRemote
        ? config
        : {
            ...config,
            github: {
              ...config.github,
              autoPush: false,
              autoPR: false,
              autoMerge: false,
            },
          };

    const git = executeGitDelivery(worker.worktreePath, changeId, deliveryConfig, dryRun, {
      skipBranchCheckout: true,
      commitMessage: `feat(${changeId}): execute engineering slice`,
      prTitle: `Engineering execution ${changeId}`,
      branchProvider,
      prBody: [
        'Automated delivery from unified Agentic Product runtime.',
        '',
        `Project: ${projectId}`,
        `App: ${appName}`,
        `Change: ${changeId}`,
        '',
        'Includes OpenSpec change artifacts and validation output.',
      ].join('\n'),
    });

    completeExecutionRun(projectId, runId, worker.verifyPassed ? 'succeeded' : 'failed', {
      branchName: git.branch || branchName,
      worktreePath: worker.worktreePath,
      verificationPassed: worker.verifyPassed,
      evidence: [
        {
          kind: 'markdown',
          path: traceabilityArtifactPath,
          summary: 'End-to-end request-to-delivery traceability chain.',
        },
      ],
      resultSummary: worker.verifyPassed
        ? `Execution succeeded for slice '${selectedSlice.id}'.`
        : `Execution failed verification for slice '${selectedSlice.id}'.`,
      ...extractPullRequestMetadata(git),
      ...extractPullRequestSafetyDecision(git),
    });
    const traceability = buildExecutionTraceabilityRecord(projectId, runId);
    writeArtifact(projectId, traceabilityArtifactFile, renderExecutionTraceabilityDocument(traceability));
    generatedArtifacts.push(traceabilityArtifactFile);

    return {
      projectId,
      appName,
      changeId,
      sliceId: selectedSlice.id,
      runId,
      workspace: paths,
      generatedArtifacts,
      worktreePath: worker.worktreePath,
      verifyPassed: worker.verifyPassed,
      git,
      traceability,
      summary: dryRun
        ? [
            `Engineering execution prepared in dry-run for ${appName}.`,
            `sliceId=${selectedSlice.id}.`,
            `runId=${runId}.`,
            'traceability=ExecutionTraceability.md.',
          ]
            .filter(Boolean)
            .join(' ')
        : [
            `Engineering execution completed in ${worker.worktreePath}.`,
            `sliceId=${selectedSlice.id}.`,
            `runId=${runId}.`,
            `verifyPassed=${worker.verifyPassed}.`,
            `gitBranch=${git.branch}.`,
            'traceability=ExecutionTraceability.md.',
            git.policyNote ? `gitPolicy="${git.policyNote}"` : '',
            git.versionNote ? `version="${git.versionNote}"` : '',
            repoInitialized ? 'initializedLocalGit=true.' : '',
            !hasRemote ? 'remoteConfigured=false (local git mode).' : '',
          ]
            .filter(Boolean)
            .join(' '),
    };
  } catch (error) {
    try {
      completeExecutionRun(projectId, runId, 'failed', {
        branchName,
        worktreePath: resolvedWorktreePath,
        verificationPassed: false,
        resultSummary: formatExecutionError(error),
      });
    } catch {
      // Keep the original execution failure as the surfaced error.
    }

    throw error;
  }
}

function enforceStrictGuardrailPolicy(config: RuntimeConfig, appRoot: string): void {
  const policy = String(config.guardrailPolicy || 'strict').trim().toLowerCase();
  if (policy !== 'strict') return;
  const conflicts = detectGuardrailConflicts(appRoot);
  if (!hasBlockingGuardrailConflict(conflicts)) return;

  const summary = conflicts
    .slice(0, 5)
    .map((item) => `[${item.severity}] ${item.fileName}:${item.ruleId}`)
    .join(', ');
  throw new Error(
    `engineering_exec blocked by strict guardrail policy: ${conflicts.length} discrepancy(ies) detected (${summary}).`,
  );
}

function applyWorkspaceOverrides(config: RuntimeConfig, options: EngineeringExecOptions): RuntimeConfig {
  const appRepoPath = String(options.appRepoPath || '').trim();
  const worktreesRootPath = String(options.worktreesRootPath || '').trim();
  if (!appRepoPath && !worktreesRootPath) return config;
  return {
    ...config,
    workspace: {
      ...config.workspace,
      ...(appRepoPath ? { projectRepoPath: path.resolve(appRepoPath), projectDirName: path.basename(path.resolve(appRepoPath)) } : {}),
      ...(worktreesRootPath
        ? {
            worktreesRootPath: path.resolve(worktreesRootPath),
            worktreesDirName: path.basename(path.resolve(worktreesRootPath)),
          }
        : {}),
    },
  };
}

function sanitizeName(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'my-app';
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function buildRunEvidence(projectId: string, openspecFiles: string[]): WorkRunEvidence[] {
  const artifactRoot = path.join('.s2s', 'artifacts', projectId);
  return [
    { kind: 'log', path: path.join(artifactRoot, 'EngineeringExecutionTarget.txt'), summary: 'Target repository handoff.' },
    { kind: 'markdown', path: path.join(artifactRoot, 'SLICE_CONTEXT.md'), summary: 'Slice-scoped execution contract.' },
    { kind: 'markdown', path: path.join(artifactRoot, 'EngineeringVerifyOutput.md'), summary: 'Verification output.' },
    { kind: 'markdown', path: path.join(artifactRoot, 'EngineeringTaskExecutionReport.md'), summary: 'Task execution report.' },
    ...openspecFiles.map((file) => ({
      kind: inferArtifactKind(file),
      path: path.relative(process.cwd(), file),
      summary: 'Materialized OpenSpec execution artifact.',
    })),
  ];
}

function inferArtifactKind(filePath: string): WorkRunEvidence['kind'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md') return 'markdown';
  if (extension === '.json') return 'json';
  if (extension === '.log' || extension === '.txt') return 'log';
  return 'other';
}

function formatExecutionError(error: unknown): string {
  const message = String((error as Error)?.message || error || '').trim();
  return message ? `Execution failed: ${message}` : 'Execution failed before completion.';
}

function extractPullRequestSafetyDecision(
  git: GitOperationResult,
): { reusedPullRequest?: boolean; requiredFreshBranch?: boolean } {
  const updates: { reusedPullRequest?: boolean; requiredFreshBranch?: boolean } = {};
  if (git.reusedPullRequest !== undefined) {
    updates.reusedPullRequest = git.reusedPullRequest;
  }
  if (git.requiredFreshBranch !== undefined) {
    updates.requiredFreshBranch = git.requiredFreshBranch;
  }
  return updates;
}

function extractPullRequestMetadata(git: GitOperationResult): { pullRequestNumber?: number; pullRequestUrl?: string } {
  const updates: { pullRequestNumber?: number; pullRequestUrl?: string } = {};
  if (git.prNumber !== undefined) {
    updates.pullRequestNumber = git.prNumber;
  }
  if (git.prUrl) {
    updates.pullRequestUrl = git.prUrl;
  }
  return updates;
}

export function buildSliceContextDocument(projectId: string, options: SliceContextDocumentOptions): string {
  const sliceId = normalizeOptional(options.sliceId);
  if (!sliceId) {
    throw new Error('SLICE_CONTEXT.md generation requires a non-empty slice ID.');
  }

  const slice = requireSlice(projectId, sliceId);
  const change = requireChange(projectId, slice.changeId);
  const spec = requireSpec(projectId, slice.specId);
  const runId = normalizeOptional(options.runId);
  const run = runId ? requireRun(projectId, runId) : null;

  if (run && run.sliceId !== slice.id) {
    throw new Error(`Run '${run.id}' does not belong to slice '${slice.id}'.`);
  }

  const branchName = normalizeOptional(options.branchName) || run?.branchName;
  const provider = normalizeOptional(options.provider) || run?.provider;
  const generatedAt = normalizeOptional(options.generatedAt) || new Date().toISOString();
  const designContext = resolveDesignContextHandoff(spec);
  const exactTaskLines = [
    `Implement slice \`${slice.id}\` (${slice.title}) in sequence position ${slice.sequence}.`,
    slice.summary,
    ...describeTaskSubset(slice),
    `Current slice status: \`${slice.status}\`.`,
    ...(slice.dependencyIds.length > 0
      ? [`Complete only after dependencies are satisfied: ${slice.dependencyIds.map((dependencyId) => `\`${dependencyId}\``).join(', ')}.`]
      : ['This slice has no persisted slice dependencies.']),
  ];
  const technicalConstraints = [
    ...spec.constraints,
    ...(slice.implementationNotes || []),
    ...(slice.blockers.length > 0 ? slice.blockers.map((blocker) => `Active blocker: ${blocker}`) : []),
    ...(slice.relatedArtifacts.length > 0
      ? [`Relevant artifacts: ${slice.relatedArtifacts.map((artifact) => formatArtifactReference(artifact)).join('; ')}.`]
      : []),
  ];

  return [
    '# Slice Context',
    '',
    '## Execution Target',
    '',
    ...renderBulletList([
      `Project ID: \`${projectId}\``,
      `Change ID: \`${change.id}\``,
      `Spec ID: \`${spec.id}\``,
      `Slice ID: \`${slice.id}\``,
      ...(run ? [`Run ID: \`${run.id}\``, `Run status at handoff: \`${run.status}\``] : []),
      ...(provider ? [`Execution provider: \`${provider}\``] : []),
      ...(branchName ? [`Expected branch: \`${branchName}\``] : []),
      ...(options.appName ? [`App: \`${options.appName}\``] : []),
      ...(options.projectRepoPath ? [`Target repository: \`${options.projectRepoPath}\``] : []),
      `Generated at: \`${generatedAt}\``,
    ]),
    '',
    '## Exact Task',
    '',
    ...renderBulletList(exactTaskLines),
    '',
    '## Why This Slice Exists',
    '',
    ...renderBulletList([
      `${change.title}: ${change.summary}`,
      `${spec.title}: ${spec.summary}`,
      ...(slice.sourceTaskIds?.length
        ? [`This slice exists to implement backlog tasks ${slice.sourceTaskIds.map((taskId) => `\`${taskId}\``).join(', ')}.`]
        : []),
      ...(slice.acceptanceChecks.length > 0
        ? [`The slice is only complete when its persisted acceptance checks pass.`]
        : ['The slice still requires explicit validation before completion.']),
    ]),
    '',
    '## Acceptance Checks',
    '',
    ...renderBulletList(slice.acceptanceChecks, 'No slice-specific acceptance checks were persisted.'),
    '',
    '## Files Allowed To Change',
    '',
    ...renderBulletList(slice.allowedPaths, 'No explicit allowed-path restriction was persisted for this slice.'),
    '',
    '## Files Out Of Scope',
    '',
    ...renderBulletList(slice.outOfScopePaths, 'No explicit out-of-scope paths were persisted for this slice.'),
    '',
    '## Technical Constraints',
    '',
    ...renderBulletList(technicalConstraints, 'No additional technical constraints were persisted beyond the slice metadata.'),
    '',
    '## Relevant Spec Summary',
    '',
    ...renderBulletList(
      [
        spec.summary,
        ...spec.goals.map((goal) => `Goal: ${goal}`),
        ...spec.acceptanceCriteria.map((criterion) => `Spec acceptance: ${criterion}`),
      ],
      'No additional spec summary was persisted.',
    ),
    '',
    ...(designContext
      ? [
          '## Relevant Design Summary',
          '',
          ...renderBulletList([
            ...(designContext.summary ? [designContext.summary] : []),
            ...(designContext.designDefinition
              ? [`Primary design definition: ${formatArtifactReference(designContext.designDefinition)}`]
              : []),
            ...designContext.supportingArtifacts.map(
              (artifact) => `Supporting design artifact: ${formatArtifactReference(artifact)}`,
            ),
          ]),
          '',
        ]
      : []),
    '## Blocker Reporting',
    '',
    ...renderBulletList([
      'Stop if the required change extends beyond the allowed paths, violates the out-of-scope list, or depends on missing context.',
      'Record the blocker and the smallest unblock request in `EngineeringTaskExecutionReport.md` before exiting.',
      'Capture any failing verification command or missing dependency in `EngineeringVerifyOutput.md` instead of silently skipping it.',
    ]),
    '',
    '## Completion Instructions',
    '',
    ...renderBulletList([
      'Keep implementation tightly scoped to this slice and do not broaden the task beyond the persisted acceptance checks.',
      'Add or update tests that demonstrate the slice acceptance checks where the repository supports them.',
      'Run the relevant validation commands before handoff and record the result in `EngineeringVerifyOutput.md`.',
      'Summarize delivered changes, residual risks, and follow-up work in `EngineeringTaskExecutionReport.md`.',
    ]),
    '',
  ].join('\n');
}

export function buildEngineeringExecutionHandoff(
  projectId: string,
  options: SliceContextDocumentOptions,
): EngineeringExecutionHandoff {
  const sliceId = normalizeOptional(options.sliceId);
  if (!sliceId) {
    throw new Error('Engineering execution handoff requires a non-empty slice ID.');
  }

  const slice = requireSlice(projectId, sliceId);
  const change = requireChange(projectId, slice.changeId);
  const spec = requireSpec(projectId, slice.specId);
  const designContext = resolveDesignContextHandoff(spec);

  return {
    projectId,
    changeId: change.id,
    changeTitle: change.title,
    changeSummary: change.summary,
    specId: spec.id,
    specTitle: spec.title,
    specSummary: spec.summary,
    specGoals: [...spec.goals],
    specConstraints: [...spec.constraints],
    specAcceptanceCriteria: [...spec.acceptanceCriteria],
    sliceId: slice.id,
    sliceTitle: slice.title,
    sliceSummary: slice.summary,
    sliceSequence: slice.sequence,
    sliceStatus: slice.status,
    runId: normalizeOptional(options.runId),
    appName: normalizeOptional(options.appName),
    projectRepoPath: normalizeOptional(options.projectRepoPath),
    provider: normalizeOptional(options.provider),
    branchName: normalizeOptional(options.branchName),
    dependencyIds: [...slice.dependencyIds],
    blockers: [...slice.blockers],
    taskRefs: [...slice.taskRefs],
    sourceTaskIds: [...(slice.sourceTaskIds || [])],
    tasks: resolveExecutionTasks(slice),
    acceptanceChecks: [...slice.acceptanceChecks],
    allowedPaths: [...slice.allowedPaths],
    outOfScopePaths: [...slice.outOfScopePaths],
    implementationNotes: [...(slice.implementationNotes || [])],
    relatedArtifacts: [...slice.relatedArtifacts],
    designSummary: normalizeOptional(designContext?.summary),
    designDefinition: designContext?.designDefinition,
    supportingArtifacts: [...(designContext?.supportingArtifacts || [])],
    sliceContextDocument: buildSliceContextDocument(projectId, options),
  };
}

export function buildExecutionTraceabilityRecord(projectId: string, runId: string): ExecutionTraceabilityRecord {
  const run = requireRun(projectId, runId);
  const slice = requireSlice(projectId, run.sliceId);
  const spec = requireSpec(projectId, run.specId);
  const change = requireChange(projectId, run.changeId);

  const chain = [
    `Request (${change.request.source}) -> Change \`${change.id}\`: ${change.request.summary}`,
    `Change \`${change.id}\` (${change.status}) -> Spec \`${spec.id}\` v${spec.version} (${spec.status})`,
    `Spec \`${spec.id}\` -> Slice \`${slice.id}\` (#${slice.sequence}, ${slice.status})`,
    `Slice \`${slice.id}\` -> Run \`${run.id}\` (${run.status})`,
    `Run \`${run.id}\` -> Provider \`${run.provider}\`${run.branchName ? ` on branch \`${run.branchName}\`` : ''}`,
    run.worktreePath
      ? `Branch \`${run.branchName || 'unassigned'}\` -> Worktree \`${run.worktreePath}\``
      : 'Worktree path was not recorded for this run.',
    run.pullRequestNumber || run.pullRequestUrl
      ? `Branch \`${run.branchName || 'unassigned'}\` -> PR ${formatPullRequestReference(run.pullRequestNumber, run.pullRequestUrl)}`
      : 'No pull request was recorded for this run.',
  ];

  return {
    projectId,
    request: { ...change.request },
    change: {
      id: change.id,
      title: change.title,
      status: change.status,
      currentStage: change.currentStage,
    },
    spec: {
      id: spec.id,
      title: spec.title,
      status: spec.status,
      version: spec.version,
    },
    slice: {
      id: slice.id,
      title: slice.title,
      status: slice.status,
      sequence: slice.sequence,
    },
    run: {
      id: run.id,
      status: run.status,
      provider: run.provider,
      branchName: run.branchName,
      worktreePath: run.worktreePath,
      worktreeSessionId: run.worktreeSessionId,
      pullRequestNumber: run.pullRequestNumber,
      pullRequestUrl: run.pullRequestUrl,
      reusedPullRequest: run.reusedPullRequest,
      requiredFreshBranch: run.requiredFreshBranch,
      verificationPassed: run.verificationPassed,
      resultSummary: run.resultSummary,
      evidence: run.evidence.map((entry) => ({ ...entry })),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    chain,
  };
}

export function renderExecutionTraceabilityDocument(traceability: ExecutionTraceabilityRecord): string {
  const prReference = formatPullRequestReference(
    traceability.run.pullRequestNumber,
    traceability.run.pullRequestUrl,
  );
  return [
    '# Execution Traceability',
    '',
    '## Chain',
    '',
    ...renderBulletList(traceability.chain),
    '',
    '## Linked Records',
    '',
    ...renderBulletList([
      `Request source: \`${traceability.request.source}\``,
      `Change: \`${traceability.change.id}\` (${traceability.change.status})`,
      `Spec: \`${traceability.spec.id}\` v${traceability.spec.version} (${traceability.spec.status})`,
      `Slice: \`${traceability.slice.id}\` (#${traceability.slice.sequence}, ${traceability.slice.status})`,
      `Run: \`${traceability.run.id}\` (${traceability.run.status})`,
    ]),
    '',
    '## Delivery Surface',
    '',
    ...renderBulletList([
      `Provider: \`${traceability.run.provider}\``,
      traceability.run.branchName ? `Branch: \`${traceability.run.branchName}\`` : 'Branch: none recorded.',
      traceability.run.worktreePath ? `Worktree: \`${traceability.run.worktreePath}\`` : 'Worktree: none recorded.',
      traceability.run.worktreeSessionId
        ? `Worktree session: \`${traceability.run.worktreeSessionId}\``
        : 'Worktree session: none recorded.',
      traceability.run.pullRequestNumber || traceability.run.pullRequestUrl
        ? `Pull request: ${prReference}`
        : 'Pull request: none recorded.',
      traceability.run.reusedPullRequest !== undefined
        ? `Reused existing PR: \`${String(traceability.run.reusedPullRequest)}\``
        : 'Reused existing PR: not evaluated.',
      traceability.run.requiredFreshBranch !== undefined
        ? `Required fresh branch: \`${String(traceability.run.requiredFreshBranch)}\``
        : 'Required fresh branch: not evaluated.',
      traceability.run.verificationPassed !== undefined
        ? `Verification passed: \`${String(traceability.run.verificationPassed)}\``
        : 'Verification passed: not recorded.',
      traceability.run.resultSummary ? `Result summary: ${traceability.run.resultSummary}` : 'Result summary: none recorded.',
    ]),
    '',
    '## Evidence',
    '',
    ...renderBulletList(
      traceability.run.evidence.map((entry) => {
        const location = entry.path ? `path=\`${entry.path}\`` : entry.url ? `url=${entry.url}` : 'location=unrecorded';
        return `${entry.kind}: ${location}${entry.summary ? ` (${entry.summary})` : ''}`;
      }),
      'No run evidence was recorded.',
    ),
    '',
  ].join('\n');
}

function buildEngineeringSyncNote(projectRepoPath: string, changeId: string, appName: string): string {
  return [
    '# Engineering Execution Sync',
    '',
    `- App: ${appName}`,
    `- Change: ${changeId}`,
    `- Repo: ${projectRepoPath}`,
    `- Generated: ${new Date().toISOString()}`,
    '',
    'This file is generated by the engineering execution stage to keep cross-repo traceability.',
    '',
  ].join('\n');
}

function describeTaskSubset(slice: ReturnType<typeof requireSlice>): string[] {
  if (slice.taskSubset?.length) {
    return slice.taskSubset.map((task) => {
      const dependencies = task.dependencyIds.length
        ? ` Depends on ${task.dependencyIds.map((dependencyId) => `\`${dependencyId}\``).join(', ')}.`
        : '';
      return `Deliver task \`${task.taskId}\`: ${task.title}. ${task.summary}${dependencies}`.trim();
    });
  }

  if (slice.sourceTaskIds?.length) {
    return [`Persisted source tasks: ${slice.sourceTaskIds.map((taskId) => `\`${taskId}\``).join(', ')}.`];
  }

  if (slice.taskRefs.length) {
    return [`Task references: ${slice.taskRefs.map((taskId) => `\`${taskId}\``).join(', ')}.`];
  }

  return ['No explicit task subset was persisted for this slice.'];
}

function resolveExecutionTasks(slice: ReturnType<typeof requireSlice>): EngineeringExecutionHandoff['tasks'] {
  if (slice.taskSubset?.length) {
    return slice.taskSubset.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      summary: task.summary,
      dependencyIds: [...task.dependencyIds],
    }));
  }

  if (slice.sourceTaskIds?.length) {
    return slice.sourceTaskIds.map((taskId) => ({
      taskId,
      title: `Implement ${taskId}`,
      summary: slice.summary,
      dependencyIds: [],
    }));
  }

  if (slice.taskRefs.length) {
    return slice.taskRefs.map((taskId) => ({
      taskId,
      title: `Deliver ${taskId}`,
      summary: slice.summary,
      dependencyIds: [],
    }));
  }

  return [];
}

function formatArtifactReference(reference: WorkArtifactReference): string {
  const label = normalizeOptional(reference.label) || normalizeOptional(reference.path) || reference.kind;
  const details = [
    normalizeOptional(reference.path),
    normalizeOptional(reference.stage),
    normalizeOptional(reference.kind),
  ].filter(Boolean);
  return `\`${label}\`${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
}

function formatPullRequestReference(prNumber?: number, prUrl?: string): string {
  if (prNumber !== undefined && prUrl) {
    return `#${prNumber} (${prUrl})`;
  }
  if (prNumber !== undefined) {
    return `#${prNumber}`;
  }
  return prUrl || 'none';
}

function renderBulletList(values: readonly string[], emptyMessage = 'None.'): string[] {
  const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
  if (normalized.length === 0) {
    return [`- ${emptyMessage}`];
  }
  return normalized.map((value) => `- ${value}`);
}
