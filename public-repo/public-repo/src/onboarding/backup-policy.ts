import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface BackupPolicy {
  version: number;
  periodicity: 'none' | 'daily' | 'weekly';
  minIntervalHours: number;
  retain: {
    maxSnapshots: number;
    maxAgeDays: number;
  };
  createOnlyOnEffectiveChange: boolean;
}

const DEFAULT_BACKUP_POLICY: BackupPolicy = {
  version: 1,
  periodicity: 'weekly',
  minIntervalHours: 168,
  retain: {
    maxSnapshots: 7,
    maxAgeDays: 30,
  },
  createOnlyOnEffectiveChange: true,
};

export function ensureBackupPolicyFile(configDir: string): BackupPolicy {
  const filePath = backupPolicyPath(configDir);
  const current = readBackupPolicy(configDir);
  writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return current;
}

export function readBackupPolicy(configDir: string): BackupPolicy {
  const filePath = backupPolicyPath(configDir);
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<BackupPolicy>;
    return normalizeBackupPolicy(parsed);
  } catch {
    return DEFAULT_BACKUP_POLICY;
  }
}

export function applyBackupRetention(backupsDir: string, policy: BackupPolicy): void {
  if (!existsSync(backupsDir)) return;
  const maxSnapshots = Math.max(1, Number(policy.retain.maxSnapshots || 1));
  const maxAgeMs = Math.max(1, Number(policy.retain.maxAgeDays || 1)) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const snapshots = readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dirPath = path.join(backupsDir, entry.name);
      const stats = statSync(dirPath);
      return { name: entry.name, dirPath, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  if (snapshots.length === 0) return;

  const latest = snapshots[snapshots.length - 1];
  for (const snapshot of snapshots) {
    if (snapshot.dirPath === latest.dirPath) continue;
    if (now - snapshot.mtimeMs > maxAgeMs) {
      rmSync(snapshot.dirPath, { recursive: true, force: true });
    }
  }

  const refreshed = readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dirPath = path.join(backupsDir, entry.name);
      const stats = statSync(dirPath);
      return { name: entry.name, dirPath, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const overflow = refreshed.length - maxSnapshots;
  if (overflow <= 0) return;
  for (let i = 0; i < overflow; i += 1) {
    rmSync(refreshed[i].dirPath, { recursive: true, force: true });
  }
}

function backupPolicyPath(configDir: string): string {
  return path.join(configDir, 'backup.policy.json');
}

function normalizeBackupPolicy(value: Partial<BackupPolicy>): BackupPolicy {
  const periodicityRaw = String(value.periodicity || '').trim().toLowerCase();
  const periodicity: BackupPolicy['periodicity'] =
    periodicityRaw === 'none' || periodicityRaw === 'weekly' || periodicityRaw === 'daily'
      ? periodicityRaw
      : DEFAULT_BACKUP_POLICY.periodicity;

  const minIntervalHours = Math.max(1, Number(value.minIntervalHours || DEFAULT_BACKUP_POLICY.minIntervalHours));
  const maxSnapshots = Math.max(1, Number(value.retain?.maxSnapshots || DEFAULT_BACKUP_POLICY.retain.maxSnapshots));
  const maxAgeDays = Math.max(1, Number(value.retain?.maxAgeDays || DEFAULT_BACKUP_POLICY.retain.maxAgeDays));

  return {
    version: 1,
    periodicity,
    minIntervalHours,
    retain: {
      maxSnapshots,
      maxAgeDays,
    },
    createOnlyOnEffectiveChange: value.createOnlyOnEffectiveChange !== false,
  };
}

export function shouldCreateBackupForEffectiveChange(policy: BackupPolicy, changed: boolean): boolean {
  if (!changed) return false;
  if (policy.createOnlyOnEffectiveChange) return true;
  return true;
}

export function ensureDirectory(pathValue: string): void {
  mkdirSync(pathValue, { recursive: true });
}
