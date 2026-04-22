import { createIdentifiedEntityStore } from './entity-store.js';

const store = createIdentifiedEntityStore('spec');

export const getSpec = store.get;
export const requireSpec = store.require;
export const listSpecs = store.list;
export const specExists = store.exists;
export const saveSpec = store.save;
export const createSpec = store.create;
export const updateSpec = store.update;
export const deleteSpec = store.delete;
