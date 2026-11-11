// Round 2 of the audit (10.11.2026), heating («Климат») and vacuum («Уборка»): each check fails on the tree as it was before the fix it names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.TZ = 'America/New_York'; // a browser west of the house: «today» must still be the house's day
import { readHeating, scenarioNow, vacationArming, boilerMark, returnDate, dayOf, problemRoom } from '../src/model/heating.ts';
import { heatingActions, vacationDisarms } from '../src/model/heating-act.ts';
import { readVacuum, vacuumProbe, mapShown, readChoice } from '../src/model/vacuum.ts';
import { setHouseZone } from '../src/runtime/zone.ts';
import { translator } from '../src/i18n/index.ts';
import type { Registry } from '../src/model/registry.ts';

const live = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-heating-20261109.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-09T08:00:00Z');
function house(over: Record<string, [string, Record<string, unknown>?]> = {}): Registry {
  const states: Registry['states'] = structuredClone(live.states);
  for (const [id, [state, attrs]] of Object.entries(over)) states[id] = { state, attributes: { ...(states[id]?.attributes ?? {}), ...(attrs ?? {}) }, last_changed: new Date(NOW - 5 * 60000).toISOString(), last_updated: '' };
  return { areas: [['gostinaia', 'Гостиная'], ['kukhnia', 'Кухня'], ['spalnia', 'Спальня'], ['detskaia', 'Детская'], ['kompiuternaia', 'Компьютерная']].map(([area_id, name]) => ({ area_id, name })), devices: live.devices, entities: live.entities, states };
}
const recorder = () => { const log: Array<{ d: string; s: string; data: Record<string, unknown> }> = []; return { log, call: (d: string, s: string, data: Record<string, unknown>) => { log.push({ d, s, data }); return Promise.resolve(); } }; };
const ALARMO = 'alarm_control_panel.alarmo', VAC = { supported_features: 63 };

