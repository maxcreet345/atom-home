// The shell's backbone (audit 2026-11-09): the one command runner, the error sentence, the settings guard, the address book of the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommands, guardHost, CommandError } from '../src/runtime/commands.ts';
import { errorText } from '../src/ui/format.ts';
import { translator } from '../src/i18n/index.ts';
import { SaveError, rebaseAlarms } from '../src/runtime/store.ts';
import { haStore } from '../src/runtime/ha-store.ts';
import { createLoader, nextDelay } from '../src/runtime/loader.ts';
import { decode, encode, pushView, replaceView, leaveTo, repair, pageOf, type View, type NavWindow } from '../src/runtime/route.ts';
import { serviceCall, customAction, stepTarget, type Action } from '../src/runtime/actions.ts';
import { defaultConfig, type Alarm } from '../src/model/config.ts';
import type { Hass, Host } from '../src/runtime/host.ts';

const ru = translator('ru'), en = translator('en'), ro = translator('ro');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function rig(opts: { online?: boolean; answer?: () => Promise<void> } = {}) {
  const sent: Array<[string, string, Record<string, unknown>]> = [], said: string[] = []; const state = { online: opts.online ?? true, busy: [] as string[][] };
  const host = { get online() { return state.online; }, async call(d: string, s: string, data: Record<string, unknown>) { sent.push([d, s, data]); await (opts.answer?.() ?? Promise.resolve()); } };
  const commands = createCommands({ host: () => host, text: e => errorText(e, ru), notify: t => said.push(t), changed: b => state.busy.push([...b]) });
  return { sent, said, state, host, commands };
}

test('runner: offline sends nothing and says «Нет связи с домом»', async () => {
  const r = rig({ online: false });
  assert.equal(await r.commands.run('lamp', () => r.host.call('light', 'turn_on', {})), false);
  assert.deepEqual(r.sent, []); assert.deepEqual(r.said, ['Нет связи с домом']);
  await assert.rejects(r.commands.call('light', 'turn_on', {}), (e: unknown) => e instanceof CommandError && errorText(e, ru) === 'Нет связи с домом');
  assert.deepEqual(r.sent, []);
});

test('runner: a second command for the same key is dropped while the first is on its way; pending is visible meanwhile', async () => {
  let release = () => {}; const r = rig({ answer: () => new Promise<void>(res => { release = res; }) });
  const first = r.commands.run('lamp', () => r.host.call('light', 'turn_on', { entity_id: 'light.a' }));
  assert.equal(r.commands.pending('lamp'), true); assert.ok(r.commands.busy.has('lamp'));
  assert.equal(await r.commands.run('lamp', () => r.host.call('light', 'turn_on', { entity_id: 'light.a' })), false, 'the double tap');
  await sleep(1); release(); assert.equal(await first, true);
  assert.equal(r.sent.length, 1); assert.equal(r.commands.pending('lamp'), false); assert.deepEqual(r.said, []);
  assert.deepEqual(r.state.busy, [['lamp'], []], 'the shell is told when pending starts and ends');
});

test('runner: a slider streams (no drop), a refusal is a toast or the caller\'s own line, and nothing is rejected', async () => {
  const r = rig({ answer: async () => { throw { code: 'service_validation_error', message: 'Brightness is out of range' }; } });
  const a = r.commands.run('lamp', () => r.host.call('light', 'turn_on', { brightness_pct: 10 }), { stream: true }), b = r.commands.run('lamp', () => r.host.call('light', 'turn_on', { brightness_pct: 20 }), { stream: true });
  assert.deepEqual(await Promise.all([a, b]), [false, false]); assert.equal(r.sent.length, 2);
  assert.deepEqual(r.said, ['Дом отклонил команду: Brightness is out of range', 'Дом отклонил команду: Brightness is out of range']);
  const own: string[] = []; await r.commands.run('x', async () => { throw new Error('boom'); }, { onError: t => own.push(t) });
  assert.deepEqual(own, ['Команда не выполнена. Проверьте связь и повторите']); assert.equal(r.said.length, 2, 'no toast when the card shows it itself');
});

