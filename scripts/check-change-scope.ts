import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');

function main(): void {
  const version = readPackageVersion();
  const changelog = readFileSync(changelogPath, 'utf8');
  const section = extractVersionSection(changelog, version);

  if (!section) {
    fail(`CHANGELOG.md is missing the section for version ${version}.`);
  }

  const requiredHeadings = ['### Product Changes', '### Repo Governance Changes'];
  const missing = requiredHeadings.filter((heading) => !section.includes(heading));
  if (missing.length > 0) {
    fail(`CHANGELOG.md version ${version} must include these headings: ${missing.join(', ')}.`);
  }

  for (const heading of requiredHeadings) {
    const body = extractHeadingBody(section, heading);
    if (!body || !/-\s+/.test(body)) {
      fail(`CHANGELOG.md version ${version} heading '${heading}' must include at least one bullet. Use '- None.' when not applicable.`);
    }
  }

  console.log(`Change scope policy passed for CHANGELOG.md version ${version}.`);
}

function readPackageVersion(): string {
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
  return String(parsed.version || '').trim();
}

function extractVersionSection(content: string, version: string): string {
  const lines = content.split('\n');
  const target = `## ${version}`;
  const start = lines.findIndex((line) => line.trim() === target);
  if (start < 0) return '';

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

function extractHeadingBody(section: string, heading: string): string {
  const lines = section.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return '';

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('### ')) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join('\n').trim();
}

function fail(message: string): never {
  console.error(`Change scope policy failed:\n\n- ${message}`);
  process.exit(1);
}

main();
