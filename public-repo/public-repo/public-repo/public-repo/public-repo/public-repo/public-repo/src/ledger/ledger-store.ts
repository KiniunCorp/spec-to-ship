import { deleteWorkEntityArtifact, readWorkEntityArtifact, writeWorkEntityArtifact } from '../artifacts/store.js';
import type { WorkLedger } from '../types/index.js';

function missingLedgerMessage(projectId: string): string {
  return `No ledger record exists for project '${projectId}'.`;
}

function existingLedgerMessage(projectId: string): string {
  return `A ledger record already exists for project '${projectId}'.`;
}

export function getLedger(projectId: string): WorkLedger | null {
  return readWorkEntityArtifact(projectId, 'ledger');
}

export function requireLedger(projectId: string): WorkLedger {
  const ledger = getLedger(projectId);
  if (!ledger) {
    throw new Error(missingLedgerMessage(projectId));
  }
  return ledger;
}

export function ledgerExists(projectId: string): boolean {
  return getLedger(projectId) !== null;
}

export function saveLedger(ledger: WorkLedger): WorkLedger {
  writeWorkEntityArtifact(ledger.projectId, 'ledger', ledger);
  return ledger;
}

export function createLedger(ledger: WorkLedger): WorkLedger {
  if (ledgerExists(ledger.projectId)) {
    throw new Error(existingLedgerMessage(ledger.projectId));
  }
  return saveLedger(ledger);
}

export function updateLedger(ledger: WorkLedger): WorkLedger {
  if (!ledgerExists(ledger.projectId)) {
    throw new Error(missingLedgerMessage(ledger.projectId));
  }
  return saveLedger(ledger);
}

export function deleteLedger(projectId: string): boolean {
  return deleteWorkEntityArtifact(projectId, 'ledger');
}
