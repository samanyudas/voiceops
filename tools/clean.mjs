import { rmSync } from 'node:fs';
for (const directory of ['dist', 'artifacts', 'coverage']) {
  rmSync(new URL(`../${directory}/`, import.meta.url), { recursive: true, force: true });
}
