// The dashcam family (src/appliances/dashcam.*) on the live Criuleni snapshot of 21.11.2026: a 70mai A810 + UP04 with no model code in HA (a
// scheme found by its fields, diagnostic ones included), where the car is, its battery, the last alarm at the camera's own time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Registry } from '../src/model/registry.ts';
import { foundHere, candidates, instanceView, profileById, type ProfileInstance } from '../src/model/card-catalog.ts';
import { family, readDashcam, batteryOf } from '../src/appliances/dashcam.profiles.ts';
import { translator } from '../src/i18n/index.ts';

const live: Registry = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-registry-live-20261121.json', import.meta.url), 'utf8'));
const P = profileById('70mai.a810_up04')!;
const t = translator('ru');
/** what the installer picks in the form: the best candidate of each field that has the field's own suffix */
const pick = (reg: Registry) => Object.fromEntries(P.roles.flatMap(r => { const c = candidates(reg, r, { areaId: 'avto' }).filter(x => x.exact); return c.length ? [[r.id, c[0].id]] : []; }));
const inst = (b: Record<string, string>): ProfileInstance => ({ profileId: P.id, profileVersion: P.version, bindings: b, placement: ['home'] });

test('the dashcam is in the catalog under «Автомобиль»; every field it has finds its entity, the diagnostic ones too', () => {
  assert.ok(P && P.category === 'car' && P.renderer === 'appliance' && P.card === 'dashcam');
  assert.ok(foundHere(live, P));
  const b = pick(live);
  for (const r of ['tracker', 'voltage', 'alarm', 'network', 'upload', 'simPower', 'firmware']) assert.ok(b[r], `${r} has a candidate (${JSON.stringify(b)})`);
  assert.ok(!/cellular/.test(b.firmware), 'the dashcam’s firmware, not the 4G module’s');
  assert.ok(!Object.values(b).some(id => /_sim$/.test(id)), 'the IMEI is never a field');
});
test('where the car is, its battery and the last alarm at the camera’s own time', () => {
  const b = pick(live), now = Date.parse('2026-11-21T12:30:00Z'), d = readDashcam(live, b, now);
  assert.equal(d.available, true);
  assert.equal(d.place?.kind, 'zone'); assert.equal(d.place?.zone, 'Esperanza Sanitas'); assert.ok(d.place?.lat && d.place?.lon);
  assert.equal(d.volts, 12.102); assert.equal(d.battery, 'mid');
  assert.equal(d.alarm?.kind, 'suspicious_person'); assert.equal(d.alarm?.at, 1795242519000, 'happen_time, not when HA heard of it'); assert.equal(d.alarm?.fresh, true);
  assert.equal(d.upload, true); assert.equal(d.simPower, false); assert.equal(d.firmware, '1.9.118ww');
  assert.deepEqual([13.8, 12.6, 12.1, 11.7].map(batteryOf), ['charging', 'good', 'mid', 'low']);
});
test('the tile line: a fresh alarm first, else the place and the volts; home / away in words; unavailable', () => {
  const b = pick(live), reg: Registry = structuredClone(live), ev = reg.states[b.alarm].attributes;
  ev.happen_time = Date.now() - 3600_000; ev.event_type = 'collision';
  assert.match(family.tileLine!(reg, inst(b), t, 'ru')!, /^Удар по машине · /);
  ev.happen_time = Date.now() - 3 * 86_400_000;
  assert.equal(family.tileLine!(reg, inst(b), t, 'ru'), 'Esperanza Sanitas · 12,1 В');
  reg.states[b.tracker].state = 'home'; assert.equal(family.tileLine!(reg, inst(b), t, 'ru'), 'Дома · 12,1 В');
  reg.states[b.tracker].state = 'not_home'; assert.equal(family.tileLine!(reg, inst(b), translator('ro'), 'ro'), 'Nu e acasă · 12,1 V');
  reg.states[b.tracker].state = 'unavailable';
  assert.equal(family.tileLine!(reg, inst(b), t, 'ru'), t('state.unavailable'));
  assert.equal(instanceView(reg, 'c1', inst(b))!.device.available, false);
});
test('only the required field bound: no battery, no alarm, no link rows — and nothing breaks', () => {
  const b = { tracker: pick(live).tracker }, d = readDashcam(live, b);
  assert.equal(d.volts, null); assert.equal(d.alarm, null); assert.equal(d.network, null); assert.equal(d.firmware, null);
  assert.equal(family.tileLine!(live, inst(b), t, 'ru'), 'Esperanza Sanitas');
});
