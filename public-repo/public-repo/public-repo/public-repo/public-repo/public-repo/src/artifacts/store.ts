import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { WorkEntityKind, WorkEntityRecord } from '../types/index.js';

const ARTIFACTS_ROOT = resolve(process.cwd(), '.s2s', 'artifacts');
const OPERATIONAL_ENTITY_DIRS: Record<Exclude<WorkEntityKind, 'ledger'>, string> = {
  change: 'changes',
  spec: 'specs',
  slice: 'slices',
  run: 'runs',
  gate: 'gates',
};
const LEDGER_ARTIFACT_FILE = 'ledger.json';

function projectDir(projectId: string): string {
  return join(ARTIFACTS_ROOT, projectId);
}

function normalizeArtifactSegments(pathSegments: string[]): string[] {
  const normalized = pathSegments
    .flatMap((segment) => String(segment || '').split(/[\\/]+/))
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new Error('Artifact path must include at least one non-empty segment.');
  }

  for (const segment of normalized) {
    if (segment === '.' || segment === '..') {
      throw new Error(`Artifact path segment '${segment}' is not allowed.`);
    }
  }

  return normalized;
}

function relativeArtifactPath(pathSegments: string[]): string {
  return normalizeArtifactSegments(pathSegments).join('/');
}

function entityFileName(entityId: string): string {
  const [normalizedId, ...extra] = normalizeArtifactSegments([entityId]);
  if (extra.length > 0) {
    throw new Error(`Work entity id '${entityId}' must be a single path segment.`);
  }
  return `${normalizedId}.json`;
}

function entityRelativePath(kind: WorkEntityKind, entityId?: string): string {
  if (kind === 'ledger') {
    if (entityId) {
      throw new Error('Ledger artifacts do not support entity ids.');
    }
    return LEDGER_ARTIFACT_FILE;
  }

  if (!entityId) {
    throw new Error(`Work entity kind '${kind}' requires an entity id.`);
  }

  return relativeArtifactPath([OPERATIONAL_ENTITY_DIRS[kind], entityFileName(entityId)]);
}

function collectArtifactFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir).sort((left, right) => left.localeCompare(right));
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;

    if (statSync(entryPath).isDirectory()) {
      files.push(...collectArtifactFiles(entryPath, relativePath));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function pruneEmptyArtifactDirs(startDir: string, stopDir: string): void {
  let currentDir = startDir;

  while (currentDir.startsWith(stopDir) && currentDir !== stopDir && existsSync(currentDir)) {
    if (readdirSync(currentDir).length > 0) {
      break;
    }
    rmdirSync(currentDir);
    currentDir = dirname(currentDir);
  }
}

export function ensureProjectDir(projectId: string): void {
  const dir = projectDir(projectId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function projectExists(projectId: string): boolean {
  return existsSync(projectDir(projectId));
}

export function ensureArtifactDir(projectId: string, ...pathSegments: string[]): string {
  ensureProjectDir(projectId);
  const dirPath = pathSegments.length === 0 ? projectDir(projectId) : artifactPath(projectId, ...pathSegments);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

export function writeArtifact(projectId: string, filename: string, content: string): void {
  ensureProjectDir(projectId);
  const filePath = artifactPath(projectId, filename);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

export function readArtifact(projectId: string, filename: string): string | null {
  const filePath = artifactPath(projectId, filename);
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, 'utf-8');
}

export function deleteArtifact(projectId: string, filename: string): boolean {
  const filePath = artifactPath(projectId, filename);
  if (!existsSync(filePath)) {
    return false;
  }

  unlinkSync(filePath);
  pruneEmptyArtifactDirs(dirname(filePath), projectDir(projectId));
  return true;
}

export function listArtifacts(projectId: string, relativeDir?: string): string[] {
  const dir = relativeDir ? artifactPath(projectId, relativeDir) : projectDir(projectId);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).sort((left, right) => left.localeCompare(right));
}

export function listArtifactFiles(projectId: string, relativeDir?: string): string[] {
  const dir = relativeDir ? artifactPath(projectId, relativeDir) : projectDir(projectId);
  return collectArtifactFiles(dir);
}

export function writeArtifactJson<T>(projectId: string, filename: string, value: T): void {
  writeArtifact(projectId, filename, JSON.stringify(value, null, 2));
}

export function readArtifactJson<T>(projectId: string, filename: string): T | null {
  const raw = readArtifact(projectId, filename);
  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON artifact '${filename}' for project '${projectId}': ${message}`);
  }
}

export function deleteArtifactJson(projectId: string, filename: string): boolean {
  return deleteArtifact(projectId, filename);
}

export function listArtifactJson<T>(projectId: string, relativeDir?: string): Array<{ path: string; value: T }> {
  return listArtifactFiles(projectId, relativeDir)
    .filter((path) => path.endsWith('.json'))
    .map((path) => ({
      path,
      value: readArtifactJson<T>(projectId, relativeDir ? `${relativeDir}/${path}` : path) as T,
    }));
}

export function workEntityArtifactPath(projectId: string, kind: WorkEntityKind, entityId?: string): string {
  return artifactPath(projectId, entityRelativePath(kind, entityId));
}

export function writeWorkEntityArtifact<K extends WorkEntityKind>(
  projectId: string,
  kind: K,
  value: WorkEntityRecord<K>,
  entityId?: string,
): void {
  writeArtifactJson(projectId, entityRelativePath(kind, entityId), value);
}

export function readWorkEntityArtifact<K extends WorkEntityKind>(
  projectId: string,
  kind: K,
  entityId?: string,
): WorkEntityRecord<K> | null {
  return readArtifactJson<WorkEntityRecord<K>>(projectId, entityRelativePath(kind, entityId));
}

export function deleteWorkEntityArtifact<K extends WorkEntityKind>(projectId: string, kind: K, entityId?: string): boolean {
  return deleteArtifactJson(projectId, entityRelativePath(kind, entityId));
}

export function listWorkEntityArtifacts<K extends Exclude<WorkEntityKind, 'ledger'>>(
  projectId: string,
  kind: K,
): Array<WorkEntityRecord<K>> {
  return listArtifactJson<WorkEntityRecord<K>>(projectId, OPERATIONAL_ENTITY_DIRS[kind]).map((artifact) => artifact.value);
}

export function listWorkEntityIds<K extends Exclude<WorkEntityKind, 'ledger'>>(projectId: string, kind: K): string[] {
  return listArtifactFiles(projectId, OPERATIONAL_ENTITY_DIRS[kind]).map((path) => basename(path, '.json'));
}

export function artifactPath(projectId: string, ...pathSegments: string[]): string {
  if (pathSegments.length === 0) {
    return projectDir(projectId);
  }
  return join(projectDir(projectId), ...normalizeArtifactSegments(pathSegments));
}
