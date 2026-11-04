import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normaliseConfig, defaultConfig } from '../src/model/config.ts';
import { cameraGo2rtcSpec, activeSpecs } from '../src/modules/catalog.ts';
import { acceptMime, addonFromEntity, ingressPath, pickStream, validSession } from '../src/modules/go2rtc-protocol.ts';
const fixturePath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry.json');
const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

test('go2rtc protocol helpers accept only the documented shapes', () => {
  assert.equal(addonFromEntity('camera.a889bffc_go2rtc'), 'a889bffc_go2rtc');
  assert.equal(addonFromEntity('camera.front_door'), null);
  assert.equal(ingressPath({ slug: 'a889bffc_go2rtc', ingress: true, ingress_url: '/api/hassio_ingress/AbC-123' }, 'a889bffc_go2rtc'), '/api/hassio_ingress/AbC-123/');
  assert.equal(ingressPath({ slug: 'other', ingress: true, ingress_url: '/api/hassio_ingress/x' }, 'a889bffc_go2rtc'), null);
  assert.equal(ingressPath({ slug: 'a889bffc_go2rtc', ingress: true, ingress_url: 'https://evil/api/hassio_ingress/x' }, 'a889bffc_go2rtc'), null);
  assert.ok(validSession('abcdefghijklmnop1234')); assert.ok(!validSession('short')); assert.ok(!validSession('has space ' + 'x'.repeat(20)));
  const yes = () => true;
  assert.equal(acceptMime('video/mp4; codecs="avc1.64001f"', yes), 'video/mp4; codecs="avc1.64001f"');
  assert.equal(acceptMime('video/mp4; codecs="hvc1.1.6.L153.B0,opus"', yes), 'video/mp4; codecs="hvc1.1.6.L153.B0,opus"');
  assert.equal(acceptMime('video/mp4; codecs="avc1.64001f,evil"', yes), null);
  assert.equal(acceptMime('video/webm; codecs="vp9"', yes), null);
  assert.equal(acceptMime('video/mp4; codecs="avc1.64001f"', () => false), null, 'browser support decides');
  assert.equal(pickStream(['cam_hd', 'cam_h264'], undefined), 'cam_h264');
  assert.equal(pickStream(['cam_hd'], 'mine'), 'mine');
  assert.equal(pickStream(['bad name!'], undefined), null);
});

test('module options are normalised and merged', () => {
  const { config } = normaliseConfig({ schemaVersion: 1, modules: { camera_go2rtc: { options: { stream: 'cam_h264', streamHd: 'cam', 'bad key': 'x', evil: 'a b', long: 'x'.repeat(65) } } } });
  assert.deepEqual(config.modules.camera_go2rtc, { options: { stream: 'cam_h264', streamHd: 'cam' } });
});

test('go2rtc camera detected in the Criuleni snapshot; options from config win', { skip: !fixture }, () => {
  const match = cameraGo2rtcSpec.detect(fixture!); assert.ok(match);
  assert.equal(match!.entities.camera, 'camera.a889bffc_go2rtc'); assert.equal(match!.options?.addon, 'a889bffc_go2rtc');
  const cfg = defaultConfig(); cfg.modules.camera_go2rtc = { options: { stream: 'criuleni_c700_h264', streamHd: 'criuleni_c700' } };
  const active = activeSpecs(fixture!, cfg).find(a => a.spec.id === 'camera_go2rtc'); assert.ok(active);
  assert.deepEqual(active!.options, { addon: 'a889bffc_go2rtc', stream: 'criuleni_c700_h264', streamHd: 'criuleni_c700' });
  const off = defaultConfig(); off.modules.camera_go2rtc = { enabled: false }; assert.ok(!activeSpecs(fixture!, off).some(a => a.spec.id === 'camera_go2rtc'));
  const noAddon = defaultConfig(); noAddon.modules.camera_go2rtc = { entities: { camera: 'camera.chuangmi_081ae2_fdd3_camera_control' } };
  assert.ok(activeSpecs(fixture!, noAddon).some(a => a.spec.id === 'camera_go2rtc'), 'detected add-on slug still applies when only the camera is overridden');
});

import { cameraClaims, cameraTileState, sdStatusLabel } from '../src/modules/camera-state.ts';
import { discover } from '../src/model/discover.ts';
import { translator } from '../src/i18n/index.ts';
const camPath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-camera-20261104.json');
const cam = existsSync(camPath) ? JSON.parse(readFileSync(camPath, 'utf8')) : null;

test('C700: functions are matched to roles, claimed by the card and gone from «Systems»', { skip: !cam }, () => {
  const match = cameraGo2rtcSpec.detect(cam!); assert.ok(match);
  assert.equal(match!.entities.camera, undefined, 'no Supervisor-named go2rtc camera in this snapshot: the camera comes from the config');
  assert.equal(match!.entities.power, 'switch.entrance_camera_power'); assert.equal(match!.entities.night, 'select.entrance_camera_night_mode'); assert.equal(match!.entities.indicator, 'light.entrance_camera_indicator');
  assert.equal(match!.entities.mute, 'switch.entrance_camera_mute'); assert.equal(match!.entities.volume, 'number.entrance_camera_volume'); assert.equal(match!.entities.info, 'button.entrance_camera_info');
  assert.equal(Object.keys(match!.entities).length, 29, 'all 29 control roles of the C700');
  const cfg = defaultConfig(); cfg.modules.camera_go2rtc = { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264', streamHd: 'entrance_camera_hd' } };
  const active = activeSpecs(cam!, cfg).find(a => a.spec.id === 'camera_go2rtc'); assert.ok(active); assert.equal(active!.entities.camera, 'camera.entrance_camera');
  const claimed = new Set(cameraClaims(active!.entities)); assert.equal(claimed.size, 29); assert.ok(claimed.has('switch.entrance_camera_ai_face'));
  const before = discover(cam!, cfg), after = discover(cam!, cfg, claimed);
  assert.ok(before.devices.some(d => d.key === 'e:switch.entrance_camera_power'), 'without the claim the switch is a card');
  assert.ok(after.devices.some(d => d.key === 'e:camera.entrance_camera'), 'the camera card stays');
  assert.ok(!after.devices.some(d => d.key === 'e:switch.entrance_camera_power' || d.key === 'e:switch.entrance_camera_ai_face' || d.key === 'e:light.entrance_camera_indicator' || d.key.startsWith('d:9ae05aa2')), 'its functions are no longer cards of their own');
  assert.ok(after.devices.some(d => d.key === 'e:camera.entrance_doorbell'), 'the doorbell is untouched');
  const t = translator('ru'), tx = (k: string) => t(k as never);
  assert.deepEqual(cameraTileState(cam!.states, active!.entities, tx), { line: 'Слежение за человеком', closed: false, icon: 'motion' });
  const states = { ...cam!.states, 'switch.entrance_camera_power': { ...cam!.states['switch.entrance_camera_power'], state: 'off' } };
  assert.deepEqual(cameraTileState(states, active!.entities, tx), { line: 'Объектив закрыт', closed: true, icon: null });
  assert.equal(sdStatusLabel('non existent', tx), 'Нет карты'); assert.equal(sdStatusLabel('normal', tx), 'Работает'); assert.equal(sdStatusLabel('broken', tx), 'Проблема с картой');
});
