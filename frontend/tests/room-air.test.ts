import test from 'node:test';
import assert from 'node:assert/strict';
import { airOptionsOf, houseRoomAir, autoRoomAir, cleanRoomAir, airSummary } from '../src/model/air.ts';
import { normaliseConfig } from '../src/model/config.ts';
import type { Registry } from '../src/model/registry.ts';

// A room's place in «Воздух» moved from the code into the house's settings (owner, 27.11.2026): a second house has a «spalnia» that is its showroom,
// and the card took the house's mean from it alone.
const CRIULENI = [['gostinaia', 'Гостиная'], ['detskaia', 'Детская'], ['spalnia', 'Спальня'], ['kompiuternaia', 'Компьютерная'], ['kukhnia', 'Кухня'], ['vannaia', 'Ванная'], ['sklad', 'Склад'], ['podezd', 'Подъезд'], ['prikhozhaia', 'Прихожая']].map(([id, name]) => ({ id, name }));

test('the first house, while nothing is set there, runs exactly as it did before the settings', () => {
  const o = airOptionsOf(CRIULENI);
  assert.deepEqual(new Set(o.average), new Set(['gostinaia', 'detskaia', 'spalnia', 'kompiuternaia', 'kukhnia', 'vannaia']), 'the six; the hall and the entrance only show');
  assert.deepEqual(o.excluded, ['sklad']);
  assert.deepEqual(new Set(o.kitchen), new Set(['kukhnia', 'sklad']));
  assert.deepEqual(o.bath, ['vannaia']);
  assert.deepEqual(o.actions, { kompiuternaia: ['dehumidify'], kukhnia: ['dehumidify', 'purify'], vannaia: ['dehumidify'], sklad: ['dehumidify', 'purify'] });
});

test('one of the first house\'s ids alone is an ordinary word: a showroom called «spalnia» is a room like any other', () => {
  const o = airOptionsOf([{ id: 'living_room', name: '3. Living Room' }, { id: 'spalnia', name: 'Showroom' }, { id: 'kukhnia', name: 'Kitchen' }]);
  assert.deepEqual(o.average, [], 'no room only shows: the mean is of every counted room');
  assert.deepEqual([o.excluded, o.kitchen, o.bath], [[], ['kukhnia'], []]);
});

test('a room nobody set takes its kind from its name, in the three languages', () => {
  for (const n of ['Кухня', '2. Kitchen', 'Bucătărie']) assert.deepEqual(autoRoomAir(n), { scale: 'kitchen', count: 'mean', actions: ['dehumidify', 'purify'] }, n);
  for (const n of ['Ванная', 'Bathroom', 'Baie', 'Санузел', 'WC']) assert.deepEqual(autoRoomAir(n), { scale: 'bath', count: 'mean', actions: ['dehumidify'] }, n);
  assert.deepEqual(autoRoomAir('Bedroom'), { scale: 'room', count: 'mean', actions: [] });
});

test('what the owner set wins; once anything is set, the first house\'s defaults no longer apply to the rest', () => {
  const set = CRIULENI.map(r => r.id === 'podezd' ? { ...r, air: { count: 'off' as const } } : r), a = houseRoomAir(set);
  assert.equal(a.get('podezd')!.count, 'off');
  assert.equal(a.get('sklad')!.count, 'mean', 'unset rooms now take their names\' kinds (the settings page writes every room at the first change)');
  assert.equal(a.get('kukhnia')!.scale, 'kitchen');
});

test('a stored setting keeps only what is valid', () => {
  assert.deepEqual(cleanRoomAir({ scale: 'kitchen', count: 'nope', actions: ['purify', 'explode'] }), { scale: 'kitchen', actions: ['purify'] });
  assert.equal(cleanRoomAir('x'), undefined); assert.equal(cleanRoomAir({}), undefined);
  const c = normaliseConfig({ schemaVersion: 1, home: { name: 'H', language: 'en', theme: 'dark' }, rooms: { kitchen: { air: { scale: 'bath', count: 'aside', actions: ['dehumidify'] } } } }).config;
  assert.deepEqual(c.rooms.kitchen.air, { scale: 'bath', count: 'aside', actions: ['dehumidify'] }, 'the panel keeps it on load and on save');
});

test('«show only» leaves the mean, «do not count» leaves everything', () => {
  const s = (id: string, dc: string, v: string) => [id, { state: v, attributes: { device_class: dc }, last_changed: '', last_updated: '' }] as const;
  const states = Object.fromEntries([s('sensor.a_t', 'temperature', '20'), s('sensor.b_t', 'temperature', '24'), s('sensor.c_t', 'temperature', '10')]);
  const reg = { areas: ['a', 'b', 'c'].map(area_id => ({ area_id, name: area_id, temperature_entity_id: null, humidity_entity_id: null })), devices: ['a', 'b', 'c'].map(id => ({ id, name: id, model: null, manufacturer: null, area_id: id, entry_type: null })), entities: ['a', 'b', 'c'].map(id => ({ entity_id: `sensor.${id}_t`, device_id: id, area_id: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null, device_class: 'temperature', unit: null })), states } as unknown as Registry;
  const rooms = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', air: { count: 'aside' as const } }, { id: 'c', name: 'C', air: { count: 'off' as const } }];
  const sum = airSummary(reg, rooms);
  assert.equal(sum.temperature.value, 20, 'B only shows, C does not count');
  assert.equal(sum.problem, null, 'the cold C raises nothing');
  assert.deepEqual(sum.rooms.map(r => r.id), ['a', 'b', 'c'], 'all three stay in the list');
});
