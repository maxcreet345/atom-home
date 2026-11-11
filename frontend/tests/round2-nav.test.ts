// Round 2 of the audit of 09.11.2026, the shell (NAV): routing on old browsers, closes and «Back», the command guard, plural forms, the size of
// a touch kiosk, the arrows of a remote, the keyboard's place, the alarm banner, the question about the water, the settings read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decode, encode, pushView, leaveTo, landed, stayOn, type NavWindow, type View } from '../src/runtime/route.ts';
import { createCommands } from '../src/runtime/commands.ts';
import { translator, plural } from '../src/i18n/index.ts';
import { nearest, keepsArrows, DIR_OF, type Box } from '../src/ui/spatial-nav.ts';
import { focusVerdict } from '../src/ui/focus-keep.ts';
import { toastLife, confirmWords, swipeDelta } from '../src/ui/shell-logic.ts';
import { nextViewport } from '../src/ui/panel-size.ts';
import { rememberByShape } from '../src/runtime/remember-modules.ts';
import { activeSpecs } from '../src/modules/catalog.ts';
import { haStore } from '../src/runtime/ha-store.ts';
import { SaveError } from '../src/runtime/store.ts';
import { createLoader } from '../src/runtime/loader.ts';
import { readSecurity } from '../src/model/security.ts';
import { shellAlarm, announcement } from '../src/model/security-words.ts';
import { nextFire } from '../src/modules/clock-state.ts';
import { setHouseZone } from '../src/runtime/zone.ts';
import { defaultConfig, normaliseConfig } from '../src/model/config.ts';
import type { Action } from '../src/runtime/actions.ts';
import type { Registry, StateRow } from '../src/model/registry.ts';
import type { Hass } from '../src/runtime/host.ts';

const ru = translator('ru'), en = translator('en'), ro = translator('ro');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const view = (v: Partial<View>): View => ({ section: 'home', room: null, device: null, filter: null, ...v });
/** A window with a real history stack: `back()` lands only when `land()` is called, as the browser's does a tick later. */
function win(hash = '#home') {
  const stack: Array<{ state: unknown; hash: string }> = [{ state: null, hash }]; let at = 0, backs = 0, due = 0;
  const w: NavWindow & { land(): void; backs(): number; depth(): number } = {
    location: { get hash() { return stack[at].hash; }, set hash(_v: string) { /* unused */ } },
    history: { get state() { return stack[at].state; }, pushState(state, _u, url) { stack.splice(at + 1); stack.push({ state, hash: url }); at++; }, replaceState(state, _u, url) { stack[at] = { state, hash: url }; }, back() { backs++; due++; } },
    land() { while (due > 0) { due--; if (at > 0) at--; } }, backs: () => backs, depth: () => at,
  };
  return w;
}

