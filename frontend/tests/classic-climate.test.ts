// Release «classic», step 4, climate and security: the logic fixes of design-2026 pass 3 ported onto the classic code. Each test names the item
// it guards (CODEX-011, ST-06, ST-05, CODEX-010, CODEX-002); each fails on the classic code before the port (it cannot even import the new
// names, and with each fixed line reverted alone in a scratch copy the test of that line fails). The UI halves (the switch that cannot be pressed,
// the question's focus, the device rows) are checked in scripts/qa-security.mjs and scripts/qa-heating.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readHeating, returnDay, NO_RETURN_DAY } from '../src/model/heating.ts';
import { heatingActions } from '../src/model/heating-act.ts';
import { readSecurity, questionStands } from '../src/model/security.ts';
import { readOfficeSecurity, osecTone, osecSilent, osecSentence, osecDevicesWord, osecArmWarning, osecDisarmAsks, osecAskStands, type OfficeSecurity } from '../src/model/office-security.ts';
import { defaultConfig } from '../src/model/config.ts';
import { translator } from '../src/i18n/index.ts';
import type { Registry } from '../src/model/registry.ts';

const t = translator('ru');
// ---- the heating, as HA had it on 09.11.2026 (the snapshot tests/heating.test.ts reads)
const live = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-heating-20261109.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-09T08:00:00Z');
function heatHouse(over: Record<string, [string, Record<string, unknown>?]> = {}): Registry {
  const states: Registry['states'] = structuredClone(live.states);
  for (const [id, [state, attrs]] of Object.entries(over)) states[id] = { state, attributes: { ...(states[id]?.attributes ?? {}), ...(attrs ?? {}) }, last_changed: new Date(NOW - 5 * 60000).toISOString(), last_updated: '' };
  return { areas: [['gostinaia', 'Гостиная'], ['kukhnia', 'Кухня'], ['spalnia', 'Спальня'], ['detskaia', 'Детская'], ['kompiuternaia', 'Компьютерная']].map(([area_id, name]) => ({ area_id, name })), devices: live.devices, entities: live.entities, states } as unknown as Registry;
}
type Call = [string, string, Record<string, unknown>];
const recorder = (refuse?: (d: string, s: string) => boolean) => { const calls: Call[] = []; return { calls, host: { call: async (d: string, s: string, data: Record<string, unknown>) => { calls.push([d, s, data]); if (refuse?.(d, s)) throw { code: 'home_assistant_error', message: 'нет' }; } } }; };
const SEC = { 'alarm_control_panel.alarmo': ['disarmed', { supported_features: 43 }] as [string, Record<string, unknown>] };
const FUTURE = { 'input_datetime.heating_vacation_return': ['2026-11-23 00:00:00'] as [string] }; // an earlier plan's date, still ahead

