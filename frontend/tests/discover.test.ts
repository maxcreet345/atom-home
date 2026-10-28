import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { discover, roomClimate, NO_ROOM } from '../src/model/discover.ts';
import { defaultConfig, normaliseConfig } from '../src/model/config.ts';
import { entityKind, CONTROL_KINDS } from '../src/model/kinds.ts';
import { actionsFor, serviceCall } from '../src/runtime/actions.ts';
import { translator } from '../src/i18n/index.ts';
import type { Registry } from '../src/model/registry.ts';

const fixturePath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry.json');
const fixture: Registry | null = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

test('entity kinds follow HA domains and device classes', () => {
  assert.equal(entityKind({ entity_id: 'light.x', device_class: null }), 'light');
  assert.equal(entityKind({ entity_id: 'switch.x', device_class: 'outlet' }), 'socket');
  assert.equal(entityKind({ entity_id: 'sensor.x', device_class: 'temperature' }), 'environment');
  assert.equal(entityKind({ entity_id: 'sensor.x', device_class: 'power' }), 'energy');
  assert.equal(entityKind({ entity_id: 'sensor.x', device_class: 'battery' }), null);
  assert.equal(entityKind({ entity_id: 'binary_sensor.x', device_class: 'moisture' }), 'leak');
  assert.equal(entityKind({ entity_id: 'binary_sensor.x', device_class: 'connectivity' }), null);
  assert.equal(entityKind({ entity_id: 'update.x', device_class: null }), null);
  assert.equal(entityKind({ entity_id: 'sensor.x', device_class: null }, { state: 'abc', attributes: {}, last_changed: '', last_updated: '' }), null);
  assert.equal(entityKind({ entity_id: 'sensor.x', device_class: null }, { state: '12', attributes: {}, last_changed: '', last_updated: '' }), null, 'class-less counters are not cards');
  assert.equal(entityKind({ entity_id: 'sensor.x', device_class: null, unit: 'kWh' }), 'energy', 'unit fallback');
  assert.equal(entityKind({ entity_id: 'sensor.x', device_class: null }, { state: '21', attributes: { unit_of_measurement: '°C' }, last_changed: '', last_updated: '' }), 'environment');
});

test('config normalisation drops malformed parts and keeps safe values', () => {
  const { config, warnings } = normaliseConfig({ schemaVersion: 1, home: { name: '  Casa  ', language: 'ro', theme: 'dark', logo: 'javascript:alert(1)' }, devices: { 'e:light.a': { enabled: false, name: 'Lamp' }, 'bad key!': {} }, buttons: [{ id: 'b1', label: 'Hi', service: 'script.turn_on', target: { entity_id: 'script.x' } }, { id: 'x', label: 'no', service: 'rm -rf' }] });
  assert.equal(config.home.name, 'Casa'); assert.equal(config.home.language, 'ro'); assert.equal(config.home.logo, null);
  assert.deepEqual(config.devices['e:light.a'], { enabled: false, name: 'Lamp' });
  assert.equal(config.buttons.length, 1); assert.equal(config.buttons[0].confirm, true);
  assert.ok(warnings.some(w => w.includes('bad key')) && warnings.some(w => w.includes('button')));
});

test('translator handles plurals in three languages', () => {
  assert.equal(translator('ru')('rooms.count', { n: 8 }), '8 комнат'); assert.equal(translator('ru')('rooms.count', { n: 2 }), '2 комнаты'); assert.equal(translator('ru')('rooms.count', { n: 21 }), '21 комната');
  assert.equal(translator('en')('rooms.count', { n: 1 }), '1 room'); assert.equal(translator('ro')('rooms.count', { n: 2 }), '2 camere');
  assert.equal(translator('en')('confirm.text', { action: 'Lock', device: 'Door' }), 'Run “Lock” for “Door”?');
});