// ---- heating ----
test('f20 «Отпуск» during the exit delay: the card is «on its way», and switching it off disarms — never a second «Включить?»', async () => {
  const arming = readHeating(house({ [ALARMO]: ['arming', { ...VAC, arm_mode: 'armed_vacation' }], 'input_boolean.heating_vacation': ['off'] }), NOW)!;
  assert.equal(arming.vacation, false, 'the heating\'s own switch follows only when the guard stands');
  assert.equal(vacationArming(arming), true); assert.equal(vacationDisarms(arming), true, 'the «Выключить» question says the house goes off guard');
  const r = recorder(); await heatingActions(arming, r).vacation(false);
  assert.deepEqual(r.log.map(c => `${c.d}.${c.s}:${c.data.entity_id}`), [`alarm_control_panel.alarm_disarm:${ALARMO}`], 'cancelling from the heating card stops the arming');
  // not «on its way»: the delay runs towards another mode, the house has no security «Отпуск», the guard already stands, nothing is arming
  assert.equal(vacationArming(readHeating(house({ [ALARMO]: ['arming', { ...VAC, arm_mode: 'armed_away' }] }), NOW)!), false);
  assert.equal(vacationArming(readHeating(house({ [ALARMO]: ['arming', { supported_features: 31, arm_mode: 'armed_vacation' }] }), NOW)!), false);
  assert.equal(vacationArming(readHeating(house({ [ALARMO]: ['armed_vacation', { ...VAC, arm_mode: 'armed_vacation' }], 'input_boolean.heating_vacation': ['on'] }), NOW)!), false);
  assert.equal(vacationArming(readHeating(house({ [ALARMO]: ['disarmed', VAC] }), NOW)!), false);
  assert.equal(vacationArming(readHeating(house(), NOW)!), false);
});
test('l47 «today» of the return date is the house\'s day, not the browser\'s', () => {
  const lateEvening = Date.parse('2026-11-10T22:30:00Z'); // 00:30 on the 11th in Criuleni, 17:30 on the 10th in New York (this process)
  setHouseZone('Europe/Chisinau');
  try {
    assert.equal(dayOf(lateEvening), '2026-11-11');
    assert.equal(readHeating(house({ 'input_datetime.heating_vacation_return': ['2026-11-10 00:00:00'] }), lateEvening)!.vacationReturn, null, 'the 10th has passed in the house');
    assert.equal(readHeating(house({ 'input_datetime.heating_vacation_return': ['2026-11-11 00:00:00'] }), lateEvening)!.vacationReturn, '2026-11-11');
    assert.deepEqual(returnDate('2026-11-10', lateEvening), { date: null, past: true });
  } finally { setHouseZone(undefined); }
  assert.equal(dayOf(lateEvening), '2026-11-10', 'without the house\'s zone it is the browser\'s day, as before');
});
test('l147 a return date in the past is told, not dropped in silence', () => {
  assert.deepEqual(returnDate('', NOW), { date: null, past: false }, 'an empty field is «no date»');
  assert.deepEqual(returnDate(dayOf(NOW), NOW), { date: dayOf(NOW), past: false }, 'today counts');
  assert.deepEqual(returnDate('2031-01-15', NOW), { date: '2031-01-15', past: false });
  assert.deepEqual(returnDate('2026-11-01', NOW), { date: null, past: true }, 'typed by keyboard past the field\'s min');
  assert.deepEqual(returnDate('0202-11-01', NOW), { date: null, past: true }, 'a year still being typed');
  assert.deepEqual(returnDate('15.01.2031', NOW), { date: null, past: true }, 'not a day at all');
});
test('l120 heating switched off: no scenario carries «Сейчас»; a silent bus is a warning, not a flame', () => {
  const on = readHeating(house(), NOW)!; assert.equal(scenarioNow(on, on.scenario), true);
  const off = readHeating(house({ 'input_boolean.heating_system': ['off'] }), NOW)!; assert.equal(off.system, false);
  for (const id of ['home', 'sleep', 'away', 'eco', 'vacation']) assert.equal(scenarioNow(off, id), false, id);
  const ask: Record<string, [string]> = { 'binary_sensor.kitchen_boiler_ebus_signal': ['on'], 'sensor.kitchen_boiler_flow_temp': ['52.4'], 'switch.kitchen_boiler_heat_relay': ['on'] };
  assert.equal(boilerMark(readHeating(house(ask), NOW)!.boiler), 'hot');
  assert.equal(boilerMark(readHeating(house({ ...ask, 'binary_sensor.kitchen_boiler_ebus_signal': ['off'] }), NOW)!.boiler), 'warn', 'the relay asks, the bus is silent: one mark, the warning');
  assert.equal(boilerMark(readHeating(house({ ...ask, 'switch.kitchen_boiler_heat_relay': ['unavailable'] }), NOW)!.boiler), 'warn');
  assert.equal(boilerMark(readHeating(house({ ...ask, 'switch.kitchen_boiler_heat_relay': ['off'] }), NOW)!.boiler), '');
  for (const lang of ['ru', 'en', 'ro'] as const) { const t = translator(lang); for (const k of ['module.heat.b.askRelay', 'module.heat.b.noAskRelay', 'module.heat.turningOn', 'module.heat.hystNow', 'module.heat.vacBackPast', 'module.heat.lastKnown', 'module.heat.sensorLostLine'] as const) assert.notEqual(t(k), k, `${lang} ${k}`); }
});
test('l24 the room\'s own sensor does not answer while the head is still set to it: the reading is «the last one», and the room is the one to look at', () => {
  const base: Record<string, [string, Record<string, unknown>?]> = { 'climate.kids_trv': ['heat', { current_temperature: 20.9, temperature: 21, hvac_action: 'idle' }], 'select.kids_trv_temperature_sensor_select': ['remote_temperature'], 'input_number.heating_hyst_up': ['0.2'] };
  const fine = readHeating(house({ ...base, 'sensor.kids_co2_temperature': ['21.1'] }), NOW)!.rooms.find(r => r.key === 'kids')!; assert.equal(fine.sensor, 'room'); assert.equal(fine.current, 21.1);
  for (const gone of ['unavailable', 'unknown']) {
    const h = readHeating(house({ ...base, 'sensor.kids_co2_temperature': [gone] }), NOW)!, r = h.rooms.find(x => x.key === 'kids')!;
    assert.equal(r.sensor, 'lost', gone); assert.equal(r.current, 21.1, 'the last value the head was given, with «вверх» added back'); assert.equal(problemRoom(h)?.key, 'kids');
  }
  const kitchen = readHeating(house({ 'select.kitchen_trv_temperature_sensor_select': ['remote_temperature'], 'sensor.kitchen_climate_temperature': ['unavailable'] }), NOW)!.rooms.find(r => r.key === 'kitchen')!; assert.equal(kitchen.sensor, 'lost');
  // a head on its own sensor stays «у радиатора» whatever the room's sensor says; a house without such a sensor entity is not marked
  assert.equal(readHeating(house({ ...base, 'select.kids_trv_temperature_sensor_select': ['local_temperature'], 'sensor.kids_co2_temperature': ['unavailable'] }), NOW)!.rooms.find(r => r.key === 'kids')!.sensor, 'head');
  const none = house(base); delete none.states['sensor.kids_co2_temperature']; delete none.states['sensor.kids_climate_temperature']; assert.equal(readHeating(none, NOW)!.rooms.find(r => r.key === 'kids')!.sensor, 'room');
});

