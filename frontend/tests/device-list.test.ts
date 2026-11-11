// 1.27.0 «menu and rooms»: «Устройства» lists devices, not their sensors (owner, 11.11.2026). The rule (src/model/device-list.ts) on the
// house's own fixture and settings, as the preview server builds them (the feeder added the way the house has it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { discover, type HomeDevice } from '../src/model/discover.ts';
import { normaliseConfig, defaultConfig } from '../src/model/config.ts';
import { activeSpecs } from '../src/modules/catalog.ts';
import { cameraClaims } from '../src/modules/camera-state.ts';
import { doorbellClaims } from '../src/modules/doorbell-state.ts';
import { deviceVerdict, deviceVerdicts, listedDevices, relayIsAppliance, LIST_GROUPS, OPERATED_KINDS } from '../src/model/device-list.ts';
import type { Registry } from '../src/model/registry.ts';
import type { Kind } from '../src/model/kinds.ts';
// @ts-expect-error a plain .mjs helper of the preview server
import { addFeeder } from '../scripts/feeder-fixture.mjs';

const fixturePath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry.json');
const configPath = resolve(import.meta.dirname, '../../../clients/criuleni/atom-home-config-20261028.json');
const have = existsSync(fixturePath) && existsSync(configPath);
/** The house as the panel sees it: the modules' own entities claimed (the feeder's switches and sensors are its card's, not cards). */
export function houseDevices(): HomeDevice[] {
  const reg: Registry = addFeeder(JSON.parse(readFileSync(fixturePath, 'utf8'))), { config } = normaliseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const claims: Record<string, (e: Record<string, string | undefined>) => Array<string | undefined>> = {
    pet_feeder: e => [...Object.entries(e).filter(([k]) => k !== 'device' && k !== 'rest').map(([, v]) => v), ...(e.rest ?? '').split(',')],
    kettle: e => [e.heater, ...(e.rest ?? '').split(',')], camera_go2rtc: e => cameraClaims(e as never), doorbell: e => doorbellClaims(e as never),
  };
  const claimed = new Set(activeSpecs(reg, config).flatMap(a => (claims[a.spec.id]?.(a.entities as Record<string, string | undefined>) ?? []).filter((x): x is string => !!x)));
  return discover(reg, config, claimed).devices.filter(d => d.enabled);
}
const dev = (kind: Kind, name: string, extra: Partial<HomeDevice> = {}) => ({ key: `e:${kind}.${name}`, kind, name, model: null, manufacturer: null, haDeviceId: null, enabled: true, ...extra });

test('what a person operates is on the list; sensors, meters, bare plugs and relays are not', () => {
  for (const k of OPERATED_KINDS) assert.equal(deviceVerdict(dev(k, 'x')).shown, true, k);
  for (const k of ['environment', 'measurement', 'leak', 'opening', 'motion', 'alarm', 'energy', 'weather', 'person', 'alarm_panel'] as Kind[]) assert.equal(deviceVerdict(dev(k, 'x')).shown, false, k);
  assert.equal(deviceVerdict(dev('socket', 'Розетка ванной', { model: 'SONOFF Zigbee smart switch' })).shown, false, 'a bare plug');
  assert.equal(deviceVerdict(dev('switch', 'Реле котла на обогрев')).shown, false, 'a relay');
  assert.equal(deviceVerdict(dev('switch', 'Розетка увлажнителя')).shown, false, 'a plug that feeds an appliance stays a plug');
  assert.equal(deviceVerdict(dev('switch', 'Чайник', { model: 'Tuya smart plug' })).shown, true, 'the owner named the plug after its appliance');
  assert.equal(deviceVerdict(dev('switch', 'switch.kitchen_air_fryer_power', { model: 'xiaomi.fryer.maf07' })).shown, true, 'an appliance by its model');
  assert.equal(deviceVerdict(dev('switch', 'Shlyuz', { model: 'Gateway 3' })).shown, false, 'a hub is not a gate');
  assert.equal(deviceVerdict({ ...dev('light', 'Лампа'), enabled: false }).shown, false, 'switched off in the settings');
  assert.equal(relayIsAppliance({ name: 'Обогреватель', model: 'SONOFF S26' }), true);
  assert.equal(relayIsAppliance({ name: 'Свет коридора', model: null }), false);
});