// ---- f70: URLSearchParams.size does not exist in Safari ≤ 16 / Chromium ≤ 112
test('an address is written without URLSearchParams.size: a room, a sheet and a filter open in an old browser too', () => {
  const Real = globalThis.URLSearchParams;
  class Old extends Real { override get size(): number { return undefined as unknown as number; } }
  (globalThis as { URLSearchParams: unknown }).URLSearchParams = Old;
  try {
    assert.equal(encode(view({ section: 'rooms', room: 'kukhnia' })), '#rooms?room=kukhnia');
    assert.equal(encode(view({ device: 'clock' })), '#home?device=clock');
    assert.equal(encode(view({ section: 'energy', filter: 'now' })), '#energy?filter=now');
    assert.equal(encode(view({})), '#home');
    assert.deepEqual(decode(encode(view({ section: 'rooms', room: 'a b', device: 'e:light.x' }))), view({ section: 'rooms', room: 'a b', device: 'e:light.x' }));
  } finally { (globalThis as { URLSearchParams: unknown }).URLSearchParams = Real; }
});
test('the sources use no API that Safari 16 / Chromium 112 lack on a main path', () => {
  const walk = (dir: string): string[] => { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(resolve(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [resolve(dir, e.name)] : []); };
  const bad: string[] = [];
  for (const file of walk(resolve(import.meta.dirname, '../src'))) {
    const text = readFileSync(file, 'utf8');
    for (const [name, re] of [['URLSearchParams.size', /\b(params|p|q|search|query)\.size\b/], ['Object.groupBy', /Object\.groupBy|Map\.groupBy/], ['Promise.withResolvers', /Promise\.withResolvers/], ['toSorted/toReversed/toSpliced', /\.(toSorted|toReversed|toSpliced)\(/], ['findLast', /\.findLast(Index)?\(/], ['Array.fromAsync', /Array\.fromAsync/], ['checkVisibility', /\.checkVisibility\(/], ['AbortSignal.any', /AbortSignal\.any/]] as Array<[string, RegExp]>)
      if (re.test(text)) bad.push(`${file.split('/src/')[1]}: ${name}`);
  }
  assert.deepEqual(bad, []);
});

// ---- l23: two closes in one tick are one step back
test('two closes of a sheet before the first has landed make one history.back()', () => {
  const w = win('#lights'); pushView(w, view({ section: 'lights', device: 'e:light.a' }));
  const close = () => leaveTo(w, view({ section: 'lights' }), p => p.section === 'lights' && !p.device);
  assert.equal(close(), 'back'); assert.equal(close(), 'back'); assert.equal(close(), 'back');
  assert.equal(w.backs(), 1, 'the auto-close timer together with a tap on «×» is one close');
  w.land(); landed(w); assert.equal(w.location.hash, '#lights');
  // the next sheet closes as usual
  pushView(w, view({ section: 'lights', device: 'e:light.b' })); assert.equal(close(), 'back'); assert.equal(w.backs(), 2);
});
test('a close that never landed does not swallow closes for ever', async () => {
  const w = win('#lights'); pushView(w, view({ section: 'lights', device: 'e:light.a' }));
  const close = () => leaveTo(w, view({ section: 'lights' }), p => p.section === 'lights' && !p.device);
  close(); await sleep(1100); close();
  assert.equal(w.backs(), 2);
});
// ---- l86: «Back» with a question open closes the question only
test('stayOn puts the left entry back with the same way back', () => {
  const w = win('#home'); pushView(w, view({ section: 'lights' })); pushView(w, view({ section: 'lights', device: 'e:light.a' }));
  // the system «Back» with a question open over the sheet: the browser is on #lights now
  w.history.back(); w.land();
  assert.equal(w.location.hash, '#lights');
  assert.equal(stayOn(w, view({ section: 'lights', device: 'e:light.a' })), true);
  assert.equal(w.location.hash, '#lights?device=e%3Alight.a'); assert.equal(w.depth(), 2, 'the stack is as before');
  assert.equal(leaveTo(w, view({ section: 'lights' }), p => p.section === 'lights' && !p.device), 'back', 'and closing the sheet still goes back');
  assert.equal(stayOn(w, decode(w.location.hash)), false, 'the same address: nothing is pushed');
});

// ---- l53 / l181: the command guard
function rig(answer: () => Promise<void>) {
  const sent: Array<Record<string, unknown>> = [], busy: string[][] = [];
  const host = { online: true, async call(_d: string, _s: string, data: Record<string, unknown>) { sent.push(data); await answer(); } };
  return { sent, busy, commands: createCommands({ host: () => host, text: () => 'x', notify: () => undefined, changed: b => busy.push([...b]) }) };
}
test('brightness 60 → 100 → 60 within one answer sends three commands: the lamp ends at 60', async () => {
  const r = rig(() => sleep(40)), set = (v: number) => r.commands.call('light', 'turn_on', { entity_id: 'light.a', brightness_pct: v });
  await Promise.all([set(60), set(100), set(60)]);
  assert.deepEqual(r.sent.map(d => d.brightness_pct), [60, 100, 60]);
});
test('an identical call still on its way is joined (a double tap), also for another entity in between', async () => {
  const r = rig(() => sleep(30)), on = (id: string) => r.commands.call('light', 'turn_on', { entity_id: id });
  await Promise.all([on('light.a'), on('light.a'), on('light.b'), on('light.a')]);
  assert.deepEqual(r.sent.map(d => d.entity_id), ['light.a', 'light.b']);
  await on('light.a'); assert.equal(r.sent.length, 3, 'after the answer the same call is a new one');
});
test('on → off → on of one entity within one answer are three commands (the last one wins in the house)', async () => {
  const r = rig(() => sleep(30)); const calls: string[] = [];
  const host2 = createCommands({ host: () => ({ online: true, async call(_d, s) { calls.push(s); await sleep(30); } }), text: () => '', notify: () => undefined });
  await Promise.all([host2.call('switch', 'turn_on', { entity_id: 'switch.a' }), host2.call('switch', 'turn_off', { entity_id: 'switch.a' }), host2.call('switch', 'turn_on', { entity_id: 'switch.a' })]);
  assert.deepEqual(calls, ['turn_on', 'turn_off', 'turn_on']); assert.equal(r.sent.length, 0);
});
test('the shell is told about «busy» only when the set of keys changes: a slider streaming overlapping values is one hold and one release', async () => {
  const r = rig(() => sleep(30));
  await Promise.all([1, 2, 3, 4].map(v => r.commands.run('lamp', () => r.commands.call('light', 'turn_on', { entity_id: 'light.a', brightness_pct: v }), { stream: true })));
  assert.deepEqual(r.busy, [['lamp'], []]);
  assert.equal(r.commands.pending('lamp'), false);
});

// ---- l73: plural forms
test('plural: two and three forms are understood, a numeric string counts', () => {
  assert.equal(plural('en', 1, ['{n} lamp', '{n} lamps']), '{n} lamp'); assert.equal(plural('en', 5, ['{n} lamp', '{n} lamps']), '{n} lamps');
  assert.equal(plural('ru', 21, ['{n} лампа', '{n} лампы', '{n} ламп']), '{n} лампа');
  assert.equal(plural('ru', 3, ['{n} лампа', '{n} лампы', '{n} ламп']), '{n} лампы');
  assert.equal(plural('ru', 11, ['{n} лампа', '{n} лампы', '{n} ламп']), '{n} ламп');
  assert.equal(plural('ru', 5, ['{n} лампа', '{n} ламп']), '{n} ламп', 'two forms: one | other');
  assert.equal(plural('ro', 1, ['o lampă', '{n} lămpi', '{n} de lămpi']), 'o lampă'); assert.equal(plural('ro', 20, ['o lampă', '{n} lămpi', '{n} de lămpi']), '{n} de lămpi');
  // four forms as before
  for (const [n, want] of [[0, 'd'], [1, 'b'], [2, 'c'], [5, 'd'], [11, 'd'], [21, 'b'], [104, 'c']] as const) assert.equal(plural('ru', n, ['a', 'b', 'c', 'd']), want, `ru ${n}`);
  assert.equal(plural('en', 1, ['a', 'b', 'c', 'd']), 'b'); assert.equal(plural('en', 2, ['a', 'b', 'c', 'd']), 'd'); assert.equal(plural('ro', 0, ['a', 'b', 'c', 'd']), 'c'); assert.equal(plural('ro', 25, ['a', 'b', 'c', 'd']), 'd');
  // through the translator: a number given as a string never leaves «a|b|c|d» on the screen
  assert.equal(ru('rooms.count', { n: '3' }), ru('rooms.count', { n: 3 })); assert.ok(!ru('rooms.count', { n: '3' }).includes('|'));
  assert.equal(en('rooms.count', { n: '1' }), en('rooms.count', { n: 1 })); assert.ok(!ro('rooms.count', { n: '7' }).includes('|'));
});

// ---- f5: the arrows of a remote
const box = (left: number, top: number, w = 100, h = 100): Box => ({ left, top, right: left + w, bottom: top + h });
test('arrows: the nearest control in the direction, the same row or column first', () => {
  // a 3×2 grid of tiles and a rail on the left
  const grid = [box(200, 100), box(320, 100), box(440, 100), box(200, 220), box(320, 220), box(440, 220)], rail = [box(0, 0, 80, 60), box(0, 70, 80, 60), box(0, 140, 80, 60)], all = [...grid, ...rail];
  const go = (from: number, dir: 'up' | 'down' | 'left' | 'right') => { const others = all.filter((_, i) => i !== from), i = nearest(all[from], others, dir); return i < 0 ? -1 : all.indexOf(others[i]); };
  assert.equal(go(0, 'right'), 1); assert.equal(go(1, 'right'), 2); assert.equal(go(1, 'left'), 0); assert.equal(go(0, 'down'), 3); assert.equal(go(4, 'up'), 1);
  assert.equal(go(0, 'left'), 8, 'from the first column the rail is reached (the button most level with the tile)');
  assert.equal(go(3, 'left'), 8, 'no rail button level with the second row: the nearest one'); assert.equal(go(7, 'right'), 0, 'and back from the rail to the tiles'); assert.equal(go(8, 'right'), 0);
  assert.equal(go(2, 'right'), -1, 'nothing to the right of the last column: no move, the browser scrolls');
  assert.equal(go(5, 'down'), -1);
  assert.equal(go(6, 'down'), 7, 'the rail is walked up and down'); assert.equal(go(8, 'up'), 7);
});
test('arrows: a control inside another one (the «…» of a tile) can be reached, an empty box cannot', () => {
  const tile = box(0, 0, 200, 100), more = box(160, 10, 30, 30), next = box(220, 0, 200, 100), ghost = { left: 240, top: 0, right: 240, bottom: 0 };
  assert.equal(nearest(tile, [more, next, ghost], 'right'), 0, 'the nearest to the right is the button inside');
  assert.equal(nearest(more, [tile, next, ghost], 'right'), 1);
  assert.equal(nearest(tile, [ghost], 'right'), -1);
});
test('arrows: without a neighbour in the row, the nearest one that way wins; sideways counts double', () => {
  const from = box(300, 0), below = box(280, 400), farSide = box(900, 150);
  assert.equal(nearest(from, [farSide, below], 'down'), 1, 'what overlaps the column comes first');
  assert.equal(nearest(box(0, 0), [box(400, 150), box(150, 300)], 'down'), 1, 'neither overlaps: the nearer by distance');
});
test('arrows: only the four arrows are keys of it, and a field, a select and a slider keep theirs', () => {
  assert.deepEqual([DIR_OF.ArrowUp, DIR_OF.ArrowDown, DIR_OF.ArrowLeft, DIR_OF.ArrowRight, DIR_OF.Tab, DIR_OF.Enter], ['up', 'down', 'left', 'right', undefined, undefined]);
  const el = (hits: boolean) => ({ matches: () => hits }) as unknown as Element;
  assert.equal(keepsArrows(el(true)), true); assert.equal(keepsArrows(el(false)), false); assert.equal(keepsArrows(null), false);
  const src = readFileSync(new URL('../src/ui/spatial-nav.ts', import.meta.url), 'utf8'), own = /const OWN_ARROWS = '([^']+)'/.exec(src)?.[1] ?? '';
  for (const part of ['textarea', 'select', '[role="slider"]', 'contenteditable', 'input:not([type="checkbox"]):not([type="radio"])']) assert.ok(own.includes(part), part);
  assert.match(src, /e\.defaultPrevented \|\| e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey/, 'a handled key or one with a modifier is left alone');
  assert.match(src, /if \(!to\) return;[^\n]*\n\s*e\.preventDefault\(\)/, 'the key is taken only when the focus really moves');
});

// ---- f0 / f69: the keyboard's place
test('the focus net: a focused control that becomes disabled is owed the focus and gets it back when it is free', () => {
  assert.equal(focusVerdict({ disabled: true, isLast: true, isOwed: false, focusOnIt: true, focusLost: false }), 'owe', 'the browser has not dropped the focus yet');
  assert.equal(focusVerdict({ disabled: true, isLast: true, isOwed: false, focusOnIt: false, focusLost: true }), 'owe', 'the focus is already on body');
  assert.equal(focusVerdict({ disabled: true, isLast: false, isOwed: false, focusOnIt: false, focusLost: true }), 'nothing', 'another control went busy: not ours');
  assert.equal(focusVerdict({ disabled: true, isLast: true, isOwed: false, focusOnIt: false, focusLost: false }), 'nothing', 'the person is already elsewhere');
  assert.equal(focusVerdict({ disabled: false, isLast: true, isOwed: true, focusOnIt: false, focusLost: true }), 'restore');
  assert.equal(focusVerdict({ disabled: false, isLast: false, isOwed: true, focusOnIt: false, focusLost: false }), 'forget', 'the person moved on: nothing is taken from them');
  assert.equal(focusVerdict({ disabled: false, isLast: true, isOwed: false, focusOnIt: false, focusLost: true }), 'nothing');
});

// ---- the toast, the question, the swipe
test('a message stays at least six seconds, longer for a long sentence, never for ever', () => {
  assert.equal(toastLife('Нет связи с домом'), 6000); assert.equal(toastLife('x', 2000), 6000, 'never shorter than six seconds');
  assert.equal(toastLife('Atom Home обновлён', 15000), 15000);
  const long = toastLife('Дом отклонил команду: ' + 'причина '.repeat(20)); assert.ok(long > 6000 && long <= 20000, String(long));
  assert.equal(toastLife('я'.repeat(2000)), 20000);
});
const SEC_ROWS: Array<[string, string | null, string, Record<string, unknown>?, string?]> = [
  ['alarm_control_panel.alarmo', null, 'disarmed', { bypassed_sensors: [] }, 'alarmo'],
  ['binary_sensor.hall_door_contact', 'hall', 'off', { device_class: 'door', friendly_name: 'Входная дверь' }],
  ['binary_sensor.kitchen_gas', 'kitchen', 'off', { device_class: 'gas', friendly_name: 'Кухня · Датчик газа' }],
  ['binary_sensor.bath_leak_water_leak', 'bath', 'off', { device_class: 'moisture', friendly_name: 'Ванная · Датчик протечки' }],
  ['binary_sensor.hall_door_tamper', 'hall', 'off', { device_class: 'tamper', friendly_name: 'Входная дверь · Корпус' }],
  ['valve.bath_water', 'bath', 'closed', { device_class: 'water', friendly_name: 'Кран воды' }],
];
function house(over: Record<string, string> = {}, alarmAttrs: Record<string, unknown> = {}): Registry {
  return { areas: [['hall', 'Прихожая'], ['kitchen', 'Кухня'], ['bath', 'Ванная']].map(([area_id, name]) => ({ area_id, name })), devices: [],
    entities: SEC_ROWS.map(([entity_id, area_id, , , platform]) => ({ entity_id, device_id: null, area_id, name: null, original_name: null, platform: platform ?? 'mqtt', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(SEC_ROWS.map(([id, , state, attrs]) => [id, { state: over[id] ?? state, attributes: { ...(attrs ?? {}), ...(id.startsWith('alarm_') ? alarmAttrs : {}) }, last_changed: new Date(Date.now() - 10000).toISOString(), last_updated: new Date().toISOString() }])) } as unknown as Registry;
}
const valveOpen: Action = { id: 'open', label: 'action.open', kind: 'button', domain: 'valve', service: 'open_valve', entityId: 'valve.bath_water', confirm: true, risk: 'water' };
test('opening the water while a leak sensor is wet: the shell\'s question names the leak and offers «Оставить закрытым» first', () => {
  const wet = readSecurity(house({ 'binary_sensor.bath_leak_water_leak': 'on' }))!, dry = readSecurity(house())!;
  const ask = confirmWords(valveOpen, 'Кран воды', ru, wet);
  assert.equal(ask.leak, true); assert.match(ask.text, /протечка/i); assert.match(ask.text, /Ванная/); assert.equal(ask.no, 'Оставить закрытым'); assert.notEqual(ask.yes, ask.no);
  assert.equal(confirmWords(valveOpen, 'Кран воды', en, wet).leak, true); assert.ok(!confirmWords(valveOpen, 'Кран воды', ro, wet).text.includes('sec.'));
  const calm = confirmWords(valveOpen, 'Кран воды', ru, dry);
  assert.deepEqual([calm.leak, calm.text, calm.no], [false, 'Открыть кран «Кран воды»? Вода пойдёт сразу.', 'Отмена']);
  assert.equal(confirmWords(valveOpen, 'Кран воды', ru, null).leak, false, 'a house without the security card asks as before');
  const close = confirmWords({ ...valveOpen, id: 'close', service: 'close_valve', label: 'action.close' }, 'Кран воды', ru, wet);
  assert.equal(close.leak, false, 'closing the water during a leak is not warned against');
  // every other question keeps its words
  const off: Action = { id: 'all_off', label: 'x', kind: 'button', domain: 'light', service: 'turn_off', entityId: 'light.a,light.b', confirm: true, risk: 'normal' as Action['risk'] };
  assert.equal(confirmWords(off, 'Свет', ru, wet).text, ru('confirm.lightsOff', { n: 2 }));
  const plain: Action = { id: 'zzz', label: 'Перезапуск', kind: 'button', domain: 'button', service: 'press', entityId: 'button.x', confirm: true, risk: 'normal' as Action['risk'] };
  assert.deepEqual([confirmWords(plain, 'Роутер', ru, null).text, confirmWords(plain, 'Роутер', ru, null).yes], ['Выполнить «Перезапуск» для «Роутер»?', 'Выполнить']);
});
test('the sheet follows the finger in the shell\'s own pixels under a zoom', () => {
  assert.equal(swipeDelta(300, 100, 1), 200); assert.equal(swipeDelta(300, 100, 2), 100); assert.equal(swipeDelta(250, 100, 1.5), 100);
  assert.equal(swipeDelta(50, 100, 2), 0, 'never upwards'); assert.equal(swipeDelta(300, 100, 0), 200); assert.equal(swipeDelta(300, 100, NaN), 200);
});

// ---- f43: the house's alarm for the whole shell
test('the shell\'s alarm: an alarm, gas, water and the entry delay — in the tile\'s words; nothing for a calm house or a tamper alone', () => {
  assert.equal(shellAlarm(readSecurity(house())!, ru, 1, false), null);
  const trig = shellAlarm(readSecurity(house({ 'alarm_control_panel.alarmo': 'triggered', 'binary_sensor.hall_door_contact': 'on' }))!, ru, 0, false)!;
  assert.deepEqual([trig.id, trig.text, trig.counting], ['triggered', 'Тревога!', false]); assert.match(trig.sub, /входная дверь/i);
  const leak = shellAlarm(readSecurity(house({ 'binary_sensor.bath_leak_water_leak': 'on' }))!, ru, 1, false)!;
  assert.equal(leak.text, 'Протечка!'); assert.match(leak.sub, /Ванная/); assert.match(leak.id, /^hazard:binary_sensor\.bath_leak/); assert.equal(leak.counting, false);
  const gas = shellAlarm(readSecurity(house({ 'binary_sensor.kitchen_gas': 'on', 'alarm_control_panel.alarmo': 'pending' }, { delay: 30 }))!, ru, 1, false)!;
  assert.equal(gas.text, 'Утечка газа!'); assert.equal(gas.counting, false, 'gas comes before the entry delay');
  const pending = readSecurity(house({ 'alarm_control_panel.alarmo': 'pending' }, { delay: 30 }))!, p = shellAlarm(pending, ru, 0, false)!;
  assert.equal(p.text, 'Вход — снимите охрану'); assert.equal(p.counting, pending.alarm.delayEnds !== null);
  // the live region and the banner say the same thing
  assert.equal(announcement(pending, ru, 0, false), `${p.text}. ${p.sub}`);
  for (const t of [en, ro]) { const x = shellAlarm(readSecurity(house({ 'alarm_control_panel.alarmo': 'triggered' }))!, t, 0, false)!; assert.ok(x.text && !x.text.includes('sec.') && !x.sub.includes('sec.'), x.text); }
  assert.equal(shellAlarm(readSecurity(house({ 'alarm_control_panel.alarmo': 'armed_away' }))!, ru, 0, false), null, 'an armed house is not an alarm');
});

// ---- f74: the modules are found again only when something that decides them changed
const fixturePath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry.json'), ownerPath = resolve(import.meta.dirname, '../../../clients/criuleni/atom-home-config-20261028.json');
const fixture: Registry | null = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
const ownerConfig = existsSync(ownerPath) ? normaliseConfig(JSON.parse(readFileSync(ownerPath, 'utf8'))).config : defaultConfig('Дом');
const row = (state: string, attributes: Record<string, unknown> = {}): StateRow => ({ state, attributes, last_changed: '2026-11-09T10:00:00+00:00', last_updated: '2026-11-09T10:00:00+00:00' });
test('modules with a memory: a value change costs no search, a state that appears or goes silent does', () => {
  let searches = 0;
  const keyOf = (list: ReturnType<typeof activeSpecs>) => JSON.stringify(list.map(a => [a.spec.id, a.label, a.entities, a.options]));
  const find = rememberByShape((r, c) => { searches++; return activeSpecs(r, c); }, keyOf);
  const cfg = defaultConfig('Дом');
  const reg: Registry = { areas: [], devices: [], floors: [], entities: ['sensor.co2', 'sensor.t'].map(id => ({ entity_id: id, device_id: null, area_id: null, name: null, original_name: id, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null })) as unknown as Registry['entities'],
    states: { 'sensor.co2': row('650', { device_class: 'carbon_dioxide' }), 'sensor.t': row('21', { device_class: 'temperature' }) } } as Registry;
  const a = find(reg, cfg); assert.equal(searches, 1); assert.deepEqual(a, activeSpecs(reg, cfg));
  assert.equal(find(reg, cfg), a); assert.equal(find({ ...reg }, cfg), a, 'a new registry object with the same parts');
  const v2 = { ...reg, states: { ...reg.states, 'sensor.co2': row('700', { device_class: 'carbon_dioxide' }) } };
  assert.equal(find(v2, cfg), a, 'a new value: the very same array'); assert.equal(searches, 1, '…and nothing was searched');
  const withSun = { ...v2, states: { ...v2.states, 'sun.sun': row('below_horizon') } };
  const b = find(withSun, cfg); assert.equal(searches, 2, 'a state appeared: found anew'); assert.deepEqual(b, activeSpecs(withSun, cfg));
  const silent = { ...withSun, states: { ...withSun.states, 'sensor.co2': row('unavailable', { device_class: 'carbon_dioxide' }) } };
  const c = find(silent, cfg); assert.equal(searches, 3, 'a sensor went silent: found anew'); assert.deepEqual(c, activeSpecs(silent, cfg));
  const renamed = { ...silent, states: { ...silent.states, 'sensor.t': row('21', { device_class: 'temperature', friendly_name: 'T' }) } };
  find(renamed, cfg); assert.equal(searches, 4, 'a name or a new attribute may decide a module');
  const sameAgain = find({ ...renamed, states: { ...renamed.states, 'sensor.t': row('22', { device_class: 'temperature', friendly_name: 'T' }) } }, cfg);
  assert.equal(searches, 4); assert.deepEqual(sameAgain, activeSpecs(renamed, cfg));
  find(renamed, { ...cfg }); assert.equal(searches, 5, 'new settings: found anew');
});
test('modules with a memory: on the house\'s registry the answer is activeSpecs\' own, and 300 value changes search once', { skip: !fixture }, () => {
  let searches = 0; const reg = fixture!;
  const find = rememberByShape((r, c) => { searches++; return activeSpecs(r, c); }, list => JSON.stringify(list.map(a => [a.spec.id, a.label, a.entities, a.options])));
  const first = find(reg, ownerConfig); assert.ok(first.length > 0); assert.deepEqual(first, activeSpecs(reg, ownerConfig));
  const ids = Object.keys(reg.states).filter(id => id.startsWith('sensor.') && Number.isFinite(Number(reg.states[id].state))).slice(0, 300); let cur = reg;
  for (const id of ids) { cur = { ...cur, states: { ...cur.states, [id]: { ...cur.states[id], state: String(Number(cur.states[id].state) + 1) } } }; assert.equal(find(cur, ownerConfig), first); }
  assert.equal(searches, 1); assert.deepEqual(find(cur, ownerConfig), activeSpecs(cur, ownerConfig));
});

// ---- l178: a resize that changes nothing draws nothing
test('the panel\'s size: the same object while the rounded size is the same', () => {
  const a = { width: 1070, height: 764 };
  assert.equal(nextViewport(a, 1070.4, 764.9), a, 'a sub-pixel change is no change');
  assert.deepEqual(nextViewport(a, 1071, 764), { width: 1071, height: 764 });
  assert.deepEqual(nextViewport(a, 10, 10), { width: 320, height: 320 }, 'never under 320');
  const src = readFileSync(new URL('../src/live-main.tsx', import.meta.url), 'utf8');
  assert.match(src, /if \(next === this\.viewport && this\.sized\) return;/, 'measure() does not draw for it');
});

// ---- l134: the settings are never taken for the factory set
const hassWith = (answers: Array<() => unknown>): { hass: () => Hass; sent: Array<Record<string, unknown>> } => { const sent: Array<Record<string, unknown>> = []; let i = 0;
  return { sent, hass: () => ({ callWS: async (msg: Record<string, unknown>) => { sent.push(msg); if (msg.type !== 'atom_home/config/get') return { saved: true, revision: 99 }; const a = answers[Math.min(i++, answers.length - 1)]; return a(); } }) as unknown as Hass }; };
test('config/get refused with not_loaded (the entry is being reloaded): the read fails, is tried again, and nothing can be saved meanwhile', async () => {
  const cfg = defaultConfig('Дом'); cfg.home.name = 'Criuleni';
  const { hass, sent } = hassWith([() => { throw { code: 'not_loaded', message: 'Atom Home is not set up' }; }, () => { throw { code: 'not_loaded', message: 'Atom Home is not set up' }; }, () => ({ config: cfg, revision: 7, version: '1.25.8', admin: true })]);
  const store = haStore(hass); let real: string | null = null, failed = 0;
  const loader = createLoader(async () => { real = (await store.load()).config.home.name; }, { failed: () => { failed++; }, delays: [10, 10, 10] });
  assert.equal(await loader.run(), false); assert.equal(real, null, 'no factory set is taken for the house\'s settings'); assert.equal(loader.waiting, true, 'the next try is scheduled by itself');
  await assert.rejects(store.save(cfg), (e: unknown) => e instanceof SaveError && e.code === 'not_loaded');
  assert.ok(!sent.some(m => m.type === 'atom_home/config/set'), 'nothing was written over the real settings');
  await sleep(60); assert.equal(real, 'Criuleni'); assert.equal(failed, 2); loader.stop();
  await store.save(cfg); assert.equal(sent.filter(m => m.type === 'atom_home/config/set').at(-1)?.expected_revision, 7);
});
test('an older integration answers «config: null, revision: 0» during the reload: a house whose settings were read keeps them', async () => {
  const cfg = defaultConfig('Дом'); cfg.home.name = 'Criuleni';
  const { hass, sent } = hassWith([() => ({ config: cfg, revision: 7, version: '1.25.7', admin: true }), () => ({ config: null, revision: 0, version: '1.25.7', admin: true }), () => ({ config: cfg, revision: 7, version: '1.25.7', admin: true })]);
  const store = haStore(hass); assert.equal((await store.load()).config.home.name, 'Criuleni');
  await assert.rejects(store.load(), (e: unknown) => e instanceof SaveError && e.code === 'not_loaded', 'the empty answer is a failed read, not a house without settings');
  await store.save(cfg); assert.equal(sent.at(-1)?.expected_revision, 7, 'the revision read before stands');
  assert.equal((await store.load()).revision, 7);
  // a house that really has no settings yet (a fresh install) is read as before
  const fresh = haStore(hassWith([() => ({ config: null, revision: 0, version: '1.25.8', admin: true })]).hass); assert.equal((await fresh.load()).revision, 0);
});

// ---- ENERGY-3: an alarm's moment is built on the house's calendar
test('an alarm at 02:30 in the house, seen from New York on the night its clocks jump, is not an hour late', () => {
  const was = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York'; setHouseZone('Europe/Chisinau');
    // 8 March 2026, 00:10 in Chișinău (UTC+2) = 7 March 22:10 UTC; in New York 02:30 of 8 March does not exist
    const now = new Date(Date.UTC(2026, 2, 7, 22, 10));
    assert.equal(nextFire({ time: '02:30', days: [], enabled: true }, now), Date.UTC(2026, 2, 8, 0, 30));
    assert.equal(nextFire({ time: '02:30', days: [7], enabled: true }, now), Date.UTC(2026, 2, 8, 0, 30), '8 March 2026 is a Sunday in the house');
    assert.equal(nextFire({ time: '02:30', days: [1], enabled: true }, now), Date.UTC(2026, 2, 9, 0, 30));
    assert.equal(nextFire({ time: '00:05', days: [], enabled: true }, now), Date.UTC(2026, 2, 8, 22, 5), 'already past today: tomorrow');
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; setHouseZone(undefined); }
});

// ---- f73: nothing is prepared under the first finger
test('the shell creates no audio context on the first touch (beep() makes it when a sound is due)', () => {
  const app = readFileSync(new URL('../src/ui/app.tsx', import.meta.url), 'utf8'), shell = app.slice(0, app.indexOf('\ntype Common ='));
  assert.ok(!/armBeep|requestIdleCallback|AudioContext/.test(shell), 'no warm-up in AtomApp');
  const clock = readFileSync(new URL('../src/modules/clock.tsx', import.meta.url), 'utf8');
  assert.match(clock, /export function beep\(\): void \{\s*try \{\s*audio \?\?= new/, 'beep() builds the context itself');
});
// ---- the shell wires what the helpers above decide (the parts that live inside the component)
test('AtomApp: the focus net, the arrows, the whole-config re-read and the unsaved echo are wired', () => {
  const app = readFileSync(new URL('../src/ui/app.tsx', import.meta.url), 'utf8');
  assert.match(app, /keepFocus\(el\)/); assert.match(app, /arrowNav\(navigationWindow/);
  assert.ok(!/focusLater/.test(app), 'one mechanism: the old per-sheet «focus later» is folded into the net');
  assert.match(app, /confirmed\.current = r\.config; setConfig\(r\.config\); onConfigChange\?\.\(r\.config\)/, 'f57: the settings are taken whole after the alarm flag changed');
  assert.match(app, /if \(unsaved\.current\.has\(initialConfig\)\) return;/, 'l26: the echo of an unsaved value is not «confirmed»');
  assert.ok(!/JSON\.stringify\(found/.test(app) && /rememberModules\(\)/.test(app), 'f74: no per-render stringify of the modules');
  assert.match(app, /configPending \? null[^:]*: repair\(view/, 'l27: nothing is repaired while the settings are not read');
});
// ---- l171: no label is written into the code in one language
test('ui/primitives.tsx carries no Russian label (the unused Tabs / Pager with hard-coded aria-labels are gone)', () => {
  const src = readFileSync(new URL('../src/ui/primitives.tsx', import.meta.url), 'utf8');
  assert.ok(!/aria-label="[^"]*[А-Яа-яЁё]/.test(src) && !/>[^<{]*[А-Яа-яЁё][^<{]*</.test(src));
  assert.match(src, /export function Icon\(/);
});
// ---- l185: a regression that hangs a test ends the run
test('npm test has a timeout: a hanging test fails instead of stopping the gate for ever', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.test, /--test-timeout=\d{4,}/);
});
