// Made-up statistics for the Energy panel: what HA's recorder could hold for this house from 01.01.2025 up to now, in the shape the real
// `recorder/statistics_during_period` answers with, under the real entity ids (book/06-dashboards/ENERGY.md). Deterministic for a given
// minute. Not the owner's data: the SPM's own statistics only start around 01.11.2026.
const H = 3600000, DAY = 24 * H, SEASON = [1.3, 1.25, 1.1, 0.95, 0.9, 1.0, 1.15, 1.15, 0.95, 1.0, 1.1, 1.25];
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
export const FEED_IDS = { apt9: 'entrance_spm_apt9', apt8: 'entrance_spm_apt8', ev: 'entrance_spm_ev' };
// the metered devices: area, device name, energy counter, a typical day's kWh and when in the day it is used
export const METERS = [
  ['kukhnia', 'Бойлер', 'sensor.kitchen_boiler_plug_energy', 2.9, 'heat'], ['prikhozhaia', 'ИБП (NAS, роутеры, камеры)', 'sensor.hall_ups_plug_energy', 1.75, 'flat'],
  ['kukhnia', 'Холодильник', 'sensor.kitchen_fridge_plug_energy', 1.15, 'flat'], ['gostinaia', 'Очиститель воздуха', 'sensor.living_purifier_plug_energy_today', 0.7, 'flat'],
  ['gostinaia', 'Телевизор', 'sensor.living_tv_meter_total_energy', 0.55, 'evening'], ['kukhnia', 'Аэрогриль', 'sensor.kitchen_airfryer_meter_total_energy', 0.5, 'evening'],
  ['kukhnia', 'Чайник', 'sensor.kitchen_kettle_plug_energy', 0.48, 'day'], ['gostinaia', 'Увлажнитель', 'sensor.living_humidifier_plug_energy', 0.38, 'night'],
  ['gostinaia', 'Яндекс Станция Макс', 'sensor.living_yandex_max_plug_energy_today', 0.14, 'flat'], ['gostinaia', 'Apple TV', 'sensor.living_appletv_plug_energy_today', 0.1, 'evening'],
  ['gostinaia', 'Пылесос', 'sensor.living_vacuum_meter_total_energy', 0.08, 'day'],
  ['kompiuternaia', 'Компьютер и хаб Ugreen', 'sensor.office_pc_plug_energy_total', 2.45, 'work'], ['kompiuternaia', 'Монитор', 'sensor.office_monitor_plug_energy', 0.32, 'work'],
  ['detskaia', 'Телевизор', 'sensor.kids_tv_meter_total_energy', 0.3, 'evening'], ['kompiuternaia', 'Яндекс Станция', 'sensor.office_yandex_plug_energy_today', 0.09, 'flat'],
];
export const APT8_ROOMS = ['vannaia', 'kompiuternaia', 'detskaia'];
const SHAPE = { flat: () => 1, heat: h => (h >= 6.5 && h < 7.4) || (h >= 18 && h < 18.9) ? 12 : 0.2, evening: h => h >= 18 && h < 23.3 ? 4 : 0.1, day: h => h >= 8 && h < 21 ? 1.8 : 0.05, night: h => h >= 22 || h < 7 ? 2.4 : 0.3, work: h => h >= 9 && h < 18.5 ? 2.6 : 0.2 };
function watts(day, minute, ev, wash) {
  const h = minute / 60, n = Math.sin(minute * 1.7 + day) * 0.5 + 0.5;
  let a9 = 210 + (minute % 47 < 18 ? 85 : 0) + 25 * n;
  if (h >= 6.5 && h < 7.4) a9 += 1500; if (h >= 18 && h < 18.9) a9 += 1500;
  for (const k of [7.7, 13.2, 17.4, 21.1]) if (h >= k && h < k + 0.07) a9 += 2000;
  if (h >= 18.5 && h < 18.85) a9 += 1400; if (h >= 19 && h < 23.3) a9 += 140; if (h >= 7 && h < 8) a9 += 300;
  let a8 = 70 + 15 * n; if (h >= 9 && h < 18.5) a8 += 290; if (h >= 17 && h < 20.5) a8 += 95; if (h >= 19 && h < 23) a8 += 60;
  if (wash && h >= 10 && h < 11.6) a8 += h < 10.4 ? 1900 : 450;
  let e = 0; if (ev && h >= ev[0] && h < ev[1]) e = 3480 + 60 * n;
  return { apt9: a9, apt8: a8, ev: e };
}
/** @param now ms; @param opts.from first day (default 01.01.2025); @param opts.gapDays days with no statistics of the SPM (offline): their energy
 * comes in the first hour after them, as HA counts a running total that kept going; @param opts.silent whole hours some channels were silent,
 * [{ from, to, feeds: ['apt9'] }] (no feeds: all): no rows of their own, their energy in the channel's first hour after them */
