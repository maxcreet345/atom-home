import test from 'node:test';
import assert from 'node:assert/strict';
import { channelName, channels, edges, firstStatistics, keptSessions, loadReport, meters, range, sameMoment, sessionsOf, shortName, type Channel } from '../src/model/energy-load.ts';
import { UNASSIGNED, barAverage, byRoom, counted, daysElapsed, failedLoad, forecast, totals, type EnergyReport } from '../src/model/energy-report.ts';
import type { EntityRef, HomeDevice } from '../src/model/discover.ts';
import { liveHost, withinPeriod, type Hass, type Host, type StatPeriod, type StatRow, type StatType } from '../src/runtime/host.ts';
import { previewStatistics, type PreviewStats } from '../src/runtime/preview-stats.ts';
import { ru } from '../src/i18n/ru.ts';
import { en } from '../src/i18n/en.ts';
import { ro } from '../src/i18n/ro.ts';
process.env.TZ = 'Europe/Chisinau';
const ref = (id: string, deviceClass: string, state = '1', unit: string | null = null, name = id): EntityRef => ({ id, domain: 'sensor', deviceClass, name, kind: null, state, attributes: {}, unit, available: state !== 'unavailable', lastChanged: '' });
const dev = (key: string, metrics: EntityRef[], extra: Partial<HomeDevice> = {}): HomeDevice => ({ key, kind: 'energy', name: key, roomId: 'r', icon: null, photo: null, art: null, favorite: false, order: 0, enabled: true, available: true, primary: metrics[0], controls: [], metrics, parameters: [], diagnostics: [], manufacturer: null, model: null, haDeviceId: key, section: null, ...extra });
const spmMetrics = (k: string, name: string, w: string) => [ref(`sensor.entrance_spm_${k}_power`, 'power', w, 'W', `Подъезд · ${name} · мощность`), ref(`sensor.entrance_spm_${k}_energy_total`, 'energy', '100', 'kWh'), ref(`sensor.entrance_spm_${k}_energy_today`, 'energy', '1', 'kWh'), ref(`sensor.entrance_spm_${k}_voltage`, 'voltage', '229', 'V'), ref(`sensor.entrance_spm_${k}_current`, 'current', '1.2', 'A'), ref(`sensor.entrance_spm_${k}_power_factor`, 'power_factor', '0.9')];
const SPM = dev('spm', [...spmMetrics('apt8', 'Квартира 8 (ввод)', '150'), ...spmMetrics('ev', 'Зарядка авто', '0'), ...spmMetrics('apt9', 'Квартира 9 (ввод)', '1100'), ref('sensor.entrance_spm_ch4_voltage', 'voltage', '229', 'V')], { model: 'Sonoff SPM' });

test('channel names drop the place, the reading and the remark', () => {
  assert.equal(channelName('Подъезд · Квартира 8 (ввод) · мощность'), 'Квартира 8');
  assert.equal(channelName('Зарядка авто · power'), 'Зарядка авто');
  assert.equal(shortName('Квартира 9'), 'кв. 9'); assert.equal(shortName('Зарядка авто'), 'зарядка'); assert.equal(shortName('Apartment 8'), 'apt 8');
});
test('the SPM channels: one per power with a running total, the charger last, the spare channel without readings left out', () => {
  const c = channels([SPM], new Set());
  assert.deepEqual(c.map(x => x.name), ['Квартира 9', 'Квартира 8', 'Зарядка авто']);
  assert.deepEqual(c.map(x => x.charger), [false, false, true]);
  assert.equal(c[0].energy, 'sensor.entrance_spm_apt9_energy_total'); assert.equal(c[0].voltage?.id, 'sensor.entrance_spm_apt9_voltage'); assert.equal(c[0].pf?.id, 'sensor.entrance_spm_apt9_power_factor');
  assert.deepEqual(channels([dev('plug', [ref('sensor.p_power', 'power', '5', 'W')])], new Set()), [], 'no SPM, no channels');
});
test('meters: one counter per device, the total before today, never an estimate, a parent plug or the SPM', () => {
  const tv = dev('tv', [ref('sensor.tv_energy_today', 'energy'), ref('sensor.tv_total_energy', 'energy')], { roomId: 'gostinaia' });
  const feeder = dev('feeder', [ref('sensor.cat_feeder_energy_est', 'energy')]), parent = dev('pow', [ref('sensor.kitchen_appliances_energy_total', 'energy')]), today = dev('appletv', [ref('sensor.appletv_energy_today', 'energy'), ref('sensor.appletv_energy_yesterday', 'energy')]);
  const m = meters([SPM, tv, feeder, parent, today], new Set(), { name: d => d.key, room: d => d.roomId, feed: d => d.roomId === 'gostinaia' ? 'apt9' : null, parents: new Set(['sensor.kitchen_appliances_energy_total']) });
  assert.deepEqual(m.map(x => x.id), ['sensor.tv_total_energy', 'sensor.appletv_energy_today']);
  assert.equal(m[0].feed, 'apt9'); assert.equal(m[1].feed, null);
});
test('periods by the local calendar: the week from Monday, halves of the year, bars for each', () => {
  const now = new Date(2026, 10, 8, 12, 17).getTime();
  const w = range('week', 0, now); assert.equal(new Date(w.start).getDay(), 1); assert.equal(new Date(w.start).getDate(), 2); assert.equal((w.end - w.start) / 86400000, 7);
  assert.equal(new Date(range('half', 0, now).start).getMonth(), 6); assert.equal(new Date(range('half', -1, now).start).getMonth(), 0);
  assert.equal(new Date(range('month', -1, now).start).getMonth(), 9);
  assert.equal(edges('day', range('day', 0, now).start, range('day', 0, now).end).length, 24);
  assert.equal(edges('month', range('month', 0, now).start, range('month', 0, now).end).length, 30);
  assert.equal(edges('year', range('year', 0, now).start, range('year', 0, now).end).length, 12);
  const h = edges('half', range('half', 0, now).start, range('half', 0, now).end); assert.equal(new Date(h[0]).getDate(), 1); assert.equal(new Date(h[1]).getDay(), 1); assert.equal(new Date(h[1]).getDate(), 6);
  // the autumn clock change: the day of 25.10.2026 has 25 hours
  const dst = range('day', 0, new Date(2026, 9, 25, 12).getTime()); assert.equal(edges('day', dst.start, dst.end).length, 25);
});
test('charging sessions: above 300 W, pauses up to 20 minutes joined, too small ones dropped, newest first', () => {
  const t0 = new Date(2026, 10, 8, 1, 0).getTime(), row = (min: number, w: number): StatRow => ({ start: t0 + min * 60000, end: t0 + (min + 5) * 60000, mean: w, max: w + 50 });
  const rows = [row(0, 3500), row(5, 3500), row(10, 0), row(15, 3500), row(60, 3500), row(65, 3500), row(200, 400)];
  const s = sessionsOf(rows, 300000);
  assert.equal(s.length, 2); assert.equal(new Date(s[1].start).getMinutes(), 0); assert.equal(Math.round((s[1].end - s[1].start) / 60000), 20); assert.ok(Math.abs(s[1].kwh - 3500 * 15 / 60 / 1000) < 1e-9); assert.equal(s[1].peakW, 3550);
});
/** An HA-like host: statistics_during_period gives only the rows it holds (finished hours), statistic_during_period sums the rows fully inside
 * the stretch, or what `opts.statistic` says (the running hour, the previous stretch). */
