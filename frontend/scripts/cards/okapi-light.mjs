// The Light section of Atom + Okapi (mock, 09.11.2026): the main building's lamps as HA showed them (private/fixtures/okapi-light-20261109.json),
// configured as the owner decided (atom-okapi/LIGHT.md): the service's common light only, «LED Шоурума» = the S60TPF socket with the Gledopto
// strip inside it (no switch of its own), the store's light, the soldering light, the toilet, the showroom and the masters' strip.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const live = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../private/fixtures/okapi-light-20261109.json'), 'utf8'));
export const AT = '2026-11-09T12:30:00+02:00';
const SOCKET = 'e:switch.priemka_led_podsvetka_sonoff_1002a13ff6_1', STRIP = 'e:light.kontroller_led_podsvetki_atom_2';
export const LIGHT_CONFIG = {
  'e:light.svet_servisa_obshchii': { name: 'Свет Сервиса' },
  'e:light.vitrina_umnogo_doma_vykliuchatel_sveta_tualet_i_magazin_magazin': { name: 'Свет Шоурума' },
  'e:light.vitrina_umnogo_doma_vykliuchatel_sveta_tualet_i_magazin_tualet': { name: 'Свет Туалета' },
  'e:light.vykliuchatel_sveta_masterov_atom': { name: 'LED над столами мастеров' },
  'e:light.ifan04_sonoff_10023b5af1_1': { name: 'Свет над пайкой' },
  'e:light.svet_sklad_samokaty_atom': { name: 'Свет склада' },
  [SOCKET]: { name: 'LED Шоурума', kind: 'light' },
  [STRIP]: { mergeInto: SOCKET },
  // the strip's old twin (unavailable since Z2M moved it) still holds the controller's settings, the scenes among them: they come along
  'e:light.kontroller_led_podsvetki_atom': { mergeInto: SOCKET },
  // not lamps of the panel (owner, 09.11.2026)
  'e:light.atom_service_vykliuchatel_sveta_servisa_rabochaia_storona': { enabled: false }, 'e:light.atom_service_vykliuchatel_sveta_servisa_vkhodnaia_storona': { enabled: false },
  'e:switch.basic_1gsp_sonoff_1002b4ae59_1': { enabled: false }, 'e:fan.ifan04_sonoff_10023b5af1': { enabled: false },
};
function snapshot(sc) {
  const s = structuredClone(live), t = AT, set = (id, state, attrs) => { const o = s.states[id] ?? { attributes: {} }; s.states[id] = { ...o, state, attributes: { ...o.attributes, ...(attrs ?? {}) }, last_changed: t, last_updated: t }; };
  // the strip as Z2M reports it once driven (live it said «on» without colour); a scene picked in one moment
  set('light.kontroller_led_podsvetki_atom_2', 'on', { color_mode: 'hs', hs_color: [210, 80], rgb_color: [51, 153, 255], brightness: 191 });
  if (sc === 'scene') set('select.kontroller_led_podsvetki_atom_scene_2', 'northern_lights');
  if (sc === 'off') { set('switch.priemka_led_podsvetka_sonoff_1002a13ff6_1', 'off'); set('light.kontroller_led_podsvetki_atom_2', 'unavailable'); }
  const entities = s.entities.map(e => ({ ...e, device_class: e.original_device_class ?? null, unit: e.unit_of_measurement ?? null, has_entity_name: false, icon: null, original_icon: null }));
  return { floors: s.floors, areas: s.areas, devices: s.devices.map(d => ({ ...d, name: d.name_by_user ?? d.name })), entities, states: s.states, services: {} };
}
function config() {
  const rooms = Object.fromEntries([...live.areas.map(a => [a.area_id, { hidden: true }]), ['none', { hidden: true }]]);
  const sections = Object.fromEntries(['climate', 'cleaning', 'energy', 'systems', 'automations', 'camera', 'weather', 'security'].map(x => [x, { hidden: true }]));
  const modules = Object.fromEntries(['air', 'clock', 'boiler_ebus', 'camera_go2rtc', 'doorbell', 'pet_feeder'].map(m => [m, { enabled: false }]));
  return { schemaVersion: 1, home: { name: 'Атом + Окапи', logo: null, language: 'ru', theme: 'light' }, rooms, devices: LIGHT_CONFIG, entities: {}, buttons: [], sections, modules, alarms: [] };
}
export const card = {
  name: 'Свет · Атом + Окапи', sheet: '#lights', home: '#home', sheetRoot: '.hm-light-page', tileRoot: '.hm-home', actionButton: null,
  scenarios: { now: { at: AT }, scene: { at: AT, sc: 'scene' }, off: { at: AT, sc: 'off' } },
  build: (_b, scenario) => ({ snapshot: snapshot(scenario.sc), feederLog: null, airTasks: [] }),
  config: () => config(),
};
