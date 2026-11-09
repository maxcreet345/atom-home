// The kettle card and sheet (mock, 09.11.2026): the Xiaomi Smart Kettle 2 Pro and the SONOFF socket it stands on, as HA showed them that day
// (entities, names and the kettle's attributes read 15:25: Mi Home's three keep-warm modes, the knob's presets), over the Heating card's house.
import { card as heat } from './heating.mjs';
const KD = 'b1b91d29ee2532c934eac804bb2d41f6', PD = '85c08ad2de2d48200a241ee50f7f1246', K = 'kitchen_kettle';
const iso = (now, min) => new Date(now.getTime() - min * 60000).toISOString();
const ATTRS = { min_temp: 40, max_temp: 99, current_temperature: 20, temperature: 99, target_temp_high: 99, target_temp_low: 40, temperature_unit: '°C', 'kettle.status': 0, 'kettle.fault': 0, 'kettle.temperature': 20, 'kettle.target_temperature': 99,
  'kettle.auto_keep_warm': false, 'kettle.keep_warm_temperature': 40, 'kettle.on': false, no_disturb: false, 'function.keep_warm_time': 1440, 'function.custom_knob_temp': false, 'function.lift_remember_temp': true, 'function.boiling_reminder': false,
  'function.keep_warm_reminder': false, 'function.kettle_lifting': false, 'function.extended_mode': '温水,45,1,45,1440_泡枸杞,70,1,70,1440_花茶,80,1,80,1440', 'function.warming_time': 0, 'function.target_mode': 0, 'function.heat_mode': '70,1,45,1440',
  'function.boil_mode': '99,1,45,1440', 'knob_setting.knob_sequence': '1,2,3,4,0,0', 'knob_setting.knob_one': '泡奶,0,45,1440', 'knob_setting.knob_two': '蜂蜜,0,60,1440', 'knob_setting.knob_three': '煮茶,0,70,1440', 'knob_setting.knob_four': '咖啡,0,85,1440',
  'knob_setting.knob_five': ',0,0,0', 'knob_setting.knob_six': ',0,0,0', friendly_name: 'Кухня · Чайник', supported_features: 1 };
const KETTLE = [['water_heater', K, 'off', ATTRS], ['sensor', `${K}_status`, 'idle'], ['sensor', `${K}_temperature`, '20.0', { unit_of_measurement: '°C', device_class: 'temperature' }], ['sensor', `${K}_warming_time`, '0', { unit_of_measurement: 'minutes' }],
  ['binary_sensor', `${K}_lifted`, 'off'], ['switch', `${K}_auto_keep_warm`, 'off'], ['switch', `${K}_power`, 'off'], ['switch', `${K}_no_disturb`, 'off'], ['switch', `${K}_custom_knob_temp`, 'off'], ['switch', `${K}_lift_remember_temp`, 'on'],
  ['switch', `${K}_boiling_reminder`, 'off'], ['switch', `${K}_keep_warm_reminder`, 'off'], ['number', `${K}_target_temperature`, '99', { min: 40, max: 99, step: 1, unit_of_measurement: '°C' }], ['number', `${K}_keep_warm_temperature`, '40', { min: 0, max: 100, step: 1, unit_of_measurement: '°C' }],
  ['number', `${K}_keep_warm_time`, '1440', { min: 60, max: 1440, step: 1, unit_of_measurement: 'minutes' }], ['number', `${K}_target_mode`, '0', { min: 0, max: 128 }], ['button', `${K}_info`, 'unknown', {}, 'diagnostic'], ['button', `${K}_stop`, 'unknown']];
const PLUG = [['switch', `${K}_plug`, 'on'], ['sensor', `${K}_plug_power`, '0', { unit_of_measurement: 'W', device_class: 'power' }], ['sensor', `${K}_plug_energy_today`, '0', { unit_of_measurement: 'kWh', device_class: 'energy' }],
  ['sensor', `${K}_plug_energy`, '0.32', { unit_of_measurement: 'kWh', device_class: 'energy' }], ['sensor', `${K}_plug_voltage`, '235.9', { unit_of_measurement: 'V', device_class: 'voltage' }]];
