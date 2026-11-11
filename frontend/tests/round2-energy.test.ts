// Round 2 of the audit of 09.11.2026, the Energy panel and the house's time zone: each test fails without its fix.
process.env.TZ = 'Europe/Chisinau';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setHouseZone, houseDate, houseToReal, houseMonthStart, houseAt, houseDay, houseToday, dateFormat, numberFormat, browserTimeZone } from '../src/runtime/zone.ts';
import { liveHost, monthTail, monthTotal, type Hass, type Host, type StatRow } from '../src/runtime/host.ts';
import { DASH, digitsBelow, energyText, powerText, shown } from '../src/model/energy.ts';
import { byRoom, forecast, houseZone, layoutX, type EnergyReport } from '../src/model/energy-report.ts';
import { ANRE_TARIFFS, loadReport, range, ratesOf, sameMoment, type Channel } from '../src/model/energy-load.ts';
import { numFixed } from '../src/ui/format.ts';
import { ru } from '../src/i18n/ru.ts';
import { en } from '../src/i18n/en.ts';
import { ro } from '../src/i18n/ro.ts';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const HOUR = 3600000, FIVE = 300000, HOUSE = 'Europe/Chisinau';
const inTz = <X>(tz: string, run: () => X): X => { const was = process.env.TZ; process.env.TZ = tz; try { return run(); } finally { process.env.TZ = was; } };

// ---- the house's clock seen from a browser in another zone (l60, l61, l62) ----
/** A year of the house's clock, every 15 minutes, read through `houseDate()` in a browser of the zone `TZ` (a process of its own: the zone of
 * a running one is not something to switch under a scan). The house's clock itself is asked of Intl, not of the code under test. */
const SCAN = `
const Z = await import(process.argv[1]); Z.setHouseZone('${HOUSE}');
const f = new Intl.DateTimeFormat('en-US', { timeZone: '${HOUSE}', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
const parts = t => { const p = {}; for (const x of f.formatToParts(t)) if (x.type !== 'literal') p[x.type] = Number(x.value); return p; };
let wrong = 0, noSuchHour = 0, roundTrip = 0; const examples = [];
for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 15 * 60000) {
  const w = Z.houseDate(t), p = parts(t), can = new Date(p.year, p.month - 1, p.day, p.hour, p.minute).getHours() === p.hour % 24; // a clock time this browser's own zone skips cannot be a Date here
  if (w.getHours() !== p.hour % 24 || w.getMinutes() !== p.minute || w.getDate() !== p.day || w.getMonth() !== p.month - 1) { if (can) { wrong++; if (examples.length < 4) examples.push(new Date(t).toISOString() + ' reads ' + w.getHours() + ':' + w.getMinutes()); } else noSuchHour++; }
  if (Z.houseToReal(w) !== t) roundTrip++;
}
const iso = t => new Date(t).toISOString();
console.log(JSON.stringify({ wrong, noSuchHour, roundTrip, examples,
  anew: [iso(Z.houseToReal(new Date(2026, 9, 25, 3, 30))), iso(Z.houseToReal(new Date(2026, 9, 25, 4, 30))), iso(Z.houseToReal(new Date(2026, 9, 25, 2, 30)))],
  monthStart: [iso(Z.houseMonthStart(Date.UTC(2026, 10, 30, 22, 30))), iso(Z.houseMonthStart(Date.UTC(2026, 2, 31, 20, 59))), iso(Z.houseMonthStart(Date.UTC(2026, 2, 31, 21, 0)))],
  today: [Z.houseToday(Date.UTC(2026, 10, 30, 21, 59)), Z.houseToday(Date.UTC(2026, 10, 30, 22, 0))] }));`;
