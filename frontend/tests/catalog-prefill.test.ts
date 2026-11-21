// What «＋ Добавить карточку» fills in by itself, on the Criuleni snapshot of 21.11.2026 (all 17 appliance cards were added that day and the
// form's first guesses were checked one by one): a field takes only an entity with its own suffix, one entity is one field's, a card with no
// device is filled by the suffixes alone, and a second integration's copy and the appliance's socket are found by their names — or left empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Registry } from '../src/model/registry.ts';
import { PROFILES, candidates, devicesFor, profileById, stemOf, suggestBindings, suggestion, type Profile } from '../src/model/card-catalog.ts';

const live: Registry = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-registry-live-20261121.json', import.meta.url), 'utf8'));
const clone = (): Registry => structuredClone(live);
const P = (id: string): Profile => profileById(id)!;
/** The form's first bindings for the house's one device of this model. */
const first = (id: string, reg: Registry = live) => { const d = devicesFor(reg, P(id)); assert.equal(d.length, 1, `${id}: one device`); return suggestBindings(reg, P(id), d[0].id); };
const copyEntity = (reg: Registry, from: string, to: string, patch: Partial<Registry['entities'][number]> = {}) => { reg.entities.push({ ...reg.entities.find(e => e.entity_id === from)!, entity_id: to, ...patch }); reg.states[to] = { ...structuredClone(reg.states[from]), entity_id: to }; };

