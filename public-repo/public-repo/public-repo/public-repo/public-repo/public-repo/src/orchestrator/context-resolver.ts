import { basename } from 'node:path';
import { resolveDesignContextHandoff } from '../agents/design.js';
import { artifactPath, listArtifactFiles } from '../artifacts/store.js';
import {
  deriveLedger,
  getActiveChange,
  getActiveSpec,
  listBlockedChanges,
  listOpenChanges,
  listOpenRuns,
  listOpenSlices,
  listOpenSpecs,
  listPendingGates,
} from '../ledger/index.js';
import type {
  ContextResolution,
  ContextResolutionFlags,
  PipelineStage,
  WorkArtifactKind,
  WorkArtifactReference,
  WorkIntent,
} from '../types/index.js';

const operationalArtifactPrefixes = ['changes/', 'specs/', 'slices/', 'runs/', 'gates/'] as const;

const artifactStageByFilename: Partial<Record<string, PipelineStage>> = {
  'PRD.md': 'pm',
  'Research.md': 'research',
  'PrototypeSpec.md': 'design',
  'FigmaLink.json': 'design',
  'TechSpec.md': 'engineering',
  'Backlog.md': 'engineering',
  'IterationLog.md': 'iterate',
};

function isOperationalArtifact(relativePath: string): boolean {
  return relativePath === 'ledger.json' || operationalArtifactPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function inferArtifactKind(relativePath: string): WorkArtifactKind {
  if (relativePath.endsWith('.md')) {
    return 'markdown';
  }

  if (relativePath.endsWith('.json')) {
    return 'json';
  }

  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return 'link';
  }

  return 'other';
}

function listStageArtifacts(projectId: string): WorkArtifactReference[] {
  return listArtifactFiles(projectId)
    .filter((relativePath) => !isOperationalArtifact(relativePath))
    .map((relativePath) => {
      const filename = basename(relativePath);
      return {
        path: artifactPath(projectId, relativePath),
        kind: inferArtifactKind(relativePath),
        label: relativePath,
        stage: artifactStageByFilename[filename],
      } satisfies WorkArtifactReference;
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function resolveCurrentDesignContext(
  activeSpec: ContextResolution['activeSpec'],
  openSpecs: ContextResolution['openSpecs'],
): ContextResolution['designContext'] {
  const currentSpecs = activeSpec ? [activeSpec] : [];

  for (const spec of openSpecs) {
    if (!currentSpecs.some((candidate) => candidate.id === spec.id)) {
      currentSpecs.push(spec);
    }
  }

  for (const spec of currentSpecs) {
    const designContext = resolveDesignContextHandoff(spec);
    if (designContext) {
      return designContext;
    }
  }

  return undefined;
}

function buildFlags(context: Omit<ContextResolution, 'flags' | 'rationale' | 'matchedSignals'>): ContextResolutionFlags {
  const hasExistingOperationalRecords =
    context.ledger.changeIds.length > 0 ||
    context.ledger.specIds.length > 0 ||
    context.ledger.sliceIds.length > 0 ||
    context.ledger.runIds.length > 0 ||
    context.ledger.gateIds.length > 0;

  return {
    hasExistingWork: hasExistingOperationalRecords || context.artifacts.length > 0,
    hasActiveWork:
      context.openChanges.length > 0 ||
      context.openSpecs.length > 0 ||
      context.openSlices.length > 0 ||
      context.openRuns.length > 0 ||
      context.pendingGates.length > 0,
    hasStageArtifacts: context.artifacts.length > 0,
    hasOpenChange: context.openChanges.length > 0,
    hasOpenSpec: context.openSpecs.length > 0,
    hasOpenSlice: context.openSlices.length > 0,
    hasOpenRun: context.openRuns.length > 0,
    hasPendingGate: context.pendingGates.length > 0,
    hasBlockedChange: context.blockedChanges.length > 0,
  };
}

function buildMatchedSignals(context: Omit<ContextResolution, 'flags' | 'rationale' | 'matchedSignals'>): string[] {
  const signals: string[] = [];

  if (context.intent) {
    signals.push(`intent:${context.intent}`);
  }
  if (context.activeChange) {
    signals.push(`active_change:${context.activeChange.id}`);
  }
  if (context.activeSpec) {
    signals.push(`active_spec:${context.activeSpec.id}`);
  }
  if (context.openChanges.length > 0) {
    signals.push(`open_changes:${context.openChanges.length}`);
  }
  if (context.openSpecs.length > 0) {
    signals.push(`open_specs:${context.openSpecs.length}`);
  }
  if (context.openSlices.length > 0) {
    signals.push(`open_slices:${context.openSlices.length}`);
  }
  if (context.openRuns.length > 0) {
    signals.push(`open_runs:${context.openRuns.length}`);
  }
  if (context.pendingGates.length > 0) {
    signals.push(`pending_gates:${context.pendingGates.length}`);
  }
  if (context.blockedChanges.length > 0) {
    signals.push(`blocked_changes:${context.blockedChanges.length}`);
  }
  if (context.artifacts.length > 0) {
    signals.push(`stage_artifacts:${context.artifacts.length}`);
  }

  return signals;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildRationale(
  context: Omit<ContextResolution, 'flags' | 'rationale' | 'matchedSignals'>,
  flags: ContextResolutionFlags,
): string {
  const parts: string[] = [];

  if (context.activeChange) {
    parts.push(`active change ${context.activeChange.id}`);
  }
  if (context.activeSpec) {
    parts.push(`active spec ${context.activeSpec.id}`);
  }
  if (context.openSlices.length > 0) {
    parts.push(formatCount(context.openSlices.length, 'open slice'));
  }
  if (context.openRuns.length > 0) {
    parts.push(formatCount(context.openRuns.length, 'open run'));
  }
  if (context.pendingGates.length > 0) {
    parts.push(formatCount(context.pendingGates.length, 'pending gate'));
  }
  if (context.artifacts.length > 0) {
    parts.push(formatCount(context.artifacts.length, 'stage artifact'));
  }

  if (parts.length === 0) {
    return flags.hasExistingWork
      ? 'Resolved project context from historical artifacts or operational records, but no active work is currently open.'
      : 'No existing project artifacts or operational work records were found.';
  }

  const prefix = context.intent ? `Resolved context for ${context.intent}: ` : 'Resolved context: ';
  return `${prefix}${parts.join('; ')}.`;
}

export function resolveContext(projectId: string, intent?: WorkIntent): ContextResolution {
  const ledger = deriveLedger(projectId);
  const activeChange = getActiveChange(projectId);
  const activeSpec = getActiveSpec(projectId);
  const openChanges = listOpenChanges(projectId);
  const openSpecs = listOpenSpecs(projectId);
  const openSlices = listOpenSlices(projectId);
  const openRuns = listOpenRuns(projectId);
  const pendingGates = listPendingGates(projectId);
  const blockedChanges = listBlockedChanges(projectId);
  const artifacts = listStageArtifacts(projectId);
  const designContext = resolveCurrentDesignContext(activeSpec, openSpecs);

  const contextWithoutDerived = {
    projectId,
    intent,
    ledger,
    activeChange,
    activeSpec,
    designContext,
    openChanges,
    openSpecs,
    openSlices,
    openRuns,
    pendingGates,
    blockedChanges,
    artifacts,
  };

  const flags = buildFlags(contextWithoutDerived);
  const matchedSignals = buildMatchedSignals(contextWithoutDerived);

  return {
    ...contextWithoutDerived,
    flags,
    rationale: buildRationale(contextWithoutDerived, flags),
    matchedSignals,
  };
}
