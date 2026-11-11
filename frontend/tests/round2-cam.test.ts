// Round 2 of the audit (10.11.2026), cameras and doorbell: each check fails on the tree as it was before the fix it names.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.TZ = 'Europe/Chisinau';
import { topEvent, focusCamera, ringOpensOnce, houseClock, eventFilter, RECENT_MS, type CamEvent, type RingMemory } from '../src/model/cameras.ts';
import { doorbellTileState } from '../src/modules/doorbell-state.ts';
import { pictureLost, mseBroken } from '../src/modules/camera-state.ts';
import { translator } from '../src/i18n/index.ts';
import type { PlayerStatus } from '../src/modules/go2rtc-player.ts';

const src = (file: string) => readFileSync(resolve(import.meta.dirname, '../src', file), 'utf8');
const iso = (ms: number) => new Date(ms).toISOString();
const row = (state: string, at: number) => ({ state, attributes: {}, last_changed: iso(at), last_updated: iso(at) });
const T = Date.parse('2026-11-10T12:00:00+02:00');

// ---- a browser small enough for the two players: a video element, the document's visibility, a peer connection ----
const listeners = new Map<string, Set<() => void>>();
const fakeVideo = () => ({ muted: false, autoplay: false, playsInline: false, controls: false, srcObject: null as unknown, paused: true, readyState: 0, videoWidth: 0, currentTime: 0, pause() { /* nothing plays */ }, play: () => Promise.resolve(), load() { /* no source */ }, removeAttribute() { /* no source */ }, remove() { /* not in a tree */ }, addEventListener() { /* no media errors here */ }, removeEventListener() { /* same */ } });
const doc = { hidden: false, createElement: () => fakeVideo(), addEventListener(type: string, fn: () => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn); }, removeEventListener(type: string, fn: () => void) { listeners.get(type)?.delete(fn); } };
(globalThis as unknown as { document: unknown }).document = doc;
const visibility = (hidden: boolean) => { doc.hidden = hidden; for (const fn of [...(listeners.get('visibilitychange') ?? [])]) fn(); };
class Peer { static made: Peer[] = []; closed = false; connectionState = 'new'; iceGatheringState = 'complete'; localDescription: { sdp: string } | null = null; ontrack: unknown; onconnectionstatechange: unknown; onicecandidate: unknown; onicegatheringstatechange: unknown;
  constructor() { Peer.made.push(this); } addTransceiver() { /* recvonly */ } createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0' }); } setLocalDescription(d: { sdp: string }) { this.localDescription = d; return Promise.resolve(); } close() { this.closed = true; } }
(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = Peer;
const container = () => ({ isConnected: true, append() { /* the video goes nowhere */ } }) as unknown as HTMLElement;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
/** A house that answers the client config at once and the offer when the test says so. */
function house() {
  const offers: Array<{ cb: (m: unknown) => void; answer: (unsub: () => void) => void }> = []; let configs = 0;
  return { offers, get configs() { return configs; }, host: { online: true,
    ws: <R,>(m: Record<string, unknown>) => { if (m.type === 'camera/webrtc/get_client_config') configs++; return Promise.resolve({ configuration: {} } as R); },
    subscribe: <M,>(_m: Record<string, unknown>, cb: (m: M) => void) => new Promise<() => void>(answer => { offers.push({ cb: cb as (m: unknown) => void, answer }); }) } };
}

test('f18: a paused tile keeps «no picture» until a frame arrives — the summary counts every camera, not the tiles in sight', () => {
  assert.equal(pictureLost(false, 'connecting', false), false, 'the first eight seconds are «connecting»');
  assert.equal(pictureLost(false, 'error', true), true, 'eight seconds without a picture');
  assert.equal(pictureLost(true, 'paused', false), true, 'scrolled off the screen (the player is paused, the 8 s flag is reset): still without a picture');
  assert.equal(pictureLost(true, 'connecting', false), true, 'back in sight and trying again: still no frame');
  assert.equal(pictureLost(true, 'live', false), false, 'a frame arrived');
  assert.equal(pictureLost(false, 'paused', false), false, 'a tile that played before it was paused is not a lost camera');
  const view = src('modules/go2rtc-view.tsx');
  assert.match(view, /lost\.current = live && pictureLost\(lost\.current, status, slow\)/); assert.match(view, /camDown \|\| lost\.current/);
  assert.doesNotMatch(view, /const down = [^;]*status !== 'paused'/, 'a pause no longer clears the mark');
});

test('f19: a hidden tab is «paused», not «connecting» — MSE player', async () => {
  const { mountGo2rtcPlayer } = await import('../src/modules/go2rtc-player.ts');
  const seen: PlayerStatus[] = [], player = mountGo2rtcPlayer(container(), { addon: 'a889bffc_go2rtc', stream: 'door', host: { online: true, ws: () => Promise.reject(new Error('no supervisor here')) }, onStatus: s => seen.push(s) });
  try {
    visibility(true); assert.equal(seen.at(-1), 'paused', `hidden: ${seen.join()}`);
    const before = seen.length; visibility(false); assert.equal(seen[before], 'connecting', 'shown again: the eight seconds start anew');
  } finally { player.dispose(); doc.hidden = false; }
});

test('f19: a hidden tab is «paused», not «connecting» — WebRTC player', async () => {
  const { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts');
  const h = house(), seen: PlayerStatus[] = [], player = mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host, onStatus: s => seen.push(s) });
  try { await settle(); visibility(true); assert.equal(seen.at(-1), 'paused', `hidden: ${seen.join()}`); visibility(false); assert.equal(seen.at(-1), 'connecting'); }
  finally { player.dispose(); doc.hidden = false; }
});

test('l34 / l182: a stale WebRTC start() whose subscription arrives late does not stop the new run', async () => {
  const { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts');
  Peer.made.length = 0; const h = house(), player = mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host });
  try {
    await settle(); assert.equal(h.offers.length, 1, 'the first offer is on its way');
    player.retry(); await settle(); // «Повторить», or the house back on the line, while HA has not answered yet
    assert.equal(h.offers.length, 2); assert.equal(Peer.made.length, 2); assert.equal(Peer.made[0].closed, true, 'the first connection is closed by the new start');
    let dropped = 0; h.offers[0].answer(() => { dropped++; }); await settle();
    assert.equal(dropped, 1, 'the late subscription of the old run is given back');
    assert.equal(Peer.made[1].closed, false, 'the new run keeps its connection');
    let kept = 0; h.offers[1].answer(() => { kept++; }); await settle(); assert.equal(kept, 0); assert.equal(Peer.made[1].closed, false);
    player.dispose(); assert.equal(kept, 1, 'the live subscription goes with the player');
  } finally { player.dispose(); }
});

