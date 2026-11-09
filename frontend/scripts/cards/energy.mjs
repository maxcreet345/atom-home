// The Energy tile's states for the shared preview server and the audit on a real device.
import { addEnergy } from '../energy-fixture.mjs';
import { energyStats, feedFigures, addMeters, roomFeeds } from '../energy-report-fixture.mjs';
import { addAir, renameAreas } from '../air-fixture.mjs';
import { addFeeder, feederLog } from '../feeder-fixture.mjs';
export const card = {
  name: 'Энергия', sheet: '#energy', home: '#home', sheetRoot: '.hm-main', tileRoot: '.ah-value:has(.ah-value-head)', actionButton: null,
  scenarios: {
    now: { power: { apt8: '13.7', ev: '0.0', apt9: '276.6', ch4: '0.0' }, today: true, month: true },
    charging: { power: { apt8: '112.4', ev: '3497.6', apt9: '392.4', ch4: '0.0' }, today: true, month: true },
    evening: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true },
    // a channel silent now has no statistics of its own since it went quiet (the last 2 hours): the whole SPM, or apartment 9 next to working ones
    offline: { power: { apt8: 'unavailable', ev: 'unavailable', apt9: 'unavailable', ch4: 'unavailable' }, silentNow: [2] },
    oneSilent: { power: { apt8: '13.7', ev: '0.0', apt9: 'unavailable', ch4: '0.0' }, silentNow: [2, ['apt9']] },
    // apartment 9 silent since yesterday afternoon (30 hours): today has nothing of it, yesterday is whole; not «за прошлый период данных нет»
    longSilent: { power: { apt8: '13.7', ev: '0.0', apt9: 'unavailable', ch4: '0.0' }, silentNow: [30, ['apt9']] },
    // the panel's own states: statistics only since the SPM came (01.11.2026), rooms not assigned to apartments, HA not answering, no recorder
    fresh: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, from: '2026-11-01T00:00:00' },
    separate: { power: { apt8: '153.4', ev: '3497.6', apt9: '1126.0', ch4: '0.0' }, month: 131.0, billed: false },
    noRooms: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, rooms: false },
    // apartments split, but the children's room left without a feed: its devices go to «Не распределено»
    partRooms: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, rooms: 'part' },
    // the SPM silent all of yesterday: that day has no statistics, the days before it do
    gap: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, gap: true },
    // a Wi-Fi drop inside a day: yesterday apartment 9 silent 13:00–15:00, the whole SPM 14:00–15:00; the energy comes in at 15:00
    silentHours: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, silent: [[13, 15, ['apt9']], [14, 15]] },
    // HA's Energy settings not readable: the panel says the parent plugs are not known and tries again
    prefsFail: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, prefs: 'fail' },
    // an HA whose Energy dashboard was never set up: get_prefs answers not_found, which is «no parent plugs», not a failure
    noPrefs: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, prefs: 'none' },
    // the children's room saved on a feed that is no SPM channel any more (the ids changed once, eWeLink → Tasmota): «Не распределено»
    staleFeed: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, rooms: 'stale' },
    // the owner's tariff history (09.11.2026): 3 lei until the 1st of this month, 4 lei from it; a past month is billed at its own price
    tariff: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, today: true, month: true, tariff: 'change' },
    statsFail: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, stats: 'fail' },
    noStats: { power: { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }, stats: 'none' },
  },
  // the tile's «today» and month come from the same made-up counters as the panel's statistics: the preview does not contradict itself
  build: (base, scenario, now) => { const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), at = h => new Date(y.getFullYear(), y.getMonth(), y.getDate(), h).getTime();
    const stats = energyStats(now.getTime(), { from: scenario.from ? new Date(scenario.from).getTime() : undefined, gapDays: scenario.gap ? [now.getTime() - 86400000] : undefined, silent: [...(scenario.silent ?? []).map(([a, b, feeds]) => ({ from: at(a), to: at(b), feeds })), ...(scenario.silentNow ? [{ from: new Date(now.getTime() - scenario.silentNow[0] * 3600000).setMinutes(0, 0, 0), to: Infinity, feeds: scenario.silentNow[1] }] : [])] }), fig = feedFigures(stats, now.getTime());
    return { snapshot: addFeeder(addAir(addMeters(addEnergy(base, scenario.power, scenario.today ? { ...fig.today, ch4: '0.0' } : undefined)))), feederLog: feederLog(now), airTasks: [], energyMonth: scenario.month ? fig.month : null, energyPrefs: scenario.prefs ?? null, energyStats: scenario.stats === 'none' ? null : scenario.stats === 'fail' ? 'fail' : stats }; },
  config: (text, scenario = {}) => { const c = JSON.parse(renameAreas(text)); if (scenario.billed !== false) c.modules = { ...(c.modules ?? {}), energy: { options: { chargerOf: 'entrance_spm_apt8' } } }; /* the owner's house: the car is on apartment 8's bill */ if (scenario.tariff === 'change') { const n = new Date(); c.energy = { tariffs: [{ from: '2025-01-01', lei: 3 }, { from: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`, lei: 4 }] }; } if (scenario.rooms === false) return c; roomFeeds(c); if (scenario.rooms === 'part') delete c.rooms.detskaia.feed; if (scenario.rooms === 'stale') c.rooms.detskaia.feed = 'sonoff_spm_apt8_power_2'; return c; },
};
