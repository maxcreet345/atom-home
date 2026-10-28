import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseConfig } from '../src/model/config.ts';
import { deviceArtType, DEVICE_ART_TYPES } from '../src/ui/device-art-types.ts';
import { editFeederSchedule, scheduleCall } from '../src/modules/feeder-protocol.ts';

test('device art is guessed from kind and name in three languages', () => {
  assert.equal(deviceArtType('climate', 'Радиатор · Кухня'), 'radiator'); assert.equal(deviceArtType('climate', 'Отопление дома'), 'thermostat');
  assert.equal(deviceArtType('light', 'Люстра детской'), 'chandelier'); assert.equal(deviceArtType('light', 'Lustra hol'), 'chandelier'); assert.equal(deviceArtType('light', 'Свет · Ванная'), 'light');
  assert.equal(deviceArtType('switch', 'Розетка ванной'), 'socket'); assert.equal(deviceArtType('switch', 'Permit join'), null);
  assert.equal(deviceArtType('energy', 'Электрощит'), 'panel'); assert.equal(deviceArtType('environment', 'Термометр'), 'thermometer');
  assert.equal(deviceArtType('generic', 'Котёл eBUS'), 'boiler'); assert.equal(deviceArtType('generic', 'Hrănitor'), 'feeder'); assert.equal(deviceArtType('generic', 'Шлюз'), null);
  assert.equal(DEVICE_ART_TYPES.length, 14);
});

test('art override is kept as a short string', () => {
  const { config } = normaliseConfig({ schemaVersion: 1, devices: { 'e:light.a': { art: 'none' }, 'e:light.b': { art: 'x'.repeat(40) } } });
  assert.equal(config.devices['e:light.a'].art, 'none'); assert.equal(config.devices['e:light.b'].art, 'x'.repeat(20));
});

test('feeder schedule edit keeps header and suffixes, rejects bad input', () => {
  const raw = '[1,08000201,12000101,18000201]';
  assert.equal(editFeederSchedule(raw, [{ time: '08:00', portions: 2 }, { time: '13:30', portions: 2 }, { time: '18:00', portions: 2 }]), '[1,08000201,13300201,18000201]');
  assert.throws(() => editFeederSchedule(raw, [{ time: '08:00', portions: 2 }]), /row set/);
  assert.throws(() => editFeederSchedule(raw, [{ time: '08:00', portions: 2 }, { time: '08:00', portions: 1 }, { time: '18:00', portions: 2 }]), /duplicate/);
  assert.throws(() => editFeederSchedule(raw, [{ time: '08:00', portions: 16 }, { time: '12:00', portions: 1 }, { time: '18:00', portions: 2 }]), /bad time or dose/);
  assert.throws(() => editFeederSchedule('[0]', [{ time: '08:00', portions: 2 }]));
  assert.deepEqual(scheduleCall('button.xiaomi_iv2001_318f_info', '[1,08000201,13300201,18000201]'), { domain: 'xiaomi_miot', service: 'call_action', data: { entity_id: 'button.xiaomi_iv2001_318f_info', siid: 5, aiid: 2, params: ['[1,08000201,13300201,18000201]'] } });
  assert.throws(() => scheduleCall('button.x', 'garbage'));
});
