import type { StateRow } from '../model/registry.ts';
/** Pure helpers of the clock module (testable under Node): sun, timers, labels, week numbers, formatting. */
const ms = (iso: unknown) => { const v = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(v) ? v : null; };
export interface SunInfo { rise: number | null; set: number | null; dayMs: number | null; /** 0…1 across today's daylight, null at night */ frac: number | null; elevation: number | null; night: boolean; /** ms until the next sunset (day) or sunrise (night) */ untilNext: number | null }
/** Today's sunrise/sunset from HA's `sun.sun` (which only knows the *next* ones): by day the sunrise was ~24 h before the next one; at night before dawn both are today's. */
export function sunInfo(sun: StateRow | undefined, now: number): SunInfo {
  const a = sun?.attributes ?? {}; const nextRise = ms(a.next_rising), nextSet = ms(a.next_setting);
  const elevation = typeof a.elevation === 'number' ? a.elevation : null, night = sun?.state === 'below_horizon';
  if (nextRise === null || nextSet === null) return { rise: null, set: null, dayMs: null, frac: null, elevation, night, untilNext: null };
  let rise: number, set: number;
  const sameDay = new Date(nextRise).toDateString() === new Date(now).toDateString();
  if (!night) { set = nextSet; rise = nextRise - 86_400_000; }
  else if (sameDay) { rise = nextRise; set = nextSet; } // before dawn: both are today's
  else { rise = nextRise - 86_400_000; set = nextSet - 86_400_000; } // evening: both are tomorrow's
  const dayMs = set - rise, frac = night ? null : Math.max(0, Math.min(1, (now - rise) / dayMs));
  return { rise, set, dayMs, frac, elevation, night, untilNext: night ? nextRise - now : nextSet - now };
}
export interface TimerInfo { id: string; state: 'idle' | 'active' | 'paused' | 'unknown'; durationMs: number; remainingMs: number; finishesAt: number | null }
const hms = (v: unknown): number => { if (typeof v !== 'string') return 0; const p = v.split(':').map(Number); if (p.some(n => !Number.isFinite(n))) return 0; return ((p[0] ?? 0) * 3600 + (p[1] ?? 0) * 60 + (p[2] ?? 0)) * 1000; };
export function timerInfo(id: string, row: StateRow | undefined, now: number): TimerInfo {
  const a = row?.attributes ?? {}; const durationMs = hms(a.duration); const finishesAt = ms(a.finishes_at);
  const state = row?.state === 'active' || row?.state === 'paused' || row?.state === 'idle' ? row.state : 'unknown';
  const remainingMs = state === 'active' && finishesAt !== null ? Math.max(0, finishesAt - now) : state === 'paused' ? hms(a.remaining) : 0;
  return { id, state, durationMs, remainingMs, finishesAt };
}
/** The timer that ends first among the running ones, and how many run. */
export function nearestTimer(states: Record<string, StateRow>, ids: string[], now: number): { timer: TimerInfo; running: number } | null {
  const running = ids.map(id => timerInfo(id, states[id], now)).filter(t => t.state === 'active' || t.state === 'paused');
  if (!running.length) return null;
  running.sort((a, b) => a.remainingMs - b.remainingMs);
  return { timer: running[0], running: running.length };
}
export const fmtRemaining = (msLeft: number) => { const s = Math.max(0, Math.round(msLeft / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };
export const toDuration = (totalSec: number) => { const s = Math.max(1, Math.round(totalSec)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
/** Labels of the timers live in one HA `input_text` as JSON {"timer.atom_1":"Чай|60"} (label, then the seconds it was started with — HA's timer forgets its duration once it ends, and the automation wants both) so every user, device and the automation see them. */
export function parseLabels(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { const v = JSON.parse(raw) as unknown; if (!v || typeof v !== 'object' || Array.isArray(v)) return {}; return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => /^timer\.[a-z0-9_]+$/.test(k) && typeof x === 'string').map(([k, x]) => [k, (x as string).slice(0, 32)])); } catch { return {}; }
}
export const labelText = (v: string | undefined) => (v ?? '').split('|')[0];
export const labelSeconds = (v: string | undefined) => { const n = Number((v ?? '').split('|')[1]); return Number.isFinite(n) && n > 0 ? n : null; };
export function withLabel(labels: Record<string, string>, id: string, label: string, seconds?: number): string {
  const next = { ...labels }; const text = label.trim().slice(0, 20); if (text || seconds) next[id] = seconds ? `${text}|${Math.round(seconds)}` : text; else delete next[id];
  let out = JSON.stringify(next); while (out.length > 255 && Object.keys(next).length) { delete next[Object.keys(next)[0]]; out = JSON.stringify(next); }
  return out;
}
/** ISO-8601 week number. */
export function weekNumber(d: Date): number { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x.getTime() - y0.getTime()) / 86_400_000 + 1) / 7); }
/** Plain presets (minutes), as on Apple Watch: a tap starts at once. */
export const PRESETS = [1, 3, 5, 10, 15, 30, 60] as const;
/** Kitchen presets with an icon, a label and their usual minutes. */
export const NAMED_PRESETS: ReadonlyArray<{ key: string; icon: string; minutes: number }> = [{ key: 'eggs', icon: 'egg', minutes: 7 }, { key: 'tea', icon: 'cup', minutes: 4 }, { key: 'pasta', icon: 'pot', minutes: 10 }, { key: 'laundry', icon: 'washer', minutes: 45 }, { key: 'oven', icon: 'oven', minutes: 30 }];
/** Icon for a running timer by its label (matches a named preset's label in any language), else the hourglass. */
export const iconForLabel = (label: string, names: Record<string, string>): string => NAMED_PRESETS.find(p => names[p.key]?.toLowerCase() === label.trim().toLowerCase())?.icon ?? 'hourglass';
/** Dial geometry: pointer position → minutes on a 60-minute ring (12 o'clock = 0/60, clockwise). */
export function dialMinutes(x: number, y: number, cx: number, cy: number, max = 60): number { const a = Math.atan2(x - cx, cy - y); let deg = a * 180 / Math.PI; if (deg < 0) deg += 360; const m = Math.round(deg / 360 * max); return m === 0 ? max : m; }
export interface ClockSettings { style: 'analog' | 'digital'; seconds: boolean; arc: boolean; beep: boolean }
export const DEFAULT_CLOCK: ClockSettings = { style: 'analog', seconds: true, arc: true, beep: true };
export const CLOCK_KEY = 'atom-home:clock';
export function readClockSettings(): ClockSettings { try { const raw = localStorage.getItem(CLOCK_KEY); if (!raw) return DEFAULT_CLOCK; const v = JSON.parse(raw) as Partial<ClockSettings>; return { style: v.style === 'digital' ? 'digital' : 'analog', seconds: v.seconds !== false, arc: v.arc !== false, beep: v.beep !== false }; } catch { return DEFAULT_CLOCK; } }
export function writeClockSettings(s: ClockSettings): void { try { localStorage.setItem(CLOCK_KEY, JSON.stringify(s)); } catch { /* private mode */ } }
/** Where a person is, for the «who is home» row. */
export function personState(row: StateRow | undefined): { home: boolean; zone: string | null } {
  const s = row?.state ?? 'unknown';
  if (s === 'home') return { home: true, zone: null };
  if (s === 'not_home' || s === 'unknown' || s === 'unavailable') return { home: false, zone: null };
  return { home: false, zone: s };
}
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
