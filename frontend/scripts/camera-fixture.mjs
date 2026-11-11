// The house's four camera views as they are since 08.11.2026, on top of the 28.10 registry snapshot: Xiaomi C700 (go2rtc), Aqara G4 (RTSP from the
// repeater, events over HomeKit), Sonoff CAM-C44HE (ONVIF: two 360p profiles, person / pet / vehicle / motion; two HD generic cameras).
// Frames: private/camera-frames/<stream or entity>.jpg recorded from go2rtc on 09.11.2026 (not committed), served by the preview at /frames/.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const camFx = JSON.parse(readFileSync(resolve(root, '../private/fixtures/criuleni-camera-20261104.json'), 'utf8'));
export const FRAMES = resolve(root, '../private/camera-frames');
const st = (state, attributes = {}, lastChanged = '') => ({ state, attributes, last_changed: lastChanged, last_updated: lastChanged });
const ent = (entity_id, device_id, platform, extra = {}) => ({ entity_id, device_id, area_id: null, name: null, original_name: null, platform, entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class: null, ...extra });
export const SONOFF = { ptz: 'camera.cam_c44he_ptz_hd', fixed: 'camera.cam_c44he_fixed_hd', sd0: 'camera.cam_c44he_profile_0', sd1: 'camera.cam_c44he_profile_1', person: 'binary_sensor.cam_c44he_person_detection', pet: 'binary_sensor.cam_c44he_pet_detection', vehicle: 'binary_sensor.cam_c44he_vehicle_detection', motion: 'binary_sensor.cam_c44he_motion_alarm', cell: 'binary_sensor.cam_c44he_cell_motion_detection' };
/** `s`: per-entity overrides { id: [state, lastChangedIso] }; `off`: entity ids that are unavailable. */
export function addCameras(base, s = {}, off = []) {
  const fx = JSON.parse(JSON.stringify(base));
  // the 28.10 snapshot still has the go2rtc add-on's own camera and the old MIoT camera: not cameras of the house
  const drop = new Set(fx.entities.filter(e => e.entity_id.startsWith('camera.') && e.platform !== 'yandex_station').map(e => e.entity_id));
  fx.entities = fx.entities.filter(e => !drop.has(e.entity_id)); for (const id of drop) delete fx.states[id];
  for (const d of camFx.devices) if (!fx.devices.some(x => x.id === d.id)) fx.devices.push(d);
  for (const e of camFx.entities) if (!fx.entities.some(x => x.entity_id === e.entity_id)) fx.entities.push(e);
  Object.assign(fx.states, JSON.parse(JSON.stringify(camFx.states)));
  if (!fx.areas.some(a => a.area_id === 'podezd')) fx.areas.push(camFx.areas[0]);
  // the C700 moved to the office on 09.11.2026 (owner): «Компьютерная · Камера», its events are no longer the doorbell's
  for (const d of fx.devices) if (d.id === '9ae05aa213396d73fa792869ef13ffbc') Object.assign(d, { name: 'Компьютерная · Камера (Xiaomi C700)', area_id: 'kompiuternaia' }); else if (d.id === '06b10d1c8f21dd69f1f6359052142260') Object.assign(d, { name: 'Компьютерная · Камера', area_id: 'kompiuternaia' });
  fx.states['camera.entrance_camera'] = { ...fx.states['camera.entrance_camera'], attributes: { ...fx.states['camera.entrance_camera'].attributes, friendly_name: 'Компьютерная · Камера (C700)' } };
  const dev = (id, name, model, manufacturer) => fx.devices.push({ id, name, model, manufacturer, area_id: 'podezd', entry_type: null, disabled_by: null, via_device_id: null });
  // G4: the generic camera on the go2rtc stream (stage 2 of the doorbell) and the mains power: no battery card
  dev('g4-video', 'Подъезд · Звонок (видео)', null, 'Generic');
  fx.entities.push(ent('camera.entrance_doorbell_video', 'g4-video', 'generic'));
  fx.states['camera.entrance_doorbell_video'] = st('idle', { friendly_name: 'Звонок (видео)', entity_picture: '/api/camera_proxy/camera.entrance_doorbell_video?token=x' });
  dev('g4-fast', 'Подъезд · Звонок, быстрый поток', null, 'Generic');
  fx.entities.push(ent('camera.entrance_doorbell_fast', 'g4-fast', 'generic'));
  fx.states['camera.entrance_doorbell_fast'] = st('idle', { friendly_name: 'Подъезд · Звонок, быстрый поток (720p)', entity_picture: '/api/camera_proxy/camera.entrance_doorbell_fast?token=x' });
  const bat = fx.entities.find(e => e.entity_id === 'sensor.entrance_doorbell_battery'); if (bat) bat.hidden_by = 'user';
  // Sonoff: names as proposed for the owner (the HA names are the model's for now, book/03-devices/sonoff-cam-c44he.md)
  dev('c44he-onvif', 'Подъезд · Sonoff CAM-C44HE (ONVIF)', 'CAM-C44HE', 'SONOFF');
  dev('c44he-ptz', 'Подъезд · Лестница вниз', null, 'Generic'); dev('c44he-fixed', 'Подъезд · Лестница вверх', null, 'Generic');
  fx.entities.push(ent(SONOFF.ptz, 'c44he-ptz', 'generic'), ent(SONOFF.fixed, 'c44he-fixed', 'generic'), ent(SONOFF.sd0, 'c44he-onvif', 'onvif'), ent(SONOFF.sd1, 'c44he-onvif', 'onvif'));
  fx.states[SONOFF.ptz] = st('idle', { friendly_name: 'Лестница вниз', entity_picture: `/api/camera_proxy/${SONOFF.ptz}?token=x` });
  fx.states[SONOFF.fixed] = st('idle', { friendly_name: 'Лестница вверх', entity_picture: `/api/camera_proxy/${SONOFF.fixed}?token=x` });
  fx.states[SONOFF.sd0] = st('idle', { friendly_name: 'CAM-C44HE Profile_0' }); fx.states[SONOFF.sd1] = st('idle', { friendly_name: 'CAM-C44HE Profile_1' });
  const old = new Date(Date.now() - 3 * 3600_000).toISOString();
  for (const [k, cls] of [['person', 'occupancy'], ['pet', 'occupancy'], ['vehicle', 'occupancy'], ['motion', 'motion'], ['cell', 'motion']]) { fx.entities.push(ent(SONOFF[k], 'c44he-onvif', 'onvif', { device_class: cls })); fx.states[SONOFF[k]] = st('off', { device_class: cls, friendly_name: SONOFF[k] }, old); }
  for (const b of ['button.cam_c44he_reboot', 'button.cam_c44he_set_system_date_and_time']) { fx.entities.push(ent(b, 'c44he-onvif', 'onvif')); fx.states[b] = st('unknown', {}); }
  fx.states['binary_sensor.entrance_doorbell_motion'] = { ...fx.states['binary_sensor.entrance_doorbell_motion'], state: 'off', last_changed: new Date(Date.now() - 40 * 60_000).toISOString() };
  fx.states['event.entrance_doorbell_ring'] = { ...fx.states['event.entrance_doorbell_ring'], state: new Date(Date.now() - 5 * 3600_000).toISOString() };
  // Imou Ranger 2C in the hall (09.11.2026): ONVIF device with the 352p profile and local events, generic HD, the cloud device with the functions
  if (!fx.areas.some(a => a.area_id === 'prikhozhaia')) fx.areas.push({ area_id: 'prikhozhaia', name: 'Прихожая', icon: null, picture: null });
  dev('imou-onvif', 'Прихожая · Камера (Imou IPC-K2EC)', 'IPC-K2EC-3R1W', 'IMOU'); for (const d of fx.devices) if (d.id === 'imou-onvif') d.area_id = 'prikhozhaia';
  dev('imou-hd', 'Прихожая · Камера (HD)', null, 'Generic'); dev('imou-cloud', 'Прихожая · Камера Imou Ranger 2C (облако)', 'IPC-K2EC-R1W', 'Imou'); for (const d of fx.devices) if (d.id === 'imou-hd' || d.id === 'imou-cloud') d.area_id = 'prikhozhaia';
  const imou = (id, devId, platform, state, attrs = {}, extra = {}) => { fx.entities.push(ent(id, devId, platform, extra)); fx.states[id] = st(state, { friendly_name: id, ...attrs }, old); };
  imou('camera.hall_camera_sd', 'imou-onvif', 'onvif', 'idle', { friendly_name: 'Прихожая · Камера (Imou IPC-K2EC) (352p)', entity_picture: '/api/camera_proxy/camera.hall_camera_sd?token=x' });
  imou('camera.hall_camera_hd', 'imou-hd', 'generic', 'idle', { friendly_name: 'Прихожая · Камера (HD)' });
  imou('binary_sensor.hall_camera_motion', 'imou-onvif', 'onvif', 'off', { device_class: 'motion' }, { device_class: 'motion' }); imou('binary_sensor.hall_camera_scene_change', 'imou-onvif', 'onvif', 'off');
  imou('switch.hall_camera_ir', 'imou-onvif', 'onvif', 'unknown'); for (const b of ['reboot', 'sync_time']) imou(`button.hall_camera_${b}`, 'imou-onvif', 'onvif', 'unknown', {}, { entity_category: 'config' });
  for (const d of ['up', 'down', 'left', 'right']) imou(`button.hall_camera_ptz_${d}`, 'imou-cloud', 'imou', 'unknown');
  imou('select.hall_camera_preset', 'imou-cloud', 'imou', 'select_collection_point', { options: ['select_collection_point'] }); imou('sensor.hall_camera_cloud_status', 'imou-cloud', 'imou', 'online', {}, { entity_category: 'diagnostic' }); imou('siren.hall_camera_siren', 'imou-cloud', 'imou', 'unknown');
  for (const [k, v] of [['privacy', 'off'], ['smart_tracking', 'off'], ['motion_detection', 'on'], ['human_detection', 'on'], ['pet_detection', 'off'], ['wdr', 'on'], ['flip', 'off'], ['indicator', 'on'], ['prompt_sound', 'on'], ['audio_recording', 'on'], ['alarm_siren', 'off']]) imou(`switch.hall_camera_${k}`, 'imou-cloud', 'imou', v, {}, k === 'privacy' || k === 'smart_tracking' ? {} : { entity_category: 'config' });
  for (const [id, [state, at]] of Object.entries(s)) fx.states[id] = { ...fx.states[id], state, last_changed: at ?? fx.states[id]?.last_changed ?? '' };
  for (const id of off) fx.states[id] = { ...fx.states[id], state: 'unavailable' };
  return fx;
}
/** Recorded frames by the names the players ask for (go2rtc stream or HA entity). The G4 gave none on 09.11 (its RTSP lacks SPS/PPS). */
export function frames() {
  const map = { entrance_camera_h264: 'entrance_camera_hd.jpg', 'camera.entrance_camera': 'entrance_camera_hd.jpg', [SONOFF.sd0]: 'camera.cam_c44he_ptz_hd.jpg', [SONOFF.ptz]: 'camera.cam_c44he_ptz_hd.jpg', [SONOFF.sd1]: 'camera.cam_c44he_fixed_hd.jpg', [SONOFF.fixed]: 'camera.cam_c44he_fixed_hd.jpg', entrance_doorbell: 'entrance_doorbell.jpg', entrance_doorbell_720: 'entrance_doorbell.jpg', 'camera.entrance_doorbell_fast': 'entrance_doorbell.jpg', 'camera.entrance_doorbell': 'entrance_doorbell.jpg', 'camera.entrance_doorbell_video': 'entrance_doorbell.jpg', 'camera.hall_camera_sd': 'hall_camera_sd.jpg', 'camera.hall_camera_hd': 'hall_camera_sd.jpg' };
  // a camera with no recorded frame (the hall's Imou) plays the preview server's drawn stand-in for its HA still: in the preview every camera that is «on» has a picture
  return Object.fromEntries(Object.entries(map).map(([k, f]) => [k, existsSync(resolve(FRAMES, f)) ? `/frames/${f}` : k.startsWith('camera.hall_camera') ? '/api/camera_proxy/camera.hall_camera_sd?token=x' : null]).filter(([, f]) => f));
}
/** A day of rings and detections in HA's minimal history format, so the panel's list has something to read. */
export function history(now) {
  const at = mins => (now - mins * 60_000) / 1000, on = (id, ...mm) => mm.flatMap(m => [{ s: 'on', lc: at(m) }, { s: 'off', lc: at(m - 0.5) }]);
  return {
    'event.entrance_doorbell_ring': [{ s: new Date(now - 300 * 60_000).toISOString(), lc: at(300) }, { s: new Date(now - 1180 * 60_000).toISOString(), lc: at(1180) }],
    'binary_sensor.entrance_doorbell_motion': on('m', 40, 302, 610, 900, 1185),
    [SONOFF.person]: on('p', 41, 303, 611, 1186),
    [SONOFF.motion]: on('m', 41, 95, 303, 470, 611, 1186, 1300),
    [SONOFF.cell]: on('c', 41, 95),
    [SONOFF.pet]: on('pet', 820),
  };
}
