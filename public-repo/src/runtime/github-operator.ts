import type { GitOperationResult, RuntimeConfig } from '../types/index.js';
import { commandExists, runShell } from './shell.js';
import { enforceVersioningBeforeDelivery } from './versioning-policy.js';

interface PullRequestState {
  number?: number;
  state?: string;
  mergedAt?: string | null;
  url?: string;
}

interface PushBranchDecision {
  branch: string;
  note?: string;
  openPrNumber?: number;
  openPrUrl?: string;
  reusedPullRequest: boolean;
  requiredFreshBranch: boolean;
}

export function resolveBranchProvider(provider?: string): string {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'custom';
}

export function buildChangeBranchName(changeId: string, provider?: string): string {
  return `s2s-${resolveBranchProvider(provider)}/${changeId}`;
}

export function executeGitDelivery(
  repoPath: string,
  changeId: string,
  config: RuntimeConfig,
  dryRun = false,
  options: {
    skipBranchCheckout?: boolean;
    commitMessage?: string;
    prTitle?: string;
    prBody?: string;
    branchProvider?: string;
  } = {},
): GitOperationResult {
  const branch = buildChangeBranchName(changeId, options.branchProvider);
  const result: GitOperationResult = {
    branch,
    committed: false,
    pushed: false,
    prCreated: false,
    merged: false,
  };

  if (dryRun) {
    return result;
  }

  let deliveryBranch = branch;
  let existingOpenPrNumber: number | undefined;
  let existingOpenPrUrl = '';
  if (config.github.autoPush) {
    const branchDecision = resolvePushBranch(repoPath, branch, config.github.remoteName);
    deliveryBranch = branchDecision.branch;
    existingOpenPrNumber = branchDecision.openPrNumber;
    existingOpenPrUrl = branchDecision.openPrUrl || '';
    result.reusedPullRequest = branchDecision.reusedPullRequest;
    result.requiredFreshBranch = branchDecision.requiredFreshBranch;
    if (branchDecision.note) {
      result.policyNote = branchDecision.note;
    }
  }
  if (!options.skipBranchCheckout || deliveryBranch !== branch) {
    runShell('git', ['checkout', '-B', deliveryBranch], repoPath);
  }
  result.branch = deliveryBranch;

  runShell('git', ['add', '.'], repoPath);
  const stagedFiles = listStagedFiles(repoPath);
  const versioning = enforceVersioningBeforeDelivery(repoPath, config, stagedFiles);
  if (versioning) {
    result.versionManifest = versioning.manifestFile;
    result.versionFrom = versioning.previousVersion;
    result.versionTo = versioning.nextVersion;
    result.versionBumpType = versioning.bumpType;
    result.changelogUpdated = versioning.changelogUpdated;
    result.versionNote = versioning.note;
  }
  const commitMessage = options.commitMessage || `feat(${changeId}): execute engineering iteration`;
  const commitAttempt = runShell('git', ['commit', '-m', commitMessage], repoPath, true);
  result.committed = commitAttempt.status === 0;

  if (config.github.autoPush) {
    const pushAttempt = runShell('git', ['push', '-u', config.github.remoteName, deliveryBranch], repoPath, true);
    result.pushed = pushAttempt.status === 0;
  }

  if (config.github.autoPR && result.pushed && commandExists('gh', repoPath)) {
    if (existingOpenPrUrl && deliveryBranch === branch) {
      result.prCreated = true;
      result.prNumber = existingOpenPrNumber;
      result.prUrl = existingOpenPrUrl;
    } else {
      const prAttempt = runShell(
        'gh',
        [
          'pr',
          'create',
          '--base',
          config.defaultBranch,
          '--head',
          deliveryBranch,
          '--title',
          options.prTitle || `Engineering execution: ${changeId}`,
          '--body',
          options.prBody || 'Automated PR from engineering execution stage.',
        ],
        repoPath,
        true,
      );
      if (prAttempt.status === 0) {
        result.prCreated = true;
        const url = prAttempt.stdout
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.startsWith('http'));
        if (url) {
          result.prUrl = url;
          result.prNumber = inferPullRequestNumber(url);
        }
      }
    }
  }

  if (config.github.autoMerge && result.prCreated && commandExists('gh', repoPath)) {
    const mergeArgs = ['pr', 'merge'];
    if (result.prUrl) mergeArgs.push(result.prUrl);
    mergeArgs.push('--merge', '--delete-branch', '--auto');
    const mergeAttempt = runShell('gh', mergeArgs, repoPath, true);
    result.merged = mergeAttempt.status === 0;
  }

  return result;
}

function listStagedFiles(repoPath: string): string[] {
  const diff = runShell('git', ['diff', '--cached', '--name-only'], repoPath, true);
  if (diff.status !== 0) return [];
  return diff.stdout
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
}

