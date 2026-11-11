// Checks added by the audit of 09–10.11.2026 (slice F: cameras and doorbell, vacuum, light, generic tiles). Each one fails on the code as it was at 1.25.7.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.TZ = 'Europe/Chisinau';
import { historyEvents, ringOpens, houseNow, RING_OPEN_MS } from '../src/model/cameras.ts';
import { parseHistory, dayFolders, doorbellTileState, lastMotionAt, ago } from '../src/modules/doorbell-state.ts';
import { readVacuum, readableModel, mapAddress } from '../src/model/vacuum.ts';
import { throttled } from '../src/model/lights.ts';
import { playerDown, hdUnsupported } from '../src/modules/camera-state.ts';
import { translator } from '../src/i18n/index.ts';
import { ru } from '../src/i18n/ru.ts';
import { en } from '../src/i18n/en.ts';
import { ro } from '../src/i18n/ro.ts';
const t = translator('ru'), tx = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const iso = (ms: number) => new Date(ms).toISOString();
const row = (state: string, changed: number, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: iso(changed), last_updated: iso(changed) });
const NOW = Date.parse('2026-11-10T12:00:00+02:00');

test('doorbell: the sheet opens on a real ring only', () => {
  const old = iso(NOW - 3 * 3600_000), fresh = iso(NOW - 2000);
  assert.equal(ringOpens(old, fresh, NOW), true, 'a new timestamp, a moment ago: someone is at the door');
  assert.equal(ringOpens('unknown', fresh, NOW), true, 'the first ring ever (the entity was «unknown»)');
  assert.equal(ringOpens('unavailable', old, NOW), false, 'the entity came back from «unavailable» with its old ring');
  assert.equal(ringOpens('unknown', old, NOW), false, 'HA restarted and restored the old ring');
  assert.equal(ringOpens('', old, NOW), false, 'the panel reconnected: the states were empty for a moment');
  assert.equal(ringOpens(old, iso(NOW - 20 * 60_000), NOW), false, 'the panel was away for 20 minutes: that ring is not «now»');
  assert.equal(ringOpens(fresh, old, NOW), false, 'an older timestamp is not a new ring');
  assert.equal(ringOpens(fresh, fresh, NOW), false); assert.equal(ringOpens(old, 'unavailable', NOW), false); assert.equal(ringOpens(old, undefined, NOW), false);
  assert.equal(ringOpens(old, iso(NOW - RING_OPEN_MS - 1), NOW), false);
  // the house's own clock, not the tablet's: the newest update among the states
  assert.equal(houseNow({ a: row('1', NOW - 50_000), b: row('2', NOW - 1000), c: { state: 'x', attributes: {}, last_changed: 'bad', last_updated: 'bad' } }), NOW - 1000);
  assert.ok(Number.isNaN(houseNow({})));
});

