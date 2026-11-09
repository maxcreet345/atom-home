import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import type { ModuleEntities, ModuleMatch, ModuleOptionField, ModuleOptions } from './types.ts';
import { addonFromEntity } from './go2rtc-protocol.ts';
/** Plain-TypeScript part of every module (no UI), so detection is testable under Node. */
export interface ModuleSpec { id: string; titleKey: string; roles: Array<{ role: string; labelKey: string; required: boolean }>; options?: ModuleOptionField[]; placement: Array<'climate' | 'overview' | 'systems' | 'room'>; detect(registry: Registry): ModuleMatch | null }
const find = (reg: Registry, re: RegExp) => reg.entities.find(e => re.test(e.entity_id) && reg.states[e.entity_id] && reg.states[e.entity_id].state !== 'unavailable')?.entity_id;
export const boilerEbusSpec: ModuleSpec = {
  id: 'boiler_ebus', titleKey: 'module.boiler_ebus', placement: ['climate', 'overview'],
  roles: [
    { role: 'flow', labelKey: 'module.boiler.flow', required: true }, { role: 'return', labelKey: 'module.boiler.return', required: false },
    { role: 'pressure', labelKey: 'module.boiler.pressure', required: true }, { role: 'flame', labelKey: 'module.boiler.flame', required: false },
    { role: 'hwc', labelKey: 'module.boiler.hwc', required: false }, { role: 'flowSet', labelKey: 'module.boiler.flowSet', required: false }, { role: 'hwcSet', labelKey: 'module.boiler.hwcSet', required: false },
  ],
  detect(reg) {
    const flow = find(reg, /ebusd?.*flowtemp|flow_temp|flowtemp_temp/i), pressure = find(reg, /ebusd?.*(waterpressure|pressure_press|water_pressure)/i);
    if (!flow || !pressure) return null;
    const dev = reg.devices.find(d => d.id === reg.entities.find(e => e.entity_id === flow)?.device_id);
    return { label: dev?.name ?? 'eBUS', entities: { flow, pressure, return: find(reg, /ebusd?.*returntemp/i), flame: find(reg, /ebusd?.*flame$/i), hwc: find(reg, /ebusd?.*hwctemp_temp$/i), flowSet: find(reg, /number\..*(podachi|flow).*ustanovka|number\..*flow_temp/i), hwcSet: find(reg, /number\..*(gvs|hwc).*ustanovka|number\..*hwc_temp/i) } };
  },
};
/** Functions of a Xiaomi MIoT camera (hass-xiaomi-miot + the owner's template helpers) that the camera sheet draws; matched by entity suffix inside the camera's HA device. */
export const CAMERA_CONTROL_ROLES: ReadonlyArray<{ role: string; domain: string; suffix: RegExp }> = [
  { role: 'power', domain: 'switch', suffix: /_power$/ }, { role: 'night', domain: 'select', suffix: /_night_mode$/ }, { role: 'hdr', domain: 'select', suffix: /_hdr$/ },
  { role: 'tracking', domain: 'switch', suffix: /_human_tracking$/ }, { role: 'petTracking', domain: 'switch', suffix: /_pet_tracking$/ }, { role: 'cruise', domain: 'switch', suffix: /_cruise$/ },
  { role: 'motion', domain: 'switch', suffix: /_motion_detection$/ }, { role: 'motionSens', domain: 'select', suffix: /_motion_sensitivity$/ }, { role: 'alarmInterval', domain: 'number', suffix: /_alarm_interval$/ },
  { role: 'aiHuman', domain: 'switch', suffix: /_ai_human$/ }, { role: 'aiMotion', domain: 'switch', suffix: /_ai_motion$/ }, { role: 'moveSens', domain: 'select', suffix: /_move_sensitivity$/ },
  { role: 'aiPet', domain: 'switch', suffix: /_ai_pet$/ }, { role: 'aiFace', domain: 'switch', suffix: /_ai_face$/ }, { role: 'aiBabycry', domain: 'switch', suffix: /_ai_babycry$/ }, { role: 'aiSound', domain: 'switch', suffix: /_ai_sound$/ }, { role: 'soundSens', domain: 'select', suffix: /_sound_sensitivity$/ },
  { role: 'volume', domain: 'number', suffix: /_volume$/ }, { role: 'mute', domain: 'switch', suffix: /_mute$/ },
  { role: 'watermark', domain: 'switch', suffix: /_watermark$/ }, { role: 'distortion', domain: 'switch', suffix: /_distortion$/ }, { role: 'rotation', domain: 'number', suffix: /_rotation$/ }, { role: 'colorNight', domain: 'switch', suffix: /_color_night$/ }, { role: 'indicator', domain: 'light', suffix: /_indicator$/ },
  { role: 'recording', domain: 'select', suffix: /_recording_mode$/ }, { role: 'sdStatus', domain: 'sensor', suffix: /_sd_status$/ }, { role: 'sdFree', domain: 'sensor', suffix: /_sd_free$/ }, { role: 'sdUsed', domain: 'sensor', suffix: /_sd_used$/ }, { role: 'info', domain: 'button', suffix: /_info$/ },
];
/** Live video from the go2rtc add-on through its ingress (MSE). Detected by the Supervisor-named generic camera `camera.<slug>_go2rtc`; the functions come from a Xiaomi MIoT camera device (chuangmi.camera.*). */
export const cameraGo2rtcSpec: ModuleSpec = {
  id: 'camera_go2rtc', titleKey: 'module.camera_go2rtc', placement: [],
  roles: [{ role: 'camera', labelKey: 'module.camera.entity', required: true }, ...CAMERA_CONTROL_ROLES.map(r => ({ role: r.role, labelKey: `module.camera.role.${r.role}`, required: false })), { role: 'ring', labelKey: 'module.camera.role.ring', required: false }, { role: 'motionEvent', labelKey: 'module.camera.role.motionEvent', required: false }],
  options: [{ key: 'addon', labelKey: 'module.camera.addon', required: true, placeholder: 'a1b2c3d4_go2rtc' }, { key: 'stream', labelKey: 'module.camera.stream', required: false, placeholder: 'auto' }, { key: 'streamHd', labelKey: 'module.camera.streamHd', required: false }, { key: 'mediaDir', labelKey: 'module.doorbell.mediaDir', required: false, placeholder: 'camera' }],
  detect(reg) {
    const cam = reg.entities.find(e => addonFromEntity(e.entity_id) && !e.disabled_by && reg.states[e.entity_id]);
    const funcDev = reg.devices.find(d => /camera/i.test(d.model ?? '') && reg.entities.some(e => e.device_id === d.id && e.platform === 'xiaomi_miot'));
    if (!cam && !funcDev) return null;
    const entities: ModuleEntities = {};
    if (cam) entities.camera = cam.entity_id;
    if (funcDev) {
      const own = reg.entities.filter(e => e.device_id === funcDev.id && !e.disabled_by && reg.states[e.entity_id]);
      for (const r of CAMERA_CONTROL_ROLES) { const hit = own.find(e => e.entity_id.startsWith(r.domain + '.') && r.suffix.test(e.entity_id)); if (hit) entities[r.role] = hit.entity_id; }
    }
    // The entrance has one doorbell: its ring and motion events also time the camera's recordings (no motion events of its own in HA).
    const areaOf = (e: { area_id?: string | null; device_id?: string | null } | undefined) => e ? e.area_id ?? reg.devices.find(d => d.id === e.device_id)?.area_id ?? null : null;
    const ringEnt = reg.entities.find(e => e.entity_id.startsWith('event.') && !e.disabled_by && reg.states[e.entity_id]?.attributes.device_class === 'doorbell');
    // only a camera in the doorbell's own room (the C700 moved to the office on 09.11.2026: a ring at the door is not its event)
    if (ringEnt && (!cam || areaOf(cam) === areaOf(ringEnt))) { entities.ring = ringEnt.entity_id; const mot = reg.entities.find(e => e.device_id === ringEnt.device_id && e.entity_id.startsWith('binary_sensor.') && /_motion$/.test(e.entity_id) && !e.disabled_by && reg.states[e.entity_id]); if (mot) entities.motionEvent = mot.entity_id; }
    const dev = cam ? reg.devices.find(d => d.id === cam.device_id) : funcDev;
    const friendly = cam ? reg.states[cam.entity_id]?.attributes.friendly_name : undefined;
    return { label: dev?.name ?? (typeof friendly === 'string' ? friendly : 'go2rtc'), entities, options: cam ? { addon: addonFromEntity(cam.entity_id)! } : {} };
  },
};
/** Xiaomi MIOT pet feeder (hass-xiaomi-miot): `button.<prefix>pet_food_out` plus the sibling sensors/switches by the same prefix. */
export const petFeederSpec: ModuleSpec = {
  id: 'pet_feeder', titleKey: 'module.pet_feeder', placement: ['overview', 'systems'],
  roles: [
    { role: 'feed', labelKey: 'module.feeder.role.feed', required: true }, { role: 'info', labelKey: 'module.feeder.role.info', required: false },
    { role: 'bowl', labelKey: 'module.feeder.role.bowl', required: false }, { role: 'stock', labelKey: 'module.feeder.role.stock', required: false },
    { role: 'plan', labelKey: 'module.feeder.role.plan', required: false }, { role: 'outStatus', labelKey: 'module.feeder.role.outStatus', required: false },
    { role: 'desiccant', labelKey: 'module.feeder.role.desiccant', required: false },
  ],
  options: [{ key: 'portionGrams', labelKey: 'module.feeder.portionGrams', required: false, placeholder: '10' }, { key: 'maxPortions', labelKey: 'module.feeder.maxPortions', required: false, placeholder: '15' }],
  detect(reg) {
    const live = (e: { entity_id: string; disabled_by: string | null }) => !e.disabled_by && !!reg.states[e.entity_id];
    // a house may have renamed the entities (kitchen_cat_feeder_dispense): then the device's model finds the feeder and the suffixes the roles
    const byModel = reg.devices.find(d => /^xiaomi\.feeder\./.test(d.model ?? ''));
    if (byModel && !reg.entities.some(e => /_pet_food_out$/.test(e.entity_id) && live(e))) {
      const own = reg.entities.filter(e => e.device_id === byModel.id && live(e)), find = (domain: string, suffix: string) => own.find(e => e.entity_id.startsWith(`${domain}.`) && e.entity_id.endsWith(suffix))?.entity_id;
      const feedId = find('button', '_dispense');
      if (feedId) return { label: byModel.model ?? 'MIOT', entities: {
        feed: feedId, info: find('button', '_info'), plan: find('switch', '_schedule'), stock: find('sensor', '_food_level'), outStatus: find('sensor', '_dispense_status'), desiccant: find('sensor', '_desiccant_level'),
        bowl: own.map(e => e.entity_id).find(id => id.startsWith('sensor.') && Object.keys(reg.states[id].attributes).some(k => /eaten_food_measure-2-22/.test(k))),
        stuck: find('sensor', '_food_stuck'), battery: find('binary_sensor', '_battery_low'), compensate: find('switch', '_compensate'), noPile: find('switch', '_prevent_accumulation'), reminder: find('switch', '_add_meal_reminder'), lowIntake: find('switch', '_low_intake_alert'), lock: find('switch', '_child_lock'), resetDesiccant: find('button', '_reset_desiccant'), calibrate: find('button', '_calibrate'), screen: find('select', '_screen'), threshold: find('number', '_low_intake_threshold'),
        device: byModel.id, rest: own.map(e => e.entity_id).join(','),
      } };
    }
    const feed = reg.entities.find(e => /^button\.[a-z0-9_]+_pet_food_out$/.test(e.entity_id) && e.platform === 'xiaomi_miot' && live(e));
    if (!feed) return null;
    const prefix = feed.entity_id.slice('button.'.length, -'pet_food_out'.length);
    const has = (id: string) => reg.states[id] && reg.entities.some(e => e.entity_id === id && !e.disabled_by) ? id : undefined;
    const dev = reg.devices.find(d => d.id === feed.device_id);
    return { label: dev?.model ?? dev?.name ?? 'MIOT', entities: {
      feed: feed.entity_id, info: has(`button.${prefix}info`), plan: has(`switch.${prefix}schedule_state`), stock: has(`sensor.${prefix}pet_food_left_level`),
      // the gram sensor among the four `eaten_food_measure*` siblings: the one that carries the 2/22 property (bowl weight on iv2001), else the first with a unit
      bowl: reg.entities.map(e => e.entity_id).find(id => id.startsWith(`sensor.${prefix}eaten_food_measure`) && reg.states[id] && Object.keys(reg.states[id].attributes).some(k => /eaten_food_measure-2-22/.test(k))) ?? reg.entities.map(e => e.entity_id).find(id => id.startsWith(`sensor.${prefix}eaten_food_measure`) && reg.states[id]?.attributes.unit_of_measurement === 'g'),
      outStatus: has(`sensor.${prefix}food_out_status`), desiccant: has(`sensor.${prefix}desiccant_left_level`), device: feed.device_id ?? undefined,
    } };
  },
};
/** Functions of a HomeKit video doorbell (Aqara G4 through HA's HomeKit Device integration), matched by entity suffix inside the doorbell's HA device. */
export const DOORBELL_ROLES: ReadonlyArray<{ role: string; domain: string; suffix: RegExp }> = [
  { role: 'ring', domain: 'event', suffix: /_ring$/ }, { role: 'motion', domain: 'binary_sensor', suffix: /_motion$/ }, { role: 'battery', domain: 'sensor', suffix: /_battery$/ },
  { role: 'chime', domain: 'switch', suffix: /_chime_mute$/ }, { role: 'mic', domain: 'switch', suffix: /_mic_mute$/ }, { role: 'speaker', domain: 'switch', suffix: /_speaker_mute$/ }, { role: 'identify', domain: 'button', suffix: /_identify$/ },
];
/** Stage 2 helpers that live outside the doorbell's HA device: the recording camera (generic camera on the go2rtc stream) and the automation switches, matched by entity id anywhere in the registry. */
export const DOORBELL_HOUSE_ROLES: ReadonlyArray<{ role: string; pattern: RegExp }> = [
  { role: 'video', pattern: /^camera\.[a-z0-9_]*doorbell[a-z0-9_]*_video$/ }, { role: 'fast', pattern: /^camera\.[a-z0-9_]*doorbell[a-z0-9_]*_fast$/ }, { role: 'recordMotion', pattern: /^input_boolean\.doorbell_record_motion$/ },
  { role: 'notifyPhones', pattern: /^input_boolean\.doorbell_notify_phones$/ }, { role: 'notifyStation', pattern: /^input_boolean\.doorbell_notify_station$/ }, { role: 'hallLight', pattern: /^input_boolean\.doorbell_hall_light$/ },
];
/** Video doorbell: the `event.*` doorbell entity names the device, its camera is the card; live video comes from the go2rtc add-on (`hass:` source over HA's own HomeKit pairing), stream named after the camera unless configured. */
export const doorbellSpec: ModuleSpec = {
  id: 'doorbell', titleKey: 'module.doorbell', placement: [],
  roles: [{ role: 'camera', labelKey: 'module.camera.entity', required: true }, ...DOORBELL_ROLES.map(r => ({ role: r.role, labelKey: `module.doorbell.role.${r.role}`, required: false })), ...DOORBELL_HOUSE_ROLES.map(r => ({ role: r.role, labelKey: `module.doorbell.role.${r.role}`, required: false }))],
  options: [
    { key: 'addon', labelKey: 'module.camera.addon', required: true, placeholder: 'a1b2c3d4_go2rtc' }, { key: 'stream', labelKey: 'module.camera.stream', required: false, placeholder: 'auto' }, { key: 'streamHd', labelKey: 'module.camera.streamHd', required: false },
    { key: 'mediaDir', labelKey: 'module.doorbell.mediaDir', required: false, placeholder: 'doorbell' },
    { key: 'autoOpen', labelKey: 'module.doorbell.autoOpen', required: false, placeholder: 'on' }, { key: 'autoOpenSec', labelKey: 'module.doorbell.autoOpenSec', required: false, placeholder: '60' }, { key: 'poster', labelKey: 'module.doorbell.poster', required: false, placeholder: 'on' },
  ],
  detect(reg) {
    const ring = reg.entities.find(e => e.entity_id.startsWith('event.') && !e.disabled_by && reg.states[e.entity_id]?.attributes.device_class === 'doorbell' && e.device_id);
    if (!ring) return null;
    const own = reg.entities.filter(e => e.device_id === ring.device_id && !e.disabled_by && reg.states[e.entity_id]);
    const cam = own.find(e => e.entity_id.startsWith('camera.'));
    if (!cam) return null;
    const entities: ModuleEntities = { camera: cam.entity_id };
    for (const r of DOORBELL_ROLES) { const hit = own.find(e => e.entity_id.startsWith(r.domain + '.') && r.suffix.test(e.entity_id)); if (hit) entities[r.role] = hit.entity_id; }
    for (const r of DOORBELL_HOUSE_ROLES) { const hit = reg.entities.find(e => r.pattern.test(e.entity_id) && !e.disabled_by && reg.states[e.entity_id]); if (hit) entities[r.role] = hit.entity_id; }
    const dev = reg.devices.find(d => d.id === ring.device_id);
    const addonCam = reg.entities.find(e => addonFromEntity(e.entity_id) && !e.disabled_by && reg.states[e.entity_id]);
    const options: ModuleOptions = { stream: cam.entity_id.slice('camera.'.length) };
    if (addonCam) options.addon = addonFromEntity(addonCam.entity_id)!;
    return { label: dev?.name ?? 'Doorbell', entities, options };
  },
};
/** The clock tile and the «Time» sheet: the sun from `sun.sun`, three shared kitchen timers `timer.atom_1…3` with their labels in one `input_text`, the «timer done» flag, the announce/push switches, the weather for the date line. */
export const clockSpec: ModuleSpec = {
  id: 'clock', titleKey: 'module.clock', placement: [],
  roles: [{ role: 'sun', labelKey: 'module.clock.role.sun', required: true }, { role: 'weather', labelKey: 'module.clock.role.weather', required: false }, { role: 'timer1', labelKey: 'module.clock.role.timer1', required: false }, { role: 'timer2', labelKey: 'module.clock.role.timer2', required: false }, { role: 'timer3', labelKey: 'module.clock.role.timer3', required: false }, { role: 'labels', labelKey: 'module.clock.role.labels', required: false }, { role: 'done', labelKey: 'module.clock.role.done', required: false }, { role: 'announce', labelKey: 'module.clock.role.announce', required: false }, { role: 'push', labelKey: 'module.clock.role.push', required: false }, { role: 'alarmFlag', labelKey: 'module.clock.role.alarmFlag', required: false }, { role: 'alarmText', labelKey: 'module.clock.role.alarmText', required: false }],
  detect(reg) {
    if (!reg.states['sun.sun']) return null;
    const has = (id: string) => reg.states[id] && !reg.entities.some(e => e.entity_id === id && e.disabled_by) ? id : undefined;
    const weather = reg.entities.map(e => e.entity_id).find(id => id.startsWith('weather.') && reg.states[id] && reg.states[id].state !== 'unavailable');
    return { label: 'clock', entities: { sun: 'sun.sun', weather, timer1: has('timer.atom_1'), timer2: has('timer.atom_2'), timer3: has('timer.atom_3'), labels: has('input_text.atom_timer_labels'), done: has('input_boolean.timer_done'), announce: has('input_boolean.timer_announce'), push: has('input_boolean.timer_push'), alarmFlag: has('input_boolean.alarm_ringing'), alarmText: has('input_text.alarm_ringing') } };
  },
};
/** The house's air: found as soon as a room has a CO₂ or PM2.5 sensor. It reads every room by class; the one role only says that such a sensor exists. */
export const airSpec: ModuleSpec = {
  id: 'air', titleKey: 'module.air', placement: ['overview'], roles: [{ role: 'sensor', labelKey: 'module.air.role.sensor', required: true }],
  detect(reg) { const e = reg.entities.find(x => !x.disabled_by && reg.states[x.entity_id] && x.entity_id.startsWith('sensor.') && ['carbon_dioxide', 'pm25'].includes(String(reg.states[x.entity_id]?.attributes.device_class ?? x.device_class ?? ''))); return e ? { label: 'CO₂', entities: { sensor: e.entity_id } } : null; },
};
/** An ONVIF camera (Sonoff CAM-C44HE: two lenses, person / pet / vehicle / motion events, pan and tilt): the ONVIF device's low-resolution H.264 profiles play on tiles,
 * the HD generic cameras of the same name (camera.<prefix>_*_hd, H.265) are the cards. Lens 1 = the turning one (ptz). */