test('CODEX-011 heating: «Отпуск» with the date emptied writes the house\'s «no date» before switching on, never leaves the earlier plan\'s date', async () => {
  const h = readHeating(heatHouse({ ...SEC, ...FUTURE }), NOW)!; assert.equal(h.vacationReturn, '2026-11-23');
  for (const back of [null, undefined, '']) { const r = recorder(); await heatingActions(h, r.host).vacation(true, back);
    assert.deepEqual(r.calls, [['input_datetime', 'set_datetime', { entity_id: 'input_datetime.heating_vacation_return', datetime: `${NO_RETURN_DAY} 00:00:00` }], ['alarm_control_panel', 'alarm_arm_vacation', { entity_id: 'alarm_control_panel.alarmo' }]], String(back)); }
  assert.equal(NO_RETURN_DAY, '2099-12-31');
  // a date that was typed is written as it is
  const r = recorder(); await heatingActions(h, r.host).vacation(true, '2026-12-02'); assert.equal(r.calls[0][2].datetime, '2026-12-02 00:00:00');
  // without the security's «Отпуск» the heating's own switch follows the same order
  const own = readHeating(heatHouse(FUTURE), NOW)!, o = recorder(); await heatingActions(own, o.host).vacation(true, null);
  assert.deepEqual(o.calls.map(c => `${c[0]}.${c[1]}:${String(c[2].datetime ?? c[2].entity_id)}`), [`input_datetime.set_datetime:${NO_RETURN_DAY} 00:00:00`, 'input_boolean.turn_on:input_boolean.heating_vacation']);
  // a house without the return date's helper writes no date at all
  const bare = heatHouse(SEC); delete (bare.states as Record<string, unknown>)['input_datetime.heating_vacation_return'];
  const b = recorder(); await heatingActions(readHeating(bare, NOW)!, b.host).vacation(true, null); assert.deepEqual(b.calls.map(c => c[1]), ['alarm_arm_vacation']);
});
test('CODEX-011 heating: a refused write of the date leaves «Отпуск» off; switching off writes no date', async () => {
  const h = readHeating(heatHouse({ ...SEC, ...FUTURE }), NOW)!, r = recorder((d, s) => d === 'input_datetime' && s === 'set_datetime');
  await assert.rejects(heatingActions(h, r.host).vacation(true, null)); assert.deepEqual(r.calls.map(c => c[1]), ['set_datetime']);
  const off = readHeating(heatHouse({ 'alarm_control_panel.alarmo': ['armed_vacation', { supported_features: 43 }], ...FUTURE }), NOW)!, x = recorder();
  await heatingActions(off, x.host).vacation(false); assert.deepEqual(x.calls.map(c => c[1]), ['alarm_disarm']);
});
test('CODEX-011: the house\'s «no date» is read back as no date by the heating and by the security, a real date as itself', () => {
  assert.equal(readHeating(heatHouse({ 'input_datetime.heating_vacation_return': [`${NO_RETURN_DAY} 00:00:00`] }), NOW)!.vacationReturn, null);
  assert.equal(readHeating(heatHouse({ 'input_datetime.heating_vacation_return': ['2100-01-01 00:00:00'] }), NOW)!.vacationReturn, null);
  assert.equal(readHeating(heatHouse(FUTURE), NOW)!.vacationReturn, '2026-11-23');
  assert.equal(returnDay(`${NO_RETURN_DAY} 00:00:00`, '2026-11-09'), null); assert.equal(returnDay('2098-12-31 00:00:00', '2026-11-09'), '2098-12-31');
  assert.equal(returnDay('2026-11-08 00:00:00', '2026-11-09'), null); assert.equal(returnDay('unknown', '2026-11-09'), null); assert.equal(returnDay(undefined, '2026-11-09'), null);
  const sec = (v: string) => readSecurity(house({ 'input_datetime.heating_vacation_return': v }), undefined, NOW)!.vacation!;
  assert.equal(sec(`${NO_RETURN_DAY} 00:00:00`).to, null); assert.equal(sec('2026-11-23 00:00:00').to, '2026-11-23'); assert.equal(sec(`${NO_RETURN_DAY} 00:00:00`).toId, 'input_datetime.heating_vacation_return');
  assert.equal(sec('2026-11-03 00:00:00').to, null); assert.equal(sec('unavailable').to, null);
});

