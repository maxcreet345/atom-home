import test from 'node:test';
import assert from 'node:assert/strict';
import { readOfficeClimate, officeTone, officeClaims, officeHeating } from '../src/model/office-climate.ts';
import { card, SCENARIOS } from '../scripts/cards/okapi-climate.mjs';
import type { Registry } from '../src/model/registry.ts';
// Atom + Okapi as HA showed it on 09.11.2026 plus the two virtual thermostats (atom-okapi/HEATING.md), in the preview's four moments
const at = (k: keyof typeof SCENARIOS) => ({ reg: card.build(null, { ...SCENARIOS[k], key: k }).snapshot as Registry, now: Date.parse(SCENARIOS[k].at) });

test('a working morning: the working temperature, the AC that heats, heating stops 30 min before the end of the day', () => {
  const { reg, now } = at('work'), c = readOfficeClimate(reg, now)!;
  assert.equal(c.mode, 'work'); assert.equal(c.target, 20); assert.equal(c.armed, false);
  assert.deepEqual(c.zones.map(z => [z.key, z.name, z.action, z.ac.entity]), [['servis', 'Сервис', 'heating', 'climate.konditsioner_thermostat'], ['shourum', 'Шоурум', 'idle', 'climate.konditsioner_shourum_thermostat']]);
  assert.equal(new Date(c.work!.heatEnd).getHours() * 60 + new Date(c.work!.heatEnd).getMinutes(), 17 * 60 + 30);
  assert.deepEqual([c.next!.mode, c.next!.temp], ['duty', 15]);
  assert.deepEqual(c.day.map(x => x.mode), ['duty', 'work', 'duty']);
  assert.equal(officeHeating(c), 1); assert.equal(officeTone(c), 'heat');
  assert.deepEqual(officeClaims(c).sort(), ['climate.konditsioner_shourum_thermostat', 'climate.konditsioner_thermostat', 'climate.termostat_servis', 'climate.termostat_shourum']);
});
test('a standby evening keeps today\'s working day (the calendar already shows tomorrow) and waits for tomorrow 08:59', () => {
  const { reg, now } = at('duty'), c = readOfficeClimate(reg, now)!;
  assert.equal(c.mode, 'duty'); assert.equal(c.target, 15); assert.equal(c.armed, true);
  assert.deepEqual(c.day.map(x => x.mode), ['duty', 'work', 'duty']);
  assert.deepEqual([c.next!.mode, new Date(c.next!.at).getDate()], ['work', 10]);
});
test('a day off: low until 23:00, then standby; the next working day is Monday', () => {
  const { reg, now } = at('dayoff'), c = readOfficeClimate(reg, now)!;
  assert.equal(c.mode, 'dayoff'); assert.equal(c.target, 5);
  assert.deepEqual(c.day.map(x => [x.mode, new Date(x.from).getHours()]), [['dayoff', 0], ['duty', 23]]);
  assert.deepEqual([c.next!.mode, new Date(c.next!.at).getHours()], ['duty', 23]);
  assert.equal(officeTone(c), 'calm');
});
test('a lost air conditioner turns the card to a warning', () => {
  const { reg, now } = at('lost'), c = readOfficeClimate(reg, now)!;
  assert.equal(c.zones.find(z => z.key === 'servis')!.ac.online, false); assert.equal(officeTone(c), 'warn');
});
test('a real thermostat named «termostat_…» (the showcase\'s Moes) is not a zone', () => {
  const { reg, now } = at('work'), r = structuredClone(reg);
  r.entities.push({ entity_id: 'climate.termostat_moes_riad_4_mesto_3', device_id: null, area_id: 'spalnia', name: null, original_name: null, platform: 'mqtt', entity_category: null, disabled_by: null, hidden_by: null } as never);
  r.states['climate.termostat_moes_riad_4_mesto_3'] = { state: 'heat', attributes: { current_temperature: 15, temperature: 20 }, last_changed: '', last_updated: '' } as never;
  assert.deepEqual(readOfficeClimate(r, now)!.zones.map(z => z.key), ['servis', 'shourum']);
});
test('no «Климат · режим» helper or no virtual thermostat: no card', () => {
  const { reg, now } = at('work');
  const noMode = structuredClone(reg); delete noMode.states['input_select.klimat_rezhim'];
  assert.equal(readOfficeClimate(noMode, now), null);
  const noTh = structuredClone(reg); for (const id of Object.keys(noTh.states)) if (id.startsWith('climate.termostat_')) delete noTh.states[id];
  assert.equal(readOfficeClimate(noTh, now), null);
});
