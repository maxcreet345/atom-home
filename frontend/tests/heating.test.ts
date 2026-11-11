import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readHeating, heatTone, heatingRooms } from '../src/model/heating.ts';
import type { Registry } from '../src/model/registry.ts';
// the heating as HA showed it on 09.11.2026 (book/04-automations/HEATING.md)
const live = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-heating-20261109.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-09T08:00:00Z');
function house(over: Record<string, [string, Record<string, unknown>?]> = {}): Registry {
  const states: Registry['states'] = structuredClone(live.states);
  for (const [id, [state, attrs]] of Object.entries(over)) states[id] = { state, attributes: { ...(states[id]?.attributes ?? {}), ...(attrs ?? {}) }, last_changed: new Date(NOW - 5 * 60000).toISOString(), last_updated: '' };
  return { areas: [['gostinaia', 'Гостиная'], ['kukhnia', 'Кухня'], ['spalnia', 'Спальня'], ['detskaia', 'Детская'], ['kompiuternaia', 'Компьютерная']].map(([area_id, name]) => ({ area_id, name })), devices: live.devices, entities: live.entities, states };
}
test('five rooms in the house order, named by their area, with their windows', () => {
  const h = readHeating(house(), NOW)!;
  assert.deepEqual(h.rooms.map(r => r.name), ['Гостиная', 'Кухня', 'Спальня', 'Детская', 'Компьютерная']);
  assert.equal(h.rooms[0].windows.length, 3); assert.equal(h.rooms[1].windows.length, 2);
  assert.deepEqual(h.rooms[0].windows.map(w => w.name).sort(), ['Левое окно', 'Правое окно', 'Центральное окно']); // nominative, not «правого окна»
  assert.equal(h.rooms[3].windows[0].name, 'Окно');
});
test('no heating helper, no heating card', () => {
  const r = house(); delete r.states['input_select.heating_mode']; assert.equal(readHeating(r, NOW), null);
});
test('the head says heating or idle; an open window pauses its room; a lost head is offline', () => {
  const h = readHeating(house({ 'climate.kids_trv': ['heat', { hvac_action: 'idle' }], 'climate.kitchen_trv': ['off'], 'input_boolean.kitchen_heating_window': ['on'], 'binary_sensor.kitchen_window_center_contact': ['on'], 'climate.office_trv': ['unavailable'] }), NOW)!;
  const by = Object.fromEntries(h.rooms.map(r => [r.key, r]));
  assert.equal(by.kids.action, 'idle'); assert.equal(by.kitchen.action, 'window'); assert.equal(by.kitchen.target, null); assert.equal(by.office.action, 'offline');
  assert.ok(by.kitchen.windows.find(w => w.open)?.name === 'Центральное окно');
  assert.equal(heatTone(h), 'warn'); // a lost head is worth a look
});
test('a room\'s own temperature in «Авто» is read from its timer and ends at its time', () => {
  const until = new Date(NOW + 161 * 60000).toISOString();
  const h = readHeating(house({ 'timer.kids_heating_override': ['active', { finishes_at: until }], 'input_number.kids_heating_override_temp': ['24'] }), NOW)!;
  assert.deepEqual(h.rooms.find(r => r.key === 'kids')!.override, { temp: 24, until: Date.parse(until) });
  const later = readHeating(house({ 'timer.kids_heating_override': ['active', { finishes_at: until }] }), Date.parse(until) + 1000)!;
  assert.equal(later.rooms.find(r => r.key === 'kids')!.override, null);
});
test('system, mode, scenario and its temperature', () => {
  const h = readHeating(house({ 'input_select.heating_mode': ['Ручной'], 'sensor.heating_scenario': ['Сон'], 'sensor.heating_target_temp': ['19.5'] }), NOW)!;
  assert.equal(h.mode, 'manual'); assert.equal(h.scenario, 'sleep'); assert.equal(h.target, 19.5); assert.equal(h.system, true);
  const off = readHeating(house({ 'input_boolean.heating_system': ['off'] }), NOW)!; assert.equal(heatTone(off), 'off');
});
test('the boiler is offline while eBUS is silent, and its numbers are unknown, not zero', () => {
  const h = readHeating(house({ 'binary_sensor.kitchen_boiler_ebus_signal': ['off'] }), NOW)!;
  assert.equal(h.boiler.online, false); assert.equal(h.boiler.flow, null); assert.equal(h.boiler.pressure, null);
  const stale = readHeating(house({ 'binary_sensor.kitchen_boiler_ebus_signal': ['off'], 'sensor.kitchen_boiler_flow_temp': ['52.4'], 'sensor.kitchen_boiler_pressure': ['0.7'] }), NOW)!;
  assert.equal(stale.boiler.flow, null); assert.equal(stale.boiler.pressureLow, false); // the last numbers of a silent bus are old: no refill warning from them
  const on = readHeating(house({ 'binary_sensor.kitchen_boiler_ebus_signal': ['on'], 'sensor.kitchen_boiler_flow_temp': ['52.4'], 'sensor.kitchen_boiler_pressure': ['0.7'], 'binary_sensor.kitchen_boiler_pressure_low': ['on'] }), NOW)!;
  assert.equal(on.boiler.pressureLow, true);
  assert.equal(on.boiler.online, true); assert.equal(on.boiler.flow, 52.4); assert.equal(heatTone(on), 'warn');
});
test('heating rooms are counted from the heads', () => {
  const h = readHeating(house(), NOW)!; assert.equal(heatingRooms(h), h.rooms.filter(r => r.action === 'heating').length);
});
test('an unknown system or scenario is not taken for «off» or «Дома»', () => {
  const h = readHeating(house({ 'input_boolean.heating_system': ['unavailable'], 'sensor.heating_scenario': ['unknown'] }), NOW)!;
  assert.equal(h.systemKnown, false); assert.equal(h.scenarioKnown, false); assert.equal(heatTone(h), 'warn');
});
test('a thermostat that is not reachable is worth a look', () => {
  const h = readHeating(house({ 'climate.living_thermostat': ['unavailable'] }), NOW)!; assert.equal(h.thermostatOnline, false); assert.equal(heatTone(h), 'warn');
});
test('the room reads its own sensor: the heads are fed it minus «вверх», the card adds it back', () => {
  const h = readHeating(house({ 'input_number.heating_hyst_down': ['0.6'], 'input_number.heating_hyst_up': ['0.2'], 'climate.kids_trv': ['heat', { current_temperature: 21 }] }), NOW)!;
  assert.deepEqual(h.hyst, { down: 0.6, up: 0.2 }); assert.equal(h.rooms.find(r => r.key === 'kids')!.current, 21.2);
  const none = readHeating(house(), NOW)!; assert.equal(none.hyst, null);
});