test('l34: an error that comes in the same frame as the subscription keeps its retry timer', async () => {
  const { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts');
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = house(), seen: PlayerStatus[] = [], player = mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host, onStatus: s => seen.push(s) });
  try {
    await settle(); assert.equal(h.configs, 1);
    h.offers[0].cb({ type: 'error', code: 'webrtc_offer_failed' }); assert.equal(seen.at(-1), 'error');
    let dropped = 0; h.offers[0].answer(() => { dropped++; }); await settle(); assert.equal(dropped, 1);
    mock.timers.tick(3000); await settle();
    assert.equal(h.configs, 2, 'three seconds later the player tries again by itself');
  } finally { player.dispose(); mock.timers.reset(); }
});

test('l35: an MSE «error» while the house is off the line does not move the tile to WebRTC', () => {
  assert.equal(mseBroken('error', true), true); assert.equal(mseBroken('error', false), false); assert.equal(mseBroken('stalled', true), false);
  const view = src('modules/go2rtc-view.tsx');
  assert.match(view, /mseBroken\(status, hostRef\.current\.online\)/);
  assert.match(view, /fellBack\.current && canIngress\) \{ fellBack\.current = false; setPath\('mse'\)/, 'the house back on the line: the tile tries its own stream again');
});

test('l36: one ring opens the sheet once', () => {
  const id = 'event.door_ring', old = iso(T - 3 * 3600_000), ring = iso(T - 5000), next = iso(T + 20_000);
  let m: RingMemory = new Map();
  assert.equal(ringOpensOnce(id, old, ring, T, m), true, 'a real ring opens');
  assert.equal(ringOpensOnce(id, ring, 'unavailable', T, m), false);
  assert.equal(ringOpensOnce(id, 'unavailable', ring, T + 30_000, m), false, 'the bell came back with the same stamp, still under two minutes old: not a second ring');
  assert.equal(ringOpensOnce(id, ring, next, T + 30_000, m), true, 'the next ring opens');
  assert.equal(ringOpensOnce(id, '', next, T + 40_000, m), false, 'auto-open switched off and on again after that ring');
  m = new Map();
  assert.equal(ringOpensOnce(id, '', ring, T, m), false, 'auto-open switched on within two minutes of a ring: nothing was tracked, the stamp is the bell\'s old state');
  assert.equal(ringOpensOnce(id, undefined, ring, T, new Map()), false);
  assert.equal(ringOpensOnce(id, ring, next, T + 30_000, m), true, '…and the ring after that opens');
  m = new Map();
  assert.equal(ringOpensOnce(id, old, '', T, m), false); assert.equal(ringOpensOnce(id, '', ring, T, m), true, 'a reconnect that brought a NEW ring is not missed');
  m = new Map();
  assert.equal(ringOpensOnce(id, 'unknown', ring, T, m), true, 'the first ring ever'); assert.equal(ringOpensOnce(id, 'unavailable', ring, T, new Map()), true, 'a ring this panel has not seen, as the bell comes back');
  assert.equal(ringOpensOnce('event.other_ring', old, ring, T, m), true, 'another bell has its own memory');
  assert.equal(ringOpensOnce(id, old, iso(T - 20 * 60_000), T, new Map()), false, 'the rules of ringOpens still hold');
});

