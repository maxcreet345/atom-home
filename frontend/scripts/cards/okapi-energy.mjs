// The Energy card and panel of Atom + Okapi (mock, 09.11.2026): the building's meters and their real statistics as HA held them that morning
// (private/fixtures/okapi-energy-20261109.json, okapi-energy-stats-20261109.json), with HA's Energy settings as the project sets them
// (atom-okapi/ENERGY.md): five Tasmota POW inputs and the scooter store's own relay are the grid, the other meters sit inside their lines.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve(import.meta.dirname, '../../../private/fixtures');
const live = JSON.parse(readFileSync(resolve(dir, 'okapi-energy-20261109.json'), 'utf8'));
const stats = JSON.parse(readFileSync(resolve(dir, 'okapi-energy-stats-20261109.json'), 'utf8'));
export const AT = '2026-11-09T11:20:00+02:00';
const POW = ['sensor.tasmota_energy_total', 'sensor.tasmota_energy_total_2', 'sensor.tasmota_energy_total_3', 'sensor.tasmota_energy_total_4', 'sensor.tasmota_energy_total_5'];
const STORE = 'sensor.basic_1gsp_sonoff_1002b4ae59_energy_year', TARIFF = 'input_number.energiia_tarif';
// the meters inside each line (owner, 09.11.2026: «все 5 да»)
const INSIDE = [
  ['sensor.svet_servis_rabochaia_storona_energiia', 1, 'Свет Сервиса — рабочая сторона'], ['sensor.svet_servis_vkhodnaia_storona_energiia', 1, 'Свет Сервиса — входная сторона'],
  ['sensor.svet_magazin_energiia', 1, 'Свет Шоурума'], ['sensor.svet_tualet_energiia', 1, 'Свет Туалета'], ['sensor.service_ac_energy', 1, 'Кондиционер Сервиса'],
  ['sensor.svet_stoly_mastera_energy', 2, 'Свет над столами мастеров'], ['sensor.vytiazhka_servis_u_faura_energy', 2, 'Вытяжка у Фаура'],
  ['sensor.priemka_led_podsvetka_sonoff_1002a13ff6_energy_day', 3, 'LED приёмки'],
];
export const PREFS = {
  energy_sources: [...POW, STORE].map(id => ({ type: 'grid', stat_energy_from: id, stat_energy_to: null, entity_energy_price: TARIFF, number_energy_price: null, cost_adjustment_day: 0 })),
  device_consumption: [...POW.map((id, i) => ({ stat_consumption: id, name: `Ввод ${i + 1}` })), ...INSIDE.map(([id, i, name]) => ({ stat_consumption: id, name, included_in_stat: POW[i] }))],
  device_consumption_water: [],
};
const NAMES = { 'e:switch.tasmota': 'Пайка', 'e:switch.tasmota_2': 'Свет и климат Сервиса', 'e:switch.tasmota_3': 'Рабочие места', 'e:switch.tasmota_4': 'Приёмка и Шоурум', 'e:switch.tasmota_5': 'Плёнка и ролеты', 'e:switch.basic_1gsp_sonoff_1002b4ae59_1': 'Склад самокатов' };
function snapshot() {
  const s = structuredClone(live);
  const entities = s.entities.map(e => ({ ...e, device_class: e.original_device_class ?? null, unit: e.unit_of_measurement ?? null, has_entity_name: false, icon: null, original_icon: null }));
  entities.push({ entity_id: TARIFF, device_id: null, area_id: null, name: 'Энергия · тариф', original_name: null, platform: 'input_number', entity_category: null, disabled_by: null, hidden_by: null, device_class: null, unit: 'MDL/kWh', has_entity_name: false });
  s.states[TARIFF] = { state: '3.56', attributes: { unit_of_measurement: 'MDL/kWh', friendly_name: 'Энергия · тариф', min: 0, max: 20, step: 0.01 }, last_changed: AT, last_updated: AT };
  return { floors: s.floors, areas: s.areas, devices: s.devices.map(d => ({ ...d, name: d.name_by_user ?? d.name })), entities, states: s.states, services: {} };
}
// the tile's month: the daily counters of the six inputs since the 1st, from the same statistics the panel reads
const monthKwh = () => { const from = new Date(2026, 10, 1).getTime(); return ['sensor.tasmota_energy_today', 'sensor.tasmota_energy_today_2', 'sensor.tasmota_energy_today_3', 'sensor.tasmota_energy_today_4', 'sensor.tasmota_energy_today_5', 'sensor.basic_1gsp_sonoff_1002b4ae59_energy_day'].reduce((a, id) => a + (stats.day[id] ?? []).filter(([t]) => t >= from).reduce((b, [, v]) => b + v, 0), 0); };
function config() {
  const rooms = Object.fromEntries([...live.areas.map(a => [a.area_id, { hidden: true }]), ['none', { hidden: true }]]);
  const sections = Object.fromEntries(['lights', 'climate', 'cleaning', 'systems', 'automations', 'camera', 'weather'].map(x => [x, { hidden: true }]));
  const modules = Object.fromEntries(['air', 'clock', 'boiler_ebus', 'camera_go2rtc', 'doorbell', 'pet_feeder'].map(m => [m, { enabled: false }]));
  return { schemaVersion: 1, home: { name: 'Атом + Окапи', logo: null, language: 'ru', theme: 'light' }, rooms, devices: Object.fromEntries(Object.entries(NAMES).map(([k, name]) => [k, { name }])), entities: {}, buttons: [], sections, modules, alarms: [] };
}
export const card = {
  name: 'Энергия · Атом + Окапи', sheet: '#energy', home: '#home', sheetRoot: '.hm-main', tileRoot: '.at-energy-tile', actionButton: null,
  scenarios: { now: { at: AT } },
  build: () => ({ snapshot: snapshot(), energyStats: { hour: stats.hour, day: stats.day, hourMean: stats.hourMean, five: stats.five, dayMinMax: stats.dayMinMax }, energyPrefs: PREFS, energyMonth: monthKwh(), feederLog: null, airTasks: [] }),
  config: () => config(),
};
