// Release «classic», step 4 (11.11.2026): the logic fixes of design pass 3 (commits b9c5d40, 54d8105, ffd2782) ported to the classic code — what the
// code itself must hold. Each test fails on the tree before this step:
//   ST-03 / ST-04 / CODEX-001 / CODEX-004  «Настройка»: the custom button's checks field by field, the «always asks» switch, a photo's file after the save
//                                          (the plain part of ui/setup.tsx, run here as it is written there — see `setupLogic`)
//   ST-01  a room's lamp says its bulb's own state (ui/room-words.ts `lampLink`, `detail`, `quickState`)
//   ST-13  a vacuum setting goes only to an entity that answers (model/vacuum.ts `settingAnswers`)
//   ST-15  the feeder's question is scrolled into sight before the focus goes into it, to its safe «Закрыть» (feeder-protocol.ts `askScroll`)
// What is drawn and sent is checked in the browser by scripts/qa-setup.mjs, qa-room.mjs, qa-vacuum.mjs, qa-feeder.mjs, qa-clock.mjs («release classic» parts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as actions from '../src/runtime/actions.ts';
import { customAction } from '../src/runtime/actions.ts';
import { translator } from '../src/i18n/index.ts';
import { readRoom } from '../src/model/room.ts';
import { detail, quickState, lampLink } from '../src/ui/room-words.ts';
import { settingAnswers } from '../src/model/vacuum.ts';
import { askScroll } from '../src/modules/feeder-protocol.ts';
import type { Registry } from '../src/model/registry.ts';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// ---- «Настройка»: the plain part of ui/setup.tsx, as it is written there ----
// Node runs .ts but not .tsx: the block between the two marker lines of setup.tsx holds no JSX, so it is taken out as it is, with the imports it
// uses (actions.ts, config.ts — absolute paths) and the file's own ENTITY_ID, written to a temporary .ts file and imported. No copy of the logic here.
type Draft = { label: string; service: string; entity: string; data: string; confirm: boolean; icon: string };
type Logic = {
  EMPTY_BUTTON: Readonly<Draft>; BUTTON_FIELDS: readonly string[];
  checkButtonDraft(d: Draft): { ok: false; field: string; key: string } | { ok: true; button: { label: string; icon?: string; service: string; target?: { entity_id: string | string[] }; data?: Record<string, unknown>; confirm: boolean } };
  alwaysAsks(b: { service: string; target?: { entity_id: string | string[] }; data?: Record<string, unknown> }): boolean;
  draftAlwaysAsks(d: Draft): boolean;
  removePhoto(url: string | null, save: () => Promise<boolean>, photos?: { remove(url: string): Promise<void> }): Promise<boolean>;
};
async function setupLogic(): Promise<Logic> {
  const file = src('ui/setup.tsx'), from = file.indexOf('// ---- plain logic of «Кнопки → Добавить кнопку»'), to = file.indexOf('// ---- end of the plain logic ----');
  assert.ok(from > 0 && to > from, 'ui/setup.tsx has its plain-logic block (release classic, step 4)');
  const abs = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
  const entity = file.match(/^const ENTITY_ID = .*;$/m)?.[0]; assert.ok(entity, 'ENTITY_ID of setup.tsx');
  const imports = file.split('\n').filter(l => /^import .* from '\.\.\/(runtime\/actions|model\/config)\.ts';$/.test(l)).map(l => l.replace(/'\.\.\/(runtime\/actions|model\/config)\.ts'/, (_, m) => `'${abs(`${m}.ts`)}'`));
  const dir = mkdtempSync(join(tmpdir(), 'classic-setup-')), path = join(dir, 'setup-logic.ts');
  writeFileSync(path, [...imports, entity, file.slice(from, to)].join('\n'));
  try { return await import(pathToFileURL(path).href) as Logic; } finally { rmSync(dir, { recursive: true, force: true }); }
}
const L = await setupLogic();
const draft = (part: Partial<Draft>): Draft => ({ ...L.EMPTY_BUTTON, ...part });

