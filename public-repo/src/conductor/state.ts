import type { AutonomyLevel, PipelineState } from '../types/index.js';
import { readArtifact, writeArtifact } from '../artifacts/store.js';

const STATE_FILE = 'pipeline-state.json';

export function loadState(projectId: string): PipelineState {
  const raw = readArtifact(projectId, STATE_FILE);
  if (raw) {
    return JSON.parse(raw) as PipelineState;
  }

  return createInitialState(projectId);
}

export function saveState(projectId: string, state: PipelineState): void {
  state.updatedAt = new Date().toISOString();
  writeArtifact(projectId, STATE_FILE, JSON.stringify(state, null, 2));
}

export function createInitialState(projectId: string, autonomy: AutonomyLevel = 'low'): PipelineState {
  return {
    projectId,
    currentStage: 'intake',
    completedStages: [],
    autonomy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
