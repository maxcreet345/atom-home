// Release «classic» (ported from design 2026, phase 2): the house status strip (model/house-status.ts). Every kind, the order (danger before warning), the counting,
// the calm state, the place each item opens, and the words in three languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { houseStatus, batteryOf, KIND_ORDER, BATTERY_LOW, type StatusInput } from '../src/model/house-status.ts';
import { translator } from '../src/i18n/index.ts';
import type { HomeDevice, EntityRef } from '../src/model/discover.ts';
import type { Security, Guarded, Hazard } from '../src/model/security.ts';
import type { Heating, HeatRoom } from '../src/model/heating.ts';
import type { Vacuum } from '../src/model/vacuum.ts';

const ru = translator('ru'), en = translator('en'), ro = translator('ro');
const ref = (id: string, state: string, extra: Partial<EntityRef> = {}): EntityRef => ({ id, domain: id.split('.')[0], deviceClass: null, name: id, kind: null, state, attributes: {}, unit: null, available: state !== 'unavailable', lastChanged: '', ...extra });
const dev = (key: string, kind: HomeDevice['kind'], state: string, extra: Partial<HomeDevice> = {}): HomeDevice => ({ key, kind, name: key, roomId: 'kitchen', icon: null, photo: null, art: null, favorite: false, order: 0, enabled: true, available: state !== 'unavailable', primary: ref(key.replace(/^e:/, ''), state), controls: [], metrics: [], parameters: [], diagnostics: [], manufacturer: null, model: null, haDeviceId: null, section: null, ...extra });
const ROOMS: Record<string, string> = { kitchen: 'Кухня', bath: 'Ванная', kids: 'Детская' };
const input = (x: Partial<StatusInput> = {}): StatusInput => ({ online: true, security: null, heating: null, vacuum: null, devices: [], nameOf: d => d.name, roomName: id => ROOMS[id] ?? id, ...x });
const info = { level: null, low: false, signal: null, maker: 'zigbee' as const, model: null };
const guarded = (id: string, room: string, open: boolean | null, extra: Partial<Guarded> = {}): Guarded => ({ id, name: 'Окно', room, kind: 'window', open, since: null, tamper: false, bypassed: false, ...info, ...extra });
const hazard = (id: string, what: Hazard['what'], room: string, alarm: boolean | null, extra: Partial<Hazard> = {}): Hazard => ({ id, name: id, room, spot: null, kind: what === 'leak' ? 'leak' : 'gas', what, alarm, silent: alarm === null && !!extra.silent, since: null, ...info, ...extra });
const security = (state: Security['alarm']['state'], guardedList: Guarded[] = [], hazards: Hazard[] = []): Security => ({ alarm: { id: 'alarm_control_panel.alarmo', state, since: null, arming: null, bypassed: [], changedBy: null, delayEnds: null }, guests: null, vacation: null, guarded: guardedList, hazards, valve: null, exercise: null, loads: [] });
const room = (key: string, name: string, extra: Partial<HeatRoom> = {}): HeatRoom => ({ key, areaId: key, name, trv: `climate.${key}_trv`, current: 20, target: 21, action: 'idle', available: true, battery: 80, windows: [], windowPaused: false, override: null, manual: null, desired: null, sensor: 'room', ...extra });
const heating = (rooms: HeatRoom[], extra: Partial<Heating> = {}): Heating => ({ system: true, systemKnown: true, scenarioKnown: true, thermostat: 'climate.house', thermostatOnline: true, mode: 'auto', scenario: 'home', scenarioRaw: 'Дома', target: 21, temps: { home: 21, sleep: 19, away: 17, eco: 18, vacation: 12 }, sleep: { from: '23:00', to: '07:00' }, guests: false, eco: false, vacation: false, vacationReturn: null, vacationReturnId: null, scenarioOverride: false, hyst: null, security: null, rooms, boiler: { online: true, flame: false, flow: 40, flowTarget: 45, ret: 35, dhw: null, dhwTarget: null, pressure: 1.4, relay: false, state: null, pressureLow: false, pressureHigh: false }, outdoor: { temp: 5, state: null }, ...extra });
const vacuum = (extra: Partial<Vacuum> = {}): Vacuum => ({ entity: 'vacuum.robot', name: 'Робот', model: null, available: true, phase: 'docked', status: null, battery: 90, charging: false, progress: null, cleanMinutes: null, cleanArea: null, currentRoom: null, error: null, dockError: null, fan: null, fans: [], cleaningMode: null, mopMode: null, mopIntensity: null, emptyMode: null, map: null, mapImage: null, rooms: [], unlinked: [], last: { begin: null, end: null }, total: { hours: null, area: null, count: null }, consumables: [], dock: { present: true, cleanEmpty: false, dirtyFull: false, fluidEmpty: false, dryingLeft: null, dustEmptying: null, mopWashing: null, mopDrying: null, childLock: null }, robot: { waterShortage: false, mopAttached: null, waterBox: null }, dnd: { sw: null, from: null, to: null }, offPeak: { sw: null, from: null, to: null }, volume: null, routines: [], ...extra });
const kinds = (s: ReturnType<typeof houseStatus>) => s.items.map(i => i.kind);

