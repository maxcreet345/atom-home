// The Security card and panel (mock, 09.11.2026, book/06-dashboards/SECURITY.md): the house of the Heating card's live snapshot plus what
// HA has for security under its real names (the door, the kitchen's left window, the tampers, gas, the leaks, the people, Alarmo) and what
// the owner pairs this evening (the bathroom valve and its leak sensor), with the helpers applied in HA on 09.11 (heating_guests, the exercise helpers, the vacation label).
import { card as heating } from './heating.mjs';
const iso = (now, min) => new Date(now.getTime() - min * 60000).toISOString();
const ENT = (fx, id, area, device_class, name) => { if (!fx.entities.some(e => e.entity_id === id)) fx.entities.push({ entity_id: id, device_id: null, area_id: area, disabled_by: null, hidden_by: null, entity_category: null, platform: 'mock', device_class, name: null, original_name: name }); };
function apply(fx, now, sc) {
  // the 28.10 registry still has what HA no longer has on 09.11: the old Aqara gateway's alarm panels, two old leak sensors, a duplicate left window, the old bath valve and its two automations
  const gone = id => /^alarm_control_panel\.(54ef443fdf3e|lumi_)|^binary_sensor\.(datchik_protechki_|kukhnia_kukhnia_datchik_levogo_okna|datchik_temperatury_gostinnaia_opening)|^(valve\.vannaia_kran_vody_vannoi|switch\.kran_vody_vannoi|sensor\.kran_vody_vannoi_|automation\.(zakrytie_krana|kran_vannoi))/.test(id);
  for (const id of Object.keys(fx.states)) if (gone(id)) delete fx.states[id]; fx.entities = fx.entities.filter(e => !gone(e.entity_id));
  const S = fx.states; fx.devices ??= []; const set = (id, state, attrs = {}, min = 90) => { S[id] = { state, attributes: { ...(S[id]?.attributes ?? {}), ...attrs }, last_changed: iso(now, min), last_updated: iso(now, 1) }; };
  const add = (id, area, dc, name, state, min) => { ENT(fx, id, area, dc, name); set(id, state, dc ? { device_class: dc, friendly_name: name } : { friendly_name: name }, min); };
  add('binary_sensor.hall_door_contact', 'prikhozhaia', 'door', 'Входная дверь', 'off', 140);
  add('binary_sensor.kitchen_window_left_contact', 'kukhnia', 'window', 'Кухня · Датчик левого окна (MCCGQ02HL) Левое окно кухни', 'off', 300);
  for (const w of ['kids_window', 'office_window', 'living_window_right', 'living_window_center', 'living_window_left', 'bedroom_window', 'kitchen_window_right', 'kitchen_window_center', 'kitchen_window_left']) add(`binary_sensor.${w}_tamper`, null, 'tamper', 'Вскрытие корпуса', 'off', 900);
  for (const w of ['kids_window', 'office_window', 'living_window_right', 'living_window_center', 'living_window_left', 'bedroom_window', 'kitchen_window_right', 'kitchen_window_center']) set(`binary_sensor.${w}_contact`, 'off', {}, 200);
  add('binary_sensor.kitchen_gas', 'kukhnia', 'gas', 'Кухня · Датчик газа (Tuya TS0601) Кухня · Утечка газа', 'off', 2000);
  add('binary_sensor.kitchen_leak_boiler_water_leak', 'kukhnia', 'moisture', 'Кухня · Датчик протечки (котёл) Влага', 'off', 2000);
  add('binary_sensor.kitchen_leak_sink_water_leak', 'kukhnia', 'moisture', 'Кухня · Датчик протечки (раковина) Влага', 'off', 2000);
  add('binary_sensor.storage_leak_water_leak', 'sklad', 'moisture', 'Склад · Датчик протечки Влага', 'unknown', 2000);
  add('binary_sensor.bath_leak_water_leak', 'vannaia', 'moisture', 'Ванная · Датчик протечки Влага', 'off', 300);
  // the devices' battery and radio as HA has them (09.11.2026): SONOFF windows and leaks on Zigbee2MQTT (linkquality), the Xiaomi door (signal_strength, dBm)
  const DEV = { 'binary_sensor.hall_door_contact': ['Xiaomi', 'MCCGQ02HL', 'prikhozhaia', [['signal_strength', -51], ['battery', 100]]], 'binary_sensor.kitchen_gas': ['Tuya', 'Gas sensor', 'kukhnia', [['linkquality', 172]]],
    'binary_sensor.kitchen_leak_boiler_water_leak': ['SONOFF', 'Zigbee water sensor', 'kukhnia', [['battery', 100], ['linkquality', 140]]], 'binary_sensor.kitchen_leak_sink_water_leak': ['SONOFF', 'Zigbee water sensor', 'kukhnia', [['battery', 100], ['linkquality', 92]]],
    'binary_sensor.storage_leak_water_leak': ['SONOFF', 'Zigbee water sensor', 'sklad', [['battery', 100], ['linkquality', 112]]], 'binary_sensor.bath_leak_water_leak': ['SONOFF', 'Zigbee water sensor', 'vannaia', [['battery', 96], ['linkquality', 130]]] };
  for (const w of ['kids_window', 'office_window', 'living_window_right', 'living_window_center', 'living_window_left', 'bedroom_window', 'kitchen_window_right', 'kitchen_window_center', 'kitchen_window_left']) DEV[`binary_sensor.${w}_contact`] = ['SONOFF', 'Contact sensor', null, [['battery', w === 'office_window' ? 18 : 100], ['linkquality', w === 'bedroom_window' ? 44 : 150 + w.length]]];
  for (const [id, [maker, model, area, sens]] of Object.entries(DEV)) {
    const e = fx.entities.find(x => x.entity_id === id); if (!e) continue; const dev = e.device_id ?? `dev_${id.split('.')[1]}`; e.device_id = dev;
    if (!fx.devices.some(d => d.id === dev)) fx.devices.push({ id: dev, name: null, model, manufacturer: maker, area_id: area ?? e.area_id, entry_type: null, disabled_by: null, via_device_id: null, labels: [] });
    else Object.assign(fx.devices.find(d => d.id === dev), { model, manufacturer: maker });
    const stem = id.replace(/^binary_sensor\./, '').replace(/_(contact|water_leak)$/, '');
    for (const [k, v] of sens) { const sid = `sensor.${stem}_${k}`; if (!fx.entities.some(x => x.entity_id === sid)) fx.entities.push({ entity_id: sid, device_id: dev, area_id: null, disabled_by: null, hidden_by: null, entity_category: 'diagnostic', platform: 'mqtt', device_class: k === 'battery' ? 'battery' : null, name: null, original_name: k }); set(sid, String(v), {}, 30); }
    if (id === 'binary_sensor.office_window_contact') { const lid = 'binary_sensor.office_window_battery_low'; fx.entities.push({ entity_id: lid, device_id: dev, area_id: null, disabled_by: null, hidden_by: null, entity_category: 'diagnostic', platform: 'mqtt', device_class: 'battery', name: null, original_name: 'battery low' }); set(lid, 'on', {}, 300); }
  }
  ENT(fx, 'valve.bath_water', 'vannaia', 'water', 'Ванная · Кран воды'); set('valve.bath_water', 'open', { friendly_name: 'Кран воды', device_class: 'water' }, 600);
  ENT(fx, 'alarm_control_panel.alarmo', null, null, 'Alarmo'); fx.entities.find(e => e.entity_id === 'alarm_control_panel.alarmo').platform = 'alarmo'; set('alarm_control_panel.alarmo', 'disarmed', { friendly_name: 'Alarmo', code_format: null, changed_by: null, arm_mode: null, bypassed_sensors: [] }, 95);
  // as applied in HA on 09.11: «Гости» is the heating's switch, «Отпуск» Alarmo's mode with the heating's return date, the exercise helpers
  add('input_boolean.heating_guests', null, null, 'Отопление · Гости', 'off', 900); add('input_datetime.heating_vacation_return', null, null, 'Отопление · Возвращение из отпуска', '2026-11-03 00:00:00', 9000);
  add('input_boolean.water_valve_exercise', null, null, 'Кран · Профилактика', 'on', 9000); add('input_datetime.water_valve_exercise_time', null, null, 'Кран · Профилактика, время', '03:00:00', 9000); add('input_number.water_valve_exercise_days', null, null, 'Кран · Профилактика, раз в дней', '7.0', 9000);
  // the sockets: devices labelled «розетки», eight of them on the vacation list (label «Отпуск: выключать»)
  const SOCKETS = { 'switch.living_appletv_plug': ['gostinaia', 'Гостиная · Розетка Apple TV', 1], 'switch.living_purifier_plug': ['gostinaia', 'Гостиная · Розетка очистителя воздуха', 1], 'switch.living_humidifier_plug': ['gostinaia', 'Гостиная · Розетка увлажнителя', 1], 'switch.living_yandex_max_plug': ['gostinaia', 'Гостиная · Розетка Яндекс Станции (Tapo P110)', 0], 'switch.office_monitor_plug': ['kompiuternaia', 'Розетка монитора', 1], 'switch.office_pc_plug': ['kompiuternaia', 'Розетка компьютера', 1], 'switch.office_yandex_plug': ['kompiuternaia', 'Розетка Яндекс Станции', 0], 'switch.kitchen_fridge_plug': ['kukhnia', 'Розетка холодильника', 0], 'switch.kitchen_kettle_plug': ['kukhnia', 'Розетка чайника', 1], 'switch.kitchen_boiler_plug': ['kukhnia', 'Розетка котла', 0], 'switch.hall_ups_plug': ['prikhozhaia', 'Розетка ИБП', 0], 'switch.bath_washer_socket': ['vannaia', 'Ванная · Розетка стиральной машины', 1], 'switch.bath_dryer_socket': ['vannaia', 'Ванная · Розетка сушильной машины', 1] };
  for (const [id, [area, name, off]] of Object.entries(SOCKETS)) {
    const dev = `dev_${id.split('.')[1]}`; if (!fx.devices.some(d => d.id === dev)) fx.devices.push({ id: dev, name, model: null, manufacturer: null, area_id: area, entry_type: null, disabled_by: null, via_device_id: null, labels: ['rozetki'] });
    let e = fx.entities.find(x => x.entity_id === id); if (!e) { ENT(fx, id, area, 'outlet', name); e = fx.entities.find(x => x.entity_id === id); }
    Object.assign(e, { device_id: dev, area_id: area, entity_category: null, labels: off ? ['otpusk_vykliuchat'] : [] }); if (!S[id]) set(id, 'on', { friendly_name: name }, 900);
  }
  for (const id of Object.keys(S)) if (id.startsWith('person.')) { delete S[id]; fx.entities = fx.entities.filter(e => e.entity_id !== id); }
  const person = (k, name, st, min) => { add(`person.${k}`, null, null, name, st, min); S[`person.${k}`].attributes.user_id = `u_${k}`; };
  const P = { all: ['home', 'home', 'home'], away: ['not_home', 'Atom Service', 'not_home'], one: ['not_home', 'home', 'Esperanza Sanitas'] }[sc.people ?? 'one'];
  person('ararat_melconean', 'Ararat Melconean', P[0], 40); person('gayane_grigorean', 'Gayane Grigorean', P[1], 300); person('daniela_melconean', 'Daniela Melconean', P[2], 200);
  const alarm = (state, attrs = {}, min = 20) => set('alarm_control_panel.alarmo', state, attrs, min);
  if (sc.state) alarm(sc.state, sc.alarmAttrs ?? {}, sc.alarmMin ?? 35);
  for (const [id, st, min] of sc.over ?? []) set(id, st, {}, min ?? 5);
  return fx;
}
// the panel's week from HA's logbook (logbook/get_events) in the shape HA answers: «Не дома» set by its automation, disarmed by a person, one alarm
const logFor = now => { const at = (d, h, m) => { const x = new Date(now); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.getTime() / 1000; }, A = 'alarm_control_panel.alarmo', auto = { context_domain: 'automation', context_entity_id: 'automation.bezopasnost_ne_doma_avtopostanovka', context_name: 'Безопасность · Не дома: автопостановка' };
  return [{ when: at(0, 8, 41), entity_id: A, state: 'arming', ...auto }, { when: at(0, 8, 42), entity_id: A, state: 'armed_away', ...auto }, { when: at(0, 10, 29), entity_id: A, state: 'disarmed', context_domain: 'automation', context_entity_id: 'automation.bezopasnost_ne_doma_avtosniatie', context_name: 'Безопасность · Не дома: автоснятие' },
    { when: at(1, 22, 5), entity_id: A, state: 'arming', context_user_id: 'u_gayane_grigorean' }, { when: at(1, 22, 6), entity_id: A, state: 'armed_home', context_user_id: 'u_gayane_grigorean' }, { when: at(1, 23, 40), entity_id: A, state: 'pending' }, { when: at(1, 23, 40), entity_id: A, state: 'disarmed', context_user_id: 'u_ararat_melconean' }]; };