test('camera events: the state at the start of the window and a lost link are not events', () => {
  const start = NOW - 86_400_000, s = (ms: number) => ms / 1000, ring1 = iso(start - 3 * 86_400_000), ring2 = iso(NOW - 3 * 3600_000);
  const sensors = [{ id: 'event.r', kind: 'ring' as const, camera: 'd' }, { id: 'binary_sensor.m', kind: 'motion' as const, camera: 'd' }];
  // HA's first row of each entity: its state when the window began, stamped with the window's own start and no lc
  const quiet = { 'event.r': [{ s: ring1, lu: s(start) }], 'binary_sensor.m': [{ s: 'on', lu: s(start) }, { s: 'off', lu: s(start + 60_000) }] };
  assert.deepEqual(historyEvents(quiet, sensors, start), [], 'a ring three days ago and motion that was on when the window began: nothing happened in it');
  assert.deepEqual(parseHistory(quiet, { ring: 'event.r', motion: 'binary_sensor.m' }, start), []);
  // one real ring, then the bell loses its link twice and comes back with the same timestamp
  const flaky = { 'event.r': [{ s: ring1, lu: s(start) }, { s: ring2, lu: s(NOW - 3 * 3600_000) }, { s: 'unavailable', lu: s(NOW - 2 * 3600_000) }, { s: ring2, lu: s(NOW - 2 * 3600_000 + 120_000) }, { s: 'unavailable', lu: s(NOW - 3600_000) }, { s: ring2, lu: s(NOW - 3600_000 + 90_000) }],
    'binary_sensor.m': [{ s: 'off', lu: s(start) }, { s: 'on', lu: s(NOW - 7200_000) }, { s: 'unavailable', lu: s(NOW - 7100_000) }, { s: 'on', lu: s(NOW - 7000_000) }, { s: 'off', lu: s(NOW - 6900_000) }] };
  const a = historyEvents(flaky, sensors, start), b = parseHistory(flaky, { ring: 'event.r', motion: 'binary_sensor.m' }, start);
  assert.equal(a.filter(e => e.kind === 'ring').length, 1, 'one ring, not three'); assert.equal(b.filter(e => e.kind === 'ring').length, 1);
  assert.equal(a.filter(e => e.kind === 'motion').length, 1, 'on → unavailable → on is one detection'); assert.equal(b.filter(e => e.kind === 'motion').length, 1);
  // the window began with the bell away, then it came back with a ring older than the window
  const back = { 'event.r': [{ s: 'unavailable', lu: s(start) }, { s: ring1, lu: s(start + 600_000) }] };
  assert.deepEqual(historyEvents(back, sensors, start), []); assert.deepEqual(parseHistory(back, { ring: 'event.r' }, start), []);
});

test('doorbell line: «движение N мин назад» is said only of motion, never of a restart or a lost sensor', () => {
  const e = { ring: 'event.r', motion: 'binary_sensor.m', battery: 'sensor.b' }, ringAt = NOW - 5 * 3600_000;
  const base = { 'event.r': row(iso(ringAt), ringAt), 'sensor.b': row('80', NOW - 4 * 3600_000) };
  assert.equal(lastMotionAt({ ...base, 'binary_sensor.m': row('off', NOW - 10 * 60_000) }, e), NOW - 10 * 60_000);
  assert.match(doorbellTileState({ ...base, 'binary_sensor.m': row('off', NOW - 10 * 60_000) }, e, tx, 'ru', NOW).line!, /^Тихо · движение 10 мин назад$/);
  for (const state of ['unavailable', 'unknown']) { const st = { ...base, 'binary_sensor.m': row(state, NOW - 10 * 60_000) }; assert.equal(lastMotionAt(st, e), null); assert.equal(doorbellTileState(st, e, tx, 'ru', NOW).line, 'Тихо', `${state} for ten minutes is not motion ten minutes ago`); }
  // HA restarted 30 s ago: every row of the bell carries the same last change
  const restarted = { 'event.r': row(iso(ringAt), NOW - 30_000), 'sensor.b': row('80', NOW - 30_500), 'binary_sensor.m': row('off', NOW - 30_000) };
  assert.equal(lastMotionAt(restarted, e), null); assert.equal(doorbellTileState(restarted, e, tx, 'ru', NOW).line, 'Тихо');
  // a visitor rang and walked away: the ring's own time is its last change, the motion's end stands
  const rung = { 'event.r': row(iso(NOW - 200_000), NOW - 200_000), 'sensor.b': row('80', NOW - 4 * 3600_000), 'binary_sensor.m': row('off', NOW - 199_000) };
  assert.equal(lastMotionAt(rung, e), NOW - 199_000);
  assert.equal(ago(NOW - 59.6 * 60_000, NOW, tx, 'ru'), '59 мин назад'); assert.equal(ago(NOW - 23.5 * 3600_000, NOW, tx, 'ru'), '23 ч назад');
});

