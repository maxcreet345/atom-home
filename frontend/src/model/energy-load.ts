import type { Host, StatPeriod, StatRow } from '../runtime/host.ts';
import type { EntityRef, HomeDevice } from './discover.ts';
import { isElectric, isMains } from './energy.ts';
import { feedColors, type Bucket, type EnergyReport, type FeedNetwork, type MeteredDevice, type Period, type Session, type Split } from './energy-report.ts';
/** Reading the Energy panel's period out of HA's statistics (owner, 08.11.2026). Read-only: two recorder queries, nothing is written. */
const HOUR = 3600000, DAY = 24 * HOUR, FIVE = 300000;
/** The start of the statistics row of `period` just before `t` (an hour, a day, a month). */
const unitBefore = (period: StatPeriod, t: number): number => { if (period === 'hour') return t - HOUR; if (period === '5minute') return t - FIVE; const d = new Date(t); if (period === 'month') d.setMonth(d.getMonth() - 1); else d.setDate(d.getDate() - (period === 'week' ? 7 : 1)); return d.getTime(); };
/** One SPM channel: its power now, the running total the statistics count, and the network readings of the same input. */
export interface Channel { key: string; name: string; short: string; charger: boolean; power: EntityRef; energy: string; /** the running total HA's Energy settings name */ total: string | null; /** the room of the meter: its floor is the building */ areaId: string | null; voltage: EntityRef | null; current: EntityRef | null; pf: EntityRef | null }
const METRIC_WORD = /^(мощность|power|putere|energy|энергия|energie)$/i;
/** «Подъезд · Квартира 8 (ввод) · мощность» → «Квартира 8»: the last part that is neither the place nor the reading, without the remark in brackets. */
export function channelName(raw: string): string {
  const parts = raw.split(/\s*·\s*/).map(p => p.replace(/\s*\([^)]*\)/g, '').trim()).filter(p => p && !METRIC_WORD.test(p));
  return parts.at(-1) ?? raw;
}
export const shortName = (name: string): string => { const m = name.match(/^(квартира|apartment|apartamentul?|apt\.?)\s*(\S+)/i); return m ? `${/^кв/i.test(m[1]) ? 'кв.' : /^apartam/i.test(m[1]) ? 'ap.' : 'apt'} ${m[2]}` : name.split(/\s+/)[0].toLowerCase(); };
const CHARGER = /заряд|charg|încărc|wallbox|\bev\b|_ev(_|$)/i;
/** The house feed's channels: every electric power reading of the SPM that has its running total beside it (Tasmota: `<stem>_power` and
 * `<stem>_energy_total`; the old eWeLink one: `…_power_N` and `…_energy_N`). A channel switched off in HA has no readings and is not here. */
export function channels(devices: HomeDevice[], boilers: Set<string>, grid?: ReadonlySet<string>): Channel[] {
  const mains = devices.filter(d => isMains(d, grid)), every = mains.flatMap(d => [...d.metrics, ...d.parameters, ...d.diagnostics]), out: Channel[] = [];
  // each device's own readings: five POWs share one naming, and `tasmota_energy_today` of the first must not answer for the others
  for (const d of mains) { const powers = d.metrics.filter(m => isElectric(m, d, boilers)), own = [...d.metrics, ...d.parameters, ...d.diagnostics]; for (const p of powers) {
    const m = p.id.match(/^(.*)_power(_\d+)?$/); if (!m) continue;
    // Tasmota POW names its readings `<dev>_energy_power`, `<dev>_energy_today`, `<dev>_energy_total`: the stem without its `_energy` is tried too
    const stem = m[1], idx = m[2] ?? '', stems = [stem, ...(/_energy$/.test(stem) ? [stem.replace(/_energy$/, '')] : [])];
    const find = (cls: string, ends: string[]) => own.find(x => x.deviceClass === cls && stems.some(st => ends.some(e => x.id === st + e + idx || x.id === st + e))) ?? every.find(x => x.deviceClass === cls && stems.some(st => ends.some(e => x.id === st + e + idx))) ?? null;
    // the daily counter first (live check 09.11.2026): HA's statistics put a meter's whole running total into its first day (apartment 9:
    // 699,5 kWh on 01.11) and count a meter that restarts from zero as fresh use; a counter that resets every midnight bounds both by one day
    const energy = find('energy', ['_energy_today', '_energy_day']) ?? find('energy', ['_energy_total', '_energy']); if (!energy) continue;
    // a meter with one input is named as a device (a Tasmota POW, «Пайка»); the SPM's channels keep their own names
    const name = channelName(powers.length === 1 ? d.name : p.name), total = find('energy', ['_energy_total', '_energy', '_energy_year']);
    out.push({ key: stem.replace(/^sensor\./, '') + idx, name, short: shortName(name), charger: CHARGER.test(`${name} ${p.id}`), power: p, energy: energy.id, total: total?.id ?? null, areaId: d.roomId ?? null, voltage: find('voltage', ['_voltage']), current: find('current', ['_current']), pf: find('power_factor', ['_power_factor']) });
  } }
  // the charger on top, the apartments below it with the higher number first: the order the owner saw on the mock and keeps the colours fixed
  return out.sort((a, b) => Number(a.charger) - Number(b.charger) || b.name.localeCompare(a.name, undefined, { numeric: true }));
}
export interface Meter { key: string; id: string; name: string; room: string; feed: string | null }
/** The devices with their own energy counter, picked one counter each (the running total if there is one, never «yesterday» or an estimate),
 * leaving out the SPM, the gas boiler and a plug that HA's Energy settings list as holding other plugs (it would count them twice). */
