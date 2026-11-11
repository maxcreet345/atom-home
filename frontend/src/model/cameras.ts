import type { Registry, StateRow } from './registry.ts';
/** The house's cameras as one card and one panel (owner, 09.11.2026): what each camera saw lately and which of it matters most.
 * Pure: the tile, the panel and the tests share it. A ring outranks a person, a person outranks motion (the Air card's rule: the worst one sets the tone). */
export type CamEventKind = 'ring' | 'person' | 'vehicle' | 'pet' | 'motion';
export interface CamSensor { id: string; kind: CamEventKind }
export interface CamEvent { camera: string; kind: CamEventKind; at: number; active: boolean }
export type CamTone = 'danger' | 'warning' | 'active';
/** How long an event keeps the tile's colour and the focus after it ended. */
export const RECENT_MS = 2 * 60_000;
const RANK: Record<CamEventKind, number> = { ring: 4, person: 3, vehicle: 2, pet: 1, motion: 0 };
export const TONE: Record<CamEventKind, CamTone> = { ring: 'danger', person: 'warning', vehicle: 'warning', pet: 'active', motion: 'active' };
/** What a sensor next to a camera reports, by its id and class: the doorbell's ring, ONVIF's person / pet / vehicle detection, plain motion. */
export function sensorKind(entityId: string, deviceClass?: unknown): CamEventKind | null {
  if (entityId.startsWith('event.')) return deviceClass === 'doorbell' || /_ring$/.test(entityId) ? 'ring' : null;
  if (!entityId.startsWith('binary_sensor.')) return null;
  if (/person|human|people/.test(entityId)) return 'person';
  if (/vehicle|_car_/.test(entityId)) return 'vehicle';
  if (/_pet_|_pet$|animal/.test(entityId)) return 'pet';
  if (/motion|movement/.test(entityId) || deviceClass === 'motion' || deviceClass === 'occupancy') return 'motion';
  return null;
}
/** The sensors a module lists for a camera (its roles), in the order given; unknown roles are skipped. */
export function sensorsOf(registry: Registry, ids: Array<string | undefined>): CamSensor[] {
  return ids.filter((id): id is string => !!id && !!registry.states[id]).map(id => ({ id, kind: sensorKind(id, registry.states[id].attributes.device_class) })).filter((s): s is CamSensor => s.kind !== null);
}
const ms = (iso: string | undefined) => { const v = iso ? Date.parse(iso) : NaN; return Number.isFinite(v) ? v : NaN; };
/** The last thing each sensor says now: a ring's time is its state; a detection counts only while it is on.
 * An «off» with a fresh last change is not an event: HA resets every last change when it restarts (09.11.2026: «Человек · только что» right after a restart). A detection that just ended is kept by `holdEnded`, which saw it on. */
export function currentEvents(states: Record<string, StateRow>, camera: string, sensors: CamSensor[]): CamEvent[] {
  const out: CamEvent[] = [];
  for (const s of sensors) {
    const row = states[s.id]; if (!row || row.state === 'unavailable' || row.state === 'unknown') continue;
    if (s.kind === 'ring') { const at = ms(row.state); if (Number.isFinite(at)) out.push({ camera, kind: 'ring', at, active: false }); continue; }
    const at = ms(row.last_changed); if (!Number.isFinite(at) || row.state !== 'on') continue;
    out.push({ camera, kind: s.kind, at, active: true });
  }
  return out;
}
/** Detections this screen saw on and that have since ended stay for two minutes, timed from when they ended (the tile keeps the camera and the colour a moment longer).
 * `seen` lives as long as the screen; it is updated in place. */
