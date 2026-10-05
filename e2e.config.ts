import type { E2EConfig } from 'e2e';

export default {
  projectId: 'voiceops-backend',
  targets: [{ name: 'backend', platform: 'api' }],
  tests: ['tests/e2e/*.e2e.ts'],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  cleanupTimeout: 10_000,
  trace: 'off',
  output: 'artifacts/e2e',
  reporters: ['list', 'junit', 'markdown'],
} satisfies E2EConfig;
