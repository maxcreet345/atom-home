// Product photos in the classic look (ui/photo.tsx, model/photos.ts, the «Фото приборов» section of styles/atom.css; docs/CONFIGURATOR.md).
// With `?photos=1` the previews fill the devices' photo slots from private/device-photos (scripts/photo-fixture.mjs). Light and dark, 1070×764 and
// 360×792: every spot that can hold a photo shows a picture that loaded, on a plate that separates ≥ 1.5:1 from white and from black, and the
// tile / head around it keeps exactly the size it has without the photo. Without photos the drawings and glyphs of today are there and no plate;
// a photo that does not load gives the drawing back (never a broken picture); a device with no connection or in alarm keeps its glyph; the upload
// keeps a cut-out's transparency for a device and stays JPEG for a room; a module that draws one appliance offers the same photo slot.
// usage: node scripts/qa-photos.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PHOTOS } from './photo-fixture.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/photos'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const fails = []; let passed = 0, servers = [], browser = null;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 300)}`); };
const stop = async code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); for (const s of servers) s.kill(); await browser?.close().catch(() => undefined); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); void stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); void stop(1); });
if (!existsSync(PHOTOS)) { fails.push(`no product photos at ${PHOTOS}: the photo checks cannot run`); await stop(1); }
const serve = async script => { const port = await freePort(), p = spawn(process.execPath, [resolve(root, 'scripts', script), String(port)], { stdio: 'pipe' }); servers.push(p); await new Promise(r => p.stdout.once('data', r)); return `http://127.0.0.1:${port}`; };
const panel = await serve('preview-server.mjs'), cards = await serve('card-preview.mjs');
browser = await chromium.launch();
// the camera previews ask for frames the preview does not serve, and the 404 test asks for a photo that is not there: those 404s are expected
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
const SIZES = [[1070, 764, 'pad'], [360, 792, 'phone']], THEMES = ['light', 'dark'];
const panelUrl = (theme, photos, hash) => `${panel}/?theme=${theme}${photos ? '&photos=1' : ''}${hash}`;
const cardUrl = (card, scenario, theme, photos, hash) => `${cards}/?card=${card}&scenario=${scenario}&theme=${theme}&lang=ru${photos ? '&photos=1' : ''}${hash}`;
async function open(url, { w, h, wait, route } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });
  if (route) await route(page);
  await page.goto(url); await page.waitForFunction(() => window.ready); if (wait) await page.waitForSelector(wait); await page.waitForTimeout(350);
  return { page, ctx, errors };
}
/** every plate under `sel`: its box, whether its picture loaded (lazy pictures are asked for first), the picture's source */
const plates = (page, sel) => page.evaluate(async sel => {
  const els = [...document.querySelectorAll(sel)];
  await Promise.all(els.map(e => { const img = e.querySelector('img'); if (!img) return null; img.loading = 'eager'; return img.decode().catch(() => undefined); }));
  return els.map(e => { const img = e.querySelector('img'), r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), ok: !!img && img.complete && img.naturalWidth > 0, src: img?.getAttribute('src') ?? null }; });
}, sel);
/** the plate as drawn: four points just inside its edges (where a cut-out leaves the plate bare), each against white and black */
async function plateContrast(page, handle) {
  const png = await handle.screenshot({ animations: 'disabled' });
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const W = img.width, H = img.height, lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return [[W / 2, 4], [4, H / 2], [W - 5, H / 2], [W / 2, H - 5]].map(([x, y]) => { const [r, gg, b] = g.getImageData(Math.round(x), Math.round(y), 1, 1).data, L = 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b); return { rgb: `${r},${gg},${b}`, white: +(1.05 / (L + 0.05)).toFixed(2), black: +((L + 0.05) / 0.05).toFixed(2) }; });
  }, png.toString('base64'));
}
const boxes = (page, sel) => page.evaluate(sel => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }), sel);
const same = (a, b) => a.length === b.length && a.length > 0 && a.every((x, i) => Math.abs(x[0] - b[i][0]) <= 0.5 && Math.abs(x[1] - b[i][1]) <= 0.5);
/** one spot: with the photo it shows a picture that loaded on a plate that separates from white and black; its box is the size it has without one */
async function spot(tag, withPage, plainPage, plateSel, boxSel, { contrast = true } = {}) {
  const p = await plates(withPage, plateSel);
  check(`${tag}: a photo is shown`, p.length > 0, plateSel);
  check(`${tag}: the photo loaded`, p.length > 0 && p.every(x => x.ok), p);
  if (contrast && p.length) { const c = await plateContrast(withPage, withPage.locator(plateSel).first()); check(`${tag}: the plate separates ≥ 1.5:1 from white and black`, c.every(x => x.white >= 1.5 && x.black >= 1.5), c); }
  if (boxSel) { const a = await boxes(withPage, boxSel), b = await boxes(plainPage, boxSel); check(`${tag}: the same size as without the photo`, same(a, b), { photo: a.slice(0, 6), plain: b.slice(0, 6) }); }
}
const noPlate = async (tag, page, scope = 'body') => { const n = await page.locator(`${scope} .ah-photo`).count(); check(`${tag}: no photo plate without photos`, n === 0, n); };
const shot = (page, name) => page.screenshot({ path: resolve(out, `${name}.png`) });