// ---- vacuum ----
const fxPath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-vacuum-20261109.json'), fx = existsSync(fxPath) ? JSON.parse(readFileSync(fxPath, 'utf8')) : null;
test('f74 readVacuum: what belongs to the robot is found once per registry lists; a new state re-reads values only', { skip: !fx }, () => {
  const reg = (states: Registry['states'], copy = false): Registry => ({ areas: [], devices: copy ? [...fx.devices] : fx.devices, entities: copy ? [...fx.entities] : fx.entities, states });
  const s1 = structuredClone(fx.states), s2 = structuredClone(fx.states); s2['vacuum.living_robot_vacuum'] = { ...s2['vacuum.living_robot_vacuum'], state: 'docked' }; for (const [id, state] of [['binary_sensor.living_robot_vacuum_cleaning', 'off'], ['sensor.living_robot_vacuum_status', 'charging']]) s2[id] = { ...s2[id], state }; s2['sensor.living_robot_vacuum_battery'] = { ...s2['sensor.living_robot_vacuum_battery'], state: '55' };
  const before = vacuumProbe.structure, a = readVacuum(reg(s1))!, afterFirst = vacuumProbe.structure, b = readVacuum(reg(s2))!;
  assert.ok(afterFirst - before <= 1); assert.equal(vacuumProbe.structure, afterFirst, 'the second call, same entities and devices, another states object: no structural pass');
  assert.notEqual(a.phase, b.phase, 'the new state is read'); assert.equal(b.battery, 55);
  assert.ok(a.dock.present && a.consumables.length >= 4 && a.cleaningMode && a.rooms !== undefined, 'the robot, its dock and their parts are found');
  // the remembered structure gives the same result, field for field, as a fresh pass over copies of the lists
  const n = vacuumProbe.structure; assert.deepEqual(readVacuum(reg(s1, true)), a); assert.deepEqual(readVacuum(reg(s2, true)), b); assert.equal(vacuumProbe.structure, n + 2, 'new lists are a new structure');
  // a robot that appears in the states later is found without new lists
  const noRobot = structuredClone(fx.states); delete noRobot['vacuum.living_robot_vacuum']; const r = reg(noRobot); assert.equal(readVacuum(r), null); assert.equal(readVacuum({ ...r, states: s1 })!.entity, 'vacuum.living_robot_vacuum');
  const src = readFileSync(resolve(import.meta.dirname, '../src/model/vacuum.ts'), 'utf8'); assert.ok(!/reg\.devices\.filter\([^\n]*reg\.entities\.some\(/.test(src), 'no «every device × every entity» pass');
});
test('l57 the map: the last crop stays until the new drawing is cropped', () => {
  assert.equal(mapShown(null, { src: 'data:old' }), null, 'no map, no picture');
  assert.equal(mapShown('/map?state=1', null), '/map?state=1', 'the plain picture only until the first crop');
  assert.equal(mapShown('/map?state=2', { src: 'data:crop-of-1' }), 'data:crop-of-1', 'HA redrew the map: the old crop, never the uncropped new picture');
  const ui = readFileSync(resolve(import.meta.dirname, '../src/ui/vacuum.tsx'), 'utf8'), hook = ui.slice(ui.indexOf('function useTrimmedMap'), ui.indexOf('/* ---------- the panel'));
  assert.ok(!/setOut\(null\); if \(!url\)/.test(hook) && /return mapShown\(url, out\)/.test(hook), 'the crop is not thrown away before the next one');
});
test('l92 the rooms chosen for cleaning are read back after a reload, and only rooms the robot still has', () => {
  const known = ['kukhnia', 'gostinaia', 'spalnia'];
  assert.deepEqual(readChoice(JSON.stringify({ rooms: ['kukhnia', 'gostinaia'], repeat: 2 }), known), { rooms: ['kukhnia', 'gostinaia'], repeat: 2 }, 'in the order chosen');
  assert.deepEqual(readChoice(JSON.stringify({ rooms: ['kukhnia', 'gone', 'kukhnia', 7], repeat: 9 }), known), { rooms: ['kukhnia'], repeat: 1 });
  for (const bad of [null, '', '{', '[]', '"x"', 'null']) assert.deepEqual(readChoice(bad, known), { rooms: [], repeat: 1 }, String(bad));
});
test('f54 the suction row has five segments: its words are short enough not to break in the middle (en, ro)', () => {
  for (const lang of ['en', 'ro'] as const) { const t = translator(lang); for (const k of ['quiet', 'balanced', 'turbo', 'max', 'max_plus']) { const w = t(`module.vac.fan.${k}` as Parameters<typeof t>[0]); assert.ok(w.length <= 6 && !/\s/.test(w), `${lang} ${k}: «${w}»`); } }
  assert.equal(translator('en')('module.vac.fan.balanced'), 'Normal'); assert.equal(translator('ro')('module.vac.fan.quiet'), 'Încet'); assert.equal(translator('ro')('module.vac.fan.balanced'), 'Mediu');
  assert.equal(translator('ru')('module.vac.fan.balanced'), 'Баланс', 'the Roborock app\'s own word stays');
});
