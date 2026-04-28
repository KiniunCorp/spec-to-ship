import { createIdentifiedEntityStore } from './entity-store.js';

const store = createIdentifiedEntityStore('gate');

export const getGate = store.get;
export const requireGate = store.require;
export const listGates = store.list;
export const gateExists = store.exists;
export const saveGate = store.save;
export const createGate = store.create;
export const updateGate = store.update;
export const deleteGate = store.delete;