function fakeHost(rows: Record<string, StatRow[]>, opts: { statistic?: (id: string, start: number, end: number) => number | null; fail?: boolean; month?: number; calls?: Array<{ kind: string; ids: string[]; start: number; end: number; period?: string; types: string[] }> } = {}): Host {
  const inside = (id: string, start: number, end: number) => Object.entries(rows).filter(([k]) => k.startsWith(id + '@hour')).flatMap(([, r]) => r).filter(r => r.start >= start && r.end <= end).reduce((a, r) => a + (r.change ?? 0), 0);
  return { registry: async () => ({ areas: [], devices: [], entities: [] }), states: () => ({}), call: async () => {},
    async statistics(ids, start, end, period, types) { opts.calls?.push({ kind: 'statistics', ids, start, end, period, types }); if (opts.fail) throw new Error('refused'); const out: Record<string, StatRow[]> = {}; for (const id of ids) { const key = `${id}@${period}`; const r = (rows[key] ?? []).filter(r => r.start < end && r.end > start); if (r.length) out[id] = r; } return out; },
    async statistic(id, start, end, types) { opts.calls?.push({ kind: 'statistic', ids: [id], start, end, types }); return { change: opts.statistic ? opts.statistic(id, start, end) : inside(id, start, end) }; }, async energyMonth() { return opts.month ?? null; } } as Host;
}
const HR = 3600000;
const hourRows = (from: number, n: number, change: number): StatRow[] => Array.from({ length: n }, (_, i) => ({ start: from + i * HR, end: from + (i + 1) * HR, change }));
test('the report: bars from the statistics, the same stretch before, devices and what their meters do not cover', async () => {
  const now = new Date(2026, 10, 8, 12, 17).getTime(), chs = channels([SPM], new Set()) as Channel[], day = range('day', 0, now), prev = range('day', -1, now);
  const h = (hr: number, change: number): StatRow => ({ start: day.start + hr * 3600000, end: day.start + (hr + 1) * 3600000, change });
  const cover = (): StatRow => ({ start: prev.start - HR, end: prev.start, change: 0.1 }); // the statistics ran before yesterday began
  const rows = { 'sensor.entrance_spm_apt9_energy_total@hour': [cover(), h(0, 0.3), h(7, 1.8), h(11, 0.4)], 'sensor.entrance_spm_apt8_energy_total@hour': [cover(), h(0, 0.1), h(9, 0.4)], 'sensor.entrance_spm_ev_energy_total@hour': [cover(), h(1, 3.5), h(2, 3.5)], 'sensor.tv_total_energy@hour': [h(7, 0.5)] };
  const statistic = (id: string, start: number, end: number) => start < day.start ? 4 : Object.entries(rows).filter(([k]) => k.startsWith(id)).flatMap(([, r]) => r).filter(r => r.start >= start && r.end <= end).reduce((a, r) => a + (r.change ?? 0), 0);
  const r = await loadReport(fakeHost(rows, { statistic, month: 120 }), { channels: chs, meters: [{ key: 'tv', id: 'sensor.tv_total_energy', name: 'Телевизор', room: 'Гостиная', feed: 'entrance_spm_apt9' }], period: 'day', offset: 0, now, tariff: null, grouped: true });
  const t = totals(r);
  assert.equal(r.buckets.length, 24); assert.ok(Math.abs(t.entrance_spm_apt9 - 2.5) < 1e-9); assert.ok(Math.abs(t.entrance_spm_ev - 7) < 1e-9);
  assert.equal(r.buckets[13].future, true); assert.equal(r.buckets[12].future, false);
  assert.deepEqual(r.previous, { entrance_spm_apt9: 4, entrance_spm_apt8: 4, entrance_spm_ev: 4 });
  const rooms = byRoom(r, 'entrance_spm_apt9'); assert.equal(rooms.rooms[0].kwh, 0.5); assert.ok(Math.abs(rooms.rest - 2) < 1e-9);
  assert.equal(r.tariff.assumed, true); assert.equal(r.tariff.lei, 3, 'the owner: an assumed 3,00 lei per kWh until Premier Energy');
  assert.equal(r.month?.kwh, 120); assert.ok(forecast(r)!.kwh > 120);
  assert.deepEqual(r.network.map(n => n.feed), ['entrance_spm_apt9', 'entrance_spm_apt8'], 'the charger shares apartment 8\'s line: no network row of its own');
});
test('a year whose statistics begin in November: the average and the day count start there, not in January', async () => {
  const now = new Date(2026, 10, 8, 12).getTime(), chs = channels([SPM], new Set()), nov = new Date(2026, 10, 1).getTime();
  const rows = { 'sensor.entrance_spm_apt9_energy_total@month': [{ start: nov, end: new Date(2026, 11, 1).getTime(), change: 80 }] };
  const r = await loadReport(fakeHost(rows, { statistic: () => null }), { channels: chs, meters: [], period: 'year', offset: 0, now, tariff: null, grouped: false });
  assert.equal(r.dataFrom, nov); assert.equal(counted(r).length, 1); assert.ok(daysElapsed(r) < 8); assert.equal(r.previous, null);
});
test('HA refusing the statistics is an error the panel shows, not a year of zeros', async () => {
  await assert.rejects(loadReport(fakeHost({}, { fail: true }), { channels: channels([SPM], new Set()), meters: [], period: 'month', offset: 0, now: Date.now(), tariff: null, grouped: false }));
});

