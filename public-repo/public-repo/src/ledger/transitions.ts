import type {
  WorkEntityRecordMap,
} from '../types/index.js';

export type TransitionValidatedEntityKind = Exclude<keyof WorkEntityRecordMap, 'ledger'>;
type TransitionStatusMap = {
  [K in TransitionValidatedEntityKind]: WorkEntityRecordMap[K]['status'];
};
type TransitionValidatedStatus = TransitionStatusMap[TransitionValidatedEntityKind];

type TransitionMap = {
  [K in TransitionValidatedEntityKind]: Record<TransitionStatusMap[K], readonly TransitionStatusMap[K][]>;
};

export const workEntityStatusTransitions: TransitionMap = {
  change: {
    draft: ['active', 'archived'],
    active: ['blocked', 'in_review', 'done', 'archived'],
    blocked: ['active', 'archived'],
    in_review: ['active', 'blocked', 'done', 'archived'],
    done: ['archived'],
    archived: [],
  },
  spec: {
    draft: ['active', 'archived'],
    active: ['review_ready', 'superseded', 'archived'],
    review_ready: ['active', 'approved', 'superseded', 'archived'],
    approved: ['superseded', 'archived'],
    superseded: ['archived'],
    archived: [],
  },
  slice: {
    draft: ['queued', 'ready', 'cancelled'],
    queued: ['ready', 'in_progress', 'blocked', 'cancelled'],
    ready: ['queued', 'in_progress', 'blocked', 'cancelled'],
    in_progress: ['blocked', 'done', 'cancelled'],
    blocked: ['queued', 'ready', 'cancelled'],
    done: [],
    cancelled: [],
  },
  run: {
    created: ['running', 'blocked', 'cancelled'],
    running: ['verifying', 'blocked', 'succeeded', 'failed', 'cancelled'],
    verifying: ['blocked', 'succeeded', 'failed', 'cancelled'],
    blocked: ['running', 'cancelled', 'failed'],
    succeeded: [],
    failed: [],
    cancelled: [],
  },
  gate: {
    pending: ['approved', 'rejected', 'cancelled'],
    approved: [],
    rejected: [],
    cancelled: [],
  },
};

export function listAllowedStatusTransitions(
  kind: TransitionValidatedEntityKind,
  from: TransitionValidatedStatus,
): readonly TransitionValidatedStatus[] {
  const transitions = workEntityStatusTransitions[kind] as Record<TransitionValidatedStatus, readonly TransitionValidatedStatus[]>;
  return transitions[from] || [];
}

export function isValidStatusTransition(
  kind: TransitionValidatedEntityKind,
  from: TransitionValidatedStatus,
  to: TransitionValidatedStatus,
): boolean {
  if (from === to) {
    return true;
  }

  return listAllowedStatusTransitions(kind, from).includes(to);
}

export function assertValidStatusTransition(
  kind: TransitionValidatedEntityKind,
  from: TransitionValidatedStatus,
  to: TransitionValidatedStatus,
  context?: { entityId?: string; projectId?: string },
): void {
  if (isValidStatusTransition(kind, from, to)) {
    return;
  }

  const location = [
    context?.projectId ? `project '${context.projectId}'` : '',
    context?.entityId ? `id '${context.entityId}'` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const allowed = listAllowedStatusTransitions(kind, from);
  const allowedSummary = allowed.length > 0 ? allowed.join(', ') : 'no further transitions';
  const locationPrefix = location ? ` for ${location}` : '';

  throw new Error(
    `Invalid ${kind} status transition${locationPrefix}: '${from}' -> '${to}'. Allowed next statuses: ${allowedSummary}.`,
  );
}
