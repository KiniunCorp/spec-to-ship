import type { AgentRole, LLMProvider } from '../types/index.js';
import { BaseAgent } from './base.js';

export class PMAgent extends BaseAgent {
  constructor(provider: LLMProvider, projectId: string) {
    super(provider, projectId);
  }

  get role(): AgentRole {
    return 'pm';
  }

  get inputArtifacts(): string[] {
    return ['idea.json'];
  }

  get outputArtifacts(): string[] {
    return ['PRD.md'];
  }

  get systemPrompt(): string {
    return `You are a senior Product Manager creating a Product Requirements Document (PRD).

Given the project idea, produce a concise PRD (under ~2 pages) with the following sections. Use markdown headings exactly as shown:

## Problem
Describe the core problem being solved. Be specific and user-centric.

## Users & JTBD
Who are the target users? What jobs are they trying to get done?

## MVP Scope
What's in scope for the minimum viable product? Be ruthlessly minimal.

## Non-goals
What are we explicitly NOT doing?

## Key Flows
Describe the primary user flows step by step.

## Success Metrics
How will we measure if this is working? Use specific, measurable criteria.

## Risks & Mitigations
What could go wrong? How do we reduce those risks?

## Acceptance Criteria
Testable bullet points (use - prefix) that define "done" for the MVP. Each criterion must be verifiable.

Rules:
- Keep it concise — under 2 pages
- Every acceptance criterion must be testable (someone could write a pass/fail check)
- Focus on user outcomes, not implementation details
- Be specific enough that an engineer could build from this`;
  }
}
