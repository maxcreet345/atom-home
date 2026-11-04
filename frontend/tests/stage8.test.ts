import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultConfig } from '../src/model/config.ts';
import { doorbellSpec, activeSpecs } from '../src/modules/catalog.ts';
import { doorbellClaims, doorbellTileState, autoOpenSeconds, parseHistory, when, ago, parseMediaDay, mergeEvents, dayFolders, mediaRoot } from '../src/modules/doorbell-state.ts';
import { discover } from '../src/model/discover.ts';
import { translator } from '../src/i18n/index.ts';
const camPath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-camera-20261104.json');
const cam = existsSync(camPath) ? JSON.parse(readFileSync(camPath, 'utf8')) : null;
const t = translator('ru'), tx = (k: string, p?: Record<string, string | number>) => t(k as never, p);

test('G4: the doorbell is detected by its ring event, its functions claimed by the card', { skip: !cam }, () => {
  const match = doorbellSpec.detect(cam!); assert.ok(match);
  assert.equal(match!.entities.camera, 'camera.entrance_doorbell'); assert.equal(match!.entities.ring, 'event.entrance_doorbell_ring'); assert.equal(match!.entities.motion, 'binary_sensor.entrance_doorbell_motion');
  assert.equal(match!.entities.battery, 'sensor.entrance_doorbell_battery'); assert.equal(match!.entities.chime, 'switch.entrance_doorbell_chime_mute'); assert.equal(match!.entities.identify, 'button.entrance_doorbell_identify');
  assert.equal(match!.options?.stream, 'entrance_doorbell', 'stream named after the camera'); assert.equal(match!.label, 'Подъезд · Видеозвонок (Aqara G4)');
  const cfg = defaultConfig(); cfg.modules.doorbell = { options: { addon: 'a889bffc_go2rtc' } };
  const active = activeSpecs(cam!, cfg).find(a => a.spec.id === 'doorbell'); assert.ok(active, 'active once the add-on is known'); assert.equal(active!.options.stream, 'entrance_doorbell');
  assert.ok(!activeSpecs(cam!, defaultConfig()).some(a => a.spec.id === 'doorbell'), 'without an add-on slug the module stays off');
  const claimed = new Set(doorbellClaims(active!.entities)); assert.equal(claimed.size, 7, 'the snapshot predates the recording camera and the switches');
  assert.ok(doorbellClaims({ ...active!.entities, video: 'camera.entrance_doorbell_video', notifyPhones: 'input_boolean.doorbell_notify_phones' }).includes('camera.entrance_doorbell_video'), 'the recording camera is not a tile of its own');
  const before = discover(cam!, cfg), after = discover(cam!, cfg, claimed);
  const idsOf = (h: typeof before) => new Set(h.devices.flatMap(d => [d.primary, ...d.controls, ...d.metrics, ...d.parameters, ...d.diagnostics].map(e => e.id)));
  assert.ok(idsOf(before).has('switch.entrance_doorbell_chime_mute')); assert.ok(!idsOf(after).has('switch.entrance_doorbell_chime_mute'), 'mute switches live in the sheet, not as cards');
  assert.ok(after.devices.some(d => d.primary.id === 'camera.entrance_doorbell'), 'the camera itself stays a card');
});

test('G4: tile line — ring in the last minute, motion, low battery, quiet', { skip: !cam }, () => {
  const e = doorbellSpec.detect(cam!)!.entities, base = cam!.states as Record<string, { state: string; attributes: Record<string, unknown>; last_changed: string; last_updated: string }>;
  const at = (iso: string) => Date.parse(iso);
  const ringIso = base['event.entrance_doorbell_ring'].state, now = at(ringIso) + 30_000;
  const s1 = doorbellTileState(base, e, tx, 'ru', now); assert.equal(s1.tone, 'danger'); assert.equal(s1.icon, 'bell'); assert.match(s1.line!, /^Звонок · \d\d:\d\d$/);
  const later = at(ringIso) + 10 * 60_000;
  const quiet = doorbellTileState(base, e, tx, 'ru', later); assert.equal(quiet.tone, undefined); assert.match(quiet.line!, /^Тихо/);
  const moving = { ...base, 'binary_sensor.entrance_doorbell_motion': { ...base['binary_sensor.entrance_doorbell_motion'], state: 'on' } };
  assert.equal(doorbellTileState(moving, e, tx, 'ru', later).line, 'Движение у двери');
  const low = { ...base, 'sensor.entrance_doorbell_battery': { ...base['sensor.entrance_doorbell_battery'], state: '15' } };
  const l = doorbellTileState(low, e, tx, 'ru', later); assert.equal(l.tone, 'warning'); assert.equal(l.line, 'Батарея 15 % · зарядить');
});

