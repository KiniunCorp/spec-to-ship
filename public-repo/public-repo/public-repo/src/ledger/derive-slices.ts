import type {
  SliceDerivationBacklogItem,
  SliceDerivationBacklogColumn,
  SliceDerivationDraft,
  SliceDerivationInput,
  PersistSlicePlanOptions,
  PersistSlicePlanResult,
  SliceDerivationPlan,
  SliceDerivationPlanSlice,
  SliceDerivationTaskSubsetItem,
  SliceDerivationTechSpecHeading,
  SliceDerivationTechSpecSections,
  WorkPriority,
  WorkArtifactReference,
  WorkChange,
  WorkLedger,
  WorkSlice,
  WorkSliceSize,
  WorkSliceStatus,
  WorkSpec,
} from '../types/index.js';
import {
  SLICE_DERIVATION_CONTRACT_VERSION,
  SliceDerivationBacklogColumns,
  SliceDerivationTechSpecHeadings,
} from '../types/index.js';
import { createSlice, listSlices, updateSlice } from './slice-store.js';
import { refreshLedger } from './status.js';

export interface SliceDerivationInputParams {
  projectId: string;
  change: WorkChange;
  spec: WorkSpec;
  techSpec: SliceDerivationTechSpecSections;
  backlog: SliceDerivationBacklogItem[];
  supportingArtifacts?: WorkArtifactReference[];
}

export interface SliceDerivationPlanParams {
  projectId: string;
  changeId: string;
  specId: string;
  generatedAt?: string;
  slices: SliceDerivationPlanSlice[];
  warnings?: string[];
}

export interface ParseSliceDerivationInputParams {
  projectId: string;
  change: WorkChange;
  spec: WorkSpec;
  techSpecContent: string;
  backlogContent: string;
  supportingArtifacts?: WorkArtifactReference[];
}

const TECH_SPEC_HEADING_TO_KEY: Record<SliceDerivationTechSpecHeading, keyof SliceDerivationTechSpecSections> = {
  'Architecture Overview': 'architectureOverview',
  'Data Model': 'dataModel',
  'API / Integration points': 'apiIntegrationPoints',
  'Risk & Security Notes': 'riskSecurityNotes',
  'Implementation Plan': 'implementationPlan',
  'Test Plan': 'testPlan',
};

const VALID_WORK_PRIORITIES = new Set<WorkPriority>(['low', 'medium', 'high', 'critical']);
const WORK_PRIORITY_WEIGHT: Record<WorkPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const WORK_SLICE_SIZE_WEIGHT: Record<WorkSliceSize, number> = {
  xs: 0,
  s: 1,
  m: 2,
  l: 3,
};
const TERMINAL_SLICE_STATUSES = new Set<WorkSliceStatus>(['in_progress', 'done', 'cancelled']);

function isSliceDerivationHeading(value: string): value is SliceDerivationTechSpecHeading {
  return SliceDerivationTechSpecHeadings.includes(value as SliceDerivationTechSpecHeading);
}

