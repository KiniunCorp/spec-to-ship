import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeFileIfChanged(filePath: string, content: string): void {
  const next = content.endsWith('\n') ? content : `${content}\n`;
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  if (previous === next) return;
  writeFileSync(filePath, next, 'utf8');
}

export function fileHasMarker(filePath: string, marker: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf8');
  return content.includes(marker);
}

export function fileHasText(filePath: string, text: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf8');
  return content.includes(text);
}

export function normalizeAlias(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'project';
}
