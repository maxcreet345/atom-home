process.env.TZ = 'Europe/Chisinau'; // the sun and the clock are checked by the house's time, whatever zone the machine is in
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sunInfo, timerInfo, nearestTimer, fmtRemaining, toDuration, parseLabels, withLabel, labelText, labelSeconds, weekNumber, personState, initials, aliceTimerCommand, withLabelStation, labelStation, daysText, parseRinging } from '../src/modules/clock-state.ts';
import { normaliseAlarms, normaliseConfig } from '../src/model/config.ts';
import { clockSpec, activeSpecs } from '../src/modules/catalog.ts';
import { defaultConfig } from '../src/model/config.ts';
const camPath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-camera-20261104.json');
const cam = existsSync(camPath) ? JSON.parse(readFileSync(camPath, 'utf8')) : null;
const row = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: '', last_updated: '' });

test('clock: today\'s sunrise and sunset from HA\'s next_* by day and by night', () => {
  const day = sunInfo(row('above_horizon', { next_rising: '2026-11-05T04:52:00+00:00', next_setting: '2026-11-04T14:42:00+00:00', elevation: 23.5 }), Date.parse('2026-11-04T11:40:00+00:00'));
  assert.equal(new Date(day.rise!).toISOString(), '2026-11-04T04:52:00.000Z'); assert.equal(new Date(day.set!).toISOString(), '2026-11-04T14:42:00.000Z');
  assert.ok(day.frac! > 0.68 && day.frac! < 0.70); assert.equal(day.night, false); assert.equal(day.untilNext, Date.parse('2026-11-04T14:42:00+00:00') - Date.parse('2026-11-04T11:40:00+00:00'));
  const dawn = sunInfo(row('below_horizon', { next_rising: '2026-11-05T04:52:00+00:00', next_setting: '2026-11-05T14:41:00+00:00', elevation: -30 }), Date.parse('2026-11-05T02:00:00+00:00'));
  assert.equal(new Date(dawn.rise!).toISOString(), '2026-11-05T04:52:00.000Z'); assert.equal(dawn.frac, null); assert.equal(dawn.night, true);
  const evening = sunInfo(row('below_horizon', { next_rising: '2026-11-05T04:52:00+00:00', next_setting: '2026-11-05T14:41:00+00:00' }), Date.parse('2026-11-04T20:00:00+00:00'));
  assert.equal(new Date(evening.set!).toISOString(), '2026-11-04T14:41:00.000Z', 'after sunset both next_* are tomorrow: today\'s are a day earlier');
  assert.equal(sunInfo(undefined, 0).rise, null);
});

test('clock: timers, nearest, formatting, labels, week, people', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const active = timerInfo('timer.atom_1', row('active', { duration: '0:10:00', finishes_at: '2026-11-04T12:09:41+00:00' }), now);
  assert.equal(active.remainingMs, 581_000); assert.equal(active.durationMs, 600_000); assert.equal(fmtRemaining(active.remainingMs), '9:41');
  const paused = timerInfo('timer.atom_2', row('paused', { duration: '0:30:00', remaining: '0:28:10' }), now); assert.equal(paused.remainingMs, 1_690_000); assert.equal(fmtRemaining(paused.remainingMs), '28:10');
  assert.equal(timerInfo('timer.atom_3', row('idle', { duration: '0:10:00' }), now).remainingMs, 0);
  const near = nearestTimer({ 'timer.atom_1': row('active', { duration: '0:10:00', finishes_at: '2026-11-04T12:09:41+00:00' }), 'timer.atom_2': row('paused', { duration: '0:30:00', remaining: '0:28:10' }), 'timer.atom_3': row('idle', {}) }, ['timer.atom_1', 'timer.atom_2', 'timer.atom_3'], now);
  assert.equal(near!.timer.id, 'timer.atom_1'); assert.equal(near!.running, 2);
  assert.equal(nearestTimer({}, ['timer.x'], now), null);
  assert.equal(fmtRemaining(3_723_000), '1:02:03'); assert.equal(toDuration(630), '00:10:30'); assert.equal(toDuration(3600), '01:00:00');
  assert.deepEqual(parseLabels('{"timer.atom_1":"Чай","bad key":"x","timer.atom_2":5}'), { 'timer.atom_1': 'Чай' }); assert.deepEqual(parseLabels('junk'), {}); assert.deepEqual(parseLabels(undefined), {});
  assert.equal(withLabel({ 'timer.atom_1': 'Чай' }, 'timer.atom_2', ' Стирка ', 1800), '{"timer.atom_1":"Чай","timer.atom_2":"Стирка|1800"}'); assert.equal(withLabel({ 'timer.atom_1': 'Чай' }, 'timer.atom_1', ''), '{}'); assert.equal(withLabel({}, 'timer.atom_1', '', 60), '{"timer.atom_1":"|60"}');
  assert.equal(labelText('Чай|600'), 'Чай'); assert.equal(labelText('|60'), ''); assert.equal(labelSeconds('Чай|600'), 600); assert.equal(labelSeconds('Чай'), null);
  assert.ok(withLabel({}, 'timer.atom_1', 'x'.repeat(300)).length <= 255);
  assert.equal(weekNumber(new Date(2026, 10, 4)), 45); assert.equal(weekNumber(new Date(2026, 0, 1)), 1);
  assert.deepEqual(personState(row('home')), { home: true, zone: null }); assert.deepEqual(personState(row('Atom Service')), { home: false, zone: 'Atom Service' }); assert.deepEqual(personState(row('not_home')), { home: false, zone: null });
  assert.equal(initials('Gayane Grigorean'), 'GG'); assert.equal(initials('Арарат'), 'А');
});

