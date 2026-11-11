// Round 2 of the audit (10.11.2026), device tiles / lists / sheets: the logic that has no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, stepTarget, targetDraft } from '../src/runtime/actions.ts';
import { afterBusy } from '../src/model/lights.ts';
import { held, shownName, num, numFixed, stateText } from '../src/ui/format.ts';
import { readableModel } from '../src/model/vacuum.ts';
import { translator } from '../src/i18n/index.ts';
import { dateFormat, numberFormat } from '../src/runtime/zone.ts';

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0, seq = 0; const timers = new Map<number, { at: number; f: () => void }>();
  return {
    set: (f: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; },
    clear: (id: unknown) => { timers.delete(id as number); },
    now: () => now,
    tick(ms: number) { const end = now + ms; for (;;) { const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].f(); } now = end; },
  };
}
const flush = () => new Promise<void>(r => setImmediate(r));

test('f75 / l32 / l55 — three quick «+» of a plain thermostat add up: the draft is shown at once and ONE command with the last value goes out', async () => {
  const clock = fakeClock(), shown: Array<number | null> = [], sent: number[] = [];
  const draft = targetDraft(v => shown.push(v), 700, 20000, clock), range = { min: 5, max: 35, step: 0.5 }, send = (v: number) => { sent.push(v); return Promise.resolve(true); };
  let at = 21; // what the house holds: it does not change while the person taps
  for (let i = 0; i < 3; i++) { const next = stepTarget(range, shown.at(-1) ?? at, 1); draft.push(next, send, at); clock.tick(300); }
  assert.deepEqual(shown, [21.5, 22, 22.5], 'every tap moves the number on the screen');
  assert.deepEqual(sent, [], 'nothing is sent while the taps keep coming');
  clock.tick(700); await flush();
  assert.deepEqual(sent, [22.5], 'one command, the last value');
  // the house shows the new target: the draft is dropped
  at = 22.5; draft.seen(at);
  assert.equal(shown.at(-1), null);
});

test('f75 — the draft is dropped when the command is refused, and when the device answers with another value after accepting it', async () => {
  const clock = fakeClock(), shown: Array<number | null> = [];
  const draft = targetDraft(v => shown.push(v), 700, 20000, clock);
  draft.push(22, () => Promise.resolve(false), 21); clock.tick(700); await flush(); // the runner answered «not accepted» (refused, offline)
  assert.deepEqual(shown, [22, null], 'a refused target does not stay on the screen');
  draft.push(22, () => Promise.resolve(true), 21); clock.tick(700); await flush();
  draft.seen(21.5); // accepted, but the head rounded it its own way
  assert.equal(shown.at(-1), null, 'the house\'s own value is shown again');
  // a state that arrives while a newer tap is still waiting does not wipe that tap
  draft.push(22, () => Promise.resolve(true), 21.5); clock.tick(700); await flush();
  draft.push(22.5, () => Promise.resolve(true), 21.5); draft.seen(22);
  assert.equal(shown.at(-1), 22.5, 'the newer tap stays on the screen');
});

test('f75 — leaving the screen within the pause still sends the last tap; stepping back to the house\'s value sends nothing', async () => {
  const clock = fakeClock(), sent: number[] = [], draft = targetDraft(() => undefined, 700, 20000, clock), send = (v: number) => { sent.push(v); return Promise.resolve(true); };
  draft.push(21.5, send, 21); draft.push(21, send, 21); clock.tick(2000); await flush();
  assert.deepEqual(sent, [], '+ then − is where the house already is');
  draft.push(21.5, send, 21); draft.flush(); await flush();
  assert.deepEqual(sent, [21.5]);
});

test('l6 / l151 — a radiator at its minimum has no step down (the tile switches «−» off exactly when stepTarget returns the same value)', () => {
  const range = { min: 4, max: 35, step: 0.5 };
  assert.equal(stepTarget(range, 4, -1), 4); assert.equal(stepTarget(range, 4, 1), 4.5); assert.equal(stepTarget(range, 35, 1), 35);
});

test('l21 — a command pressed while the lamp is busy waits for its turn; the last one pressed wins; it does not wait for ever', () => {
  const clock = fakeClock(); let busy = true; const sent: string[] = [];
  const turn = afterBusy(() => busy, 100, 5000, clock);
  turn(() => sent.push('off')); clock.tick(450);
  assert.deepEqual(sent, [], 'not dropped and not sent while the brightness is on its way');
  busy = false; clock.tick(100);
  assert.deepEqual(sent, ['off'], 'sent as soon as the lamp is free');
  busy = true; turn(() => sent.push('effect')); clock.tick(200); turn(() => sent.push('colour')); busy = false; clock.tick(100);
  assert.deepEqual(sent, ['off', 'colour'], 'a newer press replaces the one that was waiting');
  busy = true; turn(() => sent.push('late')); clock.tick(5100);
  assert.deepEqual(sent, ['off', 'colour', 'late'], 'after the limit it goes anyway: the runner decides');
  busy = false; turn(() => sent.push('now'));
  assert.equal(sent.at(-1), 'now', 'a free lamp gets the command at once');
});

