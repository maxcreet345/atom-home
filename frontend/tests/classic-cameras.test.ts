// Release classic, cameras (11.11.2026): the Codex review's players (CODEX-012, 013, 015, 016) and the studio's ST-07 / ST-08, ported by hand from the
// design-2026 branch (commit 6f68f3d, tests/impl3-cameras.test.ts) onto the classic look. Each check fails on the classic tree as it was before the fix
// it names (the old sources were put back for a run: 11 of the 12 failed there; the second CODEX-012 test guards what must not change and passes on both).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlayerStatus } from '../src/modules/go2rtc-player.ts';

const src = (file: string) => readFileSync(resolve(import.meta.dirname, '../src', file), 'utf8');
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

// ---- a browser small enough for the players: a video element, the document, a peer connection, a clock the test moves ----
type FakeVideo = { muted: boolean; autoplay: boolean; playsInline: boolean; controls: boolean; srcObject: unknown; paused: boolean; readyState: number; videoWidth: number; videoHeight: number; currentTime: number; plays: number;
  getVideoPlaybackQuality?: () => { totalVideoFrames: number }; play(): Promise<void>; pause(): void; load(): void; removeAttribute(): void; remove(): void; addEventListener(): void; removeEventListener(): void };
let refuseSound = false; // a browser that refuses sound without a tap (Safari on an iPhone): play() of an unmuted element is NotAllowedError
const videos: FakeVideo[] = [];
const fakeVideo = (): FakeVideo => { const v: FakeVideo = { muted: false, autoplay: false, playsInline: false, controls: false, srcObject: null, paused: true, readyState: 0, videoWidth: 0, videoHeight: 0, currentTime: 0, plays: 0,
  play() { v.plays++; if (refuseSound && !v.muted) return Promise.reject(Object.assign(new Error('play() needs a tap'), { name: 'NotAllowedError' })); v.paused = false; return Promise.resolve(); },
  pause() { v.paused = true; }, load() { /* no source */ }, removeAttribute() { /* no source */ }, remove() { /* not in a tree */ }, addEventListener() { /* no media errors here */ }, removeEventListener() { /* same */ } }; videos.push(v); return v; };
const listeners = new Map<string, Set<() => void>>();
const doc = { hidden: false, cookie: '', createElement: () => fakeVideo(), addEventListener(type: string, fn: () => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn); }, removeEventListener(type: string, fn: () => void) { listeners.get(type)?.delete(fn); } };
(globalThis as unknown as { document: unknown }).document = doc;
type Track = { kind: string };
class Peer { static made: Peer[] = []; closed = false; connectionState = 'new'; iceGatheringState = 'complete'; localDescription: { sdp: string } | null = null;
  ontrack: ((ev: { streams: unknown[]; track: Track }) => void) | null = null; onconnectionstatechange: (() => void) | null = null; onicecandidate: unknown; onicegatheringstatechange: unknown;
  answer: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  constructor() { Peer.made.push(this); } addTransceiver() { /* recvonly */ } createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0' }); } setLocalDescription(d: { sdp: string }) { this.localDescription = d; return Promise.resolve(); }
  setRemoteDescription() { return new Promise<void>((res, rej) => { this.answer = { resolve: res, reject: rej }; }); } addIceCandidate() { return Promise.resolve(); } close() { this.closed = true; } }