test('ST-04: a custom button\'s mistakes are found in the order the fields stand — label, action, entity, data — each with its own words', () => {
  assert.deepEqual([...L.BUTTON_FIELDS], ['label', 'service', 'entity', 'data']);
  const bad = (part: Partial<Draft>) => { const r = L.checkButtonDraft(draft(part)); assert.equal(r.ok, false, JSON.stringify(part)); return r.ok ? null : [r.field, r.key]; };
  assert.deepEqual(bad({}), ['label', 'setup.err.label'], 'all empty: the label first');
  assert.deepEqual(bad({ label: '   ', service: 'bad' }), ['label', 'setup.err.label'], 'spaces are no label');
  assert.deepEqual(bad({ label: 'Ночь', service: 'bad' }), ['service', 'setup.err.service']);
  assert.deepEqual(bad({ label: 'Ночь', service: 'turn off' }), ['service', 'setup.err.service']);
  assert.deepEqual(bad({ label: 'Ночь', service: 'light.turn_off', entity: 'Bad Entity' }), ['entity', 'setup.err.entity']);
  assert.deepEqual(bad({ label: 'Ночь', service: 'light.turn_off', entity: 'light.kitchen, Light Hall' }), ['entity', 'setup.err.entity']);
  for (const data of ['[]', '[1]', '1', '"x"', 'null', '{bad']) assert.deepEqual(bad({ label: 'Ночь', service: 'light.turn_off', entity: 'light.kitchen', data }), ['data', 'setup.err.data'], data);
  const ru = translator('ru'); assert.equal(ru('setup.err.label'), 'Введите подпись кнопки'); assert.match(ru('setup.err.service'), /домен\.действие, например light\.turn_off/);
});

test('ST-03: the button the form makes is what it always made — lower-case action and ids, `all`, a list, a JSON object, the label to 60, the owner\'s flag', () => {
  const ok = (part: Partial<Draft>) => { const r = L.checkButtonDraft(draft(part)); assert.equal(r.ok, true, JSON.stringify(part)); return r.ok ? r.button : null; };
  assert.deepEqual(ok({ label: ' Вечер — гостиная ', service: ' Light.Turn_Off ', entity: 'light.kitchen', data: '{"transition":10}', icon: 'light', confirm: false }),
    { label: 'Вечер — гостиная', icon: 'light', service: 'light.turn_off', target: { entity_id: 'light.kitchen' }, data: { transition: 10 }, confirm: false });
  assert.deepEqual(ok({ label: 'Весь свет выкл', service: 'light.turn_off', entity: 'all' })?.target, { entity_id: 'all' });
  assert.deepEqual(ok({ label: 'Двое', service: 'light.turn_on', entity: 'light.a, light.b' })?.target, { entity_id: ['light.a', 'light.b'] });
  const none = ok({ label: 'Уведомить', service: 'notify.notify' }); assert.equal(none?.target, undefined); assert.equal(none?.data, undefined); assert.equal(none?.confirm, true, 'the form starts with «Спрашивать подтверждение» on');
  assert.equal(ok({ label: 'x'.repeat(80), service: 'scene.turn_on' })?.label.length, 60);
  assert.deepEqual(L.EMPTY_BUTTON, { label: '', service: '', entity: '', data: '', confirm: true, icon: 'more' }, 'what the form returns to after a success');
  assert.ok(Object.isFrozen(L.EMPTY_BUTTON), 'the empty draft is never edited in place');
});

