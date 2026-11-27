// A house that is not ours (27.11.2026): the panel was written on one house and broke quietly on a second — no hand-made helpers there, the HA
// areas link no sensors, the room ids are not Criuleni's, the names are English. This fixture is that second house, built from scratch and kept
// in git (it holds nothing private), so the gate can never skip it. Every reading carries a value no other reading has: qa-fresh-house.mjs looks
// for each of them on the screen, so a card that drops a sensor silently fails without anyone having to think of that card.
const iso = new Date().toISOString();
const row = (state, attributes = {}) => ({ state, attributes, last_changed: iso, last_updated: iso });
const ent = (entity_id, device_id = null, extra = {}) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'fresh', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class: null, unit: null, has_entity_name: false, ...extra });

/** area id, name, the sensors its HA area links (or none) */
export const AREAS = [
  ['living_room', '3. Living Room', { temperature: 'sensor.living_temperature', humidity: 'sensor.living_humidity' }],
  ['kitchen', '2. Kitchen', null],
  ['bedroom', '4. Bedroom', null],
  ['kids_room', '7. Kids Room', null],
  ['bathroom', 'Bathroom', { humidity: 'sensor.bath_humidity' }],
  ['hallway', 'Hallway', null],
  // an id that is a Criuleni room's («spalnia», the bedroom there) on a house where it is a showroom: nothing may read it as Criuleni's
  ['spalnia', 'Showroom', null],
];

/** Readings planted with a value of their own: [entity, area, device_class, state, unit, how it must show] — `silent` ones must say so instead. */
export const READINGS = [
  ['sensor.living_temperature', 'living_room', 'temperature', '21.7', '°C'],
  ['sensor.living_humidity', 'living_room', 'humidity', '43', '%'],
  ['sensor.living_co2', 'living_room', 'carbon_dioxide', '613', 'ppm'],
  ['sensor.living_pm25', 'living_room', 'pm25', '11', 'µg/m³'],
  ['sensor.kids_temperature', 'kids_room', 'temperature', '22.9', '°C'], // unlinked: the room's own sensor
  ['sensor.kids_humidity', 'kids_room', 'humidity', '47', '%'],
  ['sensor.showroom_temperature', 'spalnia', 'temperature', '19.3', '°C'],
  ['sensor.bath_humidity', 'bathroom', 'humidity', 'unavailable', '%', 'silent'], // linked and silent: the row says it is not answering
];

export function freshHouse() {
  const fx = { areas: [], devices: [], entities: [], states: {} };
  for (const [area_id, name, links] of AREAS) fx.areas.push({ area_id, name, icon: null, picture: null, floor_id: null, temperature_entity_id: links?.temperature ?? null, humidity_entity_id: links?.humidity ?? null });
  const device = (id, name, area_id, model = null) => { fx.devices.push({ id, name, model, manufacturer: 'Fresh', area_id, entry_type: null }); return id; };
  const add = (entity_id, device_id, state, attributes = {}, extra = {}) => { fx.entities.push(ent(entity_id, device_id, extra)); fx.states[entity_id] = row(state, attributes); };
  for (const [id, area, dc, state, unit] of READINGS) add(id, device(`dev_${id}`, id.split('.')[1], area, 'TH sensor'), state, { device_class: dc, unit_of_measurement: unit, state_class: 'measurement', friendly_name: id.split('.')[1].replace(/_/g, ' ') }, { device_class: dc, unit });
  // a hood and a purifier with no sensor: no row of their own in «Air»
  add('fan.kitchen_hood', device('dev_hood', 'Kitchen hood', 'kitchen', 'Hood'), 'off', { friendly_name: 'Kitchen hood' });
  add('fan.bedroom_air_purifier', device('dev_purifier', 'Air purifier', 'bedroom', 'Air Purifier 4'), 'off', { friendly_name: 'Air purifier' });
  // lights and a relay
  add('light.living_ceiling', device('dev_l1', 'Ceiling', 'living_room'), 'on', { friendly_name: 'Ceiling', brightness: 180, supported_color_modes: ['brightness'], color_mode: 'brightness' });
  add('light.kitchen_spots', device('dev_l2', 'Spots', 'kitchen'), 'off', { friendly_name: 'Spots', supported_color_modes: ['onoff'] });
  add('light.kids_lamp', device('dev_l3', 'Lamp', 'kids_room'), 'on', { friendly_name: 'Lamp', brightness: 90, supported_color_modes: ['color_temp'], color_mode: 'color_temp', color_temp_kelvin: 3000, min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500 });
  add('switch.hallway_light_relay', device('dev_relay', 'Hall relay', 'hallway'), 'off', { friendly_name: 'Hall light' });
  // a door and a leak sensor
  add('binary_sensor.front_door', device('dev_door', 'Front door', 'hallway'), 'off', { device_class: 'door', friendly_name: 'Front door' }, { device_class: 'door' });
  add('binary_sensor.bath_leak', device('dev_leak', 'Leak', 'bathroom'), 'off', { device_class: 'moisture', friendly_name: 'Leak' }, { device_class: 'moisture' });
  // the house: sun, weather, two people — and not one helper of the panel's
  add('sun.sun', null, 'above_horizon', { next_rising: iso, next_setting: iso, elevation: 12, friendly_name: 'Sun' });
  add('weather.home', null, 'rainy', { temperature: 6.4, humidity: 88, friendly_name: 'Home' });
  add('person.ana', null, 'home', { friendly_name: 'Ana' });
  add('person.ion', null, 'not_home', { friendly_name: 'Ion' });
  return fx;
}
export const FRESH_CONFIG = { schemaVersion: 1, home: { name: 'Fresh house', language: 'en', theme: 'dark' }, rooms: {}, devices: {}, entities: {}, buttons: [], sections: {}, modules: {} };
