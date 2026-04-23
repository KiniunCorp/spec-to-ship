import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentRole,
  AutonomyLevel,
  EngineeringExecOptions,
  LLMProvider,
  PipelineStage,
  ProjectIdea,
  ProjectStatus,
  QualityReport,
  RuntimeConfig,
  StageResult,
} from '../types/index.js';
import { ProjectIdeaSchema, SliceDerivationBacklogColumns } from '../types/index.js';
import { writeArtifact, readArtifact, listArtifacts, projectExists } from '../artifacts/store.js';
import { getLedger } from '../ledger/ledger-store.js';
import { advanceStageOwnership } from '../orchestration/router.js';
import { createWorkGate } from '../ledger/gate-lifecycle.js';
import { deriveAndPersistSlices, parseSliceDerivationInput } from '../ledger/derive-slices.js';
import { completeExecutionRun, markExecutionRunVerifying, listRunsByStatus, listSliceIdsByStatus } from '../ledger/index.js';
import { createProvider } from '../providers/interface.js';
import { loadState, createInitialState } from './state.js';
import { runQualityChecks } from '../quality/checks.js';
import { PMAgent } from '../agents/pm.js';
import { ResearchAgent } from '../agents/research.js';
import { DesignAgent } from '../agents/design.js';
import { isFigmaConfigured } from '../figma/config.js';
import { EngineeringAgent } from '../agents/engineering.js';
import type { BaseAgent } from '../agents/base.js';
import { runEngineeringExecution } from '../runtime/engineering-exec.js';

// ── Stage ordering ──

const STAGE_ORDER: PipelineStage[] = ['intake', 'pm', 'research', 'design', 'engineering', 'engineering_exec'];

const STAGE_AGENT_MAP: Record<string, AgentRole> = {
  pm: 'pm',
  research: 'research',
  design: 'design',
  engineering: 'engineering',
};

// ── Public API ──

export async function initProject(idea: string, projectId?: string): Promise<{ projectId: string; ideaJson: ProjectIdea }> {
  const id = projectId ?? slugify(idea);

  const ideaJson: ProjectIdea = {
    project_id: id,
    title: extractTitle(idea),
    one_liner: idea,
    target_users: [],
    problem: idea,
    constraints: {
      privacy: 'no PII stored',
      platform: [],
      timebox: 'prototype first',
    },
    success_metrics: [],
  };

  // Validate with schema
  ProjectIdeaSchema.parse(ideaJson);

  writeArtifact(id, 'idea.json', JSON.stringify(ideaJson, null, 2));

  return { projectId: id, ideaJson };
}

export async function runStage(
  projectId: string,
  stage: PipelineStage,
  provider?: LLMProvider,
  options?: { engineeringExec?: EngineeringExecOptions },
): Promise<StageResult> {
  if (!projectExists(projectId)) {
    throw new Error(`Project "${projectId}" not found. Run initProject first.`);
  }

  if (stage === 'intake') {
    throw new Error('Use initProject for the intake stage.');
  }

  if (stage === 'iterate') {
    throw new Error('Use runIteration for the iterate stage.');
  }

  if (stage === 'engineering_exec') {
    const execution = await runEngineeringExecution(projectId, options?.engineeringExec);

    return {
      stage,
      artifacts: {
        ExecutionPlan: execution.summary,
        WorktreePath: execution.worktreePath,
        VerifyPassed: String(execution.verifyPassed),
        GeneratedArtifacts: execution.generatedArtifacts.join(', '),
      },
      qualityReport: {
        passed: true,
        score: 1,
        issues: [],
      },
      summary: execution.summary,
    };
  }

  const llm = provider ?? createProvider();
  const agent = createAgent(stage, llm, projectId);

  // Run the agent
  const result = await agent.run();

  // Write artifacts
  for (const [filename, content] of Object.entries(result.artifacts)) {
    writeArtifact(projectId, filename, content);
  }

  // Run quality checks
  const qualityReport = runQualityChecks(projectId);
  const stageCheck = getStageQuality(stage, qualityReport);

  return {
    stage,
    artifacts: result.artifacts,
    qualityReport: stageCheck,
    summary: result.summary,
  };
}