// HA 2026.2's recorder UNIT_SCHEMA (recorder/websocket_api.py) is closed: a key not in it fails the whole read, «extra keys not allowed»
const HA_UNIT_CLASSES = new Set(['apparent_power', 'area', 'blood_glucose_concentration', 'carbon_monoxide', 'concentration', 'conductivity', 'data_rate', 'distance', 'duration', 'electric_current', 'energy', 'energy_distance', 'information', 'mass', 'nitrogen_dioxide', 'nitrogen_monoxide', 'ozone', 'power', 'pressure', 'reactive_energy', 'reactive_power', 'speed', 'sulphur_dioxide', 'temperature', 'temperature_delta', 'unitless', 'voltage', 'volume', 'volume_flow_rate']);
const HA_UNITS: Record<string, string[]> = { energy: ['Wh', 'kWh', 'MWh'], power: ['W', 'kW'], voltage: ['V', 'mV'], electric_current: ['A', 'mA'] };
test('liveHost asks the recorder only with unit classes HA knows, in units it accepts', async () => {
  const sent: Array<Record<string, unknown>> = [], hass = { states: {}, callWS: async (m: Record<string, unknown>) => { sent.push(m); return m.type === 'recorder/statistics_during_period' ? {} : { change: 1 }; }, callService: async () => {} } as unknown as Hass;
  const host = liveHost(() => hass);
  await host.statistics!(['sensor.a'], 0, 3600000, 'hour', ['change']); await host.statistic!('sensor.a', 0, 3600000, ['change']); await host.energyMonth!(['sensor.a']);
  assert.equal(sent.length, 3);
  for (const m of sent) { const u = m.units as Record<string, string> | undefined; assert.ok(u, `${m.type} asks for units`); for (const [k, v] of Object.entries(u)) { assert.ok(HA_UNIT_CLASSES.has(k), `${m.type}: unit class «${k}» is not in HA's UNIT_SCHEMA`); assert.ok(HA_UNITS[k]?.includes(v), `${m.type}: ${k} in ${v}`); } }
  assert.equal((sent[0].units as Record<string, string>).electric_current, 'A');
  assert.deepEqual(sent[2].units, { energy: 'kWh' }, 'the calendar month in kWh too');
});
test('a plug HA names as parent stays out whole, whatever other counter it has; its children count', () => {
  const pow = dev('pow', [ref('sensor.kitchen_appliances_energy_total', 'energy'), ref('sensor.kitchen_appliances_energy_today', 'energy'), ref('sensor.kitchen_appliances_energy_period', 'energy')], { roomId: 'kukhnia' });
  const fridge = dev('fridge', [ref('sensor.kitchen_fridge_plug_energy', 'energy')], { roomId: 'kukhnia' });
  const m = meters([pow, fridge], new Set(), { name: d => d.key, room: d => d.roomId, feed: () => null, parents: new Set(['sensor.kitchen_appliances_energy_total']) });
  assert.deepEqual(m.map(x => x.id), ['sensor.kitchen_fridge_plug_energy']);
  const onlyToday = dev('pow2', [ref('sensor.p2_energy_total', 'energy'), ref('sensor.p2_energy_today', 'energy')]);
  assert.deepEqual(meters([onlyToday], new Set(), { name: d => d.key, room: d => d.roomId, feed: () => null, parents: new Set(['sensor.p2_energy_total']) }), []);
});
test('HA gives only finished hours: the running hour comes from statistic_during_period, and yesterday is compared over the same span', async () => {
  const now = new Date(2026, 10, 8, 0, 50, 30).getTime(), chs = channels([SPM], new Set()), day = range('day', 0, now), prev = range('day', -1, now), calls: Parameters<typeof fakeHost>[1]['calls'] = [];
  const rows = Object.fromEntries(chs.map(c => [`${c.energy}@hour`, hourRows(prev.start - HR, 25, 0.1)])); // yesterday and the hour before it; nothing of today yet
  const statistic = (id: string, start: number, end: number) => start >= day.start ? (id.includes('apt9') ? 0.8 : 0.1) * (end - start) / (50 * 60000) : 0.1 * (end - start) / HR;
  const r = await loadReport(fakeHost(rows, { statistic, calls }), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false });
  const t = totals(r);
  assert.ok(Math.abs(t.entrance_spm_apt9 - 0.8) < 1e-9, `at 00:50 today is 0,8 kWh, not 0 (${t.entrance_spm_apt9})`); assert.ok(r.buckets[0].v.entrance_spm_apt9 > 0, 'in the bar of now');
  assert.notEqual(r.dataFrom, null, 'not «no data»');
  const before = calls.filter(c => c.kind === 'statistic' && c.start === prev.start); assert.ok(before.length >= 3); for (const c of before) assert.equal(c.end - c.start, 50 * 60000, 'yesterday up to 00:50, as today (the last compiled 5-minute boundary)');
  for (const c of calls.filter(c => c.kind === 'statistic' && c.start === day.start)) assert.equal(c.end, day.start + 50 * 60000, 'today up to the same boundary');
  // HA not giving the running hour: today counts its finished hours only, and yesterday the same span
  const noon = new Date(2026, 10, 8, 12, 55).getTime(), rows2 = Object.fromEntries(chs.map(c => [`${c.energy}@hour`, hourRows(prev.start - HR, 25 + 12, 0.1)])), calls2: typeof calls = [];
  const r2 = await loadReport(fakeHost(rows2, { statistic: (id, s, e) => s >= day.start ? null : 0.1 * (e - s) / HR, calls: calls2 }), { channels: chs, meters: [], period: 'day', offset: 0, now: noon, tariff: null, grouped: false });
  assert.ok(Math.abs(totals(r2).entrance_spm_apt9 - 1.2) < 1e-9); assert.ok(r2.previous && Math.abs(r2.previous.entrance_spm_apt9 - 1.2) < 1e-9, 'an identical day reads 0 %, not −7 %');
});
test('the previous stretch partly before the statistics began has no comparison («▲ 706 %» no more)', async () => {
  const now = new Date(2026, 10, 8, 12).getTime(), chs = channels([SPM], new Set()), nov1 = new Date(2026, 10, 1).getTime();
  const rows = Object.fromEntries(chs.map(c => [`${c.energy}@day`, Array.from({ length: 8 }, (_, i) => ({ start: new Date(2026, 10, 1 + i).getTime(), end: new Date(2026, 10, 2 + i).getTime(), change: 9 }))]));
  const r = await loadReport(fakeHost(rows, { statistic: (_id, s) => s >= nov1 ? 9 : s >= new Date(2026, 9, 26).getTime() ? 9 : null }), { channels: chs, meters: [], period: 'week', offset: 0, now, tariff: null, grouped: false });
  assert.equal(r.previous, null, 'last week had one day of statistics out of seven');
  // a week before which the statistics already ran compares
  const rows2 = Object.fromEntries(chs.map(c => [`${c.energy}@day`, Array.from({ length: 20 }, (_, i) => ({ start: new Date(2026, 9, 20 + i).getTime(), end: new Date(2026, 9, 21 + i).getTime(), change: 9 }))]));
  const ran = Object.fromEntries(chs.map(c => [`${c.energy}@hour`, hourRows(new Date(2026, 9, 26).getTime() - HR, 2, 0.4)]));
  const r2 = await loadReport(fakeHost({ ...rows2, ...ran }, { statistic: () => 9 }), { channels: chs, meters: [], period: 'week', offset: 0, now, tariff: null, grouped: false });
  assert.notEqual(r2.previous, null);
});
test('every read starts at once; half a year reads days and the network by month (no week rows) and reuses the charging sessions on a refresh', async () => {
  const now = new Date(2026, 10, 8, 12).getTime(), chs = channels([SPM], new Set()); let started = 0, open = false; const waiters: Array<() => void> = [];
  const gate = <T,>(v: T) => { started++; return open ? Promise.resolve(v) : new Promise<T>(res => waiters.push(() => res(v))); };
  const host = { registry: async () => ({ areas: [], devices: [], entities: [] }), states: () => ({}), call: async () => {}, statistics: () => gate({}), statistic: () => gate({ change: 1 }), energyMonth: () => gate(1) } as unknown as Host;
  const p = loadReport(host, { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.ok(started >= 12, `main, 3 running hours, the cover, 3 previous, 5-minute curve, network, charger, month all asked before any answer (${started})`);
  open = true; waiters.forEach(w => w()); await p;
  const calls: Parameters<typeof fakeHost>[1]['calls'] = [];
  const r = await loadReport(fakeHost({}, { calls }), { channels: chs, meters: [], period: 'half', offset: 0, now, tariff: null, grouped: false, sessions: [] });
  assert.equal(calls.find(c => c.ids.some(i => i.endsWith('_voltage')))?.period, 'month');
  assert.deepEqual(calls.filter(c => c.period === 'week'), [], 'HA moves a week query back to a Monday: half a year reads no week rows');
  assert.equal(calls.find(c => c.ids.includes('sensor.entrance_spm_apt9_energy_total') && c.end === range('half', 0, now).end)?.period, 'day');
  assert.equal(calls.filter(c => c.ids.includes('sensor.entrance_spm_ev_power')).length, 0, 'the charger\'s hours are not read again'); assert.deepEqual(r.sessions, []);
  const y: typeof calls = []; await loadReport(fakeHost({}, { calls: y }), { channels: chs, meters: [], period: 'year', offset: 0, now, tariff: null, grouped: false });
  assert.equal(y.find(c => c.ids.some(i => i.endsWith('_voltage')))?.period, 'month');
});
test('a day at the edge of the 5-minute statistics fills its morning from the hourly means', async () => {
  const now = new Date(2026, 10, 8, 12).getTime(), chs = channels([SPM], new Set()), day = range('day', -10, now), id = 'sensor.entrance_spm_apt9_power';
  const five = Array.from({ length: 12 * 12 }, (_, i) => ({ start: day.start + 12 * HR + i * 300000, end: day.start + 12 * HR + (i + 1) * 300000, mean: 500 }));
  const hourly = Array.from({ length: 12 }, (_, i) => ({ start: day.start + i * HR, end: day.start + (i + 1) * HR, mean: 200 }));
  const r = await loadReport(fakeHost({ [`${id}@5minute`]: five, [`${id}@hour`]: hourly }), { channels: chs, meters: [], period: 'day', offset: -10, now, tariff: null, grouped: false });
  assert.equal(r.curve![12].v.entrance_spm_apt9, 200, '01:00 from the hourly mean, not 0 W'); assert.equal(r.curve![12 * 12 + 1].v.entrance_spm_apt9, 500);
});
test('a failed refresh keeps the good report (and its live figure); a first failure shows the error, numbered', () => {
  const report = { period: 'day' } as EnergyReport;
  assert.deepEqual(failedLoad({ key: 'day0', report }, 'day0', 2, 5), { key: 'day0', report, stale: true });
  assert.deepEqual(failedLoad(null, 'day0', 3, 7), { key: 'day0', failed: true, attempt: 3, at: 7 });
  assert.deepEqual(failedLoad({ key: 'month0', report }, 'day0', 1, 9), { key: 'day0', failed: true, attempt: 1, at: 9 });
});
test('rooms on no feed stand apart when the others are split; the bars\' average is the comparison\'s daily one', () => {
  const now = new Date(2026, 10, 8, 12).getTime(), w = range('week', 0, now), at = (i: number) => w.start + i * 86400000;
  const r = { period: 'week', offset: 0, start: w.start, end: w.end, now, dataFrom: w.start, feeds: [{ key: 'a9', name: 'Квартира 9', short: 'кв. 9', color: '', charger: false }], tariff: { lei: 3, assumed: true }, power: null, previous: null, grouped: true, network: [], sessions: null,
    buckets: Array.from({ length: 7 }, (_, i) => ({ at: at(i), future: at(i) > now, v: { a9: i === 6 ? 5 : 10 } })), devices: [{ key: 'd', feed: null, room: 'Склад', name: 'Сушилка', kwh: 0.2 }, { key: 't', feed: 'a9', room: 'Гостиная', name: 'TV', kwh: 1 }] } as EnergyReport;
  const u = byRoom(r, UNASSIGNED); assert.deepEqual(u.rooms.map(x => x.room), ['Склад']); assert.equal(u.rest, 0);
  assert.deepEqual(byRoom(r, 'a9').rooms.map(x => x.room), ['Гостиная']);
  assert.ok(Math.abs(barAverage(r, b => b.v.a9) - 65 / daysElapsed(r)) < 1e-9, 'today counts as the part of it that is gone');
});
test('the first moment of the statistics: the first month, then its first day', async () => {
  const chs = channels([SPM], new Set()), nov = new Date(2026, 10, 1).getTime(), nov3 = new Date(2026, 10, 3).getTime();
  const rows = Object.fromEntries(chs.flatMap(c => [[`${c.energy}@month`, [{ start: nov, end: new Date(2026, 11, 1).getTime(), change: 50 }]], [`${c.energy}@day`, [{ start: nov3, end: nov3 + 86400000, change: 5 }]]]));
  assert.equal(await firstStatistics(fakeHost(rows), chs, new Date(2026, 10, 8).getTime()), nov3);
  assert.equal(await firstStatistics(fakeHost({}), chs, new Date(2026, 10, 8).getTime()), null, 'HA answered with no rows: no statistics');
  await assert.rejects(firstStatistics(fakeHost({}, { fail: true }), chs, Date.now()), 'HA not answering is not «no statistics»: the panel asks again');
});
test('a number never parts from its unit at a line break: no-break spaces in the panel\'s templates', () => {
  for (const d of [ru, en, ro] as Array<Record<string, string>>) for (const k of ['ep.lei', 'ep.hours', 'ep.upTo', 'ep.amps', 'ep.ampsMax', 'ep.range', 'ep.share']) assert.match(d[k], /\{[a-z]\}\u00a0/, `${k}: «${d[k]}»`);
});

// ── round 2 of the audit ──
const D = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime();
const dayRows = (ids: string[], from: number, to: number, kwh: number): PreviewStats => { const day: Record<string, Array<[number, number]>> = {}; for (const id of ids) for (let t = from; t < to; t = new Date(new Date(t).setDate(new Date(t).getDate() + 1)).getTime()) (day[id] ??= []).push([t, kwh]); return { hour: {}, day, five: {}, hourMean: {}, dayMinMax: {} }; };
test('HA moves a day, week or month query to its boundaries: the preview does as HA, the hosts ask a millisecond before the end and keep [start, end)', async () => {
  const id = 'sensor.entrance_spm_apt9_energy_total', s = dayRows([id], D(2026, 5, 1), D(2026, 10, 9), 19), mon = D(2026, 9, 26), next = D(2026, 10, 2);
  // HA itself (recorder/statistics.py): the end 2.11 00:00 becomes 3.11, so the week of 26.10 gets Monday 2.11 as well
  assert.equal(previewStatistics(s, [id], mon, next, 'day', ['change'])[id].length, 8, 'the preview gives the extra day HA gives');
  assert.equal(new Date(previewStatistics(s, [id], D(2026, 6, 1), D(2027, 0, 1), 'week', ['change'])[id][0].start).getDate(), 29, 'a week query from 1 July starts on Monday 29 June');
  assert.equal(previewStatistics(s, [id], D(2026, 9, 1), D(2026, 10, 1), 'month', ['change'])[id].length, 2, 'October ending on 1.11 brings November too');
  const read = async (ids: string[], a: number, b: number, p: StatPeriod, t: StatType[]) => previewStatistics(s, ids, a, b, p, t);
  const wk = await withinPeriod(read, [id], mon, next, 'day', ['change']); assert.equal(wk[id].length, 7); assert.ok(wk[id].every(r => r.start >= mon && r.start < next), 'no Monday 2.11');
  assert.equal((await withinPeriod(read, [id], D(2026, 9, 1), D(2026, 10, 1), 'month', ['change']))[id].length, 1);
  assert.deepEqual(await withinPeriod(read, [id], D(2026, 6, 1), D(2026, 6, 6), 'week', ['change']), {}, 'the Monday-29-June week row dropped');
  // the live host asks HA up to a millisecond before the end for day, week and month, as is for hours
  const sent: Array<Record<string, unknown>> = [], hass = { states: {}, callWS: async (m: Record<string, unknown>) => { sent.push(m); const r = previewStatistics(s, m.statistic_ids as string[], Date.parse(String(m.start_time)), Date.parse(String(m.end_time)), m.period as StatPeriod, ['change']); return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.map(x => ({ start: x.start, end: x.end, change: x.change }))])); }, callService: async () => {} } as unknown as Hass;
  const host = liveHost(() => hass), got = await host.statistics!([id], mon, next, 'day', ['change']);
  assert.equal(Date.parse(String(sent[0].end_time)), next - 1); assert.equal(got[id].length, 7, 'the live host returns the week alone');
  assert.equal(Object.values(got[id]).reduce((a, r) => a + (r.change ?? 0), 0), 7 * 19);
  await host.statistics!([id], mon, next, 'hour', ['change']); assert.equal(Date.parse(String(sent[1].end_time)), next, 'hours are not moved by HA');
});
test('half a year from day rows: the statistics began on Sunday 1.11, not on Monday 26.10; the dashed weekly average is a whole week', async () => {
  const now = D(2026, 10, 8, 12), chs = channels([SPM], new Set()), nov1 = D(2026, 10, 1), ids = chs.map(c => c.energy), s = dayRows(ids, nov1, D(2026, 10, 9), 19 / 3);
  const host = { registry: async () => ({ areas: [], devices: [], entities: [] }), states: () => ({}), call: async () => {}, statistics: (i: string[], a: number, b: number, p: StatPeriod, t: StatType[]) => withinPeriod(async (...x) => previewStatistics(s, ...x), i, a, b, p, t), statistic: async () => ({ change: null }) } as unknown as Host;
  const r = await loadReport(host, { channels: chs, meters: [], period: 'half', offset: 0, now, tariff: null, grouped: false, sessions: null, first: nov1 });
  assert.equal(r.dataFrom, nov1, 'since 1 November'); assert.ok(Math.abs(daysElapsed(r) - 7.5) < 1e-9);
  const t = totals(r), all = Object.values(t).reduce((a, v) => a + v, 0); assert.ok(all / daysElapsed(r) > 19, `per day over 7,5 days, not 12,5 from Monday 26.10 (${all / daysElapsed(r)})`);
  const avg = barAverage(r, b => Object.values(b.v).reduce((a, v) => a + v, 0)); assert.ok(Math.abs(avg - 19 * 7) < 1e-6, `the week of 26.10 held one day: counted for its whole length (${avg})`);
  // a month's row starts on the 1st: the first moment of the statistics holds the year's start back to the real day
  const y = await loadReport(fakeHost({ 'sensor.entrance_spm_apt9_energy_total@month': [{ start: nov1, end: D(2026, 11, 1), change: 80 }] }, { statistic: () => null }), { channels: chs, meters: [], period: 'year', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 3) });
  assert.equal(y.dataFrom, D(2026, 10, 3));
});
test('a finished bar without a row of any channel is missing, not 0 kWh; today, the future and the bars before the statistics are not', async () => {
  const now = D(2026, 10, 8, 12), chs = channels([SPM], new Set()), ids = chs.map(c => c.energy);
  const rows = Object.fromEntries(ids.map(id => [`${id}@day`, [3, 4, 5, 6, 8].map(d => ({ start: D(2026, 10, d), end: D(2026, 10, d + 1), change: d === 8 ? 40 : 9 }))]));
  const r = await loadReport(fakeHost(rows, { statistic: () => null }), { channels: chs, meters: [], period: 'week', offset: 0, now, tariff: null, grouped: false });
  assert.deepEqual(r.buckets.map(b => !!b.missing), [false, false, false, false, false, true, false], 'Monday 2.11 is before the statistics, Saturday 7.11 silent, Sunday today');
  assert.equal(totals(r).entrance_spm_apt9, 9 * 4 + 40, 'the sum keeps the energy HA put into the hour the meter came back in');
  assert.deepEqual(r.buckets.map(b => !!b.carried), [false, false, false, false, false, false, true], 'Sunday holds Saturday\'s energy: carried, never «the costliest day»');
});
test('a finished period against the whole one before it; the running one against the same stretch by the calendar', async () => {
  assert.equal(sameMoment('month', D(2027, 2, 1), D(2027, 1, 1), D(2027, 2, 31, 12)), D(2027, 2, 1), 'the 31st of March in February: its end');
  assert.equal(sameMoment('month', D(2026, 10, 1), D(2026, 9, 1), D(2026, 10, 8, 12)), D(2026, 9, 8, 12));
  assert.equal(sameMoment('day', D(2026, 9, 26), D(2026, 9, 25), D(2026, 9, 26, 5)), D(2026, 9, 25, 5), 'the clock, not 24 hours, after the autumn change');
  assert.equal(sameMoment('year', D(2028, 0, 1), D(2027, 0, 1), D(2028, 1, 29, 10)), D(2027, 2, 1), '29 February a year later: the end of February');
  assert.equal(sameMoment('week', D(2026, 10, 2), D(2026, 9, 26), D(2026, 10, 5, 7)), D(2026, 9, 29, 7));
  const chs = channels([SPM], new Set()), each = async (period: 'month' | 'day', now: number) => { const calls: Parameters<typeof fakeHost>[1]['calls'] = []; await loadReport(fakeHost({}, { calls }), { channels: chs, meters: [], period, offset: -1, now, tariff: null, grouped: false }); const prev = range(period, -2, now); return calls.filter(c => c.kind === 'statistic' && c.start === prev.start).map(c => c.end - prev.end); };
  assert.deepEqual(await each('month', D(2027, 2, 15)), [0, 0, 0], 'February opened in March: the whole of January');
  assert.deepEqual(await each('month', D(2026, 9, 15)), [0, 0, 0], 'September: the whole of August, not 30 of its 31 days');
  assert.deepEqual(await each('day', D(2026, 9, 27, 9)), [0, 0, 0], '26.10 against the whole 25-hour 25.10');
});
test('the statistics began right at the previous period\'s start: that period is whole and compares', async () => {
  const now = D(2026, 11, 8, 12), chs = channels([SPM], new Set()), nov1 = D(2026, 10, 1), calls: Parameters<typeof fakeHost>[1]['calls'] = [];
  const rows = Object.fromEntries(chs.flatMap(c => [[`${c.energy}@hour`, hourRows(nov1, 3, 0.5)], [`${c.energy}@day`, [{ start: D(2026, 11, 1), end: D(2026, 11, 2), change: 9 }]]]));
  const r = await loadReport(fakeHost(rows, { statistic: () => 9, calls }), { channels: chs, meters: [], period: 'month', offset: 0, now, tariff: null, grouped: false });
  assert.notEqual(r.previous, null, 'November from its first hour is a whole month');
  assert.ok(calls.some(c => c.kind === 'statistics' && c.period === 'hour' && c.start === nov1 - HR && c.end === nov1 + HR), 'asked by the hour around the start');
  const r0 = await loadReport(fakeHost(Object.fromEntries(chs.map(c => [`${c.energy}@hour`, hourRows(nov1 + 2 * HR, 3, 0.5)])), { statistic: () => 9 }), { channels: chs, meters: [], period: 'month', offset: 0, now, tariff: null, grouped: false });
  assert.equal(r0.previous, null, 'statistics from 02:00 of the 1st: a partial November');
});

