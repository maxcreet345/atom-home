import test from 'node:test';
import assert from 'node:assert/strict';
import { clockShift, journalAge, missedMeals, parseZone, shiftTime } from '../src/modules/feeder-log.ts';
import { onOff, planState, stateKnown } from '../src/modules/feeder-protocol.ts';

// audit 2026-11-09, code-review/feeder-zone-storage-nan: «undefined» kept in localStorage gave «NaN:NaN» in every time of the plan
test('a stored zone is a number of seconds or nothing', () => {
  assert.equal(parseZone('10800'), 10800); assert.equal(parseZone('0'), 0); assert.equal(parseZone(7200), 7200); assert.equal(parseZone('-3600'), -3600);
  for (const junk of ['undefined', 'null', 'NaN', '', '  ', 'abc', null, undefined, NaN, Infinity, {}, true]) assert.equal(parseZone(junk), null, String(junk));
});
test('a zone that is not a number moves no clock', () => {
  const now = new Date(2026, 10, 5, 9, 50);
  assert.equal(clockShift({ tz: undefined as unknown as number, events: [], desiccant: null }, now), 0);
  assert.equal(clockShift({ tz: NaN, events: [], desiccant: null }, now), 0);
  assert.equal(shiftTime('08:00', NaN), '08:00'); assert.equal(shiftTime('08:00', -60), '07:00');
});
// code-review/feeder-stale-journal-as-today
test('a journal is fresh for ten minutes, and knows nothing of today when it was read yesterday', () => {
  const read = new Date(2026, 10, 5, 9, 50).getTime();
  assert.deepEqual(journalAge(read, read + 9 * 60000), { stale: false, sameDay: true });
  assert.deepEqual(journalAge(read, read + 11 * 60000), { stale: true, sameDay: true });
  assert.deepEqual(journalAge(read, new Date(2026, 10, 5, 19, 50).getTime()), { stale: true, sameDay: true });
  assert.deepEqual(journalAge(read, new Date(2026, 10, 6, 0, 5).getTime()), { stale: true, sameDay: false });
});
// code-review/feeder-late-dispense-missed-and-done: 07:00 planned, dispensed at 07:16 → was both «Не выдано» and «По плану»
test('a late planned dispense closes its meal; a meal is missed only with no dispense before the next one', () => {
  const plan = [7 * 60, 10 * 60, 14 * 60, 18 * 60];
  assert.deepEqual(missedMeals(plan, [7 * 60 + 16], 9 * 60 + 50), [], 'late by 16 minutes is not missed');
  assert.deepEqual(missedMeals(plan, [7 * 60], 9 * 60 + 50), [], 'on time');
  assert.deepEqual(missedMeals(plan, [6 * 60 + 59], 9 * 60 + 50), [], 'the feeder\'s clock a minute ahead');
  assert.deepEqual(missedMeals(plan, [], 9 * 60 + 50), [7 * 60], 'nothing dispensed');
  assert.deepEqual(missedMeals(plan, [], 7 * 60 + 15), [], 'a quarter of an hour of grace');
  assert.deepEqual(missedMeals(plan, [], 7 * 60 + 16), [7 * 60]);
  assert.deepEqual(missedMeals(plan, [10 * 60 + 1], 12 * 60), [7 * 60], 'a dispense after the next meal belongs to that meal');
  assert.deepEqual(missedMeals(plan, [7 * 60 + 1, 9 * 60 + 40], 12 * 60), [10 * 60], 'a second dispense in one slot closes nothing else');
  assert.deepEqual(missedMeals([18 * 60, 7 * 60], [18 * 60 + 40], 19 * 60), [7 * 60], 'order of the plan does not matter');
});
// code-review/feeder-unknown-plan-shown-empty
test('a plan the panel cannot read is «unparsed», never an empty plan', () => {
  assert.equal(planState('[1,08000101,11000101]'), 'ok'); assert.equal(planState('[0]'), 'ok'); assert.equal(planState('[1]'), 'ok');
  assert.equal(planState('[1,08000101,11000100,15000101]'), 'unparsed', 'a row with another suffix');
  assert.equal(planState('[1,08000101,08000101]'), 'unparsed', 'two rows at one time');
  assert.equal(planState('[0,08000101]'), 'unparsed'); assert.equal(planState('[1,08610101]'), 'unparsed'); assert.equal(planState('whatever'), 'unparsed');
  assert.equal(planState(undefined), 'missing'); assert.equal(planState(null), 'missing'); assert.equal(planState(''), 'missing'); assert.equal(planState(5), 'missing');
});
// code-review/feeder-unavailable-as-normal
test('unavailable and unknown are neither on nor off nor normal', () => {
  assert.equal(onOff('on'), true); assert.equal(onOff('off'), false); assert.equal(onOff('unavailable'), null); assert.equal(onOff('unknown'), null); assert.equal(onOff(undefined), null);
  assert.equal(stateKnown('normal'), true); assert.equal(stateKnown('low'), true); assert.equal(stateKnown('unavailable'), false); assert.equal(stateKnown('unknown'), false); assert.equal(stateKnown(undefined), false);
});
