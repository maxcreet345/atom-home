import test from 'node:test';
import assert from 'node:assert/strict';
import { clockShift, dayKey, eatenOn, eventsOf, hoursOf, shiftTime, weekOf, type FeederLog } from '../src/modules/feeder-log.ts';
import { editFeederSchedule, parseFeederSchedule } from '../src/modules/feeder-protocol.ts';

const at = (d: Date) => Math.floor(d.getTime() / 1000);
const now = new Date(2026, 10, 5, 9, 50), today = dayKey(now), yesterday = dayKey(new Date(2026, 10, 4, 12));
const log: FeederLog = { tz: 10800, desiccant: { level: 93, days: 28 }, events: [
  { at: at(new Date(2026, 10, 5, 7, 5)), kind: 'ate', grams: 4 }, { at: at(new Date(2026, 10, 5, 7, 3)), kind: 'ate', grams: 4 }, { at: at(new Date(2026, 10, 5, 7, 0)), kind: 'plan', grams: 10 }, { at: at(new Date(2026, 10, 4, 21, 32)), kind: 'ate', grams: 9 },
] };
test('eaten today adds meals only, not what was dispensed', () => { assert.equal(eatenOn(log, today), 8); assert.equal(eatenOn(log, yesterday), 9); assert.equal(eatenOn(null, today), 0); });
test('a day reads in order', () => assert.deepEqual(eventsOf(log, today).map(e => e.kind), ['plan', 'ate', 'ate']));
test('week ends today and holds 7 days', () => { const w = weekOf(log, now); assert.equal(w.length, 7); assert.equal(w[6].key, today); assert.equal(w[6].grams, 8); assert.equal(w[5].grams, 9); });
test('hours add up', () => { const h = hoursOf(log, today); assert.equal(h[7], 8); assert.equal(h.reduce((a, b) => a + b, 0), 8); });
test('shift wraps around midnight', () => { assert.equal(shiftTime('08:00', -60), '07:00'); assert.equal(shiftTime('00:30', -60), '23:30'); assert.equal(shiftTime('23:30', 60), '00:30'); });
test('clock shift is the device zone against this one', () => { const local = -now.getTimezoneOffset(); assert.equal(clockShift(log, now), 180 - local); assert.equal(clockShift({ ...log, tz: null }, now), 0); assert.equal(clockShift(null, now), 0); });
test('a plan edited in real time is saved in the feeder\'s own time, with its row suffix kept', () => {
  const raw = '[1,08000101,11000101]', meals = parseFeederSchedule(raw)!.meals, shown = meals.map(m => ({ ...m, time: shiftTime(m.time, -60) }));
  assert.equal(shown[0].time, '07:00');
  shown[0].time = '07:30';
  assert.equal(editFeederSchedule(raw, shown.map(m => ({ ...m, time: shiftTime(m.time, 60) }))), '[1,08300101,11000101]');
});
test('meals go to the feeder in its own clock and in its order', async () => { const { mealsForFeeder } = await import('../src/modules/feeder-log.ts'); assert.deepEqual(mealsForFeeder([{ time: '23:30', portions: 1 }, { time: '07:00', portions: 2 }], 60), [{ time: '00:30', portions: 1 }, { time: '08:00', portions: 2 }]); });
