import { createIdentifiedEntityStore } from './entity-store.js';

const store = createIdentifiedEntityStore('change');

export const getChange = store.get;
export const requireChange = store.require;
export const listChanges = store.list;
export const changeExists = store.exists;
export const saveChange = store.save;
export const createChange = store.create;
export const updateChange = store.update;
export const deleteChange = store.delete;
