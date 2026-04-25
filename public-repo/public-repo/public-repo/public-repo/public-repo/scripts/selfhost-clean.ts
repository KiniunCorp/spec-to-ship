import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');
const localRuntimePath = path.join(root, '.s2s');

function main(): void {
  if (!existsSync(pkgPath)) {
    throw new Error('package.json not found in current path. Run from repo root.');
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
  if (pkg.name !== 'spec-to-ship') {
    throw new Error(`Unexpected package name '${pkg.name || ''}'. Refusing to clean self-host state.`);
  }

  rmSync(localRuntimePath, { recursive: true, force: true });
  console.log(`Removed local runtime state: ${localRuntimePath}`);
}

main();