(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = Peer;
const container = () => ({ isConnected: true, append() { /* the video goes nowhere */ } }) as unknown as HTMLElement;
/** A house that answers the client config at once and hands the offer's callback to the test. */
function house() {
  const offers: Array<(m: unknown) => void> = []; let configs = 0;
  return { offers, get configs() { return configs; }, host: { online: true,
    ws: <R,>(m: Record<string, unknown>) => { if (m.type === 'camera/webrtc/get_client_config') configs++; return Promise.resolve({ configuration: {} } as R); },
    subscribe: <M,>(_m: Record<string, unknown>, cb: (m: M) => void) => { offers.push(cb as (m: unknown) => void); return Promise.resolve(() => undefined); } } };
}
/** performance.now() follows the mocked timers (the players time frames by it). */
function clock() {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_000_000 });
  const real = globalThis.performance; Object.defineProperty(globalThis, 'performance', { value: { now: () => Date.now() }, configurable: true, writable: true });
  return () => { mock.timers.reset(); Object.defineProperty(globalThis, 'performance', { value: real, configurable: true, writable: true }); };
}
/** A connected WebRTC player whose video has shown its first frame; `second()` moves the media clock (and the frame counter when `frames`) one second on. */
async function playing(frames: 'count' | 'frozen' | 'none') {
  const { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts');
  Peer.made.length = 0; videos.length = 0;
  const h = house(), seen: PlayerStatus[] = [], player = mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host, onStatus: s => seen.push(s) });
  await settle(); const v = videos.at(-1)!;
  Object.assign(v, { readyState: 4, videoWidth: 640, videoHeight: 360, paused: false, srcObject: {} });
  let n = 1; if (frames !== 'none') v.getVideoPlaybackQuality = () => ({ totalVideoFrames: n });
  const second = (moveFrames: boolean) => { v.currentTime += 1; if (moveFrames) n++; mock.timers.tick(1000); };
  return { h, seen, player, v, second };
}

// ---------------------------------------------------------------- CODEX-012
test('CODEX-012: a picture that froze while the audio keeps the media clock running is rebuilt (by the frame counter), and «нет кадров» is said first', async () => {
  const restore = clock();
  try {
    const { h, seen, player, second } = await playing('frozen');
    try {
      second(false); assert.equal(seen.at(-1), 'live', 'the first frame: live');
      for (let s = 0; s < 10; s++) second(false);
      assert.equal(seen.at(-1), 'stalled', 'no new frame for 6 s: «нет кадров», whatever the clock does');
      assert.equal(h.configs, 1);
      for (let s = 0; s < 40; s++) second(false); // 50 s without a new frame, the media clock advanced every second
      assert.ok(seen.includes('error'), `the frozen connection was given up: ${seen.join()}`);
      mock.timers.tick(3000); await settle();
      assert.equal(h.configs, 2, 'and built again three seconds later (on the old code the media clock kept it «alive» for ever)');
    } finally { player.dispose(); }
  } finally { restore(); }
});

test('CODEX-012: new frames keep a connection; a browser without a frame counter goes by the media clock as before', async () => {
  let restore = clock();
  try {
    const { h, seen, player, second } = await playing('count');
    try { for (let s = 0; s < 180; s++) second(true); assert.equal(h.configs, 1); assert.equal(seen.at(-1), 'live'); assert.ok(!seen.includes('stalled'), seen.join()); }
    finally { player.dispose(); }
  } finally { restore(); }
  restore = clock();
  try {
    const { h, seen, player, second } = await playing('none');
    try {
      for (let s = 0; s < 120; s++) second(false); assert.equal(h.configs, 1, 'no counter: the advancing clock is the picture'); assert.equal(seen.at(-1), 'live');
    } finally { player.dispose(); }
  } finally { restore(); }
  restore = clock();
  try {
    const { h, player, v } = await playing('none');
    try { for (let s = 0; s < 50; s++) mock.timers.tick(1000); void v; await settle(); assert.ok(h.configs >= 1); mock.timers.tick(3000); await settle(); assert.equal(h.configs, 2, 'no counter and a clock that stopped: rebuilt after 45 s'); }
    finally { player.dispose(); }
  } finally { restore(); }
});

// ---------------------------------------------------------------- CODEX-013
test('CODEX-013: the old peer\'s late answer rejection does not close the new connection (Codex scratch merge_webrtc_stale)', async () => {
  const { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts');
  Peer.made.length = 0; videos.length = 0;
  const h = house(), seen: PlayerStatus[] = [], player = mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host, onStatus: s => seen.push(s) });
  try {
    await settle(); h.offers[0]({ type: 'answer', answer: 'v=0' }); // the browser is applying the first answer…
    player.retry(); await settle(); // …when «Повторить» (or the house back on the line) starts a new connection
    assert.equal(Peer.made.length, 2); assert.equal(Peer.made[0].closed, true); assert.equal(Peer.made[1].closed, false);
    Peer.made[0].answer!.reject(new Error('InvalidStateError: the peer is closed')); await settle();
    assert.equal(Peer.made[1].closed, false, 'the new connection is kept');
    assert.notEqual(seen.at(-1), 'error', `the new attempt is not an error: ${seen.join()}`);
    assert.equal(h.configs, 2, 'and no third attempt is started for it');
  } finally { player.dispose(); }
});