// 1. the whole panel: the feeder's tile (#home), the device tiles with a photo (#systems), the feeder's sheet, a device's sheet, a room's cards
for (const theme of THEMES) for (const [w, h, dev] of SIZES) {
  const tag = `${dev}/${theme}`;
  // #home: the feeder's tile; the robot's tile shows its own render
  { const a = await open(panelUrl(theme, true, '#home'), { w, h, wait: '[data-module-card="pet_feeder"]' }), b = await open(panelUrl(theme, false, '#home'), { w, h, wait: '[data-module-card="pet_feeder"]' });
    // the owner (11.11.2026): the feeder keeps its drawn cat even with a photo in its slot — the tile is today's, with and without photos
    check(`home feeder tile ${tag}: with a photo configured the cat is drawn, no plate`, await a.page.locator('[data-module-card="pet_feeder"] .at-fd-tile-cat>svg.at-cat').count() === 1 && await a.page.locator('[data-module-card="pet_feeder"] .ah-photo').count() === 0);
    check(`home feeder tile ${tag}: the same size as without photos`, same(await boxes(a.page, '[data-module-card="pet_feeder"]'), await boxes(b.page, '[data-module-card="pet_feeder"]')));
    check(`home feeder tile ${tag}: without photos the cat is drawn`, await b.page.locator('[data-module-card="pet_feeder"] .at-fd-tile-cat>svg.at-cat').count() === 1);
    await noPlate(`home ${tag}`, b.page);
    const vac = await plates(a.page, '.at-vac-tile .at-vac-pic'); check(`home vacuum tile ${tag}: the robot's render loaded`, vac.length === 1 && vac[0].ok, vac);
    // (the robot's renders are the vacuum card's own, older than the photo slot: on a phone its stacked tile grows to show the render by design, apple.css)
    if (dev === 'pad') check(`home vacuum tile ${tag}: the same size as with the drawn robot`, same(await boxes(a.page, '.at-vac-tile'), await boxes(b.page, '.at-vac-tile')));
    check(`home vacuum tile ${tag}: without renders the drawn robot (with its face)`, await b.page.locator('.at-vac-tile svg.at-vac-buddy').count() === 1);
    if (dev === 'pad' || theme === 'light') await shot(a.page, `home-${dev}-${theme}-photos`);
    check(`errors home ${tag}`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close(); }
  // #systems: the device tiles of appliances (the speaker; sensors, relays and the valve keep their pictograms — section 4)
  { const a = await open(panelUrl(theme, true, '#systems'), { w, h, wait: '.ah-tile[data-device-key]' }), b = await open(panelUrl(theme, false, '#systems'), { w, h, wait: '.ah-tile[data-device-key]' });
    const keys = await a.page.evaluate(() => [...document.querySelectorAll('.ah-tile[data-device-key]')].filter(t => t.querySelector('.ah-glyph>.ah-photo')).map(t => t.getAttribute('data-device-key')));
    check(`systems ${tag}: device tiles with a photo (the speaker)`, keys.length >= 1, keys);
    for (const k of keys) await spot(`systems tile ${k.slice(0, 14)} ${tag}`, a.page, b.page, `.ah-tile[data-device-key="${k}"] .ah-glyph>.ah-photo`, `.ah-tile[data-device-key="${k}"]`, { contrast: k === keys[0] });
    check(`systems ${tag}: every tile keeps its size`, same(await boxes(a.page, '.ah-tile'), await boxes(b.page, '.ah-tile')));
    check(`systems ${tag}: without photos the glyphs of today`, await b.page.locator('.ah-tile[data-device-key] .ah-glyph>svg').count() >= keys.length && keys.every(Boolean));
    await noPlate(`systems ${tag}`, b.page);
    if (dev === 'phone' || theme === 'light') await shot(a.page, `systems-${dev}-${theme}-photos`);
    // an appliance's sheet (the speaker): its head shows the photo, the head keeps its size
    const valve = keys[0];
    if (valve) { for (const p of [a.page, b.page]) { await p.evaluate(k => { location.hash = `#systems?device=${encodeURIComponent(k)}`; }, valve); await p.waitForSelector('.hm-sheet .hm-sheet-head'); await p.waitForTimeout(350); }
      await spot(`device sheet head ${tag}`, a.page, b.page, '.hm-sheet .hm-sheet-head .hm-sheet-photo>.ah-photo', '.hm-sheet .hm-sheet-head');
      check(`device sheet head ${tag}: without photos the stock picture / glyph of today`, await b.page.locator('.hm-sheet .hm-sheet-photo>:is(svg,.at-device-art)').count() >= 1 && await b.page.locator('.hm-sheet .ah-photo').count() === 0);
      if (dev === 'pad' || theme === 'dark') await shot(a.page, `device-sheet-${dev}-${theme}-photos`); }
    check(`errors systems ${tag}`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close(); }
  // the feeder's sheet keeps the drawn cat in its head and hero although a photo is configured (owner, 11.11.2026), and is the size it is without
  { const a = await open(panelUrl(theme, true, '#home?device=feeder'), { w, h, wait: '.at-feeder-sheet' }), b = await open(panelUrl(theme, false, '#home?device=feeder'), { w, h, wait: '.at-feeder-sheet' });
    for (const [p, side] of [[a.page, 'with a photo configured'], [b.page, 'without photos']]) check(`feeder ${tag} ${side}: the cat of 1.25.7 in the hero and the head, no plate, no word under a picture`, await p.locator('.at-fd-hero>svg.at-cat[role="img"]').count() === 1 && await p.locator('.at-fd-face>svg').count() === 1 && await p.locator('.at-feeder-sheet .ah-photo, .at-fd-mood').count() === 0);
    check(`feeder ${tag}: the hero and the head are the size they are without photos`, same(await boxes(a.page, '.at-fd-hero'), await boxes(b.page, '.at-fd-hero')) && same(await boxes(a.page, '.at-feeder-sheet .at-fd-head'), await boxes(b.page, '.at-feeder-sheet .at-fd-head')));
    await shot(a.page, `feeder-${dev}-${theme}-photos-configured`);
    check(`errors feeder ${tag}`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close(); }
  // a room's page: the device cards (the speaker in the living room)
  { const a = await open(panelUrl(theme, true, '#rooms?room=gostinaia'), { w, h, wait: '.rm-tile' }), b = await open(panelUrl(theme, false, '#rooms?room=gostinaia'), { w, h, wait: '.rm-tile' });
    await spot(`room card ${tag}`, a.page, b.page, '.rm-tile .rm-tile-ic>.ah-photo', '.rm-tile');
    check(`room card ${tag}: without photos the glyph of today`, await b.page.locator('.rm-tile .rm-tile-ic>svg').count() >= 1);
    await noPlate(`room ${tag}`, b.page);
    if (theme === 'light' || dev === 'pad') await shot(a.page, `room-${dev}-${theme}-photos`);
    check(`errors room ${tag}`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close(); }
}

// 2. the card preview: the kettle (tile on the Kitchen's page, sheet head, hero) and the doorbell's and the C700's sheets
for (const theme of THEMES) for (const [w, h, dev] of SIZES) {
  const tag = `${dev}/${theme}`;
  for (const scenario of ['idle', 'heating']) {
    const a = await open(cardUrl('kettle', scenario, theme, true, '#rooms?room=kukhnia'), { w, h, wait: '[data-module-card="kettle"]' }), b = await open(cardUrl('kettle', scenario, theme, false, '#rooms?room=kukhnia'), { w, h, wait: '[data-module-card="kettle"]' });
    await spot(`kettle tile ${scenario} ${tag}`, a.page, b.page, '[data-module-card="kettle"] .at-kt-tile-art>.ah-photo', '[data-module-card="kettle"]');
    check(`kettle tile ${scenario} ${tag}: without photos the drawing`, await b.page.locator('[data-module-card="kettle"] .at-kt-tile-art>svg.at-kt-art').count() === 1);
    await noPlate(`kitchen ${scenario} ${tag}`, b.page);
    if (scenario === 'heating') await shot(a.page, `kitchen-${dev}-${theme}-photos`);
    for (const p of [a.page, b.page]) { await p.evaluate(() => { location.hash = '#home?device=kettle'; }); await p.waitForSelector('.at-kt-sheet'); await p.waitForTimeout(350); }
    await spot(`kettle head ${scenario} ${tag}`, a.page, b.page, '.at-kt-face>.ah-photo', '.at-kt-sheet>.at-kt-head');
    await spot(`kettle hero ${scenario} ${tag}`, a.page, b.page, '.at-kt-hero>.at-kt-hero-pic', null);
    const hh = [await boxes(a.page, '.at-kt-hero'), await boxes(b.page, '.at-kt-hero')]; check(`kettle hero ${scenario} ${tag}: the same height as without the photo`, same(hh[0], hh[1]), hh);
    const beside = await a.page.evaluate(() => { const p = document.querySelector('.at-kt-hero-pic')?.getBoundingClientRect(), n = document.querySelector('.at-kt-temp')?.getBoundingClientRect(); return !!p && !!n && p.right <= n.left + 1 && p.bottom > n.top && p.top < n.bottom; });
    check(`kettle hero ${scenario} ${tag}: the photo stands beside the temperature`, beside);
    check(`kettle sheet ${scenario} ${tag}: without photos the drawing in the head, nothing added to the hero`, await b.page.locator('.at-kt-face>svg.at-kt-art').count() === 1 && await b.page.locator('.at-kt-hero>.ah-photo').count() === 0);
    await noPlate(`kettle sheet ${scenario} ${tag}`, b.page, '.at-kt-sheet');
    if (scenario === 'heating') await shot(a.page, `kettle-${dev}-${theme}-photos`);
    check(`errors kettle ${scenario} ${tag}`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close();
  }
  // the doorbell's sheet (the Aqara G4: its own model) and the C700's (CameraSheet; its camera entity sits on a Generic device, so its slot is set here)
  const c700 = async page => page.route(/\/__state\?/, async r => { const res = await r.fetch(), d = await res.json(), id = d.snapshot.entities.find(e => e.entity_id === 'camera.entrance_camera')?.device_id; if (id && new URL(r.request().url()).searchParams.get('photos') === '1') d.config.devices[`d:${id}`] = { ...(d.config.devices[`d:${id}`] ?? {}), photo: '/local/device-photos/chuangmi.camera.081ae2-s.webp' }; await r.fulfill({ response: res, json: d }); });
  for (const [what, hash, root] of [['doorbell', '#home?device=e%3Acamera.entrance_doorbell', '.at-door'], ['camera', '#home?device=e%3Acamera.entrance_camera', '.at-cam:not(.at-door)']]) {
    const a = await open(cardUrl('cameras', 'quiet', theme, true, hash), { w, h, wait: root, route: c700 }), b = await open(cardUrl('cameras', 'quiet', theme, false, hash), { w, h, wait: root, route: c700 });
    await spot(`${what} sheet head ${tag}`, a.page, b.page, `${root} .hm-sheet-head .hm-sheet-photo>.ah-photo`, `${root} .hm-sheet-head`);
    check(`${what} sheet head ${tag}: without photos the glyph of today`, await b.page.locator(`${root} .hm-sheet-head .hm-sheet-photo>svg`).count() === 1);
    if (what === 'doorbell' && (dev === 'pad' || theme === 'dark')) await shot(a.page, `doorbell-${dev}-${theme}-photos`);
    check(`errors ${what} ${tag}`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close();
  }
}
// the doorbell rings: its alarm head shows the photo too
{ const a = await open(cardUrl('cameras', 'ring', 'light', true, '#home'), { w: 1070, h: 764, wait: '.ah-face' }); await a.page.waitForSelector('.at-door.is-alarm', { timeout: 8000 }).catch(() => undefined);
  if (await a.page.locator('.at-door.is-alarm').count()) { const p = await plates(a.page, '.at-door.is-alarm .hm-sheet-photo>.ah-photo'); check('doorbell ringing: its head shows the photo', p.length === 1 && p[0].ok, p); await shot(a.page, 'doorbell-ring-pad-light-photos'); }
  else { await a.page.evaluate(() => { location.hash = '#home?device=e%3Acamera.entrance_doorbell'; }); await a.page.waitForSelector('.at-door'); const p = await plates(a.page, '.at-door .hm-sheet-photo>.ah-photo'); check('doorbell (ring scenario, opened by hand): its head shows the photo', p.length === 1 && p[0].ok, p); }
  await a.ctx.close(); }

// 3. a photo that does not load gives the drawing back, never a broken picture (the feeder, the speaker, the kettle)
{ const broken = async page => { await page.route(/\/config\.json/, async r => { const res = await r.fetch(), c = await res.json(); for (const v of Object.values(c.devices ?? {})) if (v.photo) v.photo = '/local/device-photos/missing-photo.webp'; await r.fulfill({ response: res, json: c }); }); };
  for (const [hash, wait] of [['#home', '[data-module-card="pet_feeder"]'], ['#systems', '.ah-tile[data-device-key]'], ['#home?device=feeder', '.at-feeder-sheet']]) {
    const a = await open(panelUrl('light', true, hash), { w: 1070, h: 764, wait, route: broken }); await a.page.waitForTimeout(500);
    await a.page.evaluate(async () => { for (const i of document.querySelectorAll('img')) { i.loading = 'eager'; await i.decode().catch(() => undefined); } }); await a.page.waitForTimeout(300);
    const st = await a.page.evaluate(() => ({ plates: document.querySelectorAll('.ah-photo').length, brokenImgs: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map(i => i.getAttribute('src')),
      catTile: document.querySelectorAll('[data-module-card="pet_feeder"] .at-fd-tile-cat>svg.at-cat').length, cat: document.querySelectorAll('.at-fd-hero svg.at-cat[role="img"]').length, word: [...document.querySelectorAll('.at-fd-mood')].some(x => getComputedStyle(x).display !== 'none'),
      glyphs: document.querySelectorAll('.ah-tile[data-device-key] .ah-glyph>svg').length, head: document.querySelectorAll('.at-fd-face>svg').length }));
    check(`404 ${hash}: no plate, no broken picture`, st.plates === 0 && st.brokenImgs.length === 0, st);
    if (hash === '#home') check('404 #home: the feeder tile draws its cat again', st.catTile === 1, st);
    if (hash === '#systems') check('404 #systems: the tiles show their glyphs again', st.glyphs >= 1, st);
    if (hash === '#home?device=feeder') { check('404 feeder sheet: the cat is back in the hero and the head, the word is hidden', st.cat === 1 && st.head === 1 && !st.word, st); await shot(a.page, 'feeder-404-pad-light'); }
    await a.ctx.close();
  }
  const kb = async page => page.route(/\/__state\?/, async r => { const res = await r.fetch(), d = await res.json(); for (const v of Object.values(d.config.devices ?? {})) if (v.photo) v.photo = '/local/device-photos/missing-photo.webp'; await r.fulfill({ response: res, json: d }); });
  const k = await open(cardUrl('kettle', 'heating', 'dark', true, '#home?device=kettle'), { w: 360, h: 792, wait: '.at-kt-sheet', route: kb }); await k.page.waitForTimeout(500);
  const ks = await k.page.evaluate(() => ({ plates: document.querySelectorAll('.ah-photo').length, art: document.querySelectorAll('.at-kt-face>svg.at-kt-art').length, broken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).length }));
  check('404 kettle sheet: the drawing in the head, nothing in the hero, no broken picture', ks.plates === 0 && ks.art === 1 && ks.broken === 0, ks); await k.ctx.close(); }

// 4. the owner's rule (11.11.2026, model/photos.ts takesPhoto): sensors, relays, plugs and the valve keep their pictograms even with a photo set in
//    their slot; no connection or an alarm: an appliance keeps its own glyph, never the photo (the speaker; the feeder's tile its cat)
{ const AUX = /Zigbee water sensor|Battery powered smart valve|Zigbee smart switch|MINI-D|WiFi Smart Switch/i, PHOTO = '/local/device-photos/yandex.station-lite-s.webp';
  const forced = async page => page.route(/\/config\.json/, async r => { const res = await r.fetch(), c = await res.json(), fx = await (await fetch(`${panel}/fixture.json`)).json();
    for (const d of fx.devices.filter(d => AUX.test(`${d.model ?? ''}`))) c.devices[`d:${d.id}`] = { ...(c.devices[`d:${d.id}`] ?? {}), photo: PHOTO }; await r.fulfill({ response: res, json: c }); });
  for (const theme of THEMES) {
    const a = await open(panelUrl(theme, true, '#systems'), { w: 1070, h: 764, wait: '.ah-tile[data-device-key]', route: forced });
    // since 1.27.0 «Устройства» lists devices only: a sensor, a relay, the valve is found by its search, as a person finds it there
    const search = async q => { await a.page.fill('.at-search', q); await a.page.waitForTimeout(300); };
    const auxNow = () => a.page.evaluate(() => [...document.querySelectorAll('.ah-tile[data-device-key]')].filter(t => /\bkind-(leak|valve|switch|socket|opening|motion|environment|alarm)\b/.test(t.className)).map(t => ({ key: t.getAttribute('data-device-key'), kind: t.className.match(/kind-(\w+)/)[1], plate: !!t.querySelector('.ah-photo'), glyph: !!t.querySelector('.ah-glyph>svg') })));
    const aux = []; for (const q of ['протечк', 'кран', 'выключател', 'розетк', 'реле']) { await search(q); for (const x of await auxNow()) if (!aux.some(y => y.key === x.key)) aux.push(x); }
    await search('');
    check(`${theme}: the rule is exercised — leak sensors, the valve and relays are on the page with a photo in their slot`, aux.some(x => x.kind === 'leak') && aux.some(x => x.kind === 'valve') && aux.length >= 4, aux.map(x => x.kind));
    check(`${theme}: a sensor, a relay, the valve keep their pictogram although a photo is set`, aux.length > 0 && aux.every(x => !x.plate && x.glyph), aux.filter(x => x.plate || !x.glyph));
    const tileOf = id => a.page.evaluate(id => { const t = [...document.querySelectorAll('.ah-tile[data-device-key]')].find(x => x.getAttribute('data-device-key').includes(id)); return t ? { key: t.getAttribute('data-device-key'), cls: t.className, plate: !!t.querySelector('.ah-glyph>.ah-photo'), glyph: !!t.querySelector('.ah-glyph>svg') } : null; }, id);
    check(`${theme}: the speaker shows its photo first`, (await tileOf('yandex_station'))?.plate, await tileOf('yandex_station'));
    const speaker = (await tileOf('yandex_station'))?.key.replace(/^e:/, '');
    await a.page.evaluate(id => window.atomPreview.setStates({ [id]: 'unavailable', 'binary_sensor.datchik_protechki_kukhnia_water_leak': 'on', 'button.kitchen_cat_feeder_dispense': 'unavailable' }), speaker); await a.page.waitForTimeout(400);
    const sp = await tileOf('yandex_station');
    check(`${theme}: a speaker with no connection shows its glyph, not the photo`, !!sp && sp.cls.includes('is-off') && !sp.plate && sp.glyph, sp);
    check(`${theme}: a feeder with no connection draws its cat on the tile`, await a.page.locator('[data-module-card="pet_feeder"] .at-fd-tile-cat>svg.at-cat').count() === 1 && await a.page.locator('[data-module-card="pet_feeder"] .ah-photo').count() === 0);
    await shot(a.page, `systems-offline-alarm-pad-${theme}-photos`);
    await search('протечк'); const leak = await tileOf('213bdcfb');
    check(`${theme}: a leak sensor in alarm shows its glyph`, !!leak && leak.cls.includes('is-alert') && !leak.plate && leak.glyph, leak);
    await shot(a.page, `systems-leak-alarm-pad-${theme}-photos`); await search('');
    await a.page.evaluate(() => { location.hash = '#rooms?room=gostinaia'; }); await a.page.waitForSelector('.rm-tile'); await a.page.waitForTimeout(300);
    check(`${theme}: the room's card of a speaker with no connection shows its glyph`, await a.page.locator('.rm-tile .rm-tile-ic>.ah-photo').count() === 0 && await a.page.locator('.rm-tile .rm-tile-ic>svg').count() >= 1);
    await a.page.evaluate(() => { location.hash = '#rooms?room=vannaia'; }); await a.page.waitForSelector('.rm-tile'); await a.page.waitForTimeout(300);
    check(`${theme}: the bathroom's valve card keeps its glyph although a photo is set`, await a.page.locator('.rm-tile .ah-photo').count() === 0 && await a.page.locator('.rm-tile .rm-tile-ic>svg').count() >= 1);
    await a.ctx.close();
  }
  // «Настройка»: a sensor or a relay is not offered a photo (one set before can still be removed); an appliance is
  const s = await open(panelUrl('light', true, '#setup'), { w: 1070, h: 764, wait: '.at-setup' });
  const fieldOf = async re => { const row = s.page.locator('.at-setup-row[data-device-key]').filter({ hasText: re }).first(); if (!await row.count()) return null; await row.locator('.hm-row-open').click(); await s.page.waitForTimeout(150); const n = await row.locator('.at-photo-field').count(); await row.locator('.hm-row-open').click(); return n; };
  const leakField = await fieldOf(/Протечка · Ванная/), speakerField = await fieldOf(/Яндекс Лайт|Умная колонка/);
  check('setup: a leak sensor is not offered a photo', leakField === 0, leakField); check('setup: an appliance (the speaker) is offered a photo', speakerField === 1, speakerField);
  await s.ctx.close(); }

// 5. the eBUS boiler's card (drawn on «Климат» in a house without the heating model): its head shows the boiler's photo, its size kept
{ const noHeating = photo => async page => { await page.route(/\/fixture\.json/, async r => { const res = await r.fetch(), f = await res.json(); delete f.states['input_select.heating_mode']; await r.fulfill({ response: res, json: f }); });
    if (photo) await page.route(/\/config\.json/, async r => { const res = await r.fetch(), c = await res.json(), fx = await (await fetch(`${panel}/fixture.json`)).json(); for (const id of new Set(fx.entities.filter(e => /ebusd/.test(e.entity_id) && e.device_id).map(e => e.device_id))) c.devices[`d:${id}`] = { ...(c.devices[`d:${id}`] ?? {}), photo: '/local/device-photos/avatto.WT410-s.webp' }; await r.fulfill({ response: res, json: c }); }); };
  for (const theme of THEMES) { const a = await open(panelUrl(theme, true, '#climate'), { w: 1070, h: 764, wait: '.at-boiler', route: noHeating(true) }), b = await open(panelUrl(theme, false, '#climate'), { w: 1070, h: 764, wait: '.at-boiler', route: noHeating(false) });
    await spot(`boiler head ${theme}`, a.page, b.page, '.at-boiler-head .at-module-art>.ah-photo', '.at-boiler-head');
    check(`boiler head ${theme}: without a photo the drawn boiler of today`, await b.page.locator('.at-boiler-head .at-module-art>.at-device-art').count() === 1);
    await shot(a.page, `boiler-pad-${theme}-photo`); check(`errors boiler ${theme}`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close(); } }

// 6. «Настройка»: the devices' thumbs; the modules that draw one appliance offer its photo (the same slot); an upload keeps a cut-out's transparency
{ const a = await open(panelUrl('light', true, '#setup'), { w: 1070, h: 764, wait: '.at-setup' }), b = await open(panelUrl('light', false, '#setup'), { w: 1070, h: 764, wait: '.at-setup' });
  await spot('setup thumbs', a.page, b.page, '.at-setup-row .hm-thumb>.ah-photo', '.at-setup-row .hm-thumb', { contrast: false });
  await noPlate('setup', b.page); await shot(a.page, 'setup-devices-pad-light-photos');
  // a transparent PNG for a device: WebP (or PNG) with its transparency; the same file for a room: JPEG
  const png = Buffer.from(await a.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#d23'; g.fillRect(100, 50, 100, 100); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  const row = a.page.locator('.at-setup-row[data-device-key]').filter({ hasText: /Умная колонка/ }).first(); // an appliance: its photo goes to its HA device's slot (one slot per appliance)
  const key = await a.page.evaluate(() => { const fx = window.atomPreview.config.devices; return Object.keys(fx).find(k => /yandex\.station-lite/.test(fx[k]?.photo ?? '')) ?? null; });
  await row.locator('.hm-row-open').click(); await a.page.waitForSelector('.at-setup-row .at-photo-field input[type=file]');
  await row.locator('.at-photo-field input[type=file]').setInputFiles({ name: 'cutout.png', mimeType: 'image/png', buffer: png });
  await a.page.waitForFunction(k => window.atomPreview.config.devices[k]?.photo?.startsWith('data:'), key, { timeout: 10000 }).catch(() => undefined);
  const up = await a.page.evaluate(async k => { const url = window.atomPreview.config.devices[k]?.photo ?? ''; if (!url.startsWith('data:')) return { url: url.slice(0, 40) }; const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return { type: url.slice(5, url.indexOf(';')), w: img.width, corner: g.getImageData(2, 2, 1, 1).data[3], middle: g.getImageData(Math.round(img.width / 2), Math.round(img.height / 2), 1, 1).data[3] }; }, key);
  check('setup: a device\'s transparent PNG is stored as a cut-out (WebP/PNG, transparent around, solid inside)', /^image\/(webp|png)$/.test(up.type ?? '') && up.corner === 0 && up.middle === 255, up);
  await a.page.locator('.at-setup-tabs button').nth(1).click(); await a.page.waitForTimeout(300);
  const room = a.page.locator('.at-setup-row[data-room-id]').first(), rid = await room.getAttribute('data-room-id').catch(() => null);
  const rf = rid ? room.locator('.at-photo-field input[type=file]') : a.page.locator('.at-photo-field input[type=file]').first();
  if (!(await rf.count())) { const opener = (rid ? room : a.page).locator('button[aria-expanded]').first(); if (await opener.count()) { await opener.click(); await a.page.waitForTimeout(200); } }
  await (rid ? room.locator('.at-photo-field input[type=file]') : a.page.locator('.at-photo-field input[type=file]').first()).setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: png });
  await a.page.waitForTimeout(800);
  const roomUp = await a.page.evaluate(() => Object.values(window.atomPreview.config.rooms ?? {}).map(r => r.photo).filter(p => p?.startsWith('data:')).map(p => p.slice(5, p.indexOf(';'))));
  check('setup: a room\'s photo stays JPEG', roomUp.length === 1 && roomUp[0] === 'image/jpeg', roomUp);
  // «Модули»: the boiler's and the kettle's photo field writes the device's slot the tiles read; the feeder has none
  await a.page.locator('.at-setup-tabs button').nth(5).click(); await a.page.waitForSelector('[data-module-id]');
  const mods = await a.page.evaluate(() => [...document.querySelectorAll('[data-module-id]')].map(r => ({ id: r.getAttribute('data-module-id'), photo: !!r.querySelector('.at-photo-field'), src: r.querySelector('.at-photo-field img')?.getAttribute('src') ?? null })));
  const feeder = mods.find(m => m.id === 'pet_feeder'), boiler = mods.find(m => m.id === 'boiler_ebus');
  check('setup modules: the feeder offers no photo (it keeps its drawn cat, owner 11.11.2026)', !!feeder && !feeder.photo, mods);
  check('setup modules: the boiler offers a photo field', !!boiler?.photo, mods);
  check('setup modules: a module that draws no single appliance has no photo field', mods.filter(m => !['boiler_ebus', 'kettle'].includes(m.id)).every(m => !m.photo), mods);
  await shot(a.page, 'setup-modules-pad-light-photos');
  check('errors setup', !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]); await a.ctx.close(); await b.ctx.close();
  const k = await open(cardUrl('kettle', 'idle', 'light', true, '#setup'), { w: 1070, h: 764, wait: '.at-setup' }); await k.page.locator('.at-setup-tabs button').nth(5).click(); await k.page.waitForSelector('[data-module-id="kettle"]');
  const ks = await k.page.evaluate(() => document.querySelector('[data-module-id="kettle"] .at-photo-field img')?.getAttribute('src') ?? null);
  check('setup modules: the kettle offers its photo, the same slot as its device', /xiaomi\.kettle/.test(ks ?? ''), ks); await k.ctx.close(); }

await stop(fails.length ? 1 : 0);
