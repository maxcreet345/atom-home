import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoom, silence, worst, plainName } from '../src/model/room.ts';
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
// the room's commands go through the shell's runner: `ran` keeps what was handed to it, `acted` the device actions asked for by id
const ran: Array<{ key: string; sent: unknown[] }> = [], acted: string[] = [];
const P = (reg: Registry) => { const sent: unknown[] = []; return { reg, lang: 'ru' as const, t, host: { call: async (...a: unknown[]) => { sent.push(a); } } as never, commands: { run: async (key: string, work: () => Promise<unknown>) => { ran.push({ key, sent }); await work(); return true; } }, deviceOf: () => undefined, toggle: () => {}, act: (_d: unknown, id: string) => { acted.push(id); } }; };

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
test('the feeder card reads the bowl from the scale, as the feeder sheet does, never «bowl_percent»', () => {
  const reg = house();
  reg.devices.push({ id: 'feeder', name: 'Кухня · Кормушка кошки (Xiaomi)', model: 'xiaomi.feeder.iv2001', manufacturer: null, area_id: 'kukhnia' } as never);
  for (const [id, state, attributes] of [['switch.kitchen_cat_feeder_schedule', 'on', {}], ['sensor.kitchen_cat_feeder_bowl_percent', '75', {}], ['sensor.kitchen_cat_feeder_eaten_p22', '0.0', { 'eaten_food_measure-2-22': 0, unit_of_measurement: 'g' }], ['sensor.kitchen_cat_feeder_food_level', 'normal', {}]] as const) {
    reg.entities.push({ entity_id: id, device_id: 'feeder', area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null } as never);
    reg.states[id] = { state, attributes, last_changed: '', last_updated: '' } as never;
  }
  const th = readRoom(reg, 'kukhnia', 'Кухня', null, null).things.find(x => x.kind === 'feeder')!;
  let d = detail(th, P(reg)); assert.ok(d.facts.some(f => f.text === 'Миска пустая'), JSON.stringify(d.facts)); assert.ok(!d.facts.some(f => /75/.test(f.text)));
  reg.states['sensor.kitchen_cat_feeder_eaten_p22'] = { ...reg.states['sensor.kitchen_cat_feeder_eaten_p22'], state: '12' };
  d = detail(th, P(reg)); assert.ok(d.facts.some(f => f.text === 'В миске 12 г'));
});

// ----- audit 2026-11-09: commands of the room page, the valve, silent sensors -----
function withValve(state: string): Registry {
  const r = house(); const R = r as unknown as { devices: unknown[]; entities: unknown[]; areas: unknown[] };
  R.areas.push({ area_id: 'vannaia', name: 'Ванная', temperature_entity_id: null, humidity_entity_id: null });
  R.devices.push({ id: 'valve', name: 'Ванная · Кран воды ванной', model: null, manufacturer: null, area_id: 'vannaia' });
  R.entities.push({ entity_id: 'valve.bath_water', device_id: 'valve', area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null });
  r.states['valve.bath_water'] = { state, attributes: { device_class: 'water' }, last_changed: '2026-11-09T12:00:00Z', last_updated: '' };
  return r;
}
test('the valve on a room page: opening is its own «open» action (it asks), shutting is ONE tap through the command runner (owner: closing never asks); never a toggle; a state that is neither is said', async () => {
  const dev = { key: 'dev:valve' } as never;
  for (const [state, status, label, action] of [['closed', 'Вода перекрыта', 'Открыть воду', 'open'], ['open', 'Вода открыта', 'Перекрыть воду', 'close'], ['unknown', 'Нет данных о кране', 'Перекрыть воду', 'close']] as const) {
    const reg = withValve(state), th = readRoom(reg, 'vannaia', 'Ванная', null, null).things.find(x => x.kind === 'valve')!;
    let toggled = 0; acted.length = 0; ran.length = 0;
    const d = detail(th, { ...P(reg), deviceOf: () => dev, toggle: () => { toggled++; } });
    assert.equal(d.status, status); assert.equal(d.action?.label, label); d.action!.run(); await Promise.resolve();
    // «open» goes to the sheet's runner, which asks; «close» is sent at once, through the shell's runner, under the valve's own key
    if (action === 'open') { assert.deepEqual(acted, ['open']); assert.equal(ran.length, 0); }
    else { assert.deepEqual(acted, [], 'closing never goes through the asking runner'); assert.equal(ran.length, 1); assert.equal(ran[0].key, `room:${th.main}`); assert.deepEqual(ran[0].sent, [['valve', 'close_valve', { entity_id: th.main }]]); assert.equal(d.action!.key, `room:${th.main}`); }
    assert.equal(toggled, 0);
  }
  const moving = withValve('opening'), th = readRoom(moving, 'vannaia', 'Ванная', null, null).things.find(x => x.kind === 'valve')!;
  const d = detail(th, { ...P(moving), deviceOf: () => dev }); assert.equal(d.status, 'Кран поворачивается'); assert.equal(d.action, null);
});
test('the TV button of a room goes through the command runner under its own key, not straight to the host', async () => {
  const reg = house({ 'sensor.living_tv_active_app': 'YouTube' }), tv = readRoom(reg, 'gostinaia', 'Гостиная', null, null).things.find(x => x.kind === 'tv')!;
  ran.length = 0; const p = P(reg), d = detail(tv, p);
  assert.equal(d.action?.key, 'room:media_player.living_tv'); d.action!.run(); await new Promise(r => setTimeout(r, 0));
  assert.equal(ran.length, 1); assert.equal(ran[0].key, 'room:media_player.living_tv');
  assert.deepEqual(ran[0].sent, [['media_player', 'turn_off', { entity_id: 'media_player.living_tv' }]]);
});
test('a room whose sensors are all silent is not «in order»; one silent sensor is «part»', () => {
  const dead = readRoom(house({ 'sensor.living_co2': 'unavailable', 'sensor.living_co2_humidity': 'unavailable', 'sensor.living_co2_temperature': 'unavailable' }), 'gostinaia', 'Гостиная', null, null);
  assert.equal(silence(dead.readings), 'all'); assert.equal(worst(dead.readings), null);
  const part = readRoom(house({ 'sensor.living_co2': '600', 'sensor.living_co2_humidity': 'unavailable' }), 'gostinaia', 'Гостиная', null, null);
  assert.equal(silence(part.readings), 'part');
  assert.equal(silence(readRoom(house({ 'sensor.living_co2': '600' }), 'gostinaia', 'Гостиная', null, null).readings), null);
});
