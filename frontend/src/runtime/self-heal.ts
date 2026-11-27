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

/** sessionStorage, or undefined where even reaching it throws (every cookie blocked) */
const session = (): Storage | undefined => { try { return globalThis.sessionStorage; } catch { return undefined; } };
function read(storage: Storage | undefined, key: string): string | null { try { return storage?.getItem(key) ?? null; } catch { return null; } }
/** False when the value could not be kept: a limit that cannot be remembered is not used (no reload without a memory of the last one). */
function write(storage: Storage | undefined, key: string, value: string): boolean { if (!storage) return false; try { storage.setItem(key, value); return storage.getItem(key) === value; } catch { return false; } }

/** True when one more reload after a crash is allowed now; records it. */
export function mayReloadAfterCrash(now = Date.now(), storage: Storage | undefined = session()): boolean {
  let past: number[] = [];
  try { const v = JSON.parse(read(storage, CRASH_KEY) ?? '[]'); if (Array.isArray(v)) past = v.filter((x): x is number => typeof x === 'number' && now - x < CRASH_WINDOW_MS); } catch { past = []; }
  if (past.length >= CRASH_MAX) return false;
  return write(storage, CRASH_KEY, JSON.stringify([...past, now]));
}

const numbers = (v: string) => (v.trim().match(/^\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
const pre = (v: string) => v.trim().replace(/^\d+(\.\d+)*/, '') !== '';
/** `server` is a strictly newer version than `panel`; a release is newer than its own pre-release («1.30.0» over «1.30.0-beta.1» or «1.30.0b1»). */
export function newerVersion(server: unknown, panel: unknown): boolean {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d+(\.\d+)+/.test(v.trim());
  if (!ok(server) || !ok(panel)) return false;
  const a = numbers(server), b = numbers(panel);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y; }
  return pre(panel) && !pre(server);
}

/** False when the page already reloaded for this server version and still runs the old bundle (a cache in the way): it does not try again. */
export function mayReloadForUpdate(serverVersion: string, storage: Storage | undefined = session()): boolean {
  return read(storage, UPDATE_KEY) !== serverVersion;
}
/** Called right before the reload (not when the wait starts: a panel left during the wait must still reload on its return); false when it cannot be remembered. */
export function markReloadForUpdate(serverVersion: string, storage: Storage | undefined = session()): boolean {
  return mayReloadForUpdate(serverVersion, storage) && write(storage, UPDATE_KEY, serverVersion);
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

/** At most this many reports a page goes to Home Assistant's log, so a fault in a loop does not flood it. Refusals (a save, a command the
 *  house turned down) have a budget of their own: five refused taps on a wall tablet must not silence a later crash. */
const REPORT_MAX = 5;
export const REFUSAL_MAX = 20;
/** One line for anything thrown: an Error by its name, the house's refusal ({ code, message }) by both. */
export function errorText(error: unknown): string {
  if (error instanceof Error) { const code = (error as { code?: unknown }).code; return `${error.name}${typeof code === 'string' ? ` (${code})` : ''}: ${error.message}`; }
  if (error && typeof error === 'object') { const { code, message } = error as { code?: unknown; message?: unknown }; if (code !== undefined || message !== undefined) return [code, message].filter(x => x !== undefined && x !== '').map(String).join(': '); }
  return String(error);
}
/** `max` reports a page; a refusal is not a fault of the panel (the person was told, the house's log has it), so its console line is `info`. */
export function errorReporter(send: (message: string, where: string, text: string) => Promise<unknown>, max = REPORT_MAX, level: 'error' | 'info' = 'error') {
  let sent = 0; const seen = new Set<string>();
  return (error: unknown, where: string) => {
    console[level](`[atom-home] ${level === 'info' ? 'refused ' : ''}${where}:`, error);
    const text = errorText(error);
    const key = `${where}|${text}`;
    if (seen.has(key) || sent >= max) return;
    seen.add(key); sent++;
    const stack = error instanceof Error && error.stack ? `\n${error.stack.split('\n').slice(0, 6).join('\n')}` : '';
    void send(`Atom Home panel (${where}): ${text}${stack}`.slice(0, 2000), where, `${text}${stack}`.slice(0, 1500)).catch(() => undefined);
  };
}
