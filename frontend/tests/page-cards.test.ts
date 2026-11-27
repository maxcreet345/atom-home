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
  assert.deepEqual(setupTabOrder(['home', 'rooms', 'nope', 'home', 7]), ['home', 'rooms', 'devices', 'energy', 'sections', 'buttons', 'modules', 'access']);
  const cfg = (tabs: unknown) => normaliseConfig({ schemaVersion: 1, home: { name: 'Дом', language: 'ru', theme: 'light' }, setupTabs: tabs }).config;
  assert.deepEqual(cfg(['home', 'rooms']).setupTabs, ['home', 'rooms', 'devices', 'energy', 'sections', 'buttons', 'modules', 'access']);
  assert.equal('setupTabs' in cfg([...SETUP_TABS]), false); assert.equal('setupTabs' in cfg('home'), false); assert.equal('setupTabs' in cfg([]), false);
});

test('the panel tells the integration it keeps the look, the tab order and the page places — and the integration asks for exactly that', () => {
  const store = readFileSync(resolve(root, 'frontend/src/runtime/ha-store.ts'), 'utf8'), konst = readFileSync(resolve(root, 'custom_components/atom_home/const.py'), 'utf8'), state = readFileSync(resolve(root, 'custom_components/atom_home/config_state.py'), 'utf8');
  const name = /CLIENT_FEATURE_PAGES = "([a-z0-9_]+)"/.exec(konst)![1];
  assert.ok(store.includes(`PAGES_FEATURE = '${name}'`)); assert.ok(store.includes('CARDS_FEATURE, PAGES_FEATURE, ACCESS_FEATURE, ROOM_AIR_FEATURE, ...'));
  assert.match(state, /has_page_settings\(self\.config\) and CLIENT_FEATURE_PAGES not in/);
  for (const p of PAGE_PLACES) assert.ok(konst.includes(`"${p}"`), `const.py knows the page «${p}»`);
});

// ---- a page's own blocks (owner, 23.11.2026: «Энергия» and «Безопасность» are arranged like Home) ----
import { arrange as arrangeB, keep as keepB, blockWidth, blockCols, blockFor, blockStep, BLOCK_FULL } from '../src/model/tile-layout.ts';
test('a block keeps its share of the row on any number of columns: two that shared a row still share it', () => {
  const rooms = blockWidth(7 / 12), side = blockWidth(5 / 12);
  assert.equal(rooms + side, BLOCK_FULL);
  for (let cols = 1; cols <= 12; cols++) { if (cols === 1) continue; assert.ok(blockCols(rooms, cols) + blockCols(side, cols) <= cols, `cols ${cols}`); }
  for (let cols = 1; cols <= 12; cols++) assert.equal(blockCols(BLOCK_FULL, cols), cols);
  assert.equal(blockWidth(1), BLOCK_FULL); assert.equal(blockWidth(0.01), 1);
});
test('the width asked for in columns is the width drawn (up to eight columns)', () => {
  for (let cols = 1; cols <= 8; cols++) for (let k = 1; k <= cols; k++) assert.equal(blockCols(blockFor(k, cols), cols), k, `${k} of ${cols}`);
});
test('an arrangement saved before the page had blocks keeps the blocks first; a block away now keeps its place', () => {
  const saved: Array<[string, number, number]> = [['card:a', 2, 2], ['card:b', 1, 1]];
  const shown = arrangeB(['ep:total', 'ep:chart', 'ep:gas', 'card:a', 'card:b'], saved, () => ({ w: BLOCK_FULL, h: 1 }), 8);
  assert.deepEqual(shown.map(x => x.key), ['ep:total', 'ep:chart', 'ep:gas', 'card:a', 'card:b']);
  // «Месяц» has no «Зарядки»: saving there keeps the block where it stood for «День»
  const day: Array<[string, number, number]> = [['ep:chart', 8, 1], ['ep:sessions', 8, 1], ['ep:total', 8, 1]];
  const kept = keepB(arrangeB(['ep:total', 'ep:chart'], day, () => ({ w: 8, h: 1 }), 8), day);
  assert.deepEqual(kept.map(r => r[0]), ['ep:chart', 'ep:sessions', 'ep:total']);
});

