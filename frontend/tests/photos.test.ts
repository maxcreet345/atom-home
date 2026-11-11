import test from 'node:test';
import assert from 'node:assert/strict';
import { photoIndex, photoKey } from '../src/model/photos.ts';
import { defaultConfig, normaliseConfig } from '../src/model/config.ts';
import type { Registry } from '../src/model/registry.ts';

// Design 2026 «стекло»: one photo slot per appliance (`devices[<key>].photo`), read by every card that draws it (docs/DESIGN-HOMEOS.md § 6).
const ent = (entity_id: string, device_id: string | null) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null });
const reg: Registry = { areas: [], devices: [{ id: 'kettle', name: 'Чайник', area_id: null }, { id: 'sensor', name: 'Датчик', area_id: null }], states: {},
  entities: [ent('water_heater.kettle', 'kettle'), ent('sensor.kettle_temperature', 'kettle'), ent('sensor.room_temperature', 'sensor'), ent('sensor.room_power', 'sensor'), ent('input_boolean.helper', null)] };
const withPhotos = (devices: Record<string, { photo?: string | null }>) => ({ ...defaultConfig('Дом'), devices });

test('photos: the slot of an entity is its device, or the entity itself when it has none', () => {
  assert.equal(photoKey(reg, 'water_heater.kettle'), 'd:kettle');
  assert.equal(photoKey(reg, 'input_boolean.helper'), 'e:input_boolean.helper');
  assert.equal(photoKey(reg, 'sensor.unknown'), 'e:sensor.unknown');
});
test('photos: every entity of the appliance finds the photo of its device', () => {
  const of = photoIndex(reg, withPhotos({ 'd:kettle': { photo: '/atom_home_photos/abcdefabcdef.webp' } }));
  assert.equal(of('water_heater.kettle'), '/atom_home_photos/abcdefabcdef.webp');
  assert.equal(of('sensor.kettle_temperature'), '/atom_home_photos/abcdefabcdef.webp');
  assert.equal(of('sensor.room_temperature'), null);
  assert.equal(of(undefined), null); assert.equal(of(null), null); assert.equal(of('light.nowhere'), null);
});
test('photos: a device split into several cards shares one photo; its own key wins over a card of it', () => {
  assert.equal(photoIndex(reg, withPhotos({ 'd:sensor:energy': { photo: '/local/a.webp' } }))('sensor.room_temperature'), '/local/a.webp');
  assert.equal(photoIndex(reg, withPhotos({ 'd:sensor:energy': { photo: '/local/a.webp' }, 'd:sensor': { photo: '/local/b.webp' } }))('sensor.room_power'), '/local/b.webp');
});
test('photos: an entity without a device keeps its photo under its own key; no photos — nothing is looked up', () => {
  assert.equal(photoIndex(reg, withPhotos({ 'e:input_boolean.helper': { photo: '/local/h.png' } }))('input_boolean.helper'), '/local/h.png');
  assert.equal(photoIndex(reg, withPhotos({ 'd:kettle': { photo: null } }))('water_heater.kettle'), null);
});
test('photos: the slot survives the config check only as a picture of the house (its photo store, /local, https, a data URL)', () => {
  const { config } = normaliseConfig({ schemaVersion: 1, home: { name: 'Дом' }, devices: { 'd:kettle': { photo: '/atom_home_photos/abcdefabcdef.webp' }, 'd:sensor': { photo: 'javascript:alert(1)' }, 'e:x.y': { photo: '/local/device-photos/xiaomi.kettle.v20-s.webp' } } });
  assert.equal(config.devices['d:kettle'].photo, '/atom_home_photos/abcdefabcdef.webp');
  assert.equal(config.devices['d:sensor']?.photo, undefined);
  assert.equal(config.devices['e:x.y'].photo, '/local/device-photos/xiaomi.kettle.v20-s.webp');
});
test('photos: the owner\'s rule (11.11.2026) — appliances take a photo; sensors, relays and plugs keep their pictograms', async () => {
  const { takesPhoto, thingTakesPhoto } = await import('../src/model/photos.ts');
  const dev = (kind: string, name: string, primary: string, model: string | null = null) => ({ kind, name, model, primary: { id: primary }, controls: [{ id: primary }] });
  for (const d of [dev('vacuum', 'Пылесос', 'vacuum.roborock'), dev('camera', 'Звонок', 'camera.entrance_doorbell'), dev('media', 'Колонка', 'media_player.station'), dev('fan', 'Очиститель воздуха', 'fan.purifier'), dev('light', 'Люстра', 'light.ceiling'),
    dev('switch', 'Аэрогриль', 'switch.kitchen_air_fryer', 'xiaomi.fryer.maf07d'), dev('switch', 'Поилка кошки', 'switch.kitchen_pet_fountain')]) assert.equal(takesPhoto(d), true, d.name);
  for (const d of [dev('leak', 'Датчик протечки', 'binary_sensor.leak'), dev('environment', 'Термометр', 'sensor.t'), dev('motion', 'Движение', 'binary_sensor.motion'), dev('opening', 'Окно', 'binary_sensor.window'), dev('alarm', 'Газ', 'binary_sensor.gas'),
    dev('valve', 'Кран воды', 'valve.kran'), dev('socket', 'Розетка', 'switch.plug'), dev('switch', 'Реле света', 'switch.relay'), dev('switch', 'Реле котла на обогрев', 'switch.boiler_relay'), dev('switch', 'Холодильник', 'switch.fridge_socket'), dev('alarm_panel', 'Охрана', 'alarm_control_panel.home')]) assert.equal(takesPhoto(d), false, d.name);
  assert.equal(thingTakesPhoto('kettle', 'switch.kitchen_kettle_power'), true); assert.equal(thingTakesPhoto('speaker', 'media_player.x'), true); assert.equal(thingTakesPhoto('vent', 'fan.vent'), true);
  assert.equal(thingTakesPhoto('valve', 'valve.x'), false); assert.equal(thingTakesPhoto('socket', 'switch.x'), false); assert.equal(thingTakesPhoto('fridge', 'switch.fridge'), false); assert.equal(thingTakesPhoto('boiler', 'switch.boiler_relay'), false); assert.equal(thingTakesPhoto('other', null), false);
});
test('photos: the owner (11.11.2026) — the pet feeder keeps its drawn cat, whatever photo is configured', async () => {
  const { takesPhoto, thingTakesPhoto } = await import('../src/model/photos.ts');
  assert.equal(thingTakesPhoto('feeder', 'button.kitchen_cat_feeder_dispense'), false); assert.equal(thingTakesPhoto('feeder', null), false);
  for (const kind of ['switch', 'sensor', 'measurement', 'media']) assert.equal(takesPhoto({ kind, name: 'Кормушка', model: 'xiaomi.feeder.iv2001', primary: { id: 'switch.kitchen_cat_feeder' } }), false, kind);
  const src = (await import('node:fs')).readFileSync(new URL('../src/modules/pet-feeder.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /usePhoto|ProductPhoto|photoEntity/, 'the feeder module reads no photo and offers no photo slot');
});
