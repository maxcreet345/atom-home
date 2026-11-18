// Fixes from the full audit of 17.11.2026 (book/06-dashboards/AUDIT-2026-11-17.md)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mayReloadAfterCrash, mayReloadForUpdate, newerVersion, errorReporter, whenIdle } from '../src/runtime/self-heal.ts';

const memory = (): Storage => { const m = new Map<string, string>(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } }; };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('C-1: a crash reloads the page at most three times in a quarter of an hour, then stops', () => {
  const s = memory(), t0 = 1_000_000;
  assert.equal(mayReloadAfterCrash(t0, s), true);
  assert.equal(mayReloadAfterCrash(t0 + 1000, s), true);
  assert.equal(mayReloadAfterCrash(t0 + 2000, s), true);
  assert.equal(mayReloadAfterCrash(t0 + 3000, s), false, 'the fourth crash in the window is left on screen');
  assert.equal(mayReloadAfterCrash(t0 + 16 * 60_000, s), true, 'after the window it may reload again');
});

test('C-1: every page, sheet and home tile is drawn inside a guard; the panel itself too', () => {
  const app = src('ui/app.tsx'), live = src('live-main.tsx');
  assert.match(app, /<div className="hm-page" key=\{pageKey\}><Guard where=\{`page:\$\{pageKey\}`\} kind="page"/);
  for (const sheet of ['ClockSheet', 'AirSheet', 'KettleSheet', 'FryerSheet', 'FeederSheet']) assert.match(app, new RegExp(`<Guard where="sheet:${sheet}" kind="sheet"[^>]*><${sheet} `));
  assert.match(app, /<Guard where=\{`sheet:\$\{device\.key\}`\} kind="sheet"/);
  const cards = app.match(/<m\.def\.Card /g)?.length ?? 0, guarded = app.match(/kind="tile" t=\{t\}><m\.def\.Card /g)?.length ?? 0;
  assert.equal(guarded, cards, 'every module card has its own guard');
  for (const tile of ['SecurityTile', 'HeatingTile', 'VacuumTile', 'CamerasTile', 'CameraTile', 'ClockTile']) assert.match(app, new RegExp(`kind="tile" t=\\{t\\}><${tile} `));
  assert.match(live, /<Guard where="panel" kind="panel" fallback=\{fallback\} onFail=/);
  assert.match(live, /addEventListener\('unhandledrejection'/);
});

test('H-2: the page reloads for a newer integration, once per version, never for an older one', () => {
  assert.equal(newerVersion('1.29.0', '1.28.0'), true);
  assert.equal(newerVersion('1.28.10', '1.28.9'), true);
  assert.equal(newerVersion('1.28.0', '1.28.0'), false);
  assert.equal(newerVersion('1.27.2', '1.28.0'), false, 'HA not restarted yet: that is the «restart» badge, not a reload');
  assert.equal(newerVersion(undefined, '1.28.0'), false);
  assert.equal(newerVersion('1.29.0', null), false, 'a dev bundle has no version');
  const s = memory();
  assert.equal(mayReloadForUpdate('1.29.0', s), true);
  assert.equal(mayReloadForUpdate('1.29.0', s), false, 'a reload that still got the old bundle is not repeated');
  assert.equal(mayReloadForUpdate('1.29.1', s), true);
});

test('H-2: the reload waits for a quiet screen: a touch starts the wait again', async () => {
  const listeners = new Map<string, () => void>();
  const target = { addEventListener: (e: string, f: () => void) => { listeners.set(e, f); }, removeEventListener: (e: string) => { listeners.delete(e); } } as unknown as Window;
  let ran = 0; whenIdle(() => { ran++; }, 40, target);
  await new Promise(r => setTimeout(r, 25)); listeners.get('pointerdown')!();
  await new Promise(r => setTimeout(r, 25)); assert.equal(ran, 0, 'the touch put it off');
  await new Promise(r => setTimeout(r, 40)); assert.equal(ran, 1);
  assert.equal(listeners.size, 0, 'it stops listening once done');
});

test('C-1: errors go to the HA log at most five times a page, each different error once', () => {
  const sent: string[] = []; const orig = console.error; console.error = () => undefined;
  try {
    const report = errorReporter(async m => { sent.push(m); });
    report(new Error('boom'), 'tile:clock'); report(new Error('boom'), 'tile:clock');
    for (let i = 0; i < 10; i++) report(new Error(`e${i}`), 'page:home');
  } finally { console.error = orig; }
  assert.equal(sent.length, 5);
  assert.match(sent[0], /^Atom Home panel \(tile:clock\): Error: boom/);
});
