// The air fryer card and sheet: the Xiaomi Smart Air Fryer 5.5L (xiaomi.fryer.maf07d) and the energy meter in its line, with the entities the
// house's book lists (book/03-devices/kitchen-airfryer.md) and the states of the model's MIOT spec, over the Heating card's house.
import { card as heat } from './heating.mjs';
const FD = 'cd0780d9db6ea9a71df52439fdcd797f', MD = 'a1f0airfryermeter0000000000000001', K = 'kitchen_airfryer';
const iso = (now, min) => new Date(now.getTime() - min * 60000).toISOString();
const MODES = ['Manual', 'French Fries', 'Chicken Wing', 'Steak', 'Lamb Chops', 'Fish', 'Shrimp', 'Vegetables', 'Cake', 'Pizza', 'Defrost', 'Dried Fruit', 'Yogurt'];
const FRYER = [['sensor', `${K}_status`, 'idle'], ['sensor', `${K}_fault`, 'no faults'], ['sensor', `${K}_left_time`, '0', { unit_of_measurement: 'min' }], ['sensor', `${K}_shake_reminder`, 'no need turn over pot'],
  ['switch', `${K}_auto_keep_warm`, 'on'], ['switch', `${K}_keep_warm`, 'off'], ['switch', `${K}_shake_reminder_enabled`, 'on'],
  ['number', `${K}_target_time`, '15', { min: 1, max: 1440, step: 1, unit_of_measurement: 'min' }], ['number', `${K}_target_temperature`, '180', { min: 40, max: 220, step: 5, unit_of_measurement: '°C' }],
  ['number', `${K}_schedule_left_time`, '0', { min: 0, max: 1440, step: 1, unit_of_measurement: 'min' }], ['number', `${K}_cooking_weight`, '400', { min: 100, max: 800, step: 100 }],
  ['select', `${K}_mode`, 'Manual', { options: MODES }], ['select', `${K}_cooking_layers`, 'One Layer', { options: ['Null', 'One Layer', 'Double Layer'] }], ['select', `${K}_texture`, 'None', { options: ['None', 'Crispy Roast', 'Tender Roast', 'Degrease'] }],
  ['button', `${K}_start`, 'unknown'], ['button', `${K}_cancel`, 'unknown'], ['button', `${K}_pause`, 'unknown'], ['button', `${K}_resume`, 'unknown'], ['button', `${K}_info`, 'unknown', {}, 'diagnostic']];
const METER = [['sensor', `${K}_meter_power`, '1', { unit_of_measurement: 'W', device_class: 'power' }], ['sensor', `${K}_meter_energy_today`, '0', { unit_of_measurement: 'kWh', device_class: 'energy' }], ['sensor', `${K}_meter_total_energy`, '14.2', { unit_of_measurement: 'kWh', device_class: 'energy' }]];
function apply(fx, now, sc) {
  fx.devices ??= [];
  fx.entities = fx.entities.filter(e => !e.entity_id.includes('airfryer')); for (const id of Object.keys(fx.states)) if (id.includes('airfryer')) delete fx.states[id];
  fx.devices = fx.devices.filter(d => d.id !== FD && d.id !== MD).concat([{ id: FD, name: 'Кухня · Аэрогриль (Xiaomi Smart Air Fryer 5.5L)', model: 'xiaomi.fryer.maf07d', manufacturer: 'xiaomi', area_id: 'kukhnia', entry_type: null, disabled_by: null, via_device_id: null, labels: ['wifi'] },
    { id: MD, name: 'Кухня · Счётчик энергии (аэрогриль)', model: 'MINI-ZB1GP', manufacturer: 'SONOFF', area_id: 'kukhnia', entry_type: null, disabled_by: null, via_device_id: null, labels: ['zigbee'] }]);
  const add = (dev, platform) => ([d, o, state, attrs = {}, cat = null]) => { const id = `${d}.${o}`; fx.entities.push({ entity_id: id, device_id: dev, area_id: null, disabled_by: null, hidden_by: null, entity_category: cat, platform, device_class: attrs.device_class ?? null, name: null, original_name: o, labels: [] }); fx.states[id] = { state, attributes: structuredClone(attrs), last_changed: iso(now, 40), last_updated: iso(now, 1) }; };
  FRYER.forEach(add(FD, 'xiaomi_miot')); METER.forEach(add(MD, 'mqtt'));
  const S = fx.states, set = (id, state) => { S[id] = { ...S[id], state }; }, st = v => set(`sensor.${K}_status`, v);
  const cook = (left, w = '1486') => { set(`select.${K}_mode`, 'French Fries'); set(`number.${K}_target_time`, '20'); set(`number.${K}_target_temperature`, '200'); set(`sensor.${K}_left_time`, String(left)); set(`sensor.${K}_meter_power`, w); set(`sensor.${K}_meter_energy_today`, '0.21'); };
  if (sc === 'cooking') { st('cooking'); cook(12); }
  if (sc === 'paused') { st('paused'); cook(12, '2'); }
  if (sc === 'turn') { st('turn pot paused'); cook(10, '2'); set(`sensor.${K}_shake_reminder`, 'need turn over pot'); }
  if (sc === 'done') { st('cooking completed'); cook(0, '2'); }
  if (sc === 'keep') { st('keep warm'); cook(25, '310'); set(`switch.${K}_keep_warm`, 'on'); }
  if (sc === 'long') { st('cooking'); set(`select.${K}_mode`, 'Dried Fruit'); set(`number.${K}_target_time`, '480'); set(`number.${K}_target_temperature`, '60'); set(`sensor.${K}_left_time`, '412'); set(`sensor.${K}_meter_power`, '640'); }
  if (sc === 'delay') { st('delay'); set(`number.${K}_schedule_left_time`, '80'); }
  if (sc === 'fault') { set(`sensor.${K}_fault`, 'ntc disconnect'); }
  if (sc === 'standby') st('off');
  // on the network, but the integration has not filled the values yet: nothing may read as 0
  if (sc === 'bare') { set(`number.${K}_target_time`, 'unknown'); set(`number.${K}_target_temperature`, ''); set(`select.${K}_mode`, 'unknown'); set(`sensor.${K}_left_time`, 'unknown'); set(`switch.${K}_auto_keep_warm`, 'unknown'); }
  // as the fryer is most of the day: switched off at its button, not on Wi-Fi, every entity unavailable with the name and nothing else
  if (sc === 'offline') for (const id of Object.keys(S)) if (id.includes(K) && !id.includes('_meter')) S[id] = { ...S[id], state: 'unavailable', attributes: {} };
  return fx;
}
export const card = {
  name: 'Аэрогриль', sheet: '#home?device=airfryer', home: '#rooms?room=kukhnia', sheetRoot: '.at-af.at-kt-sheet', tileRoot: '[data-module-card="airfryer"]', actionButton: '.at-af-acts .at-kt-stop',
  scenarios: { idle: {}, cooking: { sc: 'cooking' }, paused: { sc: 'paused' }, turn: { sc: 'turn' }, done: { sc: 'done' }, keep: { sc: 'keep' }, long: { sc: 'long' }, delay: { sc: 'delay' }, fault: { sc: 'fault' }, standby: { sc: 'standby' }, bare: { sc: 'bare' }, offline: { sc: 'offline' } },
  build(base, scenario, now) { const out = heat.build(base, heat.scenarios.normal, now); return { ...out, snapshot: apply(out.snapshot, now, scenario.sc) }; },
  config: (text, s) => heat.config(text, s),
};