test('recordings: a week of day folders by the calendar, through the change of the clocks', () => {
  for (const now of [new Date(2026, 9, 25, 23, 30), new Date(2026, 9, 27, 23, 30), new Date(2027, 2, 29, 0, 30), new Date(2027, 2, 31, 0, 30), new Date(2026, 10, 4, 12, 0)]) {
    const days = dayFolders(now.getTime(), 7); assert.equal(new Set(days).size, 7, `${now.toString()}: ${days.join(',')}`);
    const p = (n: number) => String(n).padStart(2, '0'); assert.equal(days[0], `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`);
    for (let i = 1; i < 7; i++) assert.equal(Math.round((Date.parse(days[i - 1] + 'T12:00:00Z') - Date.parse(days[i] + 'T12:00:00Z')) / 86_400_000), 1, 'no day twice, none skipped');
  }
});

// ---- the live players under a stub DOM and a fake clock (after the auditors' player-statemachine.mjs)
async function players() {
  let clock = 0; mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
  const listeners: Record<string, Set<() => void>> = {};
  (globalThis as Record<string, unknown>).document = { hidden: false, cookie: '', addEventListener: (k: string, f: () => void) => { (listeners[k] ??= new Set()).add(f); }, removeEventListener: (k: string, f: () => void) => listeners[k]?.delete(f),
    createElement: () => ({ muted: false, paused: true, readyState: 0, videoWidth: 0, currentTime: 0, srcObject: null, pause() {}, load() {}, remove() {}, removeAttribute() {}, play: async () => {}, addEventListener() {}, removeEventListener() {}, getVideoPlaybackQuality: () => ({ totalVideoFrames: 0 }) }) };
  (globalThis as Record<string, unknown>).location = { origin: 'http://ha.local', protocol: 'http:' };
  (globalThis as Record<string, unknown>).MediaSource = class { static isTypeSupported() { return true; } };
  (globalThis as Record<string, unknown>).RTCPeerConnection = class {};
  const { mountGo2rtcPlayer } = await import('../src/modules/go2rtc-player.ts'), { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts');
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const run = async (seconds: number, each?: (s: number) => void) => { for (let s = 0; s < seconds; s++) { each?.(Math.round(clock / 1000)); clock += 1000; mock.timers.tick(1000); await flush(); } };
  const make = (kind: 'mse' | 'rtc') => { const calls: number[] = [], statuses: string[] = [], host = { online: true, ws: async () => { calls.push(Math.round(clock / 1000)); throw new Error('the camera is away'); }, subscribe: async () => { throw new Error('x'); } }, c = { isConnected: true, append() {} } as unknown as HTMLElement;
    const player = kind === 'mse' ? mountGo2rtcPlayer(c, { addon: 'a889bffc_go2rtc', stream: 'entrance_doorbell_720', host, onStatus: s => statuses.push(s) }) : mountWebrtcPlayer(c, { entityId: 'camera.cam', host, onStatus: s => statuses.push(s) });
    return { calls, statuses, host, player }; };
  return { run, flush, make, reset: () => { clock = 0; }, stop: () => mock.timers.reset(), now: () => Math.round(clock / 1000) };
}
test('live video never gives up: a minute apart for as long as it is mounted, at once when the house is back, held and resumed', async () => {
  const P = await players();
  try {
    for (const kind of ['mse', 'rtc'] as const) {
      // A. the camera is away for two hours, HA stays connected
      P.reset(); let x = P.make(kind); await P.flush(); await P.run(7200);
      assert.deepEqual(x.calls.slice(0, 5), [0, 3, 9, 21, 45], `${kind}: the quick retries are as they were`);
      assert.ok(x.calls.length > 100 && 7200 - x.calls.at(-1)! <= 61, `${kind}: still trying after two hours (last try ${x.calls.at(-1)} s, ${x.calls.length} tries)`);
      for (let i = 5; i < x.calls.length; i++) assert.ok(x.calls[i] - x.calls[i - 1] <= 61, `${kind}: never more than a minute between tries`);
      x.player.dispose(); const after = x.calls.length; await P.run(300); assert.equal(x.calls.length, after, `${kind}: nothing runs after it is unmounted`);
      // B. the connection to the house drops 1 s after the first failure and returns 30 s later
      P.reset(); x = P.make(kind); await P.flush(); await P.run(120, s => { if (s === 1) x.host.online = false; if (s === 31) x.host.online = true; });
      assert.ok(!x.calls.some(c => c > 1 && c < 31), `${kind}: nothing is asked while the house is off the line (${x.calls})`);
      assert.ok(x.calls.some(c => c >= 31 && c <= 34), `${kind}: back on the line → a try within 3 s (${x.calls})`);
      // «Повторить»: at once
      const n = x.calls.length; x.player.retry(); await P.flush(); assert.equal(x.calls.length, n + 1, `${kind}: retry() tries now`);
      // held (behind a sheet, off the screen): after the grace nothing is asked; resumed: at once
      x.player.hold(true, 20_000); await P.run(19); const held = x.calls.length; await P.run(300); assert.ok(x.calls.length - held <= 1, `${kind}: a held player does not reconnect (${x.calls.length - held})`); assert.equal(x.statuses.at(-1), 'paused');
      const m = x.calls.length; x.player.hold(false); await P.flush(); assert.equal(x.calls.length, m + 1, `${kind}: resumed → a try at once`);
      // a short visit to a sheet: the hold is taken back before the grace ends, the stream was never touched
      x.player.hold(true, 20_000); await P.run(5); x.player.hold(false); await P.run(30); assert.notEqual(x.statuses.at(-1), 'paused', `${kind}: a short hold pauses nothing`);
      x.player.dispose();
    }
  } finally { P.stop(); }
});

test('cameras: the players tell the card which tile has no picture', () => {
  let n = 0; const off = playerDown.subscribe(() => { n++; });
  assert.equal(playerDown.has('camera.a'), false); playerDown.set('camera.a', true); playerDown.set('camera.a', true); assert.equal(playerDown.has('camera.a'), true); assert.equal(n, 1, 'told once per change');
  playerDown.set('camera.a', false); assert.equal(playerDown.has('camera.a'), false); assert.equal(n, 2); off(); playerDown.set('camera.a', true); assert.equal(n, 2); playerDown.set('camera.a', false);
});

// ---- the vacuum on the house's own fixture (the Saros Z70 as HA showed it on 09.11.2026)
const fxPath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-vacuum-20261109.json'), fx = existsSync(fxPath) ? JSON.parse(readFileSync(fxPath, 'utf8')) : null;
const P_ = 'living_robot_vacuum';
function vac(over: Record<string, string>) {
  const states = structuredClone(fx.states); for (const [id, state] of Object.entries(over)) states[id] = { ...(states[id] ?? { attributes: {}, last_changed: iso(NOW), last_updated: iso(NOW) }), state };
  return readVacuum({ areas: [], devices: fx.devices, entities: fx.entities, states })!;
}
test('vacuum: a trip to the dock in the middle of a job is still the job', { skip: !fx }, () => {
  assert.equal(vac({}).phase, 'cleaning');
  const wash = vac({ [`vacuum.${P_}`]: 'docked', [`sensor.${P_}_status`]: 'washing_the_mop' }); assert.equal(wash.phase, 'cleaning', 'washing the mop with the run at 91 %'); assert.equal(wash.progress, 91); assert.equal(wash.status, 'washing_the_mop');
  assert.equal(vac({ [`vacuum.${P_}`]: 'returning', [`sensor.${P_}_status`]: 'going_to_wash_the_mop' }).phase, 'cleaning');
  assert.equal(vac({ [`vacuum.${P_}`]: 'docked', [`sensor.${P_}_status`]: 'emptying_the_bin', [`binary_sensor.${P_}_cleaning`]: 'off', [`sensor.${P_}_cleaning_progress`]: '45' }).phase, 'cleaning', 'the run is not finished: by the progress, where the «cleaning» sensor is silent');
  // the job is over: the dock's own work after it, and a plain return home, are what they say
  assert.equal(vac({ [`vacuum.${P_}`]: 'docked', [`sensor.${P_}_status`]: 'washing_the_mop', [`binary_sensor.${P_}_cleaning`]: 'off', [`sensor.${P_}_cleaning_progress`]: '100' }).phase, 'docked');
  assert.equal(vac({ [`vacuum.${P_}`]: 'docked', [`sensor.${P_}_status`]: 'charging', [`binary_sensor.${P_}_cleaning`]: 'off' }).phase, 'docked');
  assert.equal(vac({ [`vacuum.${P_}`]: 'returning', [`sensor.${P_}_status`]: 'returning_home', [`binary_sensor.${P_}_cleaning`]: 'off' }).phase, 'returning');
});
test('vacuum: «unknown» is not a lost robot, «unavailable» is', { skip: !fx }, () => {
  const u = vac({ [`vacuum.${P_}`]: 'unknown' }); assert.equal(u.available, true); assert.equal(u.phase, 'cleaning', 'the status sensor says it cleans');
  assert.equal(vac({ [`vacuum.${P_}`]: 'unknown', [`sensor.${P_}_status`]: 'paused' }).phase, 'paused');
  assert.equal(vac({ [`vacuum.${P_}`]: 'unknown', [`sensor.${P_}_status`]: 'returning_home', [`binary_sensor.${P_}_cleaning`]: 'off' }).phase, 'returning');
  assert.equal(vac({ [`vacuum.${P_}`]: 'unknown', [`sensor.${P_}_status`]: 'charging', [`binary_sensor.${P_}_cleaning`]: 'off' }).phase, 'docked');
  const off = vac({ [`vacuum.${P_}`]: 'unavailable' }); assert.equal(off.available, false); assert.equal(off.phase, 'offline');
});
test('vacuum: no raw strings — a technical model id and the robot\'s own room word are not shown', { skip: !fx }, () => {
  assert.equal(readableModel('roborock.vacuum.s5e'), null); assert.equal(readableModel('yeelink.light.ceilc'), null); assert.equal(readableModel('Saros Z70'), 'Saros Z70'); assert.equal(readableModel('IPC-K2EC'), 'IPC-K2EC'); assert.equal(readableModel(''), null); assert.equal(readableModel(null), null);
  // the rooms are not linked to areas here: the sensor's «кухню» has no name to turn into
  assert.equal(vac({ [`sensor.${P_}_current_room`]: 'кухню' }).currentRoom, null);
});
test('vacuum: every status and error the robot can report has a word in ru, en and ro', { skip: !fx }, () => {
  const opts = (id: string) => (fx.states[id].attributes.options as string[]);
  for (const [name, d] of [['ru', ru], ['en', en], ['ro', ro]] as const) {
    for (const s of opts(`sensor.${P_}_status`)) assert.ok((d as Record<string, string>)[`module.vac.st.${s}`], `${name}: status ${s}`);
    for (const e of opts(`sensor.${P_}_error`).filter(x => x !== 'none')) assert.ok((d as Record<string, string>)[`module.vac.err.${e}`], `${name}: error ${e}`);
    assert.match((d as Record<string, string>)['module.vac.err.code'], /\{e\}/);
  }
});

test('light slider: a tap is one command, the last value of a drag always arrives and never twice', () => {
  let clock = 1000; const sent: number[] = []; mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const th = throttled(v => sent.push(v), () => clock);
    th.send(70); th.send(70, true); assert.deepEqual(sent, [70], 'pointer-down and pointer-up at one spot');
    // a drag: 10 moves 20 ms apart, then the release at the last value
    sent.length = 0; clock += 5000; for (let i = 1; i <= 10; i++) { th.send(70 - i * 5); clock += 20; mock.timers.tick(20); } th.send(20, true);
    assert.equal(sent.at(-1), 20); assert.ok(sent.length <= 4, `throttled: ${sent}`); assert.ok(sent.every((v, i) => i === 0 || v !== sent[i - 1]), `no value twice in a row: ${sent}`);
    // the release lands while a value is still waiting: the waiting one is replaced, nothing is lost
    sent.length = 0; clock += 5000; th.send(40); clock += 10; th.send(45); th.send(50, true); mock.timers.tick(500); assert.deepEqual(sent, [40, 50]);
    // the sheet closes with a value waiting: it goes out
    sent.length = 0; clock += 5000; th.send(60); clock += 10; th.send(65); th.flush(); assert.deepEqual(sent, [60, 65]); mock.timers.tick(500); assert.deepEqual(sent, [60, 65], 'and only once');
    // the same level again a while later is a real command (the lamp may have been changed elsewhere)
    sent.length = 0; clock += 60_000; th.send(65, true); assert.deepEqual(sent, [65]);
  } finally { mock.timers.reset(); }
});

