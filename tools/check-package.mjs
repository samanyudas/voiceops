import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'voiceops-package-'));
try {
  execFileSync('tar', ['-xzf', resolve('artifacts/voiceops-source.tar.gz'), '-C', directory]);
  for (const name of ['package-lock.json', 'AGENTS.md', 'tools/repository-policy.ts', 'docs/specs/voiceops.md']) {
    if (!existsSync(join(directory, name))) throw new Error(`Missing packaged file: ${name}`);
  }
  execFileSync('npm', ['ci', '--ignore-scripts'], { cwd: directory, stdio: 'inherit' });
  execFileSync('npm', ['run', 'verify'], { cwd: directory, stdio: 'inherit' });
  process.stdout.write('Packaged checkout installs and verifies successfully.\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