// ── round 3 of the audit ──
test('after a silent yesterday the catch-up in today\'s 00:00 is carried: the row before the period is read, the totals stay whole', async () => {
  const now = D(2026, 10, 8, 12), chs = channels([SPM], new Set()), day = range('day', 0, now), calls: Parameters<typeof fakeHost>[1]['calls'] = [];
  const rows = Object.fromEntries(chs.map(c => [`${c.energy}@hour`, [...hourRows(day.start - 3 * 86400000, 48, 0.2), ...hourRows(day.start, 12, 0.3).map((r, i) => i ? r : { ...r, change: 17 })]]));
  const load = (first: number | null | undefined) => loadReport(fakeHost(rows, { statistic: () => null, calls }), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false, first });
  const r = await load(D(2026, 10, 1));
  assert.ok(calls.some(c => c.kind === 'statistics' && c.period === 'hour' && c.start === day.start - HR && c.end === day.start), 'the hour before the day is asked');
  assert.equal(r.buckets[0].carried, true, '00:00 holds yesterday\'s energy'); assert.ok(r.buckets.slice(1).every(b => !b.carried));
  assert.ok(Math.abs(totals(r).entrance_spm_apt9 - (17 + 11 * 0.3)) < 1e-9, 'the energy is real: the total keeps it');
  assert.equal((await load(D(2026, 10, 8))).buckets[0].carried, undefined, 'the statistics began today: nothing was silent before');
  // inside the day: the hour after a silent one
  const rows2 = Object.fromEntries(chs.map(c => [`${c.energy}@hour`, [...hourRows(day.start - HR, 1, 0.2), ...hourRows(day.start, 12, 0.3).filter((_, i) => i !== 5)]]));
  const r2 = await loadReport(fakeHost(rows2, { statistic: () => null }), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 1) });
  assert.deepEqual(r2.buckets.slice(0, 8).map(b => [!!b.missing, !!b.carried]), [[false, false], [false, false], [false, false], [false, false], [false, false], [true, false], [false, true], [false, false]]);
});
test('the day\'s curve: a minute without any channel\'s row is missing, one without some channel\'s row partial, never 0 W', async () => {
  const now = D(2026, 10, 8, 12), chs = channels([SPM], new Set()), day = range('day', 0, now), slot = (i: number) => ({ start: day.start + i * 300000, end: day.start + (i + 1) * 300000, mean: 400 });
  // apartment 9 silent 01:00–02:00, the whole SPM 02:00–03:00
  const five = Object.fromEntries(chs.map(c => [`${c.power.id}@5minute`, Array.from({ length: 144 }, (_, i) => i).filter(i => !(i >= 24 && i < 36) && !(i >= 12 && i < 24 && c.key === 'entrance_spm_apt9')).map(slot)]));
  const r = await loadReport(fakeHost(five, { statistic: () => null }), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 1) });
  const c = r.curve!;
  assert.ok(c.slice(0, 12).every(p => !p.missing && !p.partial), '00:00–01:00 measured');
  assert.ok(c.slice(12, 24).every(p => p.partial && !p.missing), '01:00–02:00: one channel silent, the stack would be a partial sum');
  assert.ok(c.slice(24, 36).every(p => p.missing), '02:00–03:00: the meter silent, not 0 W');
  assert.ok(c.slice(36, 144).every(p => !p.missing && !p.partial) && c.slice(144).every(p => p.future && !p.missing), 'the rest measured, the future not a gap');
});
/** HA's recorder as it is (recorder/statistics.py): 5-minute rows compiled 10 s after their slot, hours 10 s after theirs; statistic_during_period
 * sums the whole hours inside the stretch and then the 5-minute rows that start before its end (`start_ts < end_time_ts`). A day's row is
 * reduced from the hours HA holds of it (so the running day has one, ending at midnight). */
