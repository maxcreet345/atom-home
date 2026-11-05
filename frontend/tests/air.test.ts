import test from 'node:test';
import assert from 'node:assert/strict';
import { airActions, airRooms, airTarget, airSummary, inRoomRu, toneOf } from '../src/model/air.ts';
import type { Registry } from '../src/model/registry.ts';
const row = (entity_id: string, device_id: string | null, device_class: string | null) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class, unit: null, has_entity_name: false });
function reg(sensors: Array<[string, string, string | null, string]>, extra: Record<string, string> = {}): Registry {
  const devs = [...new Set(sensors.map(s => s[1]))]; const states: Registry['states'] = {};
  for (const [id, , dc, st] of sensors) states[id] = { state: st, attributes: dc ? { device_class: dc } : {}, last_changed: '', last_updated: '' } as never;
  for (const [id, st] of Object.entries(extra)) states[id] = { state: st, attributes: {}, last_changed: '', last_updated: '' } as never;
  return { areas: [], devices: devs.map(d => ({ id: d, name: d, model: null, manufacturer: null, area_id: d.split(':')[0], entry_type: null })), entities: sensors.map(([id, dev, dc]) => row(id, dev, dc)), states } as never;
}
const ROOMS = [['gostinaia', 'Гостиная'], ['detskaia', 'Детская'], ['spalnia', 'Спальня'], ['kompiuternaia', 'Компьютерная'], ['kukhnia', 'Кухня'], ['vannaia', 'Ванная'], ['sklad', 'Склад']].map(([id, name]) => ({ id, name }));
const house = (): Array<[string, string, string | null, string]> => [
  ['sensor.living_co2', 'gostinaia:co2', 'carbon_dioxide', '847'], ['sensor.living_co2_temperature', 'gostinaia:co2', 'temperature', '20'], ['sensor.living_co2_humidity', 'gostinaia:co2', 'humidity', '60'],
  ['sensor.living_air_purifier_temperature', 'gostinaia:purifier', 'temperature', '21'], ['sensor.living_air_purifier_humidity', 'gostinaia:purifier', 'humidity', '58'], ['sensor.living_air_purifier_pm25', 'gostinaia:purifier', 'pm25', '2'], ['fan.living_air_purifier', 'gostinaia:purifier', null, 'on'],
  ['sensor.living_humidifier_temperature', 'gostinaia:hum', 'temperature', '25'], ['sensor.living_humidifier_humidity', 'gostinaia:hum', 'humidity', '48'], ['humidifier.living_humidifier', 'gostinaia:hum', null, 'off'],
  ['sensor.kids_co2', 'detskaia:co2', 'carbon_dioxide', '1012'], ['sensor.kids_co2_temperature', 'detskaia:co2', 'temperature', '22'], ['sensor.kids_co2_humidity', 'detskaia:co2', 'humidity', '50'],
  ['sensor.bedroom_climate_temperature', 'spalnia:c', 'temperature', '21'], ['sensor.bedroom_climate_humidity', 'spalnia:c', 'humidity', '55'],
  ['sensor.office_climate_temperature', 'kompiuternaia:c', 'temperature', '21'], ['sensor.office_climate_humidity', 'kompiuternaia:c', 'humidity', '56'], ['fan.office_fan', 'kompiuternaia:f', null, 'off'],
  ['sensor.kitchen_climate_temperature', 'kukhnia:c', 'temperature', '20'], ['sensor.kitchen_climate_humidity', 'kukhnia:c', 'humidity', '60'], ['sensor.kitchen_kettle_temperature', 'kukhnia:kettle', 'temperature', '95'], ['sensor.kitchen_boiler_flow_temp', 'kukhnia:boiler', 'temperature', '60'],
  ['sensor.bath_climate_temperature', 'vannaia:c', 'temperature', '20'], ['sensor.bath_climate_humidity', 'vannaia:c', 'humidity', '65'],
  ['sensor.storage_climate_temperature', 'sklad:c', 'temperature', '5'], ['sensor.storage_climate_humidity', 'sklad:c', 'humidity', '95'], ['sensor.storage_pm25', 'sklad:p', 'pm25', '900'],
];
const pick = (s: Array<[string, string, string | null, string]>, id: string, state: string) => s.map(x => x[0] === id ? [x[0], x[1], x[2], state] as [string, string, string | null, string] : x);
test('the room speaks through its CO₂ device; a purifier is the spare; a humidifier and appliances never', () => {
  const rooms = airRooms(reg(house()), ROOMS); const living = rooms.find(r => r.id === 'gostinaia')!, kitchen = rooms.find(r => r.id === 'kukhnia')!;
  assert.equal(living.temperature!.entity, 'sensor.living_co2_temperature'); assert.equal(kitchen.temperature!.entity, 'sensor.kitchen_climate_temperature');
  const off = airRooms(reg(pick(house(), 'sensor.living_co2_temperature', 'unavailable')), ROOMS).find(r => r.id === 'gostinaia')!; assert.equal(off.temperature!.entity, 'sensor.living_air_purifier_temperature');
});
test('averages over six rooms, worst CO₂ and PM with their rooms, the storeroom out of everything', () => {
  const s = airSummary(reg(house()), ROOMS); assert.equal(s.temperature.total, 6); assert.equal(s.temperature.value, (20 + 22 + 21 + 21 + 20 + 20) / 6); assert.equal(s.humidity.value, (60 + 50 + 55 + 56 + 60 + 65) / 6);
  assert.deepEqual([s.co2.value, s.co2.room], [1012, 'Детская']); assert.deepEqual([s.pm25.value, s.pm25.room], [2, 'Гостиная']); assert.equal(s.problem, null); assert.equal(s.tone, 'ok');
  assert.ok(s.rooms.some(r => r.id === 'sklad' && r.excluded));
});
test('a dead sensor drops out and the span says so; no old value survives', () => {
  const s = airSummary(reg(pick(pick(house(), 'sensor.kids_co2', 'unavailable'), 'sensor.bedroom_climate_temperature', 'unknown')), ROOMS);
  assert.deepEqual([s.co2.used, s.co2.total, s.co2.value, s.co2.room], [1, 2, 847, 'Гостиная']); assert.deepEqual([s.temperature.used, s.temperature.total], [5, 6]);
  assert.equal(airRooms(reg(pick(house(), 'sensor.kids_co2', 'garbage')), ROOMS).find(r => r.id === 'detskaia')!.co2!.value, null);
});
test('a new CO₂ sensor joins by itself', () => { const s = airSummary(reg([...house(), ['sensor.bed_co2', 'spalnia:new', 'carbon_dioxide', '1500']]), ROOMS); assert.deepEqual([s.co2.total, s.co2.value, s.co2.room], [3, 1500, 'Спальня']); assert.equal(s.problem!.metric, 'co2'); });
test('priority: CO₂, PM, humidity, temperature; the storeroom never raises a problem', () => {
  let s = airSummary(reg(pick(pick(house(), 'sensor.kids_co2', '1300'), 'sensor.bath_climate_humidity', '90')), ROOMS); assert.equal(s.problem!.metric, 'co2'); assert.equal(s.problem!.room.id, 'detskaia'); assert.equal(s.tone, 'warn');
  s = airSummary(reg(pick(house(), 'sensor.bath_climate_humidity', '90')), ROOMS); assert.deepEqual([s.problem!.metric, s.problem!.room.id, s.problem!.tone, s.problem!.high], ['humidity', 'vannaia', 'bad', true]);
});
test('humidity scales: room, kitchen, bathroom', () => { assert.equal(toneOf('humidity', 65), 'ok'); assert.equal(toneOf('humidity', 66), 'warn'); assert.equal(toneOf('humidity', 70), 'warn'); assert.equal(toneOf('humidity', 71), 'bad'); assert.equal(toneOf('humidity', 25), 'bad'); assert.equal(toneOf('humidity', 35), 'warn'); assert.equal(toneOf('humidity', 70, 'kitchen'), 'ok'); assert.equal(toneOf('humidity', 75, 'kitchen'), 'warn'); assert.equal(toneOf('humidity', 81, 'kitchen'), 'bad'); assert.equal(toneOf('humidity', 75, 'bath'), 'ok'); assert.equal(toneOf('humidity', 80, 'bath'), 'warn'); assert.equal(toneOf('humidity', 86, 'bath'), 'bad'); assert.equal(toneOf('humidity', 20, 'bath'), 'ok'); assert.equal(toneOf('temperature', 18.5), 'warn'); assert.equal(toneOf('co2', 1200), 'warn'); assert.equal(toneOf('pm25', 15), 'ok'); });
test('a vent found by itself, a purifier told apart', () => { const r = airRooms(reg(house(), {}), ROOMS); assert.deepEqual(r.find(x => x.id === 'kompiuternaia')!.vents, ['fan.office_fan']); const l = r.find(x => x.id === 'gostinaia')!; assert.equal(l.purifier, 'fan.living_air_purifier'); assert.deepEqual(l.vents, []); assert.equal(l.humidifier, 'humidifier.living_humidifier'); });
test('Russian room forms', () => { assert.equal(inRoomRu('Детская'), 'в Детской'); assert.equal(inRoomRu('Кухня'), 'на Кухне'); assert.equal(inRoomRu('Спальня'), 'в Спальне'); assert.equal(inRoomRu('Гостиная'), 'в Гостиной'); assert.equal(inRoomRu('Ванная'), 'в Ванной'); });