test('clock: module detected on the Criuleni snapshot, claims its helpers', { skip: !cam }, () => {
  assert.equal(clockSpec.detect(cam!), null, 'the camera snapshot has no sun.sun: no clock module, the plain tile stays');
  const withSun = { ...cam!, states: { ...cam!.states, 'sun.sun': row('above_horizon', { next_rising: '2026-11-05T04:52:00+00:00', next_setting: '2026-11-04T14:42:00+00:00' }), 'timer.atom_1': row('idle', { duration: '0:10:00' }), 'input_boolean.timer_done': row('off') } };
  const m2 = clockSpec.detect(withSun)!; assert.ok(m2); assert.equal(m2.entities.sun, 'sun.sun'); assert.equal(m2.entities.timer1, 'timer.atom_1'); assert.equal(m2.entities.done, 'input_boolean.timer_done'); assert.equal(m2.entities.timer2, undefined);
  assert.ok(activeSpecs(withSun, defaultConfig()).some(a => a.spec.id === 'clock'));
});

test('alarms: normalised like the integration does; Alice timer phrases; label with station', () => {
  const list = normaliseAlarms([
    { id: 'a1', room: 'detskaia', time: '07:30', days: [1, 2, 3, 4, 5, 5, 9], enabled: true, label: 'Дети', alice: 'off', light: true, lightEntity: 'light.kids_chandelier', fadeMin: 15, push: true, repeats: 5, repeatEveryMin: 5 },
    { id: 'a2', room: 'gostinaia', time: '6:30', days: [] },
    { id: 'a3', room: 'spalnia', time: '08:00', days: [6, 7], alice: 'tts', station: 'media_player.living_yandex_max', light: true, lightEntity: '', fadeMin: 7, repeats: 99, repeatEveryMin: 4 },
    { id: 'a1', room: 'dup', time: '09:00' }, 'junk', { id: 'bad id!', time: '09:00' },
  ]);
  assert.equal(list.length, 2, 'bad time, duplicate id and junk are dropped');
  assert.deepEqual(list[0].days, [1, 2, 3, 4, 5]); assert.equal(list[0].repeats, 5); assert.equal(list[0].light, true);
  assert.equal(list[1].light, false, 'light without an entity is off'); assert.equal(list[1].fadeMin, 15); assert.equal(list[1].repeats, 0); assert.equal(list[1].repeatEveryMin, 5); assert.equal(list[1].station, 'media_player.living_yandex_max');
  const cfg = normaliseConfig({ schemaVersion: 1, alarms: [{ id: 'z', room: 'r', time: '05:05', days: [1] }] }).config; assert.equal(cfg.alarms.length, 1, 'alarms survive the config round trip');
  assert.equal(aliceTimerCommand(240), 'поставь таймер на 4 минуты'); assert.equal(aliceTimerCommand(60), 'поставь таймер на 1 минуту'); assert.equal(aliceTimerCommand(630), 'поставь таймер на 10 минут 30 секунд'); assert.equal(aliceTimerCommand(21 * 60), 'поставь таймер на 21 минуту'); assert.equal(aliceTimerCommand(45), 'поставь таймер на 45 секунд');
  const v = withLabelStation({}, 'timer.atom_1', 'Чай', 240, 'media_player.living_yandex_max'); assert.equal(v, '{"timer.atom_1":"Чай|240|living_yandex_max"}');
  assert.equal(labelStation('Чай|240|living_yandex_max'), 'media_player.living_yandex_max'); assert.equal(labelStation('Чай|240'), null); assert.equal(labelText('Чай|240|living_yandex_max'), 'Чай');
  const tx = (k: string) => ({ 'alarm.once': 'один раз', 'alarm.daily': 'ежедневно', 'alarm.workdays': 'будни', 'alarm.weekend': 'выходные' } as Record<string, string>)[k] ?? k;
  const names = 'пн,вт,ср,чт,пт,сб,вс'.split(',');
  assert.equal(daysText([1, 2, 3, 4, 5], names, tx), 'будни'); assert.equal(daysText([6, 7], names, tx), 'выходные'); assert.equal(daysText([], names, tx), 'один раз'); assert.equal(daysText([1, 3], names, tx), 'пн, ср'); assert.equal(daysText([1, 2, 3, 4, 5, 6, 7], names, tx), 'ежедневно');
  assert.deepEqual(parseRinging('a1|Детская|07:30|Дети|3'), { id: 'a1', room: 'Детская', time: '07:30', label: 'Дети', left: 3 }); assert.equal(parseRinging(''), null); assert.equal(parseRinging('unknown'), null);
});
