import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = new URL('../node_modules/e2e/dist/cli/bin.js', import.meta.url);
const child = spawn(process.execPath, [fileURLToPath(runner), 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