// ----- audit 2026-11-09 -----
import { heatTrouble, problemRoom, houseSet, scenarioNow, roomLocked, pressureWord, outdoorText, hystMax, dayOf } from '../src/model/heating.ts';
import { heatingActions, vacationDisarms } from '../src/model/heating-act.ts';
import { stepCore, stepValue, type StepIO } from '../src/model/heating-step.ts';
/** a clock the test turns by hand */
function clock() { let now = 0, id = 0; const jobs = new Map<number, { at: number; f: () => void }>(); return { set: (f: () => void, ms: number) => { jobs.set(++id, { at: now + ms, f }); return id; }, clear: (i: unknown) => { jobs.delete(i as number); }, run(ms: number) { now += ms; for (const [i, j] of [...jobs]) if (j.at <= now) { jobs.delete(i); j.f(); } } }; }
const recorder = () => { const calls: Array<[string, string, Record<string, unknown>]> = []; return { calls, host: { call: async (d: string, s: string, data: Record<string, unknown>) => { calls.push([d, s, data]); } } }; };
const io = (send: (v: number) => Promise<unknown>): StepIO => ({ send, ok: () => {}, fail: () => {} });
test('− / +: leaving the screen within the pause sends the value to the helper of the mode at the tap, not of the first render', async () => {
  const c = clock(), r = recorder(), shown: Array<number | null> = [], core = stepCore(v => shown.push(v), 700, 20000, c);
  const auto = readHeating(house(), NOW)!, manual = readHeating(house({ 'input_select.heating_mode': ['Ручной'] }), NOW)!;
  assert.equal(auto.mode, 'auto'); assert.equal(manual.mode, 'manual');
  void heatingActions(auto, r.host); // the card was first drawn in «Авто»
  core.push(21, io(heatingActions(manual, r.host).house), 20.5); // the tap comes after the mode became «Ручной»
  c.run(150); core.flush(); await Promise.resolve();
  assert.equal(r.calls.length, 5); assert.ok(r.calls.every(([d, s, data]) => d === 'input_number' && s === 'set_value' && /_heating_manual_temp$/.test(String(data.entity_id)) && data.value === 21));
  assert.ok(!r.calls.some(([, , data]) => data.entity_id === 'input_number.heating_home_temp'));
});
test('− / +: a scenario that is not «Дома» gets its own change until the scenario ends, also on unmount', async () => {
  const c = clock(), r = recorder(), core = stepCore(() => {}, 700, 20000, c), sleep = readHeating(house({ 'sensor.heating_scenario': ['Сон'] }), NOW)!;
  core.push(19.5, io(heatingActions(sleep, r.host).house), 19); core.flush(); await Promise.resolve();
  assert.deepEqual(r.calls.map(x => x[2].entity_id), ['input_number.heating_scenario_override_temp', 'input_boolean.heating_scenario_override']);
});
test('− / +: five taps are one command with the last value; no intermediate value leaves', async () => {
  const c = clock(), sent: number[] = [], core = stepCore(() => {}, 700, 20000, c), one = io(async v => { sent.push(v); });
  for (const v of [21, 21.5, 22, 22.5, 23]) { core.push(v, one, 20.5); c.run(200); }
  assert.deepEqual(sent, []); c.run(700); assert.deepEqual(sent, [23]);
  core.flush(); assert.deepEqual(sent, [23]); // nothing waits: leaving sends nothing more
});
test('− / +: back to the house\'s own value sends nothing; but a value already on its way is corrected', async () => {
  const c = clock(), sent: number[] = [], shown: Array<number | null> = [], core = stepCore(v => shown.push(v), 700, 20000, c), one = io(async v => { sent.push(v); });
  core.push(21, one, 20.5); c.run(100); core.push(20.5, one, 20.5); c.run(2000);
  assert.deepEqual(sent, []); assert.equal(shown.at(-1), null); // the screen shows the house's value again, so someone else's change is seen at once
  core.push(21, one, 20.5); c.run(700); assert.deepEqual(sent, [21]);
  core.push(20.5, one, 20.5); c.run(700); assert.deepEqual(sent, [21, 20.5]); // 21 is on its way: 20,5 must follow it
  core.settled(); core.push(20.5, one, 20.5); c.run(700); assert.deepEqual(sent, [21, 20.5]);
});
test('− / +: a refusal puts the house\'s value back and reports the reason', async () => {
  const c = clock(), shown: Array<number | null> = [], failed: unknown[] = [], core = stepCore(v => shown.push(v), 700, 20000, c);
  core.push(21, { send: () => Promise.reject({ code: 'home_assistant_error', message: 'нет' }), ok: () => {}, fail: e => failed.push(e) }, 20.5); c.run(700); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(shown, [21, null]); assert.equal(failed.length, 1);
  assert.equal(stepValue(20.5, null, 1, 8, 24, 0.5), 21); assert.equal(stepValue(22, null, -1, 8, 24, 0.5, 19.5), 19); assert.equal(stepValue(24, null, 1, 8, 24, 0.5), 24);
});
test('«Отпуск»: the return date is written first; switching off disarms only when the guard stands in «Отпуск»', async () => {
  const sec = { 'alarm_control_panel.alarmo': ['disarmed', { supported_features: 43 }] as [string, Record<string, unknown>] };
  let r = recorder(), h = readHeating(house(sec), NOW)!;
  assert.equal(vacationDisarms(h), false);
  await heatingActions(h, r.host).vacation(true, '2026-11-23');
  assert.deepEqual(r.calls, [['input_datetime', 'set_datetime', { entity_id: 'input_datetime.heating_vacation_return', datetime: '2026-11-23 00:00:00' }], ['alarm_control_panel', 'alarm_arm_vacation', { entity_id: 'alarm_control_panel.alarmo' }]]);
  // CODEX-011 (was: «no date» sent only the arming, leaving an earlier plan's date in force): «no date» is written as the house's «no date» first
  r = recorder(); await heatingActions(h, r.host).vacation(true, null); assert.deepEqual(r.calls, [['input_datetime', 'set_datetime', { entity_id: 'input_datetime.heating_vacation_return', datetime: '2099-12-31 00:00:00' }], ['alarm_control_panel', 'alarm_arm_vacation', { entity_id: 'alarm_control_panel.alarmo' }]]);
  h = readHeating(house({ 'alarm_control_panel.alarmo': ['armed_vacation', { supported_features: 43 }] }), NOW)!; assert.equal(vacationDisarms(h), true);
  r = recorder(); await heatingActions(h, r.host).vacation(false); assert.deepEqual(r.calls.map(c => c[1]), ['alarm_disarm']);
  r = recorder(); await heatingActions(readHeating(house(), NOW)!, r.host).vacation(false); assert.deepEqual(r.calls, [['input_boolean', 'turn_off', { entity_id: 'input_boolean.heating_vacation' }]]);
});
test('a return date left from the last trip is not shown as a return date', () => {
  assert.equal(readHeating(house(), NOW)!.vacationReturn, null); // the helper holds 2026-11-03, today is 09.11
  assert.equal(readHeating(house({ 'input_datetime.heating_vacation_return': ['2026-11-23 00:00:00'] }), NOW)!.vacationReturn, '2026-11-23');
  assert.equal(readHeating(house({ 'input_datetime.heating_vacation_return': [`${dayOf(NOW)} 00:00:00`] }), NOW)!.vacationReturn, dayOf(NOW));
  assert.equal(readHeating(house({ 'input_datetime.heating_vacation_return': ['unknown'] }), NOW)!.vacationReturn, null);
});
test('a window sensor without a connection is not a closed window', () => {
  const h = readHeating(house({ 'binary_sensor.kitchen_window_center_contact': ['unavailable'] }), NOW)!, k = h.rooms.find(r => r.key === 'kitchen')!;
  assert.equal(k.windows.filter(w => !w.known).length, 1); assert.equal(k.windows.filter(w => w.open).length, 0);
  assert.equal(problemRoom(h)?.key, 'kitchen');
  assert.ok(readHeating(house(), NOW)!.rooms.every(r => r.windows.every(w => w.known)));
});
test('a silent eBUS and a relay that does not answer are troubles the tile shows; unknown is neither «не горит» nor «нет запроса»', () => {
  const on: Record<string, [string]> = { 'binary_sensor.kitchen_boiler_ebus_signal': ['on'], 'sensor.kitchen_boiler_flow_temp': ['52.4'], 'sensor.kitchen_boiler_flame': ['on'], 'switch.kitchen_boiler_heat_relay': ['on'], 'sensor.kitchen_boiler_pressure': ['1.32'] };
  const ok = readHeating(house(on), NOW)!; assert.deepEqual(heatTrouble(ok), []); assert.notEqual(heatTone(ok), 'warn');
  const bus = readHeating(house({ ...on, 'binary_sensor.kitchen_boiler_ebus_signal': ['off'] }), NOW)!;
  assert.deepEqual(heatTrouble(bus).map(x => x.kind), ['boiler']); assert.equal(heatTone(bus), 'warn'); assert.equal(bus.boiler.flame, null);
  const relay = readHeating(house({ ...on, 'switch.kitchen_boiler_heat_relay': ['unavailable'] }), NOW)!;
  assert.equal(relay.boiler.relay, null); assert.deepEqual(heatTrouble(relay).map(x => x.kind), ['relay']); assert.equal(heatTone(relay), 'warn');
  const flame = readHeating(house({ ...on, 'sensor.kitchen_boiler_flame': ['unknown'] }), NOW)!; assert.equal(flame.boiler.flame, null); assert.equal(flame.boiler.online, true);
  const head = readHeating(house({ ...on, 'climate.office_trv': ['unavailable'] }), NOW)!; assert.equal(problemRoom(head)?.key, 'office');
});
test('a head on its own sensor does not show its reading as the room\'s: no «вверх» is added and the room is marked', () => {
  const base = { 'input_number.heating_hyst_down': ['0.6'], 'input_number.heating_hyst_up': ['0.2'], 'climate.kids_trv': ['heat', { current_temperature: 23.4 }] } as Record<string, [string, Record<string, unknown>?]>;
  const room = readHeating(house(base), NOW)!.rooms.find(r => r.key === 'kids')!; assert.equal(room.sensor, 'room'); assert.equal(room.current, 23.6);
  for (const mode of ['local_temperature', 'remote_source_offline']) {
    const h = readHeating(house({ ...base, 'select.kids_trv_temperature_sensor_select': [mode] }), NOW)!, r = h.rooms.find(x => x.key === 'kids')!;
    assert.equal(r.sensor, 'head', mode); assert.equal(r.current, 23.4); assert.equal(problemRoom(h)?.key, 'kids');
  }
});
test('«Ручной» + «Отпуск»: the big number is the scenario\'s and is not stepped; «Сейчас» marks only what acts; an unknown scenario marks nothing', () => {
  const manual = { 'input_select.heating_mode': ['Ручной'] as [string] };
  const vac = readHeating(house({ ...manual, 'sensor.heating_scenario': ['Отпуск'], 'sensor.heating_target_temp': ['8'] }), NOW)!;
  assert.deepEqual(houseSet(vac), { shown: 8, value: null }); assert.equal(roomLocked(vac), true); assert.equal(scenarioNow(vac, 'vacation'), true);
  const sleep = readHeating(house({ ...manual, 'sensor.heating_scenario': ['Сон'] }), NOW)!;
  assert.equal(scenarioNow(sleep, 'sleep'), false); assert.equal(roomLocked(sleep), false); assert.equal(typeof houseSet(sleep).value, 'number');
  const auto = readHeating(house({ 'sensor.heating_scenario': ['Сон'] }), NOW)!; assert.equal(scenarioNow(auto, 'sleep'), true);
  const unknown = readHeating(house({ 'sensor.heating_scenario': ['unknown'] }), NOW)!; assert.equal(scenarioNow(unknown, 'home'), false); assert.equal(houseSet(unknown).value, null);
});
test('the boiler\'s pressure word, the outdoor line and the shared degree of the hysteresis', () => {
  const b = (pressure: number | null, low = false, high = false) => pressureWord({ pressure, pressureLow: low, pressureHigh: high } as never);
  assert.equal(b(null), null); assert.equal(b(1.32), 'norm'); assert.equal(b(1.59), 'outside'); assert.equal(b(0.9), 'outside'); assert.equal(b(0.7, true), 'low'); assert.equal(b(2.9, false, true), 'high');
  assert.deepEqual(outdoorText({ temp: -0.4, state: 'clear-night' }), { temp: 0, key: 'clock.weather.clear-night' }); assert.equal(Object.is(outdoorText({ temp: -0.4, state: null })!.temp, 0), true);
  assert.equal(outdoorText({ temp: -2.9, state: 'fog' })!.temp, -3); assert.equal(outdoorText({ temp: null, state: 'fog' }), null);
  assert.equal(hystMax(0.4), 0.6); assert.equal(hystMax(0.2), 0.8); assert.equal(hystMax(1), 0); // «вверх» shown 0,4 leaves «вниз» 0,6: together 1°
});