// ---- the module cards on pages (the feeder, the kettle, the air fryer, «Воздух») ----
import { PROFILES, pageable, pageModule, modulesOnPage, builtinCard, builtinsOnPage, selfDrawn as selfDrawnP, PAGE_MODULES } from '../src/model/card-catalog.ts';
import { readdirSync } from 'node:fs';
test('a page is offered exactly to the cards that are drawn there', () => {
  for (const p of PROFILES) {
    if (p.renderer === 'heatingRooms') { assert.equal(builtinCard(p), 'heating', p.id); assert.equal(pageable(p), true, p.id); continue; }
    if (!selfDrawnP(p)) { assert.equal(pageable(p), true, p.id); continue; }
    assert.equal(pageable(p), pageModule(p) || !!builtinCard(p), p.id);
    assert.ok(!(pageModule(p) && builtinCard(p)), p.id); // one way to draw it, not two
  }
  for (const id of PAGE_MODULES) assert.ok(PROFILES.some(p => p.module === id), id);
  // every module with a tile that opens its own sheet (`sheetKey`) is one of them, and only those
  const dir = resolve(import.meta.dirname, '../src/modules'), withSheet = readdirSync(dir).filter(f => f.endsWith('.tsx') && /\bsheetKey: '/.test(readFileSync(resolve(dir, f), 'utf8')));
  assert.equal(withSheet.length, PAGE_MODULES.length, withSheet.join(' '));
});
test('a module card put on a page stands there once', () => {
  const feeder = PROFILES.find(p => p.module === 'pet_feeder')!, cam = PROFILES.find(p => p.renderer === 'module' && !pageModule(p))!;
  const inst = (profileId: string, placement: string[]) => ({ profileId, profileVersion: '1.0.0', bindings: {}, placement }) as never;
  const all = { a: inst(feeder.id, ['rooms', 'security']), b: inst(feeder.id, ['rooms']), c: inst(cam.id, ['rooms']) };
  assert.deepEqual(modulesOnPage(all, 'rooms'), [['a', 'pet_feeder']]);
  assert.deepEqual(modulesOnPage(all, 'security'), [['a', 'pet_feeder']]);
  assert.deepEqual(modulesOnPage(all, 'energy'), []);
});
test('one step wider or narrower always changes the width drawn, on any number of columns', () => {
  for (let cols = 2; cols <= 20; cols++) for (let w = 1; w <= BLOCK_FULL; w++) {
    const cur = blockCols(w, cols), up = blockStep(w, cols, 1), down = blockStep(w, cols, -1);
    if (cur < cols) assert.ok(blockCols(up, cols) > cur, `wider ${w} of ${cols}`); else assert.equal(up, w);
    if (blockCols(1, cols) < cur) assert.ok(blockCols(down, cols) < cur, `narrower ${w} of ${cols}`); else assert.equal(down, w);
  }
});
test('the panel\'s own big cards put on a page: each once, whatever number of cameras the house has', () => {
  const of = (k: string) => PROFILES.filter(p => builtinCard(p) === k).map(p => p.id);
  for (const k of ['cameras', 'vacuum', 'heating', 'boiler', 'clock']) assert.ok(of(k).length > 0, k);
  const inst = (profileId: string, placement: string[]) => ({ profileId, profileVersion: '1.0.0', bindings: {}, placement }) as never;
  const cams = of('cameras'), all = { a: inst(cams[0], ['security']), b: inst(cams[1] ?? cams[0], ['security', 'rooms']), c: inst(of('vacuum')[0], ['rooms']), d: inst(of('heating')[0], ['home']) };
  assert.deepEqual(builtinsOnPage(all, 'security'), ['cameras']);
  assert.deepEqual(builtinsOnPage(all, 'rooms'), ['cameras', 'vacuum']);
  assert.deepEqual(builtinsOnPage(all, 'energy'), []);
});
