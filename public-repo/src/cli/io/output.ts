import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getActiveCLIFlags } from './state.js';

let cliVersion = '0.0.0';

export function setOutputCLIVersion(version: string): void {
  cliVersion = version;
}

export function commandMeta(command: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command,
    version: cliVersion,
    cwd: process.cwd(),
    flags: getActiveCLIFlags(),
    ...extras,
  };
}

export function printJson(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printVerboseContext(lines: string[], extras: Record<string, unknown> = {}): void {
  const flags = getActiveCLIFlags();
  if (!flags.verbose && !flags.debug) return;
  lines.push('', 'Additional context:');
  lines.push(`- cwd: ${process.cwd()}`);
  if (flags.repoPath) {
    lines.push(`- repo override: ${flags.repoPath}`);
  }
  if (flags.configPath) {
    lines.push(`- config override: ${flags.configPath}`);
  }
  if (flags.debug) {
    for (const [key, value] of Object.entries(extras)) {
      lines.push(`- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }
}

export function failCLI(message: string, extras: Record<string, unknown> = {}): never {
  if (getActiveCLIFlags().json) {
    console.error(JSON.stringify({
      ok: false,
      error: message,
      ...commandMeta('error', extras),
    }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

export function warnOrchestrator(operation: string, error: unknown, s2sDir?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${operation}] ${message}`;
  if (getActiveCLIFlags().verbose) {
    console.error(`[orchestrator] ${operation}: ${message}`);
  }
  if (s2sDir) {
    try {
      const logDir = path.join(s2sDir, 'logs');
      mkdirSync(logDir, { recursive: true });
      appendFileSync(path.join(logDir, 'orchestrator.log'), `${line}\n`, 'utf8');
    } catch {
      // Best-effort logging
    }
  }
}
