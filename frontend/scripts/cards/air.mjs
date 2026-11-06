// The Air card's states for the shared preview server and the audit on a real device.
import { addAir, deadSensors, renameAreas } from '../air-fixture.mjs';
import { addFeeder, feederLog } from '../feeder-fixture.mjs';
const CALM = { 'sensor.kitchen_climate_humidity': '57' }, VENT = { 'fan.bath_vent': { state: 'off', area: 'vannaia' } }, WET = { ...CALM, ...VENT, 'sensor.bath_climate_humidity': '78' };
const RUNNING = { ...WET, 'fan.bath_vent': { state: 'on', area: 'vannaia' }, 'sensor.bath_climate_humidity': '71' };
const stuck = () => [{ ...job()[0], roomId: 'kompiuternaia', device: 'fan.office_fan', sensor: 'sensor.office_climate_humidity', outcome: 'no_stop' }], ended = outcome => () => [{ ...job()[0], outcome }];
const job = () => [{ kind: 'dehumidify', roomId: 'vannaia', device: 'fan.bath_vent', sensor: 'sensor.bath_climate_humidity', target: 60, startedAt: Date.now() - 360000, wasOn: false, stopping: false }];
export const card = {
  name: 'Воздух', sheet: '#home?device=air', home: '#home', sheetRoot: '.at-air-sheet', tileRoot: '[data-module-card="air"]', actionButton: '.at-air-do',
  scenarios: {
    calm: { over: CALM }, wet: { over: WET, press: true }, running: { over: RUNNING, tasks: job },
    stuck: { over: { ...WET, 'fan.office_fan': 'on' }, tasks: stuck }, noStart: { over: WET, tasks: ended('no_start') }, outOfTime: { over: WET, tasks: ended('out_of_time') },
    stuffy: { over: { ...CALM, 'sensor.kids_co2': '1412' } }, bad: { over: { ...CALM, 'sensor.kids_co2': '2400', 'sensor.bath_climate_humidity': '90' } },
    dust: { over: { ...CALM, 'sensor.living_air_purifier_pm25': '41', 'fan.living_air_purifier': 'off' } },
    mixed: { over: { ...CALM, 'sensor.kids_co2': '1250', 'sensor.living_air_purifier_pm25': '200' } },
    dry: { over: { ...CALM, 'sensor.living_co2_humidity': '31' } },
    two: { over: { ...CALM, 'sensor.living_co2_humidity': '31', 'sensor.living_air_purifier_pm25': '20', 'fan.living_air_purifier': 'off' } },
    dead: { over: { ...CALM, 'sensor.kids_co2_humidity': 'unavailable', 'sensor.bedroom_climate_temperature': 'unavailable' } },
    deadAll: { over: deadSensors() }, deadCo2: { over: { ...CALM, 'sensor.kids_co2': 'unavailable', 'sensor.living_co2': 'unavailable' } },
    noLink: { over: CALM, links: { spalnia: { temperature: null, humidity: null }, kukhnia: { humidity: null } } },
    silentLink: { over: { ...CALM, 'sensor.bedroom_climate_temperature': 'unavailable', 'sensor.kids_co2_humidity': 'unknown', 'sensor.office_climate_humidity': null } },
    offline: { over: { ...WET, 'fan.bath_vent': { state: 'unavailable', area: 'vannaia' } } },
    threeHumid: { over: { ...VENT, 'fan.kitchen_vent': { state: 'off', area: 'kukhnia' }, 'fan.storage_vent': { state: 'off', area: 'sklad' }, 'sensor.kitchen_climate_humidity': '75', 'sensor.bath_climate_humidity': '78', 'sensor.storage_climate_humidity': '75' } }, // with the new vents: on the kiosk the storeroom's button is below the edge, and only the fade says so
    openWindow: { over: { ...CALM, 'sensor.kids_co2': '2400', 'binary_sensor.office_window_contact': 'on', 'fan.kitchen_vent': { state: 'off', area: 'kukhnia' }, 'sensor.kitchen_climate_humidity': '75' } },
  },
  build: (base, scenario, now) => ({ snapshot: addFeeder(addAir(base, scenario.over, scenario.links)), feederLog: feederLog(now), airTasks: scenario.tasks ? scenario.tasks() : [] }),
  config: text => JSON.parse(renameAreas(text)),
};
