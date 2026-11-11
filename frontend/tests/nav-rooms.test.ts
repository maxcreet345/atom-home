// 1.27.0 «menu and rooms»: the menu (rail and the phone's bar with «Ещё»), the old addresses, «Комнаты» on one screen and the drawn room pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, encode, repair, type View } from '../src/runtime/route.ts';
import { splitBar } from '../src/ui/shell-logic.ts';
import { fitRooms } from '../src/ui/rooms-fit.ts';
import { SCENES, palette, roomArtSvg, roomArtUrl, roomArtStyle } from '../src/ui/room-art.ts';
import { roomType, stockRoomArt } from '../src/ui/art.ts';
import { translator } from '../src/i18n/index.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const app = src('ui/app.tsx');

test('the rail: Дом, Комнаты, Свет, Устройства, Энергия, Безопасность, then Настройка for an administrator', () => {
  const nav = /const NAV[^=]*= \[(.*?)\];/.exec(app)?.[1] ?? '';
  assert.deepEqual([...nav.matchAll(/id: '(\w+)'/g)].map(m => m[1]), ['home', 'rooms', 'lights', 'systems', 'energy', 'security']);
  assert.match(app, /host\.admin \? \[\{ id: 'setup' as const, icon: 'gear' \}\]/, 'Настройка last, for the administrator');
  assert.match(app, /const DEVICE_TABS: Section\[\] = \['systems', 'climate', 'cleaning', 'camera'\]/, '«Устройства» keeps «Климат» and «Уборка» (and «Камеры»); «Энергия» and «Безопасность» left it');
  for (const [lang, want] of [['ru', 'Устройства'], ['en', 'Devices'], ['ro', 'Dispozitive']] as const) assert.equal(translator(lang)('section.systems'), want);
  // every item of the menu can be hidden by the settings, and an item with nothing to show is not drawn
  assert.match(app, /n\.id === 'systems' \? systemTabs\.length > 0 : shown\(n\.id\)/);
  assert.match(app, /const shown = \(s: Section\) => present\(s\) && !config\.sections\[s\]\?\.hidden/);
});

