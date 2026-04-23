import { scaffoldAppRepository } from '../src/runtime/app-scaffold.js';
import { loadRuntimeConfig } from '../src/runtime/config.js';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

const cfg = loadRuntimeConfig();
const appName = readArg('app-name') || cfg.workspace.projectDirName || 'my-app';
const appRepoPath = readArg('app-path') || cfg.workspace.projectRepoPath || appName;
const worktreesRootPath = readArg('worktrees-path') || cfg.workspace.worktreesRootPath || `${appName}-worktrees`;
const mode = (readArg('mode') || 'recommended') as 'recommended' | 'custom';
const customStackNotes = readArg('custom-stack-notes');
const overwrite = (readArg('overwrite') || 'false').toLowerCase() === 'true';

const result = scaffoldAppRepository({
  appName,
  appRepoPath,
  worktreesRootPath,
  mode,
  customStackNotes,
  overwrite,
});

console.log(JSON.stringify(result, null, 2));
