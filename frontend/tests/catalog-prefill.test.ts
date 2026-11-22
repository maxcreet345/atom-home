// What «＋ Добавить карточку» fills in by itself, on the Criuleni snapshot of 21.11.2026 (all 17 appliance cards were added that day and the
// form's first guesses were checked one by one): a field takes only an entity with its own suffix, one entity is one field's, a card with no
// device is filled by the suffixes alone, and a second integration's copy and the appliance's socket are found by their names — or left empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { Registry } from '../src/model/registry.ts';
import { PROFILES, anchorRoom, candidates, cardDevice, defaultPlacement, devicesFor, instanceViews, likelyBindings, profileById, roomCards, shownInRoom, siblingDevices, stemOf, suggestBindings, suggestion, type Profile, type ProfileInstance } from '../src/model/card-catalog.ts';
import { readRoom } from '../src/model/room.ts';

const FIXTURE = new URL('../../private/fixtures/criuleni-registry-live-20261121.json', import.meta.url), have = existsSync(FIXTURE), skip = !have && 'no house fixture';
const live: Registry = have ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : { areas: [], devices: [], entities: [], states: {} } as unknown as Registry;
const clone = (): Registry => structuredClone(live);
const P = (id: string): Profile => profileById(id)!;
/** The form's first bindings for the house's one device of this model. */
const first = (id: string, reg: Registry = live) => { const d = devicesFor(reg, P(id)); assert.equal(d.length, 1, `${id}: one device`); return suggestBindings(reg, P(id), d[0].id); };
const copyEntity = (reg: Registry, from: string, to: string, patch: Partial<Registry['entities'][number]> = {}) => { reg.entities.push({ ...reg.entities.find(e => e.entity_id === from)!, entity_id: to, ...patch }); reg.states[to] = { ...structuredClone(reg.states[from]), entity_id: to }; };

