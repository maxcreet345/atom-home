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
