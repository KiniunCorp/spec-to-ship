import type { AgentRole, DesignContextHandoff, LLMProvider, WorkArtifactReference, WorkSpec } from '../types/index.js';
import { BaseAgent } from './base.js';

type DesignSignalRule = {
  pattern: RegExp;
  label: string;
};

export const DESIGN_INPUT_ARTIFACTS = ['idea.json', 'PRD.md', 'Research.md'] as const;
export const DESIGN_OUTPUT_ARTIFACTS = ['PrototypeSpec.md'] as const;
export const DESIGN_FIGMA_ARTIFACT = 'FigmaLink.json' as const;
export const PRIMARY_DESIGN_DEFINITION_LABEL = 'PrototypeSpec.md' as const;

const designSignalRules: DesignSignalRule[] = [
  { pattern: /\bui\b/, label: 'ui' },
  { pattern: /\bux\b/, label: 'ux' },
  { pattern: /\bvisual\b/, label: 'visual' },
  { pattern: /\bvisual language\b/, label: 'visual language' },
  { pattern: /\binterface\b/, label: 'interface' },
  { pattern: /\binteraction\b/, label: 'interaction' },
  { pattern: /\bdashboard\b/, label: 'dashboard' },
  { pattern: /\bwireframe\b/, label: 'wireframe' },
  { pattern: /\bmockup\b/, label: 'mockup' },
  { pattern: /\bprototype\b/, label: 'prototype' },
  { pattern: /\bfigma\b/, label: 'figma' },
  { pattern: /\bmicrocopy\b/, label: 'microcopy' },
  { pattern: /\baccessibilit(?:y|ies)\b/, label: 'accessibility' },
  { pattern: /\b(empty|loading|error)\s+states?\b/, label: 'interface states' },
  { pattern: /\b(screen|modal|form|navigation|layout)\b/, label: 'screen behavior' },
  { pattern: /\b(flow|flows|journey|journeys)\b/, label: 'feature flow' },
  { pattern: /\binformation architecture\b/, label: 'information architecture' },
  { pattern: /\b(asset|assets|icon|icons|image|images|illustration|illustrations)\b/, label: 'asset requirements' },
  { pattern: /\b(cli ui|cli ux|terminal experience)\b/, label: 'cli ux' },
];

function uniqueValues(values: Array<string | undefined>): string[] {
  const deduped: string[] = [];

  for (const value of values) {
    if (!value || deduped.includes(value)) {
      continue;
    }

    deduped.push(value);
  }

  return deduped;
}

