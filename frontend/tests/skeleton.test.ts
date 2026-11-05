import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKELETON_CSS, THEME_KEY, readSkeletonTheme, rememberSkeletonTheme, skeletonHtml } from '../src/ui/skeleton.js';

const loader = readFileSync(new URL('../../custom_components/atom_home/__init__.py', import.meta.url), 'utf8');
const fakeStorage = () => { const m = new Map<string, string>(); (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; return m; };

test('S2: the skeleton does not follow the system theme', () => {
  assert.ok(!SKELETON_CSS.includes('prefers-color-scheme'));
  assert.ok(!loader.includes('prefers-color-scheme'));
});
test('S2: skeleton is light unless the panel left dark', () => {
  assert.ok(!skeletonHtml().includes('is-dark'));
  assert.ok(skeletonHtml(undefined, 'dark').includes('hm-skeleton is-dark'));
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.equal(readSkeletonTheme(), 'light'); // no storage at all: no crash
  fakeStorage(); assert.equal(readSkeletonTheme(), 'light');
  rememberSkeletonTheme('dark'); assert.equal(readSkeletonTheme(), 'dark');
  rememberSkeletonTheme('light'); assert.equal(readSkeletonTheme(), 'light');
});
test('S2: the loader carries the same CSS and reads the same key as the bundle', () => {
  assert.ok(loader.includes(SKELETON_CSS), 'LOADER_JS drifted from ui/skeleton.js');
  assert.ok(loader.includes(`localStorage.getItem('${THEME_KEY}')`));
});