const roomOf = (r: Registry, id: string) => airRooms(r, ROOMS).find(x => x.id === id)!;
const NOVEMBER = new Date(2026, 10, 5), kinds = (r: Registry, id: string) => airActions(roomOf(r, id), r, NOVEMBER).map(a => a.kind);
const withVent = (room: string, id: string, ...over: Array<[string, string]>) => { let s = house(); for (const [e, v] of over) s = pick(s, e, v); return reg([...s, [id, `${room}:v`, null, 'off']]); };
test('a button only with the problem and only with a vent', () => {
  assert.deepEqual(kinds(withVent('vannaia', 'fan.bath_vent'), 'vannaia'), [], 'normal: no button');
  const wet = withVent('vannaia', 'fan.bath_vent', ['sensor.bath_climate_humidity', '78']), a = airActions(roomOf(wet, 'vannaia'), wet, NOVEMBER); assert.deepEqual([a[0].kind, a[0].device, a[0].target, a[0].blocked], ['dehumidify', 'fan.bath_vent', 60, null]);
  const noVent = reg(pick(house(), 'sensor.bath_climate_humidity', '78')); assert.deepEqual(kinds(noVent, 'vannaia'), []);
});
test('the owner\'s table: where something can be done', () => {
  const wetAll = (room: string, id: string, hum: string, pm?: string) => { const s = pick(house(), hum, '80'); return reg([...s, [id, `${room}:v`, null, 'off'], ...(pm ? [[pm, `${room}:p`, 'pm25', '40'] as [string, string, string | null, string]] : [])]); };
  assert.deepEqual(kinds(wetAll('kukhnia', 'fan.kitchen_vent', 'sensor.kitchen_climate_humidity', 'sensor.kitchen_pm25'), 'kukhnia'), ['dehumidify', 'purify'], 'kitchen: both');
  assert.deepEqual(kinds(wetAll('sklad', 'fan.storage_vent', 'sensor.storage_climate_humidity'), 'sklad'), ['dehumidify', 'purify'], 'storeroom: humidity and PM');
  assert.deepEqual(kinds(wetAll('vannaia', 'fan.bath_vent', 'sensor.bath_climate_humidity', 'sensor.bath_pm25'), 'vannaia'), ['dehumidify'], 'bathroom: humidity only');
  for (const [room, id, hum] of [['spalnia', 'fan.bed_vent', 'sensor.bedroom_climate_humidity'], ['detskaia', 'fan.kids_vent', 'sensor.kids_co2_humidity'], ['gostinaia', 'fan.living_vent', 'sensor.living_co2_humidity']] as const) assert.deepEqual(kinds(wetAll(room, id, hum), room), [], `${room}: nothing even with a vent`);
  const dusty = reg(pick(house(), 'sensor.living_air_purifier_pm25', '41')); assert.deepEqual(kinds(dusty, 'gostinaia'), [], 'the living room purifier gets no button');
  const stuffy = withVent('kukhnia', 'fan.kitchen_vent', ['sensor.kids_co2', '2500']); assert.deepEqual(kinds(stuffy, 'detskaia'), []);
});
test('a vent offline: the button says so', () => { const r = reg(pick([...house(), ['fan.bath_vent', 'vannaia:v', null, 'unavailable']], 'sensor.bath_climate_humidity', '80')); assert.equal(airActions(roomOf(r, 'vannaia'), r)[0].blocked, 'offline'); });

