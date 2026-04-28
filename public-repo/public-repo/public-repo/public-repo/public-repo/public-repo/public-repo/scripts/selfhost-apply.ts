import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Target = {
  filePath: string;
  templatePath: string;
  startMarker: string;
  endMarker: string;
};

type MarkerPair = {
  start: string;
  end: string;
};

const ROOT = process.cwd();
const TEMPLATE_ROOT = path.join(ROOT, 'internal', 'self-host', 'templates');
const START = '<!-- S2S_INTERNAL_GOVERNANCE_START -->';
const END = '<!-- S2S_INTERNAL_GOVERNANCE_END -->';
const RUNTIME_MARKER_PAIRS_BY_FILE: Record<string, MarkerPair[]> = {
  'AGENTS.md': [
    {
      start: '<!-- S2S_PROJECT_GUARDRAIL_START -->',
      end: '<!-- S2S_PROJECT_GUARDRAIL_END -->',
    },
  ],
  'CODEX.md': [
    {
      start: '<!-- S2S_CODEX_ADAPTER_START -->',
      end: '<!-- S2S_CODEX_ADAPTER_END -->',
    },
  ],
  'CLAUDE.md': [
    {
      start: '<!-- S2S_CLAUDE_ADAPTER_START -->',
      end: '<!-- S2S_CLAUDE_ADAPTER_END -->',
    },
  ],
};

const TARGETS: Target[] = [
  {
    filePath: path.join(ROOT, 'AGENTS.md'),
    templatePath: path.join(TEMPLATE_ROOT, 'agents_governance_template.md'),
    startMarker: START,
    endMarker: END,
  },
  {
    filePath: path.join(ROOT, 'CODEX.md'),
    templatePath: path.join(TEMPLATE_ROOT, 'codex_governance_template.md'),
    startMarker: START,
    endMarker: END,
  },
  {
    filePath: path.join(ROOT, 'CLAUDE.md'),
    templatePath: path.join(TEMPLATE_ROOT, 'claude_governance_template.md'),
    startMarker: START,
    endMarker: END,
  },
  {
    filePath: path.join(ROOT, 'OPENCODE.md'),
    templatePath: path.join(TEMPLATE_ROOT, 'opencode_governance_template.md'),
    startMarker: START,
    endMarker: END,
  },
];

function main(): void {
  const pkgPath = path.join(ROOT, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error('package.json not found in current path. Run from repo root.');
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
  if (pkg.name !== 'spec-to-ship') {
    throw new Error(`Unexpected package name '${pkg.name || ''}'. Refusing to apply internal governance.`);
  }

  let updated = 0;
  for (const target of TARGETS) {
    const status = upsertManagedBlock(target);
    if (status !== 'unchanged') updated += 1;
    console.log(`${path.basename(target.filePath)}: ${status}`);
  }

  console.log(`Internal governance apply completed. Updated files: ${updated}/${TARGETS.length}`);
}

function upsertManagedBlock(target: Target): 'created' | 'updated' | 'unchanged' {
  ensureParent(target.filePath);
  const template = readFileSync(target.templatePath, 'utf8').trim();
  const block = `${target.startMarker}\n${template}\n${target.endMarker}`;

  const previous = existsSync(target.filePath) ? readFileSync(target.filePath, 'utf8') : '';
  if (!previous.trim()) {
    writeFileSync(target.filePath, `${block}\n`, 'utf8');
    return 'created';
  }

  const start = previous.indexOf(target.startMarker);
  const end = previous.indexOf(target.endMarker);

  let next: string;
  if (start >= 0 && end > start) {
    const after = end + target.endMarker.length;
    next = `${previous.slice(0, start)}${block}${previous.slice(after)}`.replace(/\n{3,}/g, '\n\n');
  } else {
    const spacer = previous.endsWith('\n') ? '\n' : '\n\n';
    next = `${previous}${spacer}${block}\n`;
  }
  next = stripRuntimeManagedBlocks(target.filePath, next);

  if (next === previous) return 'unchanged';
  writeFileSync(target.filePath, next, 'utf8');
  return start >= 0 && end > start ? 'updated' : 'created';
}

function stripRuntimeManagedBlocks(filePath: string, content: string): string {
  const markerPairs = RUNTIME_MARKER_PAIRS_BY_FILE[path.basename(filePath)] || [];
  let next = content;
  for (const pair of markerPairs) {
    next = removeMarkerPair(next, pair.start, pair.end);
  }
  return next.replace(/\n{3,}/g, '\n\n');
}

function removeMarkerPair(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  if (start < 0) return content;
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return content;
  const after = end + endMarker.length;
  return `${content.slice(0, start)}${content.slice(after)}`;
}

function ensureParent(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

main();
