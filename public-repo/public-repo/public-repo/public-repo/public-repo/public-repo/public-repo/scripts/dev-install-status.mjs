#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const distCliPath = path.join(repoRoot, 'dist', 'cli.js');

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    status: result.status,
    error: result.error,
  };
}

function resolveCommand(command) {
  const lookup = process.platform === 'win32' ? run('where', [command]) : run('which', [command]);
  if (!lookup.ok || !lookup.stdout) return null;
  const commandPath = lookup.stdout.split('\n')[0].trim();
  try {
    return {
      commandPath,
      realPath: realpathSync(commandPath),
    };
  } catch {
    return {
      commandPath,
      realPath: commandPath,
    };
  }
}

function renderLine(label, value) {
  console.log(`${label.padEnd(20)} ${value}`);
}

const localSourceVersion = run('npm', ['run', '--silent', 'cli', '--', '-v']).stdout || 'unavailable';
const builtVersion = existsSync(distCliPath) ? run('node', [distCliPath, '-v']).stdout || 'unavailable' : 'missing dist/cli.js';
const globalBinary = resolveCommand('s2s');
const globalVersion = globalBinary ? run('s2s', ['-v']).stdout || 'unavailable' : 'not installed';
const activeTarget = globalBinary?.realPath?.startsWith(repoRoot)
  ? 'current checkout'
  : globalBinary
    ? 'different install'
    : 'none';

console.log('Spec-To-Ship local install status\n');
renderLine('repo', repoRoot);
renderLine('package version', String(pkg.version || 'unknown'));
renderLine('source version', localSourceVersion);
renderLine('built version', builtVersion);
renderLine('global s2s', globalBinary ? globalBinary.commandPath : 'not found in PATH');
renderLine('global target', globalBinary ? globalBinary.realPath : 'n/a');
renderLine('global version', globalVersion);
renderLine('active target', activeTarget);

console.log('\nUsage');
console.log('- Run current checkout directly: npm run cli -- --help');
console.log('- Run current checkout via just: just dev -- --help');
console.log('- Link current checkout globally: just install');
console.log('- Re-link after changes: just reinstall');
console.log('- Remove global link: just uninstall');