test('a switch is a vent only by the whole word', () => { const r = reg([...house(), ['switch.kitchen_cat_feeder_prevent_accumulation', 'kukhnia:feeder', null, 'off'], ['switch.bath_dryer_wrinkle_prevent', 'vannaia:dryer', null, 'off'], ['switch.bath_vent', 'vannaia:relay', null, 'off'], ['switch.adventure', 'vannaia:x', null, 'off']]); assert.deepEqual(roomOf(r, 'kukhnia').vents, []); assert.deepEqual(roomOf(r, 'vannaia').vents, ['switch.bath_vent']); });
test('the look follows the sentence', () => { const s = airSummary(reg(pick(pick(house(), 'sensor.kitchen_climate_humidity', '75'), 'sensor.bedroom_climate_temperature', '27')), ROOMS); assert.equal(s.problem!.metric, 'humidity'); assert.equal(s.tone, 'warn'); });

test('the vent stops at 60 % in the heating season and 65 % in summer', () => { assert.equal(airTarget('dehumidify', new Date(2026, 10, 5)), 60); assert.equal(airTarget('dehumidify', new Date(2026, 3, 30)), 60); assert.equal(airTarget('dehumidify', new Date(2026, 4, 1)), 65); assert.equal(airTarget('dehumidify', new Date(2026, 8, 30)), 65); assert.equal(airTarget('purify', new Date(2026, 6, 1)), 15); });

