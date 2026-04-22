import type { ArtifactTemplate } from '../types/index.js';

export const PRD_TEMPLATE: ArtifactTemplate = {
  filename: 'PRD.md',
  requiredHeadings: [
    'Problem',
    'Users & JTBD',
    'MVP Scope',
    'Non-goals',
    'Key Flows',
    'Success Metrics',
    'Risks & Mitigations',
    'Acceptance Criteria',
  ],
  format: 'markdown',
};

export const RESEARCH_TEMPLATE: ArtifactTemplate = {
  filename: 'Research.md',
  requiredHeadings: [
    'Investigation Goal',
    'Current Technical Context',
    'Unknowns and Hypotheses',
    'Investigation Plan',
    'Risks and Constraints',
    'Recommendation',
  ],
  format: 'markdown',
};

export const PROTOTYPE_SPEC_TEMPLATE: ArtifactTemplate = {
  filename: 'PrototypeSpec.md',
  requiredHeadings: [
    'Information Architecture',
    'Core Flows',
    'Screen Specs',
    'Microcopy',
    'Accessibility notes',
    'Open questions',
  ],
  format: 'markdown',
};

export const TECH_SPEC_TEMPLATE: ArtifactTemplate = {
  filename: 'TechSpec.md',
  requiredHeadings: [
    'Architecture Overview',
    'Data Model',
    'API / Integration points',
    'Risk & Security Notes',
    'Implementation Plan',
    'Test Plan',
  ],
  format: 'markdown',
};

export const ITERATION_LOG_TEMPLATE: ArtifactTemplate = {
  filename: 'IterationLog.md',
  requiredHeadings: [],
  format: 'markdown',
};

export const ALL_TEMPLATES: Record<string, ArtifactTemplate> = {
  'PRD.md': PRD_TEMPLATE,
  'Research.md': RESEARCH_TEMPLATE,
  'PrototypeSpec.md': PROTOTYPE_SPEC_TEMPLATE,
  'TechSpec.md': TECH_SPEC_TEMPLATE,
  'IterationLog.md': ITERATION_LOG_TEMPLATE,
};

export function getTemplate(filename: string): ArtifactTemplate | undefined {
  return ALL_TEMPLATES[filename];
}
