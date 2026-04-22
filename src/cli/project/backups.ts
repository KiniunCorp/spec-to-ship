import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../utils/file-io.js';
import { globalS2SHomePath, isPathEqualOrInside, projectBackupKey } from '../utils/paths.js';
import { getActiveCLIFlags } from '../io/state.js';
import { loadRegistry, saveRegistry } from './registry.js';
import { readLocalState, writeLocalState } from './config.js';
import {
  ROOT_ADAPTER_FILES,
  type GlobalProjectBackupManifest,
  type ResolvedProjectContext,
} from '../types.js';
import { readBackupPolicy, applyBackupRetention, shouldCreateBackupForEffectiveChange } from '../../onboarding/backup-policy.js';

let registeredCLIVersion = '0.0.0';

export function setBackupCLIVersion(version: string): void {
  registeredCLIVersion = version;
}

export function globalProjectBackupsRoot(): string {
  return path.join(globalS2SHomePath(), 'backups', 'projects');
}

export function globalProjectBackupsDir(appRoot: string): string {
  return path.join(globalProjectBackupsRoot(), projectBackupKey(appRoot));
}

export function resolveProjectSnapshotId(appRoot: string, requestedSnapshotId?: string): string | null {
  const projectDir = globalProjectBackupsDir(appRoot);
  if (!existsSync(projectDir)) return null;

  if (requestedSnapshotId) {
    const safeId = String(requestedSnapshotId).trim();
    if (!safeId) return null;
    return safeId;
  }

  const snapshots = readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (snapshots.length === 0) return null;
  return snapshots[snapshots.length - 1];
}

export function backupRootAdaptersBeforeMutation(appRoot: string, s2sDir: string, targets?: string[]): void {
  if (Array.isArray(targets) && targets.length === 0) return;
  const candidates = (targets && targets.length > 0 ? targets : ROOT_ADAPTER_FILES) as readonly string[];
  const existing = candidates.filter((name) => existsSync(path.join(appRoot, name)));
  if (existing.length === 0) return;
  if (isDuplicateOfLatestRootAdapterBackup(appRoot, s2sDir, existing)) return;
  const policy = readBackupPolicy(path.join(s2sDir, 'config'));
  if (!shouldCreateBackupForEffectiveChange(policy, true)) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(s2sDir, 'backups', 'root-adapters', stamp);
  const rootBackupDir = path.join(backupDir, 'root');
  mkdirSync(rootBackupDir, { recursive: true });

  for (const fileName of existing) {
    cpSync(path.join(appRoot, fileName), path.join(rootBackupDir, fileName));
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    reason: 'pre-root-adapter-mutation',
    appRoot: path.resolve(appRoot),
    files: existing,
  };
  writeJsonFile(path.join(backupDir, 'manifest.json'), manifest);
  applyBackupRetention(path.join(s2sDir, 'backups', 'root-adapters'), policy);
}