function haRecorder(chs: Channel[], now: number, from: number, kwh5: number): Host {
  const ready = (end: number) => end + 10000 <= now, slots: number[] = []; for (let t = from; ready(t + 300000); t += 300000) slots.push(t);
  const hours = slots.filter(t => t % HR === new Date(t).getTimezoneOffset() * -60000 % HR && ready(t + HR));
  const days = (rows: number[]) => { const m = new Map<number, number>(); for (const t of rows) { const d = new Date(t); d.setHours(0, 0, 0, 0); m.set(d.getTime(), (m.get(d.getTime()) ?? 0) + 1); } return [...m].map(([d, n]) => ({ start: d, end: new Date(new Date(d).setDate(new Date(d).getDate() + 1)).getTime(), change: n * kwh5 * 12 })); };
  return { registry: async () => ({ areas: [], devices: [], entities: [] }), states: () => ({}), call: async () => {},
    async statistics(ids, start, end, period) { const out: Record<string, StatRow[]> = {}; if (period !== 'hour' && period !== 'day') return out; for (const id of ids) if (chs.some(c => c.energy === id)) { const r = period === 'hour' ? hours.filter(t => t < end && t + HR > start).map(t => ({ start: t, end: t + HR, change: kwh5 * 12 })) : days(hours).filter(d => d.start < end && d.end > start); if (r.length) out[id] = r; } return out; },
    async statistic(_id, start, end) { const inside = hours.filter(t => t >= start && t + HR <= end), mainEnd = inside.length ? inside.at(-1)! + HR : start; return { change: inside.length * kwh5 * 12 + slots.filter(t => t >= mainEnd && t < end).length * kwh5 }; },
    async energyMonth() { return null; } } as Host;
}
test('an identical day reads «=» early in the morning: today and yesterday end at the same compiled 5-minute boundary', async () => {
  const chs = channels([SPM], new Set());
  for (const [h, m, s] of [[0, 7, 0], [1, 7, 0], [0, 12, 40], [3, 20, 5]]) {
    const now = D(2026, 10, 8) + ((h * 60 + m) * 60 + s) * 1000, r = await loadReport(haRecorder(chs, now, D(2026, 10, 5), 0.02), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 5) });
    const all = Object.values(totals(r)).reduce((a, v) => a + v, 0), before = r.previous ? Object.values(r.previous).reduce((a, v) => a + v, 0) : null, d = before ? (all - before) / before * 100 : null;
    assert.ok(d !== null && Math.round(d) === 0, `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} on a flat day: «=», not ${d?.toFixed(1)} % (${all} against ${before})`);
  }
});