function normalizeText(value: string): string {
  return String(value || '').trim();
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function compareArtifactReference(left: WorkArtifactReference, right: WorkArtifactReference): number {
  return (
    left.path.localeCompare(right.path) ||
    left.kind.localeCompare(right.kind) ||
    String(left.stage || '').localeCompare(String(right.stage || '')) ||
    String(left.label || '').localeCompare(String(right.label || ''))
  );
}

function normalizeArtifactReference(reference: WorkArtifactReference): WorkArtifactReference {
  return {
    path: normalizeText(reference.path),
    kind: reference.kind,
    ...(reference.label ? { label: normalizeText(reference.label) } : {}),
    ...(reference.stage ? { stage: reference.stage } : {}),
  };
}

function dedupeArtifactReferences(references: readonly WorkArtifactReference[]): WorkArtifactReference[] {
  const keyed = new Map<string, WorkArtifactReference>();

  for (const reference of references) {
    const normalized = normalizeArtifactReference(reference);
    if (!normalized.path) {
      continue;
    }

    const key = `${normalized.path}::${normalized.kind}::${normalized.stage || ''}::${normalized.label || ''}`;
    if (!keyed.has(key)) {
      keyed.set(key, normalized);
    }
  }

  return [...keyed.values()].sort(compareArtifactReference);
}

function normalizeBacklogItem(item: SliceDerivationBacklogItem): SliceDerivationBacklogItem {
  return {
    id: normalizeText(item.id),
    title: normalizeText(item.title),
    description: normalizeText(item.description),
    priority: item.priority,
    estimate: normalizeText(item.estimate),
    dependencyIds: uniqueInOrder(item.dependencyIds),
    acceptanceCriteria: uniqueInOrder(item.acceptanceCriteria),
    allowedPaths: uniqueInOrder(item.allowedPaths),
    outOfScopePaths: uniqueInOrder(item.outOfScopePaths),
  };
}

function normalizeTechSpecSections(sections: SliceDerivationTechSpecSections): SliceDerivationTechSpecSections {
  return {
    architectureOverview: normalizeText(sections.architectureOverview),
    dataModel: normalizeText(sections.dataModel),
    apiIntegrationPoints: normalizeText(sections.apiIntegrationPoints),
    riskSecurityNotes: normalizeText(sections.riskSecurityNotes),
    implementationPlan: normalizeText(sections.implementationPlan),
    testPlan: normalizeText(sections.testPlan),
  };
}

function normalizeSliceDraft(draft: SliceDerivationDraft): SliceDerivationDraft {
  return {
    sliceKey: normalizeText(draft.sliceKey),
    title: normalizeText(draft.title),
    summary: normalizeText(draft.summary),
    sourceTaskIds: uniqueInOrder(draft.sourceTaskIds),
    taskSubset: normalizeTaskSubsetItems(draft.taskSubset),
    acceptanceChecks: uniqueInOrder(draft.acceptanceChecks),
    allowedPaths: uniqueInOrder(draft.allowedPaths),
    outOfScopePaths: uniqueInOrder(draft.outOfScopePaths),
    relatedArtifacts: dedupeArtifactReferences(draft.relatedArtifacts),
    implementationNotes: uniqueInOrder(draft.implementationNotes),
    priority: draft.priority,
    size: draft.size,
  };
}

function normalizeWorkSlice(slice: WorkSlice): WorkSlice {
  return {
    ...slice,
    ...(slice.sliceKey ? { sliceKey: normalizeText(slice.sliceKey) } : {}),
    dependencyIds: uniqueInOrder(slice.dependencyIds),
    blockers: uniqueInOrder(slice.blockers),
    taskRefs: uniqueInOrder(slice.taskRefs),
    ...(slice.sourceTaskIds ? { sourceTaskIds: uniqueInOrder(slice.sourceTaskIds) } : {}),
    ...(slice.taskSubset ? { taskSubset: normalizeTaskSubsetItems(slice.taskSubset) } : {}),
    acceptanceChecks: uniqueInOrder(slice.acceptanceChecks),
    allowedPaths: uniqueInOrder(slice.allowedPaths),
    outOfScopePaths: uniqueInOrder(slice.outOfScopePaths),
    relatedArtifacts: dedupeArtifactReferences(slice.relatedArtifacts),
    ...(slice.implementationNotes ? { implementationNotes: uniqueInOrder(slice.implementationNotes) } : {}),
  };
}

function normalizePlanSlice(slice: SliceDerivationPlanSlice): SliceDerivationPlanSlice {
  return {
    ...normalizeSliceDraft(slice),
    sequence: slice.sequence,
    dependencyKeys: uniqueInOrder(slice.dependencyKeys),
    blockers: uniqueInOrder(slice.blockers),
  };
}

function normalizeTaskSubsetItem(task: SliceDerivationTaskSubsetItem): SliceDerivationTaskSubsetItem {
  return {
    taskId: normalizeText(task.taskId),
    title: normalizeText(task.title),
    summary: normalizeText(task.summary),
    dependencyIds: uniqueInOrder(task.dependencyIds),
  };
}

function normalizeTaskSubsetItems(tasks: readonly SliceDerivationTaskSubsetItem[]): SliceDerivationTaskSubsetItem[] {
  const keyed = new Map<string, SliceDerivationTaskSubsetItem>();

  for (const task of tasks || []) {
    const normalized = normalizeTaskSubsetItem(task);
    if (!normalized.taskId || keyed.has(normalized.taskId)) {
      continue;
    }
    keyed.set(normalized.taskId, normalized);
  }

  return [...keyed.values()];
}

function splitCellList(value: string, delimiter: ',' | ';'): string[] {
  const normalized = normalizeText(value);
  if (!normalized || normalized.toLowerCase() === 'none') {
    return [];
  }

  return uniqueInOrder(
    normalized
      .split(delimiter)
      .map((entry) => normalizeText(entry))
      .filter((entry) => entry.length > 0),
  );
}

function parsePriority(value: string, rowNumber: number): SliceDerivationBacklogItem['priority'] {
  const normalized = normalizeText(value).toLowerCase();
  if (!VALID_WORK_PRIORITIES.has(normalized as SliceDerivationBacklogItem['priority'])) {
    throw new Error(
      `Backlog.md row ${rowNumber} has unsupported priority '${value}'. Use one of: low, medium, high, critical.`,
    );
  }

  return normalized as SliceDerivationBacklogItem['priority'];
}

function normalizeComparableText(value: string): string {
  return normalizeText(value).toLowerCase();
}

function isNonDirectiveSection(value: string): boolean {
  const normalized = normalizeComparableText(value);
  return Boolean(normalized) && !['none', 'n/a', 'na', 'not applicable'].includes(normalized);
}

function normalizeIdentifierSegment(value: string): string {
  return normalizeComparableText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseEstimatedEffortDays(estimate: string): number | null {
  const normalized = normalizeComparableText(estimate);
  if (!normalized) {
    return null;
  }

  const sizedMatch = normalized.match(/^(xs|s|m|l)$/);
  if (sizedMatch) {
    return {
      xs: 0.5,
      s: 1,
      m: 3,
      l: 5,
    }[sizedMatch[1]]!;
  }

  const unitMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|pt|pts|point|points)?$/);
  if (!unitMatch) {
    return null;
  }

  const amount = Number(unitMatch[1]);
  const unit = unitMatch[2] || 'd';
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  switch (unit) {
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hour':
    case 'hours':
      return amount / 8;
    case 'd':
    case 'day':
    case 'days':
      return amount;
    case 'w':
    case 'wk':
    case 'wks':
    case 'week':
    case 'weeks':
      return amount * 5;
    case 'pt':
    case 'pts':
    case 'point':
    case 'points':
      return amount <= 1 ? 0.5 : amount <= 3 ? 1 : amount <= 5 ? 3 : 5;
    default:
      return null;
  }
}

