// Migrates docs/*_en.md and docs/*_es.md into website/src/content/docs/{en,es}/
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', '..');
const src = join(root, 'docs');
const destEn = join(__dir, '..', 'src', 'content', 'docs', 'en');
const destEs = join(__dir, '..', 'src', 'content', 'docs', 'es');

// slug → { en: sourceFile, es: sourceFile, title_en, title_es }
const mapping = [
  { slug: 'introduction',               en: 'user-summary_en.md',                   es: 'user-summary_es.md' },
  { slug: 'quickstart',                 en: 'user-manual_en.md',                    es: 'user-manual_es.md' },
  { slug: 'manual-setup',               en: 'manual-setup_en.md',                   es: 'manual-setup_es.md' },
  { slug: 'chat-native-workflow',       en: 'chat-native-workflow_en.md',            es: 'chat-native-workflow_es.md' },
  { slug: 'execution-templates',        en: 'execution-templates_en.md',             es: 'execution-templates_es.md' },
  { slug: 'llm-access-modes',           en: 'llm-access-modes_en.md',               es: 'llm-access-modes_es.md' },
  { slug: 'technical-architecture',     en: 'technical-architecture_en.md',         es: 'technical-architecture_es.md' },
  { slug: 'tech-architecture-summary',  en: 'tech-architecture-summary_en.md',      es: 'tech-architecture-summary_es.md' },
  { slug: 'technical-operations-security', en: 'technical-operations-security_en.md', es: 'technical-operations-security_es.md' },
  { slug: 'live-state',                 en: 'live-state_en.md',                     es: 'live-state_es.md' },
  { slug: 'cost-observability',         en: 'cost-observability_en.md',             es: 'cost-observability_es.md' },
  { slug: 'token-efficiency',           en: 'token-efficiency_en.md',               es: 'token-efficiency_es.md' },
  { slug: 'backup-and-restore',         en: 'backup-and-restore_en.md',             es: 'backup-and-restore_es.md' },
  { slug: 'figma-mcp-setup',            en: 'figma-mcp-setup_en.md',               es: 'figma-mcp-setup_es.md' },
  { slug: 'homebrew-distribution',      en: 'homebrew-distribution_en.md',         es: 'homebrew-distribution_es.md' },
  { slug: 'versioning-and-migrations',  en: 'versioning-and-migrations_en.md',     es: 'versioning-and-migrations_es.md' },
];

function extractTitleAndBody(raw) {
  const lines = raw.split('\n');
  let title = '';
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!title && trimmed.startsWith('# ')) {
      title = trimmed.replace(/^#\s+/, '').trim();
      bodyStart = i + 1;
      break;
    }
  }

  // Skip blank lines after the H1
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;

  const body = lines.slice(bodyStart).join('\n').trimEnd();
  return { title, body };
}

function extractDescription(body) {
  // First non-empty, non-heading line — truncated to 160 chars
  const lines = body.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('---') && !t.startsWith('>')) {
      // Strip markdown links and inline code for cleaner description
      const clean = t
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
        .replace(/\*\*/g, '')
        .slice(0, 160);
      return clean.endsWith('.') ? clean : clean + (clean.length === 160 ? '...' : '');
    }
  }
  return '';
}

function buildPage(title, description, body) {
  const fm = [
    '---',
    `title: "${title.replace(/"/g, "'")}"`,
    description ? `description: "${description.replace(/"/g, "'")}"` : null,
    '---',
  ].filter(Boolean).join('\n');

  return `${fm}\n\n${body}\n`;
}

function migrate(sourceFile, dest, slug) {
  const srcPath = join(src, sourceFile);
  let raw;
  try {
    raw = readFileSync(srcPath, 'utf8');
  } catch {
    console.warn(`  SKIP (not found): ${sourceFile}`);
    return;
  }

  const { title, body } = extractTitleAndBody(raw);
  const description = extractDescription(body);
  const page = buildPage(title || slug, description, body);

  writeFileSync(join(dest, `${slug}.md`), page, 'utf8');
  console.log(`  ✓  ${sourceFile} → ${slug}.md  (title: "${title}")`);
}

console.log('\nMigrating EN docs...');
for (const { slug, en } of mapping) migrate(en, destEn, slug);

console.log('\nMigrating ES docs...');
for (const { slug, es } of mapping) migrate(es, destEs, slug);

console.log('\nDone.\n');
