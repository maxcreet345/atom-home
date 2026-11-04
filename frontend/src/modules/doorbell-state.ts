import type { StateRow } from '../model/registry.ts';
import type { ModuleEntities, ModuleOptions, TileState } from './types.ts';
import { DOORBELL_ROLES } from './catalog.ts';
/** Pure helpers of the doorbell module (testable under Node): claims, the tile line, auto-open settings, logbook rows → events, relative time. */
export const doorbellClaims = (entities: ModuleEntities): string[] => DOORBELL_ROLES.map(r => entities[r.role]).filter((id): id is string => !!id);
export const RING_FRESH_MS = 60_000, AUTO_OPEN_CHOICES = [30, 60, 120] as const;
/** Seconds the sheet stays open after a ring; 0 = auto-open off. */
export function autoOpenSeconds(options: ModuleOptions): number {
  if (options.autoOpen === 'off') return 0;
  const n = Number(options.autoOpenSec);
  return (AUTO_OPEN_CHOICES as readonly number[]).includes(n) ? n : 60;
}
export const posterEnabled = (options: ModuleOptions) => options.poster !== 'off';
const ms = (iso: string | undefined) => { const v = iso ? Date.parse(iso) : NaN; return Number.isFinite(v) ? v : null; };
type Tx = (key: string, params?: Record<string, string | number>) => string;
/** «5 мин назад» / «2 ч назад» / «вчера» / date — for the tile line and the events list. */
export function ago(at: number, now: number, tx: Tx, lang: string): string {
  const d = now - at;
  if (d < 90_000) return tx('time.justNow');
  if (d < 3_600_000) return tx('time.minAgo', { n: Math.round(d / 60_000) });
  if (d < 86_400_000) return tx('time.hoursAgo', { n: Math.round(d / 3_600_000) });
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(at);
}
export const locale = (lang: string) => lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB';
export const clock = (at: number, lang: string) => new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(at);
/** Time of an event: today → 10:52; yesterday → «вчера 21:27»; older → «пн 3 нояб., 18:02». */
export function when(at: number, now: number, tx: Tx, lang: string): string {
  const a = new Date(at), n = new Date(now), sameDay = a.toDateString() === n.toDateString();
  if (sameDay) return clock(at, lang);
  const y = new Date(now - 86_400_000);
  if (a.toDateString() === y.toDateString()) return `${tx('time.yesterday')} ${clock(at, lang)}`;
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
}
/** Tile line: a ring in the last minute (red, badge), motion right now, low battery, otherwise «Тихо · движение N мин назад». */
export function doorbellTileState(states: Record<string, StateRow>, entities: ModuleEntities, tx: Tx, lang: string, now = Date.now()): TileState {
  const s = (role: string) => { const id = entities[role]; return id ? states[id] : undefined; };
  const ring = s('ring'), ringAt = ms(ring?.state);
  if (ringAt !== null && now - ringAt < RING_FRESH_MS && now - ringAt >= 0) return { line: tx('module.doorbell.ringAt', { time: clock(ringAt, lang) }), closed: false, icon: 'bell', tone: 'danger' };
  const motion = s('motion');
  if (motion?.state === 'on') return { line: tx('module.doorbell.motionNow'), closed: false, icon: 'motion' };
  const bat = Number(s('battery')?.state);
  if (Number.isFinite(bat) && bat < 20) return { line: tx('module.doorbell.batteryLow', { n: bat }), closed: false, icon: null, tone: 'warning' };
  const motionAt = ms(motion?.last_changed);
  return { line: motionAt !== null && now - motionAt < 86_400_000 ? tx('module.doorbell.quietMotion', { ago: ago(motionAt, now, tx, lang) }) : tx('module.doorbell.quiet'), closed: false, icon: null };
}
export interface DoorEvent { kind: 'ring' | 'motion'; at: number }
/** HA `history/history_during_period` (minimal response: `{s, lc, lu}` rows per entity) → events, newest first. A ring is every new timestamp of the event entity, motion counts when it turns on; the first row (the state at the start of the window) is not an event. */
export function parseHistory(raw: unknown, entities: ModuleEntities, startMs: number): DoorEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: DoorEvent[] = [];
  const rowsOf = (id: string | undefined) => { const r = id ? (raw as Record<string, unknown>)[id] : undefined; return Array.isArray(r) ? r as Array<{ s?: unknown; lc?: unknown; lu?: unknown }> : []; };
  const at = (r: { lc?: unknown; lu?: unknown }) => { const v = typeof r.lc === 'number' ? r.lc : typeof r.lu === 'number' ? r.lu : NaN; return Number.isFinite(v) ? v * 1000 : NaN; };
  let prev: unknown;
  for (const r of rowsOf(entities.ring)) { const t = at(r); if (Number.isFinite(t) && t >= startMs && typeof r.s === 'string' && r.s !== 'unknown' && r.s !== 'unavailable' && r.s !== prev) out.push({ kind: 'ring', at: t }); prev = r.s; }
  for (const r of rowsOf(entities.motion)) { const t = at(r); if (Number.isFinite(t) && t >= startMs && r.s === 'on') out.push({ kind: 'motion', at: t }); }
  return out.sort((a, b) => b.at - a.at);
}
/** Where the panel keeps the last live frame of a stream (per browser). */
export const frameKey = (addon: string, stream: string) => `atom-home:frame:${addon}:${stream}`;
export function readFrame(addon: string, stream: string | undefined): { at: number; data: string } | null {
  if (!stream) return null;
  try { const raw = localStorage.getItem(frameKey(addon, stream)); if (!raw) return null; const v = JSON.parse(raw) as { at?: unknown; data?: unknown }; return typeof v.at === 'number' && typeof v.data === 'string' && v.data.startsWith('data:image/jpeg;base64,') ? { at: v.at, data: v.data } : null; } catch { return null; }
}
export function writeFrame(addon: string, stream: string | undefined, data: string): void {
  if (!stream) return;
  try { localStorage.setItem(frameKey(addon, stream), JSON.stringify({ at: Date.now(), data })); } catch { /* quota or private mode: the poster is a convenience */ }
}
