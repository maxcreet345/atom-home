import { browserTimeZone } from '../runtime/zone.ts';
/** The Energy panel's data (owner, 08.11.2026): one period of the house feed split by the SPM's channels (apartment 9, apartment 8, the car
 * charger here), the devices metered inside, the network quality of each input and the charging sessions. Kilowatt-hours in the buckets,
 * watts in the day's curve. Built by energy-load.ts from HA's statistics. */
export type Period = 'day' | 'week' | 'month' | 'half' | 'year';
export const PERIODS: Period[] = ['day', 'week', 'month', 'half', 'year'];
/** One channel of the house feed: its name as HA calls it without the device and the reading, a short one for a phone, its colour. */
export interface FeedInfo { key: string; name: string; short: string; color: string; charger: boolean; /** the feed whose bill it is on (owner, 09.11.2026: the car charges from apartment 8's input, Premier Energy bills them together) */ partOf?: string }
export type Split = Record<string, number>;
/** `missing`: a finished bar after the statistics began without a row of any channel (the meter was silent): not a 0 kWh to draw or read out.
 * `carried`: the bar the meter came back in after such a silence (the one before it, in the period or just before it, had no row): its figure
 * holds the energy of the silent stretch too, whose timing is unknown, so it is never «the costliest» and says so.
 * `partial` (the day's curve only): some channels had a row for that minute and others did not, so the stack would be a partial sum. */
export interface Bucket { at: number; future?: boolean; missing?: boolean; carried?: boolean; partial?: boolean; v: Split }
export interface MeteredDevice { key: string; feed: string | null; room: string; name: string; kwh: number }
export interface FeedNetwork { feed: string; volts: number | null; voltsMin: number | null; voltsMax: number | null; amps: number | null; ampsMax: number | null; pf: number | null }
export interface Session { start: number; end: number; kwh: number; peakW: number }
/** One price of a kWh from a moment on (the local midnight of the owner's date) until the next one. */
export interface Rate { from: number; lei: number }
export interface EnergyReport {
  period: Period; offset: number; start: number; end: number; now: number;
  feeds: FeedInfo[];
  /** the price history in force (`rates`), the period's average price per kWh (`lei`, for shares without bars of their own) and where it came
   * from: the panel's settings, HA's Energy settings (one flat price) or ANRE's figures for Premier Energy, used until the owner writes his own */
  tariff: { rates: Rate[]; lei: number; assumed: boolean; source: 'panel' | 'ha' | 'anre' };
  power: Split | null;
  buckets: Bucket[];
  curve?: Bucket[];
  previous: Split | null;
  devices: MeteredDevice[];
  /** rooms are split by apartment only when the owner said which feed each room hangs on */
  grouped: boolean;
  network: FeedNetwork[];
  sessions: Session[] | null;
  /** `from`: where the month's figure begins when the statistics began inside it (the forecast's pace is counted from there) */
  month?: { start: number; end: number; kwh: number; from?: number };
  /** the moment the figures reach: the last compiled 5 minutes of a running period, the end of a finished one */
  upTo?: number;
  /** the house's time zone when the browser is in another one (the periods and every date on the panel go by the house's calendar) */
  tz?: string;
  /** the first moment of the period with any statistics: the SPM came on 01.11.2026, the months before it are empty, not zero */
  dataFrom: number | null;
  /** the running period with a channel silent now for more than 15 minutes: where it was last heard. The comparison stops there and no badge shows */
  silentSince?: number | null;
}
/** Colours in order of the stack, bottom up; a charger is always orange. */
const PALETTE = ['#32ade6', '#5e5ce6', '#30b0a0', '#bf5af2'], CHARGER = '#ff9f0a';
export const feedColors = (feeds: Array<{ charger: boolean }>): string[] => { let n = 0; return feeds.map(f => f.charger ? CHARGER : PALETTE[n++ % PALETTE.length]); };
/** The house's calendar (code review 09.11.2026: a browser west of the house cut the periods by its own midnight, HA cuts its day and month
 * rows by the house's, and every bar slid by a day, the year by a month). `parts` reads a moment as the house's wall clock, `at` is the moment
 * of a wall-clock time there; days and months overflow as in `Date`. Without a zone (or with one the browser does not know): the browser's own. */
