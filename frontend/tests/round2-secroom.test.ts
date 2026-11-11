// Round 2 of the audit (10.11.2026), the Security card and the room page: each check fails on the tree as it was before the fix it names.
// The file runs in a browser zone WEST of UTC and of the house on purpose: dates of the house must not move with it.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSecurity, calendarDay, returnDate, questionStands, delayClock, type Security } from '../src/model/security.ts';
import { announcement, tileLabel, tileWord, joined, failLine, sk } from '../src/model/security-words.ts';
import { readRoom, silence } from '../src/model/room.ts';
import { detail, quickState } from '../src/ui/room-words.ts';
import { translator } from '../src/i18n/index.ts';
import { ro } from '../src/i18n/ro.ts';
import { setHouseZone } from '../src/runtime/zone.ts';
import type { Registry } from '../src/model/registry.ts';

type Row = [id: string, area: string | null, state: string, attrs?: Record<string, unknown>, device?: string];
const AREAS = [['hall', 'Прихожая'], ['kitchen', 'Кухня'], ['bath', 'Ванная']];
const BASE: Row[] = [
  ['alarm_control_panel.alarmo', null, 'disarmed', { bypassed_sensors: [] }],
  ['binary_sensor.hall_door_contact', 'hall', 'off', { device_class: 'door', friendly_name: 'Входная дверь' }, 'door'],
  ['sensor.hall_door_battery', null, '100', {}, 'door'], ['sensor.hall_door_linkquality', null, '180', {}, 'door'],
  ['binary_sensor.kitchen_window_contact', 'kitchen', 'off', { device_class: 'window', friendly_name: 'Кухня · Окно' }],
  ['binary_sensor.kitchen_gas', 'kitchen', 'off', { device_class: 'gas', friendly_name: 'Кухня · Датчик газа' }, 'gas'],
  ['sensor.kitchen_gas_linkquality', null, '172', {}, 'gas'],
  ['binary_sensor.kitchen_smoke', 'kitchen', 'off', { device_class: 'smoke', friendly_name: 'Кухня · Датчик дыма' }],
  ['binary_sensor.kitchen_co', 'kitchen', 'off', { device_class: 'carbon_monoxide', friendly_name: 'Кухня · Датчик CO' }],
  ['binary_sensor.bath_leak_water_leak', 'bath', 'off', { device_class: 'moisture', friendly_name: 'Ванная · Датчик протечки' }],
  ['valve.bath_water', 'bath', 'open', { device_class: 'water', friendly_name: 'Кран воды' }],
  ['input_datetime.heating_vacation_return', null, 'unknown', {}],
];
function house(over: Record<string, string> = {}, alarmAttrs: Record<string, unknown> = {}, changed = new Date(Date.now() - 10000).toISOString()): Registry {
  return {
    areas: AREAS.map(([area_id, name]) => ({ area_id, name })), devices: ['door', 'gas'].map(id => ({ id, name: id, model: null, manufacturer: 'SONOFF', area_id: null })),
    entities: BASE.map(([entity_id, area_id, , , device]) => ({ entity_id, device_id: device ?? null, area_id, name: null, original_name: null, platform: entity_id.startsWith('alarm_') ? 'alarmo' : 'mqtt', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(BASE.map(([id, , state, attrs]) => [id, { state: over[id] ?? state, attributes: { ...(attrs ?? {}), ...(id.startsWith('alarm_') ? alarmAttrs : {}) }, last_changed: changed, last_updated: '' }])),
  } as unknown as Registry;
}
const ALARM = 'alarm_control_panel.alarmo', LANGS = ['ru', 'en', 'ro'] as const;

// ---- l5 / l98 / l158 / l166 / l195: no «Тревога!. Сработала…» ----
test('announcements and the tile\'s name never put a full stop after «!»: every loud state, three languages', () => {
  const loud: Array<[string, Record<string, string>, Record<string, unknown>?]> = [
    ['triggered', { [ALARM]: 'triggered' }], ['triggered with an open door', { [ALARM]: 'triggered', 'binary_sensor.hall_door_contact': 'on' }], ['entry delay', { [ALARM]: 'pending' }, { delay: 30 }],
    ['leak', { 'binary_sensor.bath_leak_water_leak': 'on' }], ['leak, valve shut', { 'binary_sensor.bath_leak_water_leak': 'on', 'valve.bath_water': 'closed' }],
    ['gas', { 'binary_sensor.kitchen_gas': 'on' }], ['smoke', { 'binary_sensor.kitchen_smoke': 'on' }], ['carbon monoxide', { 'binary_sensor.kitchen_co': 'on' }],
  ];
  for (const lang of LANGS) { const t = translator(lang);
    for (const [name, over, attrs] of loud) { const s = readSecurity(house(over, attrs))!;
      for (const text of [announcement(s, t, 1, false), tileLabel(s, t, 1, false)]) { assert.ok(text.length > 8, `${lang} ${name}`); assert.doesNotMatch(text, /[!?.…]\s*\./, `${lang} ${name}: ${text}`); assert.doesNotMatch(text, /\.\s*$/, `${lang} ${name}: no dangling stop`); }
    }
    // every tile name, the calm ones too
    for (const over of [{}, { [ALARM]: 'armed_away' }, { 'binary_sensor.kitchen_window_contact': 'on' }, { 'binary_sensor.kitchen_gas': 'unavailable' }]) assert.doesNotMatch(tileLabel(readSecurity(house(over))!, t, 1, false), /[!?.…]\s*\./);
  }
  const t = translator('ru');
  assert.equal(announcement(readSecurity(house({ [ALARM]: 'triggered' }))!, t, 1, false), 'Тревога! Сработала охрана');
  assert.equal(announcement(readSecurity(house({ 'binary_sensor.bath_leak_water_leak': 'on' }))!, t, 1, false), 'Протечка! Ванная. Перекройте воду');
  assert.equal(tileLabel(readSecurity(house())!, t, 1, false), 'Безопасность: Снято с охраны. Дверь и окна закрыты');
  assert.equal(announcement(readSecurity(house({ 'binary_sensor.bath_leak_water_leak': 'on' }))!, translator('en'), 1, false), 'Water leak! Ванная. Shut off the water');
  assert.equal(joined('Тревога!', 'Сработала охрана'), 'Тревога! Сработала охрана'); assert.equal(joined('Снято', 'Закрыто'), 'Снято. Закрыто'); assert.equal(joined('Вход', ''), 'Вход');
});
// ---- l126: one colon ----
test('a refusal is one sentence with one colon: «Не получилось: Дом отклонил команду: …» is not written', () => {
  const t = translator('ru'), refused = t('error.refused', { reason: 'кран занят' });
  assert.equal(failLine(sk(t, 'fail'), refused), 'Дом отклонил команду: кран занят');
  assert.equal(failLine(sk(t, 'fail'), t('ui.offline')), 'Не получилось: Нет связи с домом');
  for (const lang of LANGS) { const tt = translator(lang); assert.equal((failLine(sk(tt, 'fail'), tt('error.refused', { reason: 'x' })).match(/:/g) ?? []).length, 1, lang); }
});
// ---- l59, l160: Romanian ----
test('ro: the valve\'s exercise counts its days («în fiecare zi», «la 7 zile», «la 20 de zile»), never «la 1 zile»', () => {
  const t = translator('ro'), say = (n: number) => sk(t, 'exercise', { n: String(n), t: '03:00' });
  assert.equal(say(1), 'profilaxie în fiecare zi la 03:00'); assert.equal(say(7), 'profilaxie la 7 zile la 03:00'); assert.equal(say(20), 'profilaxie la 20 de zile la 03:00');
  assert.doesNotMatch(say(1), /1 zile/);
});
test('ro: the questions of Security and of the valve address the person one way («dumneavoastră»), and the mode has one name', () => {
  const mine = Object.entries(ro as Record<string, string>).filter(([k]) => /^(sec\.|confirm\.(alarm|valve)\.)/.test(k));
  const tu = /\b(Dezarmezi|Armezi|Deschizi|Închizi|Pornești|Oprești|Stingi|ești|vrei|poți)\b/;
  for (const [k, v] of mine) if (/\?/.test(v) || /^sec\.(say|st)\./.test(k)) assert.doesNotMatch(v, tu, k);
  assert.equal(ro['confirm.alarm.disarm'], 'Dezarmați casa?'); assert.match(ro['confirm.valve.open'], /^Deschideți robinetul/);
  for (const [k, v] of mine) assert.doesNotMatch(v, /Vacanță/, `${k}: the mode is «Concediu» on this page`);
});
// ---- f23: a valve that does not answer ----
test('the valve: `unavailable` is told apart («offline»: no command is sent to it), `unknown` still answers', () => {
  assert.equal(readSecurity(house({ 'valve.bath_water': 'unavailable' }))!.valve!.state, 'offline');
  assert.equal(readSecurity(house({ 'valve.bath_water': 'unknown' }))!.valve!.state, 'unknown');
  assert.equal(readSecurity(house({ 'valve.bath_water': 'closing' }))!.valve!.state, 'moving');
  for (const lang of LANGS) assert.notEqual(sk(translator(lang), 'valveOffline'), 'sec.valveOffline');
  assert.equal(sk(translator('ru'), 'valveOffline'), 'Кран не отвечает');
});
// ---- l119: a silent sensor shows no bars and no battery ----
test('a sensor that does not answer keeps no battery and signal beside «не отвечает»; one that answers keeps them', () => {
  const ok = readSecurity(house())!, door = ok.guarded.find(g => g.kind === 'door')!, gas = ok.hazards.find(h => h.what === 'gas')!;
  assert.equal(door.level, 100); assert.equal(door.signal, 'strong'); assert.equal(gas.signal, 'strong');
  const lost = readSecurity(house({ 'binary_sensor.hall_door_contact': 'unavailable', 'binary_sensor.kitchen_gas': 'unknown' }))!;
  const d2 = lost.guarded.find(g => g.kind === 'door')!, g2 = lost.hazards.find(h => h.what === 'gas')!;
  assert.equal(d2.open, null); assert.equal(d2.level, null); assert.equal(d2.signal, null); assert.equal(d2.low, false);
  assert.equal(g2.silent, true); assert.equal(g2.signal, null);
});
// ---- l47: the return date is a calendar date of the house ----
test('«Отпуск до 23 ноября» in a browser west of UTC; «today» for the return date is the house\'s day', () => {
  for (const [lang, locale, want] of [['ru', 'ru-RU', '23 ноября'], ['en', 'en-GB', '23 November'], ['ro', 'ro-RO', '23 noiembrie']] as const) assert.equal(calendarDay('2026-11-23', locale), want, lang);
  assert.equal(calendarDay(null, 'ru-RU'), null); assert.equal(calendarDay('unknown', 'ru-RU'), null);
  assert.notEqual(new Date('2026-11-23').getDate(), 23, 'this test must run west of UTC to mean anything');
  // 01:00 on the 23rd in the house (Chişinău) is still the evening of the 22nd in this browser (New York)
  setHouseZone('Europe/Chisinau'); const now = Date.parse('2026-11-23T01:00:00+02:00');
  try {
    assert.equal(readSecurity(house({ 'input_datetime.heating_vacation_return': '2026-11-22 00:00:00' }), undefined, now)!.vacation!.to, null, 'yesterday by the house\'s calendar has passed');
    assert.equal(readSecurity(house({ 'input_datetime.heating_vacation_return': '2026-11-23 00:00:00' }), undefined, now)!.vacation!.to, '2026-11-23');
  } finally { setHouseZone(undefined); }
});
// ---- l147: a past date is said, not dropped ----
test('a return date in the past (typed by keyboard) is an error, not «no date»; an empty field is «no date»', () => {
  assert.deepEqual(returnDate('', '2026-11-10'), { date: null, error: null });
  assert.deepEqual(returnDate('2026-11-10', '2026-11-10'), { date: '2026-11-10', error: null });
  assert.deepEqual(returnDate('2026-11-09', '2026-11-10'), { date: null, error: 'past' });
  assert.deepEqual(returnDate('2025-12-31', '2026-11-10'), { date: null, error: 'past' });
  assert.deepEqual(returnDate('12.11.2026', '2026-11-10'), { date: null, error: 'past' });
  for (const lang of LANGS) assert.notEqual(sk(translator(lang), 'ask.vacBackBad'), 'sec.ask.vacBackBad');
});
// ---- l56: a question whose ground is gone ----
test('a question is withdrawn when the house is already there: disarmed elsewhere, «Отпуск» flipped, the valve opened', () => {
  const armed = readSecurity(house({ [ALARM]: 'armed_away' }))!, off = readSecurity(house())!;
  assert.equal(questionStands('disarm', armed), true); assert.equal(questionStands('disarm', off), false);
  assert.equal(questionStands('disarm', readSecurity(house({ [ALARM]: 'pending' }, { delay: 30 }))!), true);
  assert.equal(questionStands('arm', off), true); assert.equal(questionStands('arm', armed), false);
  assert.equal(questionStands('vacOn', off), true); const vac = readSecurity(house({ [ALARM]: 'armed_vacation' }))!;
  assert.equal(questionStands('vacOn', vac), false); assert.equal(questionStands('vacOff', vac), true); assert.equal(questionStands('vacOff', off), false);
  assert.equal(questionStands('valve', readSecurity(house({ 'valve.bath_water': 'closed' }))!), true); assert.equal(questionStands('valve', off), false);
  assert.equal(questionStands('valve', readSecurity(house({ 'valve.bath_water': 'unavailable' }))!), false);
});
// ---- l54: the countdown does not trust the device's clock ----
test('the delay counts down by the house\'s clock: a tablet five minutes behind (or ahead) shows the seconds really left', () => {
  const H = Date.parse('2026-11-10T12:00:00Z'), iso = (ms: number) => new Date(ms).toISOString();
  const alarm: Pick<Security['alarm'], 'since' | 'delayEnds'> = { since: H - 12000, delayEnds: H - 12000 + 30000 };
  const states = (newest: number) => ({ a: { state: 'pending', attributes: {}, last_changed: iso(H - 12000), last_updated: iso(H - 12000) }, b: { state: '1', attributes: {}, last_changed: iso(H - 9e5), last_updated: iso(newest) } });
  for (const skew of [-300000, 0, 240000]) { // the device's clock against the house's
    const left = delayClock(), s1 = states(H), dev = H + skew;
    assert.equal(left(alarm, s1, dev), 18, `skew ${skew}`);
    assert.equal(left(alarm, s1, dev + 5000), 13, 'ticks with the device\'s own seconds');
    // a set that arrives late (a reconnect: its newest stamp is 8 s old) can only say «more» and is ignored
    assert.equal(left(alarm, states(H + 1000), dev + 9000), 9);
    // a fresher one may only tighten it
    assert.equal(left(alarm, states(H + 12000), dev + 11500), 6);
    assert.equal(left(alarm, states(H + 12000), dev + 60000), 0);
    assert.equal(left({ since: H, delayEnds: null }, s1, dev), null);
  }
  // the old way, for the record: (delayEnds − device clock) on a tablet 5 min behind was 5:18
  assert.equal((alarm.delayEnds! - (H - 300000)) / 1000, 318);
  // without any usable stamp the alarm's own change is the house's «now» (the whole delay), never the device's clock
  const bare = delayClock(); assert.equal(bare(alarm, { a: { state: 'pending', attributes: {}, last_changed: '', last_updated: '' } }, H + 86400000), 30);
});
// ---- f48 (logic half): the seconds stay on the word's line ----
test('the tile\'s «Постановка 1:13» is one unbreakable piece of text', () => {
  const s = readSecurity(house({ [ALARM]: 'arming' }, { delay: 120 }))!;
  assert.equal(tileWord(s, translator('ru'), 73), 'Постановка 1:13'); assert.doesNotMatch(tileWord(s, translator('ru'), 73), / /);
});

// ================= the room page =================
type E = [id: string, device: string, state: string, attrs?: Record<string, unknown>];
const DEV: Record<string, [name: string, area: string, model?: string]> = {
  w1: ['Кухня · Датчик левого окна', 'k'], w2: ['Кухня · Датчик центрального окна', 'k'], w3: ['Кухня · Датчик правого окна', 'k'],
  l1: ['Кухня · Датчик протечки (котёл)', 'k'], l2: ['Кухня · Датчик протечки (раковина)', 'k'], gas: ['Кухня · Датчик газа', 'k'], th: ['Кухня · Датчик температуры', 'k'],
  tv: ['Гостиная · Телевизор (Hisense)', 'g'], meter: ['Гостиная · Счётчик энергии (телевизор)', 'g', 'Zigbee energy meter'], lamp: ['Гостиная · Люстра', 'g'],
};
const ENT: E[] = [
  ['binary_sensor.k_window_left_contact', 'w1', 'off', { device_class: 'window' }], ['binary_sensor.k_window_center_contact', 'w2', 'off', { device_class: 'window' }], ['binary_sensor.k_window_right_contact', 'w3', 'off', { device_class: 'window' }],
  ['binary_sensor.k_leak_boiler_water_leak', 'l1', 'off', { device_class: 'moisture' }], ['binary_sensor.k_leak_sink_water_leak', 'l2', 'off', { device_class: 'moisture' }],
  ['binary_sensor.k_gas', 'gas', 'off', { device_class: 'gas' }], ['sensor.k_temperature', 'th', '21.4', { device_class: 'temperature' }],
  ['media_player.g_tv', 'tv', 'on'], ['sensor.g_tv_active_app', 'tv', 'Standby'], ['sensor.g_tv_meter_power', 'meter', '0.6', { device_class: 'power' }],
  ['light.g_lamp', 'lamp', 'off'],
];
function rooms(over: Record<string, string> = {}): Registry {
  return {
    areas: [{ area_id: 'k', name: 'Кухня', temperature_entity_id: 'sensor.k_temperature', humidity_entity_id: null }, { area_id: 'g', name: 'Гостиная', temperature_entity_id: null, humidity_entity_id: null }],
    devices: Object.entries(DEV).map(([id, [name, area_id, model]]) => ({ id, name, model: model ?? null, manufacturer: null, area_id })),
    entities: ENT.map(([entity_id, device_id]) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform: 'x', entity_category: null, disabled_by: null, hidden_by: null })),
    states: Object.fromEntries(ENT.map(([id, , state, attributes]) => [id, { state: over[id] ?? state, attributes: attributes ?? {}, last_changed: '2026-11-09T12:00:00Z', last_updated: '' }])),
  } as unknown as Registry;
}
const kitchen = (over: Record<string, string> = {}) => readRoom(rooms(over), 'k', 'Кухня', null, null).readings;
// ---- f21 ----
test('room: a leak sensor in `unknown` waits for its first alarm — calm, not «не на связи»; `unavailable` is silent', () => {
  const both = kitchen({ 'binary_sensor.k_leak_boiler_water_leak': 'unknown', 'binary_sensor.k_leak_sink_water_leak': 'unknown' });
  assert.deepEqual(both.leak!.waiting.length, 2); assert.deepEqual(both.leak!.silent, []); assert.equal(both.leak!.unknown, false); assert.equal(silence(both), null, 'the room does not report lost sensors that are not lost');
  const lost = kitchen({ 'binary_sensor.k_leak_boiler_water_leak': 'unavailable', 'binary_sensor.k_leak_sink_water_leak': 'unavailable' });
  assert.equal(lost.leak!.unknown, true); assert.equal(lost.leak!.silent.length, 2); assert.equal(silence(lost), 'part');
  // gas has no such rule: `unknown` is silent
  const gas = kitchen({ 'binary_sensor.k_gas': 'unknown' }); assert.equal(gas.gas!.unknown, true); assert.deepEqual(gas.gas!.waiting, []);
});
// ---- f22 ----
test('room: one silent window of three is counted — the kind is not `unknown`, but the verdict is «part», never plain «all is well»', () => {
  const r = kitchen({ 'binary_sensor.k_window_left_contact': 'unavailable' });
  assert.deepEqual(r.windows!.silent, ['binary_sensor.k_window_left_contact']); assert.equal(r.windows!.unknown, false); assert.deepEqual(r.windows!.on, []); assert.equal(silence(r), 'part');
  const leak = kitchen({ 'binary_sensor.k_leak_sink_water_leak': 'unavailable' }); assert.deepEqual(leak.leak!.silent, ['binary_sensor.k_leak_sink_water_leak']); assert.equal(silence(leak), 'part');
  assert.equal(silence(kitchen()), null); assert.deepEqual(kitchen().windows!.silent, []);
  for (const lang of LANGS) { const t = translator(lang); assert.match(t('room.v.silentN' as never, { n: 1 }), /1/); assert.notEqual(t('room.say.partOnly' as never), 'room.say.partOnly'); assert.notEqual(t('room.returning' as never), 'room.returning'); }
});
// ---- l50, l101, l110 ----
const t = translator('ru');
const P = (reg: Registry) => { const sent: unknown[][] = []; return { sent, reg, lang: 'ru' as const, t, host: { call: async (...a: unknown[]) => { sent.push(a); } } as never, commands: { run: async (_key: string, work: () => Promise<unknown>) => { await work(); return true; } }, deviceOf: () => ({ key: 'dev' }) as never, toggle: () => {}, act: () => {} }; };
test('room: the quick tile of a TV says and does what its card does — standby is «Спит (ожидание)» + «Выключить», never «off» that sends turn_off', async () => {
  const reg = rooms(), tv = readRoom(reg, 'g', 'Гостиная', null, null).things.find(x => x.kind === 'tv')!, p = P(reg), x = detail(tv, p), q = quickState(tv, x, t);
  assert.equal(x.status, 'Спит (ожидание)'); assert.equal(q.word, x.status); assert.equal(q.on, false); assert.equal(q.silent, false);
  assert.equal(q.own?.label, 'Выключить'); assert.equal(q.own, x.action, 'the very action of the card');
  q.own!.run(); await Promise.resolve(); assert.deepEqual(p.sent, [['media_player', 'turn_off', { entity_id: 'media_player.g_tv' }]]);
  const offReg = rooms({ 'media_player.g_tv': 'off', 'sensor.g_tv_active_app': 'Off' }), off = readRoom(offReg, 'g', 'Гостиная', null, null).things.find(k => k.kind === 'tv')!, xo = detail(off, P(offReg)), qo = quickState(off, xo, t);
  assert.equal(qo.word, 'Выключен'); assert.equal(qo.own?.label, 'Включить');
});
test('room: the quick tile of a TV that does not answer says «Нет связи» and cannot be pressed, whatever its meter still reports', () => {
  const reg = rooms({ 'media_player.g_tv': 'unavailable' }), tv = readRoom(reg, 'g', 'Гостиная', null, null).things.find(x => x.kind === 'tv')!;
  assert.equal(tv.available, true, 'the meter still answers: the old tile took that for «Выкл.»');
  const x = detail(tv, P(reg)), q = quickState(tv, x, t);
  assert.equal(x.status, 'Нет связи'); assert.equal(q.word, 'Нет связи'); assert.equal(q.silent, true); assert.equal(q.own, null); assert.equal(q.on, false);
});
test('room: a lamp\'s quick tile keeps the short pair «Вкл.» / «Выкл.» (the card\'s full word does not fit it at a large font)', () => {
  const reg = rooms(), lamp = readRoom(reg, 'g', 'Гостиная', null, null).things.find(x => x.kind === 'light')!, x = detail(lamp, P(reg)), q = quickState(lamp, x, t);
  assert.equal(x.status, 'Выключен'); assert.equal(q.word, 'Выкл.'); assert.equal(q.own, null);
  const onReg = rooms({ 'light.g_lamp': 'on' }), lit = readRoom(onReg, 'g', 'Гостиная', null, null).things.find(k => k.kind === 'light')!; assert.equal(quickState(lit, detail(lit, P(onReg)), t).on, true);
});