export function meters(devices: HomeDevice[], boilers: Set<string>, opts: { name: (d: HomeDevice) => string; room: (d: HomeDevice) => string; feed: (d: HomeDevice) => string | null; parents?: Set<string>; listed?: Set<string>; grid?: ReadonlySet<string> }): Meter[] {
  const out: Meter[] = [];
  // the list decides only in a room where it names a device: the owner's list (08.11.2026) leaves the office plugs out, and they still count
  const listedRooms = new Set(opts.listed?.size ? devices.filter(d => d.metrics.some(m => opts.listed!.has(m.id) && !/_est(_\d+)?$/i.test(m.id)) && !isMains(d, opts.grid)).map(d => d.roomId) : []);
  const daily = (d: HomeDevice) => d.metrics.find(m => m.deviceClass === 'energy' && /_energy_today$|_today_energy$/i.test(m.id) && !/output/i.test(m.id) && (m.attributes.state_class === 'total_increasing' || m.attributes.state_class === undefined));
  for (const d of devices) {
    if (isMains(d, opts.grid) || (d.haDeviceId !== null && boilers.has(d.haDeviceId))) continue;
    // a parent plug is left out whole: dropping only the counter HA names would let its other one (`energy_period`, `energy_today`) in
    if (opts.parents && d.metrics.some(m => opts.parents!.has(m.id))) continue;
    // live check 08.11.2026: the dryer reports its own energy and its socket does too. When HA's Energy settings list the devices (the owner
    // keeps that list: the bedroom TV went in the day its meter came), the panel takes exactly those counters; otherwise every counter it finds
    if (opts.listed?.size && listedRooms.has(d.roomId)) { const named = d.metrics.find(m => opts.listed!.has(m.id) && !/_est(_\d+)?$/i.test(m.id)), e = named && (daily(d) ?? named); if (e && !out.some(x => x.id === e.id)) out.push({ key: d.key, id: e.id, name: opts.name(d), room: opts.room(d), feed: opts.feed(d) }); continue; }
    const list = d.metrics.filter(m => m.deviceClass === 'energy' && !/(_est|yesterday|month|week)(_\d+)?$/i.test(m.id));
    const e = daily(d) ?? list.find(m => /total/i.test(m.id)) ?? list[0];
    if (e && !out.some(x => x.id === e.id)) out.push({ key: d.key, id: e.id, name: opts.name(d), room: opts.room(d), feed: opts.feed(d) });
  }
  return out;
}
/** A metered device's name in the list (live check 08.11.2026): the part after the place («Ванная · Розетка сушильной машины» →
 * «Розетка сушильной машины», also when HA repeats it), and what the brackets say when the name outside them is only the meter
 * («Счётчик энергии (телевизор)» → «Телевизор», «Розетка Xiaomi (Apple TV)» → «Apple TV»); a model in brackets is dropped. */
