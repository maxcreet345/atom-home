// The Climate card and panel of Atom + Okapi (mock, 09.11.2026): the building as HA showed it that morning (private/fixtures/okapi-climate-20261109.json)
// plus the two virtual thermostats the project adds (atom-okapi/HEATING.md), in four moments: a working morning, a standby evening, a day off, an air conditioner lost.
// Each scenario has its own clock (`at`): the shot script fixes the browser's time to it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const live = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../private/fixtures/okapi-climate-20261109.json'), 'utf8'));
const AREA = { shourum: 'showroom_evrinet', servis: 'atom_service' };
const AC = { shourum: 'konditsioner_shourum', servis: 'konditsioner' };
const SENSOR = { shourum: 'datchik_temperatury_stol_shourum', servis: 'datchik_temperatury_servis' };
const MODE = { work: 'Рабочий', duty: 'Дежурный', dayoff: 'Нерабочий день' };
export const SCENARIOS = {
  work: { at: '2026-11-09T10:40:00+02:00', mode: 'work', armed: false, cal: ['on', '2026-11-09 08:59:00', '2026-11-09 18:00:00'], z: { shourum: [20.4, 'idle', 'off', 22, 0], servis: [17.2, 'heating', 'heat', 21, 1150] } },
  duty: { at: '2026-11-09T21:15:00+02:00', mode: 'duty', armed: true, cal: ['off', '2026-11-10 08:59:00', '2026-11-10 18:00:00'], calOff: '2026-11-09T18:00:00+02:00', z: { shourum: [17.8, 'idle', 'off', 19, 0], servis: [14.6, 'heating', 'heat', 18, 980] } },
  dayoff: { at: '2026-11-14T13:00:00+02:00', mode: 'dayoff', armed: true, cal: ['off', '2026-11-16 08:59:00', '2026-11-16 18:00:00'], calOff: '2026-11-13T18:00:00+02:00', z: { shourum: [11.3, 'idle', 'off', 12, 0], servis: [9.4, 'idle', 'off', 10, 0] } },
  lost: { at: '2026-11-09T10:40:00+02:00', mode: 'work', armed: false, cal: ['on', '2026-11-09 08:59:00', '2026-11-09 18:00:00'], z: { shourum: [20.4, 'heating', 'heat', 22, 820], servis: [16.9, 'heating', 'lost', null, null] } },
};
function build(sc) {
  const snap = structuredClone(live), S = snap.states, t = sc.at;
  const set = (id, state, attrs) => { const o = S[id] ?? { attributes: {} }; S[id] = { ...o, state, attributes: { ...o.attributes, ...(attrs ?? {}) }, last_changed: t, last_updated: t }; };
  const temps = { work: 20, duty: 15, dayoff: 5 };
  set('input_number.klimat_rabochaia_temperatura', '20'); set('input_number.klimat_dezhurnaia_temperatura', '15'); set('input_number.klimat_dezhurnaia_nerabochego_dnia', '5');
  set('input_select.klimat_rezhim', MODE[sc.mode], { options: Object.values(MODE) });
  set('alarm_control_panel.master', sc.armed ? 'armed_away' : 'disarmed');
  set('calendar.kalendar_rabochego_vremeni', sc.cal[0], { message: 'Рабочее время', start_time: sc.cal[1], end_time: sc.cal[2], all_day: false });
  if (sc.calOff) S['calendar.kalendar_rabochego_vremeni'].last_changed = S['calendar.kalendar_rabochego_vremeni'].last_updated = sc.calOff;
  for (const [k, [cur, action, acMode, reading, power]] of Object.entries(sc.z)) {
    const id = `climate.termostat_${k}`, name = k === 'shourum' ? 'Термостат Шоурум' : 'Термостат Сервис';
    snap.entities.push({ entity_id: id, device_id: null, area_id: AREA[k], name, original_name: name, platform: 'generic_thermostat', entity_category: null, disabled_by: null, hidden_by: null, labels: [], unique_id: `oc_${k}` });
    set(id, 'heat', { current_temperature: cur, temperature: temps[sc.mode], hvac_action: action, hvac_modes: ['heat', 'off'], min_temp: 5, max_temp: 25, target_temp_step: 0.5, friendly_name: name });
    set(`sensor.${SENSOR[k]}_temperature_2`, String(cur));
    const ac = `climate.${AC[k]}_thermostat`;
    if (acMode === 'lost') { set(ac, 'unavailable'); set(`sensor.${AC[k]}_indoor_temperature`, 'unavailable'); set(`sensor.${AC[k]}_real_time_power`, 'unavailable'); }
    else { set(ac, acMode, { temperature: 28, current_temperature: reading }); set(`sensor.${AC[k]}_indoor_temperature`, String(reading)); set(`sensor.${AC[k]}_real_time_power`, String(power)); }
  }
  return snap;
}
const config = () => {
  const off = { enabled: false }, devices = {};
  for (const d of live.devices) { devices[`d:${d.id}`] = off; for (const k of ['environment', 'energy', 'leak', 'alarm', 'opening', 'motion', 'weather', 'person', 'measurement']) devices[`d:${d.id}:${k}`] = off; }
  for (const e of live.entities) if (/^(climate|fan|switch)\./.test(e.entity_id)) devices[`e:${e.entity_id}`] = off;
  const rooms = Object.fromEntries([...live.areas.map(a => [a.area_id, { hidden: true }]), ['none', { hidden: true }]]);
  const sections = Object.fromEntries(['lights', 'cleaning', 'energy', 'systems', 'automations', 'camera', 'weather'].map(s => [s, { hidden: true }]));
  const modules = Object.fromEntries(['air', 'clock', 'boiler_ebus', 'camera_go2rtc', 'doorbell', 'pet_feeder'].map(m => [m, off]));
  return { schemaVersion: 1, home: { name: 'Атом + Окапи', logo: null, language: 'ru', theme: 'light' }, rooms, devices, entities: {}, buttons: [], sections, modules, alarms: [] };
};
export const card = {
  name: 'Климат · Атом + Окапи', sheet: '#climate', home: '#home', sheetRoot: '.at-oc-panel', tileRoot: '.at-oc-tile', actionButton: null, darkScenarios: ['work', 'duty'], homeScenarios: ['work', 'duty', 'dayoff', 'lost'],
  scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, { ...v, key: k }])),
  build: (_base, scenario) => ({ snapshot: build(scenario) }),
  config: () => config(),
};
