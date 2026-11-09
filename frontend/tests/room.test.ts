import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoom, worst, plainName } from '../src/model/room.ts';
import { detail } from '../src/ui/room-words.ts';
import { translator } from '../src/i18n/index.ts';
import type { Registry } from '../src/model/registry.ts';

// A small kitchen and living room as HA has them: devices with their entities, the states, the area's own climate links.
type E = [id: string, device: string, state: string, attrs?: Record<string, unknown>];
const DEV: Record<string, [name: string, area: string, model?: string]> = {
  kettle: ['Кухня · Чайник (Xiaomi Smart Kettle 2 Pro)', 'kukhnia'], kplug: ['Кухня · Розетка чайника (SONOFF S60ZBTPF)', 'kukhnia', 'Zigbee smart plug'],
  fridge: ['Кухня · Розетка холодильника (SONOFF S60ZBTPF)', 'kukhnia', 'Zigbee smart plug'], gas: ['Кухня · Датчик газа (Tuya TS0601)', 'kukhnia'], win: ['Кухня · Датчик окна (SNZB-04P)', 'kukhnia'],
  router: ['Кухня · Zigbee-роутер (SLZB-MR3)', 'kukhnia'], spm: ['SPM-Main (вводы кв. 8/9)', 'kukhnia', 'SPM-Main'],
  tv: ['Гостиная · Телевизор (Hisense 65U8KQ)', 'gostinaia'], meter: ['Гостиная · Счётчик энергии (телевизор)', 'gostinaia', 'Zigbee energy meter'], co2: ['Гостиная · Датчик CO₂', 'gostinaia'],
  purifier: ['Гостиная · Очиститель воздуха (Xiaomi)', 'gostinaia'],
};
const ENT: E[] = [
  ['water_heater.kitchen_kettle', 'kettle', 'off', { temperature: 99 }], ['switch.kitchen_kettle_power', 'kettle', 'off'], ['switch.kitchen_kettle_no_disturb', 'kettle', 'off'], ['switch.kitchen_kettle_boiling_reminder', 'kettle', 'off'],
  ['sensor.kitchen_kettle_status', 'kettle', 'idle'], ['sensor.kitchen_kettle_temperature', 'kettle', '20', { device_class: 'temperature' }],
  ['switch.kitchen_kettle_plug', 'kplug', 'on'], ['sensor.kitchen_kettle_plug_power', 'kplug', '0', { device_class: 'power' }],
  ['switch.kitchen_fridge_plug', 'fridge', 'on'], ['sensor.kitchen_fridge_plug_power', 'fridge', '86', { device_class: 'power' }], ['sensor.kitchen_fridge_plug_energy_today', 'fridge', '0.69', { device_class: 'energy' }],
  ['binary_sensor.kitchen_gas', 'gas', 'off', { device_class: 'gas' }], ['switch.kitchen_gas_alarm', 'gas', 'off'],
  ['binary_sensor.kitchen_window_contact', 'win', 'on', { device_class: 'window' }], ['binary_sensor.kitchen_window_tamper', 'win', 'off', { device_class: 'tamper' }],
  ['switch.kitchen_slzb_router', 'router', 'off'], ['switch.entrance_spm_apt8', 'spm', 'on'], ['sensor.entrance_spm_apt8_power', 'spm', '900', { device_class: 'power' }],
  ['media_player.living_tv', 'tv', 'on'], ['sensor.living_tv_active_app', 'tv', 'Standby'], ['sensor.living_tv_meter_power', 'meter', '19.8', { device_class: 'power' }],
  ['sensor.living_co2', 'co2', '2400', { device_class: 'carbon_dioxide' }], ['sensor.living_co2_humidity', 'co2', '66', { device_class: 'humidity' }], ['sensor.living_co2_temperature', 'co2', '20.2', { device_class: 'temperature' }],
  ['fan.living_air_purifier', 'purifier', 'on', { preset_mode: 'Auto', percentage: 33 }], ['sensor.living_air_purifier_filter_life', 'purifier', '20'],
];
function house(over: Record<string, string> = {}): Registry {
  return {
    areas: [{ area_id: 'kukhnia', name: 'Кухня', temperature_entity_id: null, humidity_entity_id: null }, { area_id: 'gostinaia', name: 'Гостиная', temperature_entity_id: 'sensor.living_co2_temperature', humidity_entity_id: 'sensor.living_co2_humidity' }],
    devices: Object.entries(DEV).map(([id, [name, area_id, model]]) => ({ id, name, model: model ?? null, manufacturer: null, area_id })),
    entities: ENT.map(([entity_id, device_id]) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(ENT.map(([id, , state, attributes]) => [id, { state: over[id] ?? state, attributes: attributes ?? {}, last_changed: '2026-11-09T12:00:00Z', last_updated: '' }])),
  } as unknown as Registry;
}
const t = translator('ru');
const P = (reg: Registry) => ({ reg, lang: 'ru' as const, t, host: { call: async () => ({}) } as never, deviceOf: () => undefined, toggle: () => {} });

test('a device is one card: the kettle with its many switches, the plug that powers it adds its watts', () => {
  const m = readRoom(house({ 'sensor.kitchen_kettle_plug_power': '1840' }), 'kukhnia', 'Кухня', null, null);
  const kettles = m.things.filter(x => x.kind === 'kettle');
  assert.equal(kettles.length, 1); assert.equal(kettles[0].name, 'Чайник'); assert.equal(kettles[0].power, 1840); assert.equal(kettles[0].main, 'switch.kitchen_kettle_power');
  assert.ok(!m.things.some(x => /розетка чайника/i.test(x.name)));
});
test('a plug with nothing of its own to power is named after what it powers', () => {
  const m = readRoom(house(), 'kukhnia', 'Кухня', null, null), fridge = m.things.find(x => x.kind === 'fridge');
  assert.equal(fridge?.name, 'Холодильник'); assert.equal(fridge?.today, 0.69);
});
test('detectors, hub relays and the mains are never device cards', () => {
  const m = readRoom(house(), 'kukhnia', 'Кухня', null, null), names = m.things.map(x => x.name).join(' ');
  assert.doesNotMatch(names, /газ|роутер|SPM|ввод/i);
  assert.equal(m.readings.gas?.on.length, 0); assert.deepEqual(m.readings.windows?.on, ['binary_sensor.kitchen_window_contact']);
  assert.equal(m.readings.motion, null, 'a window tamper is not motion');
  assert.ok(!m.consumers.some(c => c.power === 900), 'the flat feed is not a kitchen consumer');
});
test('a meter in parentheses gives the TV its watts; standby is not «on»', () => {
  const reg = house(), m = readRoom(reg, 'gostinaia', 'Гостиная', null, null), tv = m.things.find(x => x.kind === 'tv')!;
  assert.equal(tv.power, 19.8);
  const d = detail(tv, P(reg)); assert.equal(d.active, false); assert.equal(d.status, 'Спит (ожидание)'); assert.ok(d.facts.some(f => f.text === '20 Вт в ожидании'));
});
test('the fridge never gets a switch on its card; a worn filter is flagged', () => {
  const reg = house(), k = readRoom(reg, 'kukhnia', 'Кухня', null, null), g = readRoom(reg, 'gostinaia', 'Гостиная', null, null);
  const fr = detail(k.things.find(x => x.kind === 'fridge')!, { ...P(reg), deviceOf: () => ({}) as never });
  assert.equal(fr.action, null); assert.equal(fr.status, 'Компрессор работает');
  const pu = detail(g.air.find(x => x.kind === 'purifier')!, P(reg)); assert.ok(pu.facts.some(f => f.tone === 'warn' && /Фильтр 20/.test(f.text)));
});
test('the room speaks of its worst reading, red before yellow', () => {
  const m = readRoom(house(), 'gostinaia', 'Гостиная', null, null);
  assert.deepEqual(worst(m.readings), { metric: 'co2', tone: 'bad', value: 2400 });
  assert.equal(plainName('Гостиная · Розетка Apple TV (Xiaomi)', 'Гостиная'), 'Розетка Apple TV');
});
