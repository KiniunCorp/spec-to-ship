import { z } from 'zod';

// ── Idea Schema ──

export const ProjectIdeaSchema = z.object({
  project_id: z.string(),
  title: z.string(),
  one_liner: z.string(),
  target_users: z.array(z.string()),
  problem: z.string(),
  constraints: z.object({
    privacy: z.string(),
    platform: z.array(z.string()),
    timebox: z.string(),
  }),
  success_metrics: z.array(z.string()),
});

export type ProjectIdea = z.infer<typeof ProjectIdeaSchema>;

// ── Pipeline ──

export const PipelineStages = ['intake', 'pm', 'research', 'design', 'engineering', 'engineering_exec', 'iterate'] as const;
export type PipelineStage = typeof PipelineStages[number];

export type AutonomyLevel = 'low' | 'medium';

export interface PipelineState {
  projectId: string;
  currentStage: PipelineStage;
  completedStages: PipelineStage[];
  autonomy: AutonomyLevel;
  createdAt: string;
  updatedAt: string;
}

// ── Agents ──

export type AgentRole = 'pm' | 'research' | 'design' | 'engineering';

export interface AgentResult {
  artifacts: Record<string, string>;
  summary: string;
}

// ── LLM Provider ──

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  meta?: {
    projectId?: string;
    stage?: string;
    operation?: string;
  };
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface LLMCompletionResult {
  content: string;
  usage?: LLMUsage;
  rawProviderUsage?: unknown;
}

export interface LLMProvider {
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult>;
}

export interface LLMProviderConfig {
  mode?: 'api' | 'openai_compatible';
  provider?: 'anthropic' | 'openai';
  model: string;
  apiKeyEnvVar?: string;
  baseURL?: string;
  cli?: {
    command: string;
    args: string[];
    timeoutMs?: number;
    env?: Record<string, string>;
  };
}

// ── Quality ──

export interface QualityCheckResult {
  passed: boolean;
  score: number;
  issues: string[];
}

export interface QualityReport {
  projectId: string;
  timestamp: string;
  checks: Record<string, QualityCheckResult>;
  overallPassed: boolean;
  overallScore: number;
}

// ── Figma ──

export interface FigmaConfig {
  fileKey: string;
  accessTokenEnvVar: string;
}

export interface FigmaFrame {
  id: string;
  name: string;
  textContent: string[];
}

export interface FigmaSnapshot {
  fileKey: string;
  pageId: string;
  pageName: string;
  frames: FigmaFrame[];
  pulledAt: string;
}

export interface SnapshotDiff {
  added: FigmaFrame[];
  removed: FigmaFrame[];
  modified: Array<{
    frameId: string;
    frameName: string;
    textChanges: Array<{ old: string; new: string }>;
  }>;
  hasChanges: boolean;
}

// ── Templates ──

export interface ArtifactTemplate {
  filename: string;
  requiredHeadings: string[];
  format: 'markdown' | 'json';
}

// ── Stage Results ──

export interface StageResult {
  stage: PipelineStage;
  artifacts: Record<string, string>;
  qualityReport: QualityCheckResult;
  summary: string;
}

// ── Operational Model ──

export type WorkIntent =
  | 'new_feature'
  | 'feature_refinement'
  | 'bug_fix'
  | 'incident_investigation'
  | 'technical_refactor'
  | 'implementation_only'
  | 'spec_revision'
  | 'resume_existing_change'
  | 'hotfix';

export interface IntentClassification {
  intent: WorkIntent;
  confidence: number;
  rationale: string;
  matchedSignals: string[];
}

export interface ContextResolutionFlags {
  hasExistingWork: boolean;
  hasActiveWork: boolean;
  hasStageArtifacts: boolean;
  hasOpenChange: boolean;
  hasOpenSpec: boolean;
  hasOpenSlice: boolean;
  hasOpenRun: boolean;
  hasPendingGate: boolean;
  hasBlockedChange: boolean;
}

export type WorkEntityStatus = 'not_started' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done';