export async function runAllStages(
  projectId: string,
  options?: { autonomy?: AutonomyLevel; provider?: LLMProvider; engineeringExec?: EngineeringExecOptions },
): Promise<StageResult[]> {
  const autonomy = options?.autonomy ?? 'low';
  const results: StageResult[] = [];

  const state = loadState(projectId);
  const startIdx = STAGE_ORDER.indexOf(state.currentStage);

  for (let i = startIdx; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    if (stage === 'intake') continue;

    const result = await runStage(projectId, stage, options?.provider, { engineeringExec: options?.engineeringExec });
    results.push(result);

    if (autonomy === 'low') {
      // In low autonomy mode, return after each stage so the conversational UI can gate
      return results;
    }

    // In medium autonomy, auto-advance if quality passes
    if (autonomy === 'medium' && !result.qualityReport.passed) {
      return results;
    }
  }

  return results;
}

export function getProjectStatus(projectId: string): ProjectStatus {
  if (!projectExists(projectId)) {
    return {
      projectId,
      state: createInitialState(projectId),
      artifacts: [],
      exists: false,
    };
  }

  return {
    projectId,
    state: loadState(projectId),
    artifacts: listArtifacts(projectId),
    exists: true,
  };
}

// ── Helpers ──

function createAgent(stage: PipelineStage, provider: LLMProvider, projectId: string): BaseAgent {
  switch (stage) {
    case 'pm':
      return new PMAgent(provider, projectId);
    case 'research':
      return new ResearchAgent(provider, projectId);
    case 'design':
      return new DesignAgent(provider, projectId, isFigmaConfigured());
    case 'engineering':
      return new EngineeringAgent(provider, projectId);
    default:
      throw new Error(`No agent for stage: ${stage}`);
  }
}