test('CODEX-013: a track the old peer delivers late does not reach the shared video, a failure of the CURRENT answer still counts', async () => {
  const { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts');
  Peer.made.length = 0; videos.length = 0; let audio = 0;
  const h = house(), seen: PlayerStatus[] = [], player = mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host, onStatus: s => seen.push(s), onAudio: () => { audio++; } });
  try {
    await settle(); const old = Peer.made[0], v = videos.at(-1)!;
    player.retry(); await settle();
    const stale = { id: 'old stream' }; old.ontrack?.({ streams: [stale], track: { kind: 'audio' } });
    assert.notEqual(v.srcObject, stale, 'the old peer\'s stream is not put on the video'); assert.equal(audio, 0, 'nor does it say the stream has sound');
    const fresh = { id: 'new stream' }; Peer.made[1].ontrack?.({ streams: [fresh], track: { kind: 'audio' } });
    assert.equal(v.srcObject, fresh); assert.equal(audio, 1);
    h.offers[1]({ type: 'answer', answer: 'v=0' }); Peer.made[1].answer!.reject(new Error('bad answer')); await settle();
    assert.equal(seen.at(-1), 'error', 'the current answer refused: an error that tries again');
  } finally { player.dispose(); }
});

// ---------------------------------------------------------------- CODEX-015
test('CODEX-015: playVideo — a browser that refuses sound without a tap gets the picture muted, and the panel is told; other refusals stay the caller\'s', async () => {
  const { playVideo } = await import('../src/modules/go2rtc-player.ts');
  refuseSound = true;
  try {
    const v = fakeVideo(); v.muted = false; let told = 0;
    await playVideo(v as unknown as HTMLVideoElement, () => { told++; });
    assert.equal(v.muted, true); assert.equal(told, 1); assert.equal(v.paused, false, 'the picture plays, muted'); assert.equal(v.plays, 2);
    const m = fakeVideo(); m.muted = true; m.play = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    await assert.rejects(playVideo(m as unknown as HTMLVideoElement, () => { told++; }), 'a muted video refused: not a sound question'); assert.equal(told, 1);
    const a = fakeVideo(); a.muted = false; a.play = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
    await assert.rejects(playVideo(a as unknown as HTMLVideoElement)); assert.equal(a.muted, false, 'another error leaves the sound alone');
  } finally { refuseSound = false; }
});

test('CODEX-015: a new player starts with the family\'s sound (muted by default); refused, it mutes and says so', async () => {
  const { mountWebrtcPlayer } = await import('../src/modules/webrtc-player.ts'), { mountGo2rtcPlayer } = await import('../src/modules/go2rtc-player.ts');
  const h = house(), made: Array<{ dispose(): void }> = [], keep = <P extends { dispose(): void }>(p: P) => { made.push(p); return p; }; // disposed even when a check fails (no timer keeps the run alive)
  const noSupervisor = { online: true, ws: () => Promise.reject(new Error('no supervisor here')) };
  try {
    assert.equal(keep(mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host })).video.muted, true, 'muted unless asked');
    assert.equal(keep(mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host, sound: true })).video.muted, false, 'SD→HD, «Повторить», MSE↔WebRTC: the new video keeps the sound');
    assert.equal(keep(mountGo2rtcPlayer(container(), { addon: 'a889bffc_go2rtc', stream: 'door', host: noSupervisor, sound: true })).video.muted, false);
    assert.equal(keep(mountGo2rtcPlayer(container(), { addon: 'a889bffc_go2rtc', stream: 'door', host: noSupervisor })).video.muted, true);
    refuseSound = true; Peer.made.length = 0;
    let muted = 0; const p = keep(mountWebrtcPlayer(container(), { entityId: 'camera.door', host: h.host, sound: true, onMuted: () => { muted++; } }));
    await settle(); Peer.made.at(-1)!.ontrack?.({ streams: [{ id: 's' }], track: { kind: 'video' } }); await settle();
    assert.equal(p.video.muted, true, 'refused: muted'); assert.equal(muted, 1, 'and the panel is told (its button goes off)'); assert.equal(p.video.paused, false, 'the picture plays');
  } finally { refuseSound = false; for (const p of made) p.dispose(); }
});

