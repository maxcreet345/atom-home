/** The house's time zone (Home Assistant's `config.time_zone`). The panel may be opened from a browser in another zone (a phone on a trip,
 *  a laptop abroad): the clock, the sun, «next alarm» and the energy month are the HOUSE's — an alarm «07:00» rings at seven by the house's clock.
 *
 *  Two kinds of values, never mixed:
 *  - a real moment (epoch ms, an ISO string of Home Assistant) is formatted with `zoneOption()` — `Intl` then prints the house's clock;
 *  - a «wall» Date from `houseDate()` is a Date shifted so that its LOCAL getters (getHours, getDate, toDateString…) read the house's clock:
 *    the existing code that draws hands or counts days keeps working unchanged. A wall Date is never formatted with `zoneOption()` and its
 *    `getTime()` is not a real moment — `houseToReal()` turns it back.
 *  The wall Date is BUILT from the house's clock parts (`new Date(y, m, d, h, min, s)`), never by adding a shift to the moment: a shift taken at
 *  the real moment and read by getters at the shifted one was an hour off on the days the BROWSER changes its clocks (round 2 of the audit:
 *  the hands lied for 1–10 hours a year from Berlin, London, New York, Los Angeles). One hour a year cannot be shown by such a Date at all: a
 *  clock time this browser's own zone skips that night (01:30 in London on the last Sunday of March) — Date moves it an hour on.
 *  `houseToReal()` knows the moment a wall Date of `houseDate()` was made from, so the round trip is exact, the hour the house's clock repeats
 *  in autumn included; a wall Date built anew in that hour means its first run, as `new Date(y, m, d, h)` does in the house's own zone.
 *  Without a known zone, or in a browser of the house's own zone, everything here is the identity. */
let current: string | undefined;
const valid = (tz: unknown): tz is string => { if (typeof tz !== 'string' || !tz) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
/** Set by the shell from `host.timeZone` on every draw (cheap: the same string is not checked twice). */
export function setHouseZone(tz: unknown): void { if (tz === current) return; current = valid(tz) ? tz : undefined; }
export function houseZone(): string | undefined { return current; }
/** `{ timeZone }` for an Intl format of a REAL moment; `{}` when the zone is not known (the browser's zone then). */
export function zoneOption(tz: string | undefined = current): { timeZone?: string } { return tz ? { timeZone: tz } : {}; }

const formats = new Map<string, Intl.DateTimeFormat>();
const DAY = 86_400_000;
/** The house's clock at a real moment, as UTC milliseconds of the same wall figures (whole seconds). */
function wallUtc(ms: number, tz: string): number {
  let f = formats.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); formats.set(tz, f); }
  const p: Record<string, number> = {}; for (const part of f.formatToParts(ms)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
}
/** A real moment as the integration writes it (`dt_util.as_local(…).isoformat()`): the house's wall clock with its offset, «2026-11-11T12:45:00+02:00»
 *  (the browser's zone when the house has none). The panel reads the clock figures of such a string as they stand (model/lights.ts: sleepTime). */
