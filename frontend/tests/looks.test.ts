// The panel's looks («Оформление», 22.11.2026): the same cards in another dress. The setting is kept only when it names a look the panel has;
// the classic look is the absence of the setting; and a look's stylesheet touches nothing outside its own look (so the classic panel is unchanged)
// and moves nothing (no layout properties).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOOKS, isLook, normaliseConfig } from '../src/model/config.ts';
import { ru } from '../src/i18n/ru.ts';
import { en } from '../src/i18n/en.ts';
import { ro } from '../src/i18n/ro.ts';
const dictionaries = { ru, en, ro };

const dir = resolve(import.meta.dirname, '../src/styles/looks');
const withLook = (look: unknown) => normaliseConfig({ schemaVersion: 1, home: { name: 'Дом', language: 'ru', theme: 'dark', look } }).config.home;

test('the look is kept when the panel has it, and is absent otherwise', () => {
  for (const l of LOOKS.filter(l => l !== 'classic')) assert.equal(withLook(l).look, l);
  for (const bad of ['classic', 'paper', '', 7, null, undefined, { a: 1 }]) assert.equal('look' in withLook(bad), false, `«${String(bad)}» is not stored`);
  assert.equal(isLook('glass'), true); assert.equal(isLook('Glass'), false);
});

test('every look but the classic one has its stylesheet, and every stylesheet is a look', () => {
  assert.deepEqual(readdirSync(dir).map(f => f.replace(/\.css$/, '')).sort(), LOOKS.filter(l => l !== 'classic').slice().sort());
  const index = readFileSync(resolve(dir, '../looks.css'), 'utf8');
  for (const l of LOOKS.filter(l => l !== 'classic')) assert.ok(index.includes(`@import "./looks/${l}.css";`), `${l} is in looks.css`);
});

test('a look\'s rules are all scoped to that look, and none of them moves or resizes anything', () => {
  const layout = /(^|[;{\s])(display|position|width|height|min-width|max-width|min-height|max-height|margin[a-z-]*|grid[a-z-]*|flex[a-z-]*|gap|order|aspect-ratio|font-size|line-height|padding[a-z-]*|left|right|top|bottom|inset[a-z-]*)\s*:/;
  for (const l of LOOKS.filter(l => l !== 'classic')) {
    const css = readFileSync(resolve(dir, `${l}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // flatten @media / @supports: take every «selector{declarations}» pair at the innermost level
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().replace(/^@(media|supports)[^{]*$/, ''); if (!sel || sel.startsWith('@')) continue;
      for (const one of sel.split(/,(?![^(]*\))/)) assert.ok(one.trim().startsWith(`.hm-shell.ah-shell[data-look="${l}"]`), `${l}: «${one.trim().slice(0, 80)}» is scoped`);
      if (!/\.hm-tabbar/.test(sel)) assert.equal(layout.test(m[2]), false, `${l}: «${sel.slice(0, 60)}» changes no layout: ${m[2].slice(0, 90)}`);
    }
  }
});

test('every look has its name in every language', () => {
  for (const [lang, d] of Object.entries(dictionaries)) for (const l of LOOKS) assert.ok((d as Record<string, string>)[`setup.look.${l}`], `${lang}: setup.look.${l}`);
});

test('a look repaints neither the alarm card nor the danger status, and leaves a stacked row\'s tiles bare', () => {
  for (const l of LOOKS.filter(l => l !== 'classic')) {
    const css = readFileSync(resolve(dir, `${l}.css`), 'utf8');
    assert.ok(css.includes(`[data-look="${l}"] .hm-sheet.is-alarm{box-shadow:0 0 0 3px var(--ah-red`), `${l}: the alarm card's red ring`);
    assert.ok(css.includes(`[data-look="${l}"] .ah-tile-stack .ah-tile.ah-tile{background:none;box-shadow:none`), `${l}: stacked tiles`);
    for (const m of css.matchAll(/:is\(\.hm-card,\.ah-tile,\.ah-status\)(:not\([^)]*\)[^)]*\))?/g)) assert.ok((m[1] ?? '').includes('.tone-danger'), `${l}: the shared surface rule spares the danger status`);
  }
});