// ── round 4 of the audit ──
test('a read in the first seconds after a full hour (HA has not written that hour yet): its tail in the hour just gone, no «no data», no «carried»', async () => {
  const chs = channels([SPM], new Set()), sumOf = (b: { v: Record<string, number> }) => Object.values(b.v).reduce((a, v) => a + v, 0);
  for (const h of [1, 13, 23]) {
    const now = D(2026, 10, 8, h) + 5000, r = await loadReport(haRecorder(chs, now, D(2026, 10, 5), 0.02), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 5) });
    assert.deepEqual(r.buckets.filter(b => b.missing).map(b => new Date(b.at).getHours()), [], `${h}:00:05: no hour «no data»`);
    assert.deepEqual(r.buckets.filter(b => b.carried).map(b => new Date(b.at).getHours()), [], `${h}:00:05: nothing «carried» on a normal day`);
    assert.ok(sumOf(r.buckets[h - 1]) > 0 && sumOf(r.buckets[h]) === 0, `${h}:00:05: ${h - 1}:00–${h - 1}:55 in the ${h - 1}:00 bar, not in the bar of now (${sumOf(r.buckets[h - 1])} / ${sumOf(r.buckets[h])})`);
  }
  // the week at 00:00:05 on Tuesday: Monday's last hour stays on Monday
  const now = D(2026, 10, 10) + 5000, w = await loadReport(haRecorder(chs, now, D(2026, 10, 5), 0.02), { channels: chs, meters: [], period: 'week', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 5) });
  assert.deepEqual(w.buckets.map(b => [!!b.missing, !!b.carried]), Array.from({ length: 7 }, () => [false, false]), 'the week: no missing, no carried bar');
  assert.ok(Math.abs(sumOf(w.buckets[0]) - 3 * (23 * 12 + 11) * 0.02) < 1e-9 && sumOf(w.buckets[1]) === 0, `Monday holds its 23:00–23:55, Tuesday nothing yet (${sumOf(w.buckets[0])} / ${sumOf(w.buckets[1])})`);
});
test('a day older than the 5-minute statistics: the curve from the hourly means of every channel, 00:00 to 24:00, no gap', async () => {
  const now = D(2026, 10, 8, 12), chs = channels([SPM], new Set()), day = range('day', -15, now);
  const rows = Object.fromEntries(chs.map(c => [`${c.power.id}@hour`, Array.from({ length: 24 }, (_, i) => ({ start: day.start + i * HR, end: day.start + (i + 1) * HR, mean: 300 }))]));
  const r = await loadReport(fakeHost(rows, { statistic: () => null }), { channels: chs, meters: [], period: 'day', offset: -15, now, tariff: null, grouped: false, first: D(2026, 9, 1) });
  const c = r.curve!; assert.equal(c.length, 288);
  assert.deepEqual(c.filter(p => p.future).map(p => new Date(p.at).toTimeString().slice(0, 5)), [], 'no point after 23:00 left undrawn');
  assert.ok(c.every(p => !p.missing && !p.partial), 'no gap: every channel has its hourly mean');
  assert.equal(c[287].v.entrance_spm_apt9, 300, '23:55 from the 23:00 mean');
});
test('the rooms hint names the panel\'s own tab and its Rooms page in each language («Settings → Rooms» was no tab in English)', () => {
  for (const d of [ru, en, ro] as Array<Record<string, string>>) {
    assert.match(d['ep.roomsHint'], /\{path\}$/, `the path is built from the tab names: «${d['ep.roomsHint']}»`); assert.doesNotMatch(d['ep.roomsHint'], /→/);
  }
  assert.deepEqual([en, ro, ru].map(d => `${d['section.settings']} → ${d['setup.rooms']}`), ['Setup → Rooms', 'Configurare → Camere', 'Настройка → Комнаты']);
});

