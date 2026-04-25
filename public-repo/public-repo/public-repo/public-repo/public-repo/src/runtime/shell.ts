import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface ShellResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runShell(
  command: string,
  args: string[],
  cwd: string,
  allowFailure = false,
  env: Record<string, string> = {},
  timeoutMs = 0,
): ShellResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    env: {
      ...process.env,
      ...env,
    },
  });
  const status = result.status ?? 1;
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');

  if (status !== 0 && !allowFailure) {
    throw new Error(`Command failed: ${command} ${args.join(' ')} (${stderr.trim() || stdout.trim()})`);
  }

  return { status, stdout, stderr };
}

export function commandExists(command: string, _cwd?: string): boolean {
  // Reject anything with path separators — callers use isCommandAvailable for absolute paths.
  if (command.includes('/') || command.includes('\\')) return false;
  const searchDirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of searchDirs) {
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      // not in this dir
    }
  }
  return false;
}