test('a calm house: «Всё в порядке», tone ok, no items — in three languages', () => {
  const calm = input({ security: security('disarmed', [guarded('w1', 'Кухня', false)], [hazard('l1', 'leak', 'Ванная', false)]), heating: heating([room('kitchen', 'Кухня')]), vacuum: vacuum(), devices: [dev('e:light.a', 'light', 'off'), dev('e:binary_sensor.leak', 'leak', 'off')] });
  for (const [t, word] of [[ru, 'Всё в порядке'], [en, 'All is well'], [ro, 'Totul e în regulă']] as const) { const s = houseStatus(calm, t); assert.equal(s.tone, 'ok'); assert.equal(s.title, word); assert.deepEqual(s.items, []); }
});

test('a leak sensor that has not reported yet (unknown) is calm — decided: «ждёт первого срабатывания»', () => {
  const s = houseStatus(input({ security: security('disarmed', [], [hazard('l1', 'leak', 'Склад', null)]), devices: [dev('e:binary_sensor.storage_leak', 'leak', 'unknown')] }), ru);
  assert.equal(s.tone, 'ok'); assert.deepEqual(s.items, []);
});

test('the alarm, the entry delay, gas, smoke, CO and water are danger and open «Безопасность»', () => {
  const trig = houseStatus(input({ security: security('triggered', [guarded('w1', 'Детская', true)]) }), ru);
  assert.deepEqual(kinds(trig), ['alarm']); assert.equal(trig.items[0].text, 'Тревога · Детская'); assert.equal(trig.tone, 'danger'); assert.deepEqual(trig.items[0].place, { section: 'security' });
  assert.equal(houseStatus(input({ security: security('triggered') }), ru).items[0].text, 'Тревога');
  const entry = houseStatus(input({ security: security('pending') }), en); assert.deepEqual(kinds(entry), ['entry']); assert.equal(entry.items[0].text, 'Entry: disarm now');
  const haz = houseStatus(input({ security: security('disarmed', [], [hazard('g', 'gas', 'Кухня', true), hazard('s', 'smoke', 'Кухня', true), hazard('c', 'co', 'Котельная', true), hazard('l1', 'leak', 'Ванная', true), hazard('l2', 'leak', 'Кухня', true)]) }), ru);
  assert.deepEqual(kinds(haz), ['gas', 'smoke', 'co', 'leak']); assert.ok(haz.items.every(i => i.tone === 'danger'));
  assert.equal(haz.items[0].text, 'Газ · Кухня'); assert.equal(haz.items[3].text, 'Протечка: 2 места'); assert.equal(haz.items[3].count, 2);
  assert.equal(houseStatus(input({ security: security('disarmed', [], [hazard('l1', 'leak', 'Ванная', true)]) }), ro).items[0].text, 'Scurgere · Ванная');
});

test('without a security model the house\'s own leak and gas sensors still count, and open «Устройства → Внимание»', () => {
  const s = houseStatus(input({ devices: [dev('e:binary_sensor.leak', 'leak', 'on', { roomId: 'bath' }), dev('e:binary_sensor.gas', 'alarm', 'on', { primary: ref('binary_sensor.gas', 'on', { deviceClass: 'gas' }) })] }), ru);
  assert.deepEqual(kinds(s), ['gas', 'leak']); assert.equal(s.items[1].text, 'Протечка · Ванная'); assert.deepEqual(s.items[1].place, { section: 'systems', filter: 'attention' });
});

test('the house out of reach is danger and opens nothing', () => {
  const s = houseStatus(input({ online: false }), ru);
  assert.deepEqual(kinds(s), ['offline']); assert.equal(s.tone, 'danger'); assert.equal(s.items[0].place, null); assert.equal(s.items[0].text, 'Нет связи с домом');
});

