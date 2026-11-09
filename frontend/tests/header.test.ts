import test from 'node:test';
import assert from 'node:assert/strict';
import { people, summaryOf } from '../src/model/people.ts';
import { ru } from '../src/i18n/ru.ts';
import { en } from '../src/i18n/en.ts';
import { ro } from '../src/i18n/ro.ts';
const st = (state: string, name: string, extra: Record<string, unknown> = {}, changed = '2026-11-09T00:30:00Z') => ({ state, attributes: { friendly_name: name, ...extra }, last_changed: changed, last_updated: changed });
test('people from HA: home, away, a zone, unknown; home first; hidden ones left out', () => {
  const states = { 'person.a': st('not_home', 'Ararat Melconean', { entity_picture: '/api/image/serve/x/512x512' }), 'person.g': st('Traian', 'Gayane Grigorean'), 'person.d': st('home', 'Daniela Melconean'), 'person.x': st('unavailable', 'Guest'), 'person.h': st('home', 'Hidden One'), 'light.k': st('on', 'Lamp') };
  const p = people({ states, entities: [] } as never, { entities: { 'person.h': { hidden: true } }, devices: {} });
  assert.deepEqual(p.map(x => x.first), ['Daniela', 'Ararat', 'Gayane', 'Guest']);
  assert.deepEqual(p.map(x => x.state), ['home', 'away', 'zone', 'unknown']);
  assert.equal(p.find(x => x.first === 'Gayane')?.zone, 'Traian'); assert.equal(p.find(x => x.first === 'Gayane')?.initials, 'GG');
  assert.equal(p.find(x => x.first === 'Ararat')?.picture, '/api/image/serve/x/512x512'); assert.equal(p.find(x => x.first === 'Guest')?.initials, 'G');
  assert.equal(p[0].since, null, 'all in the same minute (the fixture) reads as an HA restart: no time');
});
test('a person whose card is switched off in Setup → Devices is left out of the header', () => {
  const states = { 'person.a': st('home', 'Ararat Melconean'), 'person.d': st('home', 'Daniela Melconean') };
  assert.deepEqual(people({ states, entities: [] } as never, { entities: {}, devices: { 'e:person.d': { enabled: false } } } as never).map(x => x.first), ['Ararat']);
  assert.deepEqual(people({ states, entities: [] } as never, { entities: {}, devices: { 'e:person.d': { enabled: true } } } as never).map(x => x.first), ['Ararat', 'Daniela']);
});
test('a person hidden or disabled in HA\'s entity registry is left out of the header, as Setup leaves it out', () => {
  const states = { 'person.a': st('home', 'Ararat Melconean'), 'person.d': st('home', 'Daniela Melconean'), 'person.g': st('home', 'Gayane Grigorean') };
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ entity_id: id, hidden_by: null, disabled_by: null, ...extra });
  const entities = [row('person.a'), row('person.d', { hidden_by: 'user' }), row('person.g', { disabled_by: 'user' })];
  assert.deepEqual(people({ states, entities } as never, { entities: {}, devices: {} }).map(x => x.first), ['Ararat']);
});
test('the summary: nobody known is «no data», not «nobody home»', () => {
  const of = (...s: string[]) => summaryOf(people({ states: Object.fromEntries(s.map((x, i) => [`person.p${i}`, st(x, `P${i} X`)])), entities: [] } as never, { entities: {}, devices: {} }));
  assert.deepEqual(of('unavailable', 'unknown', 'unavailable'), { key: 'unknown', n: 0 });
  assert.deepEqual(of('home', 'home'), { key: 'allHome', n: 2 });
  assert.deepEqual(of('not_home', 'Traian'), { key: 'nobody', n: 0 });
  assert.deepEqual(of('not_home', 'unknown'), { key: 'unknown', n: 0 });
  assert.deepEqual(of('home', 'unknown', 'not_home'), { key: 'count', n: 1 });
  assert.equal(of(), null);
});
test('the time never breaks away from «since» at the line end, in every language', () => {
  for (const d of [ru, en, ro]) for (const k of ['people.since', 'people.sinceYesterday'] as const) assert.match(d[k], / \{t\}/, k);
});
test('after an HA restart every person changed in the same minute: no «с ЧЧ:ММ» for anyone', () => {
  const t = '2026-11-09T03:12:05Z', u = '2026-11-09T03:12:40Z';
  const p = people({ states: { 'person.a': st('home', 'A B', {}, t), 'person.b': st('not_home', 'C D', {}, u) }, entities: [] } as never, { entities: {}, devices: {} } as never);
  assert.deepEqual(p.map(x => x.since), [null, null]);
  const q = people({ states: { 'person.a': st('home', 'A B', {}, t), 'person.b': st('not_home', 'C D', {}, '2026-11-09T07:40:00Z') }, entities: [] } as never, { entities: {}, devices: {} } as never);
  assert.ok(q.every(x => typeof x.since === 'number'), 'different times stay');
});
