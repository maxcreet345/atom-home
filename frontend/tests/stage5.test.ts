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