export interface Zone { id: string | undefined; parts(t: number): { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number }; at(y: number, mo: number, d: number, h?: number, mi?: number, s?: number, ms?: number): number }
const LOCAL: Zone = { id: undefined, parts: t => { const x = new Date(t); return { y: x.getFullYear(), mo: x.getMonth(), d: x.getDate(), h: x.getHours(), mi: x.getMinutes(), s: x.getSeconds(), wd: x.getDay() }; }, at: (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo, d, h, mi, s, ms).getTime() };
const ZONES = new Map<string, Zone>(), WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function zone(tz?: string | null): Zone {
  if (!tz) return LOCAL; const had = ZONES.get(tz); if (had) return had;
  let f: Intl.DateTimeFormat; try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }); } catch { return LOCAL; }
  const parts = (t: number) => { const p: Record<string, string> = {}; for (const x of f.formatToParts(t)) p[x.type] = x.value; return { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second), wd: WEEKDAYS.indexOf(p.weekday) }; };
  const off = (t: number) => { const p = parts(t); return Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
  const z: Zone = { id: tz, parts, at: (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => { const wall = Date.UTC(y, mo, d, h, mi, s, ms), a = off(wall); let t = wall - a; const b = off(t); if (b !== a) t = wall - b; return t; } };
  ZONES.set(tz, z); return z;
}
/** The zone to count in: the house's when the browser's is another one, otherwise none (the browser's own calendar, no Intl in the way). */
export const houseZone = (tz: string | null | undefined): string | undefined => !tz || browserTimeZone() === tz ? undefined : tz; // the browser's zone is asked once, not on every redraw (runtime/zone.ts)
/** A pointer's place along a chart in LAYOUT pixels. The shell draws a 4K monitor 1,5× and a television 2–4× (CSS `zoom`): `clientX` and the
 * measured box are then screen pixels while the chart's own width and margins are layout pixels, and the marked point ran 1,5× ahead of the
 * pointer (round 2 of the audit). `box` is the chart's getBoundingClientRect(), `width` its layout width (clientWidth). */
export const layoutX = (clientX: number, box: { left: number; width: number }, width: number): number => { const k = width > 0 && box.width > 0 ? box.width / width : 1; return (clientX - box.left) / k; };
export const sum = (s: Split): number => Object.values(s).reduce((a, v) => a + v, 0);
export const pick = (s: Split, keys: string[]): number => keys.reduce((a, k) => a + (s[k] ?? 0), 0);
export function totals(r: Pick<EnergyReport, 'buckets' | 'feeds'>): Split {
  const t: Split = Object.fromEntries(r.feeds.map(f => [f.key, 0])); for (const b of r.buckets) for (const f of r.feeds) t[f.key] += b.v[f.key] ?? 0; return t;
}
/** The price of a kWh at `t`: the last rate that began by then; before the first one, the first. */
export const priceAt = (rates: Rate[], t: number): number => { let p = rates[0]?.lei ?? 0; for (const r of rates) { if (r.from <= t) p = r.lei; else break; } return p; };
/** The lei of the period's bars (all channels, or `keys`): each bar at the price of its own start, so a month before a tariff change is billed
 * at the old price and the one after at the new (owner, 09.11.2026); a change inside a bar (a week of the half-year) goes by the bar's start. */
export const cost = (r: Pick<EnergyReport, 'buckets' | 'tariff'>, keys?: string[]): number => r.buckets.reduce((a, b) => a + priceAt(r.tariff.rates, b.at) * (keys ? pick(b.v, keys) : sum(b.v)), 0);
/** The lei of `kwh` used at the moment `at` (a bar, a charging session). */
export const costOf = (r: Pick<EnergyReport, 'tariff'>, kwh: number, at: number): number => kwh * priceAt(r.tariff.rates, at);
/** A share of the period's energy at the period's average price: a device, a room, the daily average have no bars of their own. */
export const lei = (kwh: number, r: Pick<EnergyReport, 'tariff'>): number => kwh * r.tariff.lei;
/** Change against the same stretch of the previous period, in per cent; null when the previous one used nothing. */
export const change = (now: number, before: number | null | undefined): number | null => before ? (now - before) / before * 100 : null;
const DAY = 86400000, HOUR = 3600000;
/** What a kWh cost over the period: the price in force at its start (`at`), the one in force now (`cur`) and the changes inside it. The first
 * record of the history is not a change: before it the panel bills at that same price (priceAt), so a single record dated the 9th read «менялся:
 * 4,00 до 9 ноября, с 9 ноября — 4,00» (code review 09.11.2026). */
export function tariffSpan(r: Pick<EnergyReport, 'tariff' | 'start' | 'end' | 'now' | 'dataFrom'>): { at: Rate; cur: Rate; inside: Rate[] } | null {
  const rates = r.tariff.rates, start = Math.max(r.start, r.dataFrom ?? r.start), until = Math.min(r.now, r.end);
  const k = rates.reduce((m, x, i) => x.from <= start ? i : m, 0), at = rates[k], cur = rates.filter(x => x.from <= until).at(-1) ?? rates[0];
  return at && cur ? { at, cur, inside: rates.filter((x, i) => i > k && x.from < until) } : null;
}
/** The stretch the period's figure covers: from the start of its statistics up to the last counted minute (`upTo`, not «now»: the running
 * 5 minutes are not in the figure yet). */
const elapsed = (r: EnergyReport): number => Math.min(r.upTo ?? r.now, r.end) - Math.max(r.start, r.dataFrom ?? r.start);
/** Days of the period that have passed since its statistics began (today counts as the part of it that is gone). Never zero, so nothing
 * divides by it; whether an average over it means anything is `averageKnown`. */
export const daysElapsed = (r: EnergyReport): number => Math.max(60000, elapsed(r)) / DAY;
/** «В среднем за день» and the dashed line only once an hour of the period is counted: five minutes of a Monday night scaled to a day is not
 * an average (and with the old floor of an hour it read 1,44 kWh a day at 00:07 for a house that uses 17). */
export const averageKnown = (r: EnergyReport): boolean => elapsed(r) >= HOUR;
/** The clock hour a day's bar ends at, by the wall clock of its start: on the day the clocks change the bar's two ends are not an hour apart on
 * the clock («03:00–03:00», «02:00–04:00»); `twice`: this clock hour happens twice that day, the name must tell the two apart. */
export function hourEnd(at: number, tz?: string | null): { h: number; mi: number; twice: boolean } {
  const z = zone(tz), a = z.parts(at), same = (t: number) => { const p = z.parts(t); return p.h === a.h && p.d === a.d; };
  return { h: (a.h + 1) % 24, mi: a.mi, twice: same(at + HOUR) || same(at - HOUR) };
}
/** Where the day's axis says 00:00, 06:00, 12:00, 18:00 and 24:00: at the moments the clock shows them (a 25-hour day has noon 13 hours in). */
export function dayTicks(start: number, end: number, tz?: string | null): Array<{ h: number; at: number }> {
  const z = zone(tz), p = z.parts(start); return [...[0, 6, 12, 18].map(h => ({ h, at: z.at(p.y, p.mo, p.d, h) })), { h: 24, at: end }];
}
/** A period that ended a moment ago is read once more: HA writes the last hour's row and the last 5 minutes some seconds after they end, and a
 * past period is not refreshed (yesterday opened at 00:00:05 stayed without 23:00). Milliseconds until that read, or null. */
export const settleDelay = (r: Pick<EnergyReport, 'offset' | 'end' | 'now'>): number | null => r.offset !== 0 && r.now >= r.end && r.now < r.end + 90000 ? r.end + 90000 - r.now : null;
/** The bars that count: gone already, and not before the statistics began. */
export const counted = (r: EnergyReport): Bucket[] => { const i = r.dataFrom === null ? r.buckets.length : r.buckets.findIndex((b, k) => (r.buckets[k + 1]?.at ?? r.end) > r.dataFrom!); return r.buckets.filter((b, k) => !b.future && k >= i); };
/** This month's bill if the rest of it goes like the part that is gone; not before half a day of it. */
export function forecast(r: EnergyReport): { kwh: number; lei: number; at: number } | null {
  if (!r.month) return null;
  // the pace is the month's figure over the days it was counted in: from the day the statistics began when that is inside the month
  const gone = (r.now - Math.max(r.month.start, r.month.from ?? r.month.start)) / DAY, days = (r.month.end - r.month.start) / DAY;
  if (gone <= 0.5) return null;
  const kwh = r.month.kwh / gone * days; return { kwh, lei: costOf(r, kwh, r.now), at: r.month.start }; // the whole month at today's price
}
export interface RoomShare { room: string; kwh: number; devices: MeteredDevice[] }
/** The rooms not assigned to an apartment while others are: their devices stand in a group of their own, nothing is lost. */
export const UNASSIGNED = '';
/** One apartment (or the whole home when rooms are not assigned) by room, biggest first, and what its meter counted beyond the metered
 * devices («без своего датчика»: lights, the washer, the oven). The unassigned group has no meter of its own: no rest. */
export function byRoom(r: EnergyReport, feed: string | null): { rooms: RoomShare[]; rest: number; total: number; /** the feed's own figure is short of what was used: no share can be right */ short: boolean } {
  const t = totals(r), list = r.devices.filter(d => feed === null ? true : feed === UNASSIGNED ? d.feed === null : d.feed === feed), metered = list.reduce((a, d) => a + d.kwh, 0);
  const own = feed === UNASSIGNED ? metered : pick(t, feed ? [feed] : r.feeds.filter(f => !f.charger).map(f => f.key)), rooms = new Map<string, RoomShare>();
  for (const d of list) { const x = rooms.get(d.room) ?? { room: d.room, kwh: 0, devices: [] }; x.kwh += d.kwh; x.devices.push(d); rooms.set(d.room, x); }
  const sorted = [...rooms.values()].sort((a, b) => b.kwh - a.kwh); sorted.forEach(x => x.devices.sort((a, b) => b.kwh - a.kwh));
  // the feed's meter was silent and has not caught up (round 2 of the audit: «Кухня 2,1 кВт·ч · 110 %» of an apartment that read 1,9, and «0 %»
  // beside 2,1 kWh after a long silence): the plugs kept counting, so the rooms add up to more than the feed says, or the silence still lasts
  // (its energy comes with the bar the meter returns in). The feed's figure is then not the whole: the total is never below the rooms' sum,
  // and the shares are not printed
  const past = r.buckets.filter(b => !b.future), short = feed !== UNASSIGNED && (metered > own + 0.01 || typeof r.silentSince === 'number' || !!past.at(-1)?.missing);
  const total = Math.max(own, metered);
  return { rooms: sorted, rest: Math.max(0, total - metered), total, short };
}
/** The dashed average of the bars. Days (week, month): kWh per day as the comparison's «в среднем за день» counts it, today's part over the
 * part of today that is gone, not as a whole day. Weeks and months: the finished ones; the running one only while it is the only one. A finished
 * one the statistics began inside counts only when no whole one is there, and then for its whole length (the week of 26.10 held one day of
 * November: its 19 kWh was the dashed «в среднем» of every week to come). */
export function barAverage(r: EnergyReport, val: (b: Bucket) => number): number {
  const past = counted(r); if (!past.length) return 0;
  const total = past.reduce((a, b) => a + val(b), 0);
  if (r.period === 'week' || r.period === 'month') return averageKnown(r) ? total / daysElapsed(r) : 0;
  const endOf = (b: Bucket) => r.buckets[r.buckets.indexOf(b) + 1]?.at ?? r.end, from = r.dataFrom ?? r.start;
  const done = past.filter(b => r.offset !== 0 || endOf(b) <= r.now), whole = done.filter(b => b.at >= from), use = whole.length ? whole : done.length ? done : past;
  return use.reduce((a, b) => a + (b.at < from && endOf(b) <= r.now ? val(b) / (endOf(b) - from) * (endOf(b) - b.at) : val(b)), 0) / use.length;
}
/** «Nice» axis top and step for a maximum: 1, 2, 2.5 or 5 times a power of ten, four or five lines. */
export function axis(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}
/** What the panel holds for one period, and what a failed read does to it: a good report stays (with the live figure), marked stale until the
 * next read answers; without one the error card shows, numbered by attempt so a repeat failure is announced again. */
export type LoadState = { key: string; report?: EnergyReport; failed?: boolean; stale?: boolean; attempt?: number; at?: number };
export const failedLoad = (s: LoadState | null, key: string, attempt: number, at: number): LoadState => s?.key === key && s.report ? { ...s, stale: true } : { key, failed: true, attempt, at };
