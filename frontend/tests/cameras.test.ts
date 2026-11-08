import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensorKind, currentEvents, topEvent, focusCamera, historyEvents, ago, RECENT_MS } from '../src/model/cameras.ts';
const now = Date.parse('2026-11-09T12:00:00Z'), iso = (ms: number) => new Date(ms).toISOString();
test('sensor kinds: ring, ONVIF detections, motion', () => {
  assert.equal(sensorKind('event.entrance_doorbell_ring', 'doorbell'), 'ring');
  assert.equal(sensorKind('binary_sensor.cam_c44he_person_detection', 'occupancy'), 'person');
  assert.equal(sensorKind('binary_sensor.cam_c44he_vehicle_detection'), 'vehicle');
  assert.equal(sensorKind('binary_sensor.cam_c44he_pet_detection'), 'pet');
  assert.equal(sensorKind('binary_sensor.cam_c44he_cell_motion_detection'), 'motion');
  assert.equal(sensorKind('binary_sensor.entrance_doorbell_motion', 'motion'), 'motion');
  assert.equal(sensorKind('switch.entrance_camera_ai_human'), null);
});
test('a ring outranks a person, a person outranks motion; stale events do not count', () => {
  const st = (state: string, at: number) => ({ state, attributes: {}, last_changed: iso(at), last_updated: iso(at) });
  const states = { 'event.r': st(iso(now - 30_000), now - 30_000), 'binary_sensor.p_person': st('on', now - 5000), 'binary_sensor.m_motion': st('off', now - RECENT_MS - 1000) };
  const door = currentEvents(states, 'door', [{ id: 'event.r', kind: 'ring' }]), stairs = currentEvents(states, 'stairs', [{ id: 'binary_sensor.p_person', kind: 'person' }, { id: 'binary_sensor.m_motion', kind: 'motion' }]);
  assert.equal(topEvent([...stairs, ...door], now)?.kind, 'ring');
  assert.equal(topEvent(stairs, now)?.kind, 'person');
  assert.equal(focusCamera('main', stairs, now), 'stairs');
  assert.equal(focusCamera('main', currentEvents(states, 'x', [{ id: 'binary_sensor.m_motion', kind: 'motion' }]), now), 'main');
  assert.equal(focusCamera('main', currentEvents({ 'event.r': st(iso(now - 10 * 60_000), now) }, 'door', [{ id: 'event.r', kind: 'ring' }]), now), 'main');
});
test('history: one event per turn-on, twin ONVIF motion sensors merged, ring by state change', () => {
  const s = (ms: number) => (now - ms) / 1000;
  const raw = { 'binary_sensor.a_motion_alarm': [{ s: 'on', lc: s(60_000) }, { s: 'off', lc: s(50_000) }], 'binary_sensor.a_cell_motion': [{ s: 'on', lc: s(58_000) }], 'event.r': [{ s: 'x1', lc: s(9e7) }, { s: 'x2', lc: s(3600_000) }, { s: 'unavailable', lc: s(1000) }] };
  const ev = historyEvents(raw, [{ id: 'binary_sensor.a_motion_alarm', kind: 'motion', camera: 'a' }, { id: 'binary_sensor.a_cell_motion', kind: 'motion', camera: 'a' }, { id: 'event.r', kind: 'ring', camera: 'd' }], now - 86_400_000);
  assert.deepEqual(ev.map(e => `${e.camera}:${e.kind}`), ['a:motion', 'd:ring']);
});
test('ago', () => { assert.deepEqual(ago(now - 20_000, now), { n: 0, unit: 'now' }); assert.deepEqual(ago(now - 5 * 60_000, now), { n: 5, unit: 'min' }); assert.deepEqual(ago(now - 3 * 3600_000, now), { n: 3, unit: 'h' }); });