test('a synthetic home: 2-gang switch becomes two cards, plug with power sensor merges, sensors group per device', () => {
  const reg: Registry = {
    areas: [{ area_id: 'kitchen', name: 'Kitchen' }], services: {},
    devices: [{ id: 'd1', name: 'Wall switch', area_id: 'kitchen' }, { id: 'd2', name: 'Plug', area_id: null }, { id: 'd3', name: 'Air', area_id: 'kitchen' }, { id: 'sv', name: 'Supervisor', area_id: null, entry_type: 'service' }],
    entities: [
      { entity_id: 'light.l1', device_id: 'd1', area_id: null, name: null, original_name: 'Left', platform: 'z', entity_category: null, disabled_by: null, hidden_by: null },
      { entity_id: 'light.l2', device_id: 'd1', area_id: null, name: null, original_name: 'Right', platform: 'z', entity_category: null, disabled_by: null, hidden_by: null },
      { entity_id: 'sensor.sw_link', device_id: 'd1', area_id: null, name: null, original_name: 'Linkquality', platform: 'z', entity_category: 'diagnostic', disabled_by: null, hidden_by: null },
      { entity_id: 'switch.plug', device_id: 'd2', area_id: 'kitchen', name: null, original_name: 'Plug', platform: 'z', entity_category: null, disabled_by: null, hidden_by: null, device_class: 'outlet' },
      { entity_id: 'sensor.plug_power', device_id: 'd2', area_id: null, name: null, original_name: 'Power', platform: 'z', entity_category: null, disabled_by: null, hidden_by: null, device_class: 'power', unit: 'W' },
      { entity_id: 'select.plug_mode', device_id: 'd2', area_id: null, name: null, original_name: 'Power-on', platform: 'z', entity_category: 'config', disabled_by: null, hidden_by: null },
      { entity_id: 'sensor.air_t', device_id: 'd3', area_id: null, name: null, original_name: 'T', platform: 'z', entity_category: null, disabled_by: null, hidden_by: null, device_class: 'temperature', unit: '°C' },
      { entity_id: 'sensor.air_h', device_id: 'd3', area_id: null, name: null, original_name: 'H', platform: 'z', entity_category: null, disabled_by: null, hidden_by: null, device_class: 'humidity', unit: '%' },
      { entity_id: 'sensor.air_bat', device_id: 'd3', area_id: null, name: null, original_name: 'Bat', platform: 'z', entity_category: 'diagnostic', disabled_by: null, hidden_by: null, device_class: 'battery' },
      { entity_id: 'update.sv', device_id: 'sv', area_id: null, name: null, original_name: 'Core', platform: 'hassio', entity_category: null, disabled_by: null, hidden_by: null },
      { entity_id: 'weather.home', device_id: null, area_id: null, name: null, original_name: 'Home', platform: 'met', entity_category: null, disabled_by: null, hidden_by: null },
    ],
    states: { 'light.l1': { state: 'on', attributes: { friendly_name: 'Wall switch Left', supported_color_modes: ['onoff'] }, last_changed: '', last_updated: '' }, 'light.l2': { state: 'off', attributes: { friendly_name: 'Wall switch Right' }, last_changed: '', last_updated: '' }, 'switch.plug': { state: 'on', attributes: { friendly_name: 'Plug' }, last_changed: '', last_updated: '' }, 'sensor.plug_power': { state: '12.5', attributes: { unit_of_measurement: 'W' }, last_changed: '', last_updated: '' }, 'sensor.air_t': { state: '21.4', attributes: {}, last_changed: '', last_updated: '' }, 'sensor.air_h': { state: '55', attributes: {}, last_changed: '', last_updated: '' }, 'weather.home': { state: 'rainy', attributes: { temperature: 9 }, last_changed: '', last_updated: '' } },
  };
  const home = discover(reg, defaultConfig('Test'));
  const keys = home.devices.map(d => d.key).sort();
  assert.deepEqual(keys, ['d:d3', 'e:light.l1', 'e:light.l2', 'e:switch.plug', 'e:weather.home']);
  const plug = home.devices.find(d => d.key === 'e:switch.plug')!;
  assert.equal(plug.kind, 'socket'); assert.equal(plug.metrics[0].id, 'sensor.plug_power'); assert.equal(plug.parameters[0].id, 'select.plug_mode'); assert.equal(plug.roomId, 'kitchen');
  const air = home.devices.find(d => d.key === 'd:d3')!;
  assert.equal(air.kind, 'environment'); assert.equal(air.metrics.length, 2); assert.equal(air.diagnostics[0].id, 'sensor.air_bat'); assert.equal(air.name, 'Air');
  assert.equal(home.devices.find(d => d.key === 'e:light.l2')!.diagnostics.length, 0, 'only the first control card carries device diagnostics');
  assert.equal(home.rooms.length, 2); assert.equal(home.rooms[1].id, NO_ROOM, 'weather without area lands in "no room"');
  assert.deepEqual(roomClimate(home, reg, 'kitchen'), { temperature: 21.4, humidity: 55, co2: null, lights: home.devices.filter(d => d.kind === 'light') });
  // config overlay: merge plug into the left light, rename, hide
  const cfg = defaultConfig('Test'); cfg.devices['e:switch.plug'] = { mergeInto: 'e:light.l1' }; cfg.devices['e:light.l2'] = { enabled: false, name: 'Hidden' }; cfg.rooms['kitchen'] = { name: 'Кухня' };
  const h2 = discover(reg, cfg);
  const left = h2.devices.find(d => d.key === 'e:light.l1')!;
  assert.equal(left.controls.length, 2); assert.equal(left.metrics[0].id, 'sensor.plug_power');
  assert.equal(h2.devices.find(d => d.key === 'e:switch.plug')!.enabled, false); assert.equal(h2.devices.find(d => d.key === 'e:light.l2')!.enabled, false);
  assert.equal(h2.rooms[0].name, 'Кухня');
});

