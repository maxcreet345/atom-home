// The house as it stood on 05.11.2026 for the Air card: real rooms, sensors, windows and devices with real values. Shared by the QA and the preview server.
const RENAME = [['moia_komnata', 'detskaia'], ['kompeternaia', 'kompiuternaia'], ['kladovka', 'sklad']];
export const renameAreas = text => { let t = text; for (const [a, b] of RENAME) t = t.split(`"${a}"`).join(`"${b}"`); return t.replace('"Компьетерная"', '"Компьютерная"').replace('"Кладовка"', '"Склад"').replace('"Главная спальня"', '"Спальня"'); };
const SENSORS = [
  ['gostinaia', 'living_co2', [['sensor.living_co2', 'carbon_dioxide', '847', 'ppm'], ['sensor.living_co2_temperature', 'temperature', '20.5', '°C'], ['sensor.living_co2_humidity', 'humidity', '55.9', '%']]],
  ['gostinaia', 'living_air_purifier', [['sensor.living_air_purifier_temperature', 'temperature', '20.8', '°C'], ['sensor.living_air_purifier_humidity', 'humidity', '58', '%'], ['sensor.living_air_purifier_pm25', 'pm25', '3', 'µg/m³'], ['sensor.living_air_purifier_filter_life', null, '21', '%'], ['sensor.living_air_purifier_filter_left_time', null, '59', 'days'], ['switch.living_air_purifier_ionizer', null, 'on'], ['fan.living_air_purifier', null, 'on', null, { preset_mode: 'Auto', preset_modes: ['Auto', 'Sleep', 'Favorite', 'Manual'], percentage: 33, friendly_name: 'Очиститель' }]]],
  ['gostinaia', 'living_humidifier', [['sensor.living_humidifier_temperature', 'temperature', '25', '°C'], ['sensor.living_humidifier_humidity', 'humidity', '48', '%'], ['binary_sensor.living_humidifier_water_shortage', null, 'on'], ['select.living_humidifier_fan_level', null, 'Level3', null, { options: ['Level1', 'Level2', 'Level3', 'Level4'] }], ['humidifier.living_humidifier', null, 'off', null, { humidity: 70, min_humidity: 40, max_humidity: 70 }]]],
  ['gostinaia', 'living_windows', [['binary_sensor.living_window_left_contact', 'window', 'off'], ['binary_sensor.living_window_center_contact', 'window', 'off'], ['binary_sensor.living_window_right_contact', 'window', 'off']]],
  ['detskaia', 'kids_co2', [['sensor.kids_co2', 'carbon_dioxide', '1044', 'ppm'], ['sensor.kids_co2_temperature', 'temperature', '22.2', '°C'], ['sensor.kids_co2_humidity', 'humidity', '54.4', '%']]],
  ['detskaia', 'kids_window', [['binary_sensor.kids_window_contact', 'window', 'off']]],
  ['spalnia', 'bedroom_climate', [['sensor.bedroom_climate_temperature', 'temperature', '21.4', '°C'], ['sensor.bedroom_climate_humidity', 'humidity', '54.7', '%']]],
  ['spalnia', 'bedroom_window', [['binary_sensor.bedroom_window_contact', 'window', 'off']]],
  ['kompiuternaia', 'office_climate', [['sensor.office_climate_temperature', 'temperature', '21.5', '°C'], ['sensor.office_climate_humidity', 'humidity', '56.6', '%']]],
  ['kompiuternaia', 'office_window', [['binary_sensor.office_window_contact', 'window', 'off']]],
  ['kompiuternaia', 'office_fan', [['fan.office_fan', null, 'off']]],
  ['kukhnia', 'kitchen_climate', [['sensor.kitchen_climate_temperature', 'temperature', '21.1', '°C'], ['sensor.kitchen_climate_humidity', 'humidity', '60.5', '%']]],
  ['kukhnia', 'kitchen_kettle', [['sensor.kitchen_kettle_temperature', 'temperature', '24', '°C']]],
  ['kukhnia', 'kitchen_boiler', [['sensor.kitchen_boiler_flow_temp', 'temperature', '50', '°C']]],
  ['kukhnia', 'kitchen_windows', [['binary_sensor.kitchen_window_center_contact', 'window', 'off'], ['binary_sensor.kitchen_window_right_contact', 'window', 'off'], ['binary_sensor.kukhnia_kukhnia_datchik_levogo_okna_mccgq02hl_opening', 'opening', 'off']]],
  ['vannaia', 'bath_climate', [['sensor.bath_climate_temperature', 'temperature', '19.89', '°C'], ['sensor.bath_climate_humidity', 'humidity', '64.85', '%']]],
  ['sklad', 'storage_climate', [['sensor.storage_climate_temperature', 'temperature', '19.2', '°C'], ['sensor.storage_climate_humidity', 'humidity', '70.4', '%']]],
];
const ENV = new Set(['temperature', 'humidity', 'carbon_dioxide', 'pm25', 'pm10']);
/** @param over state of an entity, or { state, attributes } */
export function addAir(base, over = {}) {
  const fx = JSON.parse(renameAreas(JSON.stringify(base)));
  const area = new Set(['gostinaia', 'detskaia', 'spalnia', 'kompiuternaia', 'kukhnia', 'vannaia', 'sklad']); const devArea = new Map(fx.devices.map(d => [d.id, d.area_id]));
  for (const e of fx.entities) { const a = e.area_id ?? devArea.get(e.device_id), dc = fx.states[e.entity_id]?.attributes?.device_class ?? e.device_class; if (area.has(a) && e.entity_id.startsWith('sensor.') && ENV.has(dc)) e.disabled_by = 'user'; if (area.has(a) && /^(fan|humidifier)\./.test(e.entity_id)) e.disabled_by = 'user'; if (area.has(a) && e.entity_id.startsWith('binary_sensor.') && ['window', 'opening'].includes(dc)) e.disabled_by = 'user'; }
  fx.states['weather.forecast_home'] = { state: 'partlycloudy', attributes: { temperature: 7.4, humidity: 51, friendly_name: 'Дом' }, last_changed: '', last_updated: '' };
  for (const [room, dev, list] of SENSORS) { const id = `air-${dev}`; fx.devices.push({ id, name: dev, model: dev, manufacturer: null, area_id: room, entry_type: null }); for (const [entity_id, device_class, state, unit, attributes = {}] of list) { fx.entities.push({ entity_id, device_id: id, area_id: null, name: null, original_name: entity_id, platform: 'mock', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class, unit: unit ?? null, has_entity_name: false }); fx.states[entity_id] = { state, attributes: { friendly_name: entity_id, ...(device_class ? { device_class } : {}), ...(unit ? { unit_of_measurement: unit } : {}), ...attributes }, last_changed: new Date(Date.now() - 360000).toISOString(), last_updated: '' }; } }
  for (const [id, v] of Object.entries(over)) { if (v === null) { delete fx.states[id]; continue; } const value = typeof v === 'string' ? { state: v } : v; if (!fx.states[id]) { const dev = value.device ?? null; fx.entities.push({ entity_id: id, device_id: dev, area_id: value.area ?? null, name: null, original_name: id, platform: 'mock', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class: null, unit: null, has_entity_name: false }); fx.states[id] = { state: '', attributes: { friendly_name: id }, last_changed: new Date(Date.now() - 360000).toISOString(), last_updated: '' }; } fx.states[id] = { ...fx.states[id], state: value.state ?? fx.states[id].state, attributes: { ...fx.states[id].attributes, ...(value.attributes ?? {}) } }; }
  return fx;
}
