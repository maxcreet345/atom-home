// 1.27.0: an appliance Home Assistant knows only through switches opens ITSELF — its power — never the sheet of one of its settings switches
// (review of the mock, 11.11.2026: the humidifier opened «Звук уведомления»). On the house as HA showed it on 09.11 (the card preview's
// «rooms / live»): the humidifier, the air fryer, the washer, the dryer, the cat fountain — in «Устройства» and on their rooms' pages alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { discover } from '../src/model/discover.ts';
import { normaliseConfig } from '../src/model/config.ts';
import { activeSpecs, IMOU_ROLES } from '../src/modules/catalog.ts';
import { cameraClaims } from '../src/modules/camera-state.ts';
import { doorbellClaims } from '../src/modules/doorbell-state.ts';
import { deviceVerdicts } from '../src/model/device-list.ts';
import { applianceDevices, powerSwitchOf, tapSwitchOf, APPLIANCE_PREFIX } from '../src/model/appliance.ts';
import { readRoom } from '../src/model/room.ts';
import { nameUnderRoom, bigReading, wattsText, stateText } from '../src/ui/format.ts';
import { translator } from '../src/i18n/index.ts';
import type { Registry } from '../src/model/registry.ts';
import type { HomeDevice } from '../src/model/discover.ts';

const fx = (f: string) => resolve(import.meta.dirname, '../../private/fixtures', f), configPath = resolve(import.meta.dirname, '../../../clients/criuleni/atom-home-config-20261028.json');
const have = existsSync(fx('criuleni-rooms-20261109.json')) && existsSync(fx('criuleni-registry-live-20261028.json')) && existsSync(configPath);
async function house() {
  // @ts-expect-error a plain .mjs scenario of the card preview
  const { card } = await import('../scripts/cards/rooms.mjs');
  const base = JSON.parse(readFileSync(fx('criuleni-registry-live-20261028.json'), 'utf8')), s = card.scenarios.live;
  const reg: Registry = card.build(base, s, new Date(Date.UTC(2026, 10, 11, 12))).snapshot, { config } = normaliseConfig(card.config(readFileSync(configPath, 'utf8'), s));
  const claims: Record<string, (e: Record<string, string | undefined>) => Array<string | undefined>> = {
    pet_feeder: e => [...Object.entries(e).filter(([k]) => k !== 'device' && k !== 'rest').map(([, v]) => v), ...(e.rest ?? '').split(',')], kettle: e => [e.heater, ...(e.rest ?? '').split(',')],
    camera_go2rtc: e => cameraClaims(e as never), doorbell: e => doorbellClaims(e as never), camera_imou: e => IMOU_ROLES.map(r => r.role).filter(r => r !== 'camera').map(r => e[r]),
    camera_onvif: e => [e.camera !== e.sd ? e.sd : undefined, e.camera2 !== e.sd2 ? e.sd2 : undefined, e.person, e.pet, e.vehicle, e.motion, e.motionCell, e.reboot, e.setTime],
  };
  const claimed = new Set(activeSpecs(reg, config).flatMap(a => (claims[a.spec.id]?.(a.entities as Record<string, string | undefined>) ?? []).filter((x): x is string => !!x)));
  const home = discover(reg, config, claimed), all = home.devices.filter(d => d.enabled), byId = new Map(reg.devices.map(d => [d.id, d as { name: string | null; name_by_user?: string | null }]));
  const verdicts = new Map(deviceVerdicts(all, { deviceName: id => byId.get(id)?.name_by_user ?? byId.get(id)?.name ?? null }).map(x => [x.device.key, x.verdict]));
  const roomName = (id: string) => home.rooms.find(r => r.id === id)?.name ?? '';
  return { reg, home, all, verdicts, roomName, apps: applianceDevices(all, verdicts, reg, roomName) };
}
// the settings of these appliances: none of them is ever what a tap opens
const SETTINGS = /buzzer|keep_warm|shake_reminder|child_lock|no_disturb|wrinkle|_run$/;