// ── round 5 of the audit ──
test('a silence that began before the period is a gap: no carried mark lost, the catch-up never the peak, the average over every day', async () => {
  const now = D(2026, 10, 8, 12), chs = channels([SPM], new Set()), day = range('day', 0, now);
  // the SPM silent from 22:00 yesterday to 07:00 today; 07:00 holds the nine hours
  const rows = Object.fromEntries(chs.map(c => [`${c.energy}@hour`, [...hourRows(day.start - 2 * 86400000, 46, 0.2), ...hourRows(day.start + 7 * HR, 5, 0.3).map((r, i) => i ? r : { ...r, change: 6 })]]));
  const r = await loadReport(fakeHost(rows, { statistic: () => null }), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 1) });
  assert.equal(r.dataFrom, day.start, 'the statistics ran before today: they do not begin at 07:00');
  assert.deepEqual(r.buckets.slice(0, 9).map(b => [!!b.missing, !!b.carried]), [...Array.from({ length: 7 }, () => [true, false]), [false, true], [false, false]], '00:00–07:00 silent, 07:00 carried');
  const peak = r.buckets.map((b, i) => ({ v: Object.values(b.v).reduce((a, v) => a + v, 0), i, b })).filter(x => !x.b.future && !x.b.carried && x.v > 0).reduce((a, x) => x.v > a.v ? x : a);
  assert.equal(peak.i, 8, 'the costliest hour is not the catch-up at 07:00');
  // a week with Monday and Tuesday silent, back on Wednesday
  const week = (silent: number[]) => Object.fromEntries(chs.map(c => [`${c.energy}@day`, [1, 2, 3, 4, 5, 6, 7, 8].filter(d => !silent.includes(d)).map(d => ({ start: D(2026, 10, d), end: D(2026, 10, d + 1), change: d === 4 && silent.includes(3) ? 27 : 9 }))]));
  const w = await loadReport(fakeHost(week([2, 3]), { statistic: () => null }), { channels: chs, meters: [], period: 'week', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 1) });
  assert.equal(w.dataFrom, D(2026, 10, 2), 'no «Статистика есть с среды»: they began on 01.11');
  assert.deepEqual(w.buckets.map(b => [!!b.missing, !!b.carried]), [[true, false], [true, false], [false, true], [false, false], [false, false], [false, false], [false, false]]);
  assert.ok(Math.abs(daysElapsed(w) - 6.5) < 1e-9, `the average over six and a half days, not from Wednesday (${daysElapsed(w)})`); assert.equal(counted(w).length, 7);
  const tot = Object.values(totals(w)).reduce((a, v) => a + v, 0); assert.ok(Math.abs(barAverage(w, b => Object.values(b.v).reduce((a, v) => a + v, 0)) - tot / 6.5) < 1e-9);
  // the control: only Tuesday silent
  const c = await loadReport(fakeHost(week([3]), { statistic: () => null }), { channels: chs, meters: [], period: 'week', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 1) });
  assert.deepEqual(c.buckets.map(b => [!!b.missing, !!b.carried]), [[false, false], [true, false], [false, true], [false, false], [false, false], [false, false], [false, false]]);
  // the day the statistics began: the hours before the SPM came are not silent, its first hour is not carried
  const first = range('day', -7, now), r1 = await loadReport(fakeHost(Object.fromEntries(chs.map(ch => [`${ch.energy}@hour`, hourRows(first.start + 14 * HR, 10, 0.4)])), { statistic: () => null }), { channels: chs, meters: [], period: 'day', offset: -7, now, tariff: null, grouped: false, first: first.start });
  assert.equal(r1.dataFrom, first.start + 14 * HR); assert.ok(r1.buckets.every(b => !b.missing && !b.carried), 'the first day from 14:00: nothing silent, nothing carried');
});
const SPM_OFF = dev('spm', [...spmMetrics('apt8', 'Квартира 8 (ввод)', 'unavailable'), ...spmMetrics('ev', 'Зарядка авто', 'unavailable'), ...spmMetrics('apt9', 'Квартира 9 (ввод)', 'unavailable')], { model: 'Sonoff SPM' });
test('a meter silent until now: a gap up to now, not «future»; the comparison stops where it was last heard and the badge goes', async () => {
  const now = D(2026, 10, 8, 19) + 30000, day = range('day', 0, now), prev = range('day', -1, now);
  const load = async (devs: HomeDevice[]) => { const chs = channels(devs, new Set()), calls: Parameters<typeof fakeHost>[1]['calls'] = [];
    const rows = Object.fromEntries(chs.flatMap(c => [[`${c.energy}@hour`, hourRows(prev.start - HR, 25 + 15, 0.1)], [`${c.power.id}@5minute`, Array.from({ length: 15 * 12 }, (_, i) => ({ start: day.start + i * 300000, end: day.start + (i + 1) * 300000, mean: 400 }))]]));
    return { r: await loadReport(fakeHost(rows, { calls }), { channels: chs, meters: [], period: 'day', offset: 0, now, tariff: null, grouped: false, first: D(2026, 10, 1) }), calls }; };
  const { r, calls } = await load([SPM_OFF]), c = r.curve!, at = (h: number) => h * 12;
  assert.ok(c.slice(at(15), at(19)).every(p => p.missing && !p.future), '15:00–18:55: the meter silent, a gap, not still to come');
  assert.ok(c.slice(at(19)).every(p => p.future && !p.missing), 'from 19:00 still to come');
  assert.equal(c.reduce((m, p, i) => p.future ? m : i, -1), at(19) - 1, 'the now mark at 18:55, not at 14:55');
  assert.equal(r.silentSince, day.start + 15 * HR, 'silent since 15:00: no badge');
  assert.ok(calls.some(x => x.kind === 'statistic' && x.start === prev.start && x.end === prev.start + 15 * HR), 'yesterday up to 15:00, as today is');
  assert.ok(r.previous && Math.abs(r.previous.entrance_spm_apt9 - 1.5) < 1e-9, `yesterday over the same 15 hours (${r.previous?.entrance_spm_apt9})`);
  const ok = (await load([SPM])).r; assert.equal(ok.silentSince, null, 'the channels answering now: the badge stays'); assert.ok(ok.previous && Math.abs(ok.previous.entrance_spm_apt9 - 1.9) < 1e-9);
  // a past day silent from 18:00 to its end: a gap to 24:00, nothing «still to come»
  const chs = channels([SPM], new Set()), y = range('day', -1, now);
  const five = Object.fromEntries(chs.map(ch => [`${ch.power.id}@5minute`, Array.from({ length: 18 * 12 }, (_, i) => ({ start: y.start + i * 300000, end: y.start + (i + 1) * 300000, mean: 400 }))]));
  const p = (await loadReport(fakeHost(five, { statistic: () => null }), { channels: chs, meters: [], period: 'day', offset: -1, now, tariff: null, grouped: false, first: D(2026, 10, 1) })).curve!;
  assert.ok(p.every(x => !x.future), 'a finished day has nothing still to come'); assert.ok(p.slice(at(18)).every(x => x.missing) && p.slice(0, at(18)).every(x => !x.missing));
});
test('a week and a month while a channel is silent now: the stretch ends where it was last heard, not at the running day\'s clamped row', async () => {
  // Sunday 8.11 19:00:30; the silent channels last heard at 15:00 (their 5-minute means stop there, or only the hourly ones where the 5-minute are gone)
  const now = D(2026, 10, 8, 19) + 30000, day = range('day', 0, now), quiet = day.start + 15 * HR;
  const ONE = dev('spm', [...spmMetrics('apt8', 'Квартира 8 (ввод)', '150'), ...spmMetrics('ev', 'Зарядка авто', '0'), ...spmMetrics('apt9', 'Квартира 9 (ввод)', 'unavailable')], { model: 'Sonoff SPM' });
  const load = async (devs: HomeDevice[], period: 'week' | 'month', means: '5minute' | 'hour' = '5minute') => {
    const chs = channels(devs, new Set()), { start } = range(period, 0, now), prev = range(period, -1, now), calls: Parameters<typeof fakeHost>[1]['calls'] = [];
    const silent = (c: Channel) => c.power.state === 'unavailable', upTo = (c: Channel) => silent(c) ? quiet : now - 30000;
    const rows = Object.fromEntries(chs.flatMap(c => {
      // the days of the period, today's the running one (it ends at midnight); the hours from before the period before, a silent channel's up to 15:00
      const days = edges(period, start, range(period, 0, now).end).filter(t => t <= now).map(t => ({ start: t, end: t + 24 * HR, change: 2.4 }));
      const mean = means === '5minute' ? Array.from({ length: 15 * 12 }, (_, i) => ({ start: day.start + i * 300000, end: day.start + (i + 1) * 300000, mean: 400 })) : hourRows(day.start, 15, 0).map(r => ({ ...r, mean: 400 }));
      return [[`${c.energy}@day`, days], [`${c.energy}@hour`, hourRows(prev.start - HR, Math.round((upTo(c) - prev.start) / HR) + 1, 0.1)], [`${c.power.id}@${means}`, silent(c) ? mean.filter(r => r.end <= quiet) : mean]];
    }));
    return { r: await loadReport(fakeHost(rows, { calls }), { channels: chs, meters: [], period, offset: 0, now, tariff: null, grouped: false, first: D(2026, 8, 1) }), calls, prev, chs };
  };
  // the same moment of the period before: last Sunday 1.11 15:00 (6 days and 15 hours), 8 October 15:00 (7 days and 15 hours)
  for (const [period, hours] of [['week', 6 * 24 + 15], ['month', 7 * 24 + 15]] as const) {
    for (const [devs, what] of [[SPM_OFF, 'the whole SPM'], [ONE, 'apartment 9 next to working channels']] as const) {
      const { r, calls, prev } = await load([devs], period);
      assert.equal(r.silentSince, quiet, `${period}, ${what} silent since 15:00: no badge (it was ${r.silentSince === null ? 'null' : new Date(r.silentSince).toString()})`);
      assert.ok(calls.some(x => x.kind === 'statistic' && x.start === prev.start && x.end === prev.start + hours * HR), `${period}, ${what}: the period before up to the same 15:00`);
      assert.ok(r.previous && Math.abs(r.previous.entrance_spm_apt9 - hours * 0.1) < 1e-9 && Math.abs(r.previous.entrance_spm_apt8 - hours * 0.1) < 1e-9, `${period}, ${what}: the period before over the same stretch (${r.previous?.entrance_spm_apt9})`);
      assert.ok(calls.some(x => x.kind === 'statistics' && x.period === '5minute' && x.types.join() === 'mean' && x.ids.includes('sensor.entrance_spm_apt9_power') && !x.ids.includes(devs === ONE ? 'sensor.entrance_spm_apt8_power' : '-')), `${period}, ${what}: the silent channels' 5-minute means read`);
    }
    // more than 9 days ago the 5-minute means are gone: the last hourly mean says where it was last heard
    assert.equal((await load([SPM_OFF], period, 'hour')).r.silentSince, quiet, `${period}: from the hourly means when there are no 5-minute ones`);
    // the control: every channel answering, no extra read and the badge stays
    const ok = await load([SPM], period);
    assert.equal(ok.r.silentSince, null, `${period}: the channels answering now, the badge stays`); assert.ok(ok.r.previous, `${period}: compared`);
    assert.ok(!ok.calls.some(x => x.kind === 'statistics' && x.types.join() === 'mean'), `${period}: a normal refresh reads no power means for the silence`);
  }
});
test('half a year or a year left open across 1 January or 1 July reads its charging sessions again', async () => {
  const chs = channels([SPM], new Set()), s = [{ start: D(2026, 11, 30, 20), end: D(2026, 11, 30, 23), kwh: 9, peakW: 3500 }];
  for (const [period, late, next] of [['year', D(2026, 11, 31, 23, 58), D(2027, 0, 1, 0, 3)], ['half', D(2026, 5, 30, 23, 58), D(2026, 6, 1, 0, 3)]] as const) {
    const r = await loadReport(fakeHost({}), { channels: chs, meters: [], period, offset: 0, now: late, tariff: null, grouped: false, sessions: s });
    assert.equal(keptSessions(r, period, 0, late + 5 * 60000 - 1000), s, `${period}: the same period keeps its sessions`);
    assert.equal(keptSessions(r, period, 0, next), undefined, `${period} refreshed after its end: another period, the sessions read again`);
    const calls: Parameters<typeof fakeHost>[1]['calls'] = []; await loadReport(fakeHost({}, { calls }), { channels: chs, meters: [], period, offset: 0, now: next, tariff: null, grouped: false, sessions: keptSessions(r, period, 0, next) });
    assert.ok(calls.some(c => c.ids.includes('sensor.entrance_spm_ev_power')), `${period}: the charger's hours read for the new period`);
  }
  assert.equal(keptSessions(null, 'year', 0, Date.now()), undefined); assert.equal(keptSessions({ period: 'day', offset: 0, start: range('day', 0, D(2026, 10, 8)).start, sessions: s }, 'day', 0, D(2026, 10, 8)), undefined, 'a day reads them every time');
});
test('live check 08.11: meter names say what the plug feeds, not that it is a meter', async () => {
  const { meterName } = await import('../src/model/energy-load.ts');
  assert.equal(meterName('Детская · Счётчик энергии (телевизор)'), 'Телевизор');
  assert.equal(meterName('Гостиная · Розетка Xiaomi (Apple TV)'), 'Apple TV');
  assert.equal(meterName('Кухня · Розетка котла (ttec Prizi)'), 'Розетка котла');
  assert.equal(meterName('Розетка сушильной машины Ванная · Розетка сушильной машины'), 'Розетка сушильной машины');
  assert.equal(meterName('Компьютерная · Розетка компьютера (реле TS0001 с измерением)'), 'Розетка компьютера');
});
test('live check 08.11: with HA\'s Energy list the panel takes exactly its counters (the dryer and its socket are not both counted)', () => {
  const dryer = dev('dryer', [ref('sensor.bath_dryer_energy', 'energy')]), socket = dev('socket', [ref('sensor.bath_dryer_socket_energy_total', 'energy'), ref('sensor.bath_dryer_socket_energy_today', 'energy')]), feeder = dev('feeder', [ref('sensor.kitchen_cat_feeder_energy_est', 'energy')]);
  const m = meters([SPM, dryer, socket, feeder], new Set(), { name: d => d.key, room: () => 'r', feed: () => null, listed: new Set(['sensor.bath_dryer_socket_energy_total', 'sensor.kitchen_cat_feeder_energy_est', 'sensor.entrance_spm_ev_energy_total']) });
  assert.deepEqual(m.map(x => x.id), ['sensor.bath_dryer_socket_energy_total']);
});
