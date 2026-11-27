// Who sees which building (27.11.2026, docs/ACCESS.md): a house of three buildings — floors of Home Assistant — and a yard with no floor,
// built from scratch and kept in git (nothing private). qa-access.mjs signs in as different people over it.
const iso = new Date().toISOString();
const row = (state, attributes = {}) => ({ state, attributes, last_changed: iso, last_updated: iso });
const ent = (entity_id, device_id = null, area_id = null) => ({ entity_id, device_id, area_id, name: null, original_name: null, platform: 'fx', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class: null, unit: null, has_entity_name: false, labels: [], translation_key: null });
export const FLOORS = [['servis_i_shourum', 'Главное здание', 0], ['contabilitate', 'Бухгалтерия', 1], ['office', 'Офис Dmlink', 2]];
/** area, name, floor */
export const AREAS = [['atom_service', 'Сервис', 'servis_i_shourum'], ['showroom_evrinet', 'Шоурум', 'servis_i_shourum'], ['contabilitate', 'Кабинет бухгалтеров', 'contabilitate'], ['ceo', 'Кабинет главбуха', 'contabilitate'], ['dmlink', 'Офис', 'office'], ['dvor', 'Двор', null]];
/** light entity, name, area — every one on, so «Свет» counts them */
export const LIGHTS = [['light.service', 'Свет сервиса', 'atom_service'], ['light.showroom', 'Свет шоурума', 'showroom_evrinet'], ['light.buh', 'Свет бухгалтерии', 'contabilitate'], ['light.ceo', 'Свет главбуха', 'ceo'], ['light.office', 'Свет офиса', 'dmlink'], ['light.yard', 'Прожектор двора', 'dvor']];
export function accessHouse() {
  const fx = { floors: FLOORS.map(([floor_id, name, level]) => ({ floor_id, name, level })), areas: [], devices: [], entities: [], states: {} };
  for (const [area_id, name, floor_id] of AREAS) fx.areas.push({ area_id, name, floor_id, icon: null, picture: null, temperature_entity_id: null, humidity_entity_id: null });
  const add = (entity_id, name, area, state, attributes = {}, model = 'Fixture') => { const id = `dev_${entity_id.replace('.', '_')}`; fx.devices.push({ id, name, model, manufacturer: 'Fx', area_id: area, entry_type: null }); fx.entities.push(ent(entity_id, id)); fx.states[entity_id] = row(state, { friendly_name: name, ...attributes }); };
  for (const [id, name, area] of LIGHTS) add(id, name, area, 'on', { supported_color_modes: ['brightness'], brightness: 200 });
  add('climate.buh_ac', 'Кондиционер бухгалтерии', 'contabilitate', 'heat', { hvac_modes: ['off', 'heat', 'cool'], temperature: 22, current_temperature: 21.4, min_temp: 16, max_temp: 30, target_temp_step: 0.5, supported_features: 1 });
  add('switch.office_kettle', 'Чайник офиса', 'dmlink', 'off', { device_class: 'outlet' });
  add('sensor.buh_temperature', 'Температура бухгалтерии', 'contabilitate', '21.4', { device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' }, 'TH');
  add('sensor.showroom_temperature', 'Температура шоурума', 'showroom_evrinet', '19.8', { device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' }, 'TH');
  // a socket that belongs to no room: only the administrator sees it
  add('switch.loose', 'Розетка без комнаты', null, 'on', { device_class: 'outlet' });
  fx.entities.push(ent('person.ararat')); fx.states['person.ararat'] = row('home', { friendly_name: 'Арарат' });
  fx.entities.push(ent('sun.sun')); fx.states['sun.sun'] = row('below_horizon', { friendly_name: 'Sun' });
  return fx;
}
/** Home Assistant's users as `config/auth/list` answers (a system user and an owner among them). */
export const USERS = [
  { id: 'u_ararat', name: 'ararat', is_owner: true, is_active: true, system_generated: false, local_only: false, group_ids: ['system-admin'] },
  { id: 'u_faur', name: 'faur', is_owner: false, is_active: true, system_generated: false, local_only: false, group_ids: ['system-users'] },
  { id: 'u_daniela', name: 'daniela', is_owner: false, is_active: true, system_generated: false, local_only: false, group_ids: ['system-users'] },
  { id: 'u_vasile', name: 'vasile', is_owner: false, is_active: true, system_generated: false, local_only: false, group_ids: ['system-users'] },
  { id: 'u_super', name: 'Supervisor', is_owner: false, is_active: true, system_generated: true, local_only: false, group_ids: ['system-admin'] },
];
/** faur — «Сотрудник» of «Бухгалтерия»; daniela — «Планшет» in the main building and «Гость» (only looks) in the office; vasile — nothing. */
export const ACCESS = { enabled: true, newUsers: 'none', roles: {
  manager: { name: '', sections: ['lights', 'systems', 'climate', 'cleaning', 'camera', 'energy', 'security'], modules: ['cameras', 'security', 'energy', 'clock', 'climate'], mode: 'full' },
  staff: { name: '', sections: ['lights', 'systems', 'climate'], modules: ['clock', 'climate'], mode: 'full' },
  guard: { name: '', sections: ['lights', 'systems', 'camera', 'security'], modules: ['cameras', 'security', 'clock'], mode: 'full' },
  tablet: { name: '', sections: ['lights', 'climate'], modules: ['clock', 'climate'], mode: 'lights' },
  guest: { name: '', sections: ['lights'], modules: [], mode: 'view' },
}, members: { u_faur: { buildings: { contabilitate: 'staff' } }, u_daniela: { buildings: { servis_i_shourum: 'tablet', office: 'guest' } } }, profiles: {} };
export const config = (theme = 'light', access = ACCESS) => ({ schemaVersion: 1, home: { name: 'Atom', language: 'ru', theme }, rooms: {}, devices: {}, entities: {}, buttons: [], sections: {}, modules: {}, alarms: [], ...(access ? { access } : {}) });
