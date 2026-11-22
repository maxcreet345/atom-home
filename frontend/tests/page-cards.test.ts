// Owner, 23.11.2026: adding cards and arranging them reaches every page — rooms, lights, devices, energy, security — and the tabs of
// «Настройка панели» stand in the owner's order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanScopes, pageScope } from '../src/model/tile-layout.ts';
import { PAGE_PLACES, isPagePlace, normaliseInstances } from '../src/model/card-catalog.ts';
import { SETUP_TABS, setupTabOrder, normaliseConfig } from '../src/model/config.ts';
const root = resolve(import.meta.dirname, '../..');

test('a page keeps its own arrangement, and the integration accepts the very same names', () => {
  const py = readFileSync(resolve(root, 'custom_components/atom_home/layouts.py'), 'utf8'), ts = readFileSync(resolve(root, 'frontend/src/model/tile-layout.ts'), 'utf8');
  const a = /SCOPE = re\.compile\(r"(.+?)"\)/.exec(py)![1], b = /const SCOPE = \/(.+?)\/;/.exec(ts)![1];
  assert.equal(a, b, 'one rule on both sides');
  const kept = cleanScopes({ [pageScope('lights')]: [['d:e:light.a', 1, 1]], 'page:Lights': [['x', 1, 1]], 'page:': [['x', 1, 1]], 'pages:lights': [['x', 1, 1]], home: [['a', 2, 2]] });
  assert.deepEqual(Object.keys(kept).sort(), ['home', 'page:lights']);
  for (const p of PAGE_PLACES) assert.ok(new RegExp(b).test(pageScope(p)), p);
});

test('a card may stand on a page; an unknown place is dropped', () => {
  const warn: string[] = [];
  const out = normaliseInstances({ abc12345: { profileId: 'house.clock', profileVersion: '1.0.0', bindings: {}, placement: ['home', 'energy', 'lights', 'garage', 'energy'] } }, m => warn.push(m));
  assert.deepEqual(out.abc12345?.placement, ['home', 'energy', 'lights']);
  assert.equal(isPagePlace('security'), true); assert.equal(isPagePlace('home'), false); assert.equal(isPagePlace('setup'), false);
});

test('the settings tabs: a saved order is made whole, the panel\'s own order is not stored', () => {
  assert.deepEqual(setupTabOrder(undefined), [...SETUP_TABS]);
  assert.deepEqual(setupTabOrder(['home', 'rooms', 'nope', 'home', 7]), ['home', 'rooms', 'devices', 'energy', 'sections', 'buttons', 'modules']);
  const cfg = (tabs: unknown) => normaliseConfig({ schemaVersion: 1, home: { name: 'Дом', language: 'ru', theme: 'light' }, setupTabs: tabs }).config;
  assert.deepEqual(cfg(['home', 'rooms']).setupTabs, ['home', 'rooms', 'devices', 'energy', 'sections', 'buttons', 'modules']);
  assert.equal('setupTabs' in cfg([...SETUP_TABS]), false); assert.equal('setupTabs' in cfg('home'), false); assert.equal('setupTabs' in cfg([]), false);
});

test('the panel tells the integration it keeps the look, the tab order and the page places — and the integration asks for exactly that', () => {
  const store = readFileSync(resolve(root, 'frontend/src/runtime/ha-store.ts'), 'utf8'), konst = readFileSync(resolve(root, 'custom_components/atom_home/const.py'), 'utf8'), state = readFileSync(resolve(root, 'custom_components/atom_home/config_state.py'), 'utf8');
  const name = /CLIENT_FEATURE_PAGES = "([a-z0-9_]+)"/.exec(konst)![1];
  assert.ok(store.includes(`PAGES_FEATURE = '${name}'`)); assert.ok(store.includes('CARDS_FEATURE, PAGES_FEATURE, ...'));
  assert.match(state, /has_page_settings\(self\.config\) and CLIENT_FEATURE_PAGES not in/);
  for (const p of PAGE_PLACES) assert.ok(konst.includes(`"${p}"`), `const.py knows the page «${p}»`);
});