export type WorkChangeStatus = 'draft' | 'active' | 'blocked' | 'in_review' | 'done' | 'archived';
export type WorkSpecStatus = 'draft' | 'active' | 'review_ready' | 'approved' | 'superseded' | 'archived';
export type WorkSliceStatus = 'draft' | 'queued' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type WorkRunStatus = 'created' | 'running' | 'verifying' | 'blocked' | 'succeeded' | 'failed' | 'cancelled';
export type WorkGateStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type WorkGateType = 'spec_review' | 'execution_review' | 'delivery_review' | 'final_review';
export const WorkEntityKinds = ['change', 'spec', 'slice', 'run', 'gate', 'ledger'] as const;
export type WorkEntityKind = typeof WorkEntityKinds[number];
export type WorkPriority = 'low' | 'medium' | 'high' | 'critical';
export type WorkSliceSize = 'xs' | 's' | 'm' | 'l';
export type WorkArtifactKind = 'markdown' | 'json' | 'log' | 'link' | 'other';
export type WorktreeProviderKind = 'worktrunk' | 'native';
export const WorktreeProviderCapabilities = [
  'centralized_paths',
  'switch_session',
  'list_sessions',
  'remove_sessions',
  'session_validation',
  'pull_request_workspace',
] as const;
export type WorktreeProviderCapability = typeof WorktreeProviderCapabilities[number];
export type WorktreeSessionPurpose = 'change' | 'pull_request';
export type WorktreeSessionState = 'active' | 'stale' | 'integrated' | 'missing' | 'invalid';
export type WorktreePullRequestState = 'open' | 'closed' | 'merged' | 'unknown';
export type WorktreeValidationAction =
  | 'resume'
  | 'create_session'
  | 'create_fresh_session'
  | 'create_fresh_branch'
  | 'cleanup'
  | 'manual_review';
export type ReadinessScope = 'machine' | 'repository' | 'feature';
export type ReadinessRequirement = 'required' | 'optional' | 'enabled_feature';
export type ReadinessStatus = 'ready' | 'action_required' | 'blocked' | 'not_applicable';
export const ReadinessFeatures = [
  'ui_target',
  'llm_access',
  'workspace_bootstrap',
  'worktree_native',
  'worktree_worktrunk',
] as const;
export type ReadinessFeature = typeof ReadinessFeatures[number];

export interface ReadinessCheck {
  id: string;
  scope: ReadinessScope;
  requirement: ReadinessRequirement;
  status: ReadinessStatus;
  label: string;
  summary: string;
  reason: string;
  remediation?: string;
  feature?: ReadinessFeature;
}

export interface ReadinessSummaryBucket {
  status: ReadinessStatus;
  ready: boolean;
  checkIds: string[];
  blockingCheckIds: string[];
  actionRequiredCheckIds: string[];
  warningCheckIds: string[];
}

export interface ReadinessFeatureSummary extends ReadinessSummaryBucket {
  feature: ReadinessFeature;
  label: string;
}

export interface RuntimeReadinessReport {
  ready: boolean;
  status: ReadinessStatus;
  repoRoot: string;
  controlRoot: string;
  runtimeRoot: string;
  worktreesRoot: string;
  enabledFeatures: ReadinessFeature[];
  checks: ReadinessCheck[];
  machine: ReadinessSummaryBucket;
  repository: ReadinessSummaryBucket;
  features: ReadinessFeatureSummary[];
}

export interface InitReadinessChecklistItem {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
}

export interface InitPrerequisiteReport {
  ready: boolean;
  canInitialize: boolean;
  status: ReadinessStatus;
  summary: string;
  repoRoot: string;
  s2sDir: string;
  configDir: string;
  localStatePresent: boolean;
  repositoryInitialized: boolean;
  runtimeConfigPath: string;
  llmConfigPath: string;
  enabledFeatures: ReadinessFeature[];
  readiness: RuntimeReadinessReport;
  repoLocalChecks: ReadinessCheck[];
  blockingChecks: ReadinessCheck[];
  setupChecks: ReadinessCheck[];
  warningChecks: ReadinessCheck[];
  nextActions: string[];
  readinessChecklist: InitReadinessChecklistItem[];
  suggestedNextActions: string[];
}

export interface LightweightPrerequisiteCheckOptions {
  repoRoot?: string;
  runtimeConfig?: RuntimeConfig;
  runtimeConfigPath?: string;
  commandExistsFn?: (command: string) => boolean;
}

export type LightweightPrerequisiteCommand = 's2s init' | 's2s doctor' | 's2s stage pm';

export const CLISharedFlagNames = [
  'json',
  'verbose',
  'debug',
  'yes',
  'dryRun',
  'noInput',
  'refine',
  'contextOnly',
  'submit',
  'configPath',
  'repoPath',
] as const;
export type CLISharedFlagName = typeof CLISharedFlagNames[number];