export function holdEnded(seen: Map<string, CamEvent>, events: CamEvent[], now: number): CamEvent[] {
  const key = (e: CamEvent) => `${e.camera}|${e.kind}`, live = new Set(events.filter(e => e.active).map(key));
  for (const e of events) if (e.active) seen.set(key(e), e);
  for (const [k, e] of [...seen]) {
    if (live.has(k)) continue;
    if (e.active) seen.set(k, { ...e, active: false, at: now });
    else if (now - e.at > RECENT_MS) seen.delete(k);
  }
  return [...events, ...[...seen.entries()].filter(([k, e]) => !live.has(k) && !e.active).map(([, e]) => e)];
}
/** Worst of what is happening or just happened: an active detection or one that ended under two minutes ago, a ring under two minutes ago.
 * A ring carries the HOUSE's time (its state is the timestamp): its age is counted from `ringNow`, the house's clock (`houseTime`), where the caller has one —
 * on a tablet whose own clock is minutes off the ring would otherwise come late or never. A detection's time is this device's own (`holdEnded`). */
export function topEvent(events: CamEvent[], now: number, ringNow: number = now): CamEvent | null {
  const fresh = events.filter(e => e.active || (e.kind === 'ring' ? ringNow : now) - e.at <= RECENT_MS);
  return fresh.sort((a, b) => RANK[b.kind] - RANK[a.kind] || Number(b.active) - Number(a.active) || b.at - a.at)[0] ?? null;
}
/** The camera the home tile shows big: the one with the worst fresh event, else the owner's main camera. */
export function focusCamera(main: string | null, events: CamEvent[], now: number, ringNow: number = now): string | null { return topEvent(events, now, ringNow)?.camera ?? main; }
/** Rings and detections of the last hours from HA's recorder (`history/history_during_period`, minimal response), newest first. A detection counts once when it turns on; two sensors of one camera reporting the same kind within 10 s (ONVIF motion alarm and cell motion) are one event. */
export function historyEvents(raw: unknown, sensors: Array<CamSensor & { camera: string }>, startMs: number): CamEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: CamEvent[] = [];
  for (const s of sensors) {
    const rows = (raw as Record<string, unknown>)[s.id]; if (!Array.isArray(rows)) continue;
    // The first row of an entity is its state at the start of the window (HA stamps it with the window's own start), not something that happened.
    // A ring is a NEW timestamp of the event entity (one not seen in this window and not older than it): the entity coming back from «unavailable» (HA restarted, the bell lost Wi-Fi) repeats the old one.
    // A detection counts when it turns on after a real «off»: on → unavailable → on is one detection.
    let prev: unknown; const rung = new Set<string>();
    for (const r of rows as Array<{ s?: unknown; lc?: unknown; lu?: unknown }>) {
      const t = (typeof r.lc === 'number' ? r.lc : typeof r.lu === 'number' ? r.lu : NaN) * 1000, real = typeof r.s === 'string' && r.s !== 'unknown' && r.s !== 'unavailable';
      if (!Number.isFinite(t) || t <= startMs) { if (real) { prev = r.s; if (s.kind === 'ring') rung.add(r.s as string); } continue; }
      if (!real) continue;
      if (s.kind === 'ring') { const own = Date.parse(r.s as string); if (!rung.has(r.s as string) && !(own <= startMs)) out.push({ camera: s.camera, kind: s.kind, at: t, active: false }); rung.add(r.s as string); }
      else if (r.s === 'on' && prev !== 'on') out.push({ camera: s.camera, kind: s.kind, at: t, active: false });
      prev = r.s;
    }
  }
  out.sort((a, b) => b.at - a.at);
  return out.filter((e, i) => !out.slice(Math.max(0, i - 4), i).some(p => p.camera === e.camera && p.kind === e.kind && Math.abs(p.at - e.at) < 10_000));
}
/** The Cameras panel's events filter as the page's address keeps it (`#camera?filter=ring`); anything else is «all». */
export type CamEventFilter = 'all' | 'ring' | 'person' | 'motion';
export const eventFilter = (raw: string | null | undefined): CamEventFilter => raw === 'ring' || raw === 'person' || raw === 'motion' ? raw : 'all';
/** «сейчас», «3 мин», «1 ч»: how long ago, short enough for a tile's second line. */
export function ago(at: number, now: number): { n: number; unit: 'now' | 'min' | 'h' | 'd' } {
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return { n: 0, unit: 'now' };
  if (m < 60) return { n: m, unit: 'min' };
  const h = Math.floor(m / 60); return h < 24 ? { n: h, unit: 'h' } : { n: Math.floor(h / 24), unit: 'd' };
}
/** Does this change of a ring entity open the doorbell sheet? Only a real ring: a NEW timestamp, later than the one before, and fresh by the house's own clock
 * (`houseNow`: the newest `last_updated` among the states, so a tablet with a wrong clock still opens). The entity coming back from «unavailable» / «unknown»,
 * HA restarting, the panel reconnecting with an hour-old ring — none of these is someone at the door. */