function apply(fx, now, sc) {
  fx.devices ??= [];
  // the 28.10 registry knows the kettle's switches under older ids: today's set replaces them
  fx.entities = fx.entities.filter(e => !e.entity_id.includes('kettle')); for (const id of Object.keys(fx.states)) if (id.includes('kettle')) delete fx.states[id];
  fx.devices = fx.devices.filter(d => d.id !== KD && d.id !== PD).concat([{ id: KD, name: 'Кухня · Чайник (Xiaomi Smart Kettle 2 Pro)', model: 'xiaomi.kettle.v20', manufacturer: 'xiaomi', area_id: 'kukhnia', entry_type: null, disabled_by: null, via_device_id: null, labels: ['wifi'] },
    { id: PD, name: 'Кухня · Розетка чайника (SONOFF S60ZBTPF)', model: 'Zigbee smart plug', manufacturer: 'SONOFF', area_id: 'kukhnia', entry_type: null, disabled_by: null, via_device_id: null, labels: ['rozetki'] }]);
  const add = (dev, platform) => ([d, o, state, attrs = {}, cat = null]) => { const id = `${d}.${o}`; fx.entities.push({ entity_id: id, device_id: dev, area_id: null, disabled_by: null, hidden_by: null, entity_category: cat, platform, device_class: attrs.device_class ?? null, name: null, original_name: o, labels: [] }); fx.states[id] = { state, attributes: structuredClone(attrs), last_changed: iso(now, 40), last_updated: iso(now, 1) }; };
  KETTLE.forEach(add(KD, 'xiaomi_miot')); PLUG.forEach(add(PD, 'mqtt'));
  const S = fx.states, set = (o, state, attrs) => { S[o] = { ...S[o], state, attributes: { ...S[o].attributes, ...(attrs ?? {}) } }; };
  if (sc === 'heating') { set(`sensor.${K}_status`, 'heating'); set(`sensor.${K}_temperature`, '63'); set(`number.${K}_target_temperature`, '80'); set(`switch.${K}_power`, 'on'); set(`sensor.${K}_plug_power`, '1812'); set(`sensor.${K}_plug_energy_today`, '0.06'); set(`water_heater.${K}`, 'on', { current_temperature: 63, temperature: 80, 'kettle.on': true }); }
  if (sc === 'boil') { set(`sensor.${K}_status`, 'heating'); set(`sensor.${K}_temperature`, '91'); set(`switch.${K}_power`, 'on'); set(`switch.${K}_auto_keep_warm`, 'on'); set(`number.${K}_keep_warm_temperature`, '60'); set(`sensor.${K}_plug_power`, '1806'); set(`sensor.${K}_plug_energy_today`, '0.11'); set(`water_heater.${K}`, 'on', { current_temperature: 91, 'kettle.on': true }); }
  if (sc === 'keep') { set(`sensor.${K}_status`, 'keep_warm'); set(`sensor.${K}_temperature`, '45'); set(`switch.${K}_auto_keep_warm`, 'on'); set(`number.${K}_keep_warm_temperature`, '45'); set(`sensor.${K}_warming_time`, '190'); set(`sensor.${K}_plug_power`, '42'); set(`sensor.${K}_plug_energy_today`, '0.18'); }
  if (sc === 'lifted') { set(`binary_sensor.${K}_lifted`, 'on'); set(`sensor.${K}_temperature`, '72'); }
  if (sc === 'knob') { set(`switch.${K}_custom_knob_temp`, 'on'); set(`switch.${K}_boiling_reminder`, 'on'); }
  if (sc === 'offline') for (const id of Object.keys(S)) if (id.includes(`${K}`) && !id.includes('_plug')) S[id] = { ...S[id], state: 'unavailable' };
  return fx;
}
export const card = {
  name: 'Чайник', sheet: '#home?device=kettle', home: '#home', sheetRoot: '.at-kt-sheet', tileRoot: '[data-module-card="kettle"]', actionButton: '.at-kt-go',
  scenarios: { idle: {}, heating: { sc: 'heating' }, boil: { sc: 'boil' }, keep: { sc: 'keep' }, lifted: { sc: 'lifted' }, knob: { sc: 'knob' }, offline: { sc: 'offline' } },
  build(base, scenario, now) { const out = heat.build(base, heat.scenarios.normal, now); return { ...out, snapshot: apply(out.snapshot, now, scenario.sc) }; },
  config: (text, s) => heat.config(text, s),
};
