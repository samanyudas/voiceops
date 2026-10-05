import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
for (const directory of ['dist', 'coverage']) {
  rmSync(new URL(`../${directory}/`, import.meta.url), { recursive: true, force: true });
}
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
if (existsSync(artifacts)) {
  for (const entry of readdirSync(artifacts)) {
    if (entry === 'elevenlabs') continue;
    rmSync(join(artifacts, entry), { recursive: true, force: true });
  }
}
