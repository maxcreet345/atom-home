import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultConfig } from '../src/model/config.ts';
import { petFeederSpec, activeSpecs } from '../src/modules/catalog.ts';
import { feedCall, nextMeal, optionInt, parseFeederSchedule } from '../src/modules/feeder-protocol.ts';
const load = (f: string) => { const p = resolve(import.meta.dirname, '../../private/fixtures', f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const traian = load('traian-registry.json'), criuleni = load('criuleni-registry.json');

test('feeder schedule: parse, reject unknown formats, next meal', () => {
  const s = parseFeederSchedule('[1,08000201,12000101,18000201]'); assert.ok(s);
  assert.deepEqual(s!.meals, [{ time: '08:00', portions: 2 }, { time: '12:00', portions: 1 }, { time: '18:00', portions: 2 }]);
  assert.deepEqual(parseFeederSchedule('[0]')!.meals, []);
  assert.equal(parseFeederSchedule('[1,25000201]'), null); assert.equal(parseFeederSchedule('[1,08001601]'), null); assert.equal(parseFeederSchedule('[1,08000202]'), null); assert.equal(parseFeederSchedule(42), null);
  assert.equal(parseFeederSchedule('[1,08000201,08000101]'), null, 'duplicate times rejected');
  assert.deepEqual(nextMeal(s!.meals, '12:00'), { time: '18:00', portions: 2 }); assert.deepEqual(nextMeal(s!.meals, '23:00'), { time: '08:00', portions: 2 }); assert.equal(nextMeal([], '10:00'), null);
});

test('feeder command: one dosed MIOT action, dose limits enforced', () => {
  assert.deepEqual(feedCall('button.xiaomi_iv2001_318f_pet_food_out', 2, 15), { domain: 'xiaomi_miot', service: 'call_action', data: { entity_id: 'button.xiaomi_iv2001_318f_pet_food_out', siid: 2, aiid: 1, params: [{ piid: 8, value: 2 }] } });
  assert.throws(() => feedCall('button.x', 0, 15)); assert.throws(() => feedCall('button.x', 16, 15)); assert.throws(() => feedCall('button.x', 1.5, 15)); assert.throws(() => feedCall('switch.x', 1, 15));
  assert.equal(optionInt('12', 10, 1, 200), 12); assert.equal(optionInt('abc', 10, 1, 200), 10); assert.equal(optionInt('500', 10, 1, 200), 10);
});

test('feeder detected in the Traian snapshot with its siblings; absent in Criuleni', { skip: !traian || !criuleni }, () => {
  const m = petFeederSpec.detect(traian!); assert.ok(m);
  assert.equal(m!.label, 'xiaomi.feeder.iv2001');
  assert.deepEqual(m!.entities, { feed: 'button.xiaomi_iv2001_318f_pet_food_out', info: 'button.xiaomi_iv2001_318f_info', plan: 'switch.xiaomi_iv2001_318f_schedule_state', stock: 'sensor.xiaomi_iv2001_318f_pet_food_left_level', bowl: 'sensor.xiaomi_iv2001_318f_eaten_food_measure_3', outStatus: 'sensor.xiaomi_iv2001_318f_food_out_status', desiccant: 'sensor.xiaomi_iv2001_318f_desiccant_left_level' });
  assert.equal(parseFeederSchedule(traian!.states['button.xiaomi_iv2001_318f_info'].attributes['feeder_schedule-5-1'])!.meals.length, 3);
  assert.ok(activeSpecs(traian!, defaultConfig()).some(a => a.spec.id === 'pet_feeder'));
  assert.equal(petFeederSpec.detect(criuleni!), null);
  const off = defaultConfig(); off.modules.pet_feeder = { enabled: false }; assert.ok(!activeSpecs(traian!, off).some(a => a.spec.id === 'pet_feeder'));
});
