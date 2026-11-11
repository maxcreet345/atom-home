// The room page (09.11.2026): the house as HA showed it at 13:18 that day (private/fixtures/criuleni-rooms-20261109.json, every enabled entity
// with an area, without diagnostics) over the Vacuum card's house; the heating, the robot and the cameras stay as their own cards drew them.
//
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { card as vac } from './vacuum.mjs';
const live = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../private/fixtures/criuleni-rooms-20261109.json'), 'utf8'));
const KEEP = /^(climate\.|vacuum\.|camera\.|input_|timer\.|button\.|number\.|select\.)|_robot_vacuum|kitchen_boiler_(?!plug)/; // the other cards' own moments
export const card = {
  name: 'Комната', sheet: '#rooms?room=kukhnia', home: '#rooms', sheetRoot: '.rm-page', tileRoot: '.at-room', actionButton: null,
  // `twelve` (1.27.0, «Комнаты» on one screen): the same house with two more rooms, each with a climate sensor — the brief's upper case of 12;
  // `eight`: the house with the 8 rooms of the 28.10 registry (the stairwell and the corridor by the bedroom set aside)
  scenarios: { live: {}, evening: { sc: 'evening' }, twelve: { sc: 'twelve' }, eight: { sc: 'eight' } },
  build(base, scenario, now) {
    const out = vac.build(base, vac.scenarios.docked, now), snap = out.snapshot, ids = new Set(live.entities.map(e => e.entity_id));
    const devs = new Map(snap.devices.map(d => [d.id, d])); for (const d of live.devices) devs.set(d.id, { ...devs.get(d.id), ...d, name: d.name_by_user ?? d.name }); snap.devices = [...devs.values()];
    // the house is what HA had that day: an entity of a room HA no longer has (renamed, removed, a setting since) goes, the other cards' own stay
    const areas = new Set(live.areas.map(a => a.area_id)), areaOf = e => e.area_id ?? devs.get(e.device_id)?.area_id ?? null;
    snap.entities = snap.entities.filter(e => KEEP.test(e.entity_id) || (!ids.has(e.entity_id) && !areas.has(areaOf(e)))).concat(live.entities.filter(e => !KEEP.test(e.entity_id) || !snap.entities.some(x => x.entity_id === e.entity_id)));
    for (const a of live.areas) { const o = snap.areas.find(x => x.area_id === a.area_id); if (o) Object.assign(o, a); else snap.areas.push(a); }
    for (const [id, s] of Object.entries(live.states)) if (!KEEP.test(id) || !snap.states[id]) snap.states[id] = structuredClone(s);
    // the bowl's scale as live HA marks it (the fixture keeps few attributes): the feeder's sheet and the room card read the same grams
    if (snap.states['sensor.kitchen_cat_feeder_eaten_p22']) snap.states['sensor.kitchen_cat_feeder_eaten_p22'].attributes['eaten_food_measure-2-22'] = 0;
    const set = (id, state) => { if (snap.states[id]) snap.states[id] = { ...snap.states[id], state }; };
    // the kitchen as it was: the centre window open, so its head waits (the heating's own «window» moment)
    set('input_boolean.kitchen_heating_window', 'on'); snap.states['climate.kitchen_trv'] = { ...snap.states['climate.kitchen_trv'], state: 'off', attributes: { ...snap.states['climate.kitchen_trv'].attributes, current_temperature: 20.5, temperature: null, hvac_action: 'off' } };
    if (scenario.sc === 'evening') { set('light.living_light', 'on'); set('light.kids_chandelier', 'on'); set('media_player.living_tv', 'on'); set('sensor.living_tv_meter_power', '96.4'); set('switch.kitchen_kettle_power', 'on'); set('sensor.kitchen_kettle_status', 'heating'); set('sensor.kitchen_kettle_temperature', '71'); set('sensor.kitchen_kettle_plug_power', '1840'); }
    // (new arrays and new rows only: the 09.11 house is read once for every scenario of the server's life)
    if (scenario.sc === 'twelve') for (const [id, name, t, h] of [['garderob', 'Гардероб', '19.4', '51'], ['kabinet', 'Кабинет', '21.8', '44']]) {
      snap.areas = [...snap.areas, { area_id: id, name, picture: null, floor_id: null, temperature_entity_id: null, humidity_entity_id: null }];
      for (const [cls, v, unit] of [['temperature', t, '°C'], ['humidity', h, '%']]) { const eid = `sensor.${id}_climate_${cls}`; snap.entities = [...snap.entities, { entity_id: eid, device_id: null, area_id: id, disabled_by: null, hidden_by: null, entity_category: null, platform: 'mock', device_class: cls, name: null, original_name: `${name} ${cls}` }]; snap.states[eid] = { state: v, attributes: { device_class: cls, unit_of_measurement: unit, friendly_name: `${name} · ${cls === 'temperature' ? 'Температура' : 'Влажность'}` }, last_changed: now.toISOString(), last_updated: now.toISOString() }; }
    }
    if (scenario.sc === 'eight') { const gone = new Set(['podezd', 'koridor_u_spalni']), move = x => gone.has(x.area_id ?? '') ? { ...x, area_id: 'prikhozhaia' } : x; snap.areas = snap.areas.filter(a => !gone.has(a.area_id)); snap.entities = snap.entities.map(move); snap.devices = snap.devices.map(move); } // their things move to the hall
    return out;
  },
  config: (text, s) => vac.config(text, s),
};