test('actions are white-listed per kind and respect declared features', () => {
  const light = { kind: 'light', primary: { id: 'light.a', state: 'on', attributes: { supported_color_modes: ['color_temp'], brightness: 128, min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500 } } } as never;
  const a = actionsFor(light); assert.deepEqual(a.map(x => x.id), ['toggle', 'brightness', 'color_temp']); assert.equal(a[1].current, 50);
  assert.deepEqual(serviceCall(a[1], 40), { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a', brightness_pct: 40 } });
  const valve = { kind: 'valve', primary: { id: 'valve.v', state: 'closed', attributes: {} } } as never;
  assert.ok(actionsFor(valve).every(x => x.confirm && x.risk === 'water'));
  const vac = { kind: 'vacuum', primary: { id: 'vacuum.v', state: 'docked', attributes: { supported_features: 8192 | 16 | 32, fan_speed_list: ['quiet', 'max'] } } } as never;
  assert.deepEqual(actionsFor(vac).map(x => x.id), ['start', 'return', 'fan_speed']);
  const cam = { kind: 'camera', primary: { id: 'camera.c', state: 'idle', attributes: {} } } as never;
  assert.equal(actionsFor(cam).length, 0);
  assert.ok(CONTROL_KINDS.includes('light'));
});

test('Criuleni registry snapshot (private) discovers rooms and household devices without manual bindings', { skip: !fixture }, () => {
  const home = discover(fixture!, defaultConfig('Criuleni'));
  const enabled = home.devices.filter(d => d.enabled);
  const byKind = Object.fromEntries(Object.entries(home.counts).sort());
  console.log('  rooms:', home.rooms.map(r => `${r.name || r.id}`).join(', '));
  console.log('  kinds:', JSON.stringify(byKind));
  assert.ok(home.rooms.length >= 9);
  assert.ok((home.counts.light ?? 0) >= 8, 'lights'); assert.ok((home.counts.climate ?? 0) >= 6, 'climate'); assert.equal(home.counts.vacuum, 1); assert.ok((home.counts.leak ?? 0) >= 2); assert.ok((home.counts.environment ?? 0) >= 6); assert.ok((home.counts.camera ?? 0) >= 1);
  assert.ok(enabled.every(d => d.primary && d.roomId), 'every card has a primary entity and a room');
  assert.ok(!enabled.some(d => /^sensor\.(oppo_|ararat_(steps|light|internal|external|battery))|steps_sensor|sleep_confidence/.test(d.primary.id)), 'phone sensors (mobile_app) never become cards');
  assert.ok(!enabled.some(d => d.kind === 'energy' && !d.metrics.some(m => m.deviceClass === 'power' || m.deviceClass === 'energy')), 'energy cards carry power or energy');
  assert.ok(enabled.some(d => d.metrics.some(m => m.deviceClass === 'energy' && m.unit === 'kWh')), 'class-less kWh meters are recognised by unit');
  assert.ok(!enabled.some(d => d.primary.domain === 'update' || d.primary.domain === 'automation'), 'service entities never become cards');
  const light = enabled.find(d => d.kind === 'light')!; assert.ok(actionsFor(light).some(a => a.id === 'toggle'));
  const noRoom = enabled.filter(d => d.roomId === NO_ROOM).length; console.log('  without room:', noRoom, 'of', enabled.length);
});
