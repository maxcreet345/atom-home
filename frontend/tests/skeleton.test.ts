import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKELETON_CSS, THEME_KEY, LANG_KEY, SKELETON_TEXT, readSkeletonTheme, rememberSkeletonTheme, skeletonHtml } from '../src/ui/skeleton.js';

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

test('the loader says «Подключаемся…» in the language the panel left, before the bundle is here', () => {
  // the three lines of LOADER_JS that build the skeleton, run as the browser would run them
  const js = loader.slice(loader.indexOf('const savedTheme'), loader.indexOf('const deep = '));
  const html = (stored: Record<string, string>, browser = 'de-DE') => new Function('localStorage', 'navigator', `${js}; return SKELETON;`)({ getItem: (k: string) => stored[k] ?? null }, { language: browser }) as string;
  for (const lang of ['ru', 'en', 'ro'] as const) assert.ok(html({ [LANG_KEY]: lang }).includes(`<p>${SKELETON_TEXT[lang].wait}</p>`), lang);
  assert.ok(html({ selectedLanguage: '"en-GB"' }).includes(SKELETON_TEXT.en.wait), 'no panel language yet: Home Assistant\'s');
  assert.ok(html({}, 'ro-MD').includes(SKELETON_TEXT.ro.wait), 'then the browser\'s');
  assert.ok(html({ [LANG_KEY]: 'xx' }).includes(SKELETON_TEXT.ru.wait), 'an unknown one: Russian');
  assert.ok(new Function('navigator', `const localStorage = { getItem() { throw new Error('denied'); } }; ${js}; return SKELETON;`)({ language: 'en' }).includes(SKELETON_TEXT.ru.wait), 'no storage: no crash');
});
test('HACS asks for the Home Assistant that has the static paths the integration registers', () => {
  const min = JSON.parse(readFileSync(new URL('../../hacs.json', import.meta.url), 'utf8')).homeassistant.split('.').map(Number);
  assert.ok(min[0] > 2024 || (min[0] === 2024 && min[1] >= 7), 'StaticPathConfig / async_register_static_paths appeared in 2024.7');
});