test('the five appliances of this house open themselves — their power — never a settings switch', { skip: !have && 'no 09.11 fixture' }, async () => {
  const { apps, all, verdicts } = await house(), find = (re: RegExp) => [...apps.values()].find(a => re.test(a.name));
  const want: Array<[RegExp, (a: HomeDevice) => boolean, string]> = [
    [/Увлажнитель воздуха/, a => a.primary.id === 'sensor.living_humidifier_plug_power', 'the humidifier: the power its plug measures'],
    [/Аэрогриль/, a => a.primary.id === 'sensor.kitchen_airfryer_meter_power', 'the air fryer: the power its meter measures'],
    [/Стиральная машина/, a => a.primary.id === 'switch.bath_washer_power' && a.kind === 'switch' && a.metrics.some(m => m.id === 'sensor.bath_washer_socket_power'), 'the washer: its «Питание», with its plug\'s power'],
    [/Сушильная машина/, a => a.primary.id === 'sensor.bath_dryer_socket_power' && a.kind === 'energy', 'the dryer: the power its plug measures (its «Работа» and «Защита от сминания» are settings)'],
    [/Поилка/, a => a.primary.id === 'switch.kitchen_cat_fountain_pump' && a.kind === 'switch', 'the fountain: its pump'],
  ];
  for (const [re, ok, what] of want) {
    const a = find(re); assert.ok(a, `${what}: found`);
    assert.ok(a!.key.startsWith(APPLIANCE_PREFIX), `${what}: its own key`);
    assert.ok(ok(a!), `${what} — opened ${a!.primary.id} (${a!.kind})`);
    assert.ok(!SETTINGS.test(a!.primary.id), `${what}: never a setting`);
    // its other switches are its settings: in the sheet's «Настройки» (an administrator's, behind a question), not lost
    const own = all.filter(d => d.haDeviceId === a!.haDeviceId && d.kind === 'switch' && d.primary.id !== a!.primary.id);
    for (const d of own) assert.ok(a!.parameters.some(p => p.id === d.primary.id), `${what}: ${d.primary.id} is among its settings`);
    // in «Устройства» its tile is the appliance: its first card is never what a tap switches; the appliance decides (next test)
    const lead = all.find(d => d.haDeviceId === a!.haDeviceId && verdicts.get(d.key)?.shown);
    assert.equal(verdicts.get(lead!.key)?.toggle, false, `${what}: its first card is not what a tap switches`);
  }
});

test('a tap on the tile switches the appliance\'s power switch, as 1.26.1 did; one without a power switch opens', { skip: !have && 'no 09.11 fixture' }, async () => {
  const { apps } = await house(), find = (re: RegExp) => [...apps.values()].find(a => re.test(a.name));
  // a tap switches exactly this (the preview's check in qa-nav.mjs sends it and nothing else)
  const switches: Array<[RegExp, string, string]> = [
    [/Вентилятор/, 'switch.bath_vent', 'the bath fan: the relay that runs it'],
    [/Стиральная машина/, 'switch.bath_washer_power', 'the washer: its «Питание»'],
    [/Поилка/, 'switch.kitchen_cat_fountain_pump', 'the fountain: its pump'],
  ];
  for (const [re, id, what] of switches) { const a = find(re); assert.ok(a, `${what}: found`); assert.equal(tapSwitchOf(a!)?.id, id, what); }
  // no switch of its own power: a tap opens it (its sheet shows the power; its switches are settings)
  for (const re of [/Увлажнитель воздуха/, /Аэрогриль/, /Сушильная машина/]) { const a = find(re); assert.ok(a, `${re}: found`); assert.equal(tapSwitchOf(a!), null, `${a!.name}: a tap opens it`); }
  for (const a of apps.values()) { const sw = tapSwitchOf(a); if (sw) assert.ok(!SETTINGS.test(sw.id), `${a.name}: a tap never flips a setting (${sw.id})`); }
});