export function isDuplicateOfLatestRootAdapterBackup(appRoot: string, s2sDir: string, files: readonly string[]): boolean {
  const rootBackupsDir = path.join(s2sDir, 'backups', 'root-adapters');
  if (!existsSync(rootBackupsDir)) return false;
  const snapshots = readdirSync(rootBackupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (snapshots.length === 0) return false;
  const latestDir = path.join(rootBackupsDir, snapshots[snapshots.length - 1], 'root');
  if (!existsSync(latestDir)) return false;
  for (const fileName of files) {
    const currentPath = path.join(appRoot, fileName);
    const latestPath = path.join(latestDir, fileName);
    if (!existsSync(currentPath) || !existsSync(latestPath)) return false;
    const currentContent = readFileSync(currentPath, 'utf8');
    const latestContent = readFileSync(latestPath, 'utf8');
    if (currentContent !== latestContent) return false;
  }
  return true;
}

export function createProjectBackup(s2sDir: string): void {
  const policy = readBackupPolicy(path.join(s2sDir, 'config'));
  if (!shouldCreateBackupForEffectiveChange(policy, true)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(s2sDir, 'backups', stamp);
  mkdirSync(backupRoot, { recursive: true });
  for (const name of ['project.json', 'project.local.json', 'config', 'guardrails', 'scripts']) {
    const source = path.join(s2sDir, name);
    if (!existsSync(source)) continue;
    const target = path.join(backupRoot, name);
    cpSync(source, target, { recursive: true });
  }
  applyBackupRetention(path.join(s2sDir, 'backups'), policy);
}

export function createGlobalProjectBackup(
  context: ResolvedProjectContext,
  reason: GlobalProjectBackupManifest['reason'],
): {
  backupId: string;
  snapshotDir: string;
  projectBackupsDir: string;
  manifestPath: string;
} {
  const backupId = new Date().toISOString().replace(/[:.]/g, '-');
  const projectBackupsPath = globalProjectBackupsDir(context.appRoot);
  const snapshotDir = path.join(projectBackupsPath, backupId);
  mkdirSync(snapshotDir, { recursive: true });

  const snapshotS2SDir = path.join(snapshotDir, 's2s');
  const canCopyS2S = existsSync(context.s2sDir) && !isPathEqualOrInside(snapshotS2SDir, context.s2sDir);
  if (canCopyS2S) {
    cpSync(context.s2sDir, snapshotS2SDir, { recursive: true });
  } else if (existsSync(context.s2sDir)) {
    console.warn(
      `[backup] skipped s2s snapshot copy to avoid recursive source/target overlap (${context.s2sDir} -> ${snapshotS2SDir})`,
    );
  }

  const rootDir = path.join(snapshotDir, 'root');
  mkdirSync(rootDir, { recursive: true });
  const restoredAdapters: string[] = [];
  for (const fileName of ROOT_ADAPTER_FILES) {
    const source = path.join(context.appRoot, fileName);
    if (!existsSync(source)) continue;
    cpSync(source, path.join(rootDir, fileName));
    restoredAdapters.push(fileName);
  }

  const manifest: GlobalProjectBackupManifest = {
    version: 1,
    backupId,
    createdAt: new Date().toISOString(),
    reason,
    cliVersion: registeredCLIVersion,
    appRoot: path.resolve(context.appRoot),
    projectId: context.projectMeta.projectId,
    alias: context.projectMeta.alias,
    includes: {
      s2s: canCopyS2S,
      rootAdapters: restoredAdapters,
    },
  };

  const manifestPath = path.join(snapshotDir, 'manifest.json');
  writeJsonFile(manifestPath, manifest);
  applyBackupRetention(projectBackupsPath, readBackupPolicy(context.configDir));
  return { backupId, snapshotDir, projectBackupsDir: projectBackupsPath, manifestPath };
}

export function maybeCreateStartupBackup(context: ResolvedProjectContext, source: string): void {
  const policy = readBackupPolicy(context.configDir);
  const intervalHours = resolveStartupBackupIntervalHours(policy);
  const latest = latestGlobalProjectBackupInfo(context.appRoot);
  const nowMs = Date.now();
  const elapsedHours = latest ? (nowMs - latest.createdAtMs) / (60 * 60 * 1000) : Number.POSITIVE_INFINITY;
  const changed = latest ? hasManagedSnapshotDifference(context, latest.snapshotDir) : true;

  if (!changed && elapsedHours < intervalHours) return;

  const reason: 'startup-change' | 'periodic-startup' = changed ? 'startup-change' : 'periodic-startup';
  const snapshot = createGlobalProjectBackup(context, reason);
  if (reason === 'startup-change') {
    if (!getActiveCLIFlags().json) {
      console.log(`[backup] startup change snapshot created: ${snapshot.backupId} (${source})`);
    }
    return;
  }
  const elapsedLabel = Number.isFinite(elapsedHours) ? `${elapsedHours.toFixed(1)}h` : 'none';
  if (!getActiveCLIFlags().json) {
    console.log(
      `[backup] startup periodic snapshot created: ${snapshot.backupId} (${source}; elapsed=${elapsedLabel}; interval=${intervalHours}h)`,
    );
  }
}

export function resolveStartupBackupIntervalHours(policy: ReturnType<typeof readBackupPolicy>): number {
  const maxIntervalHours = 7 * 24;
  if (policy.periodicity === 'none') return maxIntervalHours;
  if (policy.periodicity === 'daily') {
    return Math.max(1, Math.min(24, Number(policy.minIntervalHours || 24)));
  }
  if (policy.periodicity === 'weekly') {
    return Math.max(1, Math.min(maxIntervalHours, Number(policy.minIntervalHours || maxIntervalHours)));
  }
  return maxIntervalHours;
}

export function latestGlobalProjectBackupInfo(appRoot: string): {
  snapshotId: string;
  snapshotDir: string;
  createdAtMs: number;
} | null {
  const snapshotId = resolveProjectSnapshotId(appRoot);
  if (!snapshotId) return null;
  const snapshotDir = path.join(globalProjectBackupsDir(appRoot), snapshotId);
  if (!existsSync(snapshotDir)) return null;

  const manifestPath = path.join(snapshotDir, 'manifest.json');
  const manifest = readJsonFile<Partial<GlobalProjectBackupManifest>>(manifestPath);
  const parsedFromManifest = Date.parse(String(manifest?.createdAt || ''));
  if (Number.isFinite(parsedFromManifest)) {
    return { snapshotId, snapshotDir, createdAtMs: parsedFromManifest };
  }

  try {
    const stats = statSync(snapshotDir);
    if (Number.isFinite(stats.mtimeMs)) {
      return { snapshotId, snapshotDir, createdAtMs: stats.mtimeMs };
    }
  } catch {
    return null;
  }
  return null;
}

export function hasManagedSnapshotDifference(context: ResolvedProjectContext, snapshotDir: string): boolean {
  const currentSignature = buildManagedStateSignature({
    s2sDir: context.s2sDir,
    rootDir: context.appRoot,
  });
  const snapshotSignature = buildManagedStateSignature({
    s2sDir: path.join(snapshotDir, 's2s'),
    rootDir: path.join(snapshotDir, 'root'),
  });
  return currentSignature !== snapshotSignature;
}

export function buildManagedStateSignature(paths: { s2sDir: string; rootDir: string }): string {
  const entries: Array<{ key: string; filePath: string }> = [];
  const managedS2sFiles = ['project.json'] as const;
  const managedS2sDirs = ['config', 'guardrails', 'scripts'] as const;

  for (const fileName of managedS2sFiles) {
    const filePath = path.join(paths.s2sDir, fileName);
    if (!existsSync(filePath)) continue;
    entries.push({ key: path.posix.join('s2s', fileName), filePath });
  }

  for (const dirName of managedS2sDirs) {
    const dirPath = path.join(paths.s2sDir, dirName);
    if (!existsSync(dirPath)) continue;
    const relFiles = listFilesRecursively(dirPath);
    for (const relFile of relFiles) {
      entries.push({
        key: path.posix.join('s2s', dirName, relFile.split(path.sep).join('/')),
        filePath: path.join(dirPath, relFile),
      });
    }
  }

  for (const fileName of ROOT_ADAPTER_FILES) {
    const filePath = path.join(paths.rootDir, fileName);
    if (!existsSync(filePath)) continue;
    entries.push({ key: path.posix.join('root', fileName), filePath });
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.key);
    hash.update('\0');
    hash.update(createHash('sha256').update(readFileSync(entry.filePath)).digest('hex'));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function listFilesRecursively(baseDir: string): string[] {
  const result: string[] = [];
  if (!existsSync(baseDir)) return result;
  const stack = [''];
  while (stack.length > 0) {
    const relDir = stack.pop() || '';
    const absDir = relDir ? path.join(baseDir, relDir) : baseDir;
    const entries = readdirSync(absDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(relPath);
        continue;
      }
      if (entry.isFile()) {
        result.push(relPath);
      }
    }
  }
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

export function touchProjectLastUsed(context: ResolvedProjectContext): void {
  const registry = loadRegistry();
  const match = registry.projects.find((entry) => path.resolve(entry.appPath) === path.resolve(context.appRoot));
  if (match) {
    const now = new Date().toISOString();
    match.lastUsedAt = now;
    match.updatedAt = now;
    saveRegistry(registry);
  }
  writeLocalState(context, { lastUsedAt: new Date().toISOString() });
}
