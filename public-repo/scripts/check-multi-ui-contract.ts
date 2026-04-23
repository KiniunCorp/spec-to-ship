import { readFileSync } from 'node:fs';
import path from 'node:path';

type ExecutionTemplate = {
  id: string;
  provider: string;
};

const ROOT = process.cwd();

const requiredTemplateIds = [
  'codex_strict',
  'codex_fast',
  'claude_strict',
  'claude_fast',
  'opencode_strict',
  'opencode_fast',
];

const requiredProviderPairs: Array<{ id: string; provider: string }> = [
  { id: 'codex_strict', provider: 'codex' },
  { id: 'codex_fast', provider: 'codex' },
  { id: 'claude_strict', provider: 'claude' },
  { id: 'claude_fast', provider: 'claude' },
  { id: 'opencode_strict', provider: 'opencode' },
  { id: 'opencode_fast', provider: 'opencode' },
];

const requiredCanonMentions = ['Claude Code', 'Codex', 'OpenCode'];

const adapterChecks: Array<{ file: string; mustContain: string[] }> = [
  {
    file: 'CLAUDE.md',
    mustContain: ['AGENTS.md', 'Claude'],
  },
  {
    file: 'CODEX.md',
    mustContain: ['AGENTS.md', 'Codex'],
  },
  {
    file: 'OPENCODE.md',
    mustContain: ['AGENTS.md', 'OpenCode'],
  },
];

const forbiddenCodexPrefixFiles = [
  'src/runtime/github-operator.ts',
  'src/runtime/engineering-exec.ts',
  'src/runtime/app-scaffold.ts',
  'src/cli.ts',
  'README.md',
  'README_es.md',
  'AGENTS.md',
];

const failures: string[] = [];

function read(relativePath: string): string {
  const absolutePath = path.join(ROOT, relativePath);
  return readFileSync(absolutePath, 'utf8');
}

function checkExecutionTemplates(): void {
  let templates: ExecutionTemplate[] = [];
  try {
    templates = JSON.parse(read('config/execution.templates.json')) as ExecutionTemplate[];
  } catch (error) {
    failures.push(`config/execution.templates.json is not valid JSON: ${String(error)}`);
    return;
  }

  const ids = new Set(templates.map((template) => template.id));
  for (const id of requiredTemplateIds) {
    if (!ids.has(id)) failures.push(`missing execution template: ${id}`);
  }

  for (const pair of requiredProviderPairs) {
    const template = templates.find((item) => item.id === pair.id);
    if (!template) continue;
    if (template.provider !== pair.provider) {
      failures.push(`template ${pair.id} must use provider '${pair.provider}' (found '${template.provider || ''}')`);
    }
  }
}

function checkCanonicalAndAdapters(): void {
  const canonical = read('AGENTS.md');
  for (const mention of requiredCanonMentions) {
    if (!canonical.includes(mention)) {
      failures.push(`AGENTS.md must mention '${mention}' in supported conversational UIs`);
    }
  }

  for (const check of adapterChecks) {
    const content = read(check.file);
    for (const value of check.mustContain) {
      if (!content.includes(value)) {
        failures.push(`${check.file} must contain '${value}'`);
      }
    }
  }
}

function checkForbiddenHardcode(): void {
  const regex = /codex\/<change-id>|codex\/\$\{change_id\}|`codex\//g;
  for (const file of forbiddenCodexPrefixFiles) {
    const content = read(file);
    if (regex.test(content)) {
      failures.push(`${file} contains deprecated codex branch hardcode`);
    }
  }
}

function checkGuardrailPolicyContract(): void {
  const runtime = JSON.parse(read('config/runtime.json')) as { guardrailPolicy?: string };
  if (!runtime.guardrailPolicy) {
    failures.push('config/runtime.json must define guardrailPolicy');
  } else if (!['strict', 'warn', 'prompt'].includes(runtime.guardrailPolicy)) {
    failures.push(`config/runtime.json guardrailPolicy must be strict|warn|prompt (found '${runtime.guardrailPolicy}')`);
  }

  const cliContent = read('src/cli.ts');
  if (!cliContent.includes('guardrailPolicy')) {
    failures.push('src/cli.ts must include guardrailPolicy handling');
  }
}

function main(): void {
  checkExecutionTemplates();
  checkCanonicalAndAdapters();
  checkForbiddenHardcode();
  checkGuardrailPolicyContract();

  if (failures.length > 0) {
    console.error('Multi-UI contract check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Multi-UI contract check passed.');
}

main();