test('runner: `until` keeps the key pending after the house accepted, until the state arrives or the time is up', async () => {
  const r = rig(); let arrived = false;
  const p = r.commands.run('lamp', () => r.host.call('light', 'turn_on', {}), { until: () => arrived, untilMs: 2000 });
  await sleep(150); assert.equal(r.commands.pending('lamp'), true, 'accepted, state not here yet');
  assert.equal(await r.commands.run('lamp', () => r.host.call('light', 'turn_off', {})), false); assert.equal(r.sent.length, 1);
  arrived = true; assert.equal(await p, true); assert.equal(r.commands.pending('lamp'), false);
  const t0 = Date.now(); await r.commands.run('lamp', () => r.host.call('light', 'turn_on', {}), { until: () => false, untilMs: 250 }); assert.ok(Date.now() - t0 < 1000, 'gives up after untilMs');
});

test('guarded host: an identical call on its way is not sent twice, a different one is; the rest of the host is untouched', async () => {
  const waiting: Array<() => void> = [], release = () => { for (const f of waiting.splice(0)) f(); }; const r = rig({ answer: () => new Promise<void>(res => { waiting.push(res); }) });
  const full = { ...r.host, admin: true, states: () => ({}), registry: async () => ({ areas: [], devices: [], entities: [] }) } as unknown as Host;
  Object.defineProperty(full, 'online', { get: () => r.state.online });
  const host = guardHost(full, r.commands);
  const a = host.call('switch', 'turn_on', { entity_id: 'switch.a', x: { b: 1, a: 2 } }), b = host.call('switch', 'turn_on', { x: { a: 2, b: 1 }, entity_id: 'switch.a' }), c = host.call('switch', 'turn_on', { entity_id: 'switch.b' });
  await sleep(1); assert.equal(r.sent.length, 2, 'same service and data in any key order is one command');
  release(); await Promise.all([a, b, c]); assert.equal(host.admin, true); assert.equal(host.online, true);
  r.state.online = false; assert.equal(host.online, false); await assert.rejects(host.call('switch', 'turn_on', { entity_id: 'switch.a' }));
  assert.equal(r.sent.length, 2);
});

test('errorText: every shape of a refusal is a sentence in the panel\'s language, never «[object Object]»', () => {
  const haObject = { code: 'service_validation_error', message: 'Entity light.x does not support this service.' };
  assert.equal(errorText(haObject, ru), 'Дом отклонил команду: Entity light.x does not support this service.');
  assert.equal(errorText({ code: 'home_assistant_error', message: 'Device is asleep' }, en), 'The home refused the command: Device is asleep');
  assert.equal(errorText({ code: 'invalid_format', message: "expected float for dictionary value @ data['temperature']" }, ru), 'Команда не выполнена. Проверьте связь и повторите', 'a parser\'s English is not shown');
  assert.equal(errorText(new Error('preview: commands are rejected'), ru), 'Команда не выполнена. Проверьте связь и повторите');
  assert.equal(errorText('whatever', ro), 'Comanda nu a fost executată. Verificați conexiunea și repetați');
  for (const odd of [undefined, null, 42, {}, [], { message: 5 }, { code: 'unknown_error' }, Symbol('x')]) assert.equal(errorText(odd, ru), 'Команда не выполнена. Проверьте связь и повторите');
  assert.equal(errorText({ code: 3, message: 'Connection lost' }, ru), 'Нет связи с домом'); assert.equal(errorText(3, ru), 'Нет связи с домом');
  assert.equal(errorText({ type: 'result', success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }, ru), 'Нет прав на это действие');
  assert.equal(errorText({ code: 'timeout' }, en), 'The home did not answer in time. Try again');
  assert.equal(errorText({ code: 'not_found', message: 'Service not found.' }, ru), 'Дом не знает такого действия или устройства');
  assert.equal(errorText(new SaveError('conflict', 'Configuration was changed elsewhere'), ru), ru('save.error.conflict'));
  assert.equal(errorText(new SaveError('not_loaded'), en), en('save.error.not_loaded'));
  for (const t of [ru, en, ro]) for (const e of [haObject, new Error('x'), 'x', { code: 3 }, new CommandError()]) { const s = errorText(e, t); assert.ok(s.length > 5 && !s.includes('[object') && !/^(error|save|ui)\./.test(s), s); }
});

