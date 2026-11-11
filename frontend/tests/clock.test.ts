import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestTimer, parseLabels, labelStation, labelText, withLabelStation, personState, fmtDuration, hoursMinutes, nextFire, isTomorrow, finishedTimer } from '../src/modules/clock-state.ts';
import type { StateRow } from '../src/model/registry.ts';

// Audit 2026-11-09, the clock card. Each test names the finding it stands for and fails on the code before the fix.
const row = (state: string, attributes: Record<string, unknown> = {}, changed = '2026-11-10T10:00:00+00:00'): StateRow => ({ state, attributes, last_changed: changed, last_updated: changed });
const now = Date.parse('2026-11-10T10:00:00+00:00');

test('timer-label-cut-wrong-station: a 20-character label keeps the station it was mirrored to', () => {
  const raw = withLabelStation({}, 'timer.atom_1', 'Очень длинная подпись!', 5400, 'media_player.living_room_yandex_station_max');
  const back = parseLabels(raw)['timer.atom_1'];
  assert.equal(labelText(back), 'Очень длинная подпис'); // the label itself is 20 characters
  assert.equal(labelStation(back), 'media_player.living_room_yandex_station_max'); // was «media_player.livi» after a cut at 32
  assert.ok(raw.length <= 255);
});

test('clock-tile-paused-hides-running: the tile shows the timer that runs; a paused one only when nothing runs', () => {
  const states = { 'timer.a': row('paused', { duration: '0:30:00', remaining: '0:00:05' }), 'timer.b': row('active', { duration: '0:10:00', finishes_at: '2026-11-10T10:09:00+00:00' }), 'timer.c': row('active', { duration: '0:10:00', finishes_at: '2026-11-10T10:03:00+00:00' }) };
  const near = nearestTimer(states, ['timer.a', 'timer.b', 'timer.c'], now)!;
  assert.equal(near.timer.id, 'timer.c'); assert.equal(near.running, 3);
  assert.equal(nearestTimer({ 'timer.a': states['timer.a'] }, ['timer.a'], now)!.timer.id, 'timer.a');
});

test('timer-short-durations-rounded and clock-sixty-minutes: lengths are said as they are', () => {
  assert.equal(fmtDuration(15_000, 'мин', 'с'), '15 с'); assert.equal(fmtDuration(90_000, 'мин', 'с'), '1 мин 30 с'); assert.equal(fmtDuration(240_000, 'мин', 'с'), '4 мин'); assert.equal(fmtDuration(0, 'мин', 'с'), '0 с');
  assert.deepEqual(hoursMinutes(4 * 3_600_000 - 20_000), { h: 4, m: 0 }); // was «3 ч 60 мин»
  assert.deepEqual(hoursMinutes(9 * 3_600_000 + 29 * 60_000 + 31_000), { h: 9, m: 30 }); assert.deepEqual(hoursMinutes(-5), { h: 0, m: 0 });
});

test('clock-people-unknown-as-away: no data about a person is not «не дома»', () => {
  assert.equal(personState(row('unknown')).unknown, true); assert.equal(personState(row('unavailable')).unknown, true); assert.equal(personState(undefined).unknown, true);
  assert.equal(personState(row('not_home')).unknown, undefined); assert.equal(personState(row('home')).home, true);
});

test('alarms-card-not-nearest: the next ring is today if the time is ahead and the day fits, else the next fitting day', () => {
  const tue = new Date(2026, 10, 10, 12, 0, 0); // a Tuesday (ISO 2), noon
  const at = (a: { time: string; days: number[]; enabled?: boolean }) => { const v = nextFire({ enabled: true, ...a }, tue); return v === null ? null : new Date(v); };
  assert.deepEqual(at({ time: '13:00', days: [] }), new Date(2026, 10, 10, 13, 0)); // «один раз», still ahead today
  assert.deepEqual(at({ time: '07:00', days: [] }), new Date(2026, 10, 11, 7, 0)); // «один раз», already past: tomorrow
  assert.deepEqual(at({ time: '07:00', days: [1, 2, 3, 4, 5] }), new Date(2026, 10, 11, 7, 0));
  assert.deepEqual(at({ time: '07:00', days: [2] }), new Date(2026, 10, 17, 7, 0)); // only Tuesdays, today's is gone: in a week
  assert.deepEqual(at({ time: '23:30', days: [6, 7] }), new Date(2026, 10, 14, 23, 30));
  assert.equal(at({ time: '13:00', days: [], enabled: false }), null);
  // the card's order: 13:00 today rings before 07:00 tomorrow, though 07:00 is «earlier by the clock»
  const list = [{ time: '07:00', days: [1, 2, 3, 4, 5], enabled: true }, { time: '13:00', days: [], enabled: true }].sort((x, y) => nextFire(x, tue)! - nextFire(y, tue)!);
  assert.equal(list[0].time, '13:00');
});

test('clock-tomorrow-dst: «завтра» is the next calendar day, also on the night the clocks change', () => {
  const eve = new Date(2026, 9, 24, 23, 30); // the night before the clocks go back: that day lasts 25 hours
  assert.equal(isTomorrow(new Date(2026, 9, 25, 23, 45).getTime(), eve), true); // «now + 24 h» is still the 25th at 22:30 only where the zone has DST; the calendar rule holds anywhere
  assert.equal(isTomorrow(new Date(2026, 9, 26, 0, 15).getTime(), eve), false);
  assert.equal(isTomorrow(new Date(2026, 9, 24, 23, 50).getTime(), eve), false);
  assert.equal(isTomorrow(new Date(2026, 11, 1, 7, 0).getTime(), new Date(2026, 10, 30, 22, 0)), true);
});

test('timer-banner-wrong-label: the banner is signed by the timer that has just ended', () => {
  const done = '2026-11-10T10:00:05+00:00';
  const states = { 'timer.a': row('idle', {}, '2026-11-10T09:00:00+00:00'), 'timer.b': row('active', {}, '2026-11-10T09:55:00+00:00'), 'timer.c': row('idle', {}, '2026-11-10T10:00:04+00:00') };
  assert.equal(finishedTimer(states, ['timer.a', 'timer.b', 'timer.c'], done), 'timer.c'); // was: the first slot with any label («timer.a»)
  assert.equal(finishedTimer({ 'timer.a': states['timer.a'], 'timer.b': states['timer.b'] }, ['timer.a', 'timer.b'], done), null); // nothing ended near the flag: no name rather than a wrong one
  assert.equal(finishedTimer(states, ['timer.a', 'timer.c'], undefined), 'timer.c');
});
