/** A read the panel cannot do without (the registry, the house's settings), tried again until it works.
 * `run()` starts it unless one is already under way and resolves to whether it worked; a failure calls `failed`, then the next try is
 * scheduled by itself (2 s, 5 s, 15 s, then every 30 s) — the panel never sits on a failed load waiting for somebody to reload the page,
 * and never retries on every state change either. `stop()` ends it (the panel left the page). */
export const RETRY_MS = [2000, 5000, 15000, 30000];
export const nextDelay = (failures: number, delays: readonly number[] = RETRY_MS) => delays[Math.min(Math.max(failures, 1), delays.length) - 1];
export interface Loader { run(): Promise<boolean>; stop(): void; readonly waiting: boolean }
export function createLoader(read: () => Promise<void>, o: { failed?: (error: unknown) => void; settled?: () => void; delays?: readonly number[] } = {}): Loader {
  let running: Promise<boolean> | null = null, failures = 0, retry: ReturnType<typeof setTimeout> | null = null, stopped = false, epoch = 0;
  const run = (): Promise<boolean> => {
    stopped = false;
    if (running) return running;
    if (retry) { clearTimeout(retry); retry = null; }
    const mine = ++epoch;
    const p: Promise<boolean> = Promise.resolve().then(read).then(() => { failures = 0; return true; }, e => {
      if (!stopped && mine === epoch) { o.failed?.(e); failures++; retry = setTimeout(() => { retry = null; void run(); }, nextDelay(failures, o.delays)); }
      return false;
    }).finally(() => { if (running === p) running = null; if (!stopped && mine === epoch) o.settled?.(); });
    running = p;
    return p;
  };
  return { run, stop() { stopped = true; epoch++; running = null; if (retry) clearTimeout(retry); retry = null; }, get waiting() { return retry !== null; } };
}
