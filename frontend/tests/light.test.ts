import test from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/model/discover.ts';
import { defaultConfig } from '../src/model/config.ts';
import { kelvinColor, isIndicatorLight, isAmbientLight, nearestColor, glowOf, clampKelvin, parseSleep } from '../src/model/lights.ts';
import { actionsFor, serviceCall } from '../src/runtime/actions.ts';
import type { Registry, EntityRow, StateRow } from '../src/model/registry.ts';

const row = (state: string, attributes: Record<string, unknown> = {}): StateRow => ({ state, attributes, last_changed: '2026-11-04T16:00:00Z', last_updated: '2026-11-04T16:00:00Z' });
const ent = (entity_id: string, device_id: string, extra: Partial<EntityRow> = {}): EntityRow => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'test', entity_category: null, disabled_by: null, hidden_by: null, ...extra });
const registry: Registry = {
  areas: [{ area_id: 'kids', name: 'Детская' }, { area_id: 'office', name: 'Компьютерная' }],
  devices: [
    { id: 'dev_chandelier', name: 'Люстра', model: 'yeelink.light.ceilc', manufacturer: 'Yeelight', area_id: 'kids' },
    { id: 'dev_hub', name: 'Xiaomi hub', model: 'Automatically generated definition', manufacturer: 'Xiaomi', area_id: 'office' },
    { id: 'dev_cam', name: 'Камера', model: 'chuangmi.camera.081ae2', manufacturer: 'Xiaomi', area_id: 'office' },
    { id: 'dev_relay', name: 'Реле', model: 'ZBMINIL2', manufacturer: 'SONOFF', area_id: 'kids' },
  ],
  entities: [
    ent('light.kids_chandelier', 'dev_chandelier'), ent('light.kids_chandelier_ambient', 'dev_chandelier'), ent('button.kids_chandelier_info', 'dev_chandelier'),
    ent('light.office_mi_hub_router', 'dev_hub'), ent('sensor.hub_illuminance', 'dev_hub', { device_class: 'illuminance' }),
    ent('camera.office_cam', 'dev_cam'), ent('light.office_cam_led', 'dev_cam'),
    ent('light.kids_light', 'dev_relay'),
  ],
  states: {
    'light.kids_chandelier': row('on', { friendly_name: 'Люстра', brightness: 153, color_temp_kelvin: 3500, min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500, supported_color_modes: ['color_temp'], effect_list: ['Day', 'Night'], effect: 'Day' }),
    'light.kids_chandelier_ambient': row('on', { friendly_name: 'Подсветка люстры', brightness: 115, rgb_color: [255, 126, 182], supported_color_modes: ['color_temp', 'rgb'] }),
    'button.kids_chandelier_info': row('unknown'),
    'light.office_mi_hub_router': row('off', { friendly_name: 'Индикатор хаба', supported_color_modes: ['xy'] }),
    'sensor.hub_illuminance': row('120', { unit_of_measurement: 'lx' }),
    'camera.office_cam': row('idle', { friendly_name: 'Камера' }), 'light.office_cam_led': row('on', { friendly_name: 'Камера подсветка статуса', supported_color_modes: ['onoff'] }),
    'light.kids_light': row('off', { friendly_name: 'Детская · Свет', supported_color_modes: ['onoff'] }),
  },
};

test('room-light rule: indicators of hubs and appliances are not lamps; the ambient light joins the chandelier', () => {
  const home = discover(registry, defaultConfig());
  const lights = home.devices.filter(d => d.enabled && d.kind === 'light');
  assert.deepEqual(lights.map(l => l.primary.id).sort(), ['light.kids_chandelier', 'light.kids_light'], 'two lamps of rooms');
  const chandelier = lights.find(l => l.primary.id === 'light.kids_chandelier')!;
  assert.equal(chandelier.controls.length, 2, 'the ambient light is a control of the chandelier card');
  assert.equal(chandelier.controls[1].id, 'light.kids_chandelier_ambient');
  assert.ok(!home.devices.some(d => d.key === 'e:light.kids_chandelier_ambient'), 'no tile of its own');
  assert.ok(!home.devices.some(d => d.key === 'e:light.office_mi_hub_router'), 'the hub indicator is no card');
  const cam = home.devices.find(d => d.kind === 'camera')!;
  assert.ok(cam.parameters.some(p => p.id === 'light.office_cam_led'), 'the camera LED is a setting of the camera');
});
test('rules recognise names in Russian and English', () => {
  assert.ok(isIndicatorLight('light.office_mi_hub_router', 'Индикатор хаба'));
  assert.ok(isIndicatorLight('light.plug_indicator_light', ''));
  assert.ok(!isIndicatorLight('light.kids_chandelier', 'Люстра'));
  assert.ok(isAmbientLight('light.kids_chandelier_ambient', 'Подсветка люстры'));
  assert.ok(!isAmbientLight('light.living_light', 'Гостиная · Свет'));
});
test('kelvin colour, glow and colour names', () => {
  assert.equal(kelvinColor(2700), '#ffb257'); assert.equal(kelvinColor(6500), '#dfeeff'); assert.equal(kelvinColor(1000), '#ff9329');
  assert.match(kelvinColor(3100), /^#ff[bc]/);
  assert.equal(nearestColor([255, 126, 182]), 'rose'); assert.equal(nearestColor([10, 10, 10]), null); assert.equal(nearestColor('x'), null);
  assert.equal(glowOf({ brightness: 255 }), 1); assert.equal(glowOf({}), 1); assert.equal(glowOf({ brightness: 25 }), 0.15);
  assert.equal(clampKelvin(5530, 2700, 6500), 5550); assert.equal(clampKelvin(100, 2700, 6500), 2700);
});
test('colour action sends rgb_color; brightness keeps its transition', () => {
  const home = discover(registry, defaultConfig()), chandelier = home.devices.find(d => d.primary.id === 'light.kids_chandelier')!;
  const acts = actionsFor(chandelier);
  assert.ok(acts.some(a => a.id === 'brightness') && acts.some(a => a.id === 'color_temp') && !acts.some(a => a.id === 'color'), 'the main light has no colour');
  const amb = { ...acts[0], id: 'color', entityId: 'light.kids_chandelier_ambient', service: 'turn_on' };
  assert.deepEqual(serviceCall(amb, [255, 126, 182]).data, { entity_id: 'light.kids_chandelier_ambient', rgb_color: [255, 126, 182] });
  assert.deepEqual(serviceCall({ ...amb, id: 'brightness', data: { transition: 0.3 } }, 40).data, { entity_id: 'light.kids_chandelier_ambient', transition: 0.3, brightness_pct: 40 });
});
test('the sleep mirror parses and ignores junk', () => {
  assert.deepEqual(parseSleep('light.kids_chandelier|17:40;light.hall_light|18:05'), { 'light.kids_chandelier': '17:40', 'light.hall_light': '18:05' });
  assert.deepEqual(parseSleep('climate.x|17:40;light.y|nope;'), {}); assert.deepEqual(parseSleep('switch.relay|17:40'), { 'switch.relay': '17:40' }); assert.deepEqual(parseSleep(undefined), {}); assert.deepEqual(parseSleep(''), {});
});