function getStageQuality(stage: PipelineStage, report: QualityReport): { passed: boolean; score: number; issues: string[] } {
  const artifactMap: Record<string, string[]> = {
    pm: ['PRD.md'],
    research: ['Research.md'],
    design: ['PrototypeSpec.md'],
    engineering: ['TechSpec.md'],
    engineering_exec: [],
  };

  const relevantFiles = artifactMap[stage] ?? [];
  const allIssues: string[] = [];
  let totalScore = 0;
  let count = 0;

  for (const file of relevantFiles) {
    const check = report.checks[file];
    if (check) {
      allIssues.push(...check.issues);
      totalScore += check.score;
      count++;
    }
  }

  return {
    passed: allIssues.length === 0,
    score: count > 0 ? totalScore / count : 1,
    issues: allIssues,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
}

function extractTitle(idea: string): string {
  // Take first few words as title, capitalize
  const words = idea.split(/\s+/).slice(0, 5);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Submit / quality gate ──

export interface SubmitResult {
  stage: PipelineStage;
  overallScore: number;
  passed: boolean;
  issues: string[];
  warnings?: string[];
  autoApproved: boolean;
  gateCreated: boolean;
  gateId?: string;
  nextStage?: PipelineStage;
  nextAction: string;
}

const STAGE_PRIMARY_ARTIFACTS: Partial<Record<PipelineStage, string[]>> = {
  pm: ['PRD.md'],
  research: ['Research.md'],
  design: ['PrototypeSpec.md'],
  engineering: ['TechSpec.md', 'Backlog.md'],
};

function recordEngineeringExecChatNativeCompletion(projectId: string): SubmitResult {
  const activeRuns = listRunsByStatus(projectId, 'running')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (activeRuns.length === 0) {
    throw new Error(
      'No in-progress execution run found.\n' +
      'Run `s2s stage engineering_exec` first to start a chat-native run, then implement the slice before submitting.',
    );
  }

  const run = activeRuns[0];

  markExecutionRunVerifying(projectId, run.id, {
    branchName: run.branchName,
    resultSummary: `Chat-native execution verifying for slice '${run.sliceId}'.`,
  });

  completeExecutionRun(projectId, run.id, 'succeeded', {
    branchName: run.branchName,
    verificationPassed: true,
    resultSummary: `Chat-native execution completed for slice '${run.sliceId}'.`,
    evidence: [],
  });

  // engineering_exec is a slice-level operation — the route does not include it,
  // so advanceStageOwnership is not called here. Instead, check remaining slices.
  const remainingReadySlices = listSliceIdsByStatus(projectId, 'ready');
  const hasMoreSlices = remainingReadySlices.length > 0;

  return {
    stage: 'engineering_exec',
    overallScore: 1,
    passed: true,
    issues: [],
    autoApproved: true,
    gateCreated: false,
    nextAction: hasMoreSlices
      ? `run: s2s stage engineering_exec  (${remainingReadySlices.length} slice(s) remaining)`
      : 'all slices complete — run: s2s status',
  };
}

export async function recordStageCompletion(
  projectId: string,
  stage: PipelineStage,
  qualityConfig: RuntimeConfig['quality'],
): Promise<SubmitResult> {
  // engineering_exec --submit: no file artifacts to check. The run lifecycle lives in the ledger.
  if (stage === 'engineering_exec') {
    return recordEngineeringExecChatNativeCompletion(projectId);
  }

  const primaryArtifacts = STAGE_PRIMARY_ARTIFACTS[stage];
  if (!primaryArtifacts) {
    throw new Error(`Stage '${stage}' does not support --submit. Use s2s approve/reject for gate-based stages.`);
  }

  // Verify all expected artifacts exist
  for (const filename of primaryArtifacts) {
    const content = readArtifact(projectId, filename);
    if (!content) {
      throw new Error(`Required artifact missing: .s2s/artifacts/${projectId}/${filename}\nWrite the artifact first, then run: s2s stage ${stage} --submit`);
    }
  }

  const minScore = qualityConfig?.minAutoApproveScore ?? 0.85;
  const qualityEnabled = qualityConfig?.enabled !== false;

  let overallScore = 1;
  let allIssues: string[] = [];
  let passed = true;

  if (qualityEnabled) {
    const report = runQualityChecks(projectId);
    const stageCheck = getStageQuality(stage, report);
    overallScore = stageCheck.score;
    allIssues = stageCheck.issues;
    passed = overallScore >= minScore;
  }

  if (!passed) {
    return {
      stage,
      overallScore,
      passed: false,
      issues: allIssues,
      autoApproved: false,
      gateCreated: false,
      nextAction: `fix quality issues and re-run: s2s stage ${stage} --submit`,
    };
  }

  const completedAt = new Date().toISOString();
  const summary = `${stage} stage submitted via --submit (score: ${overallScore.toFixed(2)})`;

  const ownershipResult = advanceStageOwnership(projectId, stage, summary, completedAt);
  const nextStage = ownershipResult.nextStage;

  // Slice derivation for engineering stage
  const warnings: string[] = [];
  if (stage === 'engineering') {
    try {
      const techSpecContent = readArtifact(projectId, 'TechSpec.md');
      const backlogContent = readArtifact(projectId, 'Backlog.md');
      if (techSpecContent && backlogContent) {
        deriveAndPersistSlices(
          parseSliceDerivationInput({
            projectId,
            change: ownershipResult.change,
            spec: ownershipResult.spec,
            techSpecContent,
            backlogContent,
          }),
          { persistedAt: completedAt },
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(
        `Slice derivation failed — engineering_exec will be blocked until this is resolved.\n` +
        `Reason: ${msg}\n` +
        `Fix: regenerate Backlog.md with the exact required columns:\n` +
        `  | ${SliceDerivationBacklogColumns.join(' | ')} |\n` +
        `Then run: s2s stage engineering --submit`,
      );
    }
  }

  // A spec_review gate cannot be created if the spec is already approved.
  // This happens on later stages (e.g. engineering) when the spec was already
  // approved by an earlier stage gate (e.g. pm). In that case, skip the gate —
  // the spec was already human-reviewed and the stage auto-approves.
  const specAlreadyApproved = ownershipResult.spec.status === 'approved';
  const canCreateGate = ownershipResult.approvalReady && !specAlreadyApproved;

  if (canCreateGate) {
    const gateResult = createWorkGate(projectId, {
      changeId: ownershipResult.change.id,
      type: 'spec_review',
      title: `Review ${stage} stage completion`,
      reason: `Stage ${stage} submitted and requires approval before advancing.`,
      specId: ownershipResult.spec.id,
      createdAt: completedAt,
    });
    return {
      stage,
      overallScore,
      passed: true,
      issues: allIssues,
      warnings: warnings.length > 0 ? warnings : undefined,
      autoApproved: false,
      gateCreated: true,
      gateId: gateResult.gate.id,
      nextStage,
      nextAction: `run: s2s approve ${gateResult.gate.id}  (or s2s reject ${gateResult.gate.id})`,
    };
  }

  return {
    stage,
    overallScore,
    passed: true,
    issues: allIssues,
    warnings: warnings.length > 0 ? warnings : undefined,
    autoApproved: true,
    gateCreated: false,
    nextStage,
    nextAction: nextStage ? `run: s2s stage ${nextStage}` : 'all stages complete — run: s2s status',
  };
}

// ── Stage descriptors for context package ──

interface StageArtifactSpec {
  file: string;
  sections?: string;
  format: string;
  constraint?: string;
}

interface StageDescriptor {
  inputArtifacts: string[];
  outputSpecs: StageArtifactSpec[];
  objectiveLine: string;
}

const STAGE_DESCRIPTORS: Partial<Record<PipelineStage, StageDescriptor>> = {
  pm: {
    inputArtifacts: ['idea.json'],
    outputSpecs: [{
      file: 'PRD.md',
      sections: 'Problem, Users & JTBD, MVP Scope, Non-goals, Key Flows, Success Metrics, Risks & Mitigations, Acceptance Criteria',
      format: 'markdown',
      constraint: 'under ~2 pages, all acceptance criteria must be testable',
    }],
    objectiveLine: 'Generate PRD.md for the active feature request.',
  },
  research: {
    inputArtifacts: ['idea.json', 'PRD.md'],
    outputSpecs: [{
      file: 'Research.md',
      sections: 'Investigation Goal, Current Technical Context, Unknowns and Hypotheses, Investigation Plan, Risks and Constraints, Recommendation',
      format: 'markdown',
      constraint: 'concise 1-2 day investigation window, technical evidence only',
    }],
    objectiveLine: 'Generate Research.md technical investigation brief.',
  },
  design: {
    inputArtifacts: ['idea.json', 'PRD.md', 'Research.md'],
    outputSpecs: [
      {
        file: 'PrototypeSpec.md',
        sections: 'Information Architecture, Core Flows, Screen Specs, Microcopy, Accessibility notes, Open questions',
        format: 'markdown',
        constraint: 'at least 4 screens, low-fidelity wireframe-level specs',
      },
    ],
    objectiveLine: 'Generate PrototypeSpec.md.',
  },
  engineering: {
    inputArtifacts: ['idea.json', 'PRD.md', 'Research.md', 'PrototypeSpec.md'],
    outputSpecs: [
      {
        file: 'TechSpec.md',
        sections: 'Architecture Overview, Data Model, API / Integration points, Risk & Security Notes, Implementation Plan, Test Plan',
        format: 'markdown',
        constraint: 'simplest viable architecture, no over-engineering',
      },
      {
        file: 'Backlog.md',
        format: 'markdown table',
        constraint: `exact columns (in this order): | ${SliceDerivationBacklogColumns.join(' | ')} |\nIDs ENG-001+, each item ≤2 days, acceptance criteria semicolon-separated, dependencies comma-separated (or "none"), paths comma-separated (or "none")`,
      },
    ],
    objectiveLine: 'Generate TechSpec.md and Backlog.md.',
  },
};

/** Returns the list of expected output file names for a given pipeline stage. */
export function getStageOutputFiles(stage: PipelineStage): string[] {
  return STAGE_DESCRIPTORS[stage]?.outputSpecs.map((s) => s.file) ?? [];
}

/**
 * Builds the full context package string for a chat-native stage execution.
 * Reads input artifacts, governance files, and orchestrator decision context.
 * Does NOT call any LLM provider — returns the string for the caller to print.
 */
export function buildStageContext(projectId: string, stage: PipelineStage, appRoot: string): string {
  const descriptor = STAGE_DESCRIPTORS[stage];
  if (!descriptor) {
    return `[s2s] Stage '${stage}' does not have a chat-native context package. Run the stage directly.`;
  }

  const ledger = getLedger(projectId);
  const lastDecision = ledger?.lastDecision;
  const route: PipelineStage[] = ledger?.effectiveRoute
    ?? lastDecision?.decision.recommendedStages
    ?? [];
  const routeStr = route.length > 0 ? route.join(' → ') : '(none)';
  const stagePosition = route.indexOf(stage);
  const positionStr = stagePosition >= 0
    ? `${stagePosition + 1} of ${route.length}`
    : '?';
  const intent = lastDecision?.decision.intent ?? '(unknown)';
  const request = lastDecision?.request ?? '(no prior request)';

  // ── Input artifacts ──
  const artifactParts: string[] = [];
  for (const filename of descriptor.inputArtifacts) {
    const content = readArtifact(projectId, filename);
    if (content) {
      artifactParts.push(`--- ${filename} ---\n${content}`);
    }
  }

  // ── Prior stage artifacts ──
  const priorStageFiles = ['PRD.md', 'Research.md', 'PrototypeSpec.md', 'FigmaLink.json', 'TechSpec.md', 'Backlog.md']
    .filter((f) => !descriptor.inputArtifacts.includes(f));
  for (const filename of priorStageFiles) {
    const content = readArtifact(projectId, filename);
    if (content) {
      artifactParts.push(`--- ${filename} ---\n${content}`);
    }
  }

  const artifactsSection = artifactParts.length > 0
    ? artifactParts.join('\n\n')
    : '(none)';

  // ── Governance files ──
  const governanceFiles = [
    path.join(appRoot, '.s2s', 'guardrails', 'AGENTS.md'),
    path.join(appRoot, '.s2s', 'guardrails', 'CODEX.md'),
    path.join(appRoot, '.s2s', 'guardrails', 'CLAUDE.md'),
  ];
  const governanceParts = governanceFiles
    .filter((f) => existsSync(f))
    .map((f) => `--- ${path.basename(f)} ---\n${readFileSync(f, 'utf8').trim()}`);
  const governanceSection = governanceParts.length > 0
    ? governanceParts.join('\n\n')
    : '(no governance files found)';

  // ── Artifact specification ──
  const artifactSpecLines: string[] = [];
  for (const spec of descriptor.outputSpecs) {
    artifactSpecLines.push(`File: ${spec.file}`);
    if (spec.sections) artifactSpecLines.push(`Required sections: ${spec.sections}`);
    artifactSpecLines.push(`Format: ${spec.format}`);
    if (spec.constraint) artifactSpecLines.push(`Constraint: ${spec.constraint}`);
    if (descriptor.outputSpecs.length > 1) artifactSpecLines.push('');
  }

  // ── When done instruction ──
  const whenDoneLines = descriptor.outputSpecs.map(
    (spec) => `Write the artifact to .s2s/artifacts/${projectId}/${spec.file}`,
  );
  whenDoneLines.push(`then run:\n  s2s stage ${stage} --submit`);

  // ── Orchestrator section ──
  const orchestratorLines = [
    `User request: "${request}"`,
    `Classified intent: ${intent}`,
    `Recommended route: ${routeStr}`,
    `Current stage: ${stage} (${positionStr})`,
  ];
  if (lastDecision?.decision.rationale) {
    orchestratorLines.push(`Rationale: ${lastDecision.decision.rationale}`);
  }
  if (stagePosition >= 0 && stagePosition < route.length - 1) {
    const remaining = route.slice(stagePosition + 1);
    orchestratorLines.push(`Remaining after this stage: ${remaining.join(' → ')}`);
  } else {
    orchestratorLines.push('This is the final stage in the route.');
  }

  const lines: string[] = [
    `=== S2S TASK: ${stage} stage ===`,
    '',
    'OBJECTIVE',
    descriptor.objectiveLine,
    '',
    'CONTEXT',
    artifactsSection,
    '',
    '--- Orchestrator decision ---',
    orchestratorLines.join('\n'),
    '',
    '--- Governance (apply these constraints) ---',
    governanceSection,
    '',
    'ARTIFACT SPECIFICATION',
    artifactSpecLines.join('\n').trimEnd(),
    '',
    'QUALITY THRESHOLD',
    'Auto-approve if score ≥ 0.85. Quality is checked on --submit.',
    '',
    'WHEN DONE',
    whenDoneLines.join('\n'),
    '=========================',
  ];

  return lines.join('\n');
}
