import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { bootstrapWorkspace } from '../src/runtime/config.js';
import { scaffoldAppRepository } from '../src/runtime/app-scaffold.js';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

function normalizeName(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'my-app';
}

function isYes(value: string, defaultYes = true): boolean {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return defaultYes;
  return ['y', 'yes', 'true', '1'].includes(v);
}

async function main(): Promise<void> {
  const cwd = path.resolve(process.cwd());
  const cwdName = path.basename(cwd);
  const parent = path.dirname(cwd);

  const rl = createInterface({ input, output });
  try {
    const appNameInput = readArg('app-name') || readArg('app') || (await rl.question('App name: '));
    const appName = normalizeName(appNameInput);

    const recommendedWorkdir = path.resolve(parent, `${appName}-workdir`);
    const recommendedAppPath = path.resolve(recommendedWorkdir, appName);
    const recommendedWorktreesPath = path.resolve(recommendedWorkdir, `${appName}-worktrees`);
    const recommendedOrchestratorPath = path.resolve(recommendedWorkdir, 'spec-to-ship');

    console.log('\nRecommended structure:');
    console.log(`${recommendedWorkdir}/`);
    console.log(`|_ ${path.basename(recommendedAppPath)}`);
    console.log(`|_ ${path.basename(recommendedWorktreesPath)}`);
    console.log(`|_ spec-to-ship`);

    const useRecommended = isYes(
      readArg('use-recommended') || (await rl.question('\nUse recommended paths? [Y/n]: ')),
      true,
    );

    let appRepoPath = recommendedAppPath;
    let worktreesRootPath = recommendedWorktreesPath;

    if (!useRecommended) {
      const customApp =
        readArg('app-path') ||
        (await rl.question(`App repo path [${recommendedAppPath}]: `));
      const customWorktrees =
        readArg('worktrees-path') ||
        (await rl.question(`Worktrees root path [${recommendedWorktreesPath}]: `));

      appRepoPath = path.resolve(customApp || recommendedAppPath);
      worktreesRootPath = path.resolve(customWorktrees || recommendedWorktreesPath);
    }

    const relocateDefault = useRecommended && cwdName === 'spec-to-ship' && cwd !== recommendedOrchestratorPath;
    const relocateAnswer =
      readArg('relocate-spec-to-ship') ||
      (relocateDefault
        ? await rl.question(
            `\nMove current spec-to-ship repo to ${recommendedOrchestratorPath}? [Y/n]: `,
          )
        : 'n');
    const relocate = isYes(relocateAnswer, relocateDefault);

    const createIfMissing = isYes(readArg('create') || 'true', true);

    if (relocate) {
      mkdirSync(recommendedWorkdir, { recursive: true });
      if (existsSync(recommendedOrchestratorPath)) {
        throw new Error(`Cannot relocate: target path already exists: ${recommendedOrchestratorPath}`);
      }
      const from = cwd;
      const to = recommendedOrchestratorPath;
      process.chdir(parent);
      renameSync(from, to);
      process.chdir(to);
      console.log(`\nRelocated spec-to-ship to: ${to}`);
    }

    const result = bootstrapWorkspace({
      appName,
      appRepoPath,
      worktreesRootPath,
      createIfMissing,
    });

    console.log('\nWorkspace bootstrap result:');
    console.log(JSON.stringify(result, null, 2));
    console.log('\nUpdated runtime config now points all workflow stages to these paths.');

    const scaffoldNow = isYes(readArg('scaffold-app') || (await rl.question('\nInitialize app scaffold now? [Y/n]: ')), true);
    if (scaffoldNow) {
      const recommended = isYes(
        readArg('use-recommended-stack') ||
          (await rl.question('Use recommended stack template (Next.js + TypeScript + Supabase-ready)? [Y/n]: ')),
        true,
      );
      let customStackNotes: string | undefined;
      if (!recommended) {
        customStackNotes =
          readArg('custom-stack-notes') || (await rl.question('Describe your custom stack (optional): '));
      }
      const scaffold = scaffoldAppRepository({
        appName,
        appRepoPath: result.appRepoPath,
        worktreesRootPath: result.worktreesRootPath,
        mode: recommended ? 'recommended' : 'custom',
        customStackNotes,
      });
      console.log('\nApp scaffold result:');
      console.log(JSON.stringify(scaffold, null, 2));
      console.log(
        '\nNote: engineering_exec expects app-side `just` recipes (`change-worktree`, `agent-verify`) which were scaffolded.',
      );
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