const scan = (tz: string) => { const r = spawnSync(process.execPath, ['--input-type=module', '-e', SCAN, new URL('../src/runtime/zone.ts', import.meta.url).href], { env: { ...process.env, TZ: tz, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { wrong: number; noSuchHour: number; roundTrip: number; examples: string[]; anew: string[]; monthStart: string[]; today: string[] }; };
for (const tz of ['Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Los_Angeles', HOUSE])
  test(`the house's clock from a browser in ${tz}: right every quarter of an hour of 2026, the days either zone changes its clocks included`, () => {
    const r = scan(tz);
    assert.equal(r.wrong, 0, `the hands lied: ${r.examples.join('; ')}`); // was 2 h a year from Berlin, 4 from London, 13 from New York, 19 from Los Angeles
    assert.ok(r.noSuchHour <= 4, `only the one hour this browser's own clock skips cannot be shown (${r.noSuchHour / 4} h)`); if (tz === HOUSE) assert.equal(r.noSuchHour, 0);
    assert.equal(r.roundTrip, 0, 'houseToReal(houseDate(t)) is t — in the hour the house repeats in autumn too (was 60 minutes off)');
    // a wall time built anew: 03:30 on 25.10 happens twice in the house — its first run, as `new Date` gives in the house's own zone; in every browser the same
    assert.deepEqual(r.anew, ['2026-10-25T00:30:00.000Z', '2026-10-25T02:30:00.000Z', '2026-10-24T23:30:00.000Z']);
    assert.deepEqual(r.monthStart, ['2026-11-30T22:00:00.000Z', '2026-02-28T22:00:00.000Z', '2026-03-31T21:00:00.000Z'], 'the 1st at the house\'s midnight, winter and summer time');
    assert.deepEqual(r.today, ['2026-11-30', '2026-12-01'], 'today by the house\'s calendar');
  });
test('the house\'s clock: the moments the audit named, from New York (this process)', () => inTz('America/New_York', () => {
  setHouseZone(HOUSE);
  try {
    // 8 March 2026: New York goes to summer time at 07:00 UTC. 05:00 UTC is seven in the morning in the house (the hands said eight)
    const a = houseDate(Date.UTC(2026, 2, 8, 5, 0)); assert.deepEqual([a.getDate(), a.getHours(), a.getMinutes()], [8, 7, 0]);
    // 1 November 2026: New York goes back at 06:00 UTC. 03:00 UTC is five in the house (the hands said four)
    const b = houseDate(Date.UTC(2026, 10, 1, 3, 0)); assert.deepEqual([b.getDate(), b.getHours()], [1, 5]);
    // the hour the house's clock shows twice (25 October 2026, 03:00–04:00): both runs come back as themselves
    for (const t of [Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 1, 30)]) { const w = houseDate(t); assert.deepEqual([w.getHours(), w.getMinutes()], [3, 30]); assert.equal(houseToReal(w), t); }
    assert.equal(houseAt(2026, 10, 1), Date.UTC(2026, 9, 31, 22, 0)); assert.equal(houseAt(2026, 6, 1, 12), Date.UTC(2026, 6, 1, 9, 0));
    assert.equal(houseDay(Date.UTC(2026, 10, 10, 21, 59)), 20261110); assert.equal(houseDay(Date.UTC(2026, 10, 10, 22, 0)), 20261111, 'the house\'s day turns at its own midnight (it is 17:00 in New York)');
    assert.equal(houseMonthStart(Date.UTC(2026, 10, 10, 20, 30)), Date.UTC(2026, 9, 31, 22, 0));
  } finally { setHouseZone(undefined); }
  assert.equal(houseToday(new Date(2026, 10, 10, 23, 30).getTime()), '2026-11-10', 'no zone known: the browser\'s day');
}));

// ---- one Intl format per locale, options and zone (l72, l179) ----
test('Intl formats are built once: the same object for the same locale, options and zone; the browser\'s zone is asked once', () => {
  const a = dateFormat('ru-RU', { day: 'numeric', month: 'long' }), b = dateFormat('ru-RU', { month: 'long', day: 'numeric' });
  assert.equal(a, b, 'the order of the options does not make another format'); assert.equal(a.format(Date.UTC(2026, 10, 10, 12)), '10 ноября');
  assert.notEqual(dateFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Tokyo' }), a); assert.notEqual(dateFormat('en-GB', { day: 'numeric', month: 'long' }), a);
  assert.equal(dateFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: HOUSE }).format(Date.UTC(2026, 10, 10, 20, 30)), '22:30');
  const n = numberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 }); assert.equal(n, numberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })); assert.equal(n.format(4), (4).toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 })); assert.notEqual(n, numberFormat('ru-RU', { maximumFractionDigits: 0 }));
  // a format without a zone is the browser's as it is now: another zone, another format (and the right clock)
  const here = dateFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }); assert.equal(here.format(Date.UTC(2026, 10, 10, 20, 30)), '22:30');
  inTz('America/New_York', () => { const there = dateFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }); assert.notEqual(there, here); assert.equal(there.format(Date.UTC(2026, 10, 10, 20, 30)), '15:30'); assert.equal(browserTimeZone(), 'America/New_York'); assert.equal(houseZone(HOUSE), HOUSE); });
  assert.equal(browserTimeZone(), HOUSE); assert.equal(houseZone(HOUSE), undefined, 'the browser\'s own zone: nothing to count in'); assert.equal(houseZone(null), undefined);
  for (const f of ['ui/energy-page.tsx', 'ui/energy-tile.tsx', 'model/energy-report.ts', 'model/energy-load.ts']) { const code = src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); assert.doesNotMatch(code, /\.toLocale(Date|Time)?String\(\s*loc|toLocaleString\(locales|new Intl\.DateTimeFormat\(\)\.resolvedOptions|new Intl\.DateTimeFormat\(loc/, `${f}: no Intl format built per call`); }
  assert.doesNotMatch(src('ui/energy-page.tsx').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /toLocale(Date|Time)String/);
});