function normalizeRequest(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDesignOutputArtifactLabel(labelOrPath?: string): boolean {
  const candidate = String(labelOrPath || '').trim().split('/').pop();
  if (!candidate) {
    return false;
  }

  return (
    DESIGN_OUTPUT_ARTIFACTS.includes(candidate as (typeof DESIGN_OUTPUT_ARTIFACTS)[number]) ||
    candidate === DESIGN_FIGMA_ARTIFACT
  );
}

export function isPrimaryDesignDefinitionLabel(labelOrPath?: string): boolean {
  const candidate = String(labelOrPath || '').trim().split('/').pop();
  return candidate === PRIMARY_DESIGN_DEFINITION_LABEL;
}

export function collectDesignRequestSignals(request: string): string[] {
  const normalizedRequest = normalizeRequest(request);
  return uniqueValues(
    designSignalRules.filter((rule) => rule.pattern.test(normalizedRequest)).map((rule) => rule.label),
  );
}

function compareArtifactReferencePath(left: WorkArtifactReference, right: WorkArtifactReference): number {
  return left.path.localeCompare(right.path);
}

function dedupeArtifactReferences(artifacts: readonly WorkArtifactReference[]): WorkArtifactReference[] {
  const deduped = new Map<string, WorkArtifactReference>();

  for (const artifact of artifacts) {
    deduped.set(artifact.path, artifact);
  }

  return [...deduped.values()].sort(compareArtifactReferencePath);
}

function isPrimaryDesignDefinitionReference(
  artifact?: Pick<WorkArtifactReference, 'label' | 'path'>,
): boolean {
  if (!artifact) {
    return false;
  }

  return isPrimaryDesignDefinitionLabel(artifact.label || artifact.path);
}

function isDesignContextArtifact(artifact?: Pick<WorkArtifactReference, 'label' | 'path' | 'stage'>): boolean {
  if (!artifact) {
    return false;
  }

  return artifact.stage === 'design' || isDesignOutputArtifactLabel(artifact.label || artifact.path);
}

type DesignContextSpecLike = Pick<WorkSpec, 'designContext' | 'designDefinition' | 'sourceArtifacts' | 'stageSummaries'>;

export function collectPersistedDesignArtifacts(spec?: DesignContextSpecLike | null): WorkArtifactReference[] {
  if (!spec) {
    return [];
  }

  return dedupeArtifactReferences([
    ...(spec.designDefinition ? [spec.designDefinition] : []),
    ...(spec.sourceArtifacts || []).filter((artifact) => isDesignContextArtifact(artifact)),
    ...(spec.designContext?.designDefinition ? [spec.designContext.designDefinition] : []),
    ...(spec.designContext?.supportingArtifacts || []),
  ]);
}

export function resolveDesignContextHandoff(spec?: DesignContextSpecLike | null): DesignContextHandoff | undefined {
  if (!spec) {
    return undefined;
  }

  const summary = String(spec.stageSummaries?.design || spec.designContext?.summary || '').trim() || undefined;
  const persistedArtifacts = collectPersistedDesignArtifacts(spec);
  const designDefinition =
    persistedArtifacts.find((artifact) => isPrimaryDesignDefinitionReference(artifact)) || spec.designContext?.designDefinition;
  const supportingArtifacts = persistedArtifacts.filter((artifact) => artifact.path !== designDefinition?.path);

  if (!summary && !designDefinition && supportingArtifacts.length === 0) {
    return undefined;
  }

  return {
    summary,
    designDefinition,
    supportingArtifacts,
  };
}

export function hasPersistedDesignDefinition(
  spec?: Pick<WorkSpec, 'designDefinition' | 'sourceArtifacts'> | null,
): boolean {
  if (!spec) {
    return false;
  }

  if (isPrimaryDesignDefinitionReference(spec.designDefinition)) {
    return true;
  }

  return spec.sourceArtifacts.some((artifact) => isPrimaryDesignDefinitionReference(artifact));
}

export class DesignAgent extends BaseAgent {
  private readonly figmaEnabled: boolean;

  constructor(provider: LLMProvider, projectId: string, figmaEnabled = false) {
    super(provider, projectId);
    this.figmaEnabled = figmaEnabled;
  }

  get role(): AgentRole {
    return 'design';
  }

  get inputArtifacts(): string[] {
    return [...DESIGN_INPUT_ARTIFACTS];
  }

  get outputArtifacts(): string[] {
    return this.figmaEnabled
      ? [...DESIGN_OUTPUT_ARTIFACTS, DESIGN_FIGMA_ARTIFACT]
      : [...DESIGN_OUTPUT_ARTIFACTS];
  }

  get systemPrompt(): string {
    const figmaArtifactBlock = this.figmaEnabled ? `

ARTIFACT 2: Use the marker "--- FigmaLink.json ---" before this content.

Produce a JSON object describing the Figma structure to create:
{
  "pageName": "<Project> - Prototype",
  "frames": [
    {
      "name": "Screen Name",
      "description": "Brief description",
      "elements": ["element1", "element2"]
    }
  ]
}

Rules:
- Start with low-fidelity wireframe-level specs (not pixel-perfect)
- Use consistent spacing and basic accessible contrast
- Every screen in the IA must have a corresponding Screen Spec
- The FigmaLink.json frames must match the screens in the spec` : '';

    const artifactCount = this.figmaEnabled ? 'two artifacts' : 'one artifact';
    const artifactIntro = this.figmaEnabled
      ? 'ARTIFACT 1: Use the marker "--- PrototypeSpec.md ---" before this content.'
      : 'Use the marker "--- PrototypeSpec.md ---" before this content.';

    return `You are a Product Designer creating a prototype specification.

Given the project idea, PRD, and research plan, produce ${artifactCount}:

${artifactIntro}

Create a prototype spec with these exact markdown headings:

## Information Architecture
List all screens/pages and their hierarchy.

## Core Flows
Step-by-step flows showing how users move between screens. Reference screen names from the IA.

## Screen Specs
For each screen, create a sub-heading (###) and include:
- Purpose: what this screen does
- UI Elements: list all interactive and display elements
- States: default, loading, empty, error states
- Error handling: what happens when things go wrong

You MUST include at least 4 screens. For a Slack-based app, typical screens include:
- Slash command entry/response
- Theme options + voting
- Results + shopping list
- Admin edit list

## Microcopy
Draft text for all UI labels, buttons, messages, and notifications.

## Accessibility notes
Basic accessibility considerations (contrast, screen reader support, keyboard navigation).

## Open questions
List any design decisions that need user/stakeholder input.${figmaArtifactBlock}`;
  }
}
