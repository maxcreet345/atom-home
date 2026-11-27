import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAccess, normaliseRoles, resolveAccess, switchChoices, pickBuilding, scopeOf, scopeRegistry, rememberScope, deviceShown, controlPolicy, modeAllows, scopeConfig, hiddenSections, hiddenModules, mergeAlarms, accessUsers, starterAccess, copyRole, withoutRole, areaIndex, defaultAccess, NO_BUILDING, ALL_BUILDINGS, type AccessConfig } from '../src/model/access.ts';
import { defaultConfig, normaliseConfig, type HouseConfig, type Alarm } from '../src/model/config.ts';
import { discover } from '../src/model/discover.ts';
import type { Registry } from '../src/model/registry.ts';

// three buildings as the house has them (27.11.2026): «Главное здание», «Бухгалтерия», «Офис Dmlink»; «Двор» has no floor
const ent = (entity_id: string, device_id: string | null, area_id: string | null = null) => ({ entity_id, device_id, area_id, name: null, original_name: entity_id, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null });
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: '', last_updated: '' });
const reg: Registry = {
  floors: [{ floor_id: 'servis_i_shourum', name: 'Главное здание', level: 0 }, { floor_id: 'contabilitate', name: 'Бухгалтерия', level: 1 }, { floor_id: 'office', name: 'Офис Dmlink', level: 2 }],
  areas: [{ area_id: 'showroom', name: 'Шоурум', floor_id: 'servis_i_shourum' }, { area_id: 'kabinet', name: 'Кабинет бухгалтеров', floor_id: 'contabilitate' }, { area_id: 'dmlink', name: 'Офис', floor_id: 'office' }, { area_id: 'dvor', name: 'Двор', floor_id: null }],
  devices: [
    { id: 'lamp1', name: 'Люстра шоурум', area_id: 'showroom' }, { id: 'lamp2', name: 'Свет бухгалтерия', area_id: 'kabinet' }, { id: 'ac2', name: 'Кондиционер', area_id: 'kabinet' },
    { id: 'cam2', name: 'Камера', area_id: 'kabinet' }, { id: 'lamp3', name: 'Свет офис', area_id: 'dmlink' }, { id: 'yard', name: 'Прожектор', area_id: 'dvor' },
    { id: 'loose', name: 'Розетка без комнаты', area_id: null }, { id: 'met', name: 'Forecast', area_id: null, entry_type: 'service' },
  ],
  entities: [
    ent('light.showroom', 'lamp1'), ent('light.buh', 'lamp2'), ent('climate.buh', 'ac2'), ent('camera.buh', 'cam2'), ent('light.office', 'lamp3'), ent('light.yard', 'yard'),
    ent('switch.loose', 'loose'), ent('weather.home', 'met'), ent('person.ararat', null), ent('input_boolean.atom_alarm_ringing', null), ent('sensor.power_buh', null, 'kabinet'),
  ],
  states: { 'light.showroom': st('on'), 'light.buh': st('on'), 'climate.buh': st('heat', { temperature: 22 }), 'camera.buh': st('idle'), 'light.office': st('off'), 'light.yard': st('on'), 'switch.loose': st('on'), 'weather.home': st('sunny'), 'person.ararat': st('home'), 'input_boolean.atom_alarm_ringing': st('off'), 'sensor.power_buh': st('120', { unit_of_measurement: 'W', device_class: 'power' }) },
};
const FLOORS = reg.floors!.map(f => f.floor_id), TODAY = '2026-11-27';
const access = (over: Partial<AccessConfig> = {}): AccessConfig => ({ ...defaultAccess(), enabled: true, ...over });
const some = (a: ReturnType<typeof resolveAccess>) => { assert.equal(a.kind, 'some'); return a as Extract<typeof a, { kind: 'some' }>; };