test('CODEX-015: the view hands every new player the family\'s sound and reads its button off the video itself', () => {
  const view = src('modules/go2rtc-view.tsx');
  assert.equal((view.match(/sound: wish\.current && !behindRef\.current, onMuted: refused/g) ?? []).length, 2, 'both players (the add-on\'s stream and WebRTC) get the wish');
  assert.match(view, /v\.addEventListener\('volumechange', sync\)/, 'the button and the chip follow the element (never «Звук» over a muted video)');
  assert.equal((view.match(/const unheard = heard\(player\.video\)/g) ?? []).length, 2);
  assert.match(view, /v\.muted = !v\.muted; wish\.current = !v\.muted;/, 'the toggle is the wish');
  assert.match(view, /<Go2rtcView \{\.\.\.low\} soundWish=\{sound\} \/>/, 'DualView: the light layer and the full one share it');
});

// ---------------------------------------------------------------- CODEX-016
test('CODEX-016: the full-quality layer waiting behind the light one is inert and hidden from a screen reader until it is shown', () => {
  const view = src('modules/go2rtc-view.tsx');
  assert.match(view, /data-quality="high" inert=\{!hi\} aria-hidden=\{hi \? undefined : 'true'\}/);
  assert.match(view, /behind=\{!hi\}/, 'and it stays muted while it waits');
});