export const cameraOnvifSpec: ModuleSpec = {
  id: 'camera_onvif', titleKey: 'module.camera_onvif', placement: [],
  roles: [
    { role: 'camera', labelKey: 'module.onvif.role.camera', required: true }, { role: 'camera2', labelKey: 'module.onvif.role.camera2', required: false },
    { role: 'sd', labelKey: 'module.onvif.role.sd', required: false }, { role: 'sd2', labelKey: 'module.onvif.role.sd2', required: false },
    { role: 'person', labelKey: 'module.onvif.role.person', required: false }, { role: 'pet', labelKey: 'module.onvif.role.pet', required: false }, { role: 'vehicle', labelKey: 'module.onvif.role.vehicle', required: false },
    { role: 'motion', labelKey: 'module.onvif.role.motion', required: false }, { role: 'motionCell', labelKey: 'module.onvif.role.motionCell', required: false }, { role: 'reboot', labelKey: 'module.onvif.role.reboot', required: false }, { role: 'setTime', labelKey: 'module.onvif.role.setTime', required: false },
  ],
  detect(reg) {
    const live = (id: string) => reg.entities.some(e => e.entity_id === id && !e.disabled_by) && !!reg.states[id];
    // a camera that also has an Imou cloud shutter (switch.<prefix>_privacy) belongs to the Imou module, which plays its ONVIF stream the C700's way
    const imouOwned = (id: string) => { const p = id.slice('camera.'.length).replace(/_(sd|hd|profile_?\d+)$/, ''); return reg.entities.some(e => e.entity_id === `switch.${p}_privacy` && e.platform === 'imou'); };
    const onvifCam = reg.entities.find(e => e.platform === 'onvif' && e.entity_id.startsWith('camera.') && live(e.entity_id) && e.device_id && !imouOwned(e.entity_id));
    if (!onvifCam) return null;
    const own = reg.entities.filter(e => e.device_id === onvifCam.device_id && live(e.entity_id)).map(e => e.entity_id);
    const sds = own.filter(id => id.startsWith('camera.')).sort();
    const prefix = sds[0].slice('camera.'.length).replace(/_profile_?\d+$/, '');
    const hds = reg.entities.filter(e => e.entity_id.startsWith(`camera.${prefix}_`) && e.platform !== 'onvif' && live(e.entity_id)).map(e => e.entity_id).sort((a, b) => Number(/ptz|pan|turn/.test(b)) - Number(/ptz|pan|turn/.test(a)) || a.localeCompare(b));
    const pick = (re: RegExp) => own.find(id => id.startsWith('binary_sensor.') && re.test(id));
    const dev = reg.devices.find(d => d.id === onvifCam.device_id);
    return { label: dev?.name ?? 'ONVIF', entities: {
      camera: hds[0] ?? sds[0], camera2: hds[1] ?? (hds.length ? undefined : sds[1]), sd: sds[0], sd2: sds[1],
      person: pick(/person|human/), pet: pick(/_pet_/), vehicle: pick(/vehicle/), motion: pick(/motion_alarm|_motion$/), motionCell: pick(/cell_motion/),
      reboot: own.find(id => id.startsWith('button.') && /reboot|restart/.test(id)), setTime: own.find(id => id.startsWith('button.') && /date|time/.test(id)),
    } };
  },
};
/** Xiaomi smart kettle (MIOT, xiaomi.kettle.*; owner 09.11.2026: «как в Mi Home»): the device's model finds it, the entity suffixes the roles;
 * the socket it stands on (a power meter named after the kettle) gives the watts while it boils. */
