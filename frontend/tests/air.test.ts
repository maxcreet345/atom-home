import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { airActions, airErrorKey, airRooms, airTarget, airSummary, declinable, deviceAway, inRoomRu, isHigh, shown, toneOf, withoutEndedAlarms, type AirTask } from '../src/model/air.ts';
import { num } from '../src/ui/format.ts';
import type { Registry } from '../src/model/registry.ts';
const row = (entity_id: string, device_id: string | null, device_class: string | null) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class, unit: null, has_entity_name: false });
type Links = Record<string, { temperature?: string | null; humidity?: string | null }>;
const LINKS: Links = { gostinaia: { temperature: 'sensor.living_co2_temperature', humidity: 'sensor.living_co2_humidity' }, detskaia: { temperature: 'sensor.kids_co2_temperature', humidity: 'sensor.kids_co2_humidity' }, spalnia: { temperature: 'sensor.bedroom_climate_temperature', humidity: 'sensor.bedroom_climate_humidity' }, kompiuternaia: { temperature: 'sensor.office_climate_temperature', humidity: 'sensor.office_climate_humidity' }, kukhnia: { temperature: 'sensor.kitchen_climate_temperature', humidity: 'sensor.kitchen_climate_humidity' }, vannaia: { temperature: 'sensor.bath_climate_temperature', humidity: 'sensor.bath_climate_humidity' }, sklad: { temperature: 'sensor.storage_climate_temperature', humidity: 'sensor.storage_climate_humidity' } };
function reg(sensors: Array<[string, string, string | null, string]>, extra: Record<string, string> = {}, links: Links = LINKS): Registry {
  const devs = [...new Set(sensors.map(s => s[1]))]; const states: Registry['states'] = {};
  for (const [id, , dc, st] of sensors) states[id] = { state: st, attributes: dc ? { device_class: dc } : {}, last_changed: '', last_updated: '' } as never;
  for (const [id, st] of Object.entries(extra)) states[id] = { state: st, attributes: {}, last_changed: '', last_updated: '' } as never;
  return { areas: Object.entries(links).map(([area_id, l]) => ({ area_id, name: area_id, temperature_entity_id: l.temperature ?? null, humidity_entity_id: l.humidity ?? null })), devices: devs.map(d => ({ id: d, name: d, model: null, manufacturer: null, area_id: d.split(':')[0], entry_type: null })), entities: sensors.map(([id, dev, dc]) => row(id, dev, dc)), states } as never;
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
test('CO₂ and PM2.5 are still searched: the room\'s CO₂ device first, a purifier as the spare, appliances never', () => {
  const room = (s: ReturnType<typeof house>) => airRooms(reg(s), ROOMS).find(r => r.id === 'gostinaia')!, both = (s: ReturnType<typeof house>): ReturnType<typeof house> => [...s, ['sensor.living_co2_pm25', 'gostinaia:co2', 'pm25', '4'], ['sensor.living_kettle_pm25', 'gostinaia:kettle', 'pm25', '500']];
  assert.equal(room(both(house())).pm25!.entity, 'sensor.living_co2_pm25'); assert.equal(room(pick(both(house()), 'sensor.living_co2_pm25', 'unavailable')).pm25!.entity, 'sensor.living_air_purifier_pm25');
});
test('a room\'s temperature and humidity are its area\'s links and nothing else (owner, 06.11.2026)', () => {
  const room = (r: Registry, id: string) => airRooms(r, ROOMS).find(x => x.id === id)!, withLink = (id: string, l: Links[string]) => ({ ...LINKS, [id]: l });
  assert.deepEqual([room(reg(house()), 'gostinaia').temperature!.entity, room(reg(house()), 'gostinaia').humidity!.entity], ['sensor.living_co2_temperature', 'sensor.living_co2_humidity']);
  let r = reg(pick(house(), 'sensor.living_co2_temperature', 'unavailable')); assert.deepEqual(room(r, 'gostinaia').temperature, { entity: 'sensor.living_co2_temperature', value: null, unit: null }, 'a silent link has no fallback, though a purifier in the room reads 21');
  r = reg(pick(house(), 'sensor.living_co2_temperature', 'unknown')); assert.equal(room(r, 'gostinaia').temperature!.value, null);
  r = reg(house().filter(x => x[0] !== 'sensor.living_co2_temperature')); assert.equal(room(r, 'gostinaia').temperature!.value, null, 'a link with no state is silent');
  r = reg(house(), {}, withLink('gostinaia', { temperature: null })); assert.equal(room(r, 'gostinaia').temperature, null, 'no link, no reading, though the room holds three sensors with the class'); assert.equal(room(r, 'gostinaia').humidity, null);
  r = reg(house(), {}, withLink('spalnia', { temperature: 'sensor.kids_co2_temperature', humidity: 'sensor.kitchen_kettle_temperature' })); assert.deepEqual([room(r, 'spalnia').temperature!.value, room(r, 'spalnia').humidity!.value], [22, 95], 'a link to another area, or to what the search would throw out, is used');
  r = reg([...house(), ['sensor.anything', 'detskaia:x', null, '23.5']], {}, withLink('spalnia', { temperature: 'sensor.anything' })); assert.equal(room(r, 'spalnia').temperature!.value, 23.5, 'whatever its class');
  assert.equal(room(reg(house(), {}, { ...LINKS, sklad: { temperature: 'sensor.storage_climate_temperature' } }), 'sklad').temperature!.value, 5, 'the storeroom reads its link too');
  const first = reg(house(), {}, withLink('spalnia', {})), later = { ...first, areas: reg(house()).areas }; assert.equal(airSummary(first, ROOMS).temperature.total, 5); assert.equal(airSummary(later, ROOMS).temperature.total, 6, 'a link added later is picked up, not served from the last answer');
});
test('the mean is of linked sensors: a silent link is missing, an unlinked room is not counted, none linked is no cell', () => {
  const no = (id: string) => ({ ...LINKS, [id]: {} });
  let s = airSummary(reg(pick(house(), 'sensor.bedroom_climate_temperature', 'unavailable')), ROOMS); assert.deepEqual([s.temperature.used, s.temperature.total], [5, 6], 'silent: «5 из 6»'); assert.equal(s.temperature.value, (20 + 22 + 21 + 20 + 20) / 5);
  s = airSummary(reg(house(), {}, no('spalnia')), ROOMS); assert.deepEqual([s.temperature.used, s.temperature.total], [5, 5], 'no link: not counted at all'); assert.deepEqual([s.humidity.used, s.humidity.total], [5, 5]); assert.equal(s.temperature.value, (20 + 22 + 21 + 20 + 20) / 5);
  const onlyStore = { sklad: LINKS.sklad }; s = airSummary(reg(house(), {}, onlyStore), ROOMS); assert.deepEqual([s.temperature.total, s.humidity.total, s.temperature.value], [0, 0, null], 'none among the six: the storeroom does not stand in'); assert.deepEqual(s.noData, [], 'and no link is not silence'); assert.equal(s.tone, 'ok');
  assert.equal(s.rooms.find(r => r.id === 'sklad')!.temperature!.value, 5); assert.equal(s.rooms.find(r => r.id === 'spalnia')!.temperature, null, 'a room of the six stays in the list with nothing to show');
  s = airSummary(reg(house().map(x => x[1].startsWith('sklad') ? x : x[0].endsWith('_temperature') ? [x[0], x[1], x[2], 'unavailable'] as (typeof x) : x)), ROOMS); assert.deepEqual(s.noData, ['temperature']); assert.equal(s.temperature.total, 6);
  s = airSummary(reg(house().filter(x => !['carbon_dioxide', 'pm25'].includes(x[2] ?? '') || x[1].startsWith('sklad')), {}, {}), ROOMS); assert.deepEqual([s.co2.total, s.pm25.total, s.temperature.total], [0, 0, 0]); assert.equal(s.tone, 'none', 'nothing to read at all is not good air');
});
test('no link, or a silent one: no problem and no button, whatever another sensor in the room says', () => {
  const wet: ReturnType<typeof house> = [...pick(house(), 'sensor.bath_climate_humidity', '60'), ['fan.bath_vent', 'vannaia:v', null, 'off'], ['sensor.bath_other_humidity', 'vannaia:o', 'humidity', '90']];
  let r = reg(wet); assert.equal(airSummary(r, ROOMS).problem, null, 'a sensor nobody linked raises nothing'); assert.deepEqual(kinds(r, 'vannaia'), []);
  const moved = { ...LINKS, vannaia: { humidity: 'sensor.bath_other_humidity' } }; r = reg(wet, {}, moved); assert.deepEqual([airSummary(r, ROOMS).problem!.room.id, kinds(r, 'vannaia')[0], airActions(roomOf(r, 'vannaia'), r, NOVEMBER)[0].sensor], ['vannaia', 'dehumidify', 'sensor.bath_other_humidity'], 'linked, it speaks, and the job watches it');
  r = reg(pick(wet, 'sensor.bath_other_humidity', 'unavailable'), {}, moved); assert.equal(airSummary(r, ROOMS).problem, null, 'silent again'); assert.deepEqual(kinds(r, 'vannaia'), []);
  r = reg(pick(wet, 'sensor.bath_climate_humidity', '90'), {}, { ...LINKS, vannaia: {} }); assert.equal(airSummary(r, ROOMS).problem, null, 'unlinked'); assert.deepEqual(kinds(r, 'vannaia'), []);
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
test('priority within one tone: CO₂, PM, humidity, temperature; the storeroom never raises a problem', () => {
  let s = airSummary(reg(pick(pick(house(), 'sensor.kids_co2', '1300'), 'sensor.bath_climate_humidity', '80')), ROOMS); assert.equal(s.problem!.metric, 'co2'); assert.equal(s.problem!.room.id, 'detskaia'); assert.equal(s.tone, 'warn');
  s = airSummary(reg(pick(house(), 'sensor.bath_climate_humidity', '90')), ROOMS); assert.deepEqual([s.problem!.metric, s.problem!.room.id, s.problem!.tone, s.problem!.high], ['humidity', 'vannaia', 'bad', true]);
});
test('a red reading outranks a yellow one, whatever the readings are (owner, 06.11.2026)', () => {
  const of = (...over: Array<[string, string]>) => { let h = house(); for (const [e, v] of over) h = pick(h, e, v); return airSummary(reg(h), ROOMS); };
  let s = of(['sensor.kids_co2', '1250'], ['sensor.living_air_purifier_pm25', '200']); assert.deepEqual([s.problem!.metric, s.problem!.room.id, s.problem!.tone, s.tone], ['pm25', 'gostinaia', 'bad', 'bad'], 'CO₂ 1250 yellow, PM2.5 200 red: the sentence and the look follow PM2.5');
  assert.deepEqual([toneOf('co2', s.co2.value), toneOf('pm25', s.pm25.value)], ['warn', 'bad'], 'and each number keeps its own tone');
  s = of(['sensor.kids_co2', '1300'], ['sensor.bedroom_climate_temperature', '16']); assert.deepEqual([s.problem!.metric, s.problem!.tone], ['temperature', 'bad'], 'even the last metric, when it is the red one');
  s = of(['sensor.kids_co2', '2100'], ['sensor.living_air_purifier_pm25', '200']); assert.equal(s.problem!.metric, 'co2', 'both red: the order of the metrics');
  s = of(['sensor.kids_co2', '1300'], ['sensor.living_air_purifier_pm25', '20']); assert.deepEqual([s.problem!.metric, s.tone], ['co2', 'warn'], 'both yellow: the order of the metrics');
  s = of(['sensor.kitchen_climate_humidity', '90'], ['sensor.bath_climate_humidity', '86']); assert.equal(s.problem!.room.id, 'kukhnia', 'one metric, one tone: 20 past the warning limit beats 11');
});
test('humidity scales: room, kitchen, bathroom', () => { assert.equal(toneOf('humidity', 64), 'ok'); assert.equal(toneOf('humidity', 65), 'warn'); assert.equal(toneOf('humidity', 69), 'warn'); assert.equal(toneOf('humidity', 70), 'bad'); assert.equal(toneOf('humidity', 25), 'bad'); assert.equal(toneOf('humidity', 35), 'warn'); assert.equal(toneOf('humidity', 69, 'kitchen'), 'ok'); assert.equal(toneOf('humidity', 70, 'kitchen'), 'warn'); assert.equal(toneOf('humidity', 80, 'kitchen'), 'bad'); assert.equal(toneOf('humidity', 74, 'bath'), 'ok'); assert.equal(toneOf('humidity', 80, 'bath'), 'warn'); assert.equal(toneOf('humidity', 86, 'bath'), 'bad'); assert.equal(toneOf('humidity', 20, 'bath'), 'ok'); assert.equal(toneOf('temperature', 18.5), 'warn'); assert.equal(toneOf('co2', 1200), 'warn'); assert.equal(toneOf('pm25', 15), 'ok'); });
test('a vent found by itself, a purifier told apart', () => { const r = airRooms(reg(house(), {}), ROOMS); assert.deepEqual(r.find(x => x.id === 'kompiuternaia')!.vents, ['fan.office_fan']); const l = r.find(x => x.id === 'gostinaia')!; assert.equal(l.purifier, 'fan.living_air_purifier'); assert.deepEqual(l.vents, []); assert.equal(l.humidifier, 'humidifier.living_humidifier'); });
test('Russian room forms', () => { assert.equal(inRoomRu('Детская'), 'в Детской'); assert.equal(inRoomRu('Кухня'), 'на Кухне'); assert.equal(inRoomRu('Спальня'), 'в Спальне'); assert.equal(inRoomRu('Гостиная'), 'в Гостиной'); assert.equal(inRoomRu('Ванная'), 'в Ванной'); assert.equal(inRoomRu('Прихожая'), 'в Прихожей'); });

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
  const stuffy = reg([...house(), ['fan.kitchen_vent', 'kukhnia:v', null, 'off'], ['sensor.kitchen_co2', 'kukhnia:c', 'carbon_dioxide', '2500']]); assert.equal(roomOf(stuffy, 'kukhnia').co2!.value, 2500); assert.deepEqual(kinds(stuffy, 'kukhnia'), [], 'a stuffy kitchen with a vent: words only');
});
test('a vent offline: the button says so', () => { const r = reg(pick([...house(), ['fan.bath_vent', 'vannaia:v', null, 'unavailable']], 'sensor.bath_climate_humidity', '80')); assert.equal(airActions(roomOf(r, 'vannaia'), r)[0].blocked, 'offline'); const u = reg(pick([...house(), ['fan.bath_vent', 'vannaia:v', null, 'unknown']], 'sensor.bath_climate_humidity', '80')); assert.equal(airActions(roomOf(u, 'vannaia'), u)[0].blocked, 'offline', 'the server refuses «unknown» too'); });

test('a switch is a vent only by the whole word', () => { const r = reg([...house(), ['switch.kitchen_cat_feeder_prevent_accumulation', 'kukhnia:feeder', null, 'off'], ['switch.bath_dryer_wrinkle_prevent', 'vannaia:dryer', null, 'off'], ['switch.bath_vent', 'vannaia:relay', null, 'off'], ['switch.adventure', 'vannaia:x', null, 'off']]); assert.deepEqual(roomOf(r, 'kukhnia').vents, []); assert.deepEqual(roomOf(r, 'vannaia').vents, ['switch.bath_vent']); });
test('the look follows the sentence', () => { const s = airSummary(reg(pick(pick(house(), 'sensor.kitchen_climate_humidity', '75'), 'sensor.bedroom_climate_temperature', '26')), ROOMS); assert.equal(s.problem!.metric, 'humidity'); assert.equal(s.tone, 'warn'); });

test('the vent stops at 60 % in the heating season and 64 % in summer, under «Влажно» at 65', () => { assert.equal(airTarget('dehumidify', new Date(2026, 10, 5)), 60); assert.equal(airTarget('dehumidify', new Date(2026, 3, 30)), 60); assert.equal(airTarget('dehumidify', new Date(2026, 4, 1)), 64); assert.equal(airTarget('dehumidify', new Date(2026, 8, 30)), 64); assert.equal(airTarget('purify', new Date(2026, 6, 1)), 15); });

test('a button shows the summer target in summer', () => { const wet = withVent('vannaia', 'fan.bath_vent', ['sensor.bath_climate_humidity', '78']); assert.equal(airActions(roomOf(wet, 'vannaia'), wet, new Date(2026, 6, 1))[0].target, 64); });
test('a vent\'s own settings and a purifier by another name are not vents', () => { const r = reg([...house(), ['switch.bath_vent_child_lock', 'vannaia:v', null, 'off'], ['switch.kitchen_hood_light', 'kukhnia:h', null, 'off'], ['fan.zhimi_airp_mb5', 'detskaia:p', null, 'on'], ['fan.kitchen_oven_fan', 'kukhnia:o', null, 'off']]); assert.deepEqual(roomOf(r, 'vannaia').vents, []); assert.deepEqual(roomOf(r, 'kukhnia').vents, []); assert.deepEqual(roomOf(r, 'detskaia').vents, []); assert.equal(roomOf(r, 'detskaia').purifier, 'fan.zhimi_airp_mb5'); });
test('a CO₂ sensor in the hall does not move the mean of the six rooms', () => { const before = airSummary(reg(house()), ROOMS).temperature; const rooms = [...ROOMS, { id: 'prikhozhaia', name: 'Прихожая' }], after = airSummary(reg([...house(), ['sensor.hall_co2', 'prikhozhaia:c', 'carbon_dioxide', '800'], ['sensor.hall_temperature', 'prikhozhaia:c', 'temperature', '10']], {}, { ...LINKS, prikhozhaia: { temperature: 'sensor.hall_temperature' } }), rooms); assert.equal(after.temperature.value, before.value); assert.equal(after.temperature.total, before.total); assert.ok(after.rooms.some(x => x.id === 'prikhozhaia'), 'it stays in the rooms'); assert.equal(after.co2.total, airSummary(reg(house()), ROOMS).co2.total + 1, 'and its CO₂ counts for the worst'); });

test('silence is not good air: no data has its own tone, a real problem still wins', () => {
  const allDead = (over: Array<[string, string]> = []) => { let s = house().map(x => x[0].startsWith('sensor.') ? [x[0], x[1], x[2], 'unavailable'] as [string, string, string | null, string] : x); for (const [e, v] of over) s = pick(s, e, v); return airSummary(reg(s), ROOMS); };
  let s = allDead(); assert.deepEqual(s.noData, ['co2', 'pm25', 'humidity', 'temperature']); assert.equal(s.tone, 'none'); assert.equal(s.problem, null);
  s = airSummary(reg(pick(house(), 'sensor.kids_co2', 'unavailable')), ROOMS); assert.deepEqual(s.noData, [], 'one of two CO₂ sensors dead: the other still speaks'); assert.equal(s.tone, 'ok');
  s = airSummary(reg(pick(pick(house(), 'sensor.kids_co2', 'unavailable'), 'sensor.living_co2', 'unavailable')), ROOMS); assert.deepEqual(s.noData, ['co2']); assert.equal(s.tone, 'none');
  s = allDead([['sensor.bath_climate_humidity', '90']]); assert.equal(s.problem!.room.id, 'vannaia'); assert.equal(s.tone, 'bad'); assert.ok(s.noData.includes('co2'), 'and the gap is still known');
});
test('humidity problems compare by the limit that was crossed', () => {
  const s = airSummary(reg(pick(pick(house(), 'sensor.bedroom_climate_humidity', '39'), 'sensor.kitchen_climate_humidity', '79')), ROOMS); assert.deepEqual([s.problem!.room.id, s.problem!.high], ['kukhnia', true], '79 % over a limit of 70 beats 39 % under a limit of 40');
  const d = airSummary(reg(pick(pick(house(), 'sensor.bedroom_climate_humidity', '33'), 'sensor.kitchen_climate_humidity', '71')), ROOMS); assert.deepEqual([d.problem!.room.id, d.problem!.high], ['spalnia', false], '7 under beats 1 over');
});
test('no start button for a vent already on: the server would send nothing and leave it on', () => {
  const r = withVent('vannaia', 'fan.bath_vent', ['sensor.bath_climate_humidity', '78']); assert.deepEqual(kinds(r, 'vannaia'), ['dehumidify']);
  r.states['fan.bath_vent'] = { ...r.states['fan.bath_vent'], state: 'on' }; assert.deepEqual(kinds(r, 'vannaia'), []);
  const two = reg(pick([...house(), ['fan.bath_a', 'vannaia:a', null, 'unavailable'], ['fan.bath_b', 'vannaia:b', null, 'on']], 'sensor.bath_climate_humidity', '78')); assert.deepEqual(kinds(two, 'vannaia'), [], 'the one it would use is the one that answers');
});
test('refusals in the owner\'s language: known messages only', () => {
  assert.equal(airErrorKey({ code: 'invalid', message: 'device offline' }), 'deviceOffline'); assert.equal(airErrorKey(new Error('device busy')), 'err.busy'); assert.equal(airErrorKey({ code: 'not_ready', message: 'Atom Home is starting' }), 'err.starting'); assert.equal(airErrorKey({ code: 'unauthorized', message: 'Unauthorized' }), 'err.denied');
  for (const other of [{ code: 'failed', message: 'device refused' }, new Error('preview: commands are rejected'), { code: 'invalid', message: 'bad device' }, 'boom', null, undefined, {}]) assert.equal(airErrorKey(other), 'failed');
});
test('the room search walks the registry once, and one draw searches once', () => {
  let searches = 0; const counted = <T extends object>(list: T): T => new Proxy(list, { get(o, k, r) { if (k === 'find' || k === 'filter') searches++; return Reflect.get(o, k, r); } });
  const r = reg(house()), plain = airRooms(r, ROOMS); r.devices = counted(r.devices); r.entities = counted(r.entities);
  const fast = airRooms(r, ROOMS); assert.equal(searches, 0, 'no search per entity or per room'); assert.deepEqual(fast, plain);
  const fresh = reg(pick(house(), 'sensor.kids_co2', '1500')), a = airSummary(fresh, ROOMS); assert.equal(airSummary({ ...fresh }, [...ROOMS]), a, 'the tile and the open sheet in one draw'); assert.notEqual(airSummary(reg(pick(house(), 'sensor.kids_co2', '1600')), ROOMS), a); assert.equal(airSummary(reg(pick(house(), 'sensor.kids_co2', '1600')), ROOMS).co2.value, 1600, 'new values are not served from the old answer');
});
test('a limit is judged on the printed number: a yellow «65%» never stands beside a black one', () => {
  assert.equal(toneOf('humidity', 64.4), 'ok'); assert.equal(toneOf('humidity', 65), 'warn', 'exactly the limit is already «Влажно»: the owner, 06.11.2026'); assert.equal(toneOf('humidity', 64.6), 'warn');
  assert.equal(toneOf('humidity', 69.4), 'warn'); assert.equal(toneOf('humidity', 69.5), 'bad'); assert.equal(toneOf('humidity', 70), 'bad');
  assert.equal(toneOf('humidity', 39.6), 'ok'); assert.equal(toneOf('humidity', 39.4), 'warn');
  assert.equal(toneOf('co2', 1199.4), 'ok'); assert.equal(toneOf('co2', 1199.6), 'warn'); assert.equal(toneOf('pm25', 15.4), 'ok'); assert.equal(toneOf('pm25', 15.5), 'warn');
  assert.equal(toneOf('temperature', 25.04), 'ok'); assert.equal(toneOf('temperature', 25.06), 'warn'); assert.equal(shown('temperature', 25.15), Number((25.15).toFixed(1)), 'as toLocaleString rounds it');
  assert.equal(isHigh('humidity', 64.4), false); assert.equal(isHigh('humidity', 64.5), true); assert.equal(isHigh('temperature', 25.04), false); assert.equal(isHigh('temperature', 25.06), true);
});
test('every upper limit belongs to the bad side, judged on the printed number (owner, 06.11.2026)', () => {
  for (const [scale, warn, bad] of [['room', 65, 70], ['kitchen', 70, 80], ['bath', 75, 85]] as const) {
    assert.equal(toneOf('humidity', warn - 0.6, scale), 'ok', `${scale} under ${warn}`); assert.equal(toneOf('humidity', warn - 0.5, scale), 'warn', `${scale} prints ${warn}`); assert.equal(toneOf('humidity', warn, scale), 'warn', `${scale} exactly ${warn}`); assert.equal(isHigh('humidity', warn, scale), true); assert.equal(isHigh('humidity', warn - 0.6, scale), false);
    assert.equal(toneOf('humidity', bad - 0.6, scale), 'warn', `${scale} under ${bad}`); assert.equal(toneOf('humidity', bad - 0.5, scale), 'bad', `${scale} prints ${bad}`); assert.equal(toneOf('humidity', bad, scale), 'bad', `${scale} exactly ${bad}`);
  }
});
test('the spec and the code\'s comment say what the code does: the next fixer checks against them', () => {
  const spec = readFileSync(new URL('../../docs/AIR.md', import.meta.url), 'utf8'), code = readFileSync(new URL('../src/model/air.ts', import.meta.url), 'utf8');
  assert.match(spec, /64,4 % печатается «64%» и это норма/); assert.match(spec, /64,5 %, ровно 65 % и 65,4 % печатаются «65%» и это «Влажно»/); assert.doesNotMatch(spec, /65,4 % печатается «65%» и это норма/); assert.doesNotMatch(spec, /ровно 65 % пока норма/);
  for (const limit of ['70', '80', '75', '85']) assert.match(spec, new RegExp(`Граница судится[^\\n]*\\b${limit}\\b`), `the same rule for ${limit}`);
  assert.equal(toneOf('humidity', 64.4), 'ok'); assert.equal(toneOf('humidity', 65.4), 'warn'); assert.doesNotMatch(code, /so 65 %/); assert.match(code, /so 64 %, just under Влажно/);
});
test('the same on the sentence and on the button', () => {
  const room = (v: string) => { const s = [...house(), ['sensor.office_vent', 'kompiuternaia:f', null, 'off'] as [string, string, string | null, string]]; return reg(pick(s, 'sensor.office_climate_humidity', v)); };
  assert.equal(airSummary(room('64.4'), ROOMS).problem, null); assert.equal(airSummary(room('64.5'), ROOMS).problem?.room.id, 'kompiuternaia');
  const r = (v: string) => { const x = room(v); return airActions(airRooms(x, ROOMS).find(y => y.id === 'kompiuternaia')!, x); };
  assert.deepEqual(r('64.4'), []); assert.equal(r('64.5')[0]?.kind, 'dehumidify');
});
test('two vents in a room with one on: it runs, whichever comes first', () => {
  for (const order of [['fan.a', 'fan.b'], ['fan.b', 'fan.a']]) { const s: ReturnType<typeof house> = [...pick(house(), 'sensor.bath_climate_humidity', '78'), [order[0], 'vannaia:v1', null, 'off'], [order[1], 'vannaia:v2', null, 'on']], states = { [order[1]]: 'on' }; const r = reg(s, states), room = airRooms(r, ROOMS).find(x => x.id === 'vannaia')!; assert.equal(room.ventOn, true); assert.deepEqual(airActions(room, r), [], order.join()); }
});
test('a device is away with no state, unavailable or unknown', () => {
  const r = reg(house(), { 'fan.x': 'unknown', 'fan.y': 'unavailable', 'fan.z': 'off' }); assert.equal(deviceAway(r, 'fan.x'), true); assert.equal(deviceAway(r, 'fan.y'), true); assert.equal(deviceAway(r, 'fan.none'), true); assert.equal(deviceAway(r, 'fan.z'), false);
});
test('a purifier is off only when it reads off', () => {
  const room = (state: string) => airRooms(reg(pick(house(), 'fan.living_air_purifier', state)), ROOMS).find(x => x.id === 'gostinaia')!;
  assert.equal(room('off').purifierOff, true); for (const s of ['unavailable', 'unknown', 'on']) assert.equal(room(s).purifierOff, false, s);
});
test('one word declines, more than one stands as it is', () => {
  assert.equal(declinable('Детская'), true); assert.equal(declinable(' Кухня '), true); assert.equal(declinable('Главная спальня'), false);
});
test('no «-0» just below freezing, and the rounding is otherwise what it was', () => {
  assert.equal(num(-0.3, 'ru', 0), '0'); assert.equal(num(-0.04, 'ru', 1), '0'); assert.equal(num(-0.6, 'ru', 0), '-1'); assert.equal(num(21.46, 'en', 1), '21.5'); assert.equal(num(0, 'ru', 0), '0'); assert.equal(num(null, 'ru'), '—');
});
test('the first off reading ends a no_stop row for good; a later alarm still shows; the list keeps its identity', () => {
  const states = (state: string) => ({ states: { 'fan.v': { state } } }) as unknown as Registry, job: AirTask = { kind: 'dehumidify', roomId: 'r', device: 'fan.w', sensor: 's', target: 60, startedAt: 5 }, alarm: AirTask = { ...job, device: 'fan.v', startedAt: 7, outcome: 'no_stop' }, timedOut: AirTask = { ...job, device: 'fan.v', outcome: 'out_of_time' }, list = [job, alarm, timedOut], over = new Set<string>();
  assert.equal(withoutEndedAlarms(null, over, states('off')), null, 'no list is not an empty list');
  assert.equal(withoutEndedAlarms(list, over, states('on')), list, 'still on: the very same array');
  assert.equal(withoutEndedAlarms(list, over, states('unavailable')), list, 'unavailable says nothing');
  assert.equal(over.size, 0);
  const left = withoutEndedAlarms(list, over, states('off'));
  assert.deepEqual(left, [job, timedOut], 'off: the alarm goes, nothing else does');
  assert.equal(withoutEndedAlarms(list, over, states('on'), left), left, 'on again with the old list: still gone, and the same array as last time');
  assert.deepEqual(withoutEndedAlarms(list, new Set(over), states('on')), [job, timedOut], 'the memory is what holds it, not the reading');
  const later = [{ ...alarm, startedAt: 8 }];
  assert.equal(withoutEndedAlarms(later, over, states('on')), later, 'a later alarm of the same vent has a new start and shows');
});
test('a relay with an ordinary vent name is a vent, and the same words stay out as on the server', () => {
  const good = ['switch.vannaia_vytiazhka', 'switch.ventiliatsiia_vannaia', 'switch.ventiliator_vannaia', 'switch.vytiazhnoi_ventiliator', 'switch.vytiazhnaia_kukhnia', 'switch.bath_ventilator', 'switch.bath_fan', 'switch.bathroom_extractor', 'switch.extractor_kitchen', 'switch.kukhnia_vytiazhka', 'switch.vytiazhka_kukhnia', 'switch.bath_vent', 'switch.kitchen_hood'];
  const bad = ['switch.kukhnia_vytiazhka_svet', 'switch.kukhnia_vytiazhka_podsvetka', 'switch.kukhnia_vytiazhka_lampa', 'switch.kukhnia_vytiazhka_blokirovka', 'switch.kukhnia_vytiazhka_zamok', 'switch.kukhnia_vytiazhka_rezhim', 'switch.kukhnia_vytiazhka_indikator', 'switch.kukhnia_hood_lights', 'switch.kukhnia_hood_lamps', 'switch.x_fan_beep', 'switch.fan_mode', 'switch.fanatic', 'switch.bath_fan_light', 'switch.ventiliator_child_lock', 'switch.vytiazhka_light', 'switch.bathroom_extractor_indicator', 'switch.kukhnia_relay_1', 'switch.air_purifier_fan', 'switch.living_air_purifier_ventilator', 'switch.zhimi_airp_mb5_vent', 'switch.kitchen_cat_feeder_prevent_accumulation', 'switch.bath_dryer_wrinkle_prevent', 'switch.kitchen_hood_light', 'switch.bath_vent_child_lock'];
  const r = reg([...house(), ...[...good, ...bad].map((id, i): [string, string, null, string] => [id, `vannaia:d${i}`, null, 'off'])]);
  assert.deepEqual(roomOf(r, 'vannaia').vents, good);
});
test('a room row opens nothing: its only controls are the vent\'s buttons (owner, 06.11.2026)', () => {
  const code = readFileSync(new URL('../src/modules/air.tsx', import.meta.url), 'utf8'), row = code.slice(code.indexOf('function RoomCard('), code.indexOf('const WEATHER:'));
  assert.ok(row.includes('data-room={room.id}'), 'the row is still here'); assert.doesNotMatch(row, /onClick|onKeyDown|href=|<a\b|<button|role="(button|link)"|tabIndex|location\.|openRoom|navigate/);
});
