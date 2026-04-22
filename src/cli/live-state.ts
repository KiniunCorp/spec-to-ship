import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LiveState } from '../types/index.js';

export function writeLiveState(s2sDir: string, state: LiveState): void {
  const filePath = path.join(s2sDir, 'live.md');
  writeFileSync(filePath, renderLiveState(state), 'utf8');
}

export function readLiveState(s2sDir: string): LiveState | null {
  const filePath = path.join(s2sDir, 'live.md');
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    return parseLiveState(raw);
  } catch {
    return null;
  }
}

export function renderLiveState(state: LiveState): string {
  const lines: string[] = [
    '# S2S Live State',
    `Updated: ${state.updatedAt}`,
    '',
  ];

  lines.push('## Active Work');
  if (state.project) lines.push(`Project: ${state.project}`);
  if (state.feature) lines.push(`Feature: ${state.feature}`);
  if (state.intent) lines.push(`Intent: ${state.intent}`);
  if (state.route && state.route.length > 0) {
    lines.push(`Route: ${state.route.join(' → ')}`);
  }
  lines.push('');

  lines.push('## Current Position');
  if (state.stage) lines.push(`Stage: ${state.stage}`);
  lines.push(`Status: ${state.status}`);
  if (state.nextAction) lines.push(`Next action: ${state.nextAction}`);
  lines.push('');

  if (state.artifacts && Object.keys(state.artifacts).length > 0) {
    lines.push('## Artifacts');
    for (const [file, artifactStatus] of Object.entries(state.artifacts)) {
      lines.push(`- ${file}: ${artifactStatus}`);
    }
    lines.push('');
  }

  lines.push('## Blockers');
  if (state.blockers && state.blockers.length > 0) {
    for (const blocker of state.blockers) {
      lines.push(`- ${blocker}`);
    }
  } else {
    lines.push('none');
  }

  return lines.join('\n') + '\n';
}

function parseLiveState(raw: string): LiveState | null {
  const updatedMatch = raw.match(/^Updated:\s*(.+)$/m);
  if (!updatedMatch) return null;
  const updatedAt = updatedMatch[1].trim();

  const statusMatch = raw.match(/^Status:\s*(.+)$/m);
  if (!statusMatch) return null;
  const status = statusMatch[1].trim() as LiveState['status'];

  const projectMatch = raw.match(/^Project:\s*(.+)$/m);
  const featureMatch = raw.match(/^Feature:\s*(.+)$/m);
  const intentMatch = raw.match(/^Intent:\s*(.+)$/m);
  const routeMatch = raw.match(/^Route:\s*(.+)$/m);
  const stageMatch = raw.match(/^Stage:\s*(.+)$/m);
  const nextActionMatch = raw.match(/^Next action:\s*(.+)$/m);

  return {
    updatedAt,
    status,
    project: projectMatch ? projectMatch[1].trim() : undefined,
    feature: featureMatch ? featureMatch[1].trim() : undefined,
    intent: intentMatch ? intentMatch[1].trim() : undefined,
    route: routeMatch ? routeMatch[1].trim().split(/\s*→\s*/) : undefined,
    stage: stageMatch ? stageMatch[1].trim() : undefined,
    nextAction: nextActionMatch ? nextActionMatch[1].trim() : undefined,
  };
}
