import { runStage } from '../src/index.js';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

const projectId = process.argv[2] ?? 'demo-project';
const stage = (process.argv[3] ?? 'pm') as
  | 'pm'
  | 'research'
  | 'design'
  | 'engineering'
  | 'engineering_exec';
const dryRun = (readArg('dry-run') || 'true').toLowerCase() !== 'false';

const result = await runStage(projectId, stage, undefined, {
  engineeringExec: {
    dryRun,
  },
});
console.log(JSON.stringify(result, null, 2));
