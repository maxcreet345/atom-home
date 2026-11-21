// The gas meter family (src/appliances/gasmeter.*) on the live Criuleni snapshot of 21.11.2026: the reading is the panel's own gas meter
// (model/gas.ts), the helpers say whether the camera still reads it — the snapshot itself is the bad case (no answer since 20.11 09:30).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Registry } from '../src/model/registry.ts';
import { foundHere, candidates, instanceView, instanceClaims, profileById, type ProfileInstance } from '../src/model/card-catalog.ts';
import { gasMeters } from '../src/model/gas.ts';
import { family, readGasMeter, STALE_MS } from '../src/appliances/gasmeter.profiles.ts';
import { translator } from '../src/i18n/index.ts';

const live: Registry = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-registry-live-20261121.json', import.meta.url), 'utf8'));
const P = profileById('meter.gas_camera')!;
const t = translator('ru');
const pick = (reg: Registry) => Object.fromEntries(P.roles.flatMap(r => { const c = candidates(reg, r, { areaId: 'kukhnia' }); const best = c.filter(x => x.exact)[0] ?? (c.length === 1 ? c[0] : undefined); return best ? [[r.id, best.id]] : []; }));
const inst = (b: Record<string, string>): ProfileInstance => ({ profileId: P.id, profileVersion: P.version, bindings: b, placement: ['home'] });
const healthy = (reg: Registry, b: Record<string, string>, answer = '00970.684') => { reg.states[b.lastRead].attributes.timestamp = Math.floor((Date.now() - 3 * 60_000) / 1000); reg.states[b.answer].state = answer; return reg; };

test('the gas meter is in the catalog under «Счётчики»; meter, camera and both helpers find their entities', () => {
  assert.ok(P && P.category === 'meters' && P.card === 'gasmeter'); assert.ok(foundHere(live, P));
  const b = pick(live);
  assert.equal(b.meter, gasMeters(live)[0].id, 'the same meter «Энергия» shows');
  for (const r of ['camera', 'lastRead', 'answer']) assert.ok(b[r], `${r}: ${JSON.stringify(b)}`);
  const claims = instanceClaims(live, { c1: inst(b) }); assert.ok(claims.has(b.meter) && claims.has(b.camera), 'the old camera+meter tile goes away');
});
test('the reading is the gas model’s; the snapshot is stale and unread, a healthy read and a refused one are said apart', () => {
  const b = pick(live), g = readGasMeter(live, b, Date.parse('2026-11-21T12:30:00Z'));
  assert.equal(g.value, gasMeters(live)[0].value); assert.equal(g.unit, 'm³');
  assert.equal(g.lastRead, 1795159816000); assert.equal(g.unread, true); assert.equal(g.problem, 'stale');
  const ok = readGasMeter(healthy(structuredClone(live), b), b); assert.equal(ok.problem, null); assert.equal(ok.answerValue, 970.684);
  const refused = readGasMeter(healthy(structuredClone(live), b, '00969.100'), b); assert.equal(refused.problem, 'rejected');
  const once = readGasMeter(healthy(structuredClone(live), b, '? UNREADABLE'), b); assert.equal(once.problem, 'unread');
  assert.ok(STALE_MS >= 15 * 60_000);
});
test('the tile line: reading and time; «не читается» when stale; unavailable', () => {
  const b = pick(live);
  assert.equal(family.tileLine!(live, inst(b), t, 'ru'), '970,684 м³ · не читается');
  assert.match(family.tileLine!(healthy(structuredClone(live), b), inst(b), t, 'ru')!, /^970,684 м³ · сегодня, \d\d:\d\d$/);
  assert.match(family.tileLine!(healthy(structuredClone(live), b), inst(b), translator('en'), 'en')!, /^970\.684 m³ · today, /);
  const off: Registry = structuredClone(live); off.states[b.meter].state = 'unavailable';
  assert.equal(family.tileLine!(off, inst(b), t, 'ru'), t('state.unavailable'));
  assert.equal(instanceView(off, 'c1', inst(b))!.device.available, false);
});
test('only the meter bound: no picture, no freshness, no warning', () => {
  const g = readGasMeter(live, { meter: pick(live).meter });
  assert.equal(g.camera, null); assert.equal(g.lastRead, null); assert.equal(g.problem, null);
  assert.equal(family.tileLine!(live, inst({ meter: pick(live).meter }), t, 'ru'), '970,684 м³');
});
