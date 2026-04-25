import assert from 'node:assert/strict';

async function main(): Promise<void> {
  const {
    buildArtifactTreeFromPaths,
    renderArtifactTree,
    renderBlocks,
    renderDoctorCheckMatrix,
    renderNextActionsBlock,
    renderPhaseProgressBlock,
    renderStatusBlock,
    renderSummaryBlock,
    renderWarningsBlock,
  } = await import('../src/index.js');

  assert.equal(
    renderSummaryBlock('Execution Summary', 'Repository is ready.', [{ label: 'Command', value: 's2s' }]),
    [
      '== Execution Summary ==',
      'Summary: Repository is ready.',
      '- Command: s2s',
    ].join('\n'),
  );

  assert.equal(
    renderStatusBlock('Repository Status', [
      { label: 'Ready now', value: 'yes', state: 'ok' },
      { label: 'Recommended next command', value: 's2s stage pm', state: 'warn' },
    ]),
    [
      '== Repository Status ==',
      '- [OK] Ready now: yes',
      '- [WARN] Recommended next command: s2s stage pm',
    ].join('\n'),
  );

  assert.equal(
    renderPhaseProgressBlock('Phase Progress', [
      { label: 'intake', state: 'done' },
      { label: 'pm', state: 'current' },
      { label: 'research', state: 'pending' },
    ]),
    [
      '== Phase Progress ==',
      '[x] intake',
      '[>] pm',
      '[ ] research',
    ].join('\n'),
  );

  assert.equal(
    renderDoctorCheckMatrix('Doctor Check Matrix', [
      {
        label: 'CLI command available (codex)',
        value: 'codex not found in PATH',
        state: 'warn',
        detail: 'why: Codex CLI is required for the configured client.',
        remediation: 'Install/authenticate codex, then rerun s2s doctor.',
      },
    ]),
    [
      '== Doctor Check Matrix ==',
      '- [WARN] CLI command available (codex): codex not found in PATH',
      '  why: Codex CLI is required for the configured client.',
      '  fix: Install/authenticate codex, then rerun s2s doctor.',
    ].join('\n'),
  );

  const artifactTree = renderArtifactTree('Artifact Tree', buildArtifactTreeFromPaths([
    'specs/PRD.md',
    'specs/research/notes.md',
    'TechSpec.md',
  ]), { rootLabel: 'demo-app' });
  assert.equal(
    artifactTree,
    [
      '== Artifact Tree ==',
      'demo-app',
      '|- specs',
      '|  |- PRD.md',
      "|  '- research",
      "|     '- notes.md",
      "'- TechSpec.md",
    ].join('\n'),
  );

  assert.equal(
    renderBlocks([
      renderWarningsBlock('Warnings', ['Repository root is not a Git checkout.']),
      renderNextActionsBlock('Next Actions', ['Run `s2s init`.']),
    ]),
    [
      '== Warnings ==',
      '- Repository root is not a Git checkout.',
      '',
      '== Next Actions ==',
      '- Run `s2s init`.',
    ].join('\n'),
  );

  console.log('Output renderer contract checks passed.');
}

void main();
