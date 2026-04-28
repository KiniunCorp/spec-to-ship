import { ensureRuntimeReady } from '../src/runtime/readiness.js';
import type { UITarget } from '../src/runtime/ui-targets.js';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

function parseBool(value: string | undefined, defaultValue = true): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'y', 'si', 's'].includes(normalized);
}

function parseScaffoldMode(value: string | undefined): 'none' | 'recommended' | 'custom' {
  if (!value) return 'none';
  if (value === 'recommended' || value === 'custom' || value === 'none') return value;
  throw new Error('Invalid --scaffold value. Use: none | recommended | custom');
}

async function main(): Promise<void> {
  const appName = readArg('app-name');
  const idea = readArg('idea');
  const uiTargetArg = readArg('ui-target');
  const uiTarget = uiTargetArg as UITarget | undefined;
  const scaffoldMode = parseScaffoldMode(readArg('scaffold'));
  const preferCli = parseBool(readArg('prefer-cli'), true);
  const customStackNotes = readArg('custom-stack-notes');

  const result = ensureRuntimeReady({
    appName,
    idea,
    uiTarget,
    preferCli,
    scaffoldMode,
    customStackNotes,
  });

  console.log('\nSpecToShip Ready Check\n');
  console.log('Summary:');
  console.log(`- Ready: ${result.ready ? 'yes' : 'no'}`);
  if (result.selectedUI) {
    console.log(`- Conversational UI: ${result.selectedUI.label}`);
  } else {
    console.log('- Conversational UI: not detected');
  }
  console.log(`- LLM status: ${result.llmStatus} (${result.llmMode})`);
  console.log(`- LLM config: ${result.llmConfigPath}`);
  console.log(`- Workspace status: ${result.workspaceStatus}`);
  console.log(`- Workspace app path: ${result.workspaceAppPath}`);
  console.log(`- Workspace worktrees path: ${result.workspaceWorktreesPath}`);
  console.log(
    `- Workspace guidance notes: ${result.guardrailsCreatedOrUpdated} created/updated, ${result.guardrailsUnchanged} unchanged, ${result.guardrailsSkipped} skipped`,
  );
  if (result.scaffold) {
    console.log(`- Scaffold: ${result.scaffold.mode} (created files: ${result.scaffold.createdFiles.length})`);
  }

  if (result.missingRequiredTools.length > 0) {
    console.log('\nMissing required tools:');
    result.missingRequiredTools.forEach((tool) => console.log(`- ${tool}`));
  }
  if (result.pendingActions.length > 0) {
    console.log('\nPending actions:');
    result.pendingActions.forEach((action) => console.log(`- ${action}`));
  }
  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (!result.ready) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