test('l37: a ring is fresh by the house\'s clock, whatever the tablet\'s clock says', () => {
  const entities = { ring: 'event.door_ring' }, tx = (k: string) => k;
  for (const [name, off] of [['ten minutes fast', 600_000], ['ten minutes slow', -600_000]] as const) {
    const clock = houseClock(), device = (house: number) => house + off;
    const quiet = { 'event.door_ring': row(iso(T - 3600_000), T - 3600_000), 'sensor.power': row('120', T - 90_000) };
    assert.equal(clock(quiet, device(T - 30_000)), device(T - 30_000), 'the states the panel started with measure nothing (the newest may be old)');
    const rung = { ...quiet, 'event.door_ring': row(iso(T), T) };
    const now = clock(rung, device(T + 1000));
    assert.equal(now, T, `${name}: a state that has just arrived sets the house's clock (its stamp is «now»)`);
    assert.equal(doorbellTileState(rung, entities, tx, 'ru', clock(rung, device(T + 20_000))).icon, 'bell', `${name}: «Звонок в …» twenty seconds after the ring`);
    assert.equal(doorbellTileState(rung, entities, tx, 'ru', clock(rung, device(T + 70_000))).icon, null, `${name}: gone after its minute`);
    assert.equal(doorbellTileState(rung, entities, tx, 'ru', device(T + 20_000)).icon, null, 'by the tablet\'s own clock the line is missing (fast) or late (slow)');
    const ev: CamEvent[] = [{ camera: 'door', kind: 'ring', at: T, active: false }], held: CamEvent = { camera: 'stairs', kind: 'person', at: device(T), active: false };
    assert.equal(topEvent(ev, device(T + 20_000), clock(rung, device(T + 20_000)))?.kind, 'ring', `${name}: the Cameras card is red`);
    assert.equal(topEvent(ev, device(T + RECENT_MS + 5000), clock(rung, device(T + RECENT_MS + 5000))), null, `${name}: for two minutes`);
    assert.equal(focusCamera('main', ev, device(T + 20_000), clock(rung, device(T + 20_000))), 'door');
    assert.equal(topEvent([held], device(T + 60_000), clock(rung, device(T + 60_000)))?.kind, 'person', 'a detection that ended is timed by this device (holdEnded stamps it so)');
  }
  const same = houseClock(), a = { 'sensor.power': row('1', T - 5000) }, b = { 'sensor.power': row('2', T - 1200) };
  same(a, T - 4000); assert.equal(same(b, T), T, 'a second or two of delivery is the same clock');
  assert.equal(topEvent([{ camera: 'door', kind: 'ring', at: T, active: false }], T + 1000)?.kind, 'ring', 'without a house clock the device\'s is used, as before');
  assert.match(src('modules/doorbell.tsx'), /doorbellTileState\(registry\.states, entities, [^\n]*houseTime\(registry\.states\)\)/);
  assert.match(src('ui/cameras.tsx'), /camerasLine\(views, now, t, lang, ringNow\)/);
});