function deriveSliceSizeFromEstimate(estimate: string): WorkSliceSize {
  const effortDays = parseEstimatedEffortDays(estimate);
  if (effortDays === null) {
    return 'm';
  }

  if (effortDays <= 0.5) {
    return 'xs';
  }

  if (effortDays <= 1.5) {
    return 's';
  }

  if (effortDays <= 3) {
    return 'm';
  }

  return 'l';
}

function createSliceDerivationPlanningArtifacts(): WorkArtifactReference[] {
  return [
    { path: 'TechSpec.md', kind: 'markdown', stage: 'engineering' },
    { path: 'Backlog.md', kind: 'markdown', stage: 'engineering' },
  ];
}

function buildSliceImplementationNotes(
  input: SliceDerivationInput,
  backlogItem: SliceDerivationBacklogItem,
): string[] {
  const notes = [
    `Backlog task ${backlogItem.id} (${backlogItem.priority} priority, estimate ${backlogItem.estimate || 'unestimated'}).`,
  ];

  if (isNonDirectiveSection(input.techSpec.architectureOverview)) {
    notes.push(`Architecture context: ${input.techSpec.architectureOverview}`);
  }
  if (isNonDirectiveSection(input.techSpec.dataModel)) {
    notes.push(`Data model context: ${input.techSpec.dataModel}`);
  }
  if (isNonDirectiveSection(input.techSpec.apiIntegrationPoints)) {
    notes.push(`Integration context: ${input.techSpec.apiIntegrationPoints}`);
  }
  if (isNonDirectiveSection(input.techSpec.riskSecurityNotes)) {
    notes.push(`Risk and security context: ${input.techSpec.riskSecurityNotes}`);
  }
  if (isNonDirectiveSection(input.techSpec.implementationPlan)) {
    notes.push(`Implementation plan reference: ${input.techSpec.implementationPlan}`);
  }
  if (isNonDirectiveSection(input.techSpec.testPlan)) {
    notes.push(`Test plan reference: ${input.techSpec.testPlan}`);
  }

  return notes;
}

function buildTaskSubsetItem(backlogItem: SliceDerivationBacklogItem): SliceDerivationTaskSubsetItem {
  return {
    taskId: backlogItem.id,
    title: backlogItem.title || backlogItem.id,
    summary: backlogItem.description || backlogItem.title || backlogItem.id,
    dependencyIds: backlogItem.dependencyIds,
  };
}

