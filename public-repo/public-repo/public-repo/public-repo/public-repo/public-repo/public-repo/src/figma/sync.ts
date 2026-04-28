import type { FigmaFrame, FigmaSnapshot, SnapshotDiff } from '../types/index.js';
import { readArtifact, writeArtifact } from '../artifacts/store.js';

export function saveFigmaSnapshot(projectId: string, snapshot: FigmaSnapshot): void {
  writeArtifact(projectId, 'FigmaSnapshot.json', JSON.stringify(snapshot, null, 2));
}

export function loadFigmaSnapshot(projectId: string): FigmaSnapshot | null {
  const raw = readArtifact(projectId, 'FigmaSnapshot.json');
  if (!raw) return null;

  try {
    return JSON.parse(raw) as FigmaSnapshot;
  } catch {
    return null;
  }
}

export function diffSnapshot(projectId: string): SnapshotDiff {
  const snapshot = loadFigmaSnapshot(projectId);
  const specContent = readArtifact(projectId, 'PrototypeSpec.md');

  const emptyDiff: SnapshotDiff = {
    added: [],
    removed: [],
    modified: [],
    hasChanges: false,
  };

  if (!snapshot || !specContent) {
    return emptyDiff;
  }

  // Load the previous snapshot if it exists
  const prevRaw = readArtifact(projectId, 'FigmaSnapshot.prev.json');
  if (!prevRaw) {
    // No previous snapshot to compare — save current as prev for next time
    writeArtifact(projectId, 'FigmaSnapshot.prev.json', JSON.stringify(snapshot, null, 2));
    return emptyDiff;
  }

  let prevSnapshot: FigmaSnapshot;
  try {
    prevSnapshot = JSON.parse(prevRaw) as FigmaSnapshot;
  } catch {
    return emptyDiff;
  }

  const diff = computeDiff(prevSnapshot, snapshot);

  // Update prev snapshot for next comparison
  if (diff.hasChanges) {
    writeArtifact(projectId, 'FigmaSnapshot.prev.json', JSON.stringify(snapshot, null, 2));
  }

  return diff;
}

function computeDiff(prev: FigmaSnapshot, current: FigmaSnapshot): SnapshotDiff {
  const prevFrameMap = new Map(prev.frames.map((f) => [f.id, f]));
  const currentFrameMap = new Map(current.frames.map((f) => [f.id, f]));

  const added: FigmaFrame[] = [];
  const removed: FigmaFrame[] = [];
  const modified: SnapshotDiff['modified'] = [];

  // Find added and modified frames
  for (const [id, frame] of currentFrameMap) {
    const prevFrame = prevFrameMap.get(id);
    if (!prevFrame) {
      added.push(frame);
    } else {
      // Check for text content changes
      const textChanges = diffTextContent(prevFrame.textContent, frame.textContent);
      if (textChanges.length > 0 || prevFrame.name !== frame.name) {
        modified.push({
          frameId: id,
          frameName: frame.name,
          textChanges,
        });
      }
    }
  }

  // Find removed frames
  for (const [id, frame] of prevFrameMap) {
    if (!currentFrameMap.has(id)) {
      removed.push(frame);
    }
  }

  return {
    added,
    removed,
    modified,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}

function diffTextContent(
  prev: string[],
  current: string[],
): Array<{ old: string; new: string }> {
  const changes: Array<{ old: string; new: string }> = [];
  const maxLen = Math.max(prev.length, current.length);

  for (let i = 0; i < maxLen; i++) {
    const oldText = prev[i] ?? '';
    const newText = current[i] ?? '';
    if (oldText !== newText) {
      changes.push({ old: oldText, new: newText });
    }
  }

  return changes;
}
