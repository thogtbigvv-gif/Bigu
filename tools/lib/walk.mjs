/* Recursive file listing by extension, sorted, so every tool that sweeps a
   directory reports in the same order run to run. */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function glob(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await glob(full, extension));
    else if (entry.name.endsWith(extension)) files.push(full);
  }

  return files.sort();
}

export { glob };
