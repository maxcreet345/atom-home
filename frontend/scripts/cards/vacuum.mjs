// The robot vacuum card and panel (mock, 09.11.2026): the Saros Z70 as HA showed it that day (private/fixtures/criuleni-vacuum-20261109.json, captured
// while it cleaned the kitchen) over the Heating card's house, with HA's room ↔ area link as set on 09.11 and the map HA drew (private/camera-frames/vacuum-map.png).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { card as heat } from './heating.mjs';
const live = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../private/fixtures/criuleni-vacuum-20261109.json'), 'utf8'));
const AREAS = { gostinaia: 'Гостиная', koridor_u_spalni: 'Коридор у спальни', spalnia: 'Спальня', prikhozhaia: 'Прихожая', detskaia: 'Детская', koridor_u_vannoi: 'Коридор у ванной', kukhnia: 'Кухня', kompiuternaia: 'Компьютерная', vannaia: 'Ванная' };
const LINK = { gostinaia: '0_1', koridor_u_spalni: '0_2', spalnia: '0_3', prikhozhaia: '0_4', detskaia: '0_5', koridor_u_vannoi: '0_6', kukhnia: '0_7', kompiuternaia: '0_9', vannaia: '0_10' };
const MAP = 'image.gostinaia_gostinaia_robot_pylesos_roborock_saros_z70_kvartira', P = 'living_robot_vacuum';
const iso = (now, min) => new Date(now.getTime() - min * 60000).toISOString();
function apply(snap, now, sc) {
  const S = snap.states, set = (id, state, attrs) => { const o = S[id] ?? { attributes: {}, last_changed: iso(now, 30), last_updated: iso(now, 30) }; S[id] = { ...o, state: state ?? o.state, attributes: { ...o.attributes, ...(attrs ?? {}) } }; };
  set(`sensor.${P}_last_clean_begin`, iso(now, 60 * 20)); set(`sensor.${P}_last_clean_end`, iso(now, 60 * 18 - 4));
  if (sc === 'docked') { set(`vacuum.${P}`, 'docked'); set(`sensor.${P}_status`, 'charging'); set(`binary_sensor.${P}_charging`, 'on'); set(`binary_sensor.${P}_cleaning`, 'off'); set(`sensor.${P}_battery`, '100'); set(`sensor.${P}_cleaning_progress`, '100'); set(`sensor.${P}_current_room`, 'гостиную'); set(`sensor.${P}_dock_mop_drying_remaining_time`, '1.6'); }
  if (sc === 'paused') { set(`vacuum.${P}`, 'paused'); set(`sensor.${P}_status`, 'paused'); set(`sensor.${P}_current_room`, 'гостиную'); set(`sensor.${P}_cleaning_progress`, '34'); set(`sensor.${P}_cleaning_time`, '27'); set(`sensor.${P}_cleaning_area`, '21.4'); set(`sensor.${P}_battery`, '71'); }
  if (sc === 'returning') { set(`vacuum.${P}`, 'returning'); set(`sensor.${P}_status`, 'returning_home'); set(`sensor.${P}_battery`, '18'); }
  if (sc === 'warn') { set(`vacuum.${P}`, 'docked'); set(`sensor.${P}_status`, 'charging'); set(`binary_sensor.${P}_cleaning`, 'off'); set(`sensor.${P}_battery`, '82'); set(`binary_sensor.${P}_dock_dirty_water_box`, 'on'); set(`sensor.${P}_dock_error`, 'waste_water_tank_full'); set(`sensor.${P}_sensor_time_left`, '2.4'); }
  if (sc === 'error') { set(`vacuum.${P}`, 'error'); set(`sensor.${P}_status`, 'error'); set(`sensor.${P}_error`, 'robot_trapped'); set(`sensor.${P}_current_room`, 'спальню'); set(`sensor.${P}_cleaning_progress`, '61'); }
  // audit 10.11.2026: the states the round found wrong
  if (sc === 'washing') { set(`vacuum.${P}`, 'docked'); set(`sensor.${P}_status`, 'washing_the_mop'); set(`binary_sensor.${P}_cleaning`, 'on'); } // a trip to the dock in the middle of the job (91 %)
  if (sc === 'leftover') { set(`vacuum.${P}`, 'docked'); set(`sensor.${P}_status`, 'charging'); set(`binary_sensor.${P}_cleaning`, 'off'); set(`sensor.${P}_error`, 'main_brush_jammed'); set(`sensor.${P}_filter_time_left`, '-12.5'); } // an error code left on a docked robot, a part past its life
  if (sc === 'unknown') set(`vacuum.${P}`, 'unknown'); // HA has no state for the robot, its sensors still speak
  if (sc === 'newcode') { set(`vacuum.${P}`, 'error'); set(`sensor.${P}_status`, 'error'); set(`sensor.${P}_error`, 'brand_new_fault_77'); } // a code the dictionary has never seen
  if (sc === 'offline') for (const id of Object.keys(S)) if (id.includes(P)) S[id] = { ...S[id], state: 'unavailable' };
  return snap;
}
export const card = {
  name: 'Пылесос', sheet: '#cleaning', home: '#home', sheetRoot: '.at-vac-panel', tileRoot: '.at-vac-tile', actionButton: null, darkScenarios: ['cleaning', 'docked', 'warn'], homeScenarios: ['cleaning', 'docked', 'warn'],
  scenarios: { cleaning: {}, drawn: { sc: 'drawn' }, docked: { sc: 'docked' }, paused: { sc: 'paused' }, returning: { sc: 'returning' }, warn: { sc: 'warn' }, error: { sc: 'error' }, offline: { sc: 'offline' }, unlinked: { sc: 'unlinked' }, washing: { sc: 'washing' }, leftover: { sc: 'leftover' }, unknown: { sc: 'unknown' }, newcode: { sc: 'newcode' } },
  build(base, scenario, now) {
    const out = heat.build(base, heat.scenarios.normal, now), snap = out.snapshot;
    for (const [id, name] of Object.entries(AREAS)) if (!snap.areas.some(a => a.area_id === id)) snap.areas.push({ area_id: id, name, icon: null, picture: null });
    snap.entities = snap.entities.filter(e => !e.entity_id.startsWith('vacuum.') && !live.entities.some(x => x.entity_id === e.entity_id));
    snap.entities.push(...live.entities.map(e => e.entity_id === `vacuum.${P}` && scenario.sc !== 'unlinked' ? { ...e, vacuum: { areas: Object.fromEntries(Object.entries(LINK).map(([a, s]) => [a, [s]])), segments: live.segments.map(s => ({ id: s.id, name: s.name })) } } : e));
    snap.devices = snap.devices.filter(d => !live.devices.some(x => x.id === d.id)).concat(live.devices.map(d => ({ ...d, name: d.name_by_user ?? d.name })));
    for (const [id, s] of Object.entries(live.states)) snap.states[id] = structuredClone(s);
    apply(snap, now, scenario.sc);
    const pics = scenario.sc === 'drawn' ? {} : { 'vacuum:robot': '/frames/vacuum-robot.webp', 'vacuum:dock': '/frames/vacuum-dock.webp' };
    return { ...out, frames: { ...(out.frames ?? {}), [MAP]: '/frames/vacuum-map.png', ...pics } };
  },
  config: (text, s) => heat.config(text, s),
};
