import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sunInfo, timerInfo, nearestTimer, fmtRemaining, toDuration, parseLabels, withLabel, labelText, labelSeconds, weekNumber, personState, initials } from '../src/modules/clock-state.ts';
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