export const kettleSpec: ModuleSpec = {
  // only on the Kitchen's page, not on the home screen (owner 09.11.2026: «в панели Дом не будет, а только в панели Кухни»)
  id: 'kettle', titleKey: 'module.kettle', placement: ['room'],
  roles: [{ role: 'heater', labelKey: 'module.kettle.role.heater', required: true }, { role: 'temp', labelKey: 'module.kettle.role.temp', required: false }, { role: 'power', labelKey: 'module.kettle.role.power', required: false }],
  detect(reg) {
    const dev = reg.devices.find(d => /^xiaomi\.kettle\./.test(d.model ?? '') && !d.disabled_by);
    if (!dev) return null;
    const own = reg.entities.filter(e => e.device_id === dev.id && !e.disabled_by && reg.states[e.entity_id]).map(e => e.entity_id);
    const find = (domain: string, re: RegExp) => own.find(id => id.startsWith(`${domain}.`) && re.test(id));
    const heater = find('water_heater', /./) ?? find('switch', /_power$/);
    if (!heater) return null;
    // the socket: «switch.<stem>_plug» beside the kettle's own entities, with its power and today's energy
    const stem = heater.split('.')[1].replace(/_(power|kettle)$/, '') || heater.split('.')[1];
    const has = (id: string) => reg.states[id] ? id : undefined;
    return { label: dev.model ?? 'MIOT', entities: {
      heater, status: find('sensor', /_status$/), temp: find('sensor', /_temperature$/), power: find('switch', /_power$/), keepWarm: find('switch', /_auto_keep_warm$/),
      target: find('number', /_target_temperature$/), keepTemp: find('number', /_keep_warm_temperature$/), keepTime: find('number', /_keep_warm_time$/), lifted: find('binary_sensor', /_lift(ed|ing)$/),
      stop: find('button', /_stop$/), dnd: find('switch', /_no_disturb$/), liftRemember: find('switch', /_lift_remember_temp$/), boilRemind: find('switch', /_boiling_reminder$/), warmRemind: find('switch', /_keep_warm_reminder$/),
      knob: find('switch', /_custom_knob_temp$/), warming: find('sensor', /_warming_time$/), info: find('button', /_info$/), mode: find('number', /_target_mode$/),
      plug: has(`switch.${stem}_plug`), plugPower: has(`sensor.${stem}_plug_power`), plugToday: has(`sensor.${stem}_plug_energy_today`),
      device: dev.id, rest: own.join(','),
    } };
  },
};
/** Imou camera (Ranger 2C): video only from the local network — the ONVIF device's SD profile on tiles, the generic camera on the HD RTSP in the sheet — and the functions from Imou's cloud
 * integration (shutter, pan and tilt, presets, detections, siren). The cloud is not polled (30 000 requests a month): a command asks for one fresh state afterwards. Roles by the entity prefix of `switch.<prefix>_privacy`. */