test('switched off, or an administrator: the panel is as it was', () => {
  assert.deepEqual(resolveAccess(undefined, { id: 'u1', admin: false }, TODAY, FLOORS), { kind: 'open' });
  assert.deepEqual(resolveAccess({ ...access(), enabled: false, members: { u1: { buildings: { contabilitate: 'guest' } } } }, { id: 'u1', admin: false }, TODAY, FLOORS), { kind: 'open' });
  // an administrator cannot be locked out, whatever the settings name for them
  assert.deepEqual(resolveAccess(access({ members: { adm: { buildings: {} } } }), { id: 'adm', admin: true }, TODAY, FLOORS), { kind: 'open' });
});
test('a person nobody named sees nothing — or the default building, when the owner said so', () => {
  assert.deepEqual(resolveAccess(access(), { id: 'new', admin: false }, TODAY, FLOORS), { kind: 'none', why: 'unassigned' });
  const a = some(resolveAccess(access({ newUsers: 'default', defaultBuilding: 'contabilitate', defaultRole: 'guest' }), { id: 'new', admin: false }, TODAY, FLOORS));
  assert.deepEqual(a.buildings, { contabilitate: 'guest' }); assert.equal(a.via, 'default');
  // a default that names a building or a role that is gone gives nothing, never everything
  assert.equal(resolveAccess(access({ newUsers: 'default', defaultBuilding: 'gone', defaultRole: 'guest' }), { id: 'new', admin: false }, TODAY, FLOORS).kind, 'none');
});
test('a role per building, several buildings, «Все здания» with the yard', () => {
  const two = some(resolveAccess(access({ members: { u1: { buildings: { contabilitate: 'staff', office: 'guest', gone: 'staff', servis_i_shourum: 'nosuchrole' } } } }), { id: 'u1', admin: false }, TODAY, FLOORS));
  assert.deepEqual(two.buildings, { contabilitate: 'staff', office: 'guest' });
  assert.deepEqual(switchChoices(two, reg.floors), ['contabilitate', 'office', ALL_BUILDINGS]);
  assert.equal(pickBuilding(switchChoices(two, reg.floors), 'office'), 'office', 'the last choice on this screen');
  assert.equal(pickBuilding(switchChoices(two, reg.floors), 'servis_i_shourum'), 'contabilitate', 'a remembered building no longer allowed: the first one');
  const all = some(resolveAccess(access({ members: { u2: { all: true, role: 'manager' } } }), { id: 'u2', admin: false }, TODAY, FLOORS));
  assert.deepEqual(Object.keys(all.buildings).sort(), [NO_BUILDING, ...FLOORS].sort());
  const one = some(resolveAccess(access({ members: { u3: { buildings: { contabilitate: 'staff' } } } }), { id: 'u3', admin: false }, TODAY, FLOORS));
  assert.deepEqual(switchChoices(one, reg.floors), ['contabilitate'], 'one building: no switcher');
});
test('temporary access ends after its last day (the house\'s day)', () => {
  const a = access({ members: { u1: { buildings: { contabilitate: 'staff' }, until: '2026-11-27' } } });
  assert.equal(resolveAccess(a, { id: 'u1', admin: false }, '2026-11-27', FLOORS).kind, 'some', 'the last day itself is still in');
  assert.deepEqual(resolveAccess(a, { id: 'u1', admin: false }, '2026-11-28', FLOORS), { kind: 'none', why: 'expired' });
});
test('a bound tablet: its building and role win over the person\'s own, never over an administrator', () => {
  const a = access({ members: { tableta: { all: true, role: 'manager' } }, profiles: { 'planshet-buh': { building: 'contabilitate', role: 'tablet' } } });
  const tab = some(resolveAccess(a, { id: 'tableta', admin: false, profile: 'planshet-buh' }, TODAY, FLOORS));
  assert.deepEqual(tab.buildings, { contabilitate: 'tablet' }); assert.equal(tab.via, 'profile');
  assert.equal(some(resolveAccess(a, { id: 'tableta', admin: false, profile: 'other' }, TODAY, FLOORS)).via, 'member');
  assert.equal(resolveAccess(a, { id: 'adm', admin: true, profile: 'planshet-buh' }, TODAY, FLOORS).kind, 'open');
  // the binding never WIDENS: anyone may pick a named screen in «Расставить» (security review 27.11.2026)
  const b = access({ members: { guest: { buildings: { office: 'guest' } }, buh: { buildings: { contabilitate: 'guest' } }, old: { buildings: { contabilitate: 'staff' }, until: '2026-11-01' } }, profiles: { 'planshet-buh': { building: 'contabilitate', role: 'manager' } } });
  assert.equal(resolveAccess(b, { id: 'nobody', admin: false, profile: 'planshet-buh' }, TODAY, FLOORS).kind, 'none', 'a person with nothing gets nothing on a bound screen');
  assert.deepEqual(some(resolveAccess(b, { id: 'guest', admin: false, profile: 'planshet-buh' }, TODAY, FLOORS)).buildings, { office: 'guest' }, 'another building\'s screen: their own access, not the screen\'s');
  assert.deepEqual(some(resolveAccess(b, { id: 'buh', admin: false, profile: 'planshet-buh' }, TODAY, FLOORS)).buildings, { contabilitate: 'manager' }, 'their building: the screen\'s role decides there');
  assert.deepEqual(resolveAccess(b, { id: 'old', admin: false, profile: 'planshet-buh' }, TODAY, FLOORS), { kind: 'none', why: 'expired' }, 'an ended access stays ended on a bound screen');
});
test('inherited object keys are never buildings or roles', () => {
  const a = access({ members: { u1: { buildings: { contabilitate: 'staff' } } } });
  const r = resolveAccess(a, { id: 'u1', admin: false }, TODAY, [...FLOORS, 'constructor', 'toString']);
  assert.deepEqual(some(r).buildings, { contabilitate: 'staff' });
  assert.deepEqual(switchChoices(some(r), [...reg.floors!, { floor_id: 'constructor', name: 'X', level: 9 }]), ['contabilitate']);
  assert.equal(resolveAccess(a, { id: 'constructor', admin: false }, TODAY, FLOORS).kind, 'none');
  const n = normaliseAccess({ roles: { __proto__: { name: 'x' }, constructor: { name: 'y' }, ok: { name: 'z' } }, members: { constructor: { all: true, role: 'ok' } } })!;
  assert.deepEqual(Object.keys(n.roles), ['ok']); assert.deepEqual(n.members, {});
});