test('an appliance\'s switches beyond its first are its settings, not more appliances', () => {
  const feeder = (n: string) => dev('switch', `switch.kitchen_cat_feeder_${n}`, { model: 'xiaomi.feeder.iv2001', haDeviceId: 'feeder' });
  const names: Record<string, string> = { feeder: 'Кухня · Кормушка (Xiaomi)', r: 'Реле', fryer: 'Кухня · Аэрогриль (Xiaomi Smart Air Fryer 5.5L)', plug: 'Гостиная · Розетка Xiaomi (очиститель воздуха)', fan: 'Ванная · Вентилятор (Tuya TS000F)' };
  const cx = { deviceName: (id: string) => names[id] ?? null };
  const out = deviceVerdicts([feeder('schedule'), { ...feeder('child_lock'), metrics: [1, 2] }, feeder('compensate'), dev('switch', 'Relay', { haDeviceId: 'r' })], cx);
  assert.deepEqual(out.map(x => x.verdict.shown), [false, true, false, false], 'the card with the readings stands for the feeder');
  assert.equal(out[0].verdict.why, 'a setting of the appliance');
  assert.equal(out[1].verdict.label, 'Кухня · Кормушка', 'named as the appliance, not as its switch');
  assert.equal(out[1].verdict.toggle, false, 'its first card is not what a tap switches: one of its settings never is (model/appliance.ts decides)');
  // the air fryer's three switches are one air fryer; the purifier's plug with five settings is a plug; a relay that runs the fan is the fan
  const fry = (n: string) => dev('switch', `Кухня · Аэрогриль (Xiaomi Smart Air Fryer 5.5L) ${n}`, { haDeviceId: 'fryer' }), plug = (n: string) => dev('switch', `Гостиная · Розетка Xiaomi (очиститель воздуха) ${n}`, { haDeviceId: 'plug' });
  const more = deviceVerdicts([fry('Подогрев'), fry('Перемешивание'), plug('Задержка'), plug('Блокировка'), dev('switch', 'Ванная · Вентилятор', { haDeviceId: 'fan' })], cx);
  assert.deepEqual(more.map(x => x.verdict.shown), [true, false, false, false, true]);
  assert.equal(more[0].verdict.label, 'Кухня · Аэрогриль'); assert.equal(more[4].verdict.toggle, false, 'the relay that runs the fan: the appliance decides what a tap switches — its power switch, this relay (model/appliance.ts, tests/appliance.test.ts)');
  // the owner named a lone plug «Чайник»: that is the kettle
  assert.equal(deviceVerdicts([dev('switch', 'Чайник', { haDeviceId: 'p' })], { deviceName: () => 'Smart plug S26' })[0].verdict.shown, true);
  // a camera's second stream is not a second camera, once the panel says which its cameras are
  assert.deepEqual(deviceVerdicts([dev('camera', 'Камера (HD)'), dev('camera', 'Камера (352p)')], { cameras: new Set(['e:camera.Камера (HD)']) }).map(x => x.verdict.shown), [true, false]);
});

test('every group the list draws holds only kinds the rule shows, and every kind the rule shows has its group', () => {
  const grouped = new Set(LIST_GROUPS.flatMap(g => g.kinds));
  for (const k of OPERATED_KINDS) assert.ok(grouped.has(k), k);
  for (const g of LIST_GROUPS) for (const k of g.kinds) assert.ok(OPERATED_KINDS.includes(k) || k === 'switch' || k === 'socket', `${g.id}: ${k}`);
});

test('this house: lights, heads, the robot, cameras, the TVs and speakers, the valve — and not one sensor', { skip: !have && 'no house fixture' }, () => {
  const all = houseDevices(), reg: Registry = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const shown = listedDevices(all, { deviceName: id => { const d = reg.devices.find(x => x.id === id) as { name?: string | null; name_by_user?: string | null } | undefined; return d ? d.name_by_user ?? d.name ?? null : null; } }), names = shown.map(d => d.name);
  // the owner's appliances and the lamps are all there
  for (const n of ['Свет · Гостиная', 'Люстра детской', 'Радиатор · Кухня', 'Отопление дома', 'Робот-пылесос', 'Кран ванной', 'Умная колонка', 'Телевизор Samsung']) assert.ok(names.includes(n), n);
  assert.ok(shown.some(d => d.kind === 'camera'), 'the cameras');
  // no sensor, no meter, no bare plug, no person
  for (const d of shown) assert.ok(!['environment', 'measurement', 'leak', 'opening', 'motion', 'alarm', 'energy', 'person', 'weather'].includes(d.kind), `${d.name} (${d.kind})`);
  assert.ok(!names.includes('Розетка ванной'), 'the bathroom plug is a plug');
  assert.ok(!names.includes('Электрощит'), 'the switchboard is a meter');
  assert.ok(!shown.some(d => /cat_feeder/.test(d.primary.id)), 'the feeder\'s switches are its card\'s');
  // far fewer than the 1.26 list: the sensors went out
  const old = all.filter(d => d.section === 'systems');
  assert.ok(shown.length < all.length && old.some(d => d.kind === 'environment') && !shown.some(d => d.kind === 'environment'));
});

test('a house with no settings yet: the rule needs nothing but the devices', () => {
  const cfg = defaultConfig('Casa');
  assert.ok(cfg.devices && listedDevices([]).length === 0);
});