test('the big number says the power in the panel\'s own units, as the tile does', () => {
  const ru = translator('ru'), en = translator('en');
  const power = (state: string, unit = 'W') => ({ id: 'sensor.p', name: 'Мощность', domain: 'sensor', state, unit, deviceClass: 'power', available: true, attributes: {} }) as unknown as HomeDevice['primary'];
  assert.equal(bigReading(power('0'), ru, 'ru'), `0 ${ru('ep.unit.w')}`, 'the sheet says «0 Вт» in Russian, never HA\'s «0 W»');
  assert.equal(bigReading(power('0'), ru, 'ru'), wattsText(0, ru, 'ru'), 'the same words as the tile');
  assert.match(bigReading(power('2400'), ru, 'ru'), new RegExp(`^2,4 ${ru('ep.unit.kw')}$`), 'kW the same way');
  assert.match(bigReading(power('1.5', 'kW'), en, 'en'), /^1\.5 kW$/);
  const silent = { ...power('unavailable'), available: false }; assert.equal(bigReading(silent, ru, 'ru'), stateText(silent, ru, 'ru'), 'a silent meter says so, as everywhere');
});

test('on the room page the same appliance opens: its card is found by its HA device', { skip: !have && 'no 09.11 fixture' }, async () => {
  const { apps, reg, home, roomName } = await house();
  for (const a of apps.values()) {
    const m = readRoom(reg, a.roomId, roomName(a.roomId), null, null), th = [...m.things, ...m.air].find(t => t.key === a.haDeviceId);
    if (!th) continue; // a device the room page shows elsewhere (a module's card)
    assert.equal(apps.get(th.key)?.key, a.key, `${a.name}: the room's card opens the appliance`);
  }
  assert.ok(home.rooms.length > 5);
});

test('a power switch is told by its words or by being named as the device; a setting never is', () => {
  const card = (id: string, name: string) => ({ primary: { id, name } }) as HomeDevice;
  assert.equal(powerSwitchOf([card('switch.h_buzzer', 'Увлажнитель (X) Звук уведомления')], 'Увлажнитель (X)'), null);
  assert.equal(powerSwitchOf([card('switch.f_child_lock', 'Блокировка кнопок'), card('switch.f_pump', 'Насос')], 'Поилка')?.primary.id, 'switch.f_pump');
  assert.equal(powerSwitchOf([card('switch.w', 'Ванная · Стиральная машина (LG) Питание')], 'Ванная · Стиральная машина (LG)')?.primary.id, 'switch.w');
  assert.equal(powerSwitchOf([card('switch.v', 'Ванная · Вентилятор (Tuya TS000F) Ванная · Вентилятор')], 'Ванная · Вентилятор (Tuya TS000F)')?.primary.id, 'switch.v', 'the relay is the fan');
  assert.equal(powerSwitchOf([card('switch.a_keep_warm', 'Аэрогриль Подогрев'), card('switch.a_shake', 'Аэрогриль Перемешивание')], 'Аэрогриль'), null);
});

test('under a room\'s header a name does not repeat the room', () => {
  assert.equal(nameUnderRoom('Ванная · Вентилятор', 'Ванная'), 'Вентилятор');
  assert.equal(nameUnderRoom('Гостиная · Увлажнитель воздуха', 'Гостиная'), 'Увлажнитель воздуха');
  assert.equal(nameUnderRoom('Кухня · Аэрогриль', 'кухня'), 'Аэрогриль', 'whatever the case');
  assert.equal(nameUnderRoom('Камера · Компьютерная', 'Компьютерная'), 'Камера', 'at its end too');
  assert.equal(nameUnderRoom('Кухня · Помпа кошки', 'Кухня'), 'Помпа кошки');
  assert.equal(nameUnderRoom('Зальная лампа', 'Зал'), 'Зальная лампа', 'only the room as a whole word');
  assert.equal(nameUnderRoom('Ванная', 'Ванная'), 'Ванная', 'never empty');
  assert.equal(nameUnderRoom('Свет', ''), 'Свет');
  assert.equal(nameUnderRoom('Склад · Вытяжка Склад · Вытяжка', 'Склад'), 'Вытяжка', 'HA\'s doubled name (device + entity) is said once');
  assert.equal(nameUnderRoom('Детская · Люстра Детская · Люстра', 'Детская'), 'Люстра');
  assert.equal(nameUnderRoom('Свет Кухня · Ночник', 'Кухня'), 'Свет Кухня · Ночник', 'two different things are not merged');
});