export const card = {
  name: 'Безопасность', sheet: '#security', home: '#home', sheetRoot: '.at-sec-panel', tileRoot: '.at-sec-tile', actionButton: '.at-sec-main',
  scenarios: {
    disarmed: { people: 'one' },
    away: { people: 'away', state: 'armed_away', alarmMin: 95 },
    arming: { people: 'away', state: 'arming', alarmAttrs: { delay: 120, arm_mode: 'armed_away' }, alarmMin: 0.4, over: [['binary_sensor.kitchen_window_center_contact', 'on', 22]] },
    armedOpen: { people: 'away', state: 'armed_away', alarmAttrs: { bypassed_sensors: ['binary_sensor.kitchen_window_center_contact'] }, over: [['binary_sensor.kitchen_window_center_contact', 'on', 60]] },
    pending: { people: 'away', state: 'pending', alarmAttrs: { delay: 30 }, alarmMin: 0.2, over: [['binary_sensor.hall_door_contact', 'on', 0.2]] },
    triggered: { people: 'away', state: 'triggered', alarmMin: 1, over: [['binary_sensor.kids_window_contact', 'on', 1.5]] },
    guard: { people: 'one', state: 'armed_home', alarmMin: 50 },
    guests: { people: 'away', over: [['input_boolean.heating_guests', 'on', 180]] },
    vacation: { people: 'away', state: 'armed_vacation', alarmMin: 3000, over: [['input_datetime.heating_vacation_return', '2026-11-23 00:00:00', 3000], ['valve.bath_water', 'closed', 3000]] },
    leak: { people: 'one', over: [['binary_sensor.bath_leak_water_leak', 'on', 3], ['valve.bath_water', 'closed', 3]] },
    gas: { people: 'all', over: [['binary_sensor.kitchen_gas', 'on', 1]] },
    tamper: { people: 'all', over: [['binary_sensor.living_window_left_tamper', 'on', 7]] },
  },
  build: (base, s, now) => { const b = heating.build(base, heating.scenarios[Object.keys(heating.scenarios)[0]], now); return { ...b, snapshot: apply(b.snapshot, now, s), logbook: logFor(now) }; },
  config: (text, s) => heating.config(text, {}),
};