test('the phone\'s bar: five places at most — four and «Ещё» with the rest, in their order', () => {
  const all = ['home', 'rooms', 'lights', 'systems', 'energy', 'security', 'setup'];
  assert.deepEqual(splitBar(all), { bar: ['home', 'rooms', 'lights', 'systems'], more: ['energy', 'security', 'setup'] });
  assert.deepEqual(splitBar(all.slice(0, 6)), { bar: ['home', 'rooms', 'lights', 'systems'], more: ['energy', 'security'] }, 'not an administrator');
  assert.deepEqual(splitBar(all.slice(0, 5)), { bar: all.slice(0, 5), more: [] }, 'five fit: no «Ещё»');
  assert.deepEqual(splitBar(['home', 'rooms', 'systems']), { bar: ['home', 'rooms', 'systems'], more: [] });
  // «Ещё» is a disclosure: a button with aria-expanded and aria-controls, its pages plain buttons with aria-current, Escape gives the focus back
  assert.match(app, /className=\{`at-more-btn [^`]*`\} aria-expanded=\{moreOpen\} aria-controls=\{`\$\{uid\}-more`\}/);
  assert.match(app, /id=\{`\$\{uid\}-more`\}[^>]*role="group" aria-label=\{t\('section\.more'\)\} hidden=\{!moreOpen\}/);
  assert.match(app, /e\.key === 'Escape' && moreOpen\) \{ e\.preventDefault\(\); setMoreOpen\(false\); moreBtn\.current\?\.focus\(\)/);
});

test('the old addresses keep working: kiosks and the status strip have them saved', () => {
  const v = (h: string) => decode(h);
  assert.deepEqual(v('#systems?filter=attention'), { section: 'systems', room: null, device: null, filter: 'attention' });
  for (const s of ['climate', 'cleaning', 'energy', 'security', 'camera', 'systems']) assert.equal(v(`#${s}`).section, s);
  assert.equal(encode(v('#energy?filter=now')), '#energy?filter=now');
  assert.equal(encode(v('#systems?device=e:light.a')), '#systems?device=e%3Alight.a');
  // a hidden tab of «Устройства» is its first shown one; a hidden «Энергия» or «Безопасность» is Home
  const known = { sections: ['home', 'rooms', 'setup', 'lights', 'systems', 'cleaning', 'energy'], systems: ['systems', 'cleaning'], allSystems: ['systems', 'climate', 'cleaning', 'camera'], rooms: [], sheet: false };
  assert.equal(encode(repair(v('#climate'), known)!), '#systems');
  assert.equal(encode(repair(v('#security'), known)!), '#home');
  assert.equal(repair(v('#energy?filter=now'), known), null, 'a shown page stays as it was');
  assert.equal(repair(v('#systems?filter=attention'), known), null);
});

test('«Комнаты» fit one screen on every class of the device list, for 8 and for 12 rooms', () => {
  // the free box under the header, measured on the real preview build: width × height, the grid's gap
  const boxes: Array<[string, number, number, number]> = [['320×568', 296, 400, 10], ['360×792', 336, 604, 10], ['375×667', 351, 480, 10], ['344×882', 320, 690, 10], ['1070×764', 942, 640, 10], ['764×1070', 636, 946, 10], ['1440×900', 1312, 772, 10], ['2560×1080', 2400, 950, 10], ['TV 1920×1080', 832, 418, 10], ['874×402', 746, 300, 10]];
  for (const [name, width, height, gap] of boxes) for (const count of [8, 12]) {
    const f = fitRooms({ count, width, height, gap, minH: 88, minW: 88 });
    assert.equal(f.scroll, false, `${name}, ${count} rooms`);
    assert.ok(f.cols * f.rows >= count && f.tileH >= 88 && f.tileW >= 88, `${name}, ${count}: ${JSON.stringify(f)}`);
    assert.ok(f.rows * f.tileH + (f.rows - 1) * gap <= height + 0.5 && f.cols * f.tileW + (f.cols - 1) * gap <= width + 0.5, `${name}, ${count}: inside the box`);
    assert.ok(f.tileH <= f.tileW * 1.6 + 1 && f.tileW <= f.tileH * 2.4 + 1, `${name}, ${count}: neither a tower nor a strip`);
    // the grid uses the height it has (review 11.11: the TV and 1440×900 left a third empty)
    assert.ok(f.rows * f.tileH + (f.rows - 1) * gap >= 0.85 * height || f.cols * f.tileW + (f.cols - 1) * gap >= 0.85 * width, `${name}, ${count}: fills its box ${JSON.stringify(f)}`);
  }
  // large text: the minimums grow with the font, and then the page may scroll
  assert.equal(fitRooms({ count: 8, width: 336, height: 604, gap: 10, minH: 176, minW: 200 }).scroll, true);
  // one room is one tile, never a full-screen poster
  const one = fitRooms({ count: 1, width: 1312, height: 772, gap: 10, minH: 88, minW: 88 }); assert.ok(one.tileW <= one.tileH * 2.4 + 1 && one.tileH <= one.tileW * 1.6 + 1);
});

const lum = (h: string) => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
test('the room pictures: eight kinds and a generic one, a day and an evening version, small, and the words on their ground at 4.5:1 and more', () => {
  assert.deepEqual(SCENES, ['living', 'bedroom', 'kids', 'kitchen', 'bathroom', 'hall', 'storage', 'office', 'other']);
  for (const k of SCENES) for (const th of ['light', 'dark'] as const) {
    const p = palette(k, th), svg = roomArtSvg(k, th);
    for (const bg of [p.bg1, p.bg2]) { assert.ok(contrast(p.ink, bg) >= 7, `${k}/${th}: the name on ${bg}`); assert.ok(contrast(p.ink2, bg) >= 4.5, `${k}/${th}: the readings on ${bg}`); }
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d ]+" preserveAspectRatio="xMaxYMax meet"/); assert.ok(svg.length < 9000, `${k}/${th}: ${svg.length} bytes`);
    assert.ok(!/undefined|NaN/.test(svg), `${k}/${th}: every colour and number is set`);
    assert.equal((svg.match(/<g/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length, `${k}/${th}: groups closed`);
    assert.match(roomArtUrl(k, th), /^data:image\/svg\+xml;charset=utf-8,/); assert.match(roomArtStyle(k, th), /--ra-bg1:#[0-9a-f]{6};--ra-bg2:#[0-9a-f]{6};--ra-ink:/);
  }
  // the evening is lit (the lamps glow), the day is not; the two versions differ
  assert.notEqual(roomArtSvg('living', 'light'), roomArtSvg('living', 'dark')); assert.match(roomArtSvg('living', 'dark'), /fill="url\(#ra-g\)"/); assert.doesNotMatch(roomArtSvg('living', 'light'), /fill="url\(#ra-g\)"/);
  assert.match(roomArtSvg('kids', 'dark', false, 'P0-3'), /id="ra-g-P0-3"/, 'two pictures on a page keep their gradients apart');
  // the photoreal pictures are gone; a room's photo slot falls back to the drawing, and the owner's photo still wins on the tile
  assert.equal(roomType('Гостиная'), 'living'); assert.match(stockRoomArt('Подъезд'), /^data:image\/svg/); assert.match(stockRoomArt('Чердак'), /^data:image\/svg/);
  const cards = src('ui/cards.tsx'); assert.match(cards, /if \(own\) return <button[^\n]*is-photo/); assert.match(cards, /is-art ra-\$\{kind\}/); assert.doesNotMatch(src('styles/atom.css'), /\.ra-pic\{[^}]*opacity:\s*\.[0-7]/, 'no faded drawing');
});
