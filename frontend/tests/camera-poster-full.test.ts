// Owner, 23.11.2026: (1) on opening the panel a camera shows its last frame and nothing is written over it while the stream connects;
// (2) a camera opened from the list has «Во весь экран» whichever sheet it opens in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { posterQuiet } from '../src/modules/camera-state.ts';
const src = (p: string) => readFileSync(resolve(import.meta.dirname, '../src', p), 'utf8');

test('over the last frame a connecting stream says nothing; without a frame, or when something is wrong, it speaks', () => {
  for (const status of ['idle', 'connecting', 'loading', 'paused']) assert.equal(posterQuiet(true, status, false, false), true, status);
  assert.equal(posterQuiet(false, 'connecting', false, false), false, 'no frame: «Подключаем видео…»');
  assert.equal(posterQuiet(true, 'error', false, false), false, 'the stream failed');
  assert.equal(posterQuiet(true, 'stalled', false, false), false, 'the stream stalled');
  assert.equal(posterQuiet(true, 'connecting', true, false), false, 'slow: «Нет связи с камерой» and «Повторить»');
  assert.equal(posterQuiet(true, 'connecting', false, true), false, 'the camera is away');
});

test('the player draws no words while it is quiet, and the chip carries the frame\'s time', () => {
  const view = src('modules/go2rtc-view.tsx');
  assert.match(view, /status !== 'paused' && !quiet && <div className=\{`hm-camera-wait/);
  assert.match(view, /quiet && frameTime \? frameTime : t\('state\.idle'\)/);
});

test('the common camera sheet has «Во весь экран» on its stage', () => {
  const sheet = src('ui/sheet.tsx');
  assert.match(sheet, /at-camera-stage" ref=\{stageRef\}>\{stage\}<\/div><div className="at-cam-tools"><button type="button" className="at-cam-tool at-cam-full" onClick=\{fullscreen\}>/);
  assert.match(src('styles/atom.css'), /:is\(\.at-cam-stage,\.at-camera-stage\):fullscreen\{background:#000\}/);
});

test('a closed camera and the air fryer that is off are not «без связи» on the status strip', async () => {
  const { houseStatus } = await import('../src/model/house-status.ts');
  const { translator } = await import('../src/i18n/index.ts');
  const dev = (key: string, kind: string) => ({ key, kind, name: key, roomId: 'r', primary: { id: key.slice(2), available: false, state: 'unavailable', domain: key.slice(2).split('.')[0] }, controls: [], metrics: [], parameters: [], diagnostics: [] }) as never;
  const base = { online: true, security: null, heating: null, vacuum: null, devices: [dev('e:camera.c700', 'camera'), dev('e:switch.fryer_keep_warm', 'switch')], nameOf: (d: { key: string }) => d.key, roomName: () => 'Комната' };
  const t = translator('ru');
  assert.deepEqual(houseStatus(base as never, t).items.map(i => [i.kind, i.count]), [['nolink', 2]]);
  assert.deepEqual(houseStatus({ ...base, resting: () => true } as never, t).items, []);
  assert.deepEqual(houseStatus({ ...base, resting: (d: { key: string }) => d.key === 'e:camera.c700' } as never, t).items.map(i => i.kind), ['nolink']);
});
