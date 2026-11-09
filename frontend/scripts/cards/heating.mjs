// The Heating card and panel (mock, 09.11.2026): the house as HA showed it that morning (private/fixtures/criuleni-heating-20261109.json)
// over the Cameras card's house, in five moments: a normal morning, a room's own change and an open window, «Ручной», off, the boiler silent on eBUS (as it really was).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { card as cams } from './cameras.mjs';
const live = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../private/fixtures/criuleni-heating-20261109.json'), 'utf8'));
const OLD = /^(climate\.|.*heating_demirdokum|.*ebusd|sensor\.heating_|input_.*heating|timer\..*heating)/;
const iso = (now, min) => new Date(now.getTime() - min * 60000).toISOString();
const boilerOn = { flow_temp: '52.4', flow_temp_target: '60', return_temp: '44.1', dhw_temp: '47.5', dhw_temp_target: '50', pressure: '1.32', flame: 'on', state_code: 'S.04' };
function apply(snap, now, sc) {
  const S = snap.states, set = (id, state, attrs) => { const o = S[id] ?? { attributes: {}, last_changed: iso(now, 30), last_updated: iso(now, 30) }; S[id] = { ...o, state: state ?? o.state, attributes: { ...o.attributes, ...(attrs ?? {}) } }; };
  const trv = (k, cur, target, action, state = 'heat') => { set(`climate.${k}_trv`, state, { current_temperature: cur, temperature: target, hvac_action: action }); };
  set('binary_sensor.kitchen_boiler_ebus_signal', 'on');
  for (const [k, v] of Object.entries(boilerOn)) set(`sensor.kitchen_boiler_${k}`, v);
  set('switch.kitchen_boiler_heat_relay', 'on'); set('weather.forecast_home', 'fog', { temperature: -2.9 });
  set('input_number.heating_home_temp', '20.5'); set('sensor.heating_target_temp', '20.5'); set('climate.living_thermostat', 'heat', { temperature: 21, current_temperature: 20 });
  trv('living', 19.7, 20.5, 'heating'); trv('kitchen', 19.9, 20.5, 'heating'); trv('bedroom', 19.4, 20.5, 'heating'); trv('kids', 21.0, 20.5, 'idle'); trv('office', 20.1, 20.5, 'heating');
  if (sc === 'own') {
    trv('kids', 22.3, 24, 'heating'); set('input_number.kids_heating_override_temp', '24'); set('timer.kids_heating_override', 'active', { finishes_at: new Date(now.getTime() + 161 * 60000).toISOString(), duration: '3:00:00' });
    set('binary_sensor.kitchen_window_center_contact', 'on'); S['binary_sensor.kitchen_window_center_contact'].last_changed = iso(now, 12); set('input_boolean.kitchen_heating_window', 'on'); trv('kitchen', 18.6, null, 'off', 'off');
  }
  if (sc === 'manual') {
    set('input_select.heating_mode', 'Ручной'); for (const [k, v] of [['living', 21], ['kitchen', 20], ['bedroom', 19.5], ['kids', 22], ['office', 21]]) { set(`input_number.${k}_heating_manual_temp`, String(v)); }
    trv('living', 20.6, 21, 'heating'); trv('kitchen', 20.2, 20, 'idle'); trv('bedroom', 19.6, 19.5, 'idle'); trv('kids', 21.4, 22, 'heating'); trv('office', 20.5, 21, 'heating');
  }
  if (sc === 'sleep') { set('sensor.heating_scenario', 'Сон'); set('sensor.heating_target_temp', '19'); for (const k of ['living', 'kitchen', 'bedroom', 'kids', 'office']) trv(k, 19.2, 19, 'idle'); set('switch.kitchen_boiler_heat_relay', 'off'); set('sensor.kitchen_boiler_flame', 'off'); }
  if (sc === 'off') { set('input_boolean.heating_system', 'off'); set('climate.living_thermostat', 'off'); for (const k of ['living', 'kitchen', 'bedroom', 'kids', 'office']) trv(k, 18.8, null, 'off', 'off'); set('switch.kitchen_boiler_heat_relay', 'off'); set('sensor.kitchen_boiler_flame', 'off'); }
  if (sc === 'silent') { set('binary_sensor.kitchen_boiler_ebus_signal', 'off'); for (const k of Object.keys(boilerOn)) set(`sensor.kitchen_boiler_${k}`, 'unknown'); set('sensor.kitchen_boiler_state_code', 'unknown'); trv('office', null, 20.5, null, 'unavailable'); S['climate.office_trv'].state = 'unavailable'; }
  return snap;
}
export const card = {
  name: 'Отопление', sheet: '#climate', home: '#home', sheetRoot: '.at-heat-panel', tileRoot: '.at-heat-tile', actionButton: null, darkScenarios: ['normal', 'own', 'silent'], homeScenarios: ['normal', 'own', 'off'],
  scenarios: { normal: {}, own: { sc: 'own' }, manual: { sc: 'manual' }, sleep: { sc: 'sleep' }, off: { sc: 'off' }, silent: { sc: 'silent' } },
  build(base, scenario, now) {
    const out = cams.build(base, cams.scenarios.quiet, now), snap = out.snapshot, ids = new Set(live.entities.map(e => e.entity_id));
    snap.entities = snap.entities.filter(e => !ids.has(e.entity_id) && !OLD.test(e.entity_id)).concat(live.entities);
    const devs = new Set(live.devices.map(d => d.id)); snap.devices = snap.devices.filter(d => !devs.has(d.id)).concat(live.devices);
    snap.states = Object.fromEntries(Object.entries(snap.states).filter(([id]) => !OLD.test(id) || ids.has(id)));
    for (const [id, s] of Object.entries(live.states)) snap.states[id] = structuredClone(s);
    apply(snap, now, scenario.sc);
    return out;
  },
  config: (text, s) => cams.config(text, s),
};