function resolvePushBranch(
  repoPath: string,
  preferredBranch: string,
  remoteName: string,
): PushBranchDecision {
  if (!commandExists('gh', repoPath)) {
    throw new Error('autoPush requires GitHub CLI (gh) to enforce branch/PR safety policy.');
  }

  const priorPrs = listPullRequestsForBranch(repoPath, preferredBranch);
  const closedOrMerged = priorPrs.filter((pr) => isClosedOrMerged(pr.state, pr.mergedAt));
  if (closedOrMerged.length === 0) {
    const openPr = priorPrs.find((pr) => String(pr.state || '').trim().toUpperCase() === 'OPEN' && pr.url);
    return {
      branch: preferredBranch,
      openPrNumber: openPr?.number,
      openPrUrl: openPr?.url,
      reusedPullRequest: Boolean(openPr),
      requiredFreshBranch: false,
    };
  }

  const freshBranch = allocateFreshBranchName(repoPath, preferredBranch, remoteName);
  const references = closedOrMerged
    .map((pr) => (pr.url ? pr.url : pr.number ? `#${pr.number}` : String(pr.state || 'closed')))
    .slice(0, 5)
    .join(', ');
  return {
    branch: freshBranch,
    note: `Branch policy: ${preferredBranch} is linked to closed/merged PR(s) (${references}). Switched to ${freshBranch}.`,
    reusedPullRequest: false,
    requiredFreshBranch: true,
  };
}

function listPullRequestsForBranch(repoPath: string, branch: string): PullRequestState[] {
  const query = runShell(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,mergedAt,url', '--limit', '100'],
    repoPath,
    true,
  );
  if (query.status !== 0) {
    throw new Error(`Failed to query PR state for branch ${branch}: ${(query.stderr || query.stdout).trim()}`);
  }
  try {
    const parsed = JSON.parse(query.stdout) as PullRequestState[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`Failed to parse PR state output for branch ${branch}.`);
  }
}

function isClosedOrMerged(state: string | undefined, mergedAt: string | null | undefined): boolean {
  const normalized = String(state || '').trim().toUpperCase();
  if (!normalized) return false;
  if (normalized === 'OPEN') return false;
  if (normalized === 'CLOSED' || normalized === 'MERGED') return true;
  return Boolean(mergedAt);
}

function allocateFreshBranchName(repoPath: string, baseBranch: string, remoteName: string): string {
  for (let index = 2; index <= 1000; index += 1) {
    const candidate = `${baseBranch}-${index}`;
    if (localBranchExists(repoPath, candidate)) continue;
    if (remoteBranchExists(repoPath, remoteName, candidate)) continue;
    return candidate;
  }
  throw new Error(`Failed to allocate a fresh delivery branch from ${baseBranch}.`);
}

function localBranchExists(repoPath: string, branch: string): boolean {
  const probe = runShell('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoPath, true);
  return probe.status === 0;
}

function remoteBranchExists(repoPath: string, remoteName: string, branch: string): boolean {
  const probe = runShell('git', ['ls-remote', '--exit-code', '--heads', remoteName, branch], repoPath, true);
  return probe.status === 0;
}

function inferPullRequestNumber(prUrl?: string): number | undefined {
  const match = String(prUrl || '')
    .trim()
    .match(/\/(\d+)(?:[/?#].*)?$/);
  if (!match) {
    return undefined;
  }
  const prNumber = Number.parseInt(match[1] || '', 10);
  return Number.isInteger(prNumber) && prNumber > 0 ? prNumber : undefined;
}

export function ensureGitRepository(repoPath: string): void {
  if (!commandExists('git', repoPath)) {
    throw new Error('git is required but not available in PATH.');
  }
  const check = runShell('git', ['rev-parse', '--is-inside-work-tree'], repoPath, true);
  if (check.status !== 0) {
    throw new Error(`Path is not a git repository: ${repoPath}`);
  }
}

export function hasGitRemote(repoPath: string, remoteName: string): boolean {
  const check = runShell('git', ['remote', 'get-url', remoteName], repoPath, true);
  return check.status === 0;
}

export function ensureOrInitGitRepository(
  repoPath: string,
  options: {
    defaultBranch: string;
    initializeIfMissing?: boolean;
    remoteName?: string;
    remoteUrl?: string;
  },
): { initialized: boolean; hasRemote: boolean } {
  if (!commandExists('git', repoPath)) {
    throw new Error('git is required but not available in PATH.');
  }

  const initializeIfMissing = options.initializeIfMissing !== false;
  const remoteName = options.remoteName || 'origin';
  const remoteUrl = String(options.remoteUrl || '').trim();

  const check = runShell('git', ['rev-parse', '--is-inside-work-tree'], repoPath, true);
  let initialized = false;
  if (check.status !== 0) {
    if (!initializeIfMissing) {
      throw new Error(`Path is not a git repository: ${repoPath}`);
    }
    const initWithBranch = runShell('git', ['init', '-b', options.defaultBranch], repoPath, true);
    if (initWithBranch.status !== 0) {
      runShell('git', ['init'], repoPath);
      runShell('git', ['checkout', '-B', options.defaultBranch], repoPath, true);
    }
    initialized = true;
  }

  if (remoteUrl) {
    if (hasGitRemote(repoPath, remoteName)) {
      runShell('git', ['remote', 'set-url', remoteName, remoteUrl], repoPath);
    } else {
      runShell('git', ['remote', 'add', remoteName, remoteUrl], repoPath);
    }
  }

  return {
    initialized,
    hasRemote: hasGitRemote(repoPath, remoteName),
  };
}
