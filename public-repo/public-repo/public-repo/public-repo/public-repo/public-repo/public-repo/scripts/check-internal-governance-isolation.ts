import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const failures: string[] = [];

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function walkFiles(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const rel = path.relative(ROOT, abs);
    const st = statSync(abs);
    if (st.isDirectory()) {
      output.push(...walkFiles(abs));
    } else {
      output.push(rel);
    }
  }
  return output;
}

function checkGitignore(): void {
  const content = read('.gitignore');
  if (!content.includes('.s2s/')) {
    failures.push('.gitignore must include .s2s/');
  }
}

function checkNoLocalRuntimeStateInRepoRoot(): void {
  if (existsSync(path.join(ROOT, '.s2s'))) {
    failures.push('repo root must not contain .s2s/; this repository must not self-host its own runtime state');
  }
}

function checkPackageWhitelist(): void {
  const pkg = JSON.parse(read('package.json')) as { files?: string[] };
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  if (files.length === 0) {
    failures.push('package.json must define files whitelist');
    return;
  }
  if (!files.includes('dist')) {
    failures.push('package.json files whitelist must include dist');
  }
  for (const forbidden of ['internal', '.s2s', 'scripts', 'src']) {
    if (files.some((entry) => entry === forbidden || entry.startsWith(`${forbidden}/`))) {
      failures.push(`package.json files whitelist must not include ${forbidden}`);
    }
  }
}

function checkInternalAssetsExist(): void {
  const required = [
    'internal/self-host/governance-boundary_en.md',
    'internal/self-host/governance-boundary_es.md',
    'internal/self-host/templates/agents_governance_template.md',
    'internal/self-host/templates/codex_governance_template.md',
    'internal/self-host/templates/claude_governance_template.md',
    'internal/self-host/templates/opencode_governance_template.md',
  ];
  for (const file of required) {
    if (!existsSync(path.join(ROOT, file))) failures.push(`missing internal asset: ${file}`);
  }
}

function checkInternalMarkersInRootAdapters(): void {
  const markerStart = '<!-- S2S_INTERNAL_GOVERNANCE_START -->';
  const markerEnd = '<!-- S2S_INTERNAL_GOVERNANCE_END -->';
  for (const file of ['AGENTS.md', 'CODEX.md', 'CLAUDE.md', 'OPENCODE.md']) {
    const content = read(file);
    if (!content.includes(markerStart) || !content.includes(markerEnd)) {
      failures.push(`${file} must include internal governance managed block markers`);
    }
  }
}

function checkNoRuntimeManagedMarkersInRootAdapters(): void {
  const runtimeMarkers = [
    '<!-- S2S_PROJECT_GUARDRAIL_START -->',
    '<!-- S2S_PROJECT_GUARDRAIL_END -->',
    '<!-- S2S_CODEX_ADAPTER_START -->',
    '<!-- S2S_CODEX_ADAPTER_END -->',
    '<!-- S2S_CLAUDE_ADAPTER_START -->',
    '<!-- S2S_CLAUDE_ADAPTER_END -->',
  ];
  for (const file of ['AGENTS.md', 'CODEX.md', 'CLAUDE.md', 'OPENCODE.md']) {
    const content = read(file);
    for (const marker of runtimeMarkers) {
      if (content.includes(marker)) {
        failures.push(`${file} must not include runtime-managed marker ${marker}`);
      }
    }
  }
}

function checkRootAdaptersStayInSourceRepoMode(): void {
  const forbiddenPhrases = [
    'Run `s2s` from the target app repository root.',
    'On the first message of a new chat/workspace, run:',
    'This repository is configured with s2s.',
    'This project is governed by s2s.',
    'Session bootstrap (required on first response):',
    'First response requirements for top-level human chat sessions:',
  ];
  for (const file of ['AGENTS.md', 'CODEX.md', 'CLAUDE.md', 'OPENCODE.md']) {
    const content = read(file);
    for (const phrase of forbiddenPhrases) {
      if (content.includes(phrase)) {
        failures.push(`${file} must stay in source-repo mode and must not include runtime/user-project instruction: ${phrase}`);
      }
    }
  }
}

function checkDocsMapBoundary(): void {
  for (const file of ['docs/documentation-map_en.md', 'docs/documentation-map_es.md']) {
    const content = read(file);
    if (content.includes('../internal/')) {
      failures.push(`${file} must not link internal docs`);
    }
  }
}

function checkNoInternalImportsFromProduct(): void {
  for (const rel of walkFiles(path.join(ROOT, 'src')).filter((f) => f.endsWith('.ts'))) {
    const content = read(rel);
    if (content.includes('internal/self-host')) {
      failures.push(`product source must not import/use internal self-host path: ${rel}`);
    }
  }
}

checkGitignore();
checkNoLocalRuntimeStateInRepoRoot();
checkPackageWhitelist();
checkInternalAssetsExist();
checkInternalMarkersInRootAdapters();
checkNoRuntimeManagedMarkersInRootAdapters();
checkRootAdaptersStayInSourceRepoMode();
checkDocsMapBoundary();
checkNoInternalImportsFromProduct();

if (failures.length > 0) {
  console.error('Internal governance isolation check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Internal governance isolation check passed.');
