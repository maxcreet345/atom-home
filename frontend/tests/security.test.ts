import test from 'node:test';
import assert from 'node:assert/strict';
import { readSecurity, secTone, silentOnes, countdown, pickValve } from '../src/model/security.ts';
import { sentence, stateWord, tileWord, devicesWord, hazardWord, hazardName, guardedNow, armWarning, valveOpenAsk, announcement } from '../src/model/security-words.ts';
import { translator } from '../src/i18n/index.ts';
import { defaultConfig } from '../src/model/config.ts';
import type { Registry } from '../src/model/registry.ts';
// The house's security as HA has it (book/06-dashboards/SECURITY.md): Alarmo, the door, two windows, gas, two leak sensors, the valve.
type Row = [id: string, area: string | null, state: string, attrs?: Record<string, unknown>, platform?: string];
const BASE: Row[] = [
  ['alarm_control_panel.alarmo', null, 'disarmed', { bypassed_sensors: [] }, 'alarmo'],
  ['binary_sensor.hall_door_contact', 'hall', 'off', { device_class: 'door', friendly_name: 'Входная дверь' }],
  ['binary_sensor.living_window_left_contact', 'living', 'off', { device_class: 'window', friendly_name: 'Гостиная · Левое окно' }],
  ['binary_sensor.kitchen_window_contact', 'kitchen', 'off', { device_class: 'window', friendly_name: 'Кухня · Окно' }],
  ['binary_sensor.kitchen_gas', 'kitchen', 'off', { device_class: 'gas', friendly_name: 'Кухня · Датчик газа' }],
  ['binary_sensor.bath_leak_water_leak', 'bath', 'off', { device_class: 'moisture', friendly_name: 'Ванная · Датчик протечки' }],
  ['binary_sensor.storage_leak_water_leak', 'storage', 'unknown', { device_class: 'moisture', friendly_name: 'Склад · Датчик протечки' }],
  ['valve.bath_water', 'bath', 'open', { device_class: 'water', friendly_name: 'Кран воды' }],
];
const AREAS = [['hall', 'Прихожая'], ['living', 'Гостиная'], ['kitchen', 'Кухня'], ['bath', 'Ванная'], ['storage', 'Склад']];
function house(over: Record<string, string> = {}, extra: Row[] = [], alarmAttrs: Record<string, unknown> = {}): Registry {
  const rows = [...BASE, ...extra];
  return {
    areas: AREAS.map(([area_id, name]) => ({ area_id, name })), devices: [],
    entities: rows.map(([entity_id, area_id, , , platform]) => ({ entity_id, device_id: null, area_id, name: null, original_name: null, platform: platform ?? 'mqtt', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(rows.map(([id, , state, attrs]) => [id, { state: over[id] ?? state, attributes: { ...(attrs ?? {}), ...(id.startsWith('alarm_') ? alarmAttrs : {}) }, last_changed: new Date(Date.now() - 10000).toISOString(), last_updated: '' }])),
  } as unknown as Registry;
}
const t = translator('ru');
test('a calm house: everything answers and is closed', () => {
  const s = readSecurity(house())!;
  assert.equal(secTone(s), 'calm'); assert.equal(sentence(s, t, 1, false), 'Дверь и окна закрыты'); assert.equal(devicesWord(s, t), 'всё закрыто'); assert.equal(silentOnes(s).length, 0);
});
test('a window sensor without a connection is never «закрыто»: the card is not calm and names the sensor', () => {
  for (const state of ['unavailable', 'unknown']) {
    const s = readSecurity(house({ 'binary_sensor.living_window_left_contact': state }))!;
    assert.equal(secTone(s), 'warn', state);
    assert.equal(sentence(s, t, 1, false), 'Не отвечает: левое окно · Гостиная');
    assert.equal(devicesWord(s, t), 'не отвечают: 1');
    assert.equal(guardedNow(s.guarded.find(g => g.id.includes('living'))!, t, ''), 'не отвечает');
    assert.match(armWarning(s, t) ?? '', /Не отвечает: левое окно · Гостиная\. Охрана его не увидит/);
  }
  const two = readSecurity(house({ 'binary_sensor.living_window_left_contact': 'unavailable', 'binary_sensor.hall_door_contact': 'unavailable' }))!;
  assert.equal(sentence(two, t, 1, false), 'Не отвечают датчики: 2'); assert.equal(armWarning(readSecurity(house())!, t), null);
});
test('a silent sensor does not hide an open window, and both are counted', () => {
  const s = readSecurity(house({ 'binary_sensor.living_window_left_contact': 'unavailable', 'binary_sensor.kitchen_window_contact': 'on' }))!;
  assert.match(sentence(s, t, 1, false), /^Открыто: /); assert.equal(devicesWord(s, t), 'открыто: 1 · не отвечают: 1');
});
test('gas without a connection is «не отвечает», never «ждёт первого срабатывания» or dry; an armed house with it is not «armed green»', () => {
  const s = readSecurity(house({ 'binary_sensor.kitchen_gas': 'unavailable' }))!, gas = s.hazards.find(h => h.what === 'gas')!;
  assert.equal(gas.silent, true); assert.equal(hazardWord(gas, t), 'не отвечает'); assert.equal(secTone(s), 'warn');
  assert.equal(sentence(s, t, 1, false), 'Не отвечает: датчик газа · Кухня');
  const unknown = readSecurity(house({ 'binary_sensor.kitchen_gas': 'unknown' }))!; assert.equal(hazardWord(unknown.hazards.find(h => h.what === 'gas')!, t), 'не отвечает');
  const armed = readSecurity(house({ 'binary_sensor.kitchen_gas': 'unavailable', 'alarm_control_panel.alarmo': 'armed_away' }))!; assert.equal(secTone(armed), 'warn');
});
test('a leak sensor: `unknown` waits for its first report (owner, 09.11.2026) and is calm; `unavailable` does not answer', () => {
  const s = readSecurity(house())!, storage = s.hazards.find(h => h.id.includes('storage'))!;
  assert.equal(storage.silent, false); assert.equal(hazardWord(storage, t), 'ждёт первого срабатывания'); assert.equal(secTone(s), 'calm');
  const lost = readSecurity(house({ 'binary_sensor.storage_leak_water_leak': 'unavailable' }))!, x = lost.hazards.find(h => h.id.includes('storage'))!;
  assert.equal(x.silent, true); assert.equal(hazardWord(x, t), 'не отвечает'); assert.equal(secTone(lost), 'warn');
  assert.equal(hazardWord(s.hazards.find(h => h.id.includes('bath'))!, t), 'сухо');
});
test('smoke and carbon monoxide have their own words, not «Утечка газа!»', () => {
  const s = readSecurity(house({}, [['binary_sensor.hall_smoke', 'hall', 'on', { device_class: 'smoke', friendly_name: 'Прихожая · Датчик дыма' }], ['binary_sensor.kitchen_co', 'kitchen', 'off', { device_class: 'carbon_monoxide', friendly_name: 'Кухня · Датчик CO' }]]))!;
  assert.equal(stateWord(s, t), 'Дым!'); assert.equal(secTone(s), 'alarm'); assert.match(sentence(s, t, 1, false), /^Прихожая\. /);
  assert.equal(hazardName(s.hazards.find(h => h.what === 'co')!, t), 'Угарный газ'); assert.equal(hazardName(s.hazards.find(h => h.what === 'gas')!, t), 'Газ');
});
test('the countdown reads «1:00», never «0:60», and «0:01» for the last second', () => {
  assert.equal(countdown(59.6), '1:00'); assert.equal(countdown(119.7), '2:00'); assert.equal(countdown(60), '1:00'); assert.equal(countdown(18.2), '0:19'); assert.equal(countdown(0.4), '0:01'); assert.equal(countdown(0), '0:00'); assert.equal(countdown(-3), '0:00');
});
test('the tile carries the entry delay in its one word, and the alarm states are announced', () => {
  const s = readSecurity(house({ 'alarm_control_panel.alarmo': 'pending', 'binary_sensor.hall_door_contact': 'on' }, [], { delay: 30 }))!;
  assert.equal(tileWord(s, t, 17.2), 'Вход\u00a00:18'); // a no-break space: the seconds never fall onto their own line assert.equal(tileWord(s, t), 'Вход');
  assert.match(announcement(s, t, 0, false), /^Вход — снимите охрану\. /);
  assert.equal(announcement(readSecurity(house())!, t, 1, false), ''); // a calm house announces nothing
  assert.match(announcement(readSecurity(house({ 'binary_sensor.bath_leak_water_leak': 'on' }))!, t, 1, false), /^Протечка!/);
  assert.match(announcement(readSecurity(house({ 'alarm_control_panel.alarmo': 'triggered' }))!, t, 1, false), /^Тревога!/);
});
test('opening the water always has a question; with a wet leak sensor it says so', () => {
  const dry = valveOpenAsk(readSecurity(house({ 'valve.bath_water': 'closed' }))!, t);
  assert.equal(dry.leak, false); assert.match(dry.text, /Вода пойдёт сразу/);
  const wet = valveOpenAsk(readSecurity(house({ 'valve.bath_water': 'closed', 'binary_sensor.bath_leak_water_leak': 'on' }))!, t);
  assert.equal(wet.leak, true); assert.match(wet.text, /^Сейчас протечка: Ванная\./); assert.match(wet.text, /Вода пойдёт сразу/);
});
test('the valve: the config names it; otherwise the one that says water, never just the first in HA\'s order', () => {
  const words = (id: string) => id;
  assert.equal(pickValve(['valve.garden_gas', 'valve.bath_water'], undefined, words), 'valve.bath_water');
  assert.equal(pickValve(['valve.a', 'valve.b'], 'valve.b', words), 'valve.b');
  assert.equal(pickValve(['valve.b', 'valve.a'], 'valve.gone', words), 'valve.a');
  assert.equal(pickValve([], undefined, words), undefined);
  const extra: Row[] = [['valve.a_radiator', 'kitchen', 'open', { friendly_name: 'Радиатор' }]];
  assert.equal(readSecurity(house({}, extra))!.valve!.id, 'valve.bath_water');
  const cfg = defaultConfig('Дом'); cfg.modules.security = { entities: { valve: 'valve.a_radiator' } };
  assert.equal(readSecurity(house({}, extra), cfg)!.valve!.id, 'valve.a_radiator');
});