// ---- «за месяц» (f58, l22, l65) ----
/** Home Assistant's recorder as the panel asks it: monthly rows on its own month boundaries (the start moved back to the 1st), 5-minute rows as kept. */
function recorder(month: Record<string, Array<{ start: number; change: number }>>, five: Record<string, Array<{ start: number; change: number }>>, sent: Array<Record<string, unknown>> = []): Hass {
  return { states: {}, config: { time_zone: HOUSE }, callService: async () => {}, callWS: async (m: Record<string, unknown>) => { sent.push(m); const from = Date.parse(String(m.start_time)), to = Date.parse(String(m.end_time)), ids = m.statistic_ids as string[], rows = m.period === 'month' ? month : five;
    return Object.fromEntries(ids.filter(id => rows[id]).map(id => [id, rows[id].filter(r => m.period === 'month' ? r.start < to && r.start >= houseMonthStart(from, HOUSE) : r.start >= from && r.start < to).map(r => ({ start: r.start, end: r.start + FIVE, change: r.change }))])); } } as unknown as Hass;
}
const realNow = Date.now;
const at = async <X>(now: number, run: () => Promise<X>): Promise<X> => { Date.now = () => now; const RealDate = Date; (globalThis as { Date: unknown }).Date = class extends RealDate { constructor(...a: unknown[]) { if (a.length) super(...(a as [number])); else super(now); } static now() { return now; } }; try { return await run(); } finally { (globalThis as { Date: unknown }).Date = RealDate; Date.now = realNow; } };
test('«за месяц»: a monthly row that began before this month is last month\'s — never under the new month\'s name', async () => {
  const NOV = Date.UTC(2026, 9, 31, 22, 0), DEC = Date.UTC(2026, 10, 30, 22, 0), A = 'sensor.apt9_energy_today', B = 'sensor.apt8_energy_today';
  // 1 December, 00:20 in the house: December has no row yet, HA answers with November's (the question starts 26 hours before the 1st)
  const first = recorder({ [A]: [{ start: NOV, change: 310 }], [B]: [{ start: NOV, change: 14.2 }] }, { [A]: [{ start: DEC, change: 0.05 }, { start: DEC + FIVE, change: 0.05 }, { start: DEC + 2 * FIVE, change: 0.04 }], [B]: [{ start: DEC, change: 0.01 }, { start: DEC + FIVE, change: 0.01 }, { start: DEC + 2 * FIVE, change: 0.01 }] });
  const v = await at(DEC + 20 * 60000, () => liveHost(() => first).energyMonth!([A, B]));
  assert.ok(v !== null && Math.abs(v - 0.17) < 1e-9, `the first 20 minutes of December, not November's ${310 + 14.2} (${v})`);
  // …and before any 5 minutes of the month are counted there is no figure at all, rather than last month's
  assert.equal(await at(DEC + 2 * 60000, () => liveHost(() => recorder({ [A]: [{ start: NOV, change: 310 }], [B]: [{ start: NOV, change: 14.2 }] }, {})).energyMonth!([A, B])), null);
  // 5 December, apartment 8 silent since 30 November: its latest row is November's — «a sum without it would lie», so no figure (was 61,0 + 9,9)
  const silent = recorder({ [A]: [{ start: NOV, change: 300 }, { start: DEC, change: 61 }], [B]: [{ start: NOV, change: 9.9 }] }, {});
  assert.equal(await at(DEC + 4 * 24 * HOUR + 30 * 60000, () => liveHost(() => silent).energyMonth!([A, B])), null);
  // the function itself: `since` drops the older row; without it (an older caller) the latest row as before
  assert.equal(monthTotal(['a'], { a: [{ start: NOV, change: 9.9 }] }, DEC - 26 * HOUR), null); assert.equal(monthTotal(['a'], { a: [{ start: NOV, change: 9.9 }] }), 9.9);
  assert.equal(monthTotal(['a', 'b'], { a: [{ start: DEC, change: 5 }] }, DEC, { b: 0.5 }), 5.5, 'a meter with only a tail (the month\'s first hour) counts');
  assert.match(src('runtime/host.ts'), /monthTotal\(ids, raw, from, monthTail\(/);
});
test('«за месяц» holds the running hour too: the tile and the forecast agree with the «Месяц» tab', async () => {
  const DEC = Date.UTC(2026, 10, 30, 22, 0), A = 'sensor.apt9_energy_today', hour = Date.UTC(2026, 11, 10, 13, 0), now = hour + 37 * 60000, sent: Array<Record<string, unknown>> = [];
  // the monthly row holds the finished hours (up to 15:00 in the house); since then 7 compiled slots of 0,1 kWh; the hour before has its :55 slot
  const slots = [{ start: hour - FIVE, change: 0.3 }, ...Array.from({ length: 7 }, (_, i) => ({ start: hour + i * FIVE, change: 0.1 }))];
  const v = await at(now, () => liveHost(() => recorder({ [A]: [{ start: DEC, change: 200 }] }, { [A]: slots }, sent)).energyMonth!([A]));
  assert.ok(v !== null && Math.abs(v - 200.7) < 1e-9, `the monthly row and the running hour (${v}); it was 200, behind the «Месяц» tab by the hour`);
  assert.equal(sent.length, 2, 'two reads for all the meters, however many there are'); assert.deepEqual(sent.map(m => m.period).sort(), ['5minute', 'month']);
  // the first moments of an hour: HA has not written the last hour's row yet (no :55 slot of it): that hour is taken from its slots as well
  const early = Array.from({ length: 11 }, (_, i) => ({ start: hour - HOUR + i * FIVE, change: 0.1 }));
  assert.ok(Math.abs(monthTail([A], { [A]: early }, hour + 30000, DEC)[A] - 1.1) < 1e-9); assert.equal(monthTail([A], { [A]: early }, hour + 10 * 60000, DEC)[A], undefined, 'ten minutes in the row is written: nothing of the hour before is added twice');
  assert.ok(Math.abs(monthTail([A], { [A]: [...early, { start: hour - FIVE, change: 0.1 }, { start: hour, change: 0.2 }] }, hour + 30000 + FIVE, DEC)[A] - 0.2) < 1e-9, 'the :55 slot is there: the hour before is in the monthly row');
  // never before the month's first moment: at 00:00:30 of the 1st the hour before is November
  assert.deepEqual(monthTail([A], { [A]: [{ start: DEC - 2 * FIVE, change: 9 }] }, DEC + 30000, DEC), {});
  // the forecast is counted from that figure: the same pace as the «Месяц» tab's own total gives
  const month = range('month', 0, now, HOUSE), report = { now, month: { start: month.start, end: month.end, kwh: v! }, tariff: { rates: [{ from: 0, lei: 4 }], lei: 4, assumed: false, source: 'panel' } } as unknown as EnergyReport;
  const gone = (now - month.start) / 86400000, fc = forecast(report)!; assert.ok(Math.abs(fc.kwh - 200.7 / gone * 31) < 1e-6);
});

// ---- the chart's pointer under the shell's zoom (f15, f59) ----
test('a chart reads the point under the pointer on a 4K monitor and a television: the pointer is turned into layout pixels', () => {
  // 3840×2160: the shell is drawn 1,5×. A chart 1200 layout pixels wide is 1800 on the screen, its left edge at 150
  const box = { left: 150, width: 1800 };
  assert.equal(layoutX(150 + 900, box, 1200), 600, 'the middle of the chart is its middle (was 900: the mark ran half as far again)');
  assert.equal(layoutX(150 + 360, box, 1200), 240); assert.equal(layoutX(500, { left: 100, width: 800 }, 800), 400, 'no zoom: as before');
  assert.equal(layoutX(500, { left: 100, width: 3200 }, 800), 100, 'a 4K television, 4×'); assert.equal(layoutX(500, { left: 100, width: 0 }, 0), 400, 'a chart not measured yet counts as unzoomed');
  const page = src('ui/energy-page.tsx');
  assert.equal(page.match(/layoutX\(e\.clientX, \(e\.currentTarget as SVGElement\)\.getBoundingClientRect\(\), width\)/g)?.length, 2, 'the day\'s curve and the bars both use it');
  assert.doesNotMatch(page, /e\.clientX - [^;]*getBoundingClientRect\(\)\.left/);
});

// ---- room shares when the feed's meter was silent (f52) ----
const report = (over: Partial<EnergyReport>): EnergyReport => ({ period: 'day', offset: 0, start: 0, end: 24 * HOUR, now: 12 * HOUR, feeds: [{ key: 'apt9', name: 'Квартира 9', short: 'кв. 9', color: '#000', charger: false }], tariff: { rates: [{ from: 0, lei: 3.59 }], lei: 3.59, assumed: true, source: 'anre' }, power: null, buckets: [], previous: null, devices: [], grouped: true, network: [], sessions: null, dataFrom: 0, ...over });
test('rooms: a share that cannot be right is not printed — the total is never below the rooms, and the block says the meter was silent', () => {
  const devices = [{ key: 'k', feed: 'apt9', room: 'Кухня', name: 'Чайник', kwh: 2.1 }, { key: 'h', feed: 'apt9', room: 'Прихожая', name: 'Розетка', kwh: 0.7 }];
  // the SPM was silent part of the day and has not caught up: it read 1,9 kWh while the plugs counted 2,8 («Кухня 2,1 кВт·ч · 110 %»)
  const short = byRoom(report({ devices, buckets: [{ at: 0, v: { apt9: 1.9 } }] }), 'apt9');
  assert.equal(short.short, true); assert.ok(Math.abs(short.total - 2.8) < 1e-9, 'the total is the rooms\' sum, not less'); assert.equal(short.rest, 0);
  // a long silence: the feed reads nothing («0 %» beside 2,1 kWh)
  const none = byRoom(report({ devices, buckets: [{ at: 0, v: { apt9: 0 }, missing: true }] }), 'apt9'); assert.equal(none.short, true); assert.ok(none.total >= 2.8 - 1e-9);
  // still silent now, though its figure is above the rooms': the day is not whole yet
  assert.equal(byRoom(report({ devices, buckets: [{ at: 0, v: { apt9: 5 } }], silentSince: 9 * HOUR }), 'apt9').short, true);
  // a normal day, and a silence the meter has caught up with (the carried bar holds it): shares as before
  const ok = byRoom(report({ devices, buckets: [{ at: 0, v: { apt9: 4 } }, { at: HOUR, v: { apt9: 0 }, missing: true }, { at: 2 * HOUR, v: { apt9: 3 }, carried: true }] }), 'apt9');
  assert.equal(ok.short, false); assert.equal(ok.total, 7); assert.ok(Math.abs(ok.rest - 4.2) < 1e-9);
  const page = src('ui/energy-page.tsx');
  assert.match(page, /pct = \(v: number\) => r\.short \? '' :/, 'no per cent then'); assert.match(page, /\{r\.short && <p className="at-ep-note at-ep-shares">\{t\('ep\.sharesUnknown'\)\}<\/p>\}/); assert.match(page, /r\.short \? DASH : small\(r\.rest\)/, '«Без своего датчика» is not known, not 0');
  for (const d of [ru, en, ro]) assert.ok(d['ep.sharesUnknown'].length > 20);
});

// ---- figures at a boundary, and what is not a number (l69) ----
test('a figure\'s decimals go by the figure as shown: «10», not «10,0»; «100 лей», not «100,00»; not a number is «—»', () => {
  const fmt = (v: number, d: number) => numFixed(v, 'ru', d);
  assert.equal(energyText(9.96, fmt).value, '10'); assert.equal(energyText(9.94, fmt).value, '9,9'); assert.equal(energyText(10.4, fmt).value, '10'); assert.equal(energyText(0, fmt).value, '0,0');
  assert.equal(digitsBelow(99.996, 100, 2), 0); assert.equal(digitsBelow(99.994, 100, 2), 2); assert.equal(digitsBelow(0.996, 1, 2), 0); assert.equal(digitsBelow(0.994, 1, 2), 2);
  assert.equal(energyText(NaN, fmt).value, DASH); assert.equal(powerText(NaN, fmt).value, DASH); assert.equal(shown(Infinity, fmt, 1), DASH); assert.equal(powerText(999.6, fmt).value, '1,0');
  const page = src('ui/energy-page.tsx'), tile = src('ui/energy-tile.tsx');
  assert.match(page, /fmt: Fmt = \(v, d\) => Number\.isFinite\(v\) \? numFixed\(v, lang, d\) : DASH/); assert.match(tile, /Number\.isFinite\(v\) \? numFixed\(v, lang, digits\) : DASH/);
  assert.match(page, /money = \(v: number\) => t\('ep\.lei', \{ v: fmt\(v, digitsBelow\(v, 100, 2\)\) \}\)/); assert.match(page, /fmt\(avg, digitsBelow\(avg, 10, 1\)\)/); assert.match(page, /small = \(v: number\) => digitsBelow\(v, 1, 2\) \?/);
});

// ---- the day the clocks go back (l70) ----
test('«к вчера в это время» in the hour the clock shows twice: the same length of the day, not the same figures on the clock', () => {
  for (const tz of [undefined, HOUSE]) inTz(tz ? 'America/New_York' : HOUSE, () => {
    const day = range('day', 0, Date.UTC(2026, 9, 25, 10), tz), prev = range('day', -1, Date.UTC(2026, 9, 25, 10), tz);
    assert.equal(day.start, Date.UTC(2026, 9, 24, 21)); assert.equal((day.end - day.start) / HOUR, 25);
    const first = Date.UTC(2026, 9, 25, 0, 30), second = Date.UTC(2026, 9, 25, 1, 30); // 03:30 summer time, then 03:30 winter time
    assert.equal(sameMoment('day', day.start, prev.start, first, tz) - prev.start, first - day.start, '3 h 30 min of both days');
    assert.equal(sameMoment('day', day.start, prev.start, second, tz) - prev.start, second - day.start, '4 h 30 min of both days (yesterday stopped at 3 h 30 min)');
    assert.equal(sameMoment('day', day.start, prev.start, Date.UTC(2026, 9, 25, 9, 0), tz), Date.UTC(2026, 9, 24, 8, 0), 'after it: by the clock, 11:00 against 11:00');
  });
});

// ---- the house's zone, not the browser's (l63, l64, l71) ----
test('ANRE\'s tariff days begin at the house\'s midnight; the panel takes the zone from the host; «another day» and the attempt\'s time are the house\'s', async () => {
  const ch: Channel = { key: 'apt9', name: 'Квартира 9', short: 'кв. 9', charger: false, power: { id: 'sensor.apt9_power', domain: 'sensor', deviceClass: 'power', name: 'p', kind: null, state: '100', attributes: {}, unit: 'W', available: true, lastChanged: '' }, energy: 'sensor.apt9_energy_today', total: null, areaId: null, voltage: null, current: null, pf: null };
  const host = { statistics: async () => ({} as Record<string, StatRow[]>), statistic: async () => ({ change: 0 }) } as unknown as Host;
  await inTz('Asia/Tokyo', async () => {
    const r = await loadReport(host, { tz: HOUSE, channels: [ch], meters: [], period: 'day', offset: 0, now: Date.UTC(2026, 3, 1, 22, 0), tariff: null, grouped: false, first: null });
    assert.equal(r.tariff.source, 'anre'); assert.equal(r.tariff.rates[1].from, Date.UTC(2026, 3, 1, 21, 0), '2 April by the house\'s calendar (Tokyo\'s midnight is seven hours earlier: «с 1 апреля», and a day billed at the wrong price)');
    assert.equal(r.tariff.lei, 3.56, '01:00 of 2 April in the house: the new price');
  });
  assert.deepEqual(ratesOf(ANRE_TARIFFS, HOUSE).map(x => x.from), [Date.UTC(2025, 6, 31, 21), Date.UTC(2026, 3, 1, 21)]);
  const page = src('ui/energy-page.tsx'), tile = src('ui/energy-tile.tsx');
  assert.match(page, /const tz = houseZone\(host\.timeZone\)/); assert.doesNotMatch(page, /type: 'get_config'/, 'no second read of Home Assistant\'s settings');
  assert.match(page, /houseDay\(l\.now, tz\) !== houseDay\(n, tz\)/); assert.match(tile, /houseDay\(at\) !== houseDay\(n\)/); assert.doesNotMatch(page + tile, /toDateString\(\)/);
  assert.match(page, /t\('ep\.attempt', \{ time: when\(state!\.at!, loc, \{[^}]+\}, tz\) \}\)/);
});

// ---- the fallback list, the loading card, the touch hint (f51, l93, l170, f66, l77) ----
test('the fallback list of «Энергия» says its units and readings in the panel\'s language; the loading words are on the screen; a touch screen is not told about keys', () => {
  const app = src('ui/app.tsx'), fallback = app.slice(app.indexOf('function EnergyPage('), app.indexOf('function SystemsPage('));
  assert.doesNotMatch(fallback, /\} kW`|\} W`/, 'no Latin «W» / «kW» written into the page'); assert.match(fallback, /\$\{unit\('kW'\)\}/); assert.match(fallback, /\$\{unit\('W'\)\}/);
  assert.match(fallback, /<small>\{caption\(m, d\)\}<\/small> \{reading\(m\)\}/, 'a reading\'s unit goes through the same words'); assert.match(fallback, /\(today\|month\|yesterday\|total\|сегодня\|вчера\|всего\)\$/, '«… энергия today» after a channel\'s name is translated');
  assert.match(fallback, /ms\.reduce\(\(a, m\) => a \+ Number\(m\.state\)/, 'a meter with several inputs shows all of them together, as «Сейчас» does');
  assert.deepEqual([ru['ep.unit.w'], ru['ep.unit.kw'], ru['ep.unit.kwh'], ru['ep.unit.wh'], ru['ep.unit.a'], ru['ep.unit.v']], ['Вт', 'кВт', 'кВт·ч', 'Вт·ч', 'А', 'В']);
  for (const d of [en, ro]) assert.deepEqual([d['ep.unit.wh'], d['ep.unit.a']], ['Wh', 'A']);
  const page = src('ui/energy-page.tsx');
  assert.match(page, /at-ep-skel is-chart"><p className="at-ep-readout is-hint">\{t\('ep\.loading'\)\}<\/p>/, '«Загружаю статистику» is visible text of the chart card'); assert.doesNotMatch(page, /className="at-vh">\{t\('ep\.loading'\)\}/);
  for (const d of [ru, en, ro]) for (const k of ['day', 'bars'] as const) { assert.doesNotMatch(d[`ep.hint.${k}.touch`], /←|Esc/); assert.match(d[`ep.hint.${k}`], /←/); assert.ok(d[`ep.hint.${k}`].startsWith(d[`ep.hint.${k}.touch`]), 'the same sentence without the keys'); }
  assert.match(page, /hintSeen = touchOnly\(\) \?/); assert.match(page, /<span id="at-ep-hint" className="at-vh">\{hint\}<\/span>/, 'the chart\'s description keeps the keys');
});