function compareSlicePlanningOrder(
  left: { priority: WorkPriority; size: WorkSliceSize; originalIndex: number; sliceKey: string },
  right: { priority: WorkPriority; size: WorkSliceSize; originalIndex: number; sliceKey: string },
): number {
  return (
    WORK_PRIORITY_WEIGHT[left.priority] - WORK_PRIORITY_WEIGHT[right.priority] ||
    WORK_SLICE_SIZE_WEIGHT[left.size] - WORK_SLICE_SIZE_WEIGHT[right.size] ||
    left.originalIndex - right.originalIndex ||
    left.sliceKey.localeCompare(right.sliceKey)
  );
}

function formatMissingDependencyBlocker(taskId: string): string {
  return `Missing backlog dependency '${taskId}'.`;
}

function formatCycleDependencyBlocker(sliceKey: string): string {
  return `Circular slice dependency detected for '${sliceKey}'.`;
}

function resolvePersistedAt(value?: string): string {
  return normalizeText(value || '') || new Date().toISOString();
}

function resolveDerivedSliceStatus(slice: { dependencyIds: readonly string[]; blockers: readonly string[] }): WorkSliceStatus {
  if (slice.blockers.length > 0) {
    return 'blocked';
  }

  if (slice.dependencyIds.length > 0) {
    return 'queued';
  }

  return 'ready';
}

export function derivePersistedSliceId(specId: string, sliceKey: string): string {
  const normalizedSpecId = normalizeIdentifierSegment(normalizeText(specId));
  const normalizedSliceKey = normalizeIdentifierSegment(normalizeText(sliceKey).replace(/^slice-/, ''));

  if (!normalizedSpecId) {
    throw new Error('Persisted slice IDs require a non-empty spec ID.');
  }

  if (!normalizedSliceKey) {
    throw new Error(`Persisted slice IDs require a non-empty slice key. Received '${sliceKey}'.`);
  }

  return `slice-${normalizedSpecId}-${normalizedSliceKey}`;
}

function buildSliceIdsByKey(plan: SliceDerivationPlan): Record<string, string> {
  const sliceIdsByKey: Record<string, string> = {};

  for (const slice of plan.slices) {
    if (sliceIdsByKey[slice.sliceKey]) {
      throw new Error(`Slice persistence received duplicate slice key '${slice.sliceKey}'.`);
    }

    sliceIdsByKey[slice.sliceKey] = derivePersistedSliceId(plan.specId, slice.sliceKey);
  }

  return sliceIdsByKey;
}

function mapDependencyKeysToIds(
  slice: SliceDerivationPlanSlice,
  sliceIdsByKey: Record<string, string>,
): string[] {
  return uniqueInOrder(
    slice.dependencyKeys.map((dependencyKey) => {
      const dependencyId = sliceIdsByKey[dependencyKey];
      if (!dependencyId) {
        throw new Error(
          `Slice '${slice.sliceKey}' references unknown dependency key '${dependencyKey}' during persistence.`,
        );
      }

      return dependencyId;
    }),
  );
}

function assertUniqueBacklogIds(backlog: readonly SliceDerivationBacklogItem[]): void {
  const seenBacklogIds = new Set<string>();
  const seenSliceKeys = new Map<string, string>();

  for (const item of backlog) {
    const backlogId = normalizeText(item.id);
    if (!backlogId) {
      throw new Error('Slice derivation backlog items require a non-empty ID.');
    }
    if (seenBacklogIds.has(backlogId)) {
      throw new Error(`Slice derivation requires unique backlog IDs. Found duplicate '${backlogId}'.`);
    }
    seenBacklogIds.add(backlogId);

    const sliceKey = deriveSliceKeyFromTaskId(backlogId);
    const existingBacklogId = seenSliceKeys.get(sliceKey);
    if (existingBacklogId && existingBacklogId !== backlogId) {
      throw new Error(
        `Slice derivation generated duplicate slice key '${sliceKey}' from backlog IDs '${existingBacklogId}' and '${backlogId}'.`,
      );
    }

    seenSliceKeys.set(sliceKey, backlogId);
  }
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = normalizeText(line);
  const withoutLeading = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const withoutTrailing = withoutLeading.endsWith('|') ? withoutLeading.slice(0, -1) : withoutLeading;
  return withoutTrailing.split('|').map((cell) => normalizeText(cell));
}

function isMarkdownDividerRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parseSliceDerivationTechSpecSections(markdown: string): SliceDerivationTechSpecSections {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = new Map<keyof SliceDerivationTechSpecSections, string[]>();
  let currentKey: keyof SliceDerivationTechSpecSections | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      const heading = normalizeText(headingMatch[1]);
      if (!isSliceDerivationHeading(heading)) {
        currentKey = null;
        continue;
      }
      const sectionKey = TECH_SPEC_HEADING_TO_KEY[heading];

      if (sections.has(sectionKey)) {
        throw new Error(`TechSpec.md contains duplicate heading '## ${heading}'.`);
      }

      currentKey = sectionKey;
      sections.set(sectionKey, []);
      continue;
    }

    if (currentKey) {
      sections.get(currentKey)?.push(line);
    }
  }

  const result: SliceDerivationTechSpecSections = {
    architectureOverview: '',
    dataModel: '',
    apiIntegrationPoints: '',
    riskSecurityNotes: '',
    implementationPlan: '',
    testPlan: '',
  };

  for (const heading of SliceDerivationTechSpecHeadings) {
    const sectionKey = TECH_SPEC_HEADING_TO_KEY[heading];
    const sectionLines = sections.get(sectionKey);
    if (!sectionLines) {
      throw new Error(`TechSpec.md is missing required heading '## ${heading}'.`);
    }

    result[sectionKey] = normalizeText(sectionLines.join('\n'));
  }

  return result;
}

export function parseSliceDerivationBacklog(markdown: string): SliceDerivationBacklogItem[] {
  const lines = String(markdown || '').split(/\r?\n/);
  const expectedHeader: readonly SliceDerivationBacklogColumn[] = SliceDerivationBacklogColumns;
  const headerLineIndex = lines.findIndex((line) => normalizeText(line).startsWith('|'));

  if (headerLineIndex === -1) {
    throw new Error('Backlog.md must include a markdown table with the required derivation columns.');
  }

  const headerCells = splitMarkdownTableRow(lines[headerLineIndex]);
  if (headerCells.join('|') !== expectedHeader.join('|')) {
    throw new Error(`Backlog.md table header must be: | ${expectedHeader.join(' | ')} |`);
  }

  const dividerLine = lines[headerLineIndex + 1];
  if (!dividerLine || !isMarkdownDividerRow(splitMarkdownTableRow(dividerLine))) {
    throw new Error('Backlog.md table must include a markdown divider row immediately after the header.');
  }

  const backlog: SliceDerivationBacklogItem[] = [];

  for (let index = headerLineIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = normalizeText(line);
    if (!trimmed) {
      if (backlog.length > 0) {
        break;
      }
      continue;
    }

    if (!trimmed.startsWith('|')) {
      if (backlog.length > 0) {
        break;
      }
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length !== expectedHeader.length) {
      throw new Error(`Backlog.md row ${index + 1} must contain ${expectedHeader.length} columns.`);
    }

    const [id, priority, title, description, estimate, dependencies, acceptanceCriteria, allowedPaths, outOfScopePaths] =
      cells;

    backlog.push({
      id: normalizeText(id),
      title: normalizeText(title),
      description: normalizeText(description),
      priority: parsePriority(priority, index + 1),
      estimate: normalizeText(estimate),
      dependencyIds: splitCellList(dependencies, ','),
      acceptanceCriteria: splitCellList(acceptanceCriteria, ';'),
      allowedPaths: splitCellList(allowedPaths, ','),
      outOfScopePaths: splitCellList(outOfScopePaths, ','),
    });
  }

  if (backlog.length === 0) {
    throw new Error('Backlog.md table must include at least one backlog row.');
  }

  return backlog;
}

export function collectSupportingArtifactsForSliceDerivation(spec: WorkSpec): WorkArtifactReference[] {
  const supportingArtifacts: WorkArtifactReference[] = [...spec.sourceArtifacts];

  if (spec.designDefinition) {
    supportingArtifacts.push(spec.designDefinition);
  }

  return dedupeArtifactReferences(supportingArtifacts);
}

