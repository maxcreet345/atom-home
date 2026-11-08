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
/** Worst of what is happening or just happened: an active detection or one that ended under two minutes ago, a ring under two minutes ago. */
export function topEvent(events: CamEvent[], now: number): CamEvent | null {
  const fresh = events.filter(e => e.active || now - e.at <= RECENT_MS);
  return fresh.sort((a, b) => RANK[b.kind] - RANK[a.kind] || Number(b.active) - Number(a.active) || b.at - a.at)[0] ?? null;
}
/** The camera the home tile shows big: the one with the worst fresh event, else the owner's main camera. */
export function focusCamera(main: string | null, events: CamEvent[], now: number): string | null { return topEvent(events, now)?.camera ?? main; }
/** Rings and detections of the last hours from HA's recorder (`history/history_during_period`, minimal response), newest first. A detection counts once when it turns on; two sensors of one camera reporting the same kind within 10 s (ONVIF motion alarm and cell motion) are one event. */
export function historyEvents(raw: unknown, sensors: Array<CamSensor & { camera: string }>, startMs: number): CamEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: CamEvent[] = [];
  for (const s of sensors) {
    const rows = (raw as Record<string, unknown>)[s.id]; if (!Array.isArray(rows)) continue;
    let prev: unknown;
    for (const r of rows as Array<{ s?: unknown; lc?: unknown; lu?: unknown }>) {
      const t = (typeof r.lc === 'number' ? r.lc : typeof r.lu === 'number' ? r.lu : NaN) * 1000;
      if (!Number.isFinite(t) || t < startMs) { prev = r.s; continue; }
      if (s.kind === 'ring' ? typeof r.s === 'string' && r.s !== 'unknown' && r.s !== 'unavailable' && r.s !== prev : r.s === 'on') out.push({ camera: s.camera, kind: s.kind, at: t, active: false });
      prev = r.s;
    }
  }
  out.sort((a, b) => b.at - a.at);
  return out.filter((e, i) => !out.slice(Math.max(0, i - 4), i).some(p => p.camera === e.camera && p.kind === e.kind && Math.abs(p.at - e.at) < 10_000));
}
/** «сейчас», «3 мин», «1 ч»: how long ago, short enough for a tile's second line. */
export function ago(at: number, now: number): { n: number; unit: 'now' | 'min' | 'h' | 'd' } {
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return { n: 0, unit: 'now' };
  if (m < 60) return { n: m, unit: 'min' };
  const h = Math.floor(m / 60); return h < 24 ? { n: h, unit: 'h' } : { n: Math.floor(h / 24), unit: 'd' };
}
