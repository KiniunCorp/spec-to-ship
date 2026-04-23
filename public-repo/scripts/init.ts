import { initProject } from '../src/index.js';

const r = await initProject(
  'A collaborative app that helps distributed teams collect daily updates asynchronously with clear status, blockers, and action tracking.',
  'demo-project'
);
console.log(JSON.stringify(r, null, 2));