test('a window open while the heating works is a warning that opens «Климат»; one room by name, several counted', () => {
  const one = houseStatus(input({ heating: heating([room('kitchen', 'Кухня', { windows: [{ id: 'w', name: 'Окно', open: true, known: true, since: null }] }), room('kids', 'Детская')]) }), ru);
  assert.deepEqual(kinds(one), ['window']); assert.equal(one.tone, 'warn'); assert.equal(one.items[0].text, 'Окно открыто, батарея ждёт · Кухня'); assert.deepEqual(one.items[0].place, { section: 'climate' });
  const two = houseStatus(input({ heating: heating([room('kitchen', 'Кухня', { windows: [{ id: 'w', name: 'Окно', open: true, known: true, since: null }] }), room('kids', 'Детская', { windows: [{ id: 'w2', name: 'Окно', open: true, known: true, since: null }] })]) }), en);
  assert.equal(two.items[0].text, 'Windows open, radiators wait: 2');
  // the heating switched off: an open window is nobody's business here
  assert.deepEqual(kinds(houseStatus(input({ heating: heating([room('kitchen', 'Кухня', { windows: [{ id: 'w', name: 'Окно', open: true, known: true, since: null }] })], { system: false }) }), ru)), []);
});

test('open while guarded, the boiler pressure, the heating\'s own links', () => {
  const armed = houseStatus(input({ security: security('away', [guarded('w1', 'Кухня', true), guarded('w2', 'Детская', true, { bypassed: true })]) }), ru);
  assert.deepEqual(kinds(armed), ['armedOpen']); assert.equal(armed.items[0].text, 'Открыто при охране · Кухня');
  const low = heating([room('kitchen', 'Кухня')]); low.boiler = { ...low.boiler, pressure: 0.7, pressureLow: true };
  assert.deepEqual(kinds(houseStatus(input({ heating: low }), ru)), ['pressure']);
  assert.deepEqual(kinds(houseStatus(input({ boiler: { pressure: 0.8 } }), ru)), ['pressure']); // the eBUS module in a house without the heating model
  assert.deepEqual(houseStatus(input({ boiler: { pressure: 0.8 } }), ru).items[0].place, { section: 'climate' }); // …where the classic look shows its card («Климат»)
  assert.deepEqual(kinds(houseStatus(input({ boiler: { pressure: 1.2 } }), ru)), []);
  const lost = houseStatus(input({ heating: heating([room('kitchen', 'Кухня', { action: 'offline', available: false })]), devices: [dev('e:climate.kitchen_trv', 'climate', 'unavailable')] }), ru);
  assert.deepEqual(kinds(lost), ['heating'], 'the head is told once, by the heating — not again as a device without link'); assert.equal(lost.items[0].text, 'Отопление · Кухня: нет связи');
});

test('devices without link: only those a person relies on, grouped; one opens its sheet, several the «Внимание» filter', () => {
  const one = houseStatus(input({ devices: [dev('e:camera.door', 'camera', 'unavailable', { name: 'Камера у входа' }), dev('e:sensor.t', 'environment', 'unavailable'), dev('e:media_player.tv', 'media', 'unavailable')] }), ru); // a thermometer and a TV switched off at the wall are not on the strip
  assert.deepEqual(kinds(one), ['nolink']); assert.equal(one.items[0].text, 'Камера у входа: нет связи'); assert.deepEqual(one.items[0].place, { section: 'systems', device: 'e:camera.door' });
  const three = houseStatus(input({ devices: ['light', 'socket', 'leak'].map((k, i) => dev(`e:x.${i}`, k as HomeDevice['kind'], 'unavailable')) }), ru);
  assert.equal(three.items[0].text, '3 устройства без связи'); assert.equal(three.items[0].count, 3); assert.deepEqual(three.items[0].place, { section: 'systems', filter: 'attention' });
  assert.equal(houseStatus(input({ devices: Array.from({ length: 5 }, (_, i) => dev(`e:x.${i}`, 'light', 'unavailable')) }), ru).items[0].text, '5 устройств без связи');
  assert.equal(houseStatus(input({ devices: Array.from({ length: 21 }, (_, i) => dev(`e:x.${i}`, 'light', 'unavailable')) }), ru).items[0].text, '21 устройство без связи');
  assert.equal(houseStatus(input({ devices: ['light', 'socket'].map((k, i) => dev(`e:x.${i}`, k as HomeDevice['kind'], 'unavailable')) }), en).items[0].text, '2 devices without connection');
  assert.equal(houseStatus(input({ devices: ['light', 'socket'].map((k, i) => dev(`e:x.${i}`, k as HomeDevice['kind'], 'unavailable')) }), ro).items[0].text, '2 dispozitive fără legătură');
});

