// The Security card of Atom + Okapi (mock, 09.11.2026): the main building's alarm panels and sensors as HA showed them that afternoon
// (private/fixtures/okapi-security-20261109.json), configured as the owner decided (atom-okapi/SECURITY.md): the whole building armed at once,
// every sensor by state, smoke here too, the service's staff arm and disarm. The exhibit's room carries the label «Atom Home: не показывать».
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const live = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../private/fixtures/okapi-security-20261109.json'), 'utf8'));
export const AT = '2026-11-09T15:30:00+02:00';
// the devices' names in the panel (Atom Home device overrides), as the old Admin Panel called them
const NAMES = {
  '94c31340': 'Дверь Сервиса', '22145615': 'Движение в Сервисе', '6c4ba7e2': 'Дверь Сервиса во двор', '6237cfe5': 'Датчик дыма',
  'e481e9ec': 'Окно Шоурума', '282f31f3': 'Вход в Шоурум', 'c9a08818': 'Движение в Шоуруме', '95639d59': 'Движение у входа', '7074042a': 'Дверь Окапи ↔ Атом',
  'f3c1b73c': 'Датчик дыма', '43f7c87f': 'Присутствие', '7b4c6755': 'Дверь туалета', '3dcd3412': 'Хаб Ajax',
};
const devKey = prefix => live.devices.find(d => d.id.startsWith(prefix))?.id;
// HA's persons on 09.11.2026 (no one carries the staff label yet: the owner picks them in the panel's settings)
const PERSONS = [['andrei', 'Andrei Popescu', '97a798b46d501b5c1173760af531e1f7'], ['mihai_ionescu', 'Mihai Ionescu', '5c46fa76af23c780c99cce83f60ea2f1'], ['victor_rusu', 'Victor Rusu', '13e71a1f7ac58f99127e89f8b339dfc3'], ['elena_ciobanu', 'Elena Ciobanu', '66b17ecef2443f999ac4d33e2d4c8163'], ['cristian_munteanu', 'Cristian Munteanu', '58c9f1e634215ee5f09793019b721bfd'], ['sergiu_lungu', 'Sergiu Lungu', '9331109375e838c7cdc300a305a5054b'], ['pavel_moraru', 'Pavel Moraru', '2adae52b677d38ed48342c4a28b37289'], ['andrei_popescu', 'Andrei Popescu', '7b9a9b03b5b469669d6cdafcc832d19e'], ['radu_ceban', 'Radu Ceban', 'eb6651276cfe9c9f6d063cc49c096947'], ['tableta', 'Tableta', '43cf9c15a1ea60353bf1b1cc1c507137'], ['oleg', 'Oleg', '978c753167817be7bf8fe4b8f9e3d17c']];
const ago = s => new Date(Date.parse(AT) - s * 1000).toISOString();
function snapshot(sc) {
  const s = structuredClone(live);
  const set = (id, state, attrs, secAgo = 60) => { const o = s.states[id] ?? { attributes: {} }; s.states[id] = { ...o, state, attributes: { ...o.attributes, ...(attrs ?? {}) }, last_changed: ago(secAgo), last_updated: ago(secAgo) }; };
  s.areas = s.areas.map(a => a.area_id === 'spalnia' ? { ...a, labels: ['atom_home_ne_pokazyvat'] } : a);
  for (const [k, name, user] of PERSONS) { const id = `person.${k}`; s.entities.push({ entity_id: id, device_id: null, area_id: null, name: null, original_name: name, platform: 'person', entity_category: null, disabled_by: null, hidden_by: null, labels: [], original_device_class: null }); s.states[id] = { state: 'home', attributes: { friendly_name: name, user_id: user }, last_changed: ago(9000), last_updated: ago(9000) }; }
  const all = st => ['alarm_control_panel.master', 'alarm_control_panel.shourum', 'alarm_control_panel.servis'].forEach(id => set(id, st, {}, 20));
  const calm = () => { set('binary_sensor.datchik_dveri_shourum_servis_contact', 'off', null, 3600); set('binary_sensor.datchik_dveri_servis_vo_dvor_tamper_2', 'off', null, 3600); };
  if (sc === 'arming') { calm(); all('arming'); set('alarm_control_panel.master', 'arming', { delay: 60, arm_mode: 'armed_away' }, 20); }
  if (sc === 'armed') { calm(); all('armed_away'); set('alarm_control_panel.master', 'armed_away', {}, 5400); set('binary_sensor.atom_service_miscare_service_motion', 'off', null, 5500); }
  if (sc === 'pending') { calm(); all('armed_away'); set('alarm_control_panel.servis', 'pending', { delay: 30 }, 8); set('alarm_control_panel.master', 'pending', { delay: 30, arm_mode: 'armed_away' }, 8); set('binary_sensor.atom_service_usa_service_door', 'on', null, 8); }
  if (sc === 'triggered') { calm(); all('armed_away'); set('alarm_control_panel.shourum', 'triggered', {}, 40); set('alarm_control_panel.master', 'triggered', {}, 40); set('binary_sensor.showroom_evrinet_miscare_showroom_2_motion', 'on', null, 42); set('binary_sensor.showroom_evrinet_miscare_showroom_2_glass_break', 'on', null, 43); }
  if (sc === 'smoke') { set('binary_sensor.datchik_dyma_servis_smoke_2', 'on', null, 25); }
  // the devices' own readings as HA had them on 09.11.2026 (battery, Ajax's temperature and Jeweller signal, the hub's network)
  const SENS = [['atom_service_service', '3dcd3412', { battery: 100, mobile_network_type: '2G', cellular_signal: 'strong' }], ['atom_service_usa_service', '94c31340', { battery: 100, temperature: 20, signal_strength: 'Strong' }],
    ['showroom_evrinet_fereastra_showroom', 'e481e9ec', { battery: 100, temperature: 21, signal_strength: 'Strong' }], ['showroom_evrinet_usa_de_intrare_showroom', '282f31f3', { battery: 100, temperature: 18, signal_strength: 'Strong' }],
    ['atom_service_miscare_service', '22145615', { battery: 100, temperature: 20, signal_strength: 'Strong' }], ['showroom_evrinet_miscare_showroom_2', 'c9a08818', { battery: 100, temperature: 26, signal_strength: 'Strong' }],
    ['showroom_evrinet_miscare_usa_showroom', '95639d59', { battery: 100, temperature: 25, signal_strength: 'Strong' }], ['datchik_dveri_shourum_servis', '7074042a', { battery: 100 }], ['datchik_dveri_servis_vo_dvor', '6c4ba7e2', { battery_2: 100 }],
    ['datchik_dyma_servis', '6237cfe5', { battery_2: 100 }], ['datchik_dyma_shourum', 'f3c1b73c', { battery_2: 94 }], ['datchik_prisutstviia_okapi', '43f7c87f', { battery_2: 100 }], ['datchik_dveri_tualet', '7b4c6755', { battery_2: 100 }]];
  for (const [stem, dev, vals] of SENS) for (const [k, v] of Object.entries(vals)) {
    const id = `sensor.${stem}_${k}`, dc = /^battery/.test(k) ? 'battery' : k === 'temperature' ? 'temperature' : null;
    s.entities.push({ entity_id: id, device_id: devKey(dev), area_id: null, name: null, original_name: k, platform: dev.startsWith('3dcd') || /^(94c3|e481|282f|2214|c9a0|9563)/.test(dev) ? 'aegis_ajax' : 'mqtt', entity_category: dc === 'temperature' ? null : 'diagnostic', disabled_by: null, hidden_by: null, labels: [], original_device_class: dc });
    s.states[id] = { state: String(v), attributes: { ...(dc ? { device_class: dc } : {}), ...(dc === 'battery' ? { unit_of_measurement: '%' } : dc === 'temperature' ? { unit_of_measurement: '°C' } : {}) }, last_changed: ago(9000), last_updated: ago(9000) };
  }
  const entities = s.entities.map(e => ({ ...e, device_class: e.original_device_class ?? null, unit: null, has_entity_name: false, icon: null, original_icon: null }));
  return { floors: s.floors, areas: s.areas, devices: s.devices.map(d => ({ ...d, name: d.name_by_user ?? d.name })), entities, states: s.states, services: {} };
}
function config() {
  const rooms = Object.fromEntries([...live.areas.map(a => [a.area_id, { hidden: true }]), ['none', { hidden: true }]]);
  const sections = Object.fromEntries(['lights', 'climate', 'cleaning', 'energy', 'systems', 'automations', 'camera', 'weather'].map(x => [x, { hidden: true }]));
  const modules = Object.fromEntries(['air', 'clock', 'boiler_ebus', 'camera_go2rtc', 'doorbell', 'pet_feeder'].map(m => [m, { enabled: false }]));
  const devices = Object.fromEntries(Object.entries(NAMES).map(([p, name]) => [`d:${devKey(p)}`, { name }]));
  return { schemaVersion: 1, home: { name: 'Атом + Окапи', logo: null, language: 'ru', theme: 'light' }, rooms, devices, entities: {}, buttons: [], sections, modules, alarms: [] };
}
// HA's logbook of the master, 04–09.11.2026 (logbook/get_events): armed by Andrei (e28897…) and by Oleg (53679a…), disarmed at 08:00 by Ajax (its scenario, synced)
const T = iso => Date.parse(iso) / 1000, AJAX = 'automation.ajax_alarmo_sinkhronizatsiia_okhrany', M = 'alarm_control_panel.master';
const LOG = [
  ['2026-11-04T16:25:28Z', 'arming', '97a798b46d501b5c1173760af531e1f7'], ['2026-11-04T16:26:28Z', 'armed_away'], ['2026-11-05T06:00:26Z', 'disarmed', null, AJAX],
  ['2026-11-05T17:12:02Z', 'arming', '978c753167817be7bf8fe4b8f9e3d17c'], ['2026-11-05T17:13:02Z', 'armed_away'], ['2026-11-06T06:00:34Z', 'disarmed', null, AJAX],
  ['2026-11-06T16:30:50Z', 'arming', '97a798b46d501b5c1173760af531e1f7'], ['2026-11-06T16:31:50Z', 'armed_away'], ['2026-11-09T06:00:34Z', 'disarmed', null, AJAX],
].map(([w, state, user, ent]) => ({ when: T(w), entity_id: M, state, context_user_id: user ?? null, context_entity_id: ent ?? null, context_domain: ent ? 'automation' : user ? 'alarm_control_panel' : null }));
const logFor = sc => sc === 'armed' ? [...LOG, { when: T('2026-11-09T12:00:10Z'), entity_id: M, state: 'arming', context_user_id: '978c753167817be7bf8fe4b8f9e3d17c' }, { when: T('2026-11-09T12:01:10Z'), entity_id: M, state: 'armed_away' }]
  : sc === 'triggered' ? [...LOG, { when: T('2026-11-09T12:00:10Z'), entity_id: M, state: 'arming', context_user_id: '978c753167817be7bf8fe4b8f9e3d17c' }, { when: T('2026-11-09T12:01:10Z'), entity_id: M, state: 'armed_away' }, { when: Date.parse(AT) / 1000 - 40, entity_id: M, state: 'triggered' }] : LOG;
export const card = {
  name: 'Охрана · Атом + Окапи', sheet: '#security', home: '#home', sheetRoot: '.at-osec-wrap', tileRoot: '.at-sec-tile', actionButton: '.at-sec-main',
  scenarios: { now: { at: AT }, arming: { at: AT, sc: 'arming' }, armed: { at: AT, sc: 'armed' }, pending: { at: AT, sc: 'pending' }, triggered: { at: AT, sc: 'triggered' }, smoke: { at: AT, sc: 'smoke' } },
  build: (_b, scenario) => ({ snapshot: snapshot(scenario.sc), logbook: logFor(scenario.sc), feederLog: null, airTasks: [] }),
  config: () => config(),
};