export function createSliceDerivationInput(params: SliceDerivationInputParams): SliceDerivationInput {
  const projectId = normalizeText(params.projectId);

  if (!projectId) {
    throw new Error('Slice derivation input requires a projectId.');
  }

  if (params.change.projectId !== projectId) {
    throw new Error(
      `Slice derivation change '${params.change.id}' belongs to project '${params.change.projectId}', not '${projectId}'.`,
    );
  }

  if (params.spec.projectId !== projectId) {
    throw new Error(
      `Slice derivation spec '${params.spec.id}' belongs to project '${params.spec.projectId}', not '${projectId}'.`,
    );
  }

  if (params.spec.changeId !== params.change.id) {
    throw new Error(
      `Slice derivation spec '${params.spec.id}' is linked to change '${params.spec.changeId}', not '${params.change.id}'.`,
    );
  }

  return {
    schemaVersion: SLICE_DERIVATION_CONTRACT_VERSION,
    projectId,
    change: params.change,
    spec: params.spec,
    techSpecPath: 'TechSpec.md',
    backlogPath: 'Backlog.md',
    supportingArtifacts: dedupeArtifactReferences(
      params.supportingArtifacts ? params.supportingArtifacts : collectSupportingArtifactsForSliceDerivation(params.spec),
    ),
    techSpec: normalizeTechSpecSections(params.techSpec),
    backlog: params.backlog.map(normalizeBacklogItem),
  };
}

export function parseSliceDerivationInput(params: ParseSliceDerivationInputParams): SliceDerivationInput {
  return createSliceDerivationInput({
    projectId: params.projectId,
    change: params.change,
    spec: params.spec,
    supportingArtifacts: params.supportingArtifacts,
    techSpec: parseSliceDerivationTechSpecSections(params.techSpecContent),
    backlog: parseSliceDerivationBacklog(params.backlogContent),
  });
}

export function deriveSliceKeyFromTaskId(taskId: string): string {
  const normalizedTaskId = normalizeText(taskId);
  if (!normalizedTaskId) {
    throw new Error('Slice derivation requires a non-empty backlog task ID to build a slice key.');
  }

  const normalizedSegment = normalizeIdentifierSegment(normalizedTaskId);
  if (!normalizedSegment) {
    throw new Error(`Slice derivation could not build a stable slice key from backlog ID '${taskId}'.`);
  }

  return `slice-${normalizedSegment}`;
}