test('G4: auto-open seconds, logbook rows, relative time', () => {
  assert.equal(autoOpenSeconds({}), 60); assert.equal(autoOpenSeconds({ autoOpen: 'off' }), 0); assert.equal(autoOpenSeconds({ autoOpenSec: '120' }), 120); assert.equal(autoOpenSeconds({ autoOpenSec: '7' }), 60);
  const e = { ring: 'event.x_ring', motion: 'binary_sensor.x_motion' };
  const raw = { 'event.x_ring': [{ s: '2026-11-01T10:00:00+00:00', lc: 500 }, { s: '2026-11-03T19:27:56+00:00', lc: 1000 }, { s: '2026-11-03T19:27:56+00:00', lu: 1200 }, { s: 'unknown', lc: 3000 }], 'binary_sensor.x_motion': [{ s: 'off', lc: 500 }, { s: 'on', lc: 2000 }, { s: 'off', lc: 2100 }, { s: 'on', lu: 2500 }] };
  assert.deepEqual(parseHistory(raw, e, 900_000), [{ kind: 'motion', at: 2_500_000 }, { kind: 'motion', at: 2_000_000 }, { kind: 'ring', at: 1_000_000 }], 'the opening row and repeated timestamps are not events');
  assert.deepEqual(parseHistory(null, e, 0), []); assert.deepEqual(parseHistory([], e, 0), []);
  const now = Date.parse('2026-11-04T10:52:00+02:00');
  assert.equal(ago(now - 30_000, now, tx, 'ru'), 'только что'); assert.equal(ago(now - 5 * 60_000, now, tx, 'ru'), '5 мин назад'); assert.equal(ago(now - 3 * 3_600_000, now, tx, 'ru'), '3 ч назад');
  assert.match(when(now - 60_000, now, tx, 'ru'), /^\d\d:\d\d$/); assert.match(when(now - 86_400_000, now, tx, 'ru'), /^вчера \d\d:\d\d$/);
});

test('G4 stage 2: saved files are parsed and matched to recorder events', () => {
  const day = '2026-11-04', ch = [{ title: '12-11-05_ring.jpg', media_content_id: 'media-source://media_source/local/doorbell/2026-11-04/12-11-05_ring.jpg' }, { title: '12-11-05_ring.mp4', media_content_id: 'm:ring.mp4' }, { title: '12-30-00_motion.jpg', media_content_id: 'm:motion.jpg' }, { title: 'last_ring.jpg', media_content_id: 'm:last' }, { title: 'notes.txt', media_content_id: 'm:txt' }];
  const files = parseMediaDay(day, ch); assert.equal(files.length, 3); assert.equal(files[0].kind, 'motion'); assert.equal(files[2].type, 'mp4');
  assert.deepEqual(parseMediaDay('bad', ch), []); assert.deepEqual(parseMediaDay(day, null), []);
  const ringAt = new Date(2026, 10, 4, 12, 11, 3).getTime(), motionAt = new Date(2026, 10, 4, 12, 29, 58).getTime();
  const merged = mergeEvents([{ kind: 'ring', at: ringAt }, { kind: 'motion', at: motionAt }, { kind: 'motion', at: motionAt - 3_600_000 }], files);
  assert.equal(merged.length, 3, 'files within 10 s join their events; no orphans');
  const ring = merged.find(e => e.kind === 'ring')!; assert.ok(ring.snapshot?.endsWith('12-11-05_ring.jpg')); assert.equal(ring.clip, 'm:ring.mp4');
  const motion = merged.find(e => e.at === motionAt)!; assert.equal(motion.snapshot, 'm:motion.jpg'); assert.equal(motion.clip, undefined);
  const orphan = mergeEvents([], files); assert.equal(orphan.length, 2, 'files without events become events'); assert.equal(orphan[1].clip, 'm:ring.mp4');
  assert.equal(dayFolders(Date.parse('2026-11-04T12:00:00'), 3).join(','), '2026-11-04,2026-11-03,2026-11-02');
  assert.equal(mediaRoot('doorbell'), 'media-source://media_source/local/doorbell');
});
