import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('artifacts', { recursive: true });
execFileSync('git', ['archive', '--format=tar.gz', '--output=artifacts/voiceops-source.tar.gz', 'HEAD'], { stdio: 'inherit' });
process.stdout.write('Created artifacts/voiceops-source.tar.gz from HEAD.\n');