// ---- the house's security (the rows of tests/security.test.ts)
type Row = [id: string, area: string | null, state: string, attrs?: Record<string, unknown>, platform?: string];
const BASE: Row[] = [
  ['alarm_control_panel.alarmo', null, 'disarmed', { bypassed_sensors: [], supported_features: 63 }, 'alarmo'],
  ['binary_sensor.hall_door_contact', 'hall', 'off', { device_class: 'door', friendly_name: 'Входная дверь' }],
  ['binary_sensor.kids_window_contact', 'kids', 'off', { device_class: 'window', friendly_name: 'Детская · Окно' }],
  ['binary_sensor.kitchen_gas', 'kitchen', 'off', { device_class: 'gas', friendly_name: 'Кухня · Датчик газа' }],
  ['input_datetime.heating_vacation_return', null, '2026-11-03 00:00:00', {}],
];
const AREAS = [['hall', 'Прихожая'], ['kids', 'Детская'], ['kitchen', 'Кухня']];
function house(over: Record<string, string> = {}): Registry {
  return {
    areas: AREAS.map(([area_id, name]) => ({ area_id, name })), devices: [],
    entities: BASE.map(([entity_id, area_id, , , platform]) => ({ entity_id, device_id: null, area_id, name: null, original_name: null, platform: platform ?? 'mqtt', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(BASE.map(([id, , state, attrs]) => [id, { state: over[id] ?? state, attributes: { ...(attrs ?? {}) }, last_changed: new Date(NOW - 10000).toISOString(), last_updated: '' }])),
  } as unknown as Registry;
}
const A = 'alarm_control_panel.alarmo';
test('ST-06: with the alarm panel unknown or unavailable the «Отпуск» question does not stand (it is withdrawn); with it back, it does', () => {
  for (const st of ['unknown', 'unavailable']) { const s = readSecurity(house({ [A]: st }), undefined, NOW)!; assert.equal(s.alarm.state, 'unknown'); assert.equal(questionStands('vacOn', s), false, st); }
  assert.equal(questionStands('vacOn', readSecurity(house(), undefined, NOW)!), true);
  // the others as before: «Гости» and the valve are not this Alarmo's; «Отпуск» off still stands while it is on
  assert.equal(questionStands('vacOff', readSecurity(house({ [A]: 'armed_vacation' }), undefined, NOW)!), true);
});
test('ST-05: the three notes of a silent boiler are said in three languages, and none of them promises a working boiler', () => {
  for (const lang of ['ru', 'en', 'ro'] as const) { const tt = translator(lang);
    const notes = ['offlineRelayUnknown', 'offlineRelayOn', 'offlineRelayOff'].map(k => tt(`module.heat.b.${k}` as Parameters<typeof tt>[0]));
    assert.equal(new Set(notes).size, 3, lang); assert.ok(notes.every(n => n && !n.startsWith('module.')), lang);
    assert.ok(!notes.some(n => /работает: реле|still works|merge: releul|eBUS/i.test(n)), lang); }
  assert.equal(t('module.heat.b.offlineRelayOn' as Parameters<typeof t>[0]), 'Нет данных от котла. Реле запрашивает тепло; работа горелки не подтверждена.');
  assert.equal(t('module.heat.b.offlineRelayOff' as Parameters<typeof t>[0]), 'Нет данных от котла. Реле не запрашивает тепло.');
  assert.equal(t('module.heat.b.offlineRelayUnknown' as Parameters<typeof t>[0]), 'Нет данных от котла и реле. Работа отопления не подтверждена.');
});

// ---- the office (Atom + Okapi): the master, two zones, a door with its tamper, glass break and link; a Zigbee door whose case switch never reported
const ORows: Array<[id: string, state: string, area: string | null, attrs: Record<string, unknown>, device: string | null, cat?: string]> = [
  ['alarm_control_panel.master', 'disarmed', null, { friendly_name: 'Alarmo Master' }, null],
  ['alarm_control_panel.front', 'disarmed', 'front', { friendly_name: 'Alarmo Вход' }, null],
  ['alarm_control_panel.back', 'disarmed', 'back', { friendly_name: 'Alarmo Склад' }, null],
  ['binary_sensor.door', 'off', 'front', { device_class: 'door' }, 'door'],
  ['binary_sensor.door_case_tamper', 'off', 'front', { device_class: 'tamper' }, 'door'],
  ['binary_sensor.door_glass_break', 'off', 'front', { device_class: 'safety' }, 'door'],
  ['binary_sensor.door_connectivity', 'on', 'front', { device_class: 'connectivity' }, 'door', 'diagnostic'],
  ['binary_sensor.zig_contact', 'off', 'back', { device_class: 'door' }, 'zig'],
  ['binary_sensor.zig_tamper', 'unknown', 'back', { device_class: 'tamper' }, 'zig'],
];
function office(over: Record<string, string> = {}): OfficeSecurity {
  const reg = {
    areas: [{ area_id: 'front', name: 'Вход', floor_id: 'f' }, { area_id: 'back', name: 'Склад', floor_id: 'f' }],
    devices: [{ id: 'door', name: 'Входная дверь', area_id: 'front', manufacturer: 'Ajax', model: 'DoorProtect' }, { id: 'zig', name: 'Дверь склада', area_id: 'back', manufacturer: 'Tuya', model: 'Contact' }],
    entities: ORows.map(([entity_id, , area_id, , device_id, cat]) => ({ entity_id, area_id, device_id, platform: entity_id.startsWith('alarm_control_panel.') ? 'alarmo' : 'ajax', disabled_by: null, hidden_by: null, entity_category: cat ?? null, labels: [] })),
    states: Object.fromEntries(ORows.map(([id, state, , attributes]) => [id, { state: over[id] ?? state, attributes, last_changed: new Date(NOW - 60000).toISOString(), last_updated: '' }])),
  } as unknown as Registry;
  const s = readOfficeSecurity(reg, defaultConfig('Офис'), { id: 'admin', admin: true }); assert.ok(s); return s!;
}
const all = (s: OfficeSecurity) => s.rooms.flatMap(r => r.items);
test('CODEX-010: a door sensor that does not answer is never «Двери и окна закрыты» / calm — the tone, the sentence, the list and arming say it', () => {
  const calm = office(); assert.equal(osecTone(calm), 'calm'); assert.equal(osecSentence(calm, t), 'Двери и окна закрыты'); assert.equal(osecDevicesWord(calm, t), 'всё закрыто'); assert.equal(osecArmWarning(calm, t), null);
  for (const st of ['unavailable', 'unknown']) {
    const s = office({ 'binary_sensor.door': st }), door = all(s).find(i => i.id === 'binary_sensor.door')!;
    assert.equal(door.on, null); assert.equal(door.quiet, true, st); assert.deepEqual(osecSilent(s).map(i => i.id), ['binary_sensor.door']);
    assert.equal(osecTone(s), 'warn', st); assert.equal(osecSentence(s, t), 'Не отвечает: Входная дверь', st);
    assert.equal(osecDevicesWord(s, t), 'не отвечают: 1'); assert.match(osecArmWarning(s, t) ?? '', /^Не отвечает: Входная дверь\. Охрана его не увидит\. Поставить всё равно\?$/);
  }
  // armed: never «Всё закрыто, здание под охраной» with a lost sensor
  const armed = office({ 'alarm_control_panel.master': 'armed_away', 'binary_sensor.door': 'unavailable' });
  assert.equal(osecTone(armed), 'warn'); assert.equal(osecSentence(armed, t), 'Не отвечает: Входная дверь');
  assert.equal(osecSentence(office({ 'alarm_control_panel.master': 'armed_away' }), t), 'Всё закрыто, здание под охраной');
  // an open door still comes first in the list's heading, with the silent one beside it
  assert.equal(osecDevicesWord(office({ 'binary_sensor.door': 'unavailable', 'binary_sensor.zig_contact': 'on' }), t), 'открыто: 1 · не отвечают: 1');
});
test('CODEX-010: an unavailable glass break, case switch or link is not «норма» and makes the building amber; a part that only never reported says «Нет данных»', () => {
  for (const id of ['binary_sensor.door_glass_break', 'binary_sensor.door_case_tamper', 'binary_sensor.door_connectivity']) {
    const s = office({ [id]: 'unavailable' }), door = all(s).find(i => i.id === 'binary_sensor.door')!;
    assert.equal(door.quiet, true, id); assert.equal(osecTone(s), 'warn', id); assert.notEqual(osecSentence(s, t), 'Двери и окна закрыты', id);
    assert.equal(door.nodata.length, 1, id); }
  const glass = all(office({ 'binary_sensor.door_glass_break': 'unknown' })).find(i => i.id === 'binary_sensor.door')!;
  assert.deepEqual(glass.nodata, ['glass']); assert.equal(glass.glass, false);
  // the building's two Zigbee doors whose case switch has never reported (09.11.2026): «Нет данных» in its card, the building stays calm
  const z = all(office()).find(i => i.id === 'binary_sensor.zig_contact')!;
  assert.deepEqual(z.nodata, ['tamper']); assert.equal(z.quiet, false); assert.equal(z.tamper, false);
});
test('CODEX-002: «С охраны» asks in every armed state; one tap only cancels an arming that has not finished; a question whose ground is gone is withdrawn', () => {
  for (const st of ['armed_away', 'armed_home', 'pending', 'triggered']) assert.equal(osecDisarmAsks(office({ 'alarm_control_panel.master': st })), true, st);
  assert.equal(osecDisarmAsks(office({ 'alarm_control_panel.master': 'arming' })), false);
  assert.equal(osecAskStands('disarm', office({ 'alarm_control_panel.master': 'armed_away' })), true);
  assert.equal(osecAskStands('disarm', office()), false); // disarmed from Ajax meanwhile
  assert.equal(osecAskStands('disarm', office({ 'alarm_control_panel.master': 'arming' })), false);
  assert.equal(osecAskStands('arm', office()), true); assert.equal(osecAskStands('arm', office({ 'alarm_control_panel.master': 'arming' })), false);
  // the question's words exist in three languages
  for (const lang of ['ru', 'en', 'ro'] as const) { const w = translator(lang)('osec.ask.disarm' as Parameters<typeof t>[0]); assert.ok(w && w !== 'osec.ask.disarm' && w.endsWith('?'), lang); }
});