test('prefill: a field with a suffix is never filled with an entity that has not got it (the scale\'s «Импеданс» stays empty)', { skip }, () => {
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
test('prefill: one entity is never suggested for two fields; the main and the required fields choose first', { skip }, () => {
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
test('prefill: a card with no device is filled by the one entity that has the field\'s suffix (the dashcam)', { skip }, () => {
  const b = suggestBindings(live, P('70mai.a810_up04'));
  for (const [role, id] of Object.entries({ tracker: 'device_tracker.car_dashcam', voltage: 'sensor.car_dashcam_battery_voltage', alarm: 'event.car_dashcam_alarm', network: 'sensor.car_dashcam_network_level', upload: 'binary_sensor.car_dashcam_monitor_upload', simPower: 'binary_sensor.car_dashcam_sim_out_power' })) assert.equal(b[role], id, role);
  // eight «…_firmware» sensors in the house (sockets, drives): the dashcam's is the one on the tracker's own device, and not its modem's
  assert.equal(b.firmware, 'sensor.car_dashcam_firmware');
  // the house has no «last report» and no parking photo: nothing is put there
  assert.equal(b.lastReport, undefined); assert.equal(b.parkingPhoto, undefined);
  // two dashcams in one house: which one is the installer's choice
  const reg = clone(); for (const e of live.entities.filter(x => /car_dashcam/.test(x.entity_id))) copyEntity(reg, e.entity_id, e.entity_id.replace('car_dashcam', 'van_dashcam'));
  const two = suggestBindings(reg, P('70mai.a810_up04'));
  for (const role of ['tracker', 'voltage', 'alarm', 'network', 'upload', 'simPower', 'firmware']) assert.equal(two[role], undefined, role);
});
test('prefill: the gas meter read by a camera — every field by its suffix, the answer among 23 «…_raw» by the meter\'s name; a field with no suffix is not guessed', { skip }, () => {
  const gas = P('meter.gas_camera'), b = suggestBindings(live, gas);
  assert.deepEqual(b, { meter: 'sensor.kitchen_gas_meter', camera: 'camera.kitchen_gas_meter', lastRead: 'input_datetime.kitchen_gas_meter_last_read', answer: 'input_text.kitchen_gas_meter_raw' });
  assert.ok(candidates(live, gas.roles.find(r => r.id === 'answer')!, {}).filter(c => c.exact).length > 1, 'the suffix alone would not tell');
  // a second meter in the house: which one is the installer's choice, and nothing is filled after it
  const two = clone(); copyEntity(two, 'sensor.kitchen_gas_meter', 'sensor.boiler_gas_meter'); copyEntity(two, 'input_text.kitchen_gas_meter_raw', 'input_text.boiler_gas_meter_raw');
  const t2 = suggestBindings(two, gas); assert.equal(t2.meter, undefined); assert.equal(t2.answer, undefined);
  // a field without a suffix stays the installer's, though the house has one gas sensor only
  const noSuffix = { ...gas, roles: gas.roles.map(r => ({ ...r, suffix: undefined })) };
  assert.deepEqual(suggestBindings(live, noSuffix), {});
});
test('prefill: the same appliance through a second integration is found by the main entity\'s name, or by the twin device of the room', { skip }, () => {
  assert.equal(first('hisense.55u6').airplay, 'media_player.kids_tv_airplay');
  const s = first('samsung.q60t');
  assert.equal(s.smartthings, 'media_player.bedroom_tv_smartthings'); assert.equal(s.channel, 'sensor.bedroom_tv_channel'); assert.equal(s.channelName, 'sensor.bedroom_tv_channel_name');
  // SmartThings' picture mode is not named after the TV here: it is taken because it stands on the HA device of SmartThings' player, already found
  assert.equal(s.pictureMode, 'select.spalnia_spalnia_televizor_smartthings_samsung_qe50q60t_picture_mode');
  assert.equal(live.entities.find(e => e.entity_id === s.pictureMode)!.device_id, live.entities.find(e => e.entity_id === s.smartthings)!.device_id);
  // …a picture mode of another device of the room is not; with SmartThings' player not found, nothing is; two on that device are the installer's choice
  { const sel = s.pictureMode, r1 = clone(); r1.entities.find(e => e.entity_id === sel)!.device_id = live.entities.find(e => e.entity_id === 'media_player.bedroom_chromecast' || /chromecast/.test(e.entity_id) && e.entity_id.startsWith('media_player.'))?.device_id ?? 'nobody';
    assert.equal(first('samsung.q60t', r1).pictureMode, undefined, 'another device\'s');
    const r2 = clone(); copyEntity(r2, s.smartthings, 'media_player.bedroom_tv_cast'); assert.equal(first('samsung.q60t', r2).smartthings, undefined); assert.equal(first('samsung.q60t', r2).pictureMode, undefined, 'no copy found: no device to look on');
    const r3 = clone(); copyEntity(r3, sel, 'select.spalnia_second_picture_mode'); assert.equal(first('samsung.q60t', r3).pictureMode, undefined, 'two of them'); }
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
test('prefill: the appliance\'s socket is found by the appliance\'s own name; a socket called otherwise is left to the installer', { skip }, () => {
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

// ---- the room page: every card put «В комнате» is drawn there once (model/card-catalog.ts roomCards) ----
const card = (profileId: string, bindings: Record<string, string>, extra: Partial<ProfileInstance> = {}): ProfileInstance => ({ profileId, profileVersion: '1.0.0', bindings, placement: ['room'], ...extra });
const roomName = (a: string) => live.areas.find(x => x.area_id === a)?.name ?? null;
/** The tiles a room draws (model/room.ts) and the plan of the catalog's cards over them. */
const plan = (roomId: string, all: Record<string, ProfileInstance>, reg: Registry = live) => { const m = readRoom(reg, roomId, roomName(roomId) ?? '', null, null), things = [...m.things, ...m.air]; return { things, ...roomCards(reg, instanceViews(reg, all, roomName), roomId, things) }; };
const GAS = card('meter.gas_camera', { meter: 'sensor.kitchen_gas_meter', camera: 'camera.kitchen_gas_meter', lastRead: 'input_datetime.kitchen_gas_meter_last_read', answer: 'input_text.kitchen_gas_meter_raw' }, { roomId: 'kukhnia' });
const nas = () => { const d = devicesFor(live, P('ugreen.dxp2800'))[0]; return { dev: d, inst: card('ugreen.dxp2800', suggestBindings(live, P('ugreen.dxp2800'), d.id), { deviceId: d.id }) }; };
const drawnOnce = (p: ReturnType<typeof plan>, id: string) => [...p.own.values()].filter(v => v && v.id === id).length + p.extra.filter(v => v.id === id).length;

test('room page: a card whose device is none of the room\'s tiles is still drawn there (the NAS in the Hall)', { skip }, () => {
  const { dev, inst } = nas(); assert.equal(dev.areaId, 'prikhozhaia');
  const p = plan('prikhozhaia', { nas: inst });
  assert.ok(!p.things.some(t => t.key === dev.id), 'the NAS is no «thing» of the Hall: nothing to switch, no watts');
  assert.deepEqual(p.extra.map(v => v.id), ['nas']); assert.equal(drawnOnce(p, 'nas'), 1);
  // on Home only: not in the room; in another room: there, not here
  assert.equal(drawnOnce(plan('prikhozhaia', { nas: { ...inst, placement: ['home'] } }), 'nas'), 0);
  assert.equal(drawnOnce(plan('prikhozhaia', { nas: { ...inst, roomId: 'kukhnia' } }), 'nas'), 0); assert.equal(drawnOnce(plan('kukhnia', { nas: { ...inst, roomId: 'kukhnia' } }), 'nas'), 1);
});
test('room page: a card with no device stands for the device of its main field — one «Счётчик газа» in the Kitchen, not two', { skip }, () => {
  const gasDev = live.entities.find(e => e.entity_id === 'sensor.kitchen_gas_meter')!.device_id!;
  assert.equal(cardDevice(live, GAS), gasDev); assert.equal(cardDevice(live, { ...GAS, bindings: {} }), null);
  const bare = plan('kukhnia', {}); assert.ok(bare.things.some(t => t.key === gasDev), 'without the card the camera\'s device has a tile of its own');
  const p = plan('kukhnia', { gas: GAS });
  assert.equal(drawnOnce(p, 'gas'), 1); assert.equal((p.own.get(gasDev) || null)?.id, 'gas', 'the card takes the device\'s place: no second tile');
  // the card on Home only: its device has no tile of its own in the Kitchen either (the card stands for it, as for any appliance)
  const home = plan('kukhnia', { gas: { ...GAS, placement: ['home'] } }); assert.equal(home.own.get(gasDev), false); assert.equal(drawnOnce(home, 'gas'), 0);
  // a heating card is not an appliance: it claims no device by its thermostat
  assert.equal(cardDevice(live, card('heating.single', { thermostat: 'climate.kitchen_trv' })), null);
});
test('room page: on the house with every appliance card added, each card of a room is drawn exactly once and a card\'s device has no second tile', { skip }, () => {
  const all: Record<string, ProfileInstance> = { gas: GAS, dash: card('70mai.a810_up04', suggestBindings(live, P('70mai.a810_up04'))) };
  for (const p of PROFILES.filter(x => x.renderer === 'appliance' && x.models.length)) for (const d of devicesFor(live, p)) all[`c${Object.keys(all).length}`] = card(p.id, suggestBindings(live, p, d.id), { deviceId: d.id });
  const views = instanceViews(live, all, roomName); assert.ok(views.length >= 17, `${views.length} cards`);
  for (const area of [...live.areas.map(a => a.area_id), 'none']) {
    const p = plan(area, all), here = views.filter(v => shownInRoom(v, area));
    for (const v of here) assert.equal(drawnOnce(p, v.id), 1, `${area}: ${v.profile.id}`);
    assert.equal([...p.own.values()].filter(Boolean).length + p.extra.length, here.length, `${area}: nothing else is drawn as a card`);
    // no plain tile is left for a device a card stands for (its own device, or its copy through a second integration)
    for (const th of p.things) if (!p.own.has(th.key)) for (const v of views) { assert.notEqual(cardDevice(live, v.instance, v.profile), th.key, `${area}: ${th.name}`); assert.ok(!siblingDevices(live, v.instance).has(th.key), `${area}: ${th.name} is ${v.profile.id}'s copy`); }
  }
  assert.ok(views.every(v => v.incomplete.length === 0), views.filter(v => v.incomplete.length).map(v => `${v.profile.id}: ${v.incomplete}`).join('; '));
});

// ---- where a new card goes by default (ui/catalog.tsx) ----
test('a new card goes «В комнате» when it has a room and may stand in one; else to the profile\'s first place', { skip }, () => {
  const tv = P('hisense.55u6'), gas = P('meter.gas_camera');
  assert.deepEqual(tv.places, ['home', 'room']);
  assert.deepEqual(defaultPlacement(tv, 'detskaia'), ['room']); assert.deepEqual(defaultPlacement(tv, null), ['home']); assert.deepEqual(defaultPlacement(tv, ''), ['home']); assert.deepEqual(defaultPlacement(tv, 'none'), ['home']);
  assert.deepEqual(defaultPlacement(P('heating.rooms'), 'kukhnia'), ['home'], 'a card that cannot stand in a room'); assert.deepEqual(defaultPlacement(P('xiaomi.kettle2pro'), 'kukhnia'), [], 'a card that draws itself has no place to choose');
  // a card with no device has no room until the installer picks one: its first place, then «В комнате» with the room
  assert.deepEqual(defaultPlacement(gas, undefined), ['home']); assert.deepEqual(defaultPlacement(gas, 'kukhnia'), ['room']);
  // every appliance card of the house, added from Home with nothing touched, lands in its device's room (the scale has none: Home)
  for (const p of PROFILES.filter(x => x.renderer === 'appliance' && x.models.length)) for (const d of devicesFor(live, p)) assert.deepEqual(defaultPlacement(p, d.areaId), d.areaId ? ['room'] : ['home'], p.id);
});

test('prefill: a socket is the appliance\'s only by its whole name — a second humidifier\'s, or the room\'s other socket, is not taken', { skip }, () => {
  const rename = (reg: Registry, from: string, to: string) => { const e = reg.entities.find(x => x.entity_id === from)!; e.entity_id = to; reg.states[to] = { ...reg.states[from], entity_id: to } as never; delete reg.states[from]; };
  assert.equal(first('xiaomi.humidifier2').plug, 'switch.living_humidifier_plug');
  const second = clone(); rename(second, 'switch.living_humidifier_plug', 'switch.living_humidifier_2_plug');
  assert.equal(first('xiaomi.humidifier2', second).plug, undefined, '«…_humidifier_2_plug» is another humidifier\'s socket');
  const other = clone(); rename(other, 'switch.living_humidifier_plug', 'switch.living_tv_plug');
  assert.equal(first('xiaomi.humidifier2', other).plug, undefined, 'the room\'s word alone names no socket');
});

// ---- 1.36.2: the leftovers of 1.36.1 ----
test('prefill: the appliance\'s name is what three in four of its entities share — the dryer\'s socket is found past its one oddly named light', { skip }, () => {
  assert.equal(stemOf([...Array.from({ length: 9 }, (_, i) => `bath_dryer_x${i}`), 'vannaia_drum_light']), 'bath_dryer');
  assert.equal(stemOf(['a_b_x', 'a_b_y', 'a_b_z', 'a_c']), 'a_b'); assert.equal(stemOf(['a_b_x', 'a_b_y', 'a_c']), 'a', 'two of three is not enough');
  assert.equal(stemOf(['bath_dryer_a', 'bath_dryer_b', 'vannaia_c', 'vannaia_d']), '', 'named two ways half and half: no name');
  const d = first('samsung.dryer_dv8400');
  assert.equal(d.plugPower, 'sensor.bath_dryer_socket_power'); assert.equal(d.plugEnergy, 'sensor.bath_dryer_socket_energy_total'); assert.equal(d.plugToday, 'sensor.bath_dryer_socket_energy_today');
  const dev = devicesFor(live, P('samsung.dryer_dv8400'))[0].id; for (const r of ['plugPower', 'plugEnergy', 'plugToday']) assert.notEqual(live.entities.find(e => e.entity_id === d[r])!.device_id, dev);
  // the washer still gets its own socket, not the dryer's
  assert.equal(first('lg.washer_f_r7').plugPower, 'sensor.bath_washer_socket_power');
  // a dryer whose entities are named two ways half and half has no name: nothing is taken
  const half = clone(); let k = 0; for (const e of half.entities.filter(x => x.device_id === dev && half.states[x.entity_id])) if (k++ % 2) { const to = e.entity_id.replace(/\.[a-z0-9]+_[a-z0-9]+_/, '.vannaia_mashina_'); if (to !== e.entity_id && !half.states[to]) { half.states[to] = { ...half.states[e.entity_id], entity_id: to } as never; delete half.states[e.entity_id]; e.entity_id = to; } }
  const h = suggestBindings(half, P('samsung.dryer_dv8400'), dev); assert.equal(h.plugPower, undefined);
});
test('prefill: a socket called by the appliance\'s name without its last word is offered, never filled — and not when anything else is called so', { skip }, () => {
  const lite = P('yandex.station_lite'), dev = devicesFor(live, lite)[0].id, b = suggestBindings(live, lite, dev);
  assert.equal(b.plug, undefined); assert.equal(b.power, undefined);
  assert.deepEqual(likelyBindings(live, lite, dev, b), { plug: 'switch.office_yandex_plug', power: 'sensor.office_yandex_plug_power' });
  // taken by hand: no longer offered; nothing is offered for a field that is filled
  assert.deepEqual(likelyBindings(live, lite, dev, { ...b, plug: 'switch.office_yandex_plug' }), { power: 'sensor.office_yandex_plug_power' });
  // a second speaker of the room called «office_yandex_…»: the socket is nobody's
  const two = clone(); for (const e of live.entities.filter(x => /^[a-z_]+\.office_yandex_lite/.test(x.entity_id))) copyEntity(two, e.entity_id, e.entity_id.replace('office_yandex_lite', 'office_yandex_mini'), { device_id: 'second-speaker' });
  assert.deepEqual(likelyBindings(two, lite, dev, b), {});
  // two sockets called so: nobody's
  const twoSockets = clone(); copyEntity(twoSockets, 'switch.office_yandex_plug', 'switch.office_yandex_socket', { device_id: 'another-socket' });
  assert.deepEqual(likelyBindings(twoSockets, lite, dev, b), {});
  // the appliance has a socket of its whole name: the shorter name is not asked (Station Max, the humidifier, the washer)
  for (const id of ['yandex.station_max', 'xiaomi.humidifier2', 'lg.washer_f_r7', 'samsung.dryer_dv8400']) { const d = devicesFor(live, P(id))[0].id; assert.deepEqual(likelyBindings(live, P(id), d, suggestBindings(live, P(id), d)), {}, id); }
  // the room's word alone names nothing: the humidifier with its socket renamed «living_plug» is offered nothing
  const room = clone(); for (const e of room.entities.filter(x => /living_humidifier_plug/.test(x.entity_id))) { const to = e.entity_id.replace('living_humidifier_plug', 'living_plug'); room.states[to] = { ...room.states[e.entity_id], entity_id: to } as never; delete room.states[e.entity_id]; e.entity_id = to; }
  const hd = devicesFor(room, P('xiaomi.humidifier2'))[0].id; assert.deepEqual(likelyBindings(room, P('xiaomi.humidifier2'), hd, suggestBindings(room, P('xiaomi.humidifier2'), hd)), {});
  // on the house, with every card's first bindings: only the Lite is offered anything
  for (const p of PROFILES) for (const d of devicesFor(live, p)) { const l = likelyBindings(live, p, d.id, suggestBindings(live, p, d.id)); if (p.id !== lite.id) assert.deepEqual(l, {}, p.id); }
});
test('a card with no device stands in the room of its main field: the gas meter in the Kitchen, the dashcam in «Авто»', { skip }, () => {
  const gas = P('meter.gas_camera'), dash = P('70mai.a810_up04');
  assert.equal(anchorRoom(live, gas, suggestBindings(live, gas)), 'kukhnia'); assert.equal(anchorRoom(live, dash, suggestBindings(live, dash)), 'avto');
  assert.deepEqual(defaultPlacement(gas, anchorRoom(live, gas, suggestBindings(live, gas))), ['room']);
  assert.equal(anchorRoom(live, gas, {}), null, 'no main field yet: no room'); assert.equal(anchorRoom(live, P('hisense.55u6'), { tv: 'media_player.kids_tv' }), null, 'a card with a device follows its device, not this');
  const noArea = clone(); noArea.devices.find(d => d.id === live.entities.find(e => e.entity_id === 'sensor.kitchen_gas_meter')!.device_id)!.area_id = null;
  assert.equal(anchorRoom(noArea, gas, suggestBindings(noArea, gas)), null);
});