export const IMOU_ROLES: ReadonlyArray<{ role: string; id: (p: string) => string }> = [
  { role: 'camera', id: p => `camera.${p}_sd` }, { role: 'hd', id: p => `camera.${p}_hd` },
  { role: 'privacy', id: p => `switch.${p}_privacy` }, { role: 'ptzUp', id: p => `button.${p}_ptz_up` }, { role: 'ptzDown', id: p => `button.${p}_ptz_down` }, { role: 'ptzLeft', id: p => `button.${p}_ptz_left` }, { role: 'ptzRight', id: p => `button.${p}_ptz_right` }, { role: 'preset', id: p => `select.${p}_preset` },
  { role: 'motionTracking', id: p => `switch.${p}_smart_tracking` }, { role: 'motion', id: p => `switch.${p}_motion_detection` }, { role: 'aiHuman', id: p => `switch.${p}_human_detection` }, { role: 'aiPet', id: p => `switch.${p}_pet_detection` },
  { role: 'ir', id: p => `switch.${p}_ir` }, { role: 'wdr', id: p => `switch.${p}_wdr` }, { role: 'flip', id: p => `switch.${p}_flip` }, { role: 'indicator', id: p => `switch.${p}_indicator` },
  { role: 'promptSound', id: p => `switch.${p}_prompt_sound` }, { role: 'audioRec', id: p => `switch.${p}_audio_recording` }, { role: 'alarmSiren', id: p => `switch.${p}_alarm_siren` }, { role: 'siren', id: p => `siren.${p}_siren` },
  { role: 'motionEvent', id: p => `binary_sensor.${p}_motion` }, { role: 'sceneChange', id: p => `binary_sensor.${p}_scene_change` },
  { role: 'reboot', id: p => `button.${p}_reboot` }, { role: 'syncTime', id: p => `button.${p}_sync_time` }, { role: 'cloudStatus', id: p => `sensor.${p}_cloud_status` },
];
export const cameraImouSpec: ModuleSpec = {
  id: 'camera_imou', titleKey: 'module.camera_imou', placement: [],
  roles: IMOU_ROLES.map(r => ({ role: r.role, labelKey: `module.imou.role.${r.role}`, required: r.role === 'camera' })),
  detect(reg) {
    const live = (id: string) => reg.entities.some(e => e.entity_id === id && !e.disabled_by) && !!reg.states[id];
    const shutter = reg.entities.find(e => e.platform === 'imou' && /^switch\.[a-z0-9_]+_privacy$/.test(e.entity_id) && !e.disabled_by);
    if (!shutter) return null;
    const p = shutter.entity_id.slice('switch.'.length, -'_privacy'.length), entities: ModuleEntities = {};
    for (const r of IMOU_ROLES) { const id = r.id(p); if (live(id)) entities[r.role] = id; }
    if (!entities.camera) return null; // no local video, nothing to show: the cloud streams are not used (owner, 09.11.2026)
    const dev = reg.devices.find(d => d.id === reg.entities.find(e => e.entity_id === entities.camera)?.device_id);
    return { label: dev?.name ?? 'Imou', entities };
  },
};
export const MODULE_SPECS: ModuleSpec[] = [boilerEbusSpec, doorbellSpec, cameraGo2rtcSpec, cameraOnvifSpec, cameraImouSpec, petFeederSpec, airSpec, clockSpec, kettleSpec];
export interface ActiveSpec { spec: ModuleSpec; entities: ModuleEntities; label: string; options: ModuleOptions }
/** Modules whose hardware is present (or that the owner configured by hand) and that are not disabled. */
export function activeSpecs(registry: Registry, config: HouseConfig, specs: ModuleSpec[] = MODULE_SPECS): ActiveSpec[] {
  const out: ActiveSpec[] = [];
  for (const spec of specs) {
    const cfg = config.modules[spec.id];
    if (cfg?.enabled === false) continue;
    const match = spec.detect(registry);
    const entities: ModuleEntities = { ...(match?.entities ?? {}), ...(cfg?.entities ?? {}) };
    const options: ModuleOptions = { ...(match?.options ?? {}), ...(cfg?.options ?? {}) };
    if (!spec.roles.filter(r => r.required).every(r => entities[r.role] && registry.states[entities[r.role]!])) continue;
    if (!(spec.options ?? []).filter(o => o.required).every(o => options[o.key])) continue;
    out.push({ spec, entities, label: match?.label ?? spec.id, options });
  }
  return out;
}
