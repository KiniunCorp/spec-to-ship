import type { ArtifactTemplate, QualityCheckResult, QualityReport } from '../types/index.js';
import { readArtifact, listArtifacts, writeArtifact } from '../artifacts/store.js';
import { ALL_TEMPLATES } from '../templates/index.js';

export function validateTemplate(content: string, template: ArtifactTemplate): QualityCheckResult {
  if (template.format === 'json') {
    try {
      JSON.parse(content);
      return { passed: true, score: 1, issues: [] };
    } catch {
      return { passed: false, score: 0, issues: ['Invalid JSON'] };
    }
  }

  const issues: string[] = [];
  const headingsFound: string[] = [];

  for (const heading of template.requiredHeadings) {
    // Match heading text in a markdown heading line (fuzzy: allows extra words around it)
    const headingPattern = new RegExp(`^#{1,4}\\s+.*${escapeRegex(heading)}`, 'im');
    // Fallback: also match as bold text or section label (e.g. **Non-goals:**)
    const boldPattern = new RegExp(`\\*\\*.*${escapeRegex(heading)}.*\\*\\*`, 'im');
    if (headingPattern.test(content) || boldPattern.test(content)) {
      headingsFound.push(heading);
    } else {
      issues.push(`Missing required heading: "${heading}"`);
    }
  }

  const score = template.requiredHeadings.length > 0
    ? headingsFound.length / template.requiredHeadings.length
    : 1;

  return {
    passed: issues.length === 0,
    score,
    issues,
  };
}

export function validatePRD(content: string): QualityCheckResult {
  const issues: string[] = [];

  // Check for acceptance criteria bullets
  const acSection = extractSection(content, 'Acceptance Criteria');
  if (!acSection) {
    issues.push('Missing Acceptance Criteria section');
  } else {
    const bullets = acSection.match(/^[\s]*[-*]\s+/gm);
    if (!bullets || bullets.length === 0) {
      issues.push('Acceptance Criteria section has no bullet points');
    }
  }

  return {
    passed: issues.length === 0,
    score: issues.length === 0 ? 1 : 0.5,
    issues,
  };
}

export function validatePrototypeSpec(content: string): QualityCheckResult {
  const issues: string[] = [];

  // Count screen specs (look for ### headings under Screen Specs, or numbered screens)
  const screenSection = extractSection(content, 'Screen Specs');
  if (!screenSection) {
    issues.push('Missing Screen Specs section');
  } else {
    const screenHeadings = screenSection.match(/^#{3,4}\s+/gm);
    if (!screenHeadings || screenHeadings.length < 4) {
      issues.push(`Found ${screenHeadings?.length ?? 0} screen specs, need at least 4`);
    }
  }

  return {
    passed: issues.length === 0,
    score: issues.length === 0 ? 1 : 0.5,
    issues,
  };
}

export function validateResearch(content: string): QualityCheckResult {
  const issues: string[] = [];

  const planSection = extractSection(content, 'Investigation Plan');
  if (!planSection) {
    issues.push('Missing Investigation Plan section');
  } else {
    const steps = planSection.match(/^[\s]*[-*\d.]\s+/gm);
    if (!steps || steps.length < 3) {
      issues.push(`Found ${steps?.length ?? 0} investigation steps, need at least 3`);
    }
  }

  const unknownsSection = extractSection(content, 'Unknowns and Hypotheses');
  if (!unknownsSection) {
    issues.push('Missing Unknowns and Hypotheses section');
  }

  return {
    passed: issues.length === 0,
    score: issues.length === 0 ? 1 : 0.5,
    issues,
  };
}

export function runQualityChecks(projectId: string): QualityReport {
  const artifacts = listArtifacts(projectId);
  const checks: Record<string, QualityCheckResult> = {};

  for (const filename of artifacts) {
    const template = ALL_TEMPLATES[filename];
    if (!template) continue;

    const content = readArtifact(projectId, filename);
    if (!content) continue;

    // Run template validation
    checks[filename] = validateTemplate(content, template);

    // Run specific validators
    if (filename === 'PRD.md') {
      const prdCheck = validatePRD(content);
      checks[filename] = mergeChecks(checks[filename], prdCheck);
    } else if (filename === 'PrototypeSpec.md') {
      const specCheck = validatePrototypeSpec(content);
      checks[filename] = mergeChecks(checks[filename], specCheck);
    } else if (filename === 'Research.md') {
      const researchCheck = validateResearch(content);
      checks[filename] = mergeChecks(checks[filename], researchCheck);
    }
  }

  const allChecks = Object.values(checks);
  const report: QualityReport = {
    projectId,
    timestamp: new Date().toISOString(),
    checks,
    overallPassed: allChecks.every((c) => c.passed),
    overallScore: allChecks.length > 0
      ? allChecks.reduce((sum, c) => sum + c.score, 0) / allChecks.length
      : 0,
  };

  writeArtifact(projectId, 'QualityReport.json', JSON.stringify(report, null, 2));
  return report;
}

// ── Helpers ──

function extractSection(content: string, heading: string): string | null {
  // Find the heading line (fuzzy match — heading text can appear anywhere in the line)
  const headingPattern = new RegExp(
    `^(#{1,4})\\s+.*${escapeRegex(heading)}[^\\n]*\\n`,
    'im'
  );
  const headingMatch = headingPattern.exec(content);
  if (!headingMatch) return null;

  const headingLevel = headingMatch[1].length;
  const startIdx = headingMatch.index + headingMatch[0].length;

  // Find the next heading at the same or higher level
  const nextHeadingPattern = new RegExp(
    `^#{1,${headingLevel}}\\s+(?!#)`,
    'gm'
  );
  nextHeadingPattern.lastIndex = startIdx;
  const nextMatch = nextHeadingPattern.exec(content);

  const endIdx = nextMatch ? nextMatch.index : content.length;
  return content.slice(startIdx, endIdx).trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeChecks(a: QualityCheckResult, b: QualityCheckResult): QualityCheckResult {
  return {
    passed: a.passed && b.passed,
    score: (a.score + b.score) / 2,
    issues: [...a.issues, ...b.issues],
  };
}
