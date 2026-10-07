export type CapabilityRole = 'operator' | 'technician';
export type RateLimitConfig = Readonly<{
  windowMs: number;
  allPerWindow: number;
  writesPerWindow: number;
}>;
export const defaultRateLimits: RateLimitConfig = {
  windowMs: 60_000,
  allPerWindow: 120,
  writesPerWindow: 30
};
type Counter = { startMs: number; count: number };
type Snapshot = Readonly<{ limit: number; remaining: number; resetAfterSeconds: number }>;
type Admission =
  | Readonly<{ kind: 'admitted'; snapshot: Snapshot }>
  | Readonly<{ kind: 'limited'; snapshot: Snapshot }>;

export function makeRateLimiter(config: RateLimitConfig) {
  const counter = (): Counter => ({ startMs: performance.now(), count: 0 });
  const counters: Record<CapabilityRole, { all: Counter; write: Counter }> = {
    operator: { all: counter(), write: counter() },
    technician: { all: counter(), write: counter() }
  };
  return {
    admit(role: CapabilityRole, method: string): Admission {
      const now = performance.now();
      const applicable = [{ counter: counters[role].all, limit: config.allPerWindow }];
      if (method !== 'GET') applicable.push({ counter: counters[role].write, limit: config.writesPerWindow });
      for (const { counter } of applicable) {
        if (now - counter.startMs >= config.windowMs) {
          counter.startMs = now;
          counter.count = 0;
        }
      }
      const snapshot = ({ counter, limit }: typeof applicable[number]): Snapshot => ({
        limit,
        remaining: limit - counter.count,
        resetAfterSeconds: Math.max(1, Math.ceil((counter.startMs + config.windowMs - now) / 1000))
      });
      const exhausted = applicable.filter(({ counter, limit }) => counter.count >= limit);
      if (exhausted.length > 0) {
        const snapshots = exhausted.map(snapshot);
        return { kind: 'limited', snapshot: snapshots.reduce((a, b) => a.resetAfterSeconds >= b.resetAfterSeconds ? a : b) };
      }
      for (const { counter } of applicable) counter.count++;
      const snapshots = applicable.map(snapshot);
      return { kind: 'admitted', snapshot: snapshots.reduce((a, b) => a.remaining <= b.remaining ? a : b) };
    }
  };
}