/** A Home Assistant whose settings read can be switched off: `config/get` fails while `down`. */
function fakeHass() {
  const calls: Array<Record<string, unknown>> = []; const st = { down: true, revision: 7, stored: defaultConfig('The real house') as unknown };
  const hass = { states: {}, async callService() { /* none */ }, async callWS<T>(msg: Record<string, unknown>): Promise<T> {
    calls.push(msg);
    if (msg.type === 'atom_home/config/get') { if (st.down) throw { code: 'unknown_error', message: 'boom' }; return { config: st.stored, version: 'x', admin: true, revision: st.revision } as T; }
    if (msg.type === 'atom_home/config/set') { if (msg.expected_revision !== st.revision) throw { code: 'conflict', message: 'Configuration was changed elsewhere' }; st.stored = msg.config; return { saved: true, revision: ++st.revision } as T; }
    if (msg.type === 'atom_home/alarms/set') { if (msg.expected_revision !== st.revision) throw { code: 'conflict', message: 'Configuration was changed elsewhere' }; return { saved: true, revision: ++st.revision, alarms: msg.alarms } as T; }
    throw { code: 'unknown_command', message: 'Unknown command.' };
  } } as unknown as Hass;
  return { hass, calls, st };
}
test('settings guard: after a failed config/get the store saves nothing — neither the config nor the alarms — until a real read', async () => {
  const f = fakeHass(), s = haStore(() => f.hass);
  await assert.rejects(s.load());
  await assert.rejects(s.save(defaultConfig('Factory')), (e: unknown) => e instanceof SaveError && e.code === 'not_loaded');
  await assert.rejects(s.saveAlarms!([]), (e: unknown) => e instanceof SaveError && e.code === 'not_loaded');
  assert.equal(f.calls.filter(c => c.type !== 'atom_home/config/get').length, 0, 'nothing reached the house');
  assert.equal((f.st.stored as { home: { name: string } }).home.name, 'The real house');
  f.st.down = false; assert.equal((await s.load()).config.home.name, 'The real house');
  await s.save(defaultConfig('Renamed')); assert.equal(f.calls.find(c => c.type === 'atom_home/config/set')!.expected_revision, 7, 'and then with the revision it read');
});

test('loader: a failed read is tried again by itself, a second run joins the first, stop ends it', async () => {
  let n = 0, failed = 0, settled = 0;
  const l = createLoader(async () => { n++; if (n < 3) throw new Error('down'); }, { failed: () => failed++, settled: () => settled++, delays: [10, 20] });
  const a = l.run(), b = l.run(); assert.equal(await a, false); assert.equal(await b, false); assert.equal(n, 1, 'one read for two callers'); assert.equal(l.waiting, true);
  await sleep(80); assert.equal(n, 3); assert.equal(failed, 2); assert.equal(settled, 3); assert.equal(l.waiting, false);
  let m = 0; const dead = createLoader(async () => { m++; throw new Error('down'); }, { delays: [10] }); await dead.run(); dead.stop(); await sleep(40); assert.equal(m, 1);
  assert.deepEqual([1, 2, 3, 4, 9].map(i => nextDelay(i)), [2000, 5000, 15000, 30000, 30000]);
});

const alarm = (id: string, time = '07:00'): Alarm => ({ id, room: 'r', time, days: [], enabled: true, label: '', alice: 'off', phrase: '', station: '', light: false, lightEntity: '', fadeMin: 0, push: false, repeats: 0, repeatEveryMin: 5 });
test('alarms saved over a stale list keep what another screen did meanwhile', () => {
  const base = [alarm('a'), alarm('b'), alarm('c')], fresh = [alarm('a', '06:00'), alarm('c'), alarm('z')]; // elsewhere: a moved, b deleted, z added
  assert.deepEqual(rebaseAlarms(base, [alarm('a'), alarm('b'), alarm('c'), alarm('new')], fresh).map(x => `${x.id}@${x.time}`), ['a@06:00', 'c@07:00', 'z@07:00', 'new@07:00'], 'add');
  assert.deepEqual(rebaseAlarms(base, [alarm('a'), alarm('b')], fresh).map(x => x.id), ['a', 'z'], 'delete c');
  assert.deepEqual(rebaseAlarms(base, [alarm('a'), alarm('b'), alarm('c', '09:30')], fresh).map(x => `${x.id}@${x.time}`), ['a@06:00', 'c@09:30', 'z@07:00'], 'edit c');
});

