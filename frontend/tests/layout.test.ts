// Layout decisions of the shell (ui/panel-size.ts) and the stylesheet rules that depend on them (audit 2026-11-09, slice B).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { panelLayout, panelScale, panelInput, isTv, WIDTH_STEPS, HEIGHT_STEPS } from '../src/ui/panel-size.ts';

const touch = { noHover: true, noPointer: false }, mouse = { noHover: false, noPointer: false }, remote = { noHover: true, noPointer: true };
const css = ['apple', 'atom', 'room'].map(n => readFileSync(new URL(`../src/styles/${n}.css`, import.meta.url), 'utf8')).join('\n');
const cls = (w: number, h: number, input = touch) => panelLayout({ width: w, height: h }, input).classes.split(' ');

test('the size classes follow the panel, not the window: an iPad beside the HA sidebar is a 924 px panel', () => {
  const inHa = cls(1180 - 256, 820), alone = cls(1180, 820);
  assert.ok(alone.includes('pw-1180') && !inHa.includes('pw-1180'));
  assert.ok(inHa.includes('is-wide') && inHa.includes('is-landscape') && inHa.includes('pw-701') && !inHa.includes('pw-980'));
});

test('the owner\'s devices keep their layout classes', () => {
  assert.deepEqual(cls(360, 792).filter(c => c.startsWith('is-')), ['is-narrow', 'is-portrait']);
  assert.deepEqual(cls(1070, 764).filter(c => c.startsWith('is-')), ['is-wide', 'is-landscape']);
  assert.deepEqual(cls(792, 360).filter(c => c.startsWith('is-')), ['is-wide', 'is-landscape', 'is-short']);
  assert.deepEqual(cls(764, 1070).filter(c => c.startsWith('is-')), ['is-wide', 'is-portrait']);
  assert.deepEqual(cls(640, 900, mouse).filter(c => c.startsWith('is-')), ['is-wide', 'is-compact', 'is-portrait']);
});

test('phones, tablets, laptops and ultrawide monitors up to 1440 px tall are drawn 1:1', () => {
  for (const [w, h, input] of [[360, 792, touch], [1070, 764, touch], [1366, 1024, touch], [1920, 1080, mouse], [2560, 1440, mouse], [5120, 1440, mouse], [3440, 1440, mouse], [800, 480, remote] /* a small screen with a remote is never drawn smaller */] as const) assert.equal(panelScale(w, h, input), 1, `${w}×${h}`);
});

test('a television is laid out as 960×540 and enlarged; a 4K monitor at 100 % as 2560×1440', () => {
  assert.equal(panelScale(960, 540, remote), 1);
  assert.equal(panelScale(1280, 720, remote), 1.33);
  assert.equal(panelScale(1920, 1080, remote), 2);
  assert.equal(panelScale(3840, 2160, remote), 4);
  assert.equal(panelScale(3840, 2160, mouse), 1.5);
  const tv = panelLayout({ width: 1920, height: 1080 }, remote);
  assert.deepEqual([tv.width, tv.height, tv.tv, tv.short, tv.wide], [960, 540, true, true, true]);
  assert.ok(tv.classes.split(' ').includes('is-tv'));
  assert.ok(!panelLayout({ width: 1280, height: 800 }, touch).tv, 'a 1280×800 tablet is not a television');
  assert.equal(panelScale(1920, 1080, touch), 2, 'a Full HD screen without a mouse is read from afar, as before (UI-1)');
});

