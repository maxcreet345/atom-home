import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, keep, moveTo, moveBy, resize, spanOf, profileIdFor, normaliseProfiles, cleanScopes } from '../src/model/tile-layout.ts';

const one = () => ({ w: 1, h: 1 });

test('no arrangement: the screen as it is, in its own order and natural sizes', () => {
  const nat = (k: string) => k === 'heat' ? { w: 2, h: 2 } : one();
  assert.deepEqual(arrange(['clock', 'heat', 'energy'], undefined, nat, 4), [{ key: 'clock', w: 1, h: 1 }, { key: 'heat', w: 2, h: 2 }, { key: 'energy', w: 1, h: 1 }]);
});

test('the saved order and sizes win; a card wider than the columns of a phone on its side is clamped, not lost', () => {
  const r = arrange(['a', 'b', 'c'], [['c', 4, 2], ['a', 1, 1], ['b', 2, 1]], one, 2);
  assert.deepEqual(r, [{ key: 'c', w: 2, h: 2 }, { key: 'a', w: 1, h: 1 }, { key: 'b', w: 2, h: 1 }]);
});

test('a new card lands after the card that precedes it on the screen, not at the end', () => {
  const r = arrange(['a', 'new', 'b'], [['b', 1, 1], ['a', 2, 1]], one, 4);
  assert.deepEqual(r.map(x => x.key), ['b', 'a', 'new']);
  const first = arrange(['new', 'a'], [['a', 1, 1]], one, 4);
  assert.deepEqual(first.map(x => x.key), ['new', 'a']);
});

test('an absent card (no weather today) keeps its place for when it is back', () => {
  const saved: Array<[string, number, number]> = [['clock', 1, 1], ['weather', 2, 1], ['energy', 1, 1]];
  const shown = arrange(['clock', 'energy'], saved, one, 4);
  assert.deepEqual(shown.map(x => x.key), ['clock', 'energy']);
  const kept = keep(moveTo(shown, 'energy', 'clock'), saved);
  assert.deepEqual(kept, [['energy', 1, 1], ['clock', 1, 1], ['weather', 2, 1]]);
  assert.deepEqual(arrange(['clock', 'weather', 'energy'], kept, one, 4).map(x => x.key), ['energy', 'clock', 'weather']);
});

test('move by drag and by step; resize stays in whole cells within the columns and the card’s minimum', () => {
  const l = arrange(['a', 'b', 'c'], undefined, one, 3);
  assert.deepEqual(moveTo(l, 'c', 'a').map(x => x.key), ['c', 'a', 'b']);
  assert.deepEqual(moveBy(l, 'a', 1).map(x => x.key), ['b', 'a', 'c']);
  assert.equal(moveBy(l, 'a', -1), l);
  assert.deepEqual(resize(l, 'a', { w: 9.6, h: 2.4 }, 3)[0], { key: 'a', w: 3, h: 2 });
  assert.deepEqual(resize(l, 'a', { w: 0, h: 0 }, 3, { w: 2, h: 2 })[0], { key: 'a', w: 2, h: 2 });
  assert.equal(resize(l, 'a', { w: 1.2, h: .9 }, 3)[0], l[0], 'the same size is the same card: nothing re-renders');
});

test('a card’s span from its box on the screen', () => {
  assert.deepEqual(spanOf({ width: 150, height: 150 }, 150, 12, 4), { w: 1, h: 1 });
  assert.deepEqual(spanOf({ width: 312, height: 312 }, 150, 12, 4), { w: 2, h: 2 });
  assert.deepEqual(spanOf({ width: 2000, height: 40 }, 150, 12, 4), { w: 4, h: 1 });
});

test('a device id from its name, unique, Latin only', () => {
  assert.equal(profileIdFor('Планшет кухня', []), 'planshet-kukhnia');
  assert.equal(profileIdFor('Планшет кухня', ['planshet-kukhnia']), 'planshet-kukhnia-2');
  assert.equal(profileIdFor('Tabletă bucătărie', []), 'tableta-bucatarie');
  assert.equal(profileIdFor('🙂', []), 'device');
  assert.match(profileIdFor('x'.repeat(80), []), /^[a-z0-9][a-z0-9_-]{0,39}$/);
});

test('what the integration answers is read only where it is well formed', () => {
  const p = normaliseProfiles({ profiles: { 'tablet-kitchen': { name: 'Планшет кухня', scopes: { home: [['a', 2, 1], ['a', 1, 1], ['b', 0, 1], ['c', 1, 9]], bad: [['x', 1, 1]] }, rev: 2, updated: 1 }, 'Bad Id': { name: 'x', scopes: {} }, empty: { name: '  ', scopes: {} }, __proto__: { name: 'p', scopes: {} } } });
  assert.deepEqual(Object.keys(p), ['tablet-kitchen']);
  assert.deepEqual(p['tablet-kitchen'].scopes, { home: [['a', 2, 1]] });
  assert.deepEqual(cleanScopes({ 'room:kukhnia': [['t:kettle', 2, 2]] }), { 'room:kukhnia': [['t:kettle', 2, 2]] });
  assert.deepEqual(normaliseProfiles(null), {});
});

test('cards away for good never push a screen past what the integration takes', async () => {
  const { MAX_KEPT } = await import('../src/model/tile-layout.ts');
  const saved = Array.from({ length: 200 }, (_, i) => [`gone${i}`, 1, 1] as [string, number, number]);
  const kept = keep([{ key: 'here', w: 1, h: 1 }], saved);
  assert.equal(kept.length, MAX_KEPT);
  assert.ok(kept.some(r => r[0] === 'here'));
});
