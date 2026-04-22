import type { IterationResult, LLMProvider, SnapshotDiff } from '../types/index.js';
import { readArtifact, writeArtifact } from '../artifacts/store.js';
import { loadFigmaSnapshot, diffSnapshot } from '../figma/sync.js';
import { createProvider } from '../providers/interface.js';

export async function runIteration(
  projectId: string,
  provider?: LLMProvider,
): Promise<IterationResult> {
  const diff = diffSnapshot(projectId);

  const updatedArtifacts: string[] = [];

  if (diff.hasChanges) {
    const llm = provider ?? createProvider();

    // Update PrototypeSpec.md based on diff
    const currentSpec = readArtifact(projectId, 'PrototypeSpec.md');
    if (currentSpec) {
      const updatedSpec = await updateSpecFromDiff(llm, projectId, currentSpec, diff);
      writeArtifact(projectId, 'PrototypeSpec.md', updatedSpec);
      updatedArtifacts.push('PrototypeSpec.md');
    }
  }

  // Append to iteration log
  const logEntry = formatLogEntry(diff, updatedArtifacts);
  appendToLog(projectId, logEntry);
  updatedArtifacts.push('IterationLog.md');

  return {
    diff,
    updatedArtifacts,
    logEntry,
  };
}

async function updateSpecFromDiff(
  provider: LLMProvider,
  projectId: string,
  currentSpec: string,
  diff: SnapshotDiff,
): Promise<string> {
  const diffDescription = formatDiffForLLM(diff);

  const response = await provider.complete([
    {
      role: 'system',
      content: `You are a Product Designer updating a prototype specification based on changes made in Figma.

You will receive the current PrototypeSpec.md and a description of what changed in Figma.
Update the spec to reflect these changes. Preserve the overall structure and headings.
Only modify sections affected by the changes.
Return the complete updated PrototypeSpec.md.`,
    },
    {
      role: 'user',
      content: `Current PrototypeSpec.md:\n\n${currentSpec}\n\nChanges from Figma:\n\n${diffDescription}\n\nProduce the updated PrototypeSpec.md:`,
    },
  ], {
    maxTokens: 4096,
    temperature: 0.2,
    meta: {
      projectId,
      stage: 'iterate',
      operation: 'update_spec_from_figma_diff',
    },
  });

  return response.content;
}

function formatDiffForLLM(diff: SnapshotDiff): string {
  const parts: string[] = [];

  if (diff.added.length > 0) {
    parts.push('Added frames:');
    for (const frame of diff.added) {
      parts.push(`  - ${frame.name}: ${frame.textContent.join(', ')}`);
    }
  }

  if (diff.removed.length > 0) {
    parts.push('Removed frames:');
    for (const frame of diff.removed) {
      parts.push(`  - ${frame.name}`);
    }
  }

  if (diff.modified.length > 0) {
    parts.push('Modified frames:');
    for (const mod of diff.modified) {
      parts.push(`  - ${mod.frameName}:`);
      for (const change of mod.textChanges) {
        parts.push(`    - "${change.old}" → "${change.new}"`);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : 'No changes detected.';
}

function formatLogEntry(diff: SnapshotDiff, updatedArtifacts: string[]): string {
  const timestamp = new Date().toISOString();
  const parts: string[] = [
    `### ${timestamp}`,
    '',
  ];

  if (!diff.hasChanges) {
    parts.push('No changes detected from Figma snapshot.');
  } else {
    parts.push('**What changed:**');
    if (diff.added.length > 0) {
      parts.push(`- Added ${diff.added.length} frame(s): ${diff.added.map((f) => f.name).join(', ')}`);
    }
    if (diff.removed.length > 0) {
      parts.push(`- Removed ${diff.removed.length} frame(s): ${diff.removed.map((f) => f.name).join(', ')}`);
    }
    if (diff.modified.length > 0) {
      parts.push(`- Modified ${diff.modified.length} frame(s): ${diff.modified.map((f) => f.frameName).join(', ')}`);
    }

    parts.push('');
    parts.push('**Why:** Changes made by designer in Figma');
    parts.push('');
    parts.push(`**Artifacts updated:** ${updatedArtifacts.join(', ')}`);
  }

  parts.push('');
  return parts.join('\n');
}

function appendToLog(projectId: string, entry: string): void {
  const existing = readArtifact(projectId, 'IterationLog.md');
  const header = '# Iteration Log\n\n';

  if (existing) {
    writeArtifact(projectId, 'IterationLog.md', existing + '\n' + entry);
  } else {
    writeArtifact(projectId, 'IterationLog.md', header + entry);
  }
}