export const RING_OPEN_MS = 120_000;
export function ringOpens(before: string | undefined, after: string | undefined, houseNow: number): boolean {
  const at = after ? Date.parse(after) : NaN; if (!Number.isFinite(at) || before === after) return false;
  const was = before ? Date.parse(before) : NaN; if (Number.isFinite(was) && at <= was) return false;
  return !Number.isFinite(houseNow) || houseNow - at < RING_OPEN_MS;
}
/** The house's own «now»: the newest update among its states (a wall tablet's clock may be minutes off). */
export function houseNow(states: Record<string, StateRow>): number {
  let max = NaN; for (const id in states) { const v = Date.parse(states[id].last_updated); if (Number.isFinite(v) && !(v <= max)) max = v; }
  return max;
}
/** `ringOpens` with a memory, per ring entity: one ring opens the sheet ONCE.
 * - the bell dropped off and came back with the SAME stamp (younger than two minutes) — that ring was already shown;
 * - nothing was tracked before (`before` is empty: auto-open was just switched on, the entity has just appeared) — a stamp is a ring only when it is
 *   later than one this panel has already seen for the bell (a reconnect that brought a new ring); with nothing to compare with it is the bell's old state.
 * A real ring always carries a new stamp, so none is missed. `memory` is the panel's own; a test hands its own. */
export type RingMemory = Map<string, number[]>;
const ringMemory: RingMemory = new Map();
export function ringOpensOnce(entityId: string, before: string | undefined, after: string | undefined, houseNow: number, memory: RingMemory = ringMemory): boolean {
  const seen = memory.get(entityId) ?? [], at = after ? Date.parse(after) : NaN, was = before ? Date.parse(before) : NaN;
  const untracked = before === undefined || before === '';
  const opens = ringOpens(before, after, houseNow) && !seen.includes(at) && (!untracked || (seen.length > 0 && at > Math.max(...seen)));
  for (const v of [was, at]) if (Number.isFinite(v) && !seen.includes(v)) seen.push(v);
  memory.set(entityId, seen.slice(-20));
  return opens;
}
/** The house's clock as this device can tell it: its own clock plus how far the house is ahead of it. The difference is measured only at the moment a NEW
 * state arrives while the panel is watching (the newest `last_updated` moved on: that stamp is «now» in the house); the states the panel started with say
 * nothing — the newest of them may be minutes old in a quiet house. A difference under ten seconds is the same clock (delivery, a batch of updates).
 * Until the first measurement, and without states, it is the device's clock. */
export const SKEW_IGNORED_MS = 10_000;
export function houseClock(): (states: Record<string, StateRow>, deviceNow?: number) => number {
  let read: unknown = null, newest = NaN, skew = 0;
  return (states, deviceNow = Date.now()) => {
    if (states !== read) { read = states; const h = houseNow(states);
      if (Number.isFinite(h)) { if (h > newest) { const d = h - deviceNow; skew = Math.abs(d) < SKEW_IGNORED_MS ? 0 : d; } if (!(h <= newest)) newest = h; } }
    return deviceNow + skew;
  };
}
/** The panel's one house clock (see `houseClock`): the doorbell's «Звонок в …» line and the Cameras card ask it how old a ring is. */
export const houseTime = houseClock();
