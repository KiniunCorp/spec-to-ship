import path from 'node:path';
import type {
  OutputRendererArtifactNode,
  OutputRendererMetadataItem,
  OutputRendererPhaseStep,
  OutputRendererState,
  OutputRendererStatusItem,
} from '../types/index.js';

export function renderSummaryBlock(title: string, summary: string, metadata: OutputRendererMetadataItem[] = []): string {
  const lines = [renderBlockTitle(title), `Summary: ${summary}`];
  for (const item of metadata) {
    lines.push(`- ${item.label}: ${item.value}`);
  }
  return lines.join('\n');
}

export function renderStatusBlock(
  title: string,
  items: OutputRendererStatusItem[],
  emptyText = 'No status items to show.',
): string {
  const lines = [renderBlockTitle(title)];
  if (items.length === 0) {
    lines.push(emptyText);
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(renderStatusLine(item));
    if (item.detail) {
      lines.push(`  ${item.detail}`);
    }
    if (item.remediation) {
      lines.push(`  fix: ${item.remediation}`);
    }
  }

  return lines.join('\n');
}

export function renderWarningsBlock(title: string, warnings: string[], emptyText = 'No warnings.'): string {
  const lines = [renderBlockTitle(title)];
  if (warnings.length === 0) {
    lines.push(emptyText);
    return lines.join('\n');
  }
  for (const warning of warnings) {
    lines.push(`- ${warning}`);
  }
  return lines.join('\n');
}

export function renderNextActionsBlock(title: string, actions: string[], emptyText = 'No next actions.'): string {
  const lines = [renderBlockTitle(title)];
  if (actions.length === 0) {
    lines.push(emptyText);
    return lines.join('\n');
  }
  for (const action of actions) {
    lines.push(`- ${action}`);
  }
  return lines.join('\n');
}

export function renderPhaseProgressBlock(
  title: string,
  steps: OutputRendererPhaseStep[],
  emptyText = 'No phase progress available.',
): string {
  const lines = [renderBlockTitle(title)];
  if (steps.length === 0) {
    lines.push(emptyText);
    return lines.join('\n');
  }

  for (const step of steps) {
    const marker = step.state === 'done' ? '[x]' : step.state === 'current' ? '[>]' : '[ ]';
    const detail = step.detail ? `: ${step.detail}` : '';
    lines.push(`${marker} ${step.label}${detail}`);
  }

  return lines.join('\n');
}

export function renderDoctorCheckMatrix(
  title: string,
  checks: OutputRendererStatusItem[],
  emptyText = 'No doctor checks to show.',
): string {
  return renderStatusBlock(title, checks, emptyText);
}

export function renderArtifactTree(
  title: string,
  nodes: OutputRendererArtifactNode[],
  options: { rootLabel?: string; emptyText?: string } = {},
): string {
  const lines = [renderBlockTitle(title)];
  const emptyText = options.emptyText || 'No artifacts recorded yet.';
  if (nodes.length === 0) {
    lines.push(emptyText);
    return lines.join('\n');
  }

  if (options.rootLabel) {
    lines.push(options.rootLabel);
    lines.push(...renderTreeLines(nodes));
    return lines.join('\n');
  }

  lines.push(...renderTreeLines(nodes));
  return lines.join('\n');
}

export function buildArtifactTreeFromPaths(paths: string[]): OutputRendererArtifactNode[] {
  const root: OutputRendererArtifactNode[] = [];

  for (const rawPath of paths) {
    const normalized = String(rawPath || '').trim().replace(/\\/g, '/');
    if (!normalized) continue;

    const segments = normalized
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) continue;

    let level = root;
    for (const segment of segments) {
      let next = level.find((node) => node.label === segment);
      if (!next) {
        next = { label: segment, children: [] };
        level.push(next);
      }
      next.children ||= [];
      level = next.children;
    }
  }

  sortArtifactNodes(root);
  trimEmptyChildren(root);
  return root;
}

export function buildArtifactTreeFromLabels(labels: string[]): OutputRendererArtifactNode[] {
  return buildArtifactTreeFromPaths(labels.map((label) => path.normalize(label)));
}

export function renderBlocks(blocks: Array<string | undefined | null | false>): string {
  return blocks
    .filter((block): block is string => typeof block === 'string' && block.trim().length > 0)
    .join('\n\n');
}

function renderBlockTitle(title: string): string {
  return `== ${title} ==`;
}

function renderStatusLine(item: OutputRendererStatusItem): string {
  const prefix = renderStatePrefix(item.state || 'info');
  if (item.value) {
    return `- ${prefix} ${item.label}: ${item.value}`;
  }
  return `- ${prefix} ${item.label}`;
}

function renderStatePrefix(state: OutputRendererState): string {
  switch (state) {
    case 'ok':
      return '[OK]';
    case 'warn':
      return '[WARN]';
    case 'fail':
      return '[FAIL]';
    default:
      return '[INFO]';
  }
}

function renderTreeLines(nodes: OutputRendererArtifactNode[], prefix = ''): string[] {
  const lines: string[] = [];
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    lines.push(`${prefix}${isLast ? "'- " : "|- "}${node.label}`);
    if (node.children && node.children.length > 0) {
      lines.push(...renderTreeLines(node.children, `${prefix}${isLast ? '   ' : '|  '}`));
    }
  });
  return lines;
}

function sortArtifactNodes(nodes: OutputRendererArtifactNode[]): void {
  nodes.sort((a, b) => a.label.localeCompare(b.label));
  for (const node of nodes) {
    if (node.children) {
      sortArtifactNodes(node.children);
    }
  }
}

function trimEmptyChildren(nodes: OutputRendererArtifactNode[]): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      trimEmptyChildren(node.children);
      continue;
    }
    delete node.children;
  }
}