export interface CLISharedFlags {
  json: boolean;
  verbose: boolean;
  debug: boolean;
  yes: boolean;
  dryRun: boolean;
  noInput: boolean;
  refine: boolean;
  refinePrompt?: string;
  /** When true, `s2s stage <stage> --context` outputs the context package without updating state. */
  contextOnly?: boolean;
  /** When true, `s2s stage <stage> --submit` records artifact completion and runs quality checks. */
  submit?: boolean;
  configPath?: string;
  repoPath?: string;
}

export interface LightweightPrerequisiteReport {
  ready: boolean;
  repoRoot: string;
  s2sDir: string;
  configDir: string;
  localStatePresent: boolean;
  repositoryInitialized: boolean;
  status: ReadinessStatus;
  summary: string;
  recommendedCommand?: LightweightPrerequisiteCommand;
  readiness: RuntimeReadinessReport;
  blockingChecks: ReadinessCheck[];
  actionRequiredChecks: ReadinessCheck[];
  warnings: string[];
  pendingActions: string[];
}

export type OutputRendererState = 'info' | 'ok' | 'warn' | 'fail';

export interface OutputRendererMetadataItem {
  label: string;
  value: string;
}

export interface OutputRendererStatusItem {
  label: string;
  value?: string;
  state?: OutputRendererState;
  detail?: string;
  remediation?: string;
}

export interface OutputRendererPhaseStep {
  label: string;
  state: 'done' | 'current' | 'pending';
  detail?: string;
}

export interface OutputRendererArtifactNode {
  label: string;
  children?: OutputRendererArtifactNode[];
}

export interface FlowDecision {
  intent: WorkIntent;
  confidence?: number;
  matchedSignals?: string[];
  rationale: string;
  nextStage: PipelineStage;
  recommendedStages: PipelineStage[];
  requiresHumanApproval: boolean;
  createChange: boolean;
  createSpec: boolean;
  directToExecution: boolean;
  resumeChangeId?: string;
  expansion?: FlowExpansionDecision;
}

export interface FlowExpansionDecision {
  changeId: string;
  addedStages: PipelineStage[];
  reopenedStages?: PipelineStage[];
  rationale: string;
}

export const ORCHESTRATION_DECISION_RECORD_VERSION = 1 as const;
export type OrchestrationDecisionRecordVersion = typeof ORCHESTRATION_DECISION_RECORD_VERSION;

export interface WorkArtifactReference {
  path: string;
  kind: WorkArtifactKind;
  label?: string;
  stage?: PipelineStage;
}

export interface DesignContextHandoff {
  summary?: string;
  designDefinition?: WorkArtifactReference;
  supportingArtifacts: WorkArtifactReference[];
}

export interface WorkScopeDefinition {
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
}

export const SLICE_DERIVATION_CONTRACT_VERSION = 1 as const;
export type SliceDerivationContractVersion = typeof SLICE_DERIVATION_CONTRACT_VERSION;
export const SliceDerivationArtifactPaths = ['TechSpec.md', 'Backlog.md'] as const;
export type SliceDerivationArtifactPath = typeof SliceDerivationArtifactPaths[number];
export const SliceDerivationTechSpecHeadings = [
  'Architecture Overview',
  'Data Model',
  'API / Integration points',
  'Risk & Security Notes',
  'Implementation Plan',
  'Test Plan',
] as const;
export type SliceDerivationTechSpecHeading = typeof SliceDerivationTechSpecHeadings[number];
export const SliceDerivationBacklogColumns = [
  'ID',
  'Priority',
  'Task',
  'Description',
  'Estimate',
  'Dependencies',
  'Acceptance Criteria',
  'Allowed Paths',
  'Out of Scope',
] as const;
export type SliceDerivationBacklogColumn = typeof SliceDerivationBacklogColumns[number];

export interface WorkChangeRequest {
  summary: string;
  rawInput?: string;
  source: 'user' | 'system' | 'imported' | 'unknown';
}

