/** C-1 and H-2 of the audit of 17.11.2026: a wall tablet runs for weeks with nobody at it. When the panel cannot draw at all, or the
 *  integration in Home Assistant is newer than the bundle in the page, the page reloads itself — at most a few times, so a fault that
 *  survives a reload never turns into a reload loop. */

const CRASH_KEY = 'atom-home-crash-reloads';
const UPDATE_KEY = 'atom-home-update-reload';
/** reloads after a crash allowed within this window */
const CRASH_WINDOW_MS = 15 * 60 * 1000;
const CRASH_MAX = 3;
/** a reload for a new version waits for this much quiet: nobody is touching the screen */
export const UPDATE_IDLE_MS = 30_000;

function read(storage: Storage | undefined, key: string): string | null { try { return storage?.getItem(key) ?? null; } catch { return null; } }
function write(storage: Storage | undefined, key: string, value: string) { try { storage?.setItem(key, value); } catch { /* private mode */ } }

/** True when one more reload after a crash is allowed now; records it. */
export function mayReloadAfterCrash(now = Date.now(), storage: Storage | undefined = globalThis.sessionStorage): boolean {
  let past: number[] = [];
  try { const v = JSON.parse(read(storage, CRASH_KEY) ?? '[]'); if (Array.isArray(v)) past = v.filter((x): x is number => typeof x === 'number' && now - x < CRASH_WINDOW_MS); } catch { past = []; }
  if (past.length >= CRASH_MAX) return false;
  write(storage, CRASH_KEY, JSON.stringify([...past, now]));
  return true;
}

const parts = (v: string) => v.trim().split(/[.+-]/).slice(0, 3).map(x => Number.parseInt(x, 10));
/** `server` is a strictly newer x.y.z than `panel`. */
export function newerVersion(server: unknown, panel: unknown): boolean {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d+(\.\d+)+/.test(v.trim());
  if (!ok(server) || !ok(panel)) return false;
  const a = parts(server), b = parts(panel);
  for (let i = 0; i < 3; i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y; }
  return false;
}

/** True once per server version: the page reloaded for it already and still runs the old bundle (a cache in the way), so it does not try again. */
export function mayReloadForUpdate(serverVersion: string, storage: Storage | undefined = globalThis.sessionStorage): boolean {
  if (read(storage, UPDATE_KEY) === serverVersion) return false;
  write(storage, UPDATE_KEY, serverVersion);
  return true;
}

/** Calls `run` once the page has had `idleMs` without a touch, a key or a scroll. Returns a cancel. */
export function whenIdle(run: () => void, idleMs = UPDATE_IDLE_MS, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(done, idleMs); };
  const stop = () => { if (timer) clearTimeout(timer); timer = null; for (const e of events) target.removeEventListener(e, arm, true); };
  const done = () => { stop(); run(); };
  for (const e of events) target.addEventListener(e, arm, { capture: true, passive: true });
  arm();
  return stop;
}

/** At most this many reports a page goes to Home Assistant's log, so a fault in a loop does not flood it. */
const REPORT_MAX = 5;
export function errorReporter(send: (message: string) => Promise<unknown>) {
  let sent = 0; const seen = new Set<string>();
  return (error: unknown, where: string) => {
    console.error(`[atom-home] ${where}:`, error);
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const key = `${where}|${text}`;
    if (seen.has(key) || sent >= REPORT_MAX) return;
    seen.add(key); sent++;
    const stack = error instanceof Error && error.stack ? `\n${error.stack.split('\n').slice(0, 6).join('\n')}` : '';
    void send(`Atom Home panel (${where}): ${text}${stack}`.slice(0, 2000)).catch(() => undefined);
  };
}
