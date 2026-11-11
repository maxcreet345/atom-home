import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finishedTimer, stopAlarm, snoozeAlarm, type BannerHost } from '../src/modules/clock-state.ts';
import { tileLine } from '../src/modules/feeder-log.ts';
import { CommandError } from '../src/runtime/commands.ts';
import { translator } from '../src/i18n/index.ts';
import type { StateRow } from '../src/model/registry.ts';

// Audit 2026-11-09, round 2 — the module cards «Время», feeder, kettle, air. Each test names the item it stands for and fails on the code before the fix.
const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const row = (state: string, changed: string): StateRow => ({ state, attributes: {}, last_changed: changed, last_updated: changed });
const host = (over: Partial<BannerHost> & { sent?: string[] } = {}) => { const sent: string[] = over.sent ?? []; return { sent, online: true, ws: async (m: Record<string, unknown>) => { sent.push(String(m.type)); }, call: async (d: string, s: string) => { sent.push(`${d}.${s}`); }, ...over } as BannerHost & { sent: string[] }; };

test('l39 timer banner after a restart: timers that all went idle at the same moment name no timer', () => {
  const done = '2026-11-10T10:00:01.000+00:00';
  // Home Assistant restarted with the «done» flag up: every timer is «idle since the restart», a few milliseconds apart
  const restart = { 'timer.a': row('idle', '2026-11-10T10:00:00.412+00:00'), 'timer.b': row('idle', '2026-11-10T10:00:00.415+00:00'), 'timer.c': row('idle', '2026-11-10T10:00:00.431+00:00') };
  assert.equal(finishedTimer(restart, ['timer.a', 'timer.b', 'timer.c'], done), null); // was «timer.a» or whichever came last by a millisecond: «Таймер готов · Стирка · 45 мин»
  // a real finish still names its timer, also next to one that ended ten seconds earlier
  const real = { 'timer.a': row('idle', '2026-11-10T09:59:50+00:00'), 'timer.b': row('active', '2026-11-10T09:55:00+00:00'), 'timer.c': row('idle', '2026-11-10T10:00:00.5+00:00') };
  assert.equal(finishedTimer(real, ['timer.a', 'timer.b', 'timer.c'], done), 'timer.c');
});

test('banner «Стоп»: nothing leaves on the raw socket while the house is away, and the refusal is rejected, not swallowed', async () => {
  const away = host({ online: false });
  await assert.rejects(stopAlarm(away, 'input_boolean.alarm_ringing'), (e: unknown) => e instanceof CommandError);
  assert.deepEqual(away.sent, []); // was: atom_home/alarm/stop sent on the socket, the failure swallowed, then input_boolean.turn_off
  // the connection dropped under the command: the house's error comes out, and no second command is thrown after it
  const sent: string[] = [], lost = host({ sent, ws: async () => { sent.push('ws'); throw { code: 3, message: 'Connection lost' }; } });
  await assert.rejects(stopAlarm(lost, 'input_boolean.alarm_ringing'), (e: unknown) => (e as { code?: unknown }).code === 3);
  assert.deepEqual(sent, ['ws']);
  // an integration that does not know the command: the flag is lowered instead — and when that is refused too, the real reason is rejected
  const old = host({ ws: async () => { throw { code: 'unknown_command', message: 'Unknown command.' }; } });
  await stopAlarm(old, 'input_boolean.alarm_ringing'); assert.deepEqual(old.sent, ['input_boolean.turn_off']);
  const refused = host({ ws: async () => { throw { code: 'unknown_command', message: 'Unknown command.' }; }, call: async () => { throw { code: 'unauthorized', message: 'Unauthorized' }; } });
  await assert.rejects(stopAlarm(refused, 'input_boolean.alarm_ringing'), (e: unknown) => (e as { code?: unknown }).code === 'unauthorized');
  // the usual way: one command, on the socket
  const ok = host(); await stopAlarm(ok, 'input_boolean.alarm_ringing'); assert.deepEqual(ok.sent, ['atom_home/alarm/stop']);
});

