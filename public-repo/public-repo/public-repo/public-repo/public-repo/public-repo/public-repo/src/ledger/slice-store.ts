import { createIdentifiedEntityStore } from './entity-store.js';

const store = createIdentifiedEntityStore('slice');

export const getSlice = store.get;
export const requireSlice = store.require;
export const listSlices = store.list;
export const sliceExists = store.exists;
export const saveSlice = store.save;
export const createSlice = store.create;
export const updateSlice = store.update;
export const deleteSlice = store.delete;
