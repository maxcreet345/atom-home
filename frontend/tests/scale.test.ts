// The scale family (src/appliances/scale.*) on the live Criuleni snapshot of 21.11.2026: the profile finds the Mi Body Composition Scale 2 by its
// model code, the people come from the router (by `source_entity_id`, no names in the code) with their Bodymiscale figures, and the tile never
// says a weight — in any language, available or not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Registry } from '../src/model/registry.ts';
import { devicesFor, foundHere, suggestBindings, instanceView, instanceClaims, profileById, candidates, type ProfileInstance } from '../src/model/card-catalog.ts';
import { family, readScale, personIds, bmiBand } from '../src/appliances/scale.profiles.ts';
import { translator } from '../src/i18n/index.ts';

const live: Registry = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-registry-live-20261121.json', import.meta.url), 'utf8'));
const P = profileById('xiaomi.scale2')!;
const t = translator('ru');
const dev = () => devicesFor(live, P)[0];
const inst = (reg: Registry, extra: Record<string, string> = {}): ProfileInstance => ({ profileId: P.id, profileVersion: P.version, deviceId: dev().id, bindings: { ...suggestBindings(reg, P, dev().id), ...extra }, placement: ['home'] });
const KG = /\d+[,.]\d\s*(кг|kg)|103/;

test('the scale is found by its model code; its own weight and «stabilised» are suggested, the raw weight never', () => {
  assert.ok(P && P.renderer === 'appliance' && P.card === 'scale' && P.category === 'health');
  assert.equal(devicesFor(live, P).length, 1); assert.ok(foundHere(live, P));
  const b = suggestBindings(live, P, dev().id);
  assert.match(b.weight, /^sensor\..*_weight$/); assert.ok(!/_raw$/.test(b.weight)); assert.match(b.stable, /^binary_sensor\..*_stabili[sz]ed$/);
  // a person's role offers the router's weight sensors
  const c = candidates(live, P.roles.find(r => r.id === 'person1')!, { deviceId: dev().id }).map(x => x.id);
  assert.ok(c.some(id => live.states[id]?.attributes.source_entity_id === b.weight), c.join(', '));
});
test('the people are the router’s sensors routed from this scale; Bodymiscale adds BMI, ideal weight and the rest', () => {
  const b = inst(live).bindings, ids = personIds(live, b);
  assert.equal(ids.length, 3, ids.join(', '));
  const s = readScale(live, b);
  assert.equal(s.persons.length, 3);
  assert.ok(s.last, 'the last weighing is known');
  assert.equal(s.last!.weight, 103.7); assert.equal(s.last!.bmi, 34.6); assert.equal(s.last!.ideal, 65.1);
  assert.ok(Math.abs(s.last!.at! - Date.parse('2026-11-01T19:41:00+00:00')) < 1000, 'the integration’s time, not HA’s restart');
  assert.deepEqual(s.last!.facts.map(f => f.key).sort(), ['basal', 'visceral']);
  assert.equal(bmiBand(34.6), 'obese');
  const empty = s.persons.filter(p => p !== s.last);
  assert.ok(empty.every(p => p.weight === null && p.at === null && p.facts.length === 0), 'a person who never weighed has no figures');
});
test('bound people win over the ones found; an unknown person sensor is skipped, not a crash', () => {
  const ids = personIds(live, inst(live).bindings);
  const s = readScale(live, inst(live, { person1: ids[1], person2: 'sensor.nobody_weight' }).bindings);
  assert.equal(s.persons.length, 1); assert.equal(s.persons[0].id, ids[1]);
});
test('the tile line: «Последнее взвешивание · <когда>» with no weight in ru, ro and en; none yet; unavailable', () => {
  const i = inst(live);
  for (const lang of ['ru', 'ro', 'en'] as const) { const line = family.tileLine!(live, i, translator(lang), lang)!; assert.ok(line && !KG.test(line), `${lang}: ${line}`); assert.match(line, /1 |нояб|nov|Nov/i, line); }
  assert.match(family.tileLine!(live, i, t, 'ru')!, /^Последнее взвешивание · /);
  // nobody weighed yet
  const none: Registry = structuredClone(live); for (const id of personIds(none, i.bindings)) { none.states[id].state = 'unknown'; none.states[id].attributes.weight_history = []; }
  for (const e of none.entities.filter(x => x.platform === 'bodymiscale')) if (none.states[e.entity_id]) { none.states[e.entity_id].state = 'unknown'; delete none.states[e.entity_id].attributes.last_measurement_time; }
  assert.equal(family.tileLine!(none, i, t, 'ru'), 'Взвешиваний ещё не было');
  // the scale itself is gone: the generic tile says «Недоступно» (its main field), and the line never shows a figure either
  const off: Registry = structuredClone(live); off.states[i.bindings.weight].state = 'unavailable';
  const v = instanceView(off, 'c1', i, undefined, undefined, k => t(k as never))!;
  assert.equal(v.device.available, false);
  assert.ok(!KG.test(family.tileLine!(off, i, t, 'ru') ?? ''));
  const offNone: Registry = structuredClone(none); offNone.states[i.bindings.weight].state = 'unavailable';
  assert.equal(family.tileLine!(offNone, i, t, 'ru'), t('state.unavailable'));
});
test('the card takes the scale’s own entities and the bound people from the auto-made tiles', () => {
  const ids = personIds(live, inst(live).bindings), i = inst(live, { person1: ids[0], person2: ids[1], person3: ids[2] });
  const claims = instanceClaims(live, { c1: i });
  for (const id of [i.bindings.weight, ...ids]) assert.ok(claims.has(id), id);
});
test('only the required field bound: everything optional is simply absent', () => {
  const s = readScale(live, { weight: inst(live).bindings.weight });
  assert.equal(s.available, true); assert.equal(s.persons.length, 3);
  assert.equal(readScale(live, {}).persons.length, 0);
});
