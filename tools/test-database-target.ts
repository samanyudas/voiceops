const invalidTarget = 'Tests require a dedicated local Postgres database ending in _test, without URL query parameters or fragments.';

export function requireTestDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('TEST_DATABASE_URL is required.');
  let database: URL;
  try {
    database = new URL(value);
  } catch {
    throw new Error(invalidTarget);
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || !['127.0.0.1', 'localhost'].includes(database.hostname)
    || !/^\/[A-Za-z0-9_]+_test$/.test(database.pathname)
    || /[?#]/.test(value)) {
    throw new Error(invalidTarget);
  }
  return value;
}
