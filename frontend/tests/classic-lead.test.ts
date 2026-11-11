// Release «classic», step 4 (11.11.2026), the lead's own items, ported from design-2026 pass 3 and the Codex review: the shell's findings
// (CODEX-001, -003, -014) and the header menu (ST-09). Each test fails on the tree before this release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { customAction, mandatoryRisk, serviceCall } from '../src/runtime/actions.ts';
import { confirmWords } from '../src/ui/shell-logic.ts';
import { translator } from '../src/i18n/index.ts';
import { readSecurity } from '../src/model/security.ts';
import type { Registry } from '../src/model/registry.ts';

const ru = translator('ru');

// ---- CODEX-001: an owner's button cannot switch off the question the house always asks
const ROWS: Array<[string, string | null, string, Record<string, unknown>?, string?]> = [
  ['alarm_control_panel.alarmo', null, 'disarmed', { bypassed_sensors: [] }, 'alarmo'],
  ['binary_sensor.hall_door_contact', 'hall', 'off', { device_class: 'door', friendly_name: 'Входная дверь' }],
  ['binary_sensor.bath_leak_water_leak', 'bath', 'off', { device_class: 'moisture', friendly_name: 'Ванная · Датчик протечки' }],
  ['valve.bath_water', 'bath', 'closed', { device_class: 'water', friendly_name: 'Кран воды' }],
];
function house(over: Record<string, string> = {}): Registry {
  return { areas: [['hall', 'Прихожая'], ['bath', 'Ванная']].map(([area_id, name]) => ({ area_id, name })), devices: [],
    entities: ROWS.map(([entity_id, area_id, , , platform]) => ({ entity_id, device_id: null, area_id, name: null, original_name: null, platform: platform ?? 'mqtt', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(ROWS.map(([id, , state, attrs]) => [id, { state: over[id] ?? state, attributes: { ...(attrs ?? {}) }, last_changed: new Date(Date.now() - 10000).toISOString(), last_updated: new Date().toISOString() }])) } as unknown as Registry;
}
const btn = (service: string, target: Record<string, unknown> = {}, confirm = false) => customAction({ id: 'x', label: 'Кнопка', service, target, confirm });

test('CODEX-001: water, locks and the alarm system always ask, whatever the button\'s «Подтверждать» says', () => {
  for (const [service, target, risk] of [
    ['valve.open_valve', { entity_id: 'valve.bath_water' }, 'water'], ['valve.set_valve_position', { entity_id: 'valve.bath_water' }, 'water'], ['valve.toggle', { entity_id: 'valve.bath_water' }, 'water'],
    ['homeassistant.turn_on', { entity_id: 'valve.bath_water' }, 'water'], ['homeassistant.toggle', { entity_id: ['light.a', 'valve.bath_water'] }, 'water'],
    ['lock.unlock', { entity_id: 'lock.front' }, 'security'], ['lock.open', { entity_id: 'lock.front' }, 'security'], ['lock.lock', { entity_id: 'lock.front' }, 'security'],
    ['alarm_control_panel.alarm_disarm', { entity_id: 'alarm_control_panel.alarmo' }, 'security'], ['alarm_control_panel.alarm_arm_vacation', { entity_id: 'alarm_control_panel.alarmo' }, 'security'],
    ['alarm_control_panel.alarm_arm_away', {}, 'security'], ['alarmo.disarm', { entity_id: 'alarm_control_panel.alarmo' }, 'security'], ['homeassistant.toggle', { entity_id: 'lock.front' }, 'security'],
  ] as const) {
    const a = btn(service, target, false);
    assert.equal(a.confirm, true, `${service} asks with «Подтверждать» off`); assert.equal(a.risk, risk, service); assert.equal(mandatoryRisk(service, target), risk);
    assert.equal(btn(service, target, true).confirm, true, `${service} asks with «Подтверждать» on`);
  }
  // the safe way and the ordinary services keep the owner's flag (one tap, as before)
  for (const [service, target] of [['valve.close_valve', { entity_id: 'valve.bath_water' }], ['homeassistant.turn_off', { entity_id: 'valve.bath_water' }], ['light.turn_on', { entity_id: 'light.k' }], ['notify.mobile_app_phone', {}], ['scene.turn_on', { entity_id: 'scene.evening' }], ['homeassistant.turn_on', { entity_id: 'light.k' }]] as const) {
    assert.equal(btn(service, target, false).confirm, false, `${service} stays one tap`); assert.equal(btn(service, target, false).risk, 'custom'); assert.equal(mandatoryRisk(service, target), null);
  }
  // the call itself is unchanged: exactly the configured service, target and data
  assert.deepEqual(serviceCall(btn('valve.open_valve', { entity_id: 'valve.bath_water' })), { domain: 'valve', service: 'open_valve', data: { entity_id: 'valve.bath_water' } });
});

test('CODEX-001: an owner\'s button that opens the water during a leak names the leak and offers «Оставить закрытым» first', () => {
  const wet = readSecurity(house({ 'binary_sensor.bath_leak_water_leak': 'on' }))!;
  for (const a of [btn('valve.open_valve', { entity_id: 'valve.bath_water' }), btn('homeassistant.turn_on', { entity_id: 'valve.bath_water' })]) {
    const ask = confirmWords(a, 'Кнопка', ru, wet);
    assert.equal(ask.leak, true, a.service); assert.match(ask.text, /протечка/i); assert.equal(ask.no, 'Оставить закрытым');
  }
  assert.equal(confirmWords(btn('valve.close_valve', { entity_id: 'valve.bath_water' }, true), 'Кнопка', ru, wet).leak, false, 'closing is never warned against');
});

// ---- CODEX-003: a settings save asked for while an alarms write is on its way does not put the old alarms back
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { haStore } from '../src/runtime/ha-store.ts';
import { SaveError, rebaseAlarms } from '../src/runtime/store.ts';
import { defaultConfig, normaliseAlarms } from '../src/model/config.ts';
/** a fake Home Assistant that holds the alarms write until `release` (the Codex review's reproduction, codex-review/scratch/config_races.mjs) */
function slowHouse() {
  const initial = defaultConfig('Home');
  initial.alarms = normaliseAlarms([{ id: 'morning', time: '07:00', enabled: true, days: [1, 2, 3, 4, 5], room: 'bedroom', alice: 'tts', station: 'media_player.bedroom' }]);
  const box = { stored: structuredClone(initial), revision: 1, calls: [] as Array<Record<string, unknown>>, release: () => undefined as void };
  const gate = new Promise<void>(r => { box.release = r; });
  const hass = { async callWS(msg: Record<string, unknown>) {
    box.calls.push(structuredClone(msg));
    if (msg.type === 'atom_home/config/get') return { config: structuredClone(box.stored), revision: box.revision };
    if (msg.expected_revision !== box.revision) throw { code: 'conflict' };
    if (msg.type === 'atom_home/alarms/set') { await gate; box.stored.alarms = structuredClone(msg.alarms) as typeof box.stored.alarms; return { alarms: structuredClone(box.stored.alarms), revision: ++box.revision }; }
    if (msg.type === 'atom_home/config/set') { box.stored = structuredClone(msg.config) as typeof box.stored; return { saved: true, revision: ++box.revision }; }
    throw new Error('unexpected command');
  } };
  return { box, store: haStore(() => hass as never) };
}
test('CODEX-003 (store): a whole save queued behind an alarms write carries the alarms the house confirmed, and says so', async () => {
  const { box, store } = slowHouse(), loaded = await store.load();
  const off = loaded.config.alarms.map(a => ({ ...a, enabled: false }));
  const alarmSave = store.saveAlarms!(off);
  const themeSave = store.save({ ...loaded.config, home: { ...loaded.config.home, theme: 'dark' } }); // built before the alarms write settled: the old list
  box.release(); const [, r] = await Promise.all([alarmSave, themeSave]);
  assert.equal(box.stored.alarms[0].enabled, false, 'the switched-off alarm stays off in the house');
  assert.equal(box.stored.home.theme, 'dark', 'the theme is saved too');
  assert.equal(r.alarms?.[0].enabled, false, 'the save tells the panel which alarms the house holds');
  // a save built after the alarms write is sent as it is (it already holds the new list)
  const later = await store.save({ ...box.stored, home: { ...box.stored.home, theme: 'light' } } as never);
  assert.equal(later.alarms, undefined); assert.equal(box.stored.alarms[0].enabled, false);
});
test('CODEX-003 (panel): switching an alarm off and changing the theme meanwhile leaves the alarm off — in the house and on the screen', async () => {
  const app = fs.readFileSync(new URL('../src/ui/app.tsx', import.meta.url), 'utf8');
  const handlers = app.slice(app.indexOf('  const applyConfig = async'), app.indexOf('  const lang = config.home.language'));
  const make = new Function('config', 'store', 'SaveError', 'rebaseAlarms', `
    let visible = config; const confirmed = { current: config }, unsaved = { current: new WeakSet() }, saveSeq = { current: 0 }, failedSeq = { current: 0 }, configPending = false;
    const setConfig = next => { visible = next; }, onConfigChange = () => {}, notify = () => {}, translator = () => s => s;
    ${stripTypeScriptTypes(handlers)}
    return { applyConfig, applyAlarms, get visible() { return visible; } };`);
  const { box, store } = slowHouse(), loaded = await store.load(), ui = make(loaded.config, store, SaveError, rebaseAlarms);
  const alarmSave = ui.applyAlarms(loaded.config.alarms.map((a: { enabled: boolean }) => ({ ...a, enabled: false })));
  await Promise.resolve();
  const themeSave = ui.applyConfig({ ...ui.visible, home: { ...ui.visible.home, theme: 'dark' } });
  box.release(); await Promise.all([alarmSave, themeSave]);
  assert.equal(box.stored.alarms[0].enabled, false); assert.equal(box.stored.home.theme, 'dark');
  assert.equal(ui.visible.alarms[0].enabled, false, 'the screen shows the alarm off'); assert.equal(ui.visible.home.theme, 'dark');
});

// ---- CODEX-014: the header's time, date and greeting by the house's clock, not the browser's
test('CODEX-014: a house in Chisinau opened in a New York browser: the header says the house\'s 00:30, Wednesday 11 November, «Доброй ночи»', async () => {
  const was = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    const { setHouseZone } = await import('../src/runtime/zone.ts'), { headWords } = await import('../src/ui/head-words.ts');
    setHouseZone('Europe/Chisinau');
    const w = headWords(new Date('2026-11-10T22:30:00Z'), 'ru-RU');
    assert.equal(w.time, '00:30'); assert.match(w.date, /среда, 11 ноября/); assert.equal(w.greeting, 'overview.greeting.night');
    setHouseZone(undefined);
  } finally { process.env.TZ = was; }
  const app = fs.readFileSync(new URL('../src/ui/app.tsx', import.meta.url), 'utf8');
  assert.match(app, /const head = headWords\(now, locale\), time = head\.time, date = head\.date/, 'the shell takes its time and date from headWords');
  assert.match(app, /\$\{t\(head\.greeting\)\}/, 'and its greeting');
});

// ---- ST-09: a header menu ends above the panel's own tab bar, inside the panel, and moves up only when there is not even room for two rows
import { menuFit } from '../src/ui/panel-size.ts';
test('ST-09: the menu stops 12 px above the tab bar, not at the window\'s bottom', () => {
  // 568×320, a phone on its side: the menu opens at 60 px, the tab bar starts at 267 px
  const fit = menuFit({ left: 300, right: 520, top: 60, bottom: 420 }, { width: 568, height: 320, bottom: 267, top: 0 }, 1);
  assert.equal(fit.maxHeight, 267 - 12 - 60); assert.equal(fit.dy, undefined);
  // inside a zoomed shell (×2) the same in the shell's own pixels
  assert.equal(menuFit({ left: 300, right: 520, top: 120, bottom: 840 }, { width: 1136, height: 640, bottom: 534 }, 2).maxHeight, (534 - 24 - 120) / 2);
  // with no tab bar the window decides, as before
  assert.equal(menuFit({ left: 300, right: 520, top: 60, bottom: 420 }, { width: 568, height: 320 }, 1).maxHeight, 320 - 12 - 60);
});
test('ST-09: under the button there are not 96 px: the menu moves up into the panel, never above its top', () => {
  const fit = menuFit({ left: 10, right: 230, top: 230, bottom: 500 }, { width: 568, height: 320, bottom: 267, top: 0 }, 1);
  assert.ok(fit.dy !== undefined && fit.dy < 0, 'moved up'); assert.equal(230 + fit.dy! + fit.maxHeight!, 267 - 12, 'and ends 12 px above the tab bar');
  assert.ok(230 + fit.dy! >= 12, 'not above the top');
  const tight = menuFit({ left: 10, right: 230, top: 20, bottom: 500 }, { width: 568, height: 100, bottom: 100, top: 0 }, 1);
  assert.ok((tight.dy ?? 0) <= 0 && 20 + (tight.dy ?? 0) >= 12);
});

// ---- CODEX-018: the preview answers a light timer with now + the minutes, in the house's clock and offset, as the integration does
test('CODEX-018: houseIso writes the house\'s wall clock with its offset', async () => {
  const { houseIso } = await import('../src/runtime/zone.ts');
  assert.equal(houseIso(Date.parse('2026-11-11T10:45:00Z'), 'Europe/Chisinau'), '2026-11-11T12:45:00+02:00');
  assert.equal(houseIso(Date.parse('2026-07-01T21:30:00Z'), 'Europe/Chisinau'), '2026-07-02T00:30:00+03:00', 'summer time and the next day');
  assert.equal(houseIso(Date.parse('2026-11-11T10:45:00Z'), 'America/New_York'), '2026-11-11T05:45:00-05:00');
  const host = fs.readFileSync(new URL('../src/runtime/host.ts', import.meta.url), 'utf8');
  assert.match(host, /g\.__lightSleep\[id\] = houseIso\(Math\.ceil\(\(Date\.now\(\) \+ min \* 60_000\)/, 'the preview answers with now + minutes');
  assert.doesNotMatch(host, /2026-11-10T\$\{/, 'not a fixed 10 November');
});

// ---- the doorbell takeover shows the door: a LIVE frame (the shell's tile players are paused behind a sheet — the takeover's must not be,
// or it holds the stream and stays on a poster), HA's still while a camera's sheet holds the one stream. The preview's recorded frame does not
// tell paused from live, so the wiring itself is pinned here; qa-status checks what is shown.
test('ring takeover: its own live player, not the paused tile player; the still only while a camera sheet is open', () => {
  const app = fs.readFileSync(new URL('../src/ui/app.tsx', import.meta.url), 'utf8');
  const ring = app.slice(app.indexOf('{ringBanner && (() =>'), app.indexOf('<Takeover key="ring"'));
  assert.ok(ring.length > 0, 'the ring takeover is there');
  assert.doesNotMatch(ring, /player\(dev, 'tile'\)/, 'not the shell\'s tile player (paused behind any sheet)');
  assert.match(ring, /paused=\{false\}/, 'its own player plays');
  assert.match(ring, /camOpen = home\.devices\.find\(d => d\.key === view\.device\)\?\.kind === 'camera'/, 'one stream at a time: a camera sheet keeps it');
  assert.match(ring, /poster \? <img src=\{poster\} alt="" \/> : null/, 'HA\'s still otherwise');
});