export function meterName(raw: string): string {
  const n = (raw.includes(' · ') ? raw.split(' · ').at(-1)! : raw).trim(), m = n.match(/^(.*?)\s*\(([^)]+)\)\s*$/), base = (m ? m[1] : n).trim(), inner = m?.[2].trim();
  if (inner && /^(сч[её]тчик( энергии)?|розетка( xiaomi| tuya| tapo| sonoff)?|реле|smart plug|plug|socket|meter|energy meter)$/i.test(base)) return inner.charAt(0).toUpperCase() + inner.slice(1);
  return base || n;
}
/** HA's Energy settings (owner, 09.11.2026: «it should take them automatically»): the grid connections pick the SPM channels the panel
 * shows (a connection's counter names its channel: `sensor.<channel>_energy_total`), and a static or entity price is the tariff. */
/** HA's grid connections: the counters that make a device a feed (isMains). */
export const gridIds = (prefs: EnergyPrefs | null | undefined): Set<string> => new Set((prefs?.energy_sources ?? []).filter(s => s.type === 'grid' && s.stat_energy_from).map(s => s.stat_energy_from!));
/** The feed a metered device is inside, as HA's Energy settings nest it («upstream device»): the channel whose counter it is included in. */
export function feedOfStat(chs: Channel[], prefs: EnergyPrefs | null | undefined, ids: string[]): string | null {
  const e = (prefs?.device_consumption ?? []).find(x => x.included_in_stat && x.stat_consumption && ids.includes(x.stat_consumption)); if (!e) return null;
  return chs.find(c => c.total === e.included_in_stat || c.energy === e.included_in_stat)?.key ?? null;
}
/** The name HA's Energy settings give a metered device (the owner names them there), if any. */
export const prefName = (prefs: EnergyPrefs | null | undefined, ids: string[]): string | null => (prefs?.device_consumption ?? []).find(x => x.stat_consumption && ids.includes(x.stat_consumption) && (x as { name?: string }).name)?.name ?? null;
export interface EnergyPrefs { energy_sources?: Array<{ type?: string; stat_energy_from?: string | null; number_energy_price?: number | null; entity_energy_price?: string | null }>; device_consumption?: Array<{ stat_consumption?: string; included_in_stat?: string; name?: string }> }
export function prefChannels(chs: Channel[], prefs: EnergyPrefs | null): Channel[] {
  const grid = (prefs?.energy_sources ?? []).filter(s => s.type === 'grid' && s.stat_energy_from).map(s => s.stat_energy_from!);
  if (!grid.length) return chs;
  // the counter itself (a POW's running total) first: `tasmota_energy` would otherwise prefix every `tasmota_energy_total_N`
  const picked = chs.filter(c => grid.some(id => id === c.energy || id === c.total)).length ? chs.filter(c => grid.some(id => id === c.energy || id === c.total)) : chs.filter(c => grid.some(id => id.startsWith(`sensor.${c.key}_`)));
  return picked.length ? picked : chs;
}
export function prefTariff(prefs: EnergyPrefs | null, state: (id: string) => string | undefined): number | null {
  for (const s of prefs?.energy_sources ?? []) {
    if (s.type !== 'grid') continue;
    if (typeof s.number_energy_price === 'number' && s.number_energy_price > 0) return s.number_energy_price;
    const v = s.entity_energy_price ? Number(state(s.entity_energy_price)) : NaN; if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}
/** The stretch a period covers, by the local calendar: offset 0 is the current one, −1 the one before. Halves are January–June and July–December. */
export function range(period: Period, offset: number, now: number): { start: number; end: number } {
  const n = new Date(now), y = n.getFullYear(), mo = n.getMonth(), d0 = new Date(y, mo, n.getDate());
  if (period === 'day') return { start: new Date(y, mo, n.getDate() + offset).getTime(), end: new Date(y, mo, n.getDate() + offset + 1).getTime() };
  if (period === 'week') { const mon = new Date(d0); mon.setDate(d0.getDate() - (d0.getDay() + 6) % 7 + 7 * offset); const e = new Date(mon); e.setDate(mon.getDate() + 7); return { start: mon.getTime(), end: e.getTime() }; }
  if (period === 'month') return { start: new Date(y, mo + offset, 1).getTime(), end: new Date(y, mo + offset + 1, 1).getTime() };
  if (period === 'half') { const h = mo < 6 ? 0 : 6; return { start: new Date(y, h + 6 * offset, 1).getTime(), end: new Date(y, h + 6 * offset + 6, 1).getTime() }; }
  return { start: new Date(y + offset, 0, 1).getTime(), end: new Date(y + offset + 1, 0, 1).getTime() };
}
/** The rows each period's bars are summed from. Half a year reads days into its weeks: HA moves a week query's start back to a Monday, so the
 * week rows of July began in June, and the first week of the statistics (from 01.11.2026, a Sunday) began on Monday 26.10. */
export const STAT_PERIOD: Record<Period, StatPeriod> = { day: 'hour', week: 'day', month: 'day', half: 'day', year: 'month' };
/** The moment of the period before that matches `t` of this one by the calendar: the same clock time on the same day of the period (a day, a
 * week), or on the same day of the same month of it (a month, half a year, a year; a 31st where that month is shorter is the month's end). */
export function sameMoment(period: Period, start: number, prevStart: number, t: number): number {
  const a = new Date(start), p = new Date(prevStart), x = new Date(t), clock = [x.getHours(), x.getMinutes(), x.getSeconds(), x.getMilliseconds()] as const;
  if (period === 'day' || period === 'week') { const days = Math.round((new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() - start) / DAY); return new Date(p.getFullYear(), p.getMonth(), p.getDate() + days, ...clock).getTime(); }
  const m = p.getMonth() + (x.getFullYear() - a.getFullYear()) * 12 + x.getMonth() - a.getMonth(), last = new Date(p.getFullYear(), m + 1, 0).getDate();
  return x.getDate() > last ? new Date(p.getFullYear(), m + 1, 1).getTime() : new Date(p.getFullYear(), m, x.getDate(), ...clock).getTime();
}
/** Where each bar starts: hours, days, weeks from Monday (the first one from the 1st), months. */
export function edges(period: Period, start: number, end: number): number[] {
  const e: number[] = [], d = new Date(start);
  if (period === 'day') { for (let t = start; t < end; t += HOUR) e.push(t); return e; } // by the clock it would skip the repeated hour of the autumn change
  if (period === 'week' || period === 'month') { while (d.getTime() < end) { e.push(d.getTime()); d.setDate(d.getDate() + 1); } return e; }
  if (period === 'half') { e.push(start); d.setDate(d.getDate() + (7 - (d.getDay() + 6) % 7) % 7 || 7); while (d.getTime() < end) { e.push(d.getTime()); d.setDate(d.getDate() + 7); } return e; }
  while (d.getTime() < end) { e.push(d.getTime()); d.setMonth(d.getMonth() + 1); } return e;
}
const indexOf = (e: number[], t: number) => { let i = 0; while (i + 1 < e.length && e[i + 1] <= t) i++; return i; };
const changeOf = (rows: StatRow[] | undefined) => (rows ?? []).reduce((a, r) => a + (r.change ?? 0), 0);
/** The charger's sessions out of its power: above 300 W is charging, a pause up to 20 minutes is still the same session. */
export function sessionsOf(rows: StatRow[], step: number): Session[] {
  const out: Session[] = []; let cur: Session | null = null;
  for (const r of rows) { const w = r.mean ?? 0; if (w < 300) continue; const peak = Math.max(w, r.max ?? 0), kwh = w * (r.end - r.start) / HOUR / 1000;
    if (cur && r.start - cur.end <= 20 * 60000) { cur.end = r.end; cur.kwh += kwh; cur.peakW = Math.max(cur.peakW, peak); } else { if (cur) out.push(cur); cur = { start: r.start, end: r.end, kwh, peakW: peak }; } }
  if (cur) out.push(cur); void step;
  return out.filter(s => s.kwh >= 0.3).reverse();
}
export interface LoadInput { /** the charger's parent feed (config modules.energy.options.chargerOf) */ chargerOf?: string | null; channels: Channel[]; meters: Meter[]; period: Period; offset: number; now: number; tariff: number | null; grouped: boolean; /** the last charging sessions of this period: half and year read the charger's hours once, not on every refresh */ sessions?: Session[] | null; /** the first moment of the statistics (firstStatistics): a month's or a week's row starts before it */ first?: number | null }
/** Network min/max per day for the short periods; a month per row for the long ones (only the lowest and highest count; half a year of days,
 * re-read every 5 minutes, was 0,5 MB, and a week's row began on the Monday before the half). */
const NET: Record<Period, StatPeriod> = { day: 'day', week: 'day', month: 'day', half: 'month', year: 'month' };
/** Everything the panel shows for one period. Throws when HA does not answer, so the panel can say so instead of drawing zeros.
 * HA's `statistics_during_period` gives only finished hours for every period but 5 minutes (recorder/statistics.py), while
 * `statistic_during_period` adds the 5-minute head and tail: the running hour comes from the latter, so «сегодня» here is the tile's and
 * yesterday is compared over the same span. All the reads start together; only the curve's hourly fill-in waits for the 5-minute answer. */
export async function loadReport(host: Host, x: LoadInput): Promise<EnergyReport> {
  if (!host.statistics) throw new Error('no statistics');
  const stats = host.statistics.bind(host), { start, end } = range(x.period, x.offset, x.now), until = Math.min(x.now, end), e = edges(x.period, start, end), chs = x.channels, colors = feedColors(chs);
  const feeds = chs.map((c, i) => ({ key: c.key, name: c.name, short: c.short, color: colors[i], charger: c.charger, ...(c.charger && x.chargerOf && x.chargerOf !== c.key && chs.some(o => o.key === x.chargerOf) ? { partOf: x.chargerOf } : {}) }));
  const zero = (): Split => Object.fromEntries(chs.map(c => [c.key, 0]));
  const stat = (id: string, a: number, b: number): Promise<number | null> => b <= a ? Promise.resolve(0) : host.statistic ? host.statistic(id, a, b, ['change']).then(r => typeof r.change === 'number' ? r.change : null, () => null) : Promise.resolve(null);
  const energyIds = chs.map(c => c.energy), powerIds = chs.map(c => c.power.id), prev = range(x.period, x.offset - 1, x.now), running = until < end;
  // statistic_during_period ends with the 5-minute slots that start before its end (recorder/statistics.py: `start_ts < end_time_ts`). Today's
  // slot of now is not compiled yet and yesterday's same slot is, so «up to now» took one slot more of yesterday (▼ 50 % at 00:07 on an
  // identical day). Both sides end at the last compiled boundary instead, a slot further back within 20 s of it (HA compiles just after it)
  const five0 = Math.floor(x.now / FIVE) * FIVE, upTo = running ? Math.max(start, Math.min(end, x.now - five0 < 20000 ? five0 - FIVE : five0)) : until;
  // the bar just before the period: whether the meter was silent then, so its first bar (today's 00:00 after a silent yesterday) is «carried»
  const lead = unitBefore(STAT_PERIOD[x.period], start);
  const net = chs.filter(c => !c.charger && c.voltage), netIds = net.flatMap(c => [c.voltage!.id, ...(c.current ? [c.current.id] : [])]);
  // a finished period against the whole one before it; the running one against the same stretch of it by the calendar (February opened in
  // March was 1–28 January, a 24-hour day after the autumn change was 24 of the 25 hours)
  const charger = chs.find(c => c.charger), fine = x.now - start <= 9 * DAY, prevAt = (t: number) => running ? Math.min(prev.end, sameMoment(x.period, start, prev.start, t)) : prev.end;
  const [main, whole, cover, prevWhole, five, mm, chargerRows, monthKwh, leadRows] = await Promise.all([
    stats([...energyIds, ...x.meters.map(m => m.id)], start, end, STAT_PERIOD[x.period], ['change']),
    running ? Promise.all(chs.map(c => stat(c.energy, start, upTo))) : Promise.resolve(null),
    // for «the same stretch before»: an hour's row at or just before the previous period's start means the statistics already ran then, so it is
    // whole; without one it is partly before they began (01.11.2026: a week against its one last day, «▲ 706 %»). Hours, because HA keeps them
    // for good and does not move them to a day's or a month's boundary; and a first row right at the start is a whole period too
    stats(energyIds, prev.start - HOUR, prev.start + HOUR, 'hour', ['change']).catch(() => null),
    Promise.all(chs.map(c => stat(c.energy, prev.start, prevAt(upTo)))),
    x.period === 'day' ? stats(powerIds, start, end, '5minute', ['mean']) : Promise.resolve(null),
    netIds.length ? stats(netIds, start, until, NET[x.period], ['min', 'max']).catch(() => ({} as Record<string, StatRow[]>)) : Promise.resolve({} as Record<string, StatRow[]>),
    charger && x.sessions === undefined ? stats([charger.power.id], start, until, fine ? '5minute' : 'hour', ['mean', 'max']).catch(() => null) : Promise.resolve(null),
    x.offset === 0 && host.energyMonth ? host.energyMonth(energyIds).catch(() => null) : Promise.resolve(null),
    stats(energyIds, lead, start, STAT_PERIOD[x.period], ['change']).catch(() => null),
  ]);
  const buckets: Bucket[] = e.map(at => ({ at, future: at > x.now, v: zero() })), hit = new Set<number>();
  for (const c of chs) for (const r of main[c.energy] ?? []) { const i = indexOf(e, Math.max(r.start, start)); hit.add(i); buckets[i].v[c.key] += r.change ?? 0; }
  // the running hour: what statistic_during_period counted beyond the finished rows goes to the bar its last counted minute is in (upTo), not
  // to the bar of now: at 13:00:05 HA has not written the 12:00 row yet and the tail is 12:00–12:55, which in the 13:00 bar left 12:00 «no
  // data» and 13:00 «carried» on a normal day; the week at 00:00:05 put Monday's last hour into Tuesday the same way
  const tailOk = !!whole && whole.every(w => typeof w === 'number'), lastRowEnd = Math.min(until, Math.max(start, ...chs.flatMap(c => (main[c.energy] ?? []).map(r => r.end))));
  if (whole) chs.forEach((c, i) => { const w = whole[i], rows = changeOf(main[c.energy]); if (typeof w === 'number' && w > rows) { const k = indexOf(e, Math.max(start, upTo - 1)); hit.add(k); buckets[k].v[c.key] += w - rows; } });
  const firsts = chs.flatMap(c => (main[c.energy] ?? []).filter(r => (r.change ?? 0) !== 0 || r.start >= start).map(r => Math.max(r.start, start)));
  // a month's row (the year) starts on the 1st whatever day the statistics began: never before their first moment. When they already ran at the
  // period's start, its first row is not where they begin: a silence from 22:00 yesterday to 07:00 is seven silent bars and a carried 07:00, not
  // «the costliest hour 07:00» (Monday and Tuesday silent were a week from Wednesday, its average ×5, «Статистика есть с …»). Only a period they
  // began in (or at the start of) starts at its first row: their first moment is a day's start, the SPM may have come at 14:00 of it. No row at all stays null
  const from0 = firsts.length ? Math.min(...firsts) : tailOk ? start : null;
  const dataFrom = from0 === null || typeof x.first !== 'number' ? from0 : x.first >= start ? Math.max(from0, x.first) : start;
  // a finished bar after the statistics began with no row of any channel: the meter was silent, which is not a measured 0 kWh. Its energy is
  // not lost: the running total kept counting, and HA puts it into the hour the meter came back in, so the period's sum stays whole
  if (dataFrom !== null) buckets.forEach((b, i) => { if ((e[i + 1] ?? end) <= x.now && (e[i + 1] ?? end) > dataFrom && !hit.has(i)) b.missing = true; });
  // ...and that hour holds the silent stretch's energy as well: its own use is not known, only the sum. The first bar looks at the row just
  // before the period (the silence was yesterday, the catch-up in today's 00:00), counted only when the statistics already ran then
  const silentBefore = !!leadRows && typeof x.first === 'number' && x.first <= lead && !chs.some(c => (leadRows[c.energy] ?? []).length);
  buckets.forEach((b, i) => { if (hit.has(i) && (i ? buckets[i - 1].missing : silentBefore)) b.carried = true; });
  const devices: MeteredDevice[] = x.meters.map(m => ({ key: m.key, feed: m.feed, room: m.room, name: m.name, kwh: Math.max(0, changeOf(main[m.id])) })).filter(d => d.kwh > 0.005);
  let curve: Bucket[] | undefined;
  if (five) {
    // HA keeps 5-minute statistics 10 days: an older day, or the morning of the day at that edge, is filled from the hourly means
    const firstFive = Math.min(end, ...Object.values(five).flat().map(r => r.start)), hourly = firstFive > start + 300000 ? await stats(powerIds, start, firstFive, 'hour', ['mean']).catch(() => ({} as Record<string, StatRow[]>)) : {};
    // an hourly row fills its 12 slots: the curve of a day with only hourly means reaches 23:55, not 23:00
    const last = Math.max(start - 1, ...Object.values(five).flat().map(r => r.start), ...Object.values(hourly).flat().map(r => r.start + HOUR - FIVE));
    // still to come: after the last row and not compiled yet (upTo). A meter silent since 15:00 at 19:00 is a gap up to now, not «future» with the
    // now mark at 15:00 and a tap reading 14:55; a past day silent until 24:00 is a gap to its end
    curve = Array.from({ length: Math.round((end - start) / 300000) }, (_, i) => ({ at: start + i * 300000, future: start + i * 300000 > last && start + i * 300000 >= upTo, v: zero() }));
    const seen = curve.map(() => new Set<string>());
    const fill = (rows: Record<string, StatRow[]>, step: number, upTo: number) => { for (const c of chs) for (const r of rows[c.power.id] ?? []) for (let t = r.start; t < r.start + step && t < upTo; t += 300000) { const i = Math.round((t - start) / 300000); if (curve![i]) { curve![i].v[c.key] = Math.max(0, r.mean ?? 0); seen[i].add(c.key); } } };
    fill(hourly, HOUR, firstFive); fill(five, 300000, end);
    // HA writes no mean while a power reading is unavailable: a minute without any channel's row is the meter silent, not the house using 0 W;
    // one without some channel's row would stack a partial sum as the house's. Both are a gap (the rows there are kept for the sparklines)
    const from = typeof x.first === 'number' ? x.first : start;
    curve.forEach((p, i) => { if (p.future || p.at < from) return; if (!seen[i].size) p.missing = true; else if (seen[i].size < chs.length) p.partial = true; });
  }
  // the same stretch of the period before: yesterday up to this hour, last month's first eight days, last year up to today — only when the
  // statistics already ran then; and over the span this period's own figure covers (the finished rows, if HA would not give the running hour)
  // A channel silent now (its power unavailable) has nothing after its last row: today up to 19:00 against yesterday up to 19:00 read ▼ 25 % for an
  // SPM silent since 15:00. The stretch ends where it was last heard (the day: its last 5-minute mean; longer periods: the last 5-minute mean of
  // each silent channel, or its last hourly one), and after more than 15 minutes of that the badge is not shown at all (`silentSince`). Never the
  // end of a day's or a month's row: the running one is clamped to now, so a week and a month kept «▼ 64 %» for an SPM silent since 08:00
  const quiet = (c: Channel) => !(c.power.available && Number.isFinite(Number(c.power.state))), silentNow = running && chs.some(quiet);
  const lastEnd = (rows: Record<string, StatRow[]>, c: Channel) => Math.max(start, ...(rows[c.power.id] ?? []).map(r => Math.min(until, r.end)));
  let heard = lastRowEnd;
  if (five) heard = Math.min(...chs.map(c => lastEnd(five, c)));
  else if (silentNow) {
    // read only while a channel is silent: a normal refresh asks nothing more. A channel answering now is heard up to now
    const off = chs.filter(quiet), ids = off.map(c => c.power.id), none = {} as Record<string, StatRow[]>;
    const fm = await stats(ids, Math.max(start, x.now - 9 * DAY), until, '5minute', ['mean']).catch(() => none), old = off.filter(c => !(fm[c.power.id] ?? []).length);
    const hm = old.length ? await stats(old.map(c => c.power.id), start, until, 'hour', ['mean']).catch(() => none) : none;
    heard = Math.min(upTo, ...off.map(c => Math.max(lastEnd(fm, c), lastEnd(hm, c))));
  }
  const covered = silentNow ? Math.min(tailOk ? upTo : lastRowEnd, heard) : running && !tailOk ? lastRowEnd : upTo, before = covered === upTo ? prevWhole : await Promise.all(chs.map(c => stat(c.energy, prev.start, prevAt(covered))));
  const silentSince = silentNow && upTo - covered > 15 * 60000 ? covered : null;
  const whole0 = !!cover && Object.values(cover).some(rows => rows.some(r => r.start <= prev.start));
  const previous = whole0 && before.every(b => typeof b === 'number') ? Object.fromEntries(chs.map((c, i) => [c.key, Math.max(0, before[i] as number)])) : null;
  // a meter that lost power reads 0 V (a POW behind a tripped breaker, Atom + Okapi 09.11.2026): that is no reading, not a mains dip to zero
  const lo = (id?: string) => { const v = (id ? mm[id] ?? [] : []).map(r => r.min).filter((n): n is number => typeof n === 'number' && n >= 50); return v.length ? Math.min(...v) : null; }, hi = (id?: string) => { const v = (id ? mm[id] ?? [] : []).map(r => r.max).filter((n): n is number => typeof n === 'number'); return v.length ? Math.max(...v) : null; };
  const now = (m: EntityRef | null) => m && m.available && Number.isFinite(Number(m.state)) ? Number(m.state) : null;
  const network: FeedNetwork[] = net.map(c => ({ feed: c.key, volts: x.offset === 0 ? now(c.voltage) : null, voltsMin: lo(c.voltage!.id), voltsMax: hi(c.voltage!.id), amps: x.offset === 0 ? now(c.current) : null, ampsMax: hi(c.current?.id), pf: x.offset === 0 ? now(c.pf) : null }));
  const sessions: Session[] | null = !charger ? null : x.sessions !== undefined ? x.sessions : chargerRows ? sessionsOf(chargerRows[charger.power.id] ?? [], fine ? 300000 : HOUR) : null;
  let month: EnergyReport['month'];
  if (typeof monthKwh === 'number') { const m = range('month', 0, x.now); month = { start: m.start, end: m.end, kwh: monthKwh }; }
  // the spare SPM channel (live check 08.11.2026: «Канал 4», nothing on it) is left out while it counts nothing and no room hangs on it; a charger stays
  const counted = (k: string) => buckets.reduce((a, b) => a + (b.v[k] ?? 0), 0), shownFeeds = feeds.filter(f => f.charger || counted(f.key) >= 0.005 || x.meters.some(m => m.feed === f.key));
  return { period: x.period, offset: x.offset, start, end, now: x.now, feeds: shownFeeds, network: network.filter(n => shownFeeds.some(f => f.key === n.feed)), tariff: { lei: x.tariff ?? 3, assumed: x.tariff === null }, power: null, buckets, curve, previous, devices, grouped: x.grouped, sessions, month, dataFrom, silentSince };
}
/** The charging sessions a refresh of half a year or a year keeps instead of reading the charger's hours again: only the same period that still
 * starts where it did (offset 0 is another year after 1 January, another half after 1 July: last year's sessions stood under «2027»). */
export function keptSessions(l: Pick<EnergyReport, 'period' | 'offset' | 'start' | 'sessions'> | null, period: Period, offset: number, now: number): Session[] | undefined {
  return (period === 'half' || period === 'year') && l && l.period === period && l.offset === offset && l.start === range(period, offset, now).start && l.sessions ? l.sessions : undefined;
}
/** The first moment the house feed has statistics (the SPM came on 01.11.2026): the first month, then the first day in it. The panel's
 * «Раньше» stops there. null: HA answered with no rows, and nothing is limited. HA not answering rejects: the panel asks again, it does not
 * take a failed read for «no statistics» for good. */
export async function firstStatistics(host: Host, chs: Channel[], now: number): Promise<number | null> {
  if (!host.statistics || !chs.length) return null;
  const ids = chs.map(c => c.energy), first = (rows: Record<string, StatRow[]>) => { const s = Object.values(rows).flat().map(r => r.start); return s.length ? Math.min(...s) : null; };
  const m = first(await host.statistics(ids, new Date(2000, 0, 1).getTime(), now, 'month', ['change'])); if (m === null) return null;
  const d = new Date(m); return first(await host.statistics(ids, m, new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), 'day', ['change'])) ?? m;
}