test('banner «Ещё 9 минут»: rejects with the house\'s own error, sends nothing offline', async () => {
  const away = host({ online: false }); await assert.rejects(snoozeAlarm(away), (e: unknown) => e instanceof CommandError); assert.deepEqual(away.sent, []);
  await assert.rejects(snoozeAlarm(host({ ws: async () => { throw { code: 'home_assistant_error', message: 'No alarm is ringing' }; } })), (e: unknown) => (e as { message?: unknown }).message === 'No alarm is ringing');
  const ok = host(); await snoozeAlarm(ok, 9); assert.deepEqual(ok.sent, ['atom_home/alarm/snooze']);
  // and the module hands exactly these to the shell (no try/catch of its own around them)
  const code = src('modules/clock.tsx'), banner = code.slice(code.indexOf('banner: (registry'));
  assert.match(banner, /stop: \(\) => stopAlarm\(host, /); assert.match(banner, /run: \(\) => snoozeAlarm\(host, 9\)/); assert.doesNotMatch(banner, /catch/);
});

test('l46 feeder plurals: «1 day left», «Încă 1 zi», «Încă 21 de zile»', () => {
  const en = translator('en'), ro = translator('ro'), ru = translator('ru'), left = (t: typeof en, d: number) => t('module.feeder.desicLeft', { d, n: d }), use = (t: typeof en, d: number) => t('module.feeder.desicUse', { d, n: d });
  assert.equal(left(en, 1), '1 day left'); assert.equal(left(en, 12), '12 days left'); assert.equal(left(en, 0), '0 days left'); // was «1 days left»
  assert.equal(use(en, 1), 'Good for another 1 day'); assert.equal(use(en, 30), 'Good for another 30 days');
  assert.equal(left(ro, 1), 'Încă 1 zi'); assert.equal(left(ro, 5), 'Încă 5 zile'); assert.equal(left(ro, 21), 'Încă 21 de zile'); // was «Încă 1 zile», «Încă 21 zile»
  assert.equal(use(ro, 1), 'Bun încă 1 zi'); assert.equal(use(ro, 19), 'Bun încă 19 zile'); assert.equal(use(ro, 30), 'Bun încă 30 de zile');
  assert.equal(left(ru, 12), 'Ещё 12 дн.');
  // the card gives the number the plural goes by
  const card = src('modules/pet-feeder.tsx'); assert.match(card, /'desicLeft', \{ d: log\.desiccant\.days, n: log\.desiccant\.days \}/); assert.match(card, /'desicUse', \{ d: left, n: left \}/);
});

test('l42 feeder tile: the bowl\'s weight is signed «в миске», not by the date of a journal read yesterday', () => {
  assert.equal(tileLine(false, true, true), 'bowl'); // was the journal's date: «0 г · данные 09.11»
  assert.equal(tileLine(false, false, true), 'asOf'); // what was eaten, by a journal read an hour ago: «данные 14:05»
  assert.equal(tileLine(false, true, false), 'bowl'); assert.equal(tileLine(false, false, false), 'plan'); assert.equal(tileLine(true, true, true), 'alert');
});

test('f71 the clock\'s windows read the focus from their own root (Home Assistant mounts the panel in a shadow root)', () => {
  const code = src('modules/clock.tsx'); assert.doesNotMatch(code.replace(/`document\.activeElement`/g, ''), /document\.activeElement/); assert.match(code, /getRootNode\(\) as Document \| ShadowRoot/);
});

test('f73 the first touch builds no AudioContext: `armBeep` prepares nothing, `beep` makes the context when a sound is due', () => {
  const code = src('modules/clock.tsx'), arm = code.slice(code.indexOf('export function armBeep'), code.indexOf('export function beep')), beep = code.slice(code.indexOf('export function beep'), code.indexOf('export const clock'));
  assert.doesNotMatch(arm, /AudioContext\)\(|new \(/); assert.match(beep, /audio \?\?= new \(window\.AudioContext/);
});

test('l152 / l191 air: an unknown refusal is said with the house\'s reason and nothing is written to the console', () => {
  const code = src('modules/air.tsx'); assert.doesNotMatch(code, /console\.(warn|error|log)/); assert.match(code, /errorText\(refused\.cause, t\)/);
});
