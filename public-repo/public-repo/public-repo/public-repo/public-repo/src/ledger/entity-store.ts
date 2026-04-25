import { deleteWorkEntityArtifact, listWorkEntityArtifacts, readWorkEntityArtifact, writeWorkEntityArtifact } from '../artifacts/store.js';
import type { WorkEntityKind, WorkEntityRecord } from '../types/index.js';
import { assertValidStatusTransition } from './transitions.js';

type StoredEntityKind = Exclude<WorkEntityKind, 'ledger'>;
type IdentifiedEntity<K extends StoredEntityKind> = {
  id: string;
  projectId: string;
  status: WorkEntityRecord<K>['status'];
};

export interface IdentifiedEntityStore<K extends StoredEntityKind, T extends WorkEntityRecord<K> & IdentifiedEntity<K>> {
  get(projectId: string, entityId: string): T | null;
  require(projectId: string, entityId: string): T;
  list(projectId: string): T[];
  exists(projectId: string, entityId: string): boolean;
  save(record: T): T;
  create(record: T): T;
  update(record: T): T;
  delete(projectId: string, entityId: string): boolean;
}

function missingRecordMessage(kind: StoredEntityKind, projectId: string, entityId: string): string {
  return `No ${kind} record exists for project '${projectId}' with id '${entityId}'.`;
}

function existingRecordMessage(kind: StoredEntityKind, projectId: string, entityId: string): string {
  return `A ${kind} record already exists for project '${projectId}' with id '${entityId}'.`;
}

export function createIdentifiedEntityStore<K extends StoredEntityKind>(
  kind: K,
): IdentifiedEntityStore<K, WorkEntityRecord<K> & IdentifiedEntity<K>> {
  type RecordType = WorkEntityRecord<K> & IdentifiedEntity<K>;

  const get = (projectId: string, entityId: string): RecordType | null =>
    readWorkEntityArtifact(projectId, kind, entityId) as RecordType | null;

  const require = (projectId: string, entityId: string): RecordType => {
    const record = get(projectId, entityId);
    if (!record) {
      throw new Error(missingRecordMessage(kind, projectId, entityId));
    }
    return record;
  };

  const list = (projectId: string): RecordType[] => listWorkEntityArtifacts(projectId, kind) as RecordType[];

  const exists = (projectId: string, entityId: string): boolean => get(projectId, entityId) !== null;

  const save = (record: RecordType): RecordType => {
    const current = get(record.projectId, record.id);
    if (current) {
      assertValidStatusTransition(kind, current.status, record.status, {
        entityId: record.id,
        projectId: record.projectId,
      });
    }

    writeWorkEntityArtifact(record.projectId, kind, record, record.id);
    return record;
  };

  const create = (record: RecordType): RecordType => {
    if (exists(record.projectId, record.id)) {
      throw new Error(existingRecordMessage(kind, record.projectId, record.id));
    }
    return save(record);
  };

  const update = (record: RecordType): RecordType => {
    if (!exists(record.projectId, record.id)) {
      throw new Error(missingRecordMessage(kind, record.projectId, record.id));
    }
    return save(record);
  };

  const remove = (projectId: string, entityId: string): boolean => deleteWorkEntityArtifact(projectId, kind, entityId);

  return {
    get,
    require,
    list,
    exists,
    save,
    create,
    update,
    delete: remove,
  };
}