export function houseIso(ms: number, tz: string | undefined = current): string {
  const off = tz ? zoneOffset(ms, tz) : browserOffset(ms), w = new Date(Math.floor(ms / 1000) * 1000 + off), p = (n: number) => String(n).padStart(2, '0'), m = Math.abs(off) / 60_000;
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}T${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}${off < 0 ? '-' : '+'}${p(Math.floor(m / 60))}:${p(m % 60)}`;
}
/** Minutes the zone is ahead of UTC at that moment, in ms. */
export function zoneOffset(ms: number, tz: string): number { return wallUtc(ms, tz) - Math.floor(ms / 1000) * 1000; }
const browserOffset = (ms: number) => -new Date(ms).getTimezoneOffset() * 60_000;
/** How far the house's clock is ahead of this browser's at that moment (0 in the house's own zone). */
export function houseShift(ms: number, tz: string | undefined = current): number { return tz ? zoneOffset(ms, tz) - browserOffset(ms) : 0; }
/** The real moment of a clock time of the house, given as UTC milliseconds of the same wall figures. A time the clock shows twice (the autumn
 *  change) is its first run; one it skips (the spring change) moves on by the skipped stretch — both as `Date` does in the house's own zone. */
function realOf(wall: number, tz: string): number {
  const before = zoneOffset(wall - DAY, tz), after = zoneOffset(wall + DAY, tz), a = wall - before;
  if (before === after || zoneOffset(a, tz) === before) return a;
  const b = wall - after; return zoneOffset(b, tz) === after ? b : a;
}
/** The moment the house's clock shows that date and time (months from 0; days and months overflow as in `Date`). Without a zone: the browser's. */
export function houseAt(y: number, month: number, d: number, h = 0, min = 0, s = 0, tz: string | undefined = current): number { return tz ? realOf(Date.UTC(y, month, d, h, min, s), tz) : new Date(y, month, d, h, min, s).getTime(); }
/** The wall Dates `houseDate()` made, each with the moment it stands for: the way back is then exact whatever the two zones do that night. */
const made = new WeakMap<Date, { wall: number; real: number }>();
/** A real moment as a wall Date of the house (see above). */
export function houseDate(ms: number = Date.now(), tz: string | undefined = current): Date {
  if (!tz) return new Date(ms);
  const wall = wallUtc(ms, tz), sub = ((ms % 1000) + 1000) % 1000;
  if (wall - Math.floor(ms / 1000) * 1000 === browserOffset(ms)) return new Date(ms); // the two clocks agree now: the moment itself reads right
  const u = new Date(wall), w = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), sub);
  made.set(w, { wall: w.getTime(), real: ms }); return w;
}
/** A wall Date of the house (one of `houseDate()`, or built with `new Date(y, m, d, h, min)` from another wall Date's parts) back to the real moment. */
export function houseToReal(wall: Date | number, tz: string | undefined = current): number {
  const d = typeof wall === 'number' ? new Date(wall) : wall, w = d.getTime(); if (!tz) return w;
  const was = typeof wall === 'number' ? undefined : made.get(wall); if (was && was.wall === w) return was.real;
  if (houseShift(w, tz) === 0) return w; // the two clocks agree at that moment: it is the moment
  return realOf(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()), tz) + d.getMilliseconds();
}
/** The house's calendar day of a moment as one number (20261110): two moments of the same day of the house give the same one. */
export function houseDay(ms: number = Date.now(), tz: string | undefined = current): number { const u = new Date(tz ? wallUtc(ms, tz) : ms - new Date(ms).getTimezoneOffset() * 60_000); return u.getUTCFullYear() * 10000 + (u.getUTCMonth() + 1) * 100 + u.getUTCDate(); }
/** Today by the house's calendar as `YYYY-MM-DD` (the form the tariff's «с какого дня» is kept in). */
export function houseToday(ms: number = Date.now(), tz: string | undefined = current): string { const n = String(houseDay(ms, tz)); return `${n.slice(0, -4)}-${n.slice(-4, -2)}-${n.slice(-2)}`; }
/** 00:00 of the 1st of the month the moment falls in, by the house's calendar — a real moment. */
export function houseMonthStart(ms: number = Date.now(), tz: string | undefined = current): number {
  if (!tz) { const w = new Date(ms); return new Date(w.getFullYear(), w.getMonth(), 1).getTime(); }
  const u = new Date(wallUtc(ms, tz)); return realOf(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), 1), tz);
}

/** One `Intl.DateTimeFormat` per locale and set of options (round 2 of the audit: a redraw built 2–15 of them and made up to 34 `toLocale*`
 *  calls, 4–13 % of its time; building one costs far more than using it). A format without a `timeZone` belongs to the browser's zone as it
 *  is now: the key carries that zone's winter and summer offsets, so a browser (or a test) that changes zone gets a new one. */
const dateFormats = new Map<string, Intl.DateTimeFormat>(), JAN = new Date(Date.UTC(2026, 0, 1)), JUL = new Date(Date.UTC(2026, 6, 1));
export function dateFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  let key = `${locale ?? ''}|${options.timeZone ? '' : `${JAN.getTimezoneOffset()}/${JUL.getTimezoneOffset()}`}`;
  for (const k of Object.keys(options).sort()) { const v = (options as Record<string, unknown>)[k]; if (v !== undefined) key += `|${k}=${String(v)}`; }
  let f = dateFormats.get(key); if (!f) { if (dateFormats.size > 200) dateFormats.clear(); f = new Intl.DateTimeFormat(locale, options); dateFormats.set(key, f); }
  return f;
}
/** The same for numbers (`toLocaleString(locale, options)` builds an `Intl.NumberFormat` on every call). */
const numberFormats = new Map<string, Intl.NumberFormat>();
export function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  let key = locale ?? ''; for (const k of Object.keys(options).sort()) { const v = (options as Record<string, unknown>)[k]; if (v !== undefined) key += `|${k}=${String(v)}`; }
  let f = numberFormats.get(key); if (!f) { if (numberFormats.size > 200) numberFormats.clear(); f = new Intl.NumberFormat(locale, options); numberFormats.set(key, f); }
  return f;
}
/** The browser's own zone (IANA name), asked once per zone it is in, not on every redraw. */
let browserZone: { sig: string; id: string | undefined } | null = null;
export function browserTimeZone(): string | undefined {
  const sig = `${JAN.getTimezoneOffset()}/${JUL.getTimezoneOffset()}/${(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TZ ?? ''}`;
  if (browserZone?.sig !== sig) { let id: string | undefined; try { id = new Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { id = undefined; } browserZone = { sig, id }; }
  return browserZone.id;
}
