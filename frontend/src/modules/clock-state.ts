import type { StateRow } from '../model/registry.ts';
import { houseDate, houseAt } from '../runtime/zone.ts';
import { CommandError } from '../runtime/commands.ts';
/** Pure helpers of the clock module (testable under Node): sun, timers, labels, week numbers, formatting. */
const ms = (iso: unknown) => { const v = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(v) ? v : null; };
export interface SunInfo { rise: number | null; set: number | null; dayMs: number | null; /** 0…1 across today's daylight, null at night */ frac: number | null; elevation: number | null; night: boolean; /** ms until the next sunset (day) or sunrise (night) */ untilNext: number | null }
/** Today's sunrise/sunset from HA's `sun.sun` (which only knows the *next* ones): by day the sunrise was ~24 h before the next one; at night before dawn both are today's. */
export function sunInfo(sun: StateRow | undefined, now: number): SunInfo {
  const a = sun?.attributes ?? {}; let nextRise = ms(a.next_rising), nextSet = ms(a.next_setting);
  const elevation = typeof a.elevation === 'number' ? a.elevation : null, night = sun?.state === 'below_horizon';
  if (nextRise === null || nextSet === null) return { rise: null, set: null, dayMs: null, frac: null, elevation, night, untilNext: null };
  while (nextRise < now) nextRise += 86_400_000; while (nextSet < now) nextSet += 86_400_000; // F4 of the audit: stale attributes (sun not updated) are rolled forward, never «−1 ч 20 мин»
  let rise: number, set: number;
  const sameDay = houseDate(nextRise).toDateString() === houseDate(now).toDateString(); // the house's day, not this browser's
  if (!night) { set = nextSet; rise = nextRise - 86_400_000; }
  else if (sameDay) { rise = nextRise; set = nextSet; } // before dawn: both are today's
  else { rise = nextRise - 86_400_000; set = nextSet - 86_400_000; } // evening: both are tomorrow's
  if (set - rise > 86_400_000) rise += 86_400_000; // rolled-forward attributes can sit a day apart: a day is never longer than 24 h
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
/** The timer the tile shows, and how many are set: the one that ends first among those that RUN; a paused one only when nothing runs
 * (a pause with 30 s left used to hide the timer that was about to ring). */
export function nearestTimer(states: Record<string, StateRow>, ids: string[], now: number): { timer: TimerInfo; running: number } | null {
  const running = ids.map(id => timerInfo(id, states[id], now)).filter(t => t.state === 'active' || t.state === 'paused');
  if (!running.length) return null;
  running.sort((a, b) => Number(a.state === 'paused') - Number(b.state === 'paused') || a.remainingMs - b.remainingMs);
  return { timer: running[0], running: running.length };
}
/** What a timer was set for, in words: «15 с», «1 мин 30 с», «4 мин» (rounding to minutes called 15 s «0 мин» and 90 s «2 мин»). */
export function fmtDuration(ms: number, min: string, sec: string): string { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), r = s % 60; return [m ? `${m} ${min}` : '', r || !m ? `${r} ${sec}` : ''].filter(Boolean).join(' '); }
/** Hours and minutes of a stretch, rounded to the minute first (3 h 59 min 40 s is «4 ч 00 мин», never «3 ч 60 мин»). */
export function hoursMinutes(ms: number): { h: number; m: number } { const total = Math.max(0, Math.round(ms / 60_000)); return { h: Math.floor(total / 60), m: total % 60 }; }
export const fmtRemaining = (msLeft: number) => { const s = Math.max(0, Math.round(msLeft / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };
export const toDuration = (totalSec: number) => { const s = Math.max(1, Math.round(totalSec)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
/** Labels of the timers live in one HA `input_text` as JSON {"timer.atom_1":"Чай|60"} (label, then the seconds it was started with — HA's timer forgets its duration once it ends, and the automation wants both) so every user, device and the automation see them. */
export function parseLabels(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { const v = JSON.parse(raw) as unknown; if (!v || typeof v !== 'object' || Array.isArray(v)) return {}; return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => /^timer\.[a-z0-9_]+$/.test(k) && typeof x === 'string').map(([k, x]) => [k, (x as string).slice(0, 120)])); } catch { return {}; } // label (20) | seconds | the station's id: cutting at 32 lost the station, and «Отмена» went to a speaker that does not exist
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
export function personState(row: StateRow | undefined): { home: boolean; zone: string | null; unknown?: true } {
  const s = row?.state ?? 'unknown';
  if (s === 'home') return { home: true, zone: null };
  if (s === 'not_home') return { home: false, zone: null };
  if (s === 'unknown' || s === 'unavailable') return { home: false, zone: null, unknown: true }; // no data is not «не дома»
  return { home: false, zone: s };
}
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

/** «поставь таймер на 4 минуты 30 секунд» — the phrase Alice understands, with Russian plurals. */
export function aliceTimerCommand(totalSec: number): string {
  const ru = (n: number, one: string, few: string, many: string) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
  const m = Math.floor(totalSec / 60), sec = totalSec % 60; const parts: string[] = [];
  if (m) parts.push(`${m} ${ru(m, 'минуту', 'минуты', 'минут')}`); if (sec) parts.push(`${sec} ${ru(sec, 'секунду', 'секунды', 'секунд')}`);
  return `поставь таймер на ${parts.join(' ') || '1 минуту'}`;
}
export const ALICE_CANCEL_TIMER = 'отмени таймер';
/** The station a running timer was mirrored to (third field of the label), if any. */
export const labelStation = (v: string | undefined) => { const s = (v ?? '').split('|')[2]; return s && /^[a-z0-9_]+$/.test(s) ? `media_player.${s}` : null; };
export function withLabelStation(labels: Record<string, string>, id: string, label: string, seconds: number, station: string | null): string {
  const base = JSON.parse(withLabel(labels, id, label, seconds)) as Record<string, string>;
  if (station && base[id] !== undefined) base[id] = `${base[id]}|${station.replace(/^media_player\./, '')}`;
  let out = JSON.stringify(base); const keys = Object.keys(base); while (out.length > 255 && keys.length > 1) { delete base[keys.shift()!]; out = JSON.stringify(base); } return out;
}
/** Weekdays as the editor shows them: ISO numbers → short names; «будни» and «выходные» shortcuts. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WORKDAYS = [1, 2, 3, 4, 5], WEEKEND = [6, 7];
export function daysText(days: number[], names: string[], t: (k: string) => string): string {
  if (!days.length) return t('alarm.once');
  if (days.length === 7) return t('alarm.daily');
  if (days.length === 5 && WORKDAYS.every(d => days.includes(d))) return t('alarm.workdays');
  if (days.length === 2 && WEEKEND.every(d => days.includes(d))) return t('alarm.weekend');
  return days.map(d => names[d - 1]).join(', ');
}
/** What the ringing flag's text carries: `id|room|time|label|repeatsLeft`. */
export function parseRinging(raw: string | undefined): { id: string; room: string; time: string; label: string; left: number } | null {
  if (!raw || raw === 'unknown' || raw === 'unavailable') return null; const p = raw.split('|'); if (p.length < 3) return null;
  return { id: p[0], room: p[1], time: p[2], label: p[3] ?? '', left: Number(p[4]) || 0 };
}
export const newAlarmId = () => `a${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
/** When an alarm rings next — a real moment — by the HOUSE's clock (the same rule as the integration's `next_fire`; runtime/zone.ts): today if the
 * time is still ahead and the day fits, else the next day that fits; «один раз» (no days) is today or tomorrow. null for a switched-off alarm. */
export function nextFire(a: { time: string; days: number[]; enabled: boolean }, now: Date): number | null {
  if (!a.enabled) return null; const [h, m] = a.time.split(':').map(Number), wall = houseDate(now.getTime());
  // The moment is built on the HOUSE's calendar (houseAt), never as a Date of the browser's zone: 02:30 does not exist in New York on the night
  // its clocks jump, and an alarm set for 02:30 in the house came out an hour late on a screen there. The weekday is read at noon, which every day has.
  for (let d = 0; d <= 7; d++) { const y = wall.getFullYear(), mo = wall.getMonth(), day = wall.getDate() + d, at = houseAt(y, mo, day, h, m), iso = new Date(y, mo, day, 12).getDay() || 7; if (at > now.getTime() && (!a.days.length || a.days.includes(iso))) return at; }
  return null;
}
/** Tomorrow by the house's calendar, not «24 hours from now» (wrong on the night the clocks change). Both are real moments. */
export const isTomorrow = (at: number, now: Date) => { const w = houseDate(now.getTime()); return new Date(w.getFullYear(), w.getMonth(), w.getDate() + 1).toDateString() === houseDate(at).toDateString(); };
/** The timer that has just ended, for the «Таймер готов» banner: the idle one that changed last, and not before the «done» flag went up
 * minus a minute (HA sets the flag from the timer's own finish). null when none fits: the banner then names no timer rather than a wrong one.
 * Also null when two of them changed together: after a restart of Home Assistant with the flag still up every timer is «idle since the
 * restart», and the first slot's label («Стирка · 45 мин») was put on a timer nobody had set. */
export const SAME_MOMENT_MS = 2000;
export function finishedTimer(states: Record<string, StateRow>, ids: string[], doneSince: string | undefined): string | null {
  const since = ms(doneSince), idle = ids.map(id => ({ id, at: states[id]?.state === 'idle' ? ms(states[id].last_changed) : null })).filter((x): x is { id: string; at: number } => x.at !== null && (since === null || x.at >= since - 60_000));
  idle.sort((a, b) => b.at - a.at);
  if (idle.length > 1 && idle[0].at - idle[1].at < SAME_MOMENT_MS) return null;
  return idle[0]?.id ?? null;
}
/** What the banner's buttons need of the host (runtime/host.ts). */
export interface BannerHost { online: boolean; ws?: (message: Record<string, unknown>) => Promise<unknown>; call(domain: string, service: string, data: Record<string, unknown>): Promise<unknown> }
const lostLink = (e: unknown) => { const code = (e as { code?: unknown } | null)?.code; return e instanceof CommandError || code === 'offline' || code === 1 || code === 3; };
/** «Стоп» of a ringing alarm. Nothing leaves on the raw socket while the house is away (the socket is not guarded, runtime/commands.ts), and a
 * refusal is REJECTED with the house's own error, so that whoever runs it can say why. An integration that does not know the command (an older
 * one) or refuses it falls back to lowering the flag; a lost connection does not — the second command would be lost the same way. */
export async function stopAlarm(host: BannerHost, flag: string): Promise<void> {
  if (!host.online) throw new CommandError();
  if (host.ws) { try { await host.ws({ type: 'atom_home/alarm/stop' }); return; } catch (e) { if (lostLink(e) || !host.online) throw e; } }
  await host.call('input_boolean', 'turn_off', { entity_id: flag });
}
/** «Ещё 9 минут»: the same rules, and no fallback — only the integration can ring again. */
export async function snoozeAlarm(host: BannerHost, minutes = 9): Promise<void> {
  if (!host.online || !host.ws) throw new CommandError();
  await host.ws({ type: 'atom_home/alarm/snooze', minutes });
}