test('l97 — an open valve is not offered «Открыть» (and its «Вода пойдёт сразу»), a closed one no «Закрыть»; a valve on its way keeps both', () => {
  const valve = (state: string) => actionsFor({ kind: 'valve', primary: { id: 'valve.v', state, attributes: {} } } as never).map(a => a.id);
  assert.deepEqual(valve('open'), ['close']); assert.deepEqual(valve('closed'), ['open']);
  assert.deepEqual(valve('opening'), ['open', 'close']); assert.deepEqual(valve('unknown'), ['open', 'close']);
  assert.ok(actionsFor({ kind: 'valve', primary: { id: 'valve.v', state: 'closed', attributes: {} } } as never).every(a => a.confirm && a.risk === 'water'), 'opening still asks');
});

test('f0 / f69 / l162 — a pending control is marked aria-disabled + aria-busy (never `disabled`); offline is aria-disabled only', () => {
  assert.deepEqual(held(true), { 'aria-disabled': 'true', 'aria-busy': 'true' });
  assert.deepEqual(held(true, true), { 'aria-disabled': 'true', 'aria-busy': 'true' });
  assert.deepEqual(held(false, true), { 'aria-disabled': 'true' });
  assert.deepEqual(held(false), {}); assert.deepEqual(held(undefined, false), {});
  assert.ok(!('disabled' in held(true)));
});

test('l192 — a device nobody named is shown by its kind, never by its entity id', () => {
  const t = translator('ru');
  assert.equal(shownName('fan.office_fan', 'fan', t), t('kind.fan'));
  assert.equal(shownName('Вентилятор офиса', 'fan', t), 'Вентилятор офиса');
  assert.equal(shownName('Свет · Кухня', 'light', t), 'Свет · Кухня');
  assert.equal(shownName('sensor.x_1', 'measurement', translator('ro')), translator('ro')('kind.measurement'));
});

test('l193 — the «Модель» row prints a model a person can read; an integration\'s technical id gives no row', () => {
  assert.equal(readableModel('yeelink.light.ceila'), null);
  assert.equal(readableModel('ZBMINIL2'), 'ZBMINIL2');
});

test('ENERGY hand-over — numFixed prints «—» for what is not a number; num and numFixed still round first and group as before', () => {
  assert.equal(numFixed(NaN, 'ru', 1), '—'); assert.equal(numFixed(Infinity, 'en', 2), '—');
  assert.equal(numFixed(4, 'ru', 1), '4,0'); assert.equal(numFixed(-0.04, 'ru', 1), '0,0'); assert.equal(numFixed(1234.5, 'en', 2), '1,234.50');
  assert.equal(num(null, 'ru'), '—'); assert.equal(num(21.46, 'ru'), '21,5'); assert.equal(num(-0.3, 'en', 0), '0'); assert.equal(num(21, 'ru'), '21');
});

test('ENERGY hand-over — the formatters are the cached ones: the same Intl object for the same request', () => {
  assert.equal(numberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 0 }), numberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 1 }));
  const real = Intl.NumberFormat, realDate = Intl.DateTimeFormat; let made = 0;
  num(1.23, 'ru', 1); numFixed(1.23, 'ru', 1); // warm the cache
  const stamp = { id: 'sensor.last', domain: 'sensor', deviceClass: 'timestamp', state: '2026-10-09T18:11:00Z', available: true, attributes: {}, unit: null, name: 'x' } as never, t = translator('ru');
  const first = stateText(stamp, t, 'ru');
  (Intl as { NumberFormat: unknown }).NumberFormat = function () { made++; return new real(); } as never;
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function () { made++; return new realDate(); } as never;
  try { for (let i = 0; i < 50; i++) { num(i + 0.5, 'ru', 1); numFixed(i, 'ru', 1); assert.equal(stateText(stamp, t, 'ru'), first); } }
  finally { Intl.NumberFormat = real; Intl.DateTimeFormat = realDate; }
  assert.equal(made, 0, 'no Intl object is built on a repeated call');
  assert.match(first, /9 окт/); assert.ok(dateFormat('ru-RU', { day: 'numeric' }) === dateFormat('ru-RU', { day: 'numeric' }));
});

test('l122 / l172 — in Romanian the cameras card is «Camere video»: «Camere» alone is the robot\'s rooms', () => {
  const ro = translator('ro');
  assert.equal(ro('cams.title'), 'Camere video'); assert.equal(ro('section.camera'), 'Camere video');
  assert.notEqual(ro('cams.title'), ro('module.vac.rooms' as never));
});