test('a button shows the summer target in summer', () => { const wet = withVent('vannaia', 'fan.bath_vent', ['sensor.bath_climate_humidity', '78']); assert.equal(airActions(roomOf(wet, 'vannaia'), wet, new Date(2026, 6, 1))[0].target, 65); });
test('a vent\'s own settings and a purifier by another name are not vents', () => { const r = reg([...house(), ['switch.bath_vent_child_lock', 'vannaia:v', null, 'off'], ['switch.kitchen_hood_light', 'kukhnia:h', null, 'off'], ['fan.zhimi_airp_mb5', 'detskaia:p', null, 'on'], ['fan.kitchen_oven_fan', 'kukhnia:o', null, 'off']]); assert.deepEqual(roomOf(r, 'vannaia').vents, []); assert.deepEqual(roomOf(r, 'kukhnia').vents, []); assert.deepEqual(roomOf(r, 'detskaia').vents, []); assert.equal(roomOf(r, 'detskaia').purifier, 'fan.zhimi_airp_mb5'); });
test('a CO₂ sensor in the hall does not move the mean of the six rooms', () => { const before = airSummary(reg(house()), ROOMS).temperature; const rooms = [...ROOMS, { id: 'prikhozhaia', name: 'Прихожая' }], after = airSummary(reg([...house(), ['sensor.hall_co2', 'prikhozhaia:c', 'carbon_dioxide', '800'], ['sensor.hall_temperature', 'prikhozhaia:c', 'temperature', '10']]), rooms); assert.equal(after.temperature.value, before.value); assert.equal(after.temperature.total, before.total); assert.ok(after.rooms.some(x => x.id === 'prikhozhaia'), 'it stays in the rooms'); assert.equal(after.co2.total, airSummary(reg(house()), ROOMS).co2.total + 1, 'and its CO₂ counts for the worst'); });