/** A browser history small enough to reason about. */
function fakeWindow(hash = '#home') {
  const entries: Array<{ url: string; state: unknown }> = [{ url: hash, state: null }]; let at = 0; const pops: string[] = [];
  const win: NavWindow & { entries: typeof entries; pops: string[]; at(): number } = { entries, pops, at: () => at, location: { get hash() { return entries[at].url; } }, history: {
    get state() { return entries[at].state; },
    pushState(state, _u, url) { entries.splice(at + 1); entries.push({ url, state }); at++; },
    replaceState(state, _u, url) { entries[at] = { url, state }; },
    back() { if (at > 0) { at--; pops.push(entries[at].url); } },
  } };
  return win;
}
const v = (hash: string): View => decode(hash);
test('addresses: decode and encode agree; an unknown section is Home', () => {
  for (const h of ['#home', '#rooms?room=kukhnia', '#lights?device=e%3Alight.a', '#cleaning?filter=settings', '#setup']) assert.equal(encode(decode(h)), h);
  assert.equal(decode('#nonsense').section, 'home'); assert.equal(decode('').section, 'home');
  assert.equal(pageOf(v('#rooms?room=a&device=x')), pageOf(v('#rooms?room=a')), 'a sheet is not a new page');
});
test('history: closing goes back when Back leads there — three open/close cycles leave the history as it was', () => {
  const w = fakeWindow('#lights'), sheet = v('#lights?device=e%3Alight.a'), page = v('#lights'), same = (p: View) => p.section === 'lights' && !p.room && !p.device;
  for (let i = 0; i < 3; i++) { assert.equal(pushView(w, sheet), true); assert.equal(leaveTo(w, page, same), 'back'); }
  assert.equal(w.at(), 0); assert.equal(w.location.hash, '#lights'); assert.equal(w.entries.length, 2, 'one forward entry at most, no pile');
  assert.equal(pushView(w, page), false, 'the address is already there: no second entry');
});
test('history: a deep link or an entry reached another way is replaced, so Back never reopens what was closed', () => {
  const deep = fakeWindow('#home?device=clock'); assert.equal(leaveTo(deep, v('#home'), p => !p.device), 'replace'); assert.deepEqual(deep.entries.map(e => e.url), ['#home']);
  // Home → a room straight from Home → «‹ Комнаты»: Back must lead Home, not into the room again
  const w = fakeWindow('#home'); pushView(w, v('#rooms?room=kukhnia')); assert.equal(leaveTo(w, v('#rooms')), 'replace');
  assert.deepEqual(w.entries.map(e => e.url), ['#home', '#rooms']);
  // Rooms → a room → «‹ Комнаты»: that is Back itself
  const r = fakeWindow('#rooms'); pushView(r, v('#rooms?room=kukhnia')); assert.equal(leaveTo(r, v('#rooms')), 'back'); assert.deepEqual(r.pops, ['#rooms']);
  // the filter of a page is the same entry
  const s = fakeWindow('#systems'); replaceView(s, v('#systems?filter=attention')); assert.equal(s.entries.length, 1);
  pushView(s, v('#systems?device=e%3Asensor.x')); assert.equal(leaveTo(s, v('#systems'), p => p.section === 'systems' && !p.device), 'back'); assert.equal(s.location.hash, '#systems?filter=attention', 'the filter is still on');
});
test('a stale address is repaired to the nearest real one', () => {
  const known = { sections: ['home', 'rooms', 'setup', 'lights', 'security', 'cleaning', 'systems'], systems: ['security', 'cleaning', 'systems'], allSystems: ['security', 'climate', 'cleaning', 'energy', 'camera', 'systems'], rooms: ['kukhnia'], sheet: false };
  assert.equal(repair(v('#home'), known), null); assert.equal(repair(v('#rooms?room=kukhnia'), known), null);
  assert.equal(encode(repair(v('#weather'), known)!), '#home', 'a section that is no page');
  assert.equal(encode(repair(v('#climate'), known)!), '#security', 'a hidden tab of «Системы» is its first shown one');
  assert.equal(encode(repair(v('#rooms?room=nope'), known)!), '#rooms');
  assert.equal(encode(repair(v('#home?device=ghost'), known)!), '#home');
  assert.equal(repair(v('#home?device=clock'), { ...known, sheet: true }), null);
});