export function energyStats(now, opts = {}) {
  let seed = 20261108; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  // a row exists once HA compiled it, some seconds after its slot ended: 20 s, as the panel assumes (energy-load.ts)
  const NOW = Math.floor((now - 20000) / 60000) * 60000, from = opts.from ?? new Date(2025, 0, 1).getTime(), hourFrom = dayStart(NOW) - 40 * DAY, fiveFrom = dayStart(NOW) - 9 * DAY;
  const st = { hour: {}, hourEdge: {}, day: {}, five: {}, fiveE: {}, hourMean: {}, dayMinMax: {} }, push = (o, id, row) => (o[id] ??= []).push(row);
  const shapeSum = Object.fromEntries(Object.entries(SHAPE).map(([k, f]) => [k, Array.from({ length: 24 }, (_, h) => f(h + 0.5)).reduce((a, v) => a + v, 0)]));
  // HA keeps hourly statistics for good; the preview keeps the last 40 days, and older ones only in the hour before and the hour of each 1st
  const first = t => { const d = new Date(t); return d.getDate() === 1 && d.getHours() === 0; }, edgeHour = hs => first(hs) || first(hs + H);
  // a day the SPM was silent has no rows of its own; its energy_total kept counting, so HA puts the day's energy into the hour it came back in
  const carry = { apt9: 0, apt8: 0, ev: 0 };
  for (let t = dayStart(from); t <= NOW; t = addDays(t, 1)) {
    const date = new Date(t), season = SEASON[date.getMonth()], weekend = date.getDay() === 0 || date.getDay() === 6;
    const evWin = rnd() < 0.4 || t === dayStart(NOW) ? [1 + rnd() * 0.6, 3.8 + rnd() * 1.4] : null, wash = rnd() < 0.34;
    const s9 = season * (weekend ? 1.12 : 1) * (0.9 + rnd() * 0.25), s8 = season * (weekend ? 0.85 : 1) * (0.85 + rnd() * 0.3), dev = METERS.map(() => 0.8 + rnd() * 0.4);
    const gap = !!opts.gapDays?.some(g => dayStart(g) === t), quiet = (f, hs) => gap || !!opts.silent?.some(s => hs >= s.from && hs < s.to && (!s.feeds || s.feeds.includes(f)));
    const dayTot = { apt9: 0, apt8: 0, ev: 0 }, devDay = METERS.map(() => 0), vmin = { apt9: 239, apt8: 239 }, vmax = { apt9: 221, apt8: 221 }, amax = { apt9: 0, apt8: 0 };
    for (let h = 0; h < 24; h++) {
      const hs = t + h * H; if (hs >= NOW) break;
      // as HA does: an hour's row (and so the day's) only once the hour is over, a 5-minute row once its 5 minutes are; the running hour is
      // only in the 5-minute energy, which statistic_during_period adds as its tail
      const done = hs + H <= NOW;
      const e = { apt9: 0, apt8: 0, ev: 0 }, mean = { apt9: 0, apt8: 0, ev: 0 }, peak = { apt9: 0, apt8: 0, ev: 0 }; let mins = 0;
      for (let m = h * 60; m < h * 60 + 60; m += 5) {
        const at = t + m * 60000; if (at + 300000 > NOW) break; const w = { apt9: 0, apt8: 0, ev: 0 };
        for (let k = 0; k < 5; k++) { const x = watts(t / DAY, m + k, evWin, wash); w.apt9 += x.apt9 * s9 / 5; w.apt8 += x.apt8 * s8 / 5; w.ev += x.ev / 5; }
        for (const f in w) { e[f] += w[f] * 5 / 60 / 1000; mean[f] += w[f]; peak[f] = Math.max(peak[f], w[f]); } mins++;
        if (at >= fiveFrom) for (const f in w) if (!quiet(f, hs)) { push(st.five, `sensor.${FEED_IDS[f]}_power`, [at, Math.round(w[f] * 10) / 10]); push(st.fiveE, `sensor.${FEED_IDS[f]}_energy_total`, [at, w[f] * 5 / 60 / 1000]); }
        for (const f of ['apt9', 'apt8']) { const v = 229 + 9 * Math.sin(at / 3.1e6) - w[f] / 900; vmin[f] = Math.min(vmin[f], v); vmax[f] = Math.max(vmax[f], v); amax[f] = Math.max(amax[f], w[f] / 228); }
      }
      if (!mins || !done) continue;
      // every channel's hourly power mean, as HA keeps them for good: a day older than the 5-minute ones draws its curve from them (only the
      // charger's left such a day two channels short, a gap from 00:00 to 24:00)
      for (const f in mean) if (!quiet(f, hs)) push(st.hourMean, `sensor.${FEED_IDS[f]}_power`, [hs, mean[f] / mins, peak[f]]);
      for (const f in e) { if (quiet(f, hs)) { carry[f] += e[f]; continue; } e[f] += carry[f]; carry[f] = 0; dayTot[f] += e[f]; if (hs >= hourFrom) push(st.hour, `sensor.${FEED_IDS[f]}_energy_total`, [hs, e[f]]); else if (edgeHour(hs)) push(st.hourEdge, `sensor.${FEED_IDS[f]}_energy_total`, [hs, e[f]]); }
      METERS.forEach(([, , id, kwh, shape], i) => { const v = kwh * dev[i] * (i < 11 ? s9 : s8) * SHAPE[shape](h + 0.5) / shapeSum[shape] * (mins / 12); devDay[i] += v; if (hs >= hourFrom) push(st.hour, id, [hs, v]); });
    }
    if (!gap) for (const f in dayTot) push(st.day, `sensor.${FEED_IDS[f]}_energy_total`, [t, dayTot[f]]);
    METERS.forEach(([, , id], i) => push(st.day, id, [t, devDay[i]]));
    if (!gap) for (const f of ['apt9', 'apt8']) { push(st.dayMinMax, `sensor.${FEED_IDS[f]}_voltage`, [t, vmin[f], vmax[f]]); push(st.dayMinMax, `sensor.${FEED_IDS[f]}_current`, [t, 0.3, amax[f]]); }
  }
  // the panel reads the channels' daily counters; the preview answers for them with the same rows
  for (const o of [st.hour, st.day, st.fiveE, st.hourEdge].filter(Boolean)) for (const k of Object.keys(o)) if (k.endsWith('_energy_total')) o[k.replace(/_energy_total$/, '_energy_today')] = o[k];
  return st;
}
/** The metered plugs in the registry, in their rooms (ids as in the book; the 28.10 snapshot predates them). */
export function addMeters(fx, power = true) {
  METERS.forEach(([area, name, id], i) => {
    const dev = `meter-${i}`; fx.devices.push({ id: dev, name, model: 'Smart plug', manufacturer: 'Tuya', area_id: area, entry_type: null });
    fx.entities.push({ entity_id: id, device_id: dev, area_id: null, disabled_by: null, hidden_by: null, entity_category: null, platform: 'tuya', device_class: 'energy', name: null, original_name: 'Энергия' });
    fx.states[id] = { state: '1.0', attributes: { device_class: 'energy', unit_of_measurement: 'kWh', state_class: 'total_increasing', friendly_name: `${name} · розетка Энергия` }, last_changed: '', last_updated: '' };
    if (power) { const pid = id.replace(/_energy(_total|_today)?$|_total_energy$/, '') + '_power'; fx.entities.push({ entity_id: pid, device_id: dev, area_id: null, disabled_by: null, hidden_by: null, entity_category: null, platform: 'tuya', device_class: 'power', name: null, original_name: 'Мощность' }); fx.states[pid] = { state: '12.0', attributes: { device_class: 'power', unit_of_measurement: 'W', state_class: 'measurement', friendly_name: `${name} · розетка Мощность` }, last_changed: '', last_updated: '' }; }
  });
  return fx;
}
/** Rooms of apartment 8 hang on its channel, the rest on apartment 9's (the owner, 06.11.2026). */
export const roomFeeds = config => { for (const r of ['gostinaia', 'kukhnia', 'prikhozhaia', 'spalnia', 'sklad']) (config.rooms[r] ??= {}).feed = FEED_IDS.apt9; for (const r of APT8_ROOMS) (config.rooms[r] ??= {}).feed = FEED_IDS.apt8; return config; };
/** What the tile reads from the same made-up counters: each channel's «today» (the finished hours and the 5-minute tail, as the SPM's
 * `*_energy_today` would count it) and the month since the 1st, so the preview's tile and panel agree as the real ones do. */
export function feedFigures(st, now) {
  const today = dayStart(now), d = new Date(now), month = new Date(d.getFullYear(), d.getMonth(), 1).getTime(), out = { today: {}, month: 0 };
  for (const [k, f] of Object.entries(FEED_IDS)) {
    const id = `sensor.${f}_energy_total`, hours = (st.hour[id] ?? []).filter(([t]) => t >= today), upTo = hours.length ? hours.at(-1)[0] + H : today;
    const day = hours.reduce((a, [, v]) => a + v, 0) + (st.fiveE[id] ?? []).filter(([t]) => t >= upTo).reduce((a, [, v]) => a + v, 0);
    out.today[k] = day.toFixed(3); out.month += (st.day[id] ?? []).filter(([t]) => t >= month && t < today).reduce((a, [, v]) => a + v, 0) + day;
  }
  return out;
}
