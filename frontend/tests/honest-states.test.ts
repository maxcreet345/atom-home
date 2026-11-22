// Audit 22.11.2026, H-4: the house-wide heating target is not stepped when the helper the step would write is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { houseSet, type Heating } from '../src/model/heating.ts';

const base = (over: Partial<Heating>): Heating => ({ mode: 'auto', scenarioKnown: true, scenario: 'home', target: 20, temps: { home: 20, sleep: 19, away: 18, eco: 17, vacation: 12 }, rooms: [], ...over } as unknown as Heating);
test('heating: − and + have a value to start from only while the scenario\'s helper answers', () => {
  assert.deepEqual(houseSet(base({})), { shown: 20, value: 20 });
  // the helper of the scenario in force is gone: the number stays (the house still holds it), nothing to step
  assert.deepEqual(houseSet(base({ temps: { home: null, sleep: 19, away: 18, eco: 17, vacation: 12 } })), { shown: 20, value: null });
  // another scenario's helper gone: «Дома» is stepped as before
  assert.deepEqual(houseSet(base({ temps: { home: 20, sleep: null, away: 18, eco: 17, vacation: 12 } })), { shown: 20, value: 20 });
  // a house whose step goes elsewhere (its own target entity or the thermostat) has no such helpers: stepped as before
  assert.deepEqual(houseSet(base({ ids: { mode: null, modeAuto: null, modeManual: null, homeTemp: 'input_number.x', system: null, legacy: false }, temps: { home: null, sleep: null, away: null, eco: null, vacation: null } })), { shown: 20, value: 20 });
  // an unknown scenario was never stepped
  assert.deepEqual(houseSet(base({ scenarioKnown: false })), { shown: 20, value: null });
});
