// The Cameras card and panel (owner, 09.11.2026): four views of the entrance, quiet / a person on the stairs / a ring / one camera offline.
import { addCameras, frames, history, SONOFF } from '../camera-fixture.mjs';
import { addEnergy } from '../energy-fixture.mjs';
import { addAir, renameAreas } from '../air-fixture.mjs';
import { addFeeder, feederLog } from '../feeder-fixture.mjs';
// times are minutes before the moment the preview draws the scenario (the server lives for a whole QA run)
const ago = m => ({ ago: m });
const iso = (x, now) => x && typeof x === 'object' ? new Date(now.getTime() - x.ago * 60_000).toISOString() : x;
const at = (s, now) => s && Object.fromEntries(Object.entries(s).map(([id, [state, when]]) => [id, [iso(state, now), iso(when, now)]]));
export const card = {
  name: 'Камеры', sheet: '#camera', home: '#home', sheetRoot: '.hm-main', tileRoot: '.at-cams-tile', actionButton: null,
  scenarios: {
    quiet: {},
    person: { s: { [SONOFF.person]: ['on', ago(0.3)], [SONOFF.motion]: ['on', ago(0.3)] } },
    ring: { s: { 'event.entrance_doorbell_ring': [{ ago: 0.33 }], 'binary_sensor.entrance_doorbell_motion': ['on', ago(0.5)] } },
    offline: { off: [SONOFF.fixed, SONOFF.sd1] },
    // the hall's Imou with its shutter closed (somebody at home: the automation closes it)
    hallClosed: { s: { 'switch.hall_camera_privacy': ['on'] }, off: ['camera.hall_camera_sd', 'camera.hall_camera_hd'] },
  },
  build: (base, scenario, now) => ({ snapshot: addFeeder(addAir(addEnergy(addCameras(base, at(scenario.s, now), scenario.off), { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }))), feederLog: feederLog(now), airTasks: [], energyMonth: null, frames: frames(), camHistory: history(now.getTime()) }),
  config: text => { const c = JSON.parse(renameAreas(text)); c.modules = { ...c.modules, camera_go2rtc: { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264', streamHd: 'entrance_camera_hd' } }, doorbell: { options: { addon: 'a889bffc_go2rtc', stream: 'entrance_doorbell_720', streamHd: 'entrance_doorbell' } } }; return c; },
};
