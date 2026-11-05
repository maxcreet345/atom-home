// The Air card's states for the shared preview server and the audit on a real device.
import { addAir, renameAreas } from '../air-fixture.mjs';
import { addFeeder, feederLog } from '../feeder-fixture.mjs';
const CALM = { 'sensor.kitchen_climate_humidity': '57' }, VENT = { 'fan.bath_vent': { state: 'off', area: 'vannaia' } }, WET = { ...CALM, ...VENT, 'sensor.bath_climate_humidity': '78' };
const RUNNING = { ...WET, 'fan.bath_vent': { state: 'on', area: 'vannaia' }, 'sensor.bath_climate_humidity': '71' };
const job = () => [{ kind: 'dehumidify', roomId: 'vannaia', device: 'fan.bath_vent', sensor: 'sensor.bath_climate_humidity', target: 60, startedAt: Date.now() - 360000 }];
export const card = {
  name: 'Воздух', sheet: '#home?device=air', home: '#home', sheetRoot: '.at-air-sheet', tileRoot: '[data-module-card="air"]', actionButton: '.at-air-do',
  scenarios: {
    calm: { over: CALM }, wet: { over: WET, press: true }, running: { over: RUNNING, tasks: job },
    stuffy: { over: { ...CALM, 'sensor.kids_co2': '1412' } }, bad: { over: { ...CALM, 'sensor.kids_co2': '2400', 'sensor.bath_climate_humidity': '90' } },
    dust: { over: { ...CALM, 'sensor.living_air_purifier_pm25': '41', 'fan.living_air_purifier': 'off' } },
    dry: { over: { ...CALM, 'sensor.living_co2_humidity': '31', 'sensor.living_air_purifier_pm25': '20', 'fan.living_air_purifier': 'off' } },
    dead: { over: { ...CALM, 'sensor.kids_co2_humidity': 'unavailable', 'sensor.bedroom_climate_temperature': 'unavailable' } },
    offline: { over: { ...WET, 'fan.bath_vent': { state: 'unavailable', area: 'vannaia' } } },
  },
  build: (base, scenario, now) => ({ snapshot: addFeeder(addAir(base, scenario.over)), feederLog: feederLog(now), airTasks: scenario.tasks ? scenario.tasks() : [] }),
  config: text => JSON.parse(renameAreas(text)),
};
