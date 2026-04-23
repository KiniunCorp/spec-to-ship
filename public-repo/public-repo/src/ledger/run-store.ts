import { createIdentifiedEntityStore } from './entity-store.js';

const store = createIdentifiedEntityStore('run');

export const getRun = store.get;
export const requireRun = store.require;
export const listRuns = store.list;
export const runExists = store.exists;
export const saveRun = store.save;
export const createRun = store.create;
export const updateRun = store.update;
export const deleteRun = store.delete;
