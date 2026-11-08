// The Cameras card and panel (owner, 09.11.2026): four views of the entrance, quiet / a person on the stairs / a ring / one camera offline.
import { addCameras, frames, history, SONOFF } from '../camera-fixture.mjs';
import { addEnergy } from '../energy-fixture.mjs';
import { addAir, renameAreas } from '../air-fixture.mjs';
import { addFeeder, feederLog } from '../feeder-fixture.mjs';
const ago = m => new Date(Date.now() - m * 60_000).toISOString();
export const card = {
  name: 'Камеры', sheet: '#camera', home: '#home', sheetRoot: '.hm-main', tileRoot: '.at-cams-tile', actionButton: null,
  scenarios: {
    quiet: {},
    person: { s: { [SONOFF.person]: ['on', ago(0.3)], [SONOFF.motion]: ['on', ago(0.3)] } },
    ring: { s: { 'event.entrance_doorbell_ring': [new Date(Date.now() - 20_000).toISOString()], 'binary_sensor.entrance_doorbell_motion': ['on', ago(0.5)] } },
    offline: { off: [SONOFF.fixed, SONOFF.sd1] },
  },
  build: (base, scenario, now) => ({ snapshot: addFeeder(addAir(addEnergy(addCameras(base, scenario.s, scenario.off), { apt8: '153.4', ev: '0.0', apt9: '1126.0', ch4: '0.0' }))), feederLog: feederLog(now), airTasks: [], energyMonth: null, frames: frames(), camHistory: history(now.getTime()) }),
  config: text => { const c = JSON.parse(renameAreas(text)); c.modules = { ...c.modules, camera_go2rtc: { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264', streamHd: 'entrance_camera_hd' } }, doorbell: { options: { addon: 'a889bffc_go2rtc', stream: 'entrance_doorbell' } } }; return c; },
};