test('a switch is told where to end up, never «toggle»; a button without a target sends no empty entity', () => {
  const tg: Action = { id: 'toggle', label: 'action.toggle', kind: 'toggle', domain: 'light', service: 'toggle', entityId: 'light.a', confirm: false, risk: 'normal', current: false };
  assert.deepEqual(serviceCall(tg, true), { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a' } });
  assert.deepEqual(serviceCall(tg, false), { domain: 'light', service: 'turn_off', data: { entity_id: 'light.a' } });
  assert.equal(serviceCall({ ...tg, domain: 'homeassistant' }, true).service, 'turn_on');
  assert.deepEqual(serviceCall({ ...tg, domain: 'cover', entityId: 'cover.a' }, false), { domain: 'cover', service: 'close_cover', data: { entity_id: 'cover.a' } });
  assert.equal(serviceCall({ ...tg, id: 'mute', service: 'volume_mute', domain: 'media_player' }, true).service, 'volume_mute');
  const notify = serviceCall(customAction({ id: 'n', label: 'Сообщение', service: 'notify.mobile_app_phone', data: { message: 'Ужин готов' }, confirm: false }));
  assert.deepEqual(notify, { domain: 'notify', service: 'mobile_app_phone', data: { message: 'Ужин готов' } });
  assert.equal(serviceCall(customAction({ id: 's', label: 'Свет', service: 'light.turn_off', target: { entity_id: 'light.a' }, confirm: false })).data.entity_id, 'light.a');
});

// ----- the rest of the shell's slice of the audit of 09.11.2026 -----
import { stateText } from '../src/ui/format.ts';
import { monthTotal } from '../src/runtime/host.ts';
import { people } from '../src/model/people.ts';
import { activeSpecs, kettleSpec } from '../src/modules/catalog.ts';
import { readSkeletonLang, rememberSkeletonLang, SKELETON_TEXT, skeletonHtml } from '../src/ui/skeleton.js';
import type { EntityRef } from '../src/model/discover.ts';
import type { Registry } from '../src/model/registry.ts';

const ent = (id: string, state: string, deviceClass: string | null = null, attributes: Record<string, unknown> = {}): EntityRef => ({ id, domain: id.split('.')[0], deviceClass, name: id, kind: null, state, attributes, unit: null, available: state !== 'unavailable', lastChanged: '' });
test('a state is told in words: a moment as a moment, a case contact as a case, a paused player without a dangling dot', () => {
  const at = stateText(ent('sensor.last_restart', '2026-10-09T18:11:05+00:00', 'timestamp'), ru, 'ru');
  assert.ok(!/T18:11|\+00:00/.test(at) && /\d{1,2}:\d{2}/.test(at) && /окт/.test(at), at);
  assert.equal(stateText(ent('sensor.last_restart', 'unknown', 'timestamp'), ru, 'ru'), 'Нет данных');
  assert.equal(stateText(ent('binary_sensor.window_tamper', 'off', 'tamper'), ru, 'ru'), 'Корпус закрыт'); assert.equal(stateText(ent('binary_sensor.window_tamper', 'on', 'tamper'), en, 'en'), 'Case opened');
  assert.equal(stateText(ent('binary_sensor.v', 'off', 'vibration'), ro, 'ro'), 'Liniște');
  assert.equal(stateText(ent('binary_sensor.window_tamper', 'unavailable', 'tamper'), ru, 'ru'), 'Нет связи', 'silent is never «closed»');
  assert.equal(stateText(ent('media_player.station', 'paused', null, { media_title: '' }), ru, 'ru'), 'Пауза'); assert.equal(stateText(ent('media_player.station', 'paused', null, { media_title: '  ' }), ru, 'ru'), 'Пауза');
  assert.equal(stateText(ent('media_player.station', 'paused', null, { media_title: 'Break' }), ru, 'ru'), 'Пауза · Break');
});

test('the month so far is one answer for all meters: the latest row of each, null when one has none', () => {
  assert.equal(monthTotal(['a', 'b'], { a: [{ start: 1e12, change: 1 }, { start: 2e12, change: 10 }], b: [{ start: '2026-11-01T00:00:00+02:00', change: 2.5 }] }), 12.5);
  assert.equal(monthTotal(['a', 'b'], { a: [{ start: 1e12, change: 10 }] }), null); assert.equal(monthTotal(['a'], { a: [{ start: 1e12, change: null }] }), null); assert.equal(monthTotal(['a'], null), null);
});

test('«с ЧЧ:ММ» is hidden for everyone who shares the minute with somebody (a restart), kept for the one who moved since', () => {
  const at = (iso: string, state = 'home') => ({ state, attributes: { friendly_name: 'X' }, last_changed: iso, last_updated: iso });
  const reg = { entities: [], states: { 'person.a': at('2026-11-09T10:00:00+00:00'), 'person.b': at('2026-11-09T10:00:20+00:00', 'not_home'), 'person.c': at('2026-11-09T10:35:00+00:00') } } as unknown as Pick<Registry, 'states' | 'entities'>;
  const list = people(reg, { entities: {}, devices: {} });
  assert.deepEqual(Object.fromEntries(list.map(p => [p.id, p.since !== null])), { 'person.a': false, 'person.b': false, 'person.c': true });
});

const reg = (ids: Record<string, { device?: string; area?: string; attrs?: Record<string, unknown> }>, devices: Array<{ id: string; model?: string; area?: string }>): Registry => ({ areas: [], floors: [],
  devices: devices.map(d => ({ id: d.id, name: d.id, model: d.model ?? null, manufacturer: null, area_id: d.area ?? null, entry_type: null, disabled_by: null, via_device_id: null, labels: [] })),
  entities: Object.entries(ids).map(([id, x]) => ({ entity_id: id, device_id: x.device ?? null, area_id: x.area ?? null, name: null, original_name: id, platform: 'xiaomi_miot', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class: null, unit: null, has_entity_name: false, labels: [], translation_key: null, vacuum: null })),
  states: Object.fromEntries(Object.entries(ids).map(([id, x]) => [id, { state: 'on', attributes: x.attrs ?? {}, last_changed: '', last_updated: '' }])) });
test('the kettle\'s socket is found under the kettle\'s own name, and under the shorter one as before', () => {
  const own = reg({ 'water_heater.kitchen_kettle': { device: 'k' }, 'switch.kitchen_kettle_plug': {}, 'sensor.kitchen_kettle_plug_power': {}, 'sensor.kitchen_kettle_plug_energy_today': {} }, [{ id: 'k', model: 'xiaomi.kettle.v20' }]);
  const a = kettleSpec.detect(own)!.entities; assert.equal(a.plug, 'switch.kitchen_kettle_plug'); assert.equal(a.plugPower, 'sensor.kitchen_kettle_plug_power'); assert.equal(a.plugToday, 'sensor.kitchen_kettle_plug_energy_today');
  const short = reg({ 'water_heater.kitchen_kettle': { device: 'k' }, 'switch.kitchen_plug': {}, 'sensor.kitchen_plug_power': {} }, [{ id: 'k', model: 'xiaomi.kettle.v20' }]);
  const b = kettleSpec.detect(short)!.entities; assert.equal(b.plug, 'switch.kitchen_plug'); assert.equal(b.plugPower, 'sensor.kitchen_plug_power'); assert.equal(b.plugToday, undefined);
});
test('a ring at the door is not an event of a camera in another room — also when the settings name that camera', () => {
  const house = reg({ 'camera.a1b2c3d4_go2rtc': { area: 'hall' }, 'camera.office_c700': { area: 'office' }, 'event.entrance_doorbell_ring': { device: 'bell', attrs: { device_class: 'doorbell' } }, 'binary_sensor.entrance_doorbell_motion': { device: 'bell' } }, [{ id: 'bell', area: 'hall' }]);
  const cfg = defaultConfig('Дом'), found = (c: typeof cfg) => activeSpecs(house, c).find(a => a.spec.id === 'camera_go2rtc')!.entities;
  assert.equal(found(cfg).ring, 'event.entrance_doorbell_ring', 'the camera at the door keeps its ring'); assert.equal(found(cfg).motionEvent, 'binary_sensor.entrance_doorbell_motion');
  const moved = { ...cfg, modules: { camera_go2rtc: { entities: { camera: 'camera.office_c700' }, options: { addon: 'a1b2c3d4_go2rtc' } } } };
  assert.equal(found(moved).camera, 'camera.office_c700'); assert.equal(found(moved).ring, undefined); assert.equal(found(moved).motionEvent, undefined);
  const named = { ...cfg, modules: { camera_go2rtc: { entities: { camera: 'camera.office_c700', ring: 'event.entrance_doorbell_ring' }, options: { addon: 'a1b2c3d4_go2rtc' } } } };
  assert.equal(found(named).ring, 'event.entrance_doorbell_ring', 'what the settings name themselves stays');
});

test('«switch everything off» asks first whatever the button says; one lamp does not', () => {
  const b = (target: Record<string, unknown>, service = 'homeassistant.turn_off', confirm = false) => customAction({ id: 'x', label: 'x', service, target, confirm }).confirm;
  assert.equal(b({ entity_id: ['light.a', 'light.b'] }), true); assert.equal(b({ entity_id: 'all' }, 'light.turn_off'), true); assert.equal(b({ area_id: 'kitchen' }, 'light.turn_off'), true);
  assert.equal(b({ entity_id: 'light.a' }, 'light.turn_off'), false); assert.equal(b({ entity_id: ['light.a', 'light.b'] }, 'light.turn_on'), false); assert.equal(b({ entity_id: 'vacuum.x' }, 'vacuum.start', true), true);
});

test('the loading screen speaks the panel\'s language, Home Assistant\'s until the panel has said its own', () => {
  const m = new Map<string, string>(); (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  assert.equal(readSkeletonLang('en-GB'), 'en'); assert.equal(readSkeletonLang('de'), 'ru'); assert.equal(readSkeletonLang(undefined), 'ru');
  rememberSkeletonLang('ro'); assert.equal(readSkeletonLang('en'), 'ro');
  assert.ok(skeletonHtml(SKELETON_TEXT.ro.fail).includes('Reîncercăm')); assert.ok(skeletonHtml().includes('Подключаемся к дому'), 'the loader\'s own default is unchanged');
  for (const l of ['ru', 'en', 'ro'] as const) assert.ok(SKELETON_TEXT[l].wait && SKELETON_TEXT[l].fail && SKELETON_TEXT[l].wait !== SKELETON_TEXT[l].fail);
});

test('a thermostat step stays inside the device\'s limits', () => {
  const trv = { min: 4, max: 30, step: 0.5 };
  assert.equal(stepTarget(trv, 4, -1), 4, 'at the minimum «−» changes nothing'); assert.equal(stepTarget(trv, 30, 1), 30); assert.equal(stepTarget(trv, 4, 1), 4.5); assert.equal(stepTarget(trv, 21.5, -1), 21);
  assert.equal(stepTarget({ step: 1 }, 20, 1), 21, 'no limits declared: a plain step'); assert.equal(stepTarget({ min: 5, max: 35 }, 5.2, -1), 5);
});

test('Romanian: rooms and cameras are different words, and one of a thing is counted as one', () => {
  assert.notEqual(ro('section.rooms'), ro('section.camera')); assert.equal(ro('section.rooms'), ro('ui.rooms'));
  assert.equal(ro('overview.on', { n: 1 }), '1 pornit'); assert.equal(ro('overview.on', { n: 3 }), '3 pornite'); assert.equal(ro('overview.opened', { n: 1 }), '1 deschis');
  // 1.27.0: the section itself is «Устройства» (owner, 11.11.2026), so its list's tab is «Все» — still never called like the section it is a tab of
  assert.equal(ru('section.systems'), 'Устройства'); assert.equal(translator('en')('section.systems'), 'Devices'); assert.equal(ro('section.systems'), 'Dispozitive');
  for (const t of [ru, ro, translator('en')]) assert.notEqual(t('devices.all'), t('section.systems'), 'the list of devices is not called like the section it is a tab of');
});