test('ST-03: the form keeps its draft until the house has the button, and the import its text — the save answers (source)', () => {
  const s = src('ui/setup.tsx'), tab = s.slice(s.indexOf('function ButtonsTab('), s.indexOf('function HomeTab(')), home = s.slice(s.indexOf('function HomeTab('), s.indexOf('/** Downsizes an image'));
  assert.match(s, /const commit = async \(next: HouseConfig, done: string\): Promise<boolean> =>/, 'a save answers whether the house has it');
  assert.match(tab, /if \(await save\(c => \{ c\.buttons\.push\(\{ id: `b\$\{Date\.now\(\)\.toString\(36\)\}`, \.\.\.r\.button \}\); \}\) && version\.current === sent\) setDraft\(EMPTY_BUTTON\);/, 'the draft goes only after a success, and only the one that was sent');
  assert.match(tab, /if \(busy\.current\) return;/, 'two quick taps are one save');
  assert.doesNotMatch(tab, /setDraft\(\{ label: '', service: ''/, 'the old «clear at once»');
  assert.match(home, /run: \(\) => send\(next, sent\)/); assert.doesNotMatch(home, /onImport\(next\); setText\(''\)/, 'the old import cleared the text before the answer');
});

test('CODEX-001: the form\'s «always asks» is exactly what the button does on «Дом» (customAction) — «switch everything off» asks whatever the flag', () => {
  const asks = (service: string, entity = '', data = '') => L.draftAlwaysAsks(draft({ label: 'К', service, entity, data, confirm: false }));
  for (const [service, entity, data] of [['light.turn_off', 'all', ''], ['light.turn_off', 'light.a, light.b', ''], ['switch.turn_off', 'switch.a,switch.b', ''], ['light.turn_off', '', '{"area_id":"kitchen"}']] as const) assert.equal(asks(service, entity, data), true, `${service} → ${entity || data}`);
  assert.equal(asks('light.turn_off', '', '{"area_id":'), false, 'data that is not JSON yet does not count');
  for (const [service, entity] of [['light.turn_on', 'light.kitchen'], ['light.turn_off', 'light.kitchen'], ['scene.turn_on', 'scene.evening'], ['notify.notify', ''], ['', ''], ['valve', '']] as const) assert.equal(asks(service, entity), false, `${service} keeps the owner's flag`);
  // the form and «Дом» never disagree, whatever the shared core decides (with or without the mandatory list)
  for (const [service, entity] of [['valve.open_valve', 'valve.bath'], ['lock.unlock', 'lock.front'], ['alarm_control_panel.alarm_disarm', 'alarm_control_panel.home'], ['light.turn_off', 'all'], ['light.turn_on', 'light.k'], ['scene.turn_on', '']] as const) {
    const r = L.checkButtonDraft(draft({ label: 'К', service, entity, confirm: false })); assert.ok(r.ok);
    if (r.ok) { assert.equal(L.alwaysAsks(r.button), customAction({ id: 'x', ...r.button }).confirm, service); assert.equal(r.button.confirm, false, 'what is stored is the owner\'s own flag'); }
  }
  assert.equal(translator('ru')('setup.alwaysAsks'), 'Это действие всегда спрашивает');
  assert.equal(translator('en')('setup.alwaysAsks'), 'This action always asks');
  assert.equal(translator('ro')('setup.alwaysAsks'), 'Această acțiune cere mereu confirmare');
});
test('CODEX-001: water that would flow, a lock and the alarm system always ask — the switch is held on for them', { skip: 'mandatoryRisk' in actions ? false : 'waits for the shared core: runtime/actions.ts `mandatoryRisk` (the lead ports it in this step)' }, () => {
  const asks = (service: string, entity = '') => L.draftAlwaysAsks(draft({ label: 'К', service, entity, confirm: false }));
  for (const [service, entity] of [['valve.open_valve', 'valve.bath_water'], ['valve.set_valve_position', 'valve.bath_water'], ['homeassistant.turn_on', 'valve.bath_water'], ['lock.unlock', 'lock.front'], ['lock.lock', 'lock.front'], ['alarm_control_panel.alarm_disarm', 'alarm_control_panel.alarmo'], [' Lock.Unlock ', 'Lock.Front']] as const) assert.equal(asks(service, entity), true, `${service} → ${entity}`);
  for (const [service, entity] of [['valve.close_valve', 'valve.bath_water'], ['homeassistant.turn_off', 'valve.bath_water']] as const) assert.equal(asks(service, entity), false, `${service}: the safe way keeps the owner's flag`);
});

// ---- CODEX-004: the settings without the photo first, the file after — and only after a save the house took ----
function fakeHouse(refuse = false, deleteAnswer: 'removed' | 'kept' | 'throws' = 'removed') {
  const calls: string[] = [], disk = new Set(['/atom_home_photos/0123456789abcdef.jpg']);
  const config = { rooms: { kitchen: { photo: '/atom_home_photos/0123456789abcdef.jpg' as string | null } } };
  const save = async () => { calls.push('config/set'); if (refuse) return false; config.rooms.kitchen.photo = null; return true; };
  const photos = { async remove(url: string) { calls.push('photo/delete'); if (deleteAnswer === 'throws') throw new Error('not_found'); if (deleteAnswer === 'removed') disk.delete(url); } };
  return { calls, disk, config, save, photos };
}
const URL0 = '/atom_home_photos/0123456789abcdef.jpg';
test('CODEX-004: a photo is taken away by saving the settings without it first, then asking the house to delete its file', async () => {
  const h = fakeHouse(); assert.equal(await L.removePhoto(URL0, h.save, h.photos), true);
  assert.deepEqual(h.calls, ['config/set', 'photo/delete']); assert.equal(h.config.rooms.kitchen.photo, null); assert.equal(h.disk.has(URL0), false);
});
test('CODEX-004: a refused or conflicting save keeps the photo in the settings and its file on the disk; the file is never asked for', async () => {
  const h = fakeHouse(true); assert.equal(await L.removePhoto(URL0, h.save, h.photos), false);
  assert.deepEqual(h.calls, ['config/set']); assert.equal(h.config.rooms.kitchen.photo, URL0); assert.equal(h.disk.has(URL0), true);
});
test('CODEX-004: the house keeping a file another room still shows, or not finding it, is no mistake; no photo or no store — the settings alone', async () => {
  const kept = fakeHouse(false, 'kept'); assert.equal(await L.removePhoto(URL0, kept.save, kept.photos), true); assert.equal(kept.disk.has(URL0), true);
  const gone = fakeHouse(false, 'throws'); assert.equal(await L.removePhoto(URL0, gone.save, gone.photos), true, 'a delete that fails does not undo the saved settings');
  const empty = fakeHouse(); assert.equal(await L.removePhoto(null, empty.save, empty.photos), true); assert.deepEqual(empty.calls, ['config/set']);
  assert.equal(await L.removePhoto(URL0, fakeHouse().save, undefined), true);
});
test('CODEX-004: every photo field of «Настройка» (rooms, devices, modules) takes its photo away through `removePhoto`, with a save that answers', () => {
  const s = src('ui/setup.tsx'), field = s.slice(s.indexOf('function PhotoField('), s.indexOf('function ModulesTab('));
  assert.match(field, /const remove = \(\) => removePhoto\(value, \(\) => onChange\(null\), photos\);/);
  assert.equal((s.match(/photos\.remove\(/g) ?? []).length, 1, 'setup.tsx deletes a photo file only inside removePhoto');
  const uses = [...s.matchAll(/<PhotoField [^\n]*?onChange=\{url => (\w+)\(/g)].map(m => m[1]);
  assert.equal(uses.length, 3, 'rooms, devices and the modules\' photo slot'); assert.deepEqual([...new Set(uses)], ['save'], 'each saves with an answer (not the fire-and-forget patch)');
});

// ---- ST-01: a room's lamp says its bulb's own state ----
type E = [id: string, device: string, state: string, attrs?: Record<string, unknown>];
const ENT: E[] = [['light.kids_chandelier', 'yee', 'on', { brightness: 153 }], ['light.kids_chandelier_ambient', 'yee', 'off'], ['binary_sensor.kids_chandelier_nightlight', 'yee', 'off'], ['media_player.kids_tv', 'tv', 'off']];
function kids(over: Record<string, string> = {}): Registry {
  return {
    areas: [{ area_id: 'detskaia', name: 'Детская', temperature_entity_id: null, humidity_entity_id: null }],
    devices: [{ id: 'yee', name: 'Детская · Люстра', model: 'Yeelight Ceilc', manufacturer: null, area_id: 'detskaia' }, { id: 'tv', name: 'Детская · Телевизор', model: null, manufacturer: null, area_id: 'detskaia' }],
    entities: ENT.map(([entity_id, device_id]) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(ENT.map(([id, , state, attributes]) => [id, { state: over[id] ?? state, attributes: attributes ?? {}, last_changed: '2026-11-11T12:00:00Z', last_updated: '' }])),
  } as unknown as Registry;
}
const P = (reg: Registry, lang: 'ru' | 'en' | 'ro' = 'ru') => { const toggled: unknown[] = []; return { toggled, reg, lang, t: translator(lang), host: { call: async () => {} } as never, commands: { run: async (_k: string, w: () => Promise<unknown>) => { await w(); return true; } }, deviceOf: () => ({ key: 'e:light.kids_chandelier' }) as never, toggle: (d: unknown) => { toggled.push(d); }, act: () => {} }; };
const lamp = (reg: Registry) => readRoom(reg, 'detskaia', 'Детская', null, null, Date.now()).things.find(x => x.kind === 'light')!;

test('ST-01: the bulb silent while its backlight answers — «Нет связи», no command, no old brightness; the device as a whole still counts as available', () => {
  const reg = kids({ 'light.kids_chandelier': 'unavailable' }), th = lamp(reg);
  assert.equal(th.available, true, 'the backlight answers: Thing.available is the device, and it stays so');
  assert.equal(lampLink(th, reg), 'unavailable');
  const x = detail(th, P(reg)), q = quickState(th, x, translator('ru'));
  assert.equal(x.status, 'Нет связи'); assert.equal(x.tone, 'muted'); assert.equal(x.action, null); assert.equal(x.link, 'unavailable');
  assert.ok(!x.facts.some(f => /%/.test(f.text)), 'no brightness of a bulb that does not answer');
  assert.equal(q.word, 'Нет связи'); assert.equal(q.silent, true); assert.equal(q.on, false); assert.equal(q.known, false, 'no aria-pressed for a state nobody knows');
  assert.equal(quickState(th, detail(th, P(reg, 'en')), translator('en')).word, 'Offline'); assert.equal(quickState(th, detail(th, P(reg, 'ro')), translator('ro')).word, 'Fără legătură');
});
test('ST-01: the bulb answers without a state — «Нет данных», pressable with the house\'s turn_on (one toggle), never «Выкл.»', () => {
  const reg = kids({ 'light.kids_chandelier': 'unknown' }), th = lamp(reg), p = P(reg), x = detail(th, p), q = quickState(th, x, translator('ru'));
  assert.equal(lampLink(th, reg), 'unknown'); assert.equal(x.status, 'Нет данных'); assert.equal(x.link, 'unknown'); assert.ok(x.action, 'the turn_on the house offers stays');
  assert.ok(!x.facts.some(f => /%/.test(f.text)), 'no old brightness');
  assert.equal(q.word, 'Нет данных'); assert.equal(q.silent, false); assert.equal(q.known, false); assert.equal(q.on, false);
  x.action!.run(); assert.equal(p.toggled.length, 1, 'one command');
  assert.equal(quickState(th, detail(th, P(reg, 'en')), translator('en')).word, 'No data'); assert.equal(quickState(th, detail(th, P(reg, 'ro')), translator('ro')).word, 'Fără date');
});
test('ST-01: on and off are said and pressed as before («Вкл.» / «Выкл.», the classic short pair); every entity of the lamp silent is «Нет связи» too', () => {
  const on = kids(), lit = lamp(on), xo = detail(lit, P(on)), qo = quickState(lit, xo, translator('ru'));
  assert.equal(lampLink(lit, on), null); assert.equal(xo.status, 'Горит'); assert.equal(xo.link, undefined); assert.equal(qo.word, 'Вкл.'); assert.equal(qo.on, true); assert.equal(qo.known, true); assert.ok(xo.facts.some(f => /60/.test(f.text)));
  const off = kids({ 'light.kids_chandelier': 'off' }), dark = lamp(off), qf = quickState(dark, detail(dark, P(off)), translator('ru'));
  assert.equal(qf.word, 'Выкл.'); assert.equal(qf.on, false); assert.equal(qf.known, true); assert.equal(qf.silent, false);
  const gone = kids({ 'light.kids_chandelier': 'unavailable', 'light.kids_chandelier_ambient': 'unavailable', 'binary_sensor.kids_chandelier_nightlight': 'unavailable' }), g = lamp(gone);
  assert.equal(g.available, false); const qg = quickState(g, detail(g, P(gone)), translator('ru')); assert.equal(qg.word, 'Нет связи'); assert.equal(qg.silent, true); assert.equal(qg.known, false);
});
test('ST-01: other kinds keep their rule — a TV that does not answer is silent and «Нет связи» as before', () => {
  const reg = kids({ 'media_player.kids_tv': 'unavailable' }), tv = readRoom(reg, 'detskaia', 'Детская', null, null, Date.now()).things.find(x => x.kind === 'tv')!, q = quickState(tv, detail(tv, P(reg)), translator('ru'));
  assert.equal(lampLink(tv, reg), null); assert.equal(q.word, 'Нет связи'); assert.equal(q.silent, true); assert.equal(q.known, false); assert.equal(q.own, null);
});
test('ST-01 / ST-02: the room\'s one-tap lamp keeps a silent lamp, sends nothing when silent, has no false aria-pressed, and opens its sheet by a long press (source)', () => {
  const s = src('ui/room.tsx'), quick = s.slice(s.indexOf('function Quick('), s.indexOf('function Alarms('));
  assert.match(quick, /t\.main && \(t\.available \|\| t\.kind === 'light'\)/, 'a silent lamp stays in the row');
  assert.match(quick, /if \(waits \|\| q\.silent\) return;/, 'a silent tile sends nothing even if a press reaches it');
  assert.match(quick, /aria-pressed=\{q\.own \|\| !q\.known \? undefined : q\.on\}/);
  assert.match(quick, /const more = th\.kind === 'light' && lamps === 1 \? opensOf\(th, p\) : null;/, 'only the room\'s only lamp (it has no card below)');
  assert.match(quick, /onContextMenu: \(e: MouseEvent\) => \{ e\.preventDefault\(\);/); assert.match(quick, /setTimeout\(\(\) => \{ hold\.current\.timer = null; hold\.current\.fired = key; open\(\); \}, 500\)/);
});

// ---- ST-13: a vacuum setting goes only to an entity that answers ----
test('ST-13: `settingAnswers` — missing and `unavailable` take no command, `unknown` and a value do', () => {
  const st = { 'select.dock_empty': { state: 'max' }, 'number.volume': { state: 'unavailable' }, 'select.robot_mode': { state: 'unknown' } };
  assert.equal(settingAnswers(st, 'select.dock_empty'), true); assert.equal(settingAnswers(st, 'select.robot_mode'), true, 'a robot that says nothing yet is not a lost one');
  assert.equal(settingAnswers(st, 'number.volume'), false); assert.equal(settingAnswers(st, 'number.gone'), false);
  const ui = src('ui/vacuum.tsx'), set = ui.slice(ui.indexOf('export function VacuumSettings('));
  assert.match(set, /const reachable = \(id: string\) => settingAnswers\(host\.states\(\), id\);/, 'read from the house\'s live states');
  assert.match(set, /ui\.run\('emptyMode', \(\) => reachable\(s\.id\) \? act\.select\(s, o\) : Promise\.resolve\(\)\)/, 'checked again just before the command');
  assert.match(set, /if \(!reachable\(id\)\) \{ setVol\(null\); return; \}/, 'a queued volume is not sent to a target that went silent');
});

// ---- ST-15: the feeder's question in sight before the focus moves into it ----
const area = { top: 100, bottom: 560 }, at = (top: number, h: number) => ({ top, bottom: top + h });
test('ST-15: a question under the edge is brought up just enough; one in sight moves nothing; one above comes down to the top', () => {
  assert.equal(askScroll(area, at(576, 165), at(680, 48), { top: 3, max: 900, scale: 1 }), 3 + (741 - 560));
  assert.equal(askScroll(area, at(300, 120), at(370, 48), { top: 250, max: 900, scale: 1 }), 250);
  assert.equal(askScroll(area, at(40, 120), at(110, 48), { top: 250, max: 900, scale: 1 }), 250 - 60);
});
test('ST-15: a question taller than what is seen brings its safe «Закрыть» into sight; the scroll stays in range and follows a zoomed panel', () => {
  assert.equal(askScroll(area, at(450, 600), at(1000, 48), { top: 500, max: 2000, scale: 1 }), 500 + (1048 - 560));
  assert.equal(askScroll(area, at(-200, 600), at(352, 48), { top: 500, max: 2000, scale: 1 }), 500);
  assert.equal(askScroll(area, at(900, 100), at(950, 48), { top: 10, max: 120, scale: 1 }), 120);
  assert.equal(askScroll(area, at(-400, 100), at(-350, 48), { top: 10, max: 120, scale: 1 }), 0);
  assert.equal(askScroll(area, at(660, 100), at(700, 48), { top: 0, max: 900, scale: 2 }), 100);
  assert.equal(askScroll(area, at(660, 100), at(700, 48), { top: 0, max: -5, scale: 0 }), 0);
});
test('ST-15: the question\'s first focus is its safe «Закрыть» after it is shown; a page change, «Назад» or a saved plan drop the remembered place (source)', () => {
  const s = src('modules/pet-feeder.tsx');
  assert.match(s, /show\(\); safeRef\.current\?\.focus\(\{ preventScroll: true \}\)/, 'reveal first, then the safe button');
  assert.doesNotMatch(s, /querySelector<HTMLElement>\('\.at-feeder-confirm button'\)\?\.focus/, 'the old first-button (affirmative) focus');
  assert.match(s, /const go = \(v: View\) => \{ askSnap\.current = null;/); assert.match(s, /onClick=\{\(\) => \{ askSnap\.current = null; setView\('main'\)/);
  assert.match(s, /if \(ok === true\) \{ askSnap\.current = null; setExpected/);
  assert.match(s, /addEventListener\('resize', resize\); vv\?\.addEventListener\('resize', resize\)/); assert.match(s, /removeEventListener\('resize', resize\); vv\?\.removeEventListener\('resize', resize\)/);
});