test('a touch screen is never a television, however large: a 1920 px wall kiosk is laid out 1:1 (round 2: l145 / l175)', () => {
  const kiosk = { noHover: true, noPointer: false, touch: true }, tvBrowser = { noHover: true, noPointer: false, touch: false };
  assert.equal(panelScale(1920, 1080, kiosk), 1); assert.equal(panelScale(2560, 1440, kiosk), 1); assert.equal(panelScale(3840, 2160, kiosk), 1);
  const k = panelLayout({ width: 1920, height: 1080 }, kiosk);
  assert.deepEqual([k.width, k.height, k.tv, k.scale], [1920, 1080, false, 1]); assert.ok(!k.classes.split(' ').includes('is-tv') && k.classes.split(' ').includes('pw-1300'));
  assert.equal(isTv(1920, kiosk), false); assert.equal(isTv(1920, { noHover: true, noPointer: true, touch: true }), false, 'fingers on the glass win over «no pointer»');
  // a television stays one: a remote only, or a TV browser that calls its remote a coarse pointer on a Full HD screen
  assert.equal(panelScale(1920, 1080, tvBrowser), 2); assert.equal(isTv(1920, remote), true); assert.equal(isTv(1280, remote), true); assert.equal(isTv(1280, tvBrowser), false);
  // what the browser says: touch points make the difference
  const win = (touch: number, none: boolean) => ({ matchMedia: (q: string) => ({ matches: /any-hover: none/.test(q) || (none && /any-pointer: none/.test(q)) }), navigator: { maxTouchPoints: touch } }) as unknown as Parameters<typeof panelInput>[0];
  assert.deepEqual(panelInput(win(10, false)), { noHover: true, noPointer: false, touch: true });
  assert.deepEqual(panelInput(win(0, true)), { noHover: true, noPointer: true, touch: false });
  assert.equal(panelLayout({ width: 1920, height: 1080 }, panelInput(win(5, false))).tv, false); assert.equal(panelLayout({ width: 1920, height: 1080 }, panelInput(win(0, true))).tv, true);
  assert.deepEqual(panelInput(undefined), { noHover: false, noPointer: false, touch: false });
});

test('every panel size class used by the stylesheets is one the shell can set, and the other way round', () => {
  const used = new Set([...css.matchAll(/\.(p[wh])-(\d+)/g)].map(m => `${m[1]}-${m[2]}`));
  const known = new Set([...WIDTH_STEPS.map(n => `pw-${n}`), ...HEIGHT_STEPS.map(n => `ph-${n}`)]);
  assert.deepEqual([...used].filter(c => !known.has(c)), [], 'used in CSS, never set');
  assert.deepEqual([...known].filter(c => !used.has(c)), [], 'set, never used');
});

test('no stylesheet rule decides the panel\'s layout from the window: width, height and orientation queries are gone, viewport units too', () => {
  const media = [...css.matchAll(/@media\s*([^{]+)\{/g)].map(m => m[1].trim()).filter(q => /(width|height|orientation)/.test(q));
  assert.deepEqual(media, []);
  const units = [...css.matchAll(/[\s:(,*-](\d*\.?\d+)(vw|vh|vmin|vmax)\b/g)].map(m => m[0].trim());
  assert.deepEqual(units.filter(u => u !== ':100vw' /* the fallback of --hm-width before the shell measures itself */), []);
});

test('font sizes follow the root font size: none is set in px', () => {
  const px = [...css.matchAll(/font-size:[^;}]*?\d+px[^;}]*/g)].map(m => m[0]);
  assert.deepEqual(px, []);
});

test('pulsing dots animate transform and opacity only (no box-shadow keyframes)', () => {
  for (const name of ['ah-pulse', 'rm-pulse', 'at-ring']) { const body = new RegExp(`@keyframes ${name}\\{((?:[^{}]*\\{[^{}]*\\})+)\\}`).exec(css)?.[1] ?? ''; assert.ok(body, name); assert.ok(!/box-shadow|width|height|inset/.test(body), `${name}: ${body}`); }
});

test('safe areas reach the sides: the rail, the content, the tab bar and the sheets use the inset variables', () => {
  for (const v of ['--ah-safe-l', '--ah-safe-r', '--ah-safe-b']) assert.ok(css.split(`var(${v})`).length > 2, v);
  assert.match(css, /--ah-safe-l:env\(safe-area-inset-left,0px\)/);
});

test('native controls follow the panel\'s theme, and no hover style sits outside a hover query', () => {
  assert.match(css, /\.hm-shell\.ah-shell:not\(\[data-theme="dark"\]\)\{color-scheme:light\}/);
  assert.ok(!/(^|\})\.hm-shell \.at-ep-dev:hover\{/m.test(css.replace(/@media \(hover:hover\)\{[^{}]*\{[^{}]*\}\}/g, '')), '.at-ep-dev:hover is inside @media (hover:hover)');
});
