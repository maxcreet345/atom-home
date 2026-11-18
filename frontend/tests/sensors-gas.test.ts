// «Датчики температуры» on «Климат» and «Газ» on «Энергия» (owner, 18.11.2026)
import test from 'node:test';
import assert from 'node:assert/strict';
import { climateSensors, streetName } from '../src/model/climate-sensors.ts';
import { gasMeters } from '../src/model/gas.ts';
import type { Registry, EntityRow } from '../src/model/registry.ts';

const ent = (entity_id: string, device_id: string | null, device_class: string | null, extra: Partial<EntityRow> = {}): EntityRow => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'mqtt', entity_category: null, disabled_by: null, hidden_by: null, device_class, ...extra });
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: '2026-11-18T09:05:00Z', last_updated: '2026-11-18T09:05:00Z' });

// the house as HA gave it on 18.11 (shortened): two street sensors with a dew point each, two rooms with area sensors, appliances with thermometers
const reg = (): Registry => ({
  areas: [
    { area_id: 'kukhnia', name: 'Кухня', temperature_entity_id: 'sensor.kitchen_climate_temperature', humidity_entity_id: 'sensor.kitchen_climate_humidity' },
    { area_id: 'gostinaia', name: 'Гостиная', temperature_entity_id: 'sensor.living_co2_temperature', humidity_entity_id: 'sensor.living_co2_humidity' },
    { area_id: 'avto', name: 'Авто' },
  ],
  devices: [
    { id: 'sun', name: 'Улица · Климат · Солнечная сторона', area_id: null }, { id: 'shade', name: 'Улица · Климат · Теневая сторона', area_id: null },
    { id: 'kettle', name: 'Кухня · Чайник', area_id: 'kukhnia' }, { id: 'phone', name: 'Андрей · Телефон', area_id: null },
    { id: 'gas', name: 'Кухня · Счётчик газа', area_id: 'kukhnia' },
  ],
  entities: [
    ent('sensor.outdoor_sunny_climate_dew_point', 'sun', 'temperature', { original_name: 'Температура' }), // before the real one, as in HA's list
    ent('sensor.outdoor_sunny_climate_temperature', 'sun', 'temperature'), ent('sensor.outdoor_sunny_climate_humidity', 'sun', 'humidity'),
    ent('sensor.outdoor_shaded_climate_temperature', 'shade', 'temperature'), ent('sensor.outdoor_shaded_climate_dew_point', 'shade', 'temperature'), ent('sensor.outdoor_shaded_climate_humidity', 'shade', 'humidity'),
    ent('sensor.outdoor_sunny_climate_battery', 'sun', 'battery', { entity_category: 'diagnostic' }),
    ent('sensor.kitchen_climate_temperature', null, 'temperature'), ent('sensor.kitchen_climate_humidity', null, 'humidity'),
    ent('sensor.living_co2_temperature', null, 'temperature'), ent('sensor.living_co2_humidity', null, 'humidity'),
    ent('sensor.kitchen_kettle_temperature', 'kettle', 'temperature'), ent('sensor.andrei_phone_battery_temperature', 'phone', 'temperature'),
    ent('sensor.openweathermap_temperature', null, 'temperature'),
    ent('sensor.kitchen_gas_meter', 'gas', 'gas'),
  ],
  states: {
    'sensor.outdoor_sunny_climate_dew_point': st('10.8'), 'sensor.outdoor_sunny_climate_temperature': st('16.5'), 'sensor.outdoor_sunny_climate_humidity': st('69.1'), 'sensor.outdoor_sunny_climate_battery': st('100'),
    'sensor.outdoor_shaded_climate_temperature': st('13.6'), 'sensor.outdoor_shaded_climate_dew_point': st('10.2'), 'sensor.outdoor_shaded_climate_humidity': st('79.7'),
    'sensor.kitchen_climate_temperature': st('20.1'), 'sensor.kitchen_climate_humidity': st('63.2'),
    'sensor.living_co2_temperature': st('unavailable'), 'sensor.living_co2_humidity': st('unavailable'),
    'sensor.kitchen_kettle_temperature': st('19'), 'sensor.andrei_phone_battery_temperature': st('29.1'), 'sensor.openweathermap_temperature': st('7'),
    'sensor.kitchen_gas_meter': st('967.372', { unit_of_measurement: 'm³', state_class: 'total_increasing', device_class: 'gas' }),
  },
});

test('street: one thermometer a device, the dew point is never the street (live 18.11: 10,8° beside 16,5°), the forecast and a phone are not sensors', () => {
  const s = climateSensors(reg());
  assert.deepEqual(s.outdoor.map(o => [o.name, o.temp, o.hum]), [['Солнечная сторона', 16.5, 69.1], ['Теневая сторона', 13.6, 79.7]]);
});

test('rooms: the thermometer HA\'s area settings name, in the panel\'s room order; a room without one is not shown; a silent one says so', () => {
  const s = climateSensors(reg(), ['gostinaia', 'kukhnia']);
  assert.deepEqual(s.rooms.map(r => [r.name, r.temp, r.hum, r.online]), [['Гостиная', null, null, false], ['Кухня', 20.1, 63.2, true]]);
  assert.ok(!s.rooms.some(r => r.tempId === 'sensor.kitchen_kettle_temperature'));
});

test('streetName drops the street and the kind of device', () => {
  assert.equal(streetName('Улица · Климат · Теневая сторона'), 'Теневая сторона');
  assert.equal(streetName('Outdoor · Climate · North'), 'North');
});

test('gas: a growing gas counter is found with its unit and device name; nothing else is', () => {
  assert.deepEqual(gasMeters(reg()).map(m => [m.id, m.name, m.value, m.unit, m.online]), [['sensor.kitchen_gas_meter', 'Кухня · Счётчик газа', 967.372, 'm³', true]]);
  const r = reg(); r.states['sensor.kitchen_gas_meter'] = st('unavailable', { unit_of_measurement: 'm³', state_class: 'total_increasing', device_class: 'gas' });
  assert.deepEqual(gasMeters(r).map(m => [m.value, m.online]), [[null, false]]);
});
