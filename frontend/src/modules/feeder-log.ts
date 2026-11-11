/* The feeder's journal as Mi Home shows it (MIOT events kept by Xiaomi's cloud, read through HA's xiaomi_miot, see custom_components/atom_home/feeder.py).
 * Pure helpers, testable under Node. Times are real timestamps: the device's own clock may stand in another zone. */
export interface FeederEvent { at: number; kind: 'ate' | 'plan' | 'manual'; grams: number }
export interface FeederLog { events: FeederEvent[]; desiccant: { level: number; days: number } | null; /** the device's UTC offset, seconds */ tz: number | null }
const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (at: number) => { const d = new Date(at * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const eventsOf = (log: FeederLog | null, day: string) => (log?.events ?? []).filter(e => dayKey(new Date(e.at * 1000)) === day).sort((a, b) => a.at - b.at);
export const eatenOn = (log: FeederLog | null, day: string) => eventsOf(log, day).filter(e => e.kind === 'ate').reduce((s, e) => s + e.grams, 0);
/** How many minutes the feeder's clock runs ahead of this device's. A plan written as 08:00 fires at 07:00 here when the feeder sits in UTC+3 and the house in UTC+2. */
export const clockShift = (log: FeederLog | null, now = new Date()) => parseZone(log?.tz) === null ? 0 : Math.round(log!.tz! / 60) + now.getTimezoneOffset();
/** The feeder's zone as stored or as the server sent it: seconds, or nothing. «undefined», an empty string and NaN (an answer without the field, kept by an older build) are nothing, never a number. */
export const parseZone = (v: unknown): number | null => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; if (typeof v !== 'string' || !v.trim()) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
export function shiftTime(hhmm: string, minutes: number): string { const [h, m] = hhmm.split(':').map(Number); const t = (((h * 60 + m + (Number.isFinite(minutes) ? minutes : 0)) % 1440) + 1440) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; }
/** The last `n` days, oldest first, each with what was eaten. */
export function weekOf(log: FeederLog | null, now = new Date(), n = 7) { return Array.from({ length: n }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i)); return { date: d, key: dayKey(d), grams: eatenOn(log, dayKey(d)) }; }); }
/** Grams per hour of a day. */
export function hoursOf(log: FeederLog | null, day: string) { const h = Array.from({ length: 24 }, () => 0); for (const e of eventsOf(log, day)) if (e.kind === 'ate') h[new Date(e.at * 1000).getHours()] += e.grams; return h; }
/** Meals shown in real time to what the feeder stores: its own clock, sorted, as Mi Home writes them. */
export function mealsForFeeder<T extends { time: string }>(meals: T[], shift: number): T[] { return meals.map(m => ({ ...m, time: shiftTime(m.time, shift) })).sort((a, b) => a.time.localeCompare(b.time)); }
/** A journal read longer ago than this is no longer «now»: it is shown with its hour and decides nothing about missed meals. */
export const JOURNAL_FRESH_MS = 600000;
/** How old the journal on screen is: stale after ten minutes, and whether it was still read today (a journal of yesterday knows nothing of what was eaten today). */
export function journalAge(fetchedAt: number, now = Date.now()): { stale: boolean; sameDay: boolean } { return { stale: now - fetchedAt > JOURNAL_FRESH_MS, sameDay: dayKey(new Date(fetchedAt)) === dayKey(new Date(now)) }; }
/** Plan meals with no dispense on record, all in minutes of the day. A planned dispense closes the meal it follows, up to the next meal: one that came
 * late (the feeder waits while the bowl is full) is not a missed meal. A meal is missed once `grace` minutes passed with nothing dispensed for it. */
export function missedMeals(meals: number[], fed: number[], now: number, grace = 15, early = 2): number[] {
  const plan = [...meals].sort((a, b) => a - b), closed = new Set<number>();
  for (const f of [...fed].sort((a, b) => a - b)) { let i = -1; for (let j = 0; j < plan.length; j++) if (plan[j] <= f + early) i = j; if (i >= 0) closed.add(i); }
  return plan.filter((m, i) => !closed.has(i) && now - m > grace);
}
/** What the tile's second line is about. The number above it is what was eaten today or, with no journal of today, the bowl's weight: then the
 * line names the bowl — a journal read yesterday must not date a weight that is read now («0 г · данные 09.11»). */
export const tileLine = (alert: boolean, ofBowl: boolean, stale: boolean): 'alert' | 'bowl' | 'asOf' | 'plan' => alert ? 'alert' : ofBowl ? 'bowl' : stale ? 'asOf' : 'plan';