const scopeFor = (a: AccessConfig, user: string, shown = ALL_BUILDINGS) => scopeOf(a, some(resolveAccess(a, { id: user, admin: false }, TODAY, FLOORS)), shown);
test('role × building × device: the registry keeps only the rooms of the buildings shown', () => {
  const a = access({ members: { u1: { buildings: { contabilitate: 'staff' } } } });
  const r = scopeRegistry(reg, scopeFor(a, 'u1'), {});
  assert.deepEqual(r.areas.map(x => x.area_id), ['kabinet']);
  assert.deepEqual(r.floors?.map(f => f.floor_id), ['contabilitate']);
  const ids = r.entities.map(e => e.entity_id);
  assert.ok(ids.includes('light.buh') && ids.includes('climate.buh') && ids.includes('sensor.power_buh'));
  assert.ok(!ids.includes('light.showroom') && !ids.includes('light.office') && !ids.includes('light.yard'), 'other buildings and the yard are gone');
  assert.ok(!ids.includes('camera.buh'), '«Сотрудник» has no cameras');
  assert.ok(ids.includes('switch.loose'), 'a device of no room stays for the house\'s readings…');
  assert.equal(discover(r, defaultConfig()).devices.filter(d => d.primary.id === 'switch.loose' && deviceShown(d, scopeFor(a, 'u1'), areaIndex(reg.areas), {})).length, 0, '…but its card is the administrator\'s («Без комнаты»)');
  assert.ok(ids.includes('weather.home') && ids.includes('person.ararat') && ids.includes('input_boolean.atom_alarm_ringing'), 'the house\'s own stays (weather, people, helpers)');
  assert.equal(r.states['light.showroom'], undefined); assert.ok(r.states['light.buh']);
  assert.deepEqual(r.devices.map(d => d.id).sort(), ['ac2', 'lamp2', 'loose', 'met']);
  // the house model built on it: only the accountants' room and its devices
  const home = discover(r, defaultConfig());
  assert.deepEqual(home.rooms.filter(x => x.id !== 'none').map(x => x.id), ['kabinet']);
  const shown = home.devices.filter(d => deviceShown(d, scopeFor(a, 'u1'), areaIndex(reg.areas), {}));
  assert.ok(shown.length > 0 && shown.every(d => d.roomId === 'kabinet' || d.kind === 'weather'), 'the cards of no room (a helper, a person) are not drawn for them');
  // the guard sees the cameras of their building
  const g = scopeRegistry(reg, scopeFor(access({ members: { u4: { buildings: { contabilitate: 'guard' } } } }), 'u4'), {});
  assert.ok(g.entities.some(e => e.entity_id === 'camera.buh'));
});
test('«Кому видно»: only the roles named see the device; the owner\'s move to a room counts', () => {
  const a = access({ members: { u1: { buildings: { contabilitate: 'staff' } }, u2: { buildings: { contabilitate: 'manager' } } } });
  const cfg: HouseConfig['devices'] = { 'd:ac2': { roles: ['manager'] }, 'e:light.showroom': { roomId: 'kabinet' } };
  const staff = scopeRegistry(reg, scopeFor(a, 'u1'), cfg).entities.map(e => e.entity_id), boss = scopeRegistry(reg, scopeFor(a, 'u2'), cfg).entities.map(e => e.entity_id);
  assert.ok(!staff.includes('climate.buh') && boss.includes('climate.buh'));
  assert.ok(staff.includes('light.showroom'), 'a lamp moved into the accountants\' room in «Устройства» is theirs');
  const idx = areaIndex(reg.areas), sc = scopeFor(a, 'u1');
  assert.equal(deviceShown({ key: 'd:ac2', roomId: 'kabinet', kind: 'climate', haDeviceId: 'ac2' }, sc, idx, cfg), false);
  assert.equal(deviceShown({ key: 'e:climate.buh', roomId: 'kabinet', kind: 'climate', haDeviceId: 'ac2' }, sc, idx, { 'e:climate.buh': { roles: ['staff'] } }), true);
  assert.equal(deviceShown({ key: 'e:light.x', roomId: 'none', kind: 'light', haDeviceId: null }, sc, idx, {}), false, '«Без комнаты» is the administrator\'s');
  assert.equal(deviceShown({ key: 'd:met', roomId: 'none', kind: 'weather', haDeviceId: 'met' }, sc, idx, {}), true);
  assert.equal(deviceShown({ key: 'e:light.office', roomId: 'dmlink', kind: 'light', haDeviceId: 'lamp3' }, sc, idx, {}), false);
  assert.deepEqual(normaliseRoles(['staff', 'staff', 3, 'bad key!']), ['staff']); assert.equal(normaliseRoles(undefined), undefined);
});
test('hiding a card or a camera never reshapes its device into other cards', () => {
  const r2: Registry = { ...reg, devices: [...reg.devices, { id: 'plug', name: 'Розетка с ваттметром', area_id: 'kabinet' }, { id: 'cam9', name: 'Камера 2', area_id: 'kabinet' }, { id: 'alarmo_dev', name: 'Alarmo', area_id: null }],
    entities: [...reg.entities, ent('switch.plug', 'plug'), ent('sensor.plug_power', 'plug'), ent('camera.cam9', 'cam9'), ent('switch.cam9_privacy', 'cam9'), ent('binary_sensor.cam9_motion', 'cam9'), ent('alarm_control_panel.alarmo', 'alarmo_dev')],
    states: { ...reg.states, 'switch.plug': st('on', { device_class: 'outlet' }), 'sensor.plug_power': st('35', { device_class: 'power', unit_of_measurement: 'W' }), 'camera.cam9': st('idle'), 'switch.cam9_privacy': st('off'), 'binary_sensor.cam9_motion': st('off', { device_class: 'motion' }), 'alarm_control_panel.alarmo': st('disarmed') } };
  const a = access({ members: { u1: { buildings: { contabilitate: 'staff' } }, u4: { buildings: { contabilitate: 'guard' } } } }), idx = areaIndex(r2.areas);
  const cfg: HouseConfig['devices'] = { 'e:switch.plug': { roles: ['manager'] } };
  const cards = (user: string) => { const sc = scopeFor(a, user), r = scopeRegistry(r2, sc, cfg); return discover(r, { ...defaultConfig(), devices: cfg }).devices.filter(d => deviceShown(d, sc, idx, cfg)); };
  const staff = cards('u1'), guard = cards('u4');
  assert.equal(staff.filter(d => d.haDeviceId === 'plug').length, 0, 'the metering socket hidden by its card key: its power sensor does not come back as a card');
  assert.equal(staff.filter(d => d.haDeviceId === 'cam9').length, 0, 'no camera for «Сотрудник»: nor its privacy switch, nor its motion sensor');
  assert.ok(!scopeRegistry(r2, scopeFor(a, 'u1'), cfg).entities.some(e => e.entity_id === 'alarm_control_panel.alarmo'), 'Alarmo (its device has no room, as in a real house) is not shown to a role without «Охрана»');
  assert.ok(scopeRegistry(r2, scopeFor(a, 'u4'), cfg).entities.some(e => e.entity_id === 'alarm_control_panel.alarmo'), '…and is to «Охрана»');
  assert.ok(guard.some(d => d.haDeviceId === 'cam9' && d.kind === 'camera'), '«Охрана» sees the camera');
  assert.equal(guard.filter(d => d.haDeviceId === 'plug').length, 0, 'the socket is the manager\'s only');
  const boss = scopeFor(access({ members: { u2: { buildings: { contabilitate: 'manager' } } } }), 'u2');
  assert.ok(discover(scopeRegistry(r2, boss, cfg), { ...defaultConfig(), devices: cfg }).devices.some(d => d.key === 'e:switch.plug' && deviceShown(d, boss, idx, cfg)));
});
test('one building of several on the screen; the switcher\'s «Все здания» shows them all', () => {
  const a = access({ members: { u1: { buildings: { contabilitate: 'staff', office: 'guest' } } } });
  assert.deepEqual(scopeRegistry(reg, scopeFor(a, 'u1', 'office'), {}).areas.map(x => x.area_id), ['dmlink']);
  assert.deepEqual(scopeRegistry(reg, scopeFor(a, 'u1', ALL_BUILDINGS), {}).areas.map(x => x.area_id).sort(), ['dmlink', 'kabinet']);
});
test('modes: full presses anything, lights only lights and sockets, view nothing — per the building of the room', () => {
  assert.ok(modeAllows('full', 'climate')); assert.ok(modeAllows('lights', 'light')); assert.ok(modeAllows('lights', 'socket')); assert.ok(!modeAllows('lights', 'climate')); assert.ok(!modeAllows('view', 'light')); assert.ok(!modeAllows(undefined, 'light'));
  const a = access({ members: { u1: { buildings: { contabilitate: 'tablet', office: 'guest' } } } });
  const may = controlPolicy(reg, scopeFor(a, 'u1'), {});
  assert.ok(may('light.buh')); assert.ok(!may('climate.buh')); assert.ok(!may('light.office'), '«Гость» of the office only looks');
  assert.ok(may('switch.whatever_in_no_room'), 'a helper of no room: the widest mode shown (lights) lets a switch go');
  assert.ok(!may('input_number.x'));
  assert.ok(!may('light.showroom'), 'a building not shown: nothing');
});
test('the settings drawn: pages and cards of no role hidden, buttons and alarms of other buildings gone', () => {
  const a = access({ members: { u1: { buildings: { contabilitate: 'tablet' } } } }), sc = scopeFor(a, 'u1'), idx = areaIndex(reg.areas);
  assert.deepEqual(hiddenSections(sc), ['systems', 'cleaning', 'camera', 'energy', 'security']);
  assert.deepEqual(hiddenModules(sc, ['camera_go2rtc', 'doorbell', 'clock', 'boiler_ebus', 'kettle']), ['camera_go2rtc', 'doorbell']);
  assert.deepEqual(hiddenModules(scopeFor(access({ members: { u: { buildings: { contabilitate: 'guest' } } } }), 'u'), ['clock', 'boiler_ebus']), ['clock', 'boiler_ebus']);
  const alarm = (id: string, room: string): Alarm => normaliseConfig({ schemaVersion: 1, alarms: [{ id, room, time: '07:00' }] }).config.alarms[0];
  const cfg: HouseConfig = { ...defaultConfig(), sections: { lights: { hidden: false } }, alarms: [alarm('a1', 'kabinet'), alarm('a2', 'showroom')], buttons: [
    { id: 'b1', label: 'Свет', service: 'light.turn_on', target: { entity_id: 'light.buh' }, confirm: false },
    { id: 'b2', label: 'Климат', service: 'climate.turn_on', target: { entity_id: 'climate.buh' }, confirm: false },
    { id: 'b3', label: 'Шоурум', service: 'light.turn_on', target: { entity_id: 'light.showroom' }, confirm: false },
    { id: 'b4', label: 'Скрипт', service: 'script.turn_on', confirm: false }] };
  const out = scopeConfig(cfg, sc, idx, ['camera_go2rtc', 'clock'], controlPolicy(reg, sc, cfg.devices));
  assert.equal(out.sections.energy?.hidden, true); assert.equal(out.sections.lights?.hidden, false);
  assert.equal(out.modules.camera_go2rtc?.enabled, false); assert.equal(out.modules.clock, undefined);
  assert.deepEqual(out.buttons.map(b => b.id), ['b1']);
  assert.deepEqual(out.alarms.map(x => x.id), ['a1']);
  assert.equal(cfg.alarms.length, 2, 'the house\'s own settings are not touched');
  // a full role presses the script too
  const full = scopeFor(access({ members: { u: { buildings: { contabilitate: 'manager' } } } }), 'u');
  assert.deepEqual(scopeConfig(cfg, full, idx, [], controlPolicy(reg, full, {})).buttons.map(b => b.id), ['b1', 'b2', 'b4']);
});
test('alarms saved from a screen that lists only its own: the others stay as the house holds them', () => {
  const al = (id: string, room: string, time = '07:00') => ({ ...normaliseConfig({ schemaVersion: 1, alarms: [{ id, room, time }] }).config.alarms[0] });
  const house = [al('a1', 'kabinet'), al('a2', 'showroom'), al('a3', 'dmlink')];
  const listed = (a: Alarm) => a.room === 'kabinet';
  assert.deepEqual(mergeAlarms(house, [al('a1', 'kabinet', '08:00'), al('n1', 'kabinet')], listed).map(a => `${a.id}@${a.time}`), ['a2@07:00', 'a3@07:00', 'a1@08:00', 'n1@07:00']);
  assert.deepEqual(mergeAlarms(house, [], listed).map(a => a.id), ['a2', 'a3'], 'deleting the screen\'s own alarm deletes only it');
});
test('the scoped registry keeps its rows from one state change to the next', () => {
  const remember = rememberScope(), sc = scopeFor(access({ members: { u1: { buildings: { contabilitate: 'staff' } } } }), 'u1'), none = {};
  const r1 = remember(reg, sc, none), r2 = remember({ ...reg, states: { ...reg.states, 'light.buh': st('off') } }, sc, none);
  assert.equal(r1.entities, r2.entities); assert.equal(r1.areas, r2.areas); assert.equal(r1.devices, r2.devices);
  assert.equal(r2.states['light.buh'].state, 'off'); assert.equal(r2.states['light.showroom'], undefined);
  const same = { ...reg, states: { ...reg.states } }, r4 = remember(same, sc, none);
  assert.equal(remember(same, sc, none), r4, 'nothing changed: the very same registry');
  const r3 = remember(reg, scopeFor(access({ members: { u1: { buildings: { office: 'staff' } } } }), 'u1'), none);
  assert.notEqual(r3.entities, r1.entities, 'another scope is built anew');
});
test('the stored access is made safe, and kept through the settings\' normaliser', () => {
  assert.equal(normaliseAccess(undefined), undefined); assert.equal(normaliseAccess([]), undefined);
  const a = normaliseAccess({ enabled: 'yes', newUsers: 'everything', roles: { boss: { name: ' Шеф ', sections: ['lights', 'nope'], modules: ['cameras', 'tv'], mode: 'god' }, 'bad key!': {} }, members: { u1: { all: true, role: 'boss', until: '2026-12-31' }, u2: { buildings: { contabilitate: 'boss', '': 'x' }, until: 'tomorrow' }, '../x': {} }, profiles: { 'planshet-buh': { building: 'contabilitate', role: 'boss' }, Bad: { building: 'x', role: 'y' } } })!;
  assert.equal(a.enabled, false); assert.equal(a.newUsers, 'none');
  assert.deepEqual(a.roles, { boss: { name: 'Шеф', sections: ['lights'], modules: ['cameras'], mode: 'view' } });
  assert.deepEqual(a.members, { u1: { all: true, role: 'boss', until: '2026-12-31' }, u2: { buildings: { contabilitate: 'boss' } } });
  assert.deepEqual(a.profiles, { 'planshet-buh': { building: 'contabilitate', role: 'boss' } });
  assert.deepEqual(Object.keys(normaliseAccess({ roles: {} })!.roles), ['manager', 'staff', 'guard', 'tablet', 'guest'], 'no roles at all: the ready ones');
  // through normaliseConfig: kept when present, absent when not (a house that never opened «Acces» saves what it saved before)
  const cfg = normaliseConfig({ schemaVersion: 1, access: { enabled: true, members: { u1: { all: true, role: 'staff' } } }, devices: { 'd:ac2': { roles: ['manager'] } } }).config;
  assert.equal(cfg.access?.enabled, true); assert.deepEqual(cfg.devices['d:ac2'].roles, ['manager']);
  assert.equal('access' in normaliseConfig({ schemaVersion: 1 }).config, false);
  assert.equal('roles' in normaliseConfig({ schemaVersion: 1, devices: { 'd:x': { name: 'A' } } }).config.devices['d:x'], false);
  assert.deepEqual(normaliseConfig(JSON.parse(JSON.stringify(cfg))).config, cfg, 'an export and an import carry the access over unchanged');
});
test('users of Home Assistant, the starting point, copying and removing a role', () => {
  const users = accessUsers([
    { id: 'a1', name: 'ararat', is_owner: true, is_active: true, system_generated: false, group_ids: ['system-admin'] },
    { id: 'f1', name: 'faur', is_active: true, system_generated: false, group_ids: ['system-users'] },
    { id: 's1', name: 'Supervisor', system_generated: true, group_ids: ['system-admin'] },
    { id: 't1', name: '', username: 'tableta', local_only: true, group_ids: ['system-users'] },
  ]);
  assert.deepEqual(users.map(u => [u.id, u.name, u.admin, u.localOnly]), [['a1', 'ararat', true, false], ['f1', 'faur', false, false], ['t1', 'tableta', false, true]]);
  const start = starterAccess(access({ enabled: false, members: { t1: { buildings: { contabilitate: 'tablet' } } } }), users);
  assert.equal(start.enabled, true);
  assert.deepEqual(start.members, { t1: { buildings: { contabilitate: 'tablet' } }, f1: { all: true, role: 'staff' } }, 'every present non-administrator gets «Сотрудник» everywhere; what was set stays');
  const c = copyRole(defaultAccess().roles, 'staff', 'Сотрудник 2');
  assert.equal(c.id, 'staff_2'); assert.deepEqual(c.roles.staff_2.sections, defaultAccess().roles.staff.sections);
  const w = withoutRole(access({ members: { u1: { buildings: { contabilitate: 'guest', office: 'staff' } }, u2: { all: true, role: 'guest' } }, profiles: { p1: { building: 'office', role: 'guest' } }, defaultRole: 'guest' }), 'guest');
  assert.deepEqual(w.members, { u1: { buildings: { office: 'staff' } }, u2: {} }); assert.deepEqual(w.profiles, {}); assert.equal(w.roles.guest, undefined); assert.equal(w.defaultRole, undefined);
});