// ---------------------------------------------------------------- ST-07
test('ST-07: the «rest is in the HA logbook» line counts what the chosen filter hides, not the other kind', async () => {
  const { feedPage, FEED_LIMIT } = await import('../src/modules/doorbell-state.ts');
  type Ev = { kind: 'ring' | 'motion'; at: number };
  const evs = (rings: number, motions: number): Ev[] => [...Array.from({ length: rings }, (_, i) => ({ kind: 'ring' as const, at: 1e12 - i * 60_000 })), ...Array.from({ length: motions }, (_, i) => ({ kind: 'motion' as const, at: 1e12 - i * 60_000 - 30_000 }))].sort((a, b) => b.at - a.at);
  const more = (p: { list: unknown[]; total: number }) => p.total > p.list.length ? p.total : null;
  assert.equal(FEED_LIMIT, 30);
  const week = evs(2, 5);
  assert.deepEqual([feedPage(week, 'all'), feedPage(week, 'ring'), feedPage(week, 'motion')].map(p => [p.list.length, more(p)]), [[7, null], [2, null], [5, null]], '2 rings + 5 motions: nothing hidden under any filter (the old line said «7» under «Звонки»)');
  const busy = evs(31, 5);
  assert.deepEqual([feedPage(busy, 'all'), feedPage(busy, 'ring'), feedPage(busy, 'motion')].map(p => [p.list.length, more(p)]), [[30, 36], [30, 31], [5, null]]);
  assert.deepEqual([feedPage(evs(30, 0), 'ring')].map(p => [p.list.length, more(p)]), [[30, null]], 'exactly thirty: nothing hidden');
  assert.deepEqual([feedPage(evs(0, 31), 'motion')].map(p => [p.list.length, more(p)]), [[30, 31]], 'a camera without a ring');
  assert.deepEqual(feedPage(null, 'ring'), { list: [], total: 0 }, 'not read yet');
  assert.ok(feedPage(busy, 'ring').list.every(e => e.kind === 'ring')); assert.deepEqual(feedPage(busy, 'all').list, busy.slice(0, 30), 'the order and the limit are the same');
  const feed = src('modules/event-feed.tsx');
  assert.match(feed, /feed\.merged !== null && feed\.filteredTotal > feed\.list\.length/); assert.match(feed, /moreEvents', \{ n: feed\.filteredTotal \}/);
  assert.doesNotMatch(feed, /n: feed\.merged\.length/);
});

// ---------------------------------------------------------------- ST-08
/** A stage and its document that can enter and leave the full screen, frames by hand. */
function stageWorld(opts: { refuse?: boolean; shadow?: boolean; nativeOnly?: boolean } = {}) {
  const docL = new Map<string, Set<() => void>>(), frames = new Map<number, () => void>(); let fid = 0; const focused: Array<{ el: string; preventScroll?: boolean }> = [];
  const win = { requestAnimationFrame(f: () => void) { frames.set(++fid, f); return fid; }, cancelAnimationFrame(id: number) { frames.delete(id); } };
  const d = { fullscreenElement: null as unknown, defaultView: win, addEventListener(t: string, f: () => void) { (docL.get(t) ?? docL.set(t, new Set()).get(t)!).add(f); }, removeEventListener(t: string, f: () => void) { docL.get(t)?.delete(f); } };
  const host = { tag: 'host' }, root = opts.shadow ? { fullscreenElement: null as unknown } : d;
  let webkit = 0;
  const video = { webkitEnterFullscreen() { webkit++; } };
  const column = { scrollTop: 286, scrollLeft: 0, parentElement: null, parentNode: null }; // the sheet's scrolled column
  const stage: Record<string, unknown> = { ownerDocument: d, getRootNode: () => root, querySelector: () => video, parentElement: column, isConnected: true };
  if (!opts.nativeOnly) stage.requestFullscreen = () => opts.refuse ? Promise.reject(new TypeError('Permissions check failed')) : Promise.resolve();
  const opener = { isConnected: true, focus(o?: { preventScroll?: boolean }) { focused.push({ el: 'opener', preventScroll: o?.preventScroll }); } };
  const fire = () => { for (const f of [...(docL.get('fullscreenchange') ?? [])]) f(); };
  const enter = (el: unknown = stage) => { if (el === stage) column.scrollTop = 0; /* the stage left the flow: the browser clamps the column */ if (opts.shadow) { (root as { fullscreenElement: unknown }).fullscreenElement = el === stage ? stage : null; d.fullscreenElement = el === stage ? host : el; } else d.fullscreenElement = el; fire(); };
  const leave = () => { if (opts.shadow) (root as { fullscreenElement: unknown }).fullscreenElement = null; d.fullscreenElement = null; fire(); };
  const runFrames = () => { const fs = [...frames.values()]; frames.clear(); for (const f of fs) f(); };
  return { stage: stage as unknown as HTMLElement, opener, focused, enter, leave, runFrames, frames, column, listeners: () => docL.get('fullscreenchange')?.size ?? 0, webkit: () => webkit };
}

test('ST-08: the stage left its full screen → the sheet\'s scroll and the focus come back («Во весь экран», a frame later, without scrolling); one listener, gone after', async () => {
  const { stageFullscreen } = await import('../src/modules/camera-state.ts');
  for (const shadow of [false, true]) {
    const w = stageWorld({ shadow }), watch = stageFullscreen();
    watch.open(w.stage, w.opener as unknown as HTMLElement); await settle();
    assert.equal(w.listeners(), 1); w.enter(); assert.equal(w.focused.length, 0, 'entering moves nothing');
    w.leave(); assert.equal(w.focused.length, 0, 'not at once: a frame later'); assert.equal(w.listeners(), 0, 'one full screen, one way back');
    w.runFrames(); assert.deepEqual(w.focused, [{ el: 'opener', preventScroll: true }], shadow ? 'in a shadow root (its own fullscreenElement)' : 'in the document');
    assert.equal(w.column.scrollTop, 286, 'the sheet\'s column is back where it stood (the full screen had clamped it to the top)');
    w.leave(); w.runFrames(); assert.equal(w.focused.length, 1, 'a later change of the full screen does nothing');
    // twice in the same sheet: each time one return, nothing piles up
    watch.open(w.stage, w.opener as unknown as HTMLElement); watch.open(w.stage, w.opener as unknown as HTMLElement); await settle();
    assert.equal(w.listeners(), 1, 'a second «Во весь экран» replaces the first watch'); w.enter(); w.leave(); w.runFrames(); assert.equal(w.focused.length, 2);
  }
});

test('ST-08: another app\'s full screen, an unmounted sheet, a button that is gone, a refused request', async () => {
  const { stageFullscreen } = await import('../src/modules/camera-state.ts');
  { const w = stageWorld(), watch = stageFullscreen(); watch.open(w.stage, w.opener as unknown as HTMLElement); await settle();
    w.enter({ other: true }); w.leave(); w.runFrames(); assert.equal(w.focused.length, 0, 'not our stage: nothing moves'); watch.stop(); assert.equal(w.listeners(), 0); }
  { const w = stageWorld(), watch = stageFullscreen(); watch.open(w.stage, w.opener as unknown as HTMLElement); await settle();
    w.enter(); w.leave(); assert.equal(w.frames.size, 1); watch.stop(); w.runFrames(); assert.equal(w.focused.length, 0, 'unmounted before the frame: the waiting focus is cancelled'); assert.equal(w.listeners(), 0); }
  { const w = stageWorld(), watch = stageFullscreen(); watch.open(w.stage, w.opener as unknown as HTMLElement); await settle();
    w.enter(); w.opener.isConnected = false; w.leave(); w.runFrames(); assert.equal(w.focused.length, 0, 'the button is no longer on the page: the focus does not jump to it'); }
  { const w = stageWorld({ refuse: true }), watch = stageFullscreen(); let unhandled = 0; const count = () => { unhandled++; }; process.on('unhandledRejection', count);
    try { watch.open(w.stage, w.opener as unknown as HTMLElement); await settle(); await new Promise(r => setTimeout(r, 10)); }
    finally { process.off('unhandledRejection', count); }
    assert.equal(unhandled, 0, 'a refused request leaves no unhandled rejection'); assert.equal(w.listeners(), 0, 'and no listener'); assert.equal(w.focused.length, 0, 'and moves nothing'); assert.equal(w.webkit(), 1, 'the video\'s own full screen is tried, as before'); }
  { const w = stageWorld({ nativeOnly: true }), watch = stageFullscreen(); watch.open(w.stage, w.opener as unknown as HTMLElement); assert.equal(w.webkit(), 1, 'no Element Fullscreen (iPhone): the video\'s own'); assert.equal(w.listeners(), 0); }
  for (const f of ['modules/doorbell.tsx', 'modules/camera-go2rtc.tsx']) {
    const s = src(f);
    assert.match(s, /\(full\.current \?\?= stageFullscreen\(\)\)\.open\(el, e\.currentTarget as HTMLElement \| null\)/, `${f}: the opener is the clicked button`);
    assert.match(s, /useEffect\(\(\) => \(\) => full\.current\?\.stop\(\), \[\]\)/, `${f}: stopped on unmount`);
    assert.match(s, /className="at-cam-tool at-cam-full" disabled=\{!stage\} onClick=\{fullscreen\}/, `${f}: the button is the same`);
  }
});

// ---------------------------------------------------------------- CODEX-015, the button's place on classic
test('CODEX-015 (classic): the stage\'s sound and SD/HD buttons are positioned on the picture, the sound one in the SD button\'s dark chip, and outweigh the touch rule', () => {
  const css = src('styles/atom.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // the touch rule `.hm-shell :is(…, .hm-pill.is-small, …, .hm-camera-q, …){position:relative}` weighs (0,3,0): the stage's rules must weigh more and come later
  const at = (re: RegExp) => { const m = re.exec(css); return m ? m.index : -1; };
  const touch = at(/\.hm-shell :is\([^)]*\.hm-camera-q[^)]*\)\{position:relative\}/), pos = at(/\.hm-shell \.at-cam-stage button\.hm-camera-q\{position:absolute\}/);
  assert.ok(touch >= 0, 'the touch rule is still there (what this outweighs)'); assert.ok(pos > touch, 'the stage\'s buttons are absolute, after and above the touch rule');
  assert.match(css, /\.hm-shell \.at-cam-stage button\.at-cam-sound\{background:#000a;color:#fff;cursor:pointer;min-height:28px\}/, 'the SD button\'s chip: #000a, white, 28 px');
  assert.match(css, /\.hm-shell \.at-cam-stage button\.at-cam-sound\.is-on\{background:var\(--ah-accent\)\}/, 'on: the accent, as before (outweighs the chip rule)');
  assert.match(css, /\.hm-shell\.ah-shell\[data-theme="dark"\] \.at-cam-stage button\.at-cam-sound\.is-on\{color:#1c1c1e\}/, 'on, dark theme: the dark ink on the light accent');
});