test('l46: Romanian counts cameras with «de» from twenty on', () => {
  const ro = translator('ro'), en = translator('en');
  assert.equal(ro('cams.count', { n: 21 }), '21 de camere'); assert.equal(ro('cams.count', { n: 5 }), '5 camere'); assert.equal(ro('cams.count', { n: 1 }), '1 cameră'); assert.equal(ro('cams.count', { n: 119 }), '119 camere'); assert.equal(ro('cams.count', { n: 100 }), '100 de camere');
  assert.equal(ro('cams.offline', { n: 20 }), '20 de camere fără legătură'); assert.equal(ro('cams.offline', { n: 2 }), '2 camere fără legătură');
  assert.equal(en('cams.count', { n: 1 }), '1 camera'); assert.equal(en('cams.count', { n: 21 }), '21 cameras'); assert.equal(en('cams.offline', { n: 1 }), '1 camera offline');
});

test('l92: the events filter is read from the page\'s address', () => {
  assert.equal(eventFilter('ring'), 'ring'); assert.equal(eventFilter('person'), 'person'); assert.equal(eventFilter('motion'), 'motion');
  assert.equal(eventFilter(null), 'all'); assert.equal(eventFilter('settings'), 'all'); assert.equal(eventFilter(undefined), 'all');
});

test('l7: the quality button has a full name in three languages', () => {
  for (const lang of ['ru', 'en', 'ro'] as const) assert.ok(!translator(lang)('module.camera.quality' as never).startsWith('module.'), lang);
  assert.equal(translator('ru')('module.camera.quality' as never), 'Качество видео');
  assert.equal((src('modules/go2rtc-view.tsx').match(/at-camera-q" aria-label=\{`\$\{t\('module\.camera\.quality'\)\}: /g) ?? []).length, 2, 'the live player and the preview stand-in');
});

test('l174: an event\'s snapshot or clip opened on the stage says what it is', () => {
  const feed = src('modules/event-feed.tsx');
  assert.match(feed, /<img className="at-door-clip" src=\{p\.url\} alt=\{name\} \/>/); assert.match(feed, /<video className="at-door-clip" src=\{p\.url\} aria-label=\{name\}/);
  assert.match(feed, /name = `\$\{kind\}, \$\{at\}`/, '«Звонок в дверь, 10:52»');
  assert.doesNotMatch(feed, /at-door-clip" src=\{p\.url\} alt=""/);
});

test('l79: a tile that went away without a picture is remembered for the sheet that takes its place', async () => {
  const { playerDown, LEFT_DOWN_MS } = await import('../src/modules/camera-state.ts');
  playerDown.set('camera.x', true); assert.equal(playerDown.gaveUp('camera.x', 1000), true);
  playerDown.leave('camera.x', 1000); assert.equal(playerDown.has('camera.x'), false, 'an unmounted tile counts for nothing in the summary');
  assert.equal(playerDown.gaveUp('camera.x', 1500), true, 'the sheet that opens now starts with «Повторить»'); assert.equal(playerDown.gaveUp('camera.x', 1000 + LEFT_DOWN_MS), false);
  playerDown.set('camera.x', true); playerDown.set('camera.x', false); assert.equal(playerDown.gaveUp('camera.x', 1500), false, 'a frame arrived: nothing to remember');
  playerDown.leave('camera.y', 1000); assert.equal(playerDown.gaveUp('camera.y', 1001), false, 'a tile that played leaves nothing behind');
});
