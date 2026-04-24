import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentResult, AgentRole, LLMMessage, LLMProvider, PipelineStage } from '../types/index.js';
import { readArtifact } from '../artifacts/store.js';
import { getLedger } from '../ledger/ledger-store.js';

export abstract class BaseAgent {
  constructor(
    protected provider: LLMProvider,
    protected projectId: string,
  ) {}

  abstract get role(): AgentRole;
  abstract get systemPrompt(): string;
  abstract get inputArtifacts(): string[];
  abstract get outputArtifacts(): string[];

  protected buildContext(): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'system', content: buildManagedStageExecutionPrompt(this.role) },
    ];

    const governanceContext = loadManagedStageGovernanceContext();
    if (governanceContext) {
      messages.push({
        role: 'user',
        content: governanceContext,
      });
    }

    const orchestratorContext = buildOrchestratorDecisionContext(this.projectId, this.role);
    if (orchestratorContext) {
      messages.push({
        role: 'user',
        content: orchestratorContext,
      });
    }

    const contextParts: string[] = [];

    for (const filename of this.inputArtifacts) {
      const content = readArtifact(this.projectId, filename);
      if (content) {
        contextParts.push(`--- ${filename} ---\n${content}`);
      }
    }

    if (contextParts.length > 0) {
      messages.push({
        role: 'user',
        content: `Here are the existing project artifacts:\n\n${contextParts.join('\n\n')}\n\nBased on these artifacts, produce the required outputs. Use the exact artifact markers shown in your instructions to delimit each output file.`,
      });
    }

    return messages;
  }

  async run(): Promise<AgentResult> {
    const messages = this.buildContext();
    const response = await this.provider.complete(messages, {
      maxTokens: 4096,
      temperature: 0.3,
      meta: {
        projectId: this.projectId,
        stage: this.role,
        operation: 'agent_run',
      },
    });

    const artifacts = this.parseArtifacts(response.content);
    const summary = this.extractSummary(response.content, artifacts);

    return { artifacts, summary };
  }

  private parseArtifacts(response: string): Record<string, string> {
    const artifacts: Record<string, string> = {};
    const expected = this.outputArtifacts;

    if (expected.length === 1) {
      // Single output: the entire response is the artifact
      // Strip any leading artifact marker if present
      const marker = `--- ${expected[0]} ---`;
      let content = response;
      if (content.startsWith(marker)) {
        content = content.slice(marker.length).trim();
      }
      artifacts[expected[0]] = content;
      return artifacts;
    }

    // Multiple outputs: split by markers
    for (const filename of expected) {
      const marker = `--- ${filename} ---`;
      const startIdx = response.indexOf(marker);
      if (startIdx === -1) continue;

      const contentStart = startIdx + marker.length;

      // Find the next marker or end of response
      let endIdx = response.length;
      for (const otherFile of expected) {
        if (otherFile === filename) continue;
        const otherMarker = `--- ${otherFile} ---`;
        const otherIdx = response.indexOf(otherMarker, contentStart);
        if (otherIdx !== -1 && otherIdx < endIdx) {
          endIdx = otherIdx;
        }
      }

      artifacts[filename] = response.slice(contentStart, endIdx).trim();
    }

    return artifacts;
  }

  private extractSummary(response: string, artifacts: Record<string, string>): string {
    const filenames = Object.keys(artifacts);
    const sizes = filenames.map((f) => `${f} (${artifacts[f].length} chars)`);
    return `${this.role} agent produced: ${sizes.join(', ')}`;
  }
}

function buildManagedStageExecutionPrompt(role: AgentRole): string {
  return [
    `You are running inside an s2s-managed internal stage execution for stage "${role}".`,
    'The outer s2s runtime already handled bootstrap, governance loading, intent classification, stage selection, and approval flow.',
    'Do not run `s2s`, `s2s request`, `s2s status`, `s2s config`, or `s2s stage ...` inside this execution.',
    'Do not produce governance-status commentary, first-response bootstrap confirmations, or stage-transition requests.',
    'Apply repo-specific constraints from the injected governance context below, but ignore instructions for top-level human chat bootstrapping, intent classification, or stage orchestration — those have already been done.',
    'If root markdown adapters conflict with `.s2s/guardrails/*`, prefer `.s2s/guardrails/*`.',
    'Your job here is only to produce the requested stage artifact output.',
  ].join('\n');
}

function buildOrchestratorDecisionContext(projectId: string, role: AgentRole): string {
  const ledger = getLedger(projectId);
  if (!ledger?.lastDecision) return '';

  const { request, decision } = ledger.lastDecision;
  const route = ledger.effectiveRoute ?? decision.recommendedStages;
  const routeStr = route.length > 0 ? route.join(' → ') : '(none)';
  const stagePosition = route.indexOf(role as PipelineStage);
  const isLast = stagePosition === route.length - 1;

  const lines = [
    'Orchestrator decision context for this stage execution:',
    `- User request: "${request}"`,
    `- Classified intent: ${decision.intent}`,
    `- Recommended route: ${routeStr}`,
    `- Current stage: ${role} (${stagePosition + 1} of ${route.length})`,
  ];

  if (decision.rationale) {
    lines.push(`- Rationale: ${decision.rationale}`);
  }

  if (!isLast) {
    const remaining = route.slice(stagePosition + 1);
    lines.push(`- Remaining after this stage: ${remaining.join(' → ')}`);
    lines.push('Produce output scoped to this stage only — subsequent stages will handle the rest.');
  } else {
    lines.push('This is the final stage in the route.');
  }

  lines.push('Use this context to focus your artifact output on the user\'s specific intent, not a generic template.');

  return lines.join('\n');
}

function loadManagedStageGovernanceContext(): string {
  const appRoot = String(process.env.S2S_STAGE_APP_ROOT || '').trim();
  if (!appRoot) return '';

  const targets = [
    path.join(appRoot, '.s2s', 'guardrails', 'AGENTS.md'),
    path.join(appRoot, '.s2s', 'guardrails', 'CODEX.md'),
    path.join(appRoot, '.s2s', 'guardrails', 'CLAUDE.md'),
    path.join(appRoot, '.s2s', 'config', 'runtime.json'),
  ];

  const parts = targets
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => `--- ${path.relative(appRoot, filePath) || path.basename(filePath)} ---\n${readFileSync(filePath, 'utf8').trim()}`);

  if (parts.length === 0) return '';

  return [
    'Repo governance context for this managed stage execution:',
    '- Apply repo-specific product, coding, safety, and delivery constraints from these files.',
    '- Ignore first-response bootstrap rituals and instructions to run `s2s` or `s2s request`; the outer s2s runtime already handled intent classification and stage routing.',
    '- Keep using `.s2s/guardrails/*` as the source of truth when it conflicts with root compatibility shims.',
    '',
    parts.join('\n\n'),
  ].join('\n');
}