test('batteries: a percentage at or under the line, a «low» flag, a radiator head; a device that does not answer has no battery to tell', () => {
  const pct = (v: string) => dev('e:binary_sensor.window', 'opening', 'off', { name: 'Окно кухни', diagnostics: [ref('sensor.window_battery', v, { deviceClass: 'battery' })] });
  assert.deepEqual(batteryOf(pct('12')), { low: true, level: 12 }); assert.deepEqual(batteryOf(pct(String(BATTERY_LOW + 1))), { low: false, level: BATTERY_LOW + 1 });
  const s = houseStatus(input({ devices: [pct('9')] }), ru); assert.deepEqual(kinds(s), ['battery']); assert.equal(s.items[0].text, 'Окно кухни: садится батарея'); assert.deepEqual(s.items[0].place, { section: 'systems', device: 'e:binary_sensor.window' });
  const flag = dev('e:binary_sensor.door', 'opening', 'off', { diagnostics: [ref('binary_sensor.door_battery', 'on', { deviceClass: 'battery' })] });
  const trv = heating([room('kids', 'Детская', { battery: 7 })]);
  const many = houseStatus(input({ devices: [pct('9'), flag], heating: trv }), ru); assert.equal(many.items[0].text, 'Садятся батареи: 3');
  assert.deepEqual(kinds(houseStatus(input({ devices: [dev('e:binary_sensor.window', 'opening', 'unavailable', { diagnostics: [ref('sensor.window_battery', '3', { deviceClass: 'battery' })] })] }), ru)), ['nolink']);
  assert.deepEqual(kinds(houseStatus(input({ devices: [dev('e:sensor.phone', 'measurement', '1', { diagnostics: [ref('sensor.phone_battery', '5', { deviceClass: 'battery' })] })] }), ru)), [], 'a phone\'s battery is not the house\'s');
});

test('the robot vacuum: an error, a tank or a part due — one item, the worst named first', () => {
  assert.deepEqual(kinds(houseStatus(input({ vacuum: vacuum({ phase: 'error', error: 'stuck' }) }), ru)), ['vacuum']);
  const care = houseStatus(input({ vacuum: vacuum({ dock: { ...vacuum().dock, dirtyFull: true }, consumables: [{ key: 'filter', left: 3, total: 150, reset: null }] }) }), ru);
  assert.deepEqual(kinds(care), ['consumable']); assert.equal(care.items[0].text, 'Пылесос: бак грязной воды полон и ещё 1'); assert.deepEqual(care.items[0].place, { section: 'cleaning' });
  assert.equal(houseStatus(input({ vacuum: vacuum({ consumables: [{ key: 'filter', left: 3, total: 150, reset: null }] }) }), ru).items[0].text, 'Пылесос: пора менять: фильтр');
  assert.deepEqual(kinds(houseStatus(input({ vacuum: vacuum({ phase: 'offline', available: false }) }), ru)), [], 'a robot without link is told as a device without link');
});

test('the order: danger before warning, then the fixed order of kinds; the count is the number of items', () => {
  const s = houseStatus(input({ online: false, security: security('away', [guarded('w1', 'Кухня', true)], [hazard('l1', 'leak', 'Ванная', true)]), devices: [dev('e:camera.door', 'camera', 'unavailable')], vacuum: vacuum({ phase: 'error' }) }), ru);
  assert.deepEqual(kinds(s), ['leak', 'offline', 'armedOpen', 'nolink', 'vacuum']);
  assert.equal(s.tone, 'danger'); assert.equal(s.title, 'Нужно внимание: 5');
  assert.equal(houseStatus(input({ devices: [dev('e:camera.door', 'camera', 'unavailable')] }), en).title, 'Needs attention: 1');
  assert.equal(houseStatus(input({ devices: [dev('e:camera.door', 'camera', 'unavailable')] }), ro).title, 'Necesită atenție: 1');
  const order = [...KIND_ORDER]; assert.ok(order.indexOf('offline') < order.indexOf('armedOpen') && order.indexOf('alarm') === 0);
});

test('a chip never leads to a page the house does not have', () => {
  const s = houseStatus(input({ pages: new Set(['climate']), security: security('triggered'), vacuum: vacuum({ phase: 'error' }) }), ru);
  assert.deepEqual(s.items.map(i => i.place), [{ section: 'systems', filter: 'attention' }, { section: 'systems', filter: 'attention' }]);
});

test('every status word exists in ru, en and ro and none is left as its key', () => {
  for (const t of [ru, en, ro]) for (const k of ['ok', 'attention', 'alarm', 'alarmAt', 'entry', 'gasAt', 'gasN', 'smokeAt', 'smokeN', 'coAt', 'coN', 'leakAt', 'leakN', 'offline', 'armedOpen', 'armedOpenN', 'windowAt', 'windowN', 'pressure', 'heating', 'heatingAt', 'nolink1', 'nolinkN', 'battery1', 'batteryN', 'trv', 'vacError', 'vacCare', 'vacCareN']) {
    const v = t(`status.${k}` as never, { n: 2, room: 'X', name: 'Y', what: 'Z' }); assert.ok(v && !v.startsWith('status.'), `${k}: ${v}`);
  }
});