test('the panel lives in a shadow root: the cards of this slice never look things up through `document`', () => {
  for (const f of ['ui/vacuum.tsx', 'ui/cameras.tsx', 'ui/light-sheet.tsx', 'ui/cards.tsx', 'modules/go2rtc-view.tsx', 'modules/event-feed.tsx']) {
    const code = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(!/document\.(getElementById|querySelector|querySelectorAll)\(/.test(code), `${f} asks the document for an element`);
  }
});

test('vacuum map: a new drawing is a new address', () => {
  const a = mapAddress('/api/image_proxy/image.map?token=abc', '2026-11-09T10:07:03+00:00'), b = mapAddress('/api/image_proxy/image.map?token=abc', '2026-11-09T10:09:33+00:00');
  assert.notEqual(a, b, 'HA redrew the map under the same token'); assert.ok(a!.startsWith('/api/image_proxy/image.map?token=abc&state=')); assert.ok(!/[+: ]/.test(a!.split('state=')[1]), 'the time is encoded');
  assert.equal(mapAddress('/x.png', 'now'), '/x.png?state=now'); assert.equal(mapAddress(null, 'now'), null);
});
test('camera sheet: HD is «not supported» only when SD played and HD never did', () => {
  assert.equal(hdUnsupported(true, 'error', false, true), true, 'SD was live, HD failed before its first frame');
  assert.equal(hdUnsupported(true, 'error', false, false), false, 'SD itself was in error (no link): pressing HD must not lock HD for good');
  assert.equal(hdUnsupported(true, 'error', true, true), false, 'HD played and then dropped: a reconnect');
  assert.equal(hdUnsupported(false, 'error', false, true), false); assert.equal(hdUnsupported(true, 'connecting', false, true), false); assert.equal(hdUnsupported(true, 'stalled', false, true), false);
});
test('live video: a frozen frame loses LIVE after 6 s, the connection keeps its longer patience', async () => {
  const P = await players();
  try {
    for (const kind of ['mse', 'rtc'] as const) {
      P.reset(); const x = P.make(kind); x.host.ws = (() => new Promise(() => { /* the handshake hangs: only the picture is under test */ })) as never; x.player.retry(); await P.flush();
      const v = x.player.video as unknown as { readyState: number; videoWidth: number; paused: boolean; currentTime: number; srcObject: unknown; getVideoPlaybackQuality(): { totalVideoFrames: number } };
      let frames = 0; v.readyState = 4; v.videoWidth = 640; v.paused = false; v.srcObject = {}; v.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
      await P.run(5, () => { v.currentTime += 1; frames += 15; });
      assert.equal(x.statuses.at(-1), 'live', `${kind}: frames arrive → live`);
      await P.run(5); assert.equal(x.statuses.at(-1), 'live', `${kind}: five seconds without a frame is a burst, still live`);
      await P.run(3); assert.equal(x.statuses.at(-1), 'stalled', `${kind}: over six seconds on one frame → «прервалось», no LIVE`);
      await P.run(3, () => { v.currentTime += 1; frames += 15; }); assert.equal(x.statuses.at(-1), 'live', `${kind}: the picture moves again → live, without a reconnect`);
      assert.ok(!x.statuses.includes('error'), `${kind}: the connection was not torn down for a short freeze (${x.statuses})`);
      x.player.dispose();
    }
  } finally { P.stop(); }
});
