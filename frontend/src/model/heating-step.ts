/* The − / + of the heating as plain logic (docs/HEATING.md): pure, so it is tested under Node; `useStepper` of ui/heating.tsx only holds it. */
export interface StepIO { send: (v: number) => Promise<unknown>; ok: () => void; fail: (error: unknown) => void }
export interface StepCore {
  /** A tap: `v` is shown at once and sent after the pause with the `io` of THIS tap (the mode and scenario the person saw), so five taps are
   * one command and leaving the screen within the pause still sends it to the right helper. `current` is what the house holds now:
   * stepping back to it with nothing on its way sends nothing. */
  push(v: number, io: StepIO, current: number | null): void;
  /** the house showed a new value: what was on its way has arrived (or was overruled) */ settled(): void;
  /** leaving the card: the last tap is sent now, nothing is shown any more */ flush(): void;
}
type Clock = { set: (f: () => void, ms: number) => unknown; clear: (id: unknown) => void };
const REAL: Clock = { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) };
/** `show(v)` puts the tapped value on screen, `show(null)` returns to the house's own. A refused command puts the real value back and reports;
 * an accepted one the house never reflects gives up after `giveUp` ms. */
export function stepCore(show: (v: number | null) => void, pause = 700, giveUp = 20000, clock: Clock = REAL): StepCore {
  let timer: unknown = null, stale: unknown = null, seq = 0, waiting: { v: number; io: StepIO } | null = null, onWay = false, dead = false;
  const put = (v: number | null) => { if (!dead) show(v); };
  const stop = () => { if (timer !== null) clock.clear(timer); if (stale !== null) clock.clear(stale); timer = stale = null; };
  const fire = () => {
    const w = waiting; if (!w) return; const n = ++seq; waiting = null; onWay = true;
    w.io.send(w.v).then(() => { if (n === seq) w.io.ok(); }, e => { if (n === seq) { onWay = false; put(null); w.io.fail(e); } });
    if (!dead) stale = clock.set(() => { if (n === seq) { onWay = false; put(null); } }, giveUp);
  };
  return {
    push(v, io, current) {
      stop(); seq++;
      if (v === current && !onWay) { waiting = null; put(null); return; }
      waiting = { v, io }; put(v); timer = clock.set(fire, pause);
    },
    settled() { onWay = false; },
    flush() { stop(); dead = true; fire(); },
  };
}
/** The next value of a tap: from the low end of a range for −, clamped, on the step's grid. */
export function stepValue(shown: number, local: number | null, dir: 1 | -1, min: number, max: number, by: number, lo?: number): number {
  const base = local ?? (dir < 0 && lo !== undefined ? lo : shown), v = Math.min(max, Math.max(min, Math.round((base + dir * by) / by) * by));
  return Math.round(v * 10) / 10;
}