export function deriveSliceDrafts(input: SliceDerivationInput): SliceDerivationDraft[] {
  if (input.schemaVersion !== SLICE_DERIVATION_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported slice derivation schema version '${input.schemaVersion}'. Expected ${SLICE_DERIVATION_CONTRACT_VERSION}.`,
    );
  }

  assertUniqueBacklogIds(input.backlog);

  const relatedArtifacts = dedupeArtifactReferences([
    ...createSliceDerivationPlanningArtifacts(),
    ...input.supportingArtifacts,
  ]);

  return input.backlog.map((backlogItem) =>
    normalizeSliceDraft({
      sliceKey: deriveSliceKeyFromTaskId(backlogItem.id),
      title: backlogItem.title || backlogItem.id,
      summary: backlogItem.description || backlogItem.title || backlogItem.id,
      sourceTaskIds: [backlogItem.id],
      taskSubset: [buildTaskSubsetItem(backlogItem)],
      acceptanceChecks: backlogItem.acceptanceCriteria.length
        ? backlogItem.acceptanceCriteria
        : input.spec.acceptanceCriteria,
      allowedPaths: backlogItem.allowedPaths.length ? backlogItem.allowedPaths : input.change.scope.inScope,
      outOfScopePaths: backlogItem.outOfScopePaths.length ? backlogItem.outOfScopePaths : input.change.scope.outOfScope,
      relatedArtifacts,
      implementationNotes: buildSliceImplementationNotes(input, backlogItem),
      priority: backlogItem.priority,
      size: deriveSliceSizeFromEstimate(backlogItem.estimate),
    }),
  );
}

export function deriveSlicePlan(input: SliceDerivationInput): SliceDerivationPlan {
  const drafts = deriveSliceDrafts(input);
  const backlogById = new Map(input.backlog.map((item) => [item.id, item] as const));
  const taskIdToSliceKey = new Map<string, string>();
  const warnings: string[] = [];

  for (const draft of drafts) {
    for (const taskId of draft.sourceTaskIds) {
      taskIdToSliceKey.set(taskId, draft.sliceKey);
    }
  }

  const slices = drafts.map((draft, index) => {
    const ownedTaskIds = new Set(draft.sourceTaskIds);
    const dependencyKeys: string[] = [];
    const blockers: string[] = [];

    for (const task of draft.taskSubset) {
      const backlogItem = backlogById.get(task.taskId);
      const dependencyIds = backlogItem ? backlogItem.dependencyIds : task.dependencyIds;

      for (const dependencyId of dependencyIds) {
        if (ownedTaskIds.has(dependencyId)) {
          continue;
        }

        const dependencyKey = taskIdToSliceKey.get(dependencyId);
        if (!dependencyKey) {
          blockers.push(formatMissingDependencyBlocker(dependencyId));
          warnings.push(
            `Slice '${draft.sliceKey}' references missing backlog dependency '${dependencyId}' from task '${task.taskId}'.`,
          );
          continue;
        }

        if (dependencyKey !== draft.sliceKey) {
          dependencyKeys.push(dependencyKey);
        }
      }
    }

    return {
      ...draft,
      sequence: 0,
      dependencyKeys: uniqueInOrder(dependencyKeys),
      blockers: uniqueInOrder(blockers),
      originalIndex: index,
    };
  });

  const sliceMap = new Map(slices.map((slice) => [slice.sliceKey, slice] as const));
  const remaining = new Set(slices.map((slice) => slice.sliceKey));
  const dependentsByKey = new Map<string, string[]>();
  const indegreeByKey = new Map<string, number>();

  for (const slice of slices) {
    indegreeByKey.set(slice.sliceKey, slice.dependencyKeys.length);

    for (const dependencyKey of slice.dependencyKeys) {
      const dependents = dependentsByKey.get(dependencyKey) || [];
      dependents.push(slice.sliceKey);
      dependentsByKey.set(dependencyKey, dependents);
    }
  }

  let sequence = 1;

  while (remaining.size > 0) {
    const nextReady = [...remaining]
      .map((sliceKey) => sliceMap.get(sliceKey)!)
      .filter((slice) => (indegreeByKey.get(slice.sliceKey) || 0) === 0)
      .sort(compareSlicePlanningOrder)[0];

    if (!nextReady) {
      break;
    }

    nextReady.sequence = sequence;
    sequence += 1;
    remaining.delete(nextReady.sliceKey);

    for (const dependentKey of dependentsByKey.get(nextReady.sliceKey) || []) {
      indegreeByKey.set(dependentKey, Math.max(0, (indegreeByKey.get(dependentKey) || 0) - 1));
    }
  }

  if (remaining.size > 0) {
    const cycleKeys = [...remaining].sort((left, right) => {
      const leftSlice = sliceMap.get(left)!;
      const rightSlice = sliceMap.get(right)!;
      return compareSlicePlanningOrder(leftSlice, rightSlice);
    });
    warnings.push(`Circular slice dependency detected across: ${cycleKeys.join(', ')}.`);

    for (const sliceKey of cycleKeys) {
      const slice = sliceMap.get(sliceKey)!;
      slice.blockers = uniqueInOrder([...slice.blockers, formatCycleDependencyBlocker(sliceKey)]);
      slice.sequence = sequence;
      sequence += 1;
      remaining.delete(sliceKey);
    }
  }

  return createSliceDerivationPlan({
    projectId: input.projectId,
    changeId: input.change.id,
    specId: input.spec.id,
    slices: slices.map(({ originalIndex: _originalIndex, ...slice }) => slice),
    warnings,
  });
}

export function createSliceDerivationPlan(params: SliceDerivationPlanParams): SliceDerivationPlan {
  const projectId = normalizeText(params.projectId);
  const changeId = normalizeText(params.changeId);
  const specId = normalizeText(params.specId);

  if (!projectId || !changeId || !specId) {
    throw new Error('Slice derivation plan requires non-empty projectId, changeId, and specId.');
  }

  return {
    schemaVersion: SLICE_DERIVATION_CONTRACT_VERSION,
    projectId,
    changeId,
    specId,
    ...(params.generatedAt ? { generatedAt: normalizeText(params.generatedAt) } : {}),
    slices: [...params.slices]
      .map(normalizePlanSlice)
      .sort((left, right) => left.sequence - right.sequence || left.sliceKey.localeCompare(right.sliceKey)),
    warnings: uniqueInOrder(params.warnings || []),
  };
}

export function persistSlicePlan(
  plan: SliceDerivationPlan,
  options: PersistSlicePlanOptions = {},
): PersistSlicePlanResult {
  if (plan.schemaVersion !== SLICE_DERIVATION_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported slice derivation schema version '${plan.schemaVersion}'. Expected ${SLICE_DERIVATION_CONTRACT_VERSION}.`,
    );
  }

  const persistedAt = resolvePersistedAt(options.persistedAt);
  const sliceIdsByKey = buildSliceIdsByKey(plan);
  const plannedSliceIds = new Set(Object.values(sliceIdsByKey));
  const existingSlices = listSlices(plan.projectId).filter((slice) => slice.changeId === plan.changeId && slice.specId === plan.specId);
  const existingById = new Map(existingSlices.map((slice) => [slice.id, slice] as const));
  const createdSliceIds: string[] = [];
  const updatedSliceIds: string[] = [];
  const cancelledSliceIds: string[] = [];
  const persistedSlices: WorkSlice[] = [];

  for (const existing of existingSlices) {
    if (plannedSliceIds.has(existing.id)) {
      continue;
    }

    if (existing.status === 'in_progress') {
      throw new Error(
        `Cannot remove in-progress slice '${existing.id}' while persisting a regenerated slice plan for spec '${plan.specId}'.`,
      );
    }

    if (existing.status === 'done' || existing.status === 'cancelled') {
      continue;
    }

    updateSlice(
      normalizeWorkSlice({
        ...existing,
        status: 'cancelled',
        updatedAt: persistedAt,
      }),
    );
    cancelledSliceIds.push(existing.id);
  }

  for (const planSlice of plan.slices) {
    const dependencyIds = mapDependencyKeysToIds(planSlice, sliceIdsByKey);
    const existing = existingById.get(sliceIdsByKey[planSlice.sliceKey]);

    if (existing && (existing.changeId !== plan.changeId || existing.specId !== plan.specId)) {
      throw new Error(
        `Persisted slice '${existing.id}' already exists for change '${existing.changeId}' / spec '${existing.specId}', not '${plan.changeId}' / '${plan.specId}'.`,
      );
    }

    const derivedStatus = resolveDerivedSliceStatus({
      dependencyIds,
      blockers: planSlice.blockers,
    });
    const nextStatus = existing && TERMINAL_SLICE_STATUSES.has(existing.status) ? existing.status : derivedStatus;
    const nextBlockers = existing && TERMINAL_SLICE_STATUSES.has(existing.status) ? existing.blockers : planSlice.blockers;
    const persistedSlice = normalizeWorkSlice({
      id: sliceIdsByKey[planSlice.sliceKey],
      projectId: plan.projectId,
      changeId: plan.changeId,
      specId: plan.specId,
      sliceKey: planSlice.sliceKey,
      title: planSlice.title,
      summary: planSlice.summary,
      status: nextStatus,
      sequence: planSlice.sequence,
      priority: planSlice.priority,
      size: planSlice.size,
      dependencyIds,
      blockers: nextBlockers,
      taskRefs: planSlice.sourceTaskIds,
      sourceTaskIds: planSlice.sourceTaskIds,
      taskSubset: planSlice.taskSubset,
      acceptanceChecks: planSlice.acceptanceChecks,
      allowedPaths: planSlice.allowedPaths,
      outOfScopePaths: planSlice.outOfScopePaths,
      relatedArtifacts: planSlice.relatedArtifacts,
      implementationNotes: planSlice.implementationNotes,
      createdAt: existing?.createdAt || persistedAt,
      updatedAt: persistedAt,
      ...(existing?.completedAt ? { completedAt: existing.completedAt } : {}),
    });

    persistedSlices.push(existing ? updateSlice(persistedSlice) : createSlice(persistedSlice));
    if (existing) {
      updatedSliceIds.push(persistedSlice.id);
    } else {
      createdSliceIds.push(persistedSlice.id);
    }
  }

  const ledger: WorkLedger = refreshLedger(plan.projectId, {
    updatedAt: persistedAt,
  });

  return {
    projectId: plan.projectId,
    changeId: plan.changeId,
    specId: plan.specId,
    persistedAt,
    plan,
    slices: persistedSlices,
    sliceIdsByKey,
    createdSliceIds,
    updatedSliceIds,
    cancelledSliceIds,
    ledger,
  };
}

export function deriveAndPersistSlices(
  input: SliceDerivationInput,
  options: PersistSlicePlanOptions = {},
): PersistSlicePlanResult {
  return persistSlicePlan(deriveSlicePlan(input), options);
}