test('prefill: a field with a suffix is never filled with an entity that has not got it (the scale\'s «Импеданс» stays empty)', () => {
  const b = first('xiaomi.scale2');
  assert.equal(b.weight, 'sensor.home_scale_weight'); assert.equal(b.stable, 'binary_sensor.home_scale_stabilized');
  assert.equal(b.impedance, undefined, 'the scale has no impedance sensor: its weight is not one');
  // the rule itself: the device's only candidate fills a field with no suffix, never one whose suffix it lacks
  const c = [{ id: 'sensor.x_weight', name: 'x', areaId: null, value: '1', unit: 'kg', own: true, exact: false, score: 50 }];
  assert.equal(suggestion(c, { id: 'a', labelKey: 'a', required: false, domains: ['sensor'], source: 'own' }), 'sensor.x_weight');
  assert.equal(suggestion(c, { id: 'a', labelKey: 'a', required: false, domains: ['sensor'], source: 'own', suffix: /_impedance$/ }), undefined);
  // a scale that has the sensor gets it
  const reg = clone(); copyEntity(reg, 'sensor.home_scale_weight', 'sensor.home_scale_impedance');
  assert.equal(first('xiaomi.scale2', reg).impedance, 'sensor.home_scale_impedance');
});
test('prefill: one entity is never suggested for two fields; the main and the required fields choose first', () => {
  const dev = { id: 'dv', name: 'X', model: 'm.x', area_id: null } as Registry['devices'][number];
  const reg: Registry = { ...clone(), devices: [dev], entities: [{ entity_id: 'sensor.x_value', device_id: 'dv' } as Registry['entities'][number]], states: { 'sensor.x_value': { entity_id: 'sensor.x_value', state: '1', attributes: {} } as Registry['states'][string] } };
  const role = (id: string, required = false) => ({ id, labelKey: id, required, domains: ['sensor'], source: 'own' as const });
  const base: Profile = { ...P('xiaomi.scale2'), id: 't.x', models: ['m.x'], anchor: 'main', roles: [role('early'), role('needed', true), role('main', true)] };
  assert.deepEqual(suggestBindings(reg, base, 'dv'), { main: 'sensor.x_value' }, 'the main field wins over the fields before it');
  assert.deepEqual(suggestBindings(reg, { ...base, anchor: undefined }, 'dv'), { needed: 'sensor.x_value' }, 'then a required one, in its order');
  assert.deepEqual(suggestBindings(reg, { ...base, anchor: undefined, roles: [role('early'), role('late')] }, 'dv'), { early: 'sensor.x_value' }, 'then the fields in their order');
  // on the house: no card of any model gets one entity in two fields
  for (const p of PROFILES) for (const d of devicesFor(live, p)) { const v = Object.values(suggestBindings(live, p, d.id)); assert.equal(new Set(v).size, v.length, `${p.id}: ${v}`); }
});
test('prefill: a card with no device is filled by the one entity that has the field\'s suffix (the dashcam)', () => {
  const b = suggestBindings(live, P('70mai.a810_up04'));
  for (const [role, id] of Object.entries({ tracker: 'device_tracker.car_dashcam', voltage: 'sensor.car_dashcam_battery_voltage', alarm: 'event.car_dashcam_alarm', network: 'sensor.car_dashcam_network_level', upload: 'binary_sensor.car_dashcam_monitor_upload', simPower: 'binary_sensor.car_dashcam_sim_out_power' })) assert.equal(b[role], id, role);
  // the house has no «last report» and no parking photo: nothing is put there
  assert.equal(b.lastReport, undefined); assert.equal(b.parkingPhoto, undefined);
  // two dashcams in one house: which one is the installer's choice
  const reg = clone(); for (const e of live.entities.filter(x => /car_dashcam/.test(x.entity_id))) copyEntity(reg, e.entity_id, e.entity_id.replace('car_dashcam', 'van_dashcam'));
  const two = suggestBindings(reg, P('70mai.a810_up04'));
  for (const role of ['tracker', 'voltage', 'alarm', 'network', 'upload', 'simPower', 'firmware']) assert.equal(two[role], undefined, role);
});
test('prefill: the gas meter read by a camera — its camera and its last reading by their suffixes; a field with no suffix is not guessed', () => {
  const gas = P('meter.gas_camera'), b = suggestBindings(live, gas);
  assert.equal(b.camera, 'camera.kitchen_gas_meter'); assert.equal(b.lastRead, 'input_datetime.kitchen_gas_meter_last_read');
  // a field without a suffix stays the installer's, though the house has one gas sensor only
  const noSuffix = { ...gas, roles: gas.roles.map(r => ({ ...r, suffix: undefined })) };
  assert.deepEqual(suggestBindings(live, noSuffix), {});
});
test('prefill: the same appliance through a second integration is found by the main entity\'s name, or by the twin device of the room', () => {
  assert.equal(first('hisense.55u6').airplay, 'media_player.kids_tv_airplay');
  const s = first('samsung.q60t');
  assert.equal(s.smartthings, 'media_player.bedroom_tv_smartthings'); assert.equal(s.channel, 'sensor.bedroom_tv_channel'); assert.equal(s.channelName, 'sensor.bedroom_tv_channel_name');
  assert.equal(s.pictureMode, undefined, 'SmartThings\' picture mode is not named after the TV here: the installer picks it');
  const dryer = P('samsung.dryer_dv8400'), cloud = first(dryer.id).cloud;
  assert.match(cloud, /smartthings.*_progress$/);
  const dryerDev = devicesFor(live, dryer)[0], cloudDev = live.devices.find(d => d.id === live.entities.find(e => e.entity_id === cloud)!.device_id)!;
  assert.notEqual(cloudDev.id, dryerDev.id); assert.equal(cloudDev.model, 'DA_WM_TP1_21_COMMON'); assert.equal(cloudDev.area_id, dryerDev.areaId);
  // two copies named after the TV: nothing is picked
  const two = clone(); copyEntity(two, 'media_player.kids_tv_airplay', 'media_player.kids_tv_cast');
  assert.equal(first('hisense.55u6', two).airplay, undefined);
  // the twin in another room is not this appliance; a twin of another model is not either
  const far = clone(); far.devices.find(d => d.id === cloudDev.id)!.area_id = 'kukhnia'; assert.equal(first(dryer.id, far).cloud, undefined);
  const other = clone(); other.devices.find(d => d.id === cloudDev.id)!.model = 'DA_WM_OTHER'; assert.equal(first(dryer.id, other).cloud, undefined);
  // a twin with two live entities: which of them is the installer's choice
  const busy = clone(); copyEntity(busy, cloud, 'sensor.bath_dryer_cloud_job_state');
  assert.equal(first(dryer.id, busy).cloud, undefined);
});
test('prefill: the appliance\'s socket is found by the appliance\'s own name; a socket called otherwise is left to the installer', () => {
  assert.equal(stemOf(['bath_washer_current_status', 'bath_washer_power']), 'bath_washer'); assert.equal(stemOf(['living_humidifier', 'living_humidifier_fan_level']), 'living_humidifier');
  assert.equal(stemOf(['living_humidifier']), 'living_humidifier'); assert.equal(stemOf(['bath_dryer_stage', 'vannaia_drum_light']), ''); assert.equal(stemOf([]), '');
  const h = first('xiaomi.humidifier2'); assert.equal(h.plug, 'switch.living_humidifier_plug'); assert.equal(h.plugPower, 'sensor.living_humidifier_plug_power');
  const w = first('lg.washer_f_r7'); assert.equal(w.plugPower, 'sensor.bath_washer_socket_power'); assert.equal(w.plugEnergy, 'sensor.bath_washer_socket_energy_total'); assert.equal(w.plugToday, 'sensor.bath_washer_socket_energy_today');
  assert.equal(w.power, 'switch.bath_washer_power', 'the washer\'s own power button is still its own');
  const m = first('yandex.station_max'); assert.equal(m.plug, 'switch.living_yandex_max_plug', 'the socket, not its LED or auto-off settings'); assert.equal(m.power, 'sensor.living_yandex_max_plug_power');
  // «office_yandex_lite» and «office_yandex_plug» do not line up: not guessed, though the socket stands in the same room and is offered
  const lite = P('yandex.station_lite'), l = first(lite.id); assert.equal(l.plug, undefined); assert.equal(l.power, undefined);
  assert.ok(candidates(live, lite.roles.find(r => r.id === 'plug')!, { deviceId: devicesFor(live, lite)[0].id }).some(c => c.id === 'switch.office_yandex_plug'));
  // two sockets named after the appliance: nothing is picked
  const two = clone(); copyEntity(two, 'switch.living_humidifier_plug', 'switch.living_humidifier_socket');
  assert.equal(first('xiaomi.humidifier2', two).plug, undefined);
  // the appliance's own entity is never its socket
  for (const id of ['xiaomi.humidifier2', 'lg.washer_f_r7', 'yandex.station_max']) { const dev = devicesFor(live, P(id))[0].id, b = first(id); for (const r of P(id).roles.filter(x => x.plug)) if (b[r.id]) assert.notEqual(live.entities.find(e => e.entity_id === b[r.id])!.device_id, dev, `${id}.${r.id}`); }
});
