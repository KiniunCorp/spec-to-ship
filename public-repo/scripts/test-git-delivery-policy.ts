import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { RuntimeConfig } from '../src/types/index.js';
import { executeGitDelivery, buildChangeBranchName } from '../src/runtime/github-operator.js';

type ScenarioMode = 'none' | 'open' | 'closed' | 'merged';

function main(): void {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-git-policy-'));
  try {
    const binDir = path.join(sandbox, 'bin');
    mkdirSync(binDir, { recursive: true });
    const fakeGhPath = path.join(binDir, 'gh');
    const createLog = path.join(sandbox, 'gh-create.log');
    createFakeGh(fakeGhPath);
    writeFileSync(createLog, '', 'utf8');

    const previousPath = process.env.PATH || '';
    process.env.PATH = `${binDir}:${previousPath}`;
    process.env.GH_PR_CREATE_LOG = createLog;

    runScenario(sandbox, 'none', false);
    runScenario(sandbox, 'open', false);
    runScenario(sandbox, 'closed', true);
    runScenario(sandbox, 'merged', true);
    runScenarioMissingVersionBump(sandbox);

    console.log('Git delivery branch/PR policy contract check passed.');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function runScenario(sandbox: string, mode: ScenarioMode, expectFreshBranch: boolean): void {
  const scenarioDir = path.join(sandbox, `repo-${mode}`);
  const remoteDir = path.join(sandbox, `remote-${mode}.git`);
  mkdirSync(scenarioDir, { recursive: true });
  initRepoWithRemote(scenarioDir, remoteDir);

  const changeId = `policy-${mode}`;
  const provider = 'codex';
  const preferredBranch = buildChangeBranchName(changeId, provider);
  const config = buildRuntimeConfig();

  process.env.GH_PR_OPEN_BRANCHES = mode === 'open' ? preferredBranch : '';
  process.env.GH_PR_CLOSED_BRANCHES = mode === 'closed' ? preferredBranch : '';
  process.env.GH_PR_MERGED_BRANCHES = mode === 'merged' ? preferredBranch : '';
  const logPath = process.env.GH_PR_CREATE_LOG || '';
  const beforeCreateLogLines = readCreateLog(logPath).length;

  applyVersionBump(scenarioDir, mode);
  writeFileSync(path.join(scenarioDir, 'change.txt'), `scenario=${mode}\n`, 'utf8');
  const result = executeGitDelivery(scenarioDir, changeId, config, false, {
    branchProvider: provider,
    commitMessage: `test(${mode}): branch policy`,
    prTitle: `Test ${mode}`,
    prBody: `Scenario ${mode}`,
  });

  if (!result.committed) {
    throw new Error(`Expected commit in scenario '${mode}'.`);
  }
  if (!result.pushed) {
    throw new Error(`Expected push in scenario '${mode}'.`);
  }
  if (!result.prCreated) {
    throw new Error(`Expected PR creation in scenario '${mode}'.`);
  }
  const expectedReuse = mode === 'open';
  const expectedFreshBranch = mode === 'closed' || mode === 'merged';
  if (result.reusedPullRequest !== expectedReuse) {
    throw new Error(
      `Scenario '${mode}' expected reusedPullRequest=${String(expectedReuse)}, got '${String(result.reusedPullRequest)}'.`,
    );
  }
  if (result.requiredFreshBranch !== expectedFreshBranch) {
    throw new Error(
      `Scenario '${mode}' expected requiredFreshBranch=${String(expectedFreshBranch)}, got '${String(result.requiredFreshBranch)}'.`,
    );
  }
  if (result.versionFrom !== '0.1.0') {
    throw new Error(`Scenario '${mode}' expected versionFrom=0.1.0, got '${result.versionFrom || ''}'.`);
  }
  if (result.versionTo !== '0.1.1') {
    throw new Error(`Scenario '${mode}' expected versionTo=0.1.1, got '${result.versionTo || ''}'.`);
  }
  if (result.versionBumpType !== 'patch') {
    throw new Error(`Scenario '${mode}' expected patch bump, got '${result.versionBumpType || ''}'.`);
  }

  const shouldStay = !expectFreshBranch;
  if (shouldStay && result.branch !== preferredBranch) {
    throw new Error(`Scenario '${mode}' should keep branch '${preferredBranch}', got '${result.branch}'.`);
  }
  if (expectFreshBranch) {
    if (result.branch === preferredBranch) {
      throw new Error(`Scenario '${mode}' should switch to a fresh branch, but stayed on '${preferredBranch}'.`);
    }
    if (!result.branch.startsWith(`${preferredBranch}-`)) {
      throw new Error(`Scenario '${mode}' expected fresh branch derived from '${preferredBranch}', got '${result.branch}'.`);
    }
    if (!String(result.policyNote || '').includes('Switched to')) {
      throw new Error(`Scenario '${mode}' should include policy switch note in git result.`);
    }
  }
  if (!expectFreshBranch && result.policyNote) {
    throw new Error(`Scenario '${mode}' should not emit policy note, got '${result.policyNote}'.`);
  }

  const createdHeads = readCreateLog(logPath);
  const createCallsDelta = createdHeads.length - beforeCreateLogLines;
  if (mode === 'open') {
    if (createCallsDelta !== 0) {
      throw new Error(`Scenario '${mode}' should reuse existing PR without creating a new one.`);
    }
    if (result.prNumber !== 66) {
      throw new Error(`Scenario '${mode}' should reuse open PR number 66, got '${String(result.prNumber)}'.`);
    }
    if (result.prUrl !== 'https://example.test/pr/66') {
      throw new Error(`Scenario '${mode}' should reuse open PR URL, got '${result.prUrl || ''}'.`);
    }
  } else {
    if (createCallsDelta !== 1) {
      throw new Error(`Scenario '${mode}' should create exactly one PR (delta=${createCallsDelta}).`);
    }
    const lastHead = createdHeads[createdHeads.length - 1] || '';
    if (lastHead !== result.branch) {
      throw new Error(`Scenario '${mode}' expected PR head '${result.branch}', got '${lastHead}'.`);
    }
    if (!Number.isInteger(result.prNumber) || result.prNumber! <= 0) {
      throw new Error(`Scenario '${mode}' should persist a created PR number, got '${String(result.prNumber)}'.`);
    }
    if (result.prUrl !== `https://example.test/pr/${result.prNumber}`) {
      throw new Error(`Scenario '${mode}' should persist a created PR URL, got '${result.prUrl || ''}'.`);
    }
  }
}

function runScenarioMissingVersionBump(sandbox: string): void {
  const scenarioDir = path.join(sandbox, 'repo-no-bump');
  const remoteDir = path.join(sandbox, 'remote-no-bump.git');
  mkdirSync(scenarioDir, { recursive: true });
  initRepoWithRemote(scenarioDir, remoteDir);

  const config = buildRuntimeConfig();
  writeFileSync(path.join(scenarioDir, 'change.txt'), 'scenario=no-bump\n', 'utf8');

  let threw = false;
  try {
    executeGitDelivery(scenarioDir, 'policy-no-bump', config, false, {
      branchProvider: 'codex',
      commitMessage: 'test(no-bump): should fail',
      prTitle: 'Test no bump',
      prBody: 'Scenario no bump',
    });
  } catch (error) {
    threw = true;
    const message = String((error as Error)?.message || error || '');
    if (!message.includes('Version bump required')) {
      throw new Error(`Expected version bump enforcement error, got: ${message}`);
    }
  }
  if (!threw) {
    throw new Error('Scenario no-bump should fail due to missing SemVer bump.');
  }
}

function initRepoWithRemote(repoPath: string, remotePath: string): void {
  mustRun('git', ['init', '-b', 'main'], repoPath);
  mustRun('git', ['config', 'user.name', 'S2S Test'], repoPath);
  mustRun('git', ['config', 'user.email', 's2s-test@example.com'], repoPath);
  writeFileSync(path.join(repoPath, 'README.md'), '# test\n', 'utf8');
  writeFileSync(
    path.join(repoPath, 'package.json'),
    `${JSON.stringify({ name: 'test', version: '0.1.0' }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(repoPath, 'package-lock.json'),
    `${JSON.stringify({ name: 'test', version: '0.1.0', lockfileVersion: 3, packages: { '': { version: '0.1.0' } } }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(repoPath, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0\n\n- Initial\n', 'utf8');
  mustRun('git', ['add', '.'], repoPath);
  mustRun('git', ['commit', '-m', 'chore: initial'], repoPath);
  mustRun('git', ['init', '--bare', remotePath], repoPath);
  mustRun('git', ['remote', 'add', 'origin', remotePath], repoPath);
}

function applyVersionBump(repoPath: string, mode: ScenarioMode): void {
  const pkgPath = path.join(repoPath, 'package.json');
  const lockPath = path.join(repoPath, 'package-lock.json');
  const changelogPath = path.join(repoPath, 'CHANGELOG.md');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string; [key: string]: unknown };
  const currentVersion = String(pkg.version || '0.1.0');
  const nextVersion = bumpPatch(currentVersion);
  pkg.version = nextVersion;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
    [key: string]: unknown;
  };
  lock.version = nextVersion;
  lock.packages = lock.packages || {};
  lock.packages[''] = lock.packages[''] || {};
  lock.packages[''].version = nextVersion;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

  const previousChangelog = readFileSync(changelogPath, 'utf8');
  const entry = `\n## ${nextVersion}\n\n- Scenario ${mode}\n`;
  writeFileSync(changelogPath, `${previousChangelog}${entry}`, 'utf8');
}

function bumpPatch(version: string): string {
  const parts = String(version || '').trim().split('.');
  if (parts.length !== 3) return '0.1.1';
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return '0.1.1';
  return `${major}.${minor}.${patch + 1}`;
}

function mustRun(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')} (${(result.stderr || result.stdout || '').trim()})`);
  }
}

function buildRuntimeConfig(): RuntimeConfig {
  return {
    productName: 's2s',
    defaultBranch: 'main',
    guardrailPolicy: 'strict',
    workspace: {
      basePath: '.',
      orchestratorDirName: '.s2s',
      projectDirName: 'sample',
      worktreesDirName: 'worktrees',
    },
    github: {
      remoteName: 'origin',
      autoPush: true,
      autoPR: true,
      autoMerge: false,
    },
    execution: {
      mode: 'manual',
      templateId: 'codex_strict',
      commandTemplate: '',
      maxTasksPerRun: 1,
      stopOnFailure: true,
      timeoutMs: 1000,
      allowedCommands: ['git', 'gh'],
      allowUnsafeRawCommand: false,
    },
    costControl: {
      enabled: false,
      budgetUsd: 0,
      warnThresholdPct: 80,
      hardStopThresholdPct: 100,
    },
    chatObservability: {
      sessionBannerEnabled: false,
      wrapperPrefixEnabled: false,
      wrapperPrefixTemplate: '',
    },
  };
}

function readCreateLog(filePath: string): string[] {
  if (!filePath) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function createFakeGh(fakeGhPath: string): void {
  const script = `#!/usr/bin/env bash
set -euo pipefail

contains_branch() {
  local haystack="\${1:-}"
  local needle="\${2:-}"
  if [[ -z "$needle" ]]; then
    return 1
  fi
  local wrapped=",\${haystack},"
  [[ "$wrapped" == *",\${needle},"* ]]
}

if [[ "\${1:-}" == "pr" && "\${2:-}" == "list" ]]; then
  head=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "--head" ]]; then
      head="$arg"
      break
    fi
    prev="$arg"
  done
  if contains_branch "\${GH_PR_MERGED_BRANCHES:-}" "$head"; then
    echo '[{"number":88,"state":"MERGED","mergedAt":"2026-03-01T00:00:00Z","url":"https://example.test/pr/88"}]'
    exit 0
  fi
  if contains_branch "\${GH_PR_CLOSED_BRANCHES:-}" "$head"; then
    echo '[{"number":77,"state":"CLOSED","mergedAt":null,"url":"https://example.test/pr/77"}]'
    exit 0
  fi
  if contains_branch "\${GH_PR_OPEN_BRANCHES:-}" "$head"; then
    echo '[{"number":66,"state":"OPEN","mergedAt":null,"url":"https://example.test/pr/66"}]'
    exit 0
  fi
  echo '[]'
  exit 0
fi

if [[ "\${1:-}" == "pr" && "\${2:-}" == "create" ]]; then
  head=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "--head" ]]; then
      head="$arg"
      break
    fi
    prev="$arg"
  done
  echo "$head" >> "\${GH_PR_CREATE_LOG:?missing GH_PR_CREATE_LOG}"
  echo "https://example.test/pr/123"
  exit 0
fi

echo "unsupported gh invocation: $*" >&2
exit 1
`;
  writeFileSync(fakeGhPath, script, { encoding: 'utf8', mode: 0o755 });
}

main();
