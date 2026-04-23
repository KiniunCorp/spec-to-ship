import { SliceDerivationBacklogColumns, SliceDerivationTechSpecHeadings, type AgentRole, type LLMProvider } from '../types/index.js';
import { BaseAgent } from './base.js';

export class EngineeringAgent extends BaseAgent {
  constructor(provider: LLMProvider, projectId: string) {
    super(provider, projectId);
  }

  get role(): AgentRole {
    return 'engineering';
  }

  get inputArtifacts(): string[] {
    return ['idea.json', 'PRD.md', 'Research.md', 'PrototypeSpec.md'];
  }

  get outputArtifacts(): string[] {
    return ['TechSpec.md', 'Backlog.md'];
  }

  get systemPrompt(): string {
    const techSpecHeadings = SliceDerivationTechSpecHeadings.map((heading) => `## ${heading}`).join('\n');
    const backlogHeader = `| ${SliceDerivationBacklogColumns.join(' | ')} |`;
    const backlogDivider = `| ${SliceDerivationBacklogColumns.map(() => '---').join(' | ')} |`;

    return `You are a Senior Engineer creating a technical specification and backlog.

Given the project artifacts, produce two outputs:

ARTIFACT 1: Use the marker "--- TechSpec.md ---" before this content.

Create a tech spec with these exact markdown headings and no extra top-level headings:

${techSpecHeadings}

Content requirements:
- Architecture Overview: high-level system architecture. Prefer the simplest viable approach. Diagram with text if helpful.
- Data Model: define the core data entities and their relationships. Keep it minimal.
- API / Integration points: list all external APIs, webhooks, or integrations needed. Include authentication requirements.
- Risk & Security Notes: security considerations, rate limits, data handling, and potential failure modes.
- Implementation Plan: provide a sequenced list of implementation steps ordered by dependency and risk, and reference backlog IDs when relevant.
- Test Plan: describe what to test and how, focusing on integration tests for key flows over unit tests for utilities, and map concrete checks back to backlog IDs when possible.

ARTIFACT 2: Use the marker "--- Backlog.md ---" before this content.

Create a prioritized backlog as a markdown table with these exact columns:

${backlogHeader}
${backlogDivider}

Rules:
- Pick the simplest stack that works (e.g., Slack Bolt for Node, or Python Slack SDK)
- Do NOT over-engineer — this is an MVP
- Sequence work so the riskiest/most uncertain items come first
- Each backlog item should be completable in 1-2 days max
- Include setup/infra tasks (repo, CI, deploy) in the backlog
- Include a delivery policy task: before push, verify if branch has closed/merged PR; if true, use a new branch + new PR
- Use backlog IDs in the format ENG-001, ENG-002, ...
- Dependencies must reference backlog IDs, comma-separated, or use "none"
- Acceptance Criteria must be a semicolon-separated list of concrete checks
- Allowed Paths and Out of Scope must use repo-relative paths or globs, comma-separated, or use "none"
- Keep the backlog human-readable, but make every row deterministic enough for later slice derivation`;
  }
}
