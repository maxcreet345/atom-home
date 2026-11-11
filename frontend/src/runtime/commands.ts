import type { Host } from './host.ts';

/** A command the panel itself did not send: the house is unreachable. `errorText` turns it into «Нет связи с домом». */
export class CommandError extends Error {
  readonly code: 'offline';
  constructor(code: 'offline' = 'offline') { super(code); this.code = code; this.name = 'CommandError'; }
}
export interface RunOptions {
  /** A slider that streams values: a newer value may overlap the one still on its way (no «already pending» drop). */
  stream?: boolean;
  /** After the house accepted the command the key stays pending until this says the new state has arrived, or `untilMs` (4 s) passed. */
  until?: () => boolean;
  untilMs?: number;
  /** The caller shows the refusal in its own place (a line in its card): it gets the ready sentence and no toast is shown. */
  onError?: (text: string, error: unknown) => void;
}
/** The one way a command leaves the panel (audit 2026-11-09): nothing is sent while the house is offline, a second identical
 * command is dropped while the first is on its way, the key is pending meanwhile, a refusal is told in the user's language. */
export interface Commands {
  /** Keys with a command on its way; a new set on every change, so it can be compared by identity. */
  readonly busy: ReadonlySet<string>;
  pending(key: string): boolean;
  /** Runs `work` for `key`. Resolves true when the house accepted it, false when it was dropped (already pending), refused or
   * the house is offline; the refusal goes to `onError` or to the shell's toast. Never rejects. */
  run(key: string, work: () => Promise<unknown>, options?: RunOptions): Promise<boolean>;
  /** `host.call` with the same guard for code that keeps its own error line: rejects with CommandError while offline (nothing is
   * sent), and an identical call still on its way is not sent again — both callers get the first one's answer. */
  call(domain: string, service: string, data: Record<string, unknown>): Promise<void>;
}
export interface CommandDeps {
  /** The current host (read on every command: the live host's `online` is a getter over the newest `hass`). */
  host: () => Pick<Host, 'call' | 'online'>;
  /** errorText of ui/format.ts with the current translator. */
  text: (error: unknown) => string;
  /** The shell's toast. */
  notify: (text: string) => void;
  /** Called after `busy` changed (the shell re-renders). */
  changed?: (busy: ReadonlySet<string>) => void;
}
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map(k => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'undefined';
export function createCommands(deps: CommandDeps): Commands {
  const counts = new Map<string, number>(), inflight = new Map<string, Promise<void>>(), last = new Map<string, string>();
  let busy: ReadonlySet<string> = new Set();
  const publish = () => { busy = new Set(counts.keys()); deps.changed?.(busy); };
  // the shell is told (and redraws) only when the SET of keys changes: a slider that streams overlapping values is one «busy», not one per value
  const hold = (key: string) => { const n = counts.get(key) ?? 0; counts.set(key, n + 1); if (!n) publish(); };
  const release = (key: string) => { const n = (counts.get(key) ?? 1) - 1; if (n > 0) counts.set(key, n); else { counts.delete(key); publish(); } };
  const settle = (until: () => boolean, ms: number) => new Promise<void>(done => {
    const t0 = Date.now(), look = () => { let ok = false; try { ok = until(); } catch { ok = true; } if (ok || Date.now() - t0 >= ms) done(); else setTimeout(look, 100); };
    look();
  });
  const refuse = (e: unknown, o: RunOptions) => { let text: string; try { text = deps.text(e); } catch { text = ''; } try { if (o.onError) o.onError(text, e); else if (text) deps.notify(text); } catch { /* telling about a refusal must not throw one more */ } };
  return {
    get busy() { return busy; },
    pending: key => counts.has(key),
    async run(key, work, o = {}) {
      if (!o.stream && counts.has(key)) return false;
      if (!deps.host().online) { refuse(new CommandError('offline'), o); return false; }
      hold(key);
      try { await work(); if (o.until && !o.stream) await settle(o.until, o.untilMs ?? 4000); return true; }
      catch (e) { refuse(e, o); return false; }
      finally { release(key); }
    },
    call(domain, service, data) {
      const host = deps.host();
      if (!host.online) return Promise.reject(new CommandError('offline'));
      // An identical call is joined only with the LAST one sent to the same target while that is still on its way. Brightness 60 → 100 → 60
      // within one answer: the third is not «the first again» (the lamp would stay at 100), it is a new command and goes out.
      const sig = `${domain}.${service}:${stable(data)}`, target = data.entity_id !== undefined ? `e:${stable(data.entity_id)}` : `s:${domain}.${service}`, running = inflight.get(sig);
      if (running && last.get(target) === sig) return running;
      last.set(target, sig);
      let p: Promise<void>;
      try { p = Promise.resolve(host.call(domain, service, data)).then(() => undefined); } catch (e) { p = Promise.reject(e); }
      const tracked = p.finally(() => { if (inflight.get(sig) === tracked) { inflight.delete(sig); if (last.get(target) === sig) last.delete(target); } });
      inflight.set(sig, tracked);
      return tracked;
    },
  };
}
/** The host the cards get: everything of `host`, but `call` goes through the guard above. Keep one per host (effects are keyed on it). */
export function guardHost<H extends Host>(host: H, commands: Pick<Commands, 'call'>): H {
  return new Proxy(host, { get: (target, prop) => prop === 'call' ? commands.call : Reflect.get(target, prop, target) }) as H;
}