export interface WorkChange {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  intent: WorkIntent;
  status: WorkChangeStatus;
  request: WorkChangeRequest;
  scope: WorkScopeDefinition;
  currentStage?: PipelineStage;
  activeSpecId?: string;
  stageStatus: Partial<Record<PipelineStage, WorkEntityStatus>>;
  blockerIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkSpec {
  id: string;
  projectId: string;
  changeId: string;
  version: number;
  title: string;
  summary: string;
  status: WorkSpecStatus;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  sourceArtifacts: WorkArtifactReference[];
  designDefinition?: WorkArtifactReference;
  designContext?: DesignContextHandoff;
  stageSummaries?: Partial<Record<PipelineStage, string>>;
  refinedFromSpecId?: string;
  refinementReason?: string;
  refinementSourceSliceId?: string;
  refinementSourceRunId?: string;
  refinementSourceGateId?: string;
  supersededBySpecId?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSlice {
  id: string;
  projectId: string;
  changeId: string;
  specId: string;
  sliceKey?: string;
  title: string;
  summary: string;
  status: WorkSliceStatus;
  sequence: number;
  priority: WorkPriority;
  size: WorkSliceSize;
  dependencyIds: string[];
  blockers: string[];
  taskRefs: string[];
  sourceTaskIds?: string[];
  taskSubset?: SliceDerivationTaskSubsetItem[];
  acceptanceChecks: string[];
  allowedPaths: string[];
  outOfScopePaths: string[];
  relatedArtifacts: WorkArtifactReference[];
  implementationNotes?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SliceDerivationTechSpecSections {
  architectureOverview: string;
  dataModel: string;
  apiIntegrationPoints: string;
  riskSecurityNotes: string;
  implementationPlan: string;
  testPlan: string;
}

export interface SliceDerivationBacklogItem {
  id: string;
  title: string;
  description: string;
  priority: WorkPriority;
  estimate: string;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  allowedPaths: string[];
  outOfScopePaths: string[];
}

export interface SliceDerivationInput {
  schemaVersion: SliceDerivationContractVersion;
  projectId: string;
  change: WorkChange;
  spec: WorkSpec;
  techSpecPath: Extract<SliceDerivationArtifactPath, 'TechSpec.md'>;
  backlogPath: Extract<SliceDerivationArtifactPath, 'Backlog.md'>;
  supportingArtifacts: WorkArtifactReference[];
  techSpec: SliceDerivationTechSpecSections;
  backlog: SliceDerivationBacklogItem[];
}

export interface SliceDerivationDraft {
  sliceKey: string;
  title: string;
  summary: string;
  sourceTaskIds: string[];
  taskSubset: SliceDerivationTaskSubsetItem[];
  acceptanceChecks: string[];
  allowedPaths: string[];
  outOfScopePaths: string[];
  relatedArtifacts: WorkArtifactReference[];
  implementationNotes: string[];
  priority: WorkPriority;
  size: WorkSliceSize;
}

export interface SliceDerivationTaskSubsetItem {
  taskId: string;
  title: string;
  summary: string;
  dependencyIds: string[];
}

export interface SliceDerivationPlanSlice extends SliceDerivationDraft {
  sequence: number;
  dependencyKeys: string[];
  blockers: string[];
}

export interface SliceDerivationPlan {
  schemaVersion: SliceDerivationContractVersion;
  projectId: string;
  changeId: string;
  specId: string;
  generatedAt?: string;
  slices: SliceDerivationPlanSlice[];
  warnings: string[];
}

export interface WorkRunEvidence {
  kind: WorkArtifactKind;
  path?: string;
  url?: string;
  summary?: string;
}

export interface CreateExecutionRunOptions {
  provider: string;
  createdAt?: string;
  branchName?: string;
  worktreePath?: string;
  worktreeSessionId?: string;
  resultSummary?: string;
  evidence?: WorkRunEvidence[];
}

export interface UpdateExecutionRunOptions {
  updatedAt?: string;
  branchName?: string;
  worktreePath?: string;
  worktreeSessionId?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  reusedPullRequest?: boolean;
  requiredFreshBranch?: boolean;
  verificationPassed?: boolean;
  resultSummary?: string;
  evidence?: WorkRunEvidence[];
  startedAt?: string;
  finishedAt?: string;
}

export interface CreateWorkGateOptions {
  changeId: string;
  type: WorkGateType;
  title: string;
  reason: string;
  specId?: string;
  sliceId?: string;
  runId?: string;
  createdAt?: string;
}

export interface ResolveWorkGateOptions {
  actor?: string;
  note?: string;
  decidedAt?: string;
}

export interface WorkRun {
  id: string;
  projectId: string;
  changeId: string;
  specId: string;
  sliceId: string;
  status: WorkRunStatus;
  provider: string;
  branchName?: string;
  worktreePath?: string;
  worktreeSessionId?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  reusedPullRequest?: boolean;
  requiredFreshBranch?: boolean;
  verificationPassed?: boolean;
  resultSummary?: string;
  evidence: WorkRunEvidence[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ExecutionTraceabilityRecord {
  projectId: string;
  request: WorkChangeRequest;
  change: {
    id: string;
    title: string;
    status: WorkChangeStatus;
    currentStage?: PipelineStage;
  };
  spec: {
    id: string;
    title: string;
    status: WorkSpecStatus;
    version: number;
  };
  slice: {
    id: string;
    title: string;
    status: WorkSliceStatus;
    sequence: number;
  };
  run: {
    id: string;
    status: WorkRunStatus;
    provider: string;
    branchName?: string;
    worktreePath?: string;
    worktreeSessionId?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    reusedPullRequest?: boolean;
    requiredFreshBranch?: boolean;
    verificationPassed?: boolean;
    resultSummary?: string;
    evidence: WorkRunEvidence[];
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
  };
  chain: string[];
}

export interface WorkGateDecision {
  actor?: string;
  note?: string;
  decidedAt: string;
}

export interface WorkGate {
  id: string;
  projectId: string;
  changeId: string;
  type: WorkGateType;
  status: WorkGateStatus;
  title: string;
  reason: string;
  specId?: string;
  sliceId?: string;
  runId?: string;
  decision?: WorkGateDecision;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface WorkLedger {
  projectId: string;
  activeChangeId?: string;
  activeSpecId?: string;
  changeIds: string[];
  specIds: string[];
  sliceIds: string[];
  runIds: string[];
  gateIds: string[];
  pendingGateIds: string[];
  blockedChangeIds: string[];
  blockers: string[];
  lastIntent?: WorkIntent;
  lastDecision?: OrchestrationDecisionRecord;
  /** Accumulated union of all stages required by any decision for the active change, in pipeline order. Resets when a new change is created. */
  effectiveRoute?: PipelineStage[];
  /** True if any past decision for the active change required human approval. Preserved until the change is resolved. Resets with a new change. */
  effectiveApprovalRequired?: boolean;
  sliceIdsByStatus: Partial<Record<WorkSliceStatus, string[]>>;
  runIdsByStatus: Partial<Record<WorkRunStatus, string[]>>;
  updatedAt: string;
}

export interface WorkRunLifecycleResult {
  projectId: string;
  slice: WorkSlice;
  run: WorkRun;
  ledger: WorkLedger;
}

export interface WorkGateLifecycleResult {
  projectId: string;
  change: WorkChange;
  gate: WorkGate;
  ledger: WorkLedger;
  spec?: WorkSpec;
  slice?: WorkSlice;
  run?: WorkRun;
}

export interface ExecutableSliceSelectionOptions {
  changeId?: string;
  specId?: string;
  /** When true, skip the active-change fallback and search all slices project-wide. */
  projectWide?: boolean;
}

export interface ExecutableSliceCandidate {
  slice: WorkSlice;
  eligibleStatus: boolean;
  incompleteDependencyIds: string[];
  blockers: string[];
  executable: boolean;
}

export interface ExecutableSliceSelection {
  projectId: string;
  change: WorkChange | null;
  spec: WorkSpec | null;
  candidates: ExecutableSliceCandidate[];
  executableSlices: WorkSlice[];
  selectedSlice: WorkSlice | null;
}

export interface PersistSlicePlanOptions {
  persistedAt?: string;
}

export interface PersistSlicePlanResult {
  projectId: string;
  changeId: string;
  specId: string;
  persistedAt: string;
  plan: SliceDerivationPlan;
  slices: WorkSlice[];
  sliceIdsByKey: Record<string, string>;
  createdSliceIds: string[];
  updatedSliceIds: string[];
  cancelledSliceIds: string[];
  ledger: WorkLedger;
}

export interface CreateRefinementSpecVersionOptions {
  changeId: string;
  baseSpecId?: string;
  reason: string;
  summary?: string;
  createdAt?: string;
  sourceSliceId?: string;
  sourceRunId?: string;
  sourceGateId?: string;
}

export interface RefinementSpecVersionResult {
  projectId: string;
  change: WorkChange;
  previousSpec: WorkSpec;
  spec: WorkSpec;
  ledger: WorkLedger;
}

export interface ChangeInitializationResult {
  projectId: string;
  change: WorkChange;
  decision: OrchestrationDecisionRecord;
  created: boolean;
}

export interface SpecInitializationResult {
  projectId: string;
  change: WorkChange;
  spec: WorkSpec;
  decision: OrchestrationDecisionRecord;
  changeCreated: boolean;
  specCreated: boolean;
}

export interface StageOwnershipUpdateResult {
  projectId: string;
  change: WorkChange;
  spec: WorkSpec;
  designContext?: DesignContextHandoff;
  decision: OrchestrationDecisionRecord;
  completedStage: PipelineStage;
  nextStage?: PipelineStage;
  approvalReady: boolean;
  linkedSourceArtifacts: WorkArtifactReference[];
  changeCreated: boolean;
  specCreated: boolean;
}

export interface ContextResolution {
  projectId: string;
  intent?: WorkIntent;
  ledger: WorkLedger;
  activeChange: WorkChange | null;
  activeSpec: WorkSpec | null;
  designContext?: DesignContextHandoff;
  openChanges: WorkChange[];
  openSpecs: WorkSpec[];
  openSlices: WorkSlice[];
  openRuns: WorkRun[];
  pendingGates: WorkGate[];
  blockedChanges: WorkChange[];
  artifacts: WorkArtifactReference[];
  flags: ContextResolutionFlags;
  rationale: string;
  matchedSignals: string[];
}

export interface WorkEntityRecordMap {
  change: WorkChange;
  spec: WorkSpec;
  slice: WorkSlice;
  run: WorkRun;
  gate: WorkGate;
  ledger: WorkLedger;
}

export type WorkEntityRecord<K extends WorkEntityKind> = WorkEntityRecordMap[K];

export interface WorktreeProviderConfig {
  kind: WorktreeProviderKind;
  repoRoot: string;
  controlRoot?: string;
  worktreesRoot?: string;
  defaultBranch: string;
  repoSlug?: string;
  binaryPath?: string;
  env?: Record<string, string>;
  capabilities?: WorktreeProviderCapability[];
}

export interface WorktreeRuntimePaths {
  repoRoot: string;
  repoSlug: string;
  controlRoot: string;
  runtimeRoot: string;
  worktreesRoot: string;
  repoWorktreesRoot: string;
  providerStateRoot: string;
}

export interface WorktreeProviderAvailability {
  available: boolean;
  reason?: string;
  version?: string;
}

export interface WorktreeSessionPullRequestRef {
  number: number;
  url?: string;
  state?: WorktreePullRequestState;
}

export interface WorktreeSession {
  id: string;
  provider: WorktreeProviderKind;
  repoRoot: string;
  baseBranch: string;
  branch: string;
  worktreePath: string;
  pathSegment: string;
  state: WorktreeSessionState;
  isResumable: boolean;
  purpose: WorktreeSessionPurpose;
  changeId?: string;
  sliceId?: string;
  runId?: string;
  pullRequest?: WorktreeSessionPullRequestRef;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
}

export interface WorktreeSessionRequest {
  repoRoot: string;
  branch: string;
  baseBranch?: string;
  purpose?: WorktreeSessionPurpose;
  changeId?: string;
  sliceId?: string;
  runId?: string;
  preferredPathSegment?: string;
  reuseExisting?: boolean;
}

export interface WorktreeSessionQuery {
  repoRoot?: string;
  branch?: string;
  changeId?: string;
  sliceId?: string;
  runId?: string;
  purpose?: WorktreeSessionPurpose;
  state?: WorktreeSessionState | 'any';
}

export interface WorktreeSessionRemoval {
  force?: boolean;
  removeBranch?: boolean;
}

export interface WorktreeSessionValidation {
  sessionId: string;
  state: WorktreeSessionState;
  isResumable: boolean;
  checkedAt: string;
  reason?: string;
  requiredAction?: WorktreeValidationAction;
}

export interface WorktreePullRequestWorkspaceRequest {
  repoRoot: string;
  prNumber: number;
  branch: string;
  baseBranch?: string;
  changeId?: string;
  sliceId?: string;
  runId?: string;
  url?: string;
}

export interface WorktreeProvider {
  readonly kind: WorktreeProviderKind;
  readonly config: WorktreeProviderConfig;
  getCapabilities(): WorktreeProviderCapability[];
  checkAvailability(): Promise<WorktreeProviderAvailability>;
  resolveRuntimePaths(): WorktreeRuntimePaths;
  resolveSessionPath(request: WorktreeSessionRequest): string;
  ensureSession(request: WorktreeSessionRequest): Promise<WorktreeSession>;
  switchToSession(session: WorktreeSession): Promise<void>;
  listSessions(query?: WorktreeSessionQuery): Promise<WorktreeSession[]>;
  removeSession(session: WorktreeSession, options?: WorktreeSessionRemoval): Promise<void>;
  validateSession(session: WorktreeSession): Promise<WorktreeSessionValidation>;
  openPullRequestWorkspace?(request: WorktreePullRequestWorkspaceRequest): Promise<WorktreeSession>;
}

export type RouterIntent = WorkIntent;

export type RouteStageAction = 'invoke' | 'skip';

export interface RouteStageDecision {
  stage: PipelineStage;
  action: RouteStageAction;
  reason: string;
}

export interface RouteDecision extends FlowDecision {
  intent: RouterIntent;
  stageDecisions: RouteStageDecision[];
  skippedStages: PipelineStage[];
}

export interface OrchestrationDecisionRecord {
  schemaVersion: OrchestrationDecisionRecordVersion;
  projectId: string;
  request: string;
  decidedAt: string;
  decision: RouteDecision;
}

export interface StageApprovalPolicy {
  stage: PipelineStage;
  requiresHumanApproval: boolean;
}

export interface PRApprovalPolicy {
  requiresHumanApproval: boolean;
  allowAutoMerge: boolean;
}

export interface RuntimePolicy {
  autonomy: AutonomyLevel;
  stagePolicies: StageApprovalPolicy[];
  prPolicy: PRApprovalPolicy;
}

export interface RuntimeWorkspacePaths {
  basePath: string;
  projectRepoPath: string;
  worktreesRootPath: string;
  orchestratorRepoPath: string;
}

export interface RuntimeConfig {
  productName: string;
  defaultBranch: string;
  guardrailPolicy: 'strict' | 'warn' | 'prompt';
  workspace: {
    basePath: string;
    orchestratorDirName: string;
    projectDirName: string;
    worktreesDirName: string;
    projectRepoPath?: string;
    worktreesRootPath?: string;
  };
  github: {
    remoteName: string;
    autoPush: boolean;
    autoPR: boolean;
    autoMerge: boolean;
  };
  execution: {
    mode: 'manual' | 'shell';
    templateId: string;
    commandTemplate: string;
    maxTasksPerRun: number;
    stopOnFailure: boolean;
    timeoutMs: number;
    allowedCommands: string[];
    allowUnsafeRawCommand: boolean;
  };
  costControl: {
    enabled: boolean;
    budgetUsd: number;
    warnThresholdPct: number;
    hardStopThresholdPct: number;
  };
  chatObservability: {
    sessionBannerEnabled: boolean;
    wrapperPrefixEnabled: boolean;
    wrapperPrefixTemplate: string;
  };
  versioning?: {
    enforceSemverBumpOnDelivery?: boolean;
    requireChangelogUpdate?: boolean;
    manifestFile?: string;
    changelogFile?: string;
  };
  /** Controls how `s2s stage` delivers output. 'chat-native' (default): outputs a context
   * package for the chat AI to consume. 'standalone': calls the LLM API directly. */
  pipelineMode?: 'chat-native' | 'standalone';
  /** When false, suppresses `[s2s]` prefix lines from stage output. Default: true. */
  verbose?: boolean;
  /** Quality gate configuration for --submit. */
  quality?: {
    /** Whether quality checks are enabled. Default: true. */
    enabled: boolean;
    /** Auto-approve threshold (0.0–1.0). Default: 0.85. */
    minAutoApproveScore: number;
    /** Whether to exit 1 when quality check fails. Default: false. */
    blockOnFailure: boolean;
  };
}

export interface LiveState {
  updatedAt: string;
  project?: string;
  feature?: string;
  intent?: string;
  route?: string[];
  stage?: string;
  status: 'none' | 'context_delivered' | 'submitted' | 'gate_pending' | 'approved' | 'rejected';
  nextAction?: string;
  artifacts?: Record<string, 'pending' | 'produced'>;
  blockers?: string[];
}

export interface GuardrailConflict {
  filePath: string;
  fileName: string;
  ruleId: string;
  severity: 'warn' | 'fail';
  description: string;
  snippet: string;
}

export interface ExecutionCommandTemplate {
  id: string;
  provider: 'codex' | 'claude' | 'opencode' | 'custom';
  description: string;
  command: string;
  args: string[];
  timeoutMs: number;
  allowedCommands: string[];
  env?: Record<string, string>;
}

export interface EngineeringExecOptions {
  appName?: string;
  appRepoPath?: string;
  worktreesRootPath?: string;
  changeId?: string;
  sliceId?: string;
  initializeLocalGitIfMissing?: boolean;
  gitRemoteUrl?: string;
  gitRemoteName?: string;
  dryRun?: boolean;
}

export interface EngineeringExecutionTaskHandoff {
  taskId: string;
  title: string;
  summary: string;
  dependencyIds: string[];
}

export interface EngineeringExecutionHandoff {
  projectId: string;
  changeId: string;
  changeTitle: string;
  changeSummary: string;
  specId: string;
  specTitle: string;
  specSummary: string;
  specGoals: string[];
  specConstraints: string[];
  specAcceptanceCriteria: string[];
  sliceId: string;
  sliceTitle: string;
  sliceSummary: string;
  sliceSequence: number;
  sliceStatus: WorkSliceStatus;
  runId?: string;
  appName?: string;
  projectRepoPath?: string;
  provider?: string;
  branchName?: string;
  dependencyIds: string[];
  blockers: string[];
  taskRefs: string[];
  sourceTaskIds: string[];
  tasks: EngineeringExecutionTaskHandoff[];
  acceptanceChecks: string[];
  allowedPaths: string[];
  outOfScopePaths: string[];
  implementationNotes: string[];
  relatedArtifacts: WorkArtifactReference[];
  designSummary?: string;
  designDefinition?: WorkArtifactReference;
  supportingArtifacts: WorkArtifactReference[];
  sliceContextDocument: string;
}

export interface SliceContextDocumentOptions {
  sliceId: string;
  runId?: string;
  appName?: string;
  projectRepoPath?: string;
  provider?: string;
  branchName?: string;
  generatedAt?: string;
}

export interface WorkspaceBootstrapOptions {
  appName: string;
  appRepoPath?: string;
  worktreesRootPath?: string;
  createIfMissing?: boolean;
}

export interface WorkspaceGuardrailResult {
  directoryPath: string;
  filePath: string;
  status: 'created' | 'updated' | 'unchanged' | 'skipped';
  reason?: string;
}

export interface WorkspaceBootstrapResult {
  appName: string;
  appRepoPath: string;
  worktreesRootPath: string;
  configPath: string;
  createdDirectories: string[];
  guardrails: WorkspaceGuardrailResult[];
  updated: boolean;
}

export type AppStackMode = 'recommended' | 'custom';

export interface AppScaffoldOptions {
  appName: string;
  appRepoPath: string;
  worktreesRootPath: string;
  mode: AppStackMode;
  customStackNotes?: string;
  overwrite?: boolean;
}

export interface AppScaffoldResult {
  appName: string;
  mode: AppStackMode;
  appRepoPath: string;
  worktreesRootPath: string;
  initializedGit: boolean;
  createdFiles: string[];
  skippedExistingFiles: string[];
}

export interface GitOperationResult {
  branch: string;
  committed: boolean;
  pushed: boolean;
  prCreated: boolean;
  prNumber?: number;
  prUrl?: string;
  reusedPullRequest?: boolean;
  requiredFreshBranch?: boolean;
  merged: boolean;
  policyNote?: string;
  versionNote?: string;
  versionFrom?: string;
  versionTo?: string;
  versionBumpType?: 'initial' | 'major' | 'minor' | 'patch' | 'prerelease' | 'build';
  versionManifest?: string;
  changelogUpdated?: boolean;
}

export interface EngineeringExecResult {
  projectId: string;
  appName: string;
  changeId: string;
  sliceId?: string;
  runId?: string;
  workspace: RuntimeWorkspacePaths;
  generatedArtifacts: string[];
  worktreePath: string;
  verifyPassed: boolean;
  git: GitOperationResult;
  traceability: ExecutionTraceabilityRecord;
  summary: string;
}

export interface IterationResult {
  diff: SnapshotDiff;
  updatedArtifacts: string[];
  logEntry: string;
}

export interface ProjectStatus {
  projectId: string;
  state: PipelineState;
  artifacts: string[];
  exists: boolean;
}
