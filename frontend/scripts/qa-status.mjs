// The house status strip on Home and the alarm / doorbell takeover over every page and sheet (release «classic» 11.11.2026, from design 2026
// phase 2: model/house-status.ts, ui/house-status.tsx, ui/shell-banner.tsx; atom.css «Строка состояния дома», «Тревога и звонок поверх всего»).
// Light and dark, 1070×764 and 360×792:
//  - the strip stands above Home's cards (their order is today's: the clock first), only on Home; calm → «Всё в порядке» and no chip; trouble →
//    «Нужно внимание: N» and one chip per problem, each opening its place; its words hold 4.5:1 on what is drawn under them;
//  - the alarm takes over every page and an open sheet, covers nothing (the title and the sheet start under it), its ONE main action by the reason:
//    the alarm → «Снять с охраны», which ASKS (nothing is sent before «Да»); a leak with the valve open → «Перекрыть воду», one tap; gas →
//    «Показать» only; without the house nothing is asked or sent; Escape does not dismiss it; its words hold 4.5:1;
//  - a ring while another sheet is open: the doorbell takeover («Кто-то у двери», «Открыть видео» opens the doorbell, «Позже» dismisses).
// usage: node scripts/qa-status.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/status'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const fails = []; let passed = 0, browser = null; const servers = [];
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 300)}`); };
const stop = async code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); for (const s of servers) s.kill(); await browser?.close().catch(() => undefined); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); void stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); void stop(1); });
const serve = async script => { const port = await freePort(), p = spawn(process.execPath, [resolve(root, 'scripts', script), String(port)], { stdio: 'pipe' }); servers.push(p); await new Promise(r => p.stdout.once('data', r)); return `http://127.0.0.1:${port}`; };
const panel = await serve('preview-server.mjs'), cards = await serve('card-preview.mjs');
browser = await chromium.launch();
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
const SIZES = [[1070, 764, 'pad'], [360, 792, 'phone']], THEMES = ['light', 'dark'];
const P = (theme, hash) => `${panel}/?theme=${theme}${hash}`, C = (card, scenario, theme, hash) => `${cards}/?card=${card}&scenario=${scenario}&theme=${theme}&lang=ru${hash}`;
async function open(url, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });
  await page.goto(url); await page.waitForFunction(() => window.ready); await page.waitForTimeout(500); return { ctx, page, errors };
}
const shot = (page, name) => page.screenshot({ path: resolve(out, `${name}.png`) });
const sent = page => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => `${x.domain}.${x.service}`));
const strip = page => page.evaluate(() => { const s = document.querySelector('.hm-page .ah-status'); if (!s) return null; const grid = document.querySelector('.hm-page .hm-home'), r = s.getBoundingClientRect();
  return { tone: s.dataset.tone, title: s.querySelector('.ah-status-title')?.textContent ?? '', chips: [...s.querySelectorAll('.ah-status-chip')].map(c => ({ text: c.textContent.trim(), tone: c.className.match(/tone-(\w+)/)?.[1], kind: c.dataset.kind, button: c.tagName === 'BUTTON' })),
    above: !!grid && r.bottom <= grid.getBoundingClientRect().top + 1, first: grid?.firstElementChild?.className ?? '', h: Math.round(r.height), w: Math.round(r.width), gw: Math.round(grid?.getBoundingClientRect().width ?? 0) }; });
/** the contrast of a text against the pixels drawn under it: the element is shot with its text made transparent, the darkest / lightest pixel is compared */
async function textContrast(page, sel) {
  const el = page.locator(sel).first(); if (!(await el.count())) return null;
  const color = await el.evaluate(e => getComputedStyle(e).color);
  await el.evaluate(e => { e.dataset.qaColor = e.style.color; e.style.setProperty('color', 'transparent', 'important'); e.querySelectorAll('*').forEach(c => c.style.setProperty('color', 'transparent', 'important')); });
  const png = await el.screenshot({ animations: 'disabled' });
  await el.evaluate(e => { e.style.color = e.dataset.qaColor ?? ''; e.querySelectorAll('*').forEach(c => c.style.removeProperty('color')); });
  return page.evaluate(async ([b64, color]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data, lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }, L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const [r, gg, b] = color.match(/[\d.]+/g).map(Number), Lt = L(r, gg, b); let worst = 99;
    for (let i = 0; i < d.length; i += 16) { const Lb = L(d[i], d[i + 1], d[i + 2]), ratio = (Math.max(Lt, Lb) + 0.05) / (Math.min(Lt, Lb) + 0.05); if (ratio < worst) worst = ratio; }
    return +worst.toFixed(2);
  }, [png.toString('base64'), color]);
}

// 1. the strip: the house as it is (the boiler's pressure low, the children's chandelier without link) — two chips, each opens its place
for (const theme of THEMES) for (const [w, h, dev] of SIZES) {
  const tag = `${dev}/${theme}`, { ctx, page, errors } = await open(P(theme, '#home'), w, h);
  const s = await strip(page);
  check(`${tag}: the strip stands above Home's cards, the cards begin with the clock as today`, !!s && s.above && /ah-clock|clock/.test(s.first), s);
  check(`${tag}: «Нужно внимание: 2» with a chip per problem (the boiler, the chandelier), each a button`, s?.title === 'Нужно внимание: 2' && s.tone === 'warn' && s.chips.length === 2 && s.chips.every(c => c.button && c.tone === 'warn') && s.chips.some(c => c.kind === 'pressure') && s.chips.some(c => c.kind === 'nolink'), s);
  check(`${tag}: the strip is as wide as Home's grid`, !!s && Math.abs(s.w - s.gw) <= 1, s);
  for (const sel of ['.ah-status-title', '.ah-status-chip-text']) { const c = await textContrast(page, `.ah-status ${sel}`); check(`${tag}: ${sel} holds 4.5:1 on what is under it`, c !== null && c >= 4.5, c); }
  await shot(page, `strip-warn-${dev}-${theme}`);
  // the chips open their places: the boiler's pressure → «Климат»; one device without link → its own sheet
  await page.locator('.ah-status-chip[data-kind="pressure"]').click(); await page.waitForTimeout(400);
  // the eBUS boiler's card stands on «Климат» (its placement in the classic look), and that is where the chip leads (model/house-status.ts)
  { const at = await page.evaluate(() => ({ hash: location.hash, boiler: !!document.querySelector('.hm-page .at-boiler') })); check(`${tag}: the pressure chip opens «Климат» with the boiler's card`, at.hash.startsWith('#climate') && at.boiler, at); }
  check(`${tag}: no strip outside Home`, await page.locator('.ah-status').count() === 0);
  await page.goBack(); await page.waitForTimeout(400); await page.locator('.ah-status-chip[data-kind="nolink"]').click(); await page.waitForTimeout(450);
  check(`${tag}: the chandelier's chip opens its sheet`, await page.evaluate(() => /device=/.test(location.hash) && !!document.querySelector('.hm-sheet')), await page.evaluate(() => location.hash));
  await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(400);
  // calm: the pressure back in its norm, the chandelier answers
  await page.evaluate(() => { const st = window.atomPreview.host.states(), p = Object.keys(st).find(k => /ebusd.*pressure|pressure.*ebusd|boiler.*pressure/i.test(k)), l = Object.keys(st).find(k => /^light\..*/.test(k) && st[k].state === 'unavailable'); window.atomPreview.setStates({ ...(p ? { [p]: '1.4' } : {}), ...(l ? { [l]: 'off' } : {}) }); }); await page.waitForTimeout(500);
  const calm = await strip(page);
  check(`${tag}: a calm house: «Всё в порядке», no chip`, calm?.title === 'Всё в порядке' && calm.tone === 'ok' && calm.chips.length === 0, calm);
  check(`${tag}: calm, the strip is one short line (≤ 76 px)`, !!calm && calm.h <= 76, calm?.h);
  { const c = await textContrast(page, '.ah-status .ah-status-title'); check(`${tag}: «Всё в порядке» holds 4.5:1`, c !== null && c >= 4.5, c); }
  if (dev === 'pad') await shot(page, `strip-calm-${dev}-${theme}`);
  check(`errors strip ${tag}`, !errors.length, errors); await ctx.close();
}

// 2. the alarm takes over: every page, an open sheet, nothing covered; «Снять с охраны» asks first; Escape leaves it
for (const theme of THEMES) for (const [w, h, dev] of SIZES) {
  const tag = `${dev}/${theme}`, { ctx, page, errors } = await open(C('security', 'triggered', theme, '#home'), w, h);
  const take = () => page.evaluate(() => { const b = document.querySelector('.ah-banners .ah-take.is-alarm'); if (!b) return null; const r = b.getBoundingClientRect(), col = document.querySelector('.ah-banners').getBoundingClientRect(), title = document.querySelector('.hm-head h1')?.getBoundingClientRect(), main = b.querySelector('.is-main')?.getBoundingClientRect();
    return { title: b.querySelector('.ah-take-title')?.textContent ?? '', keys: [...b.querySelectorAll('button')].map(x => x.textContent.trim()), mainH: Math.round(main?.height ?? 0), colBottom: Math.round(col.bottom), headTop: Math.round(title?.top ?? 0), full: Math.round(r.width) >= Math.round(document.querySelector('.hm-shell').getBoundingClientRect().width) - 40 }; });
  const pages = {}; for (const hash of ['#home', '#lights', '#rooms', '#systems']) { await page.evaluate(x => { location.hash = x; }, hash); await page.waitForTimeout(350); pages[hash] = await take(); }
  check(`${tag}: «Тревога!» takes over #home, #lights, #rooms, #systems with «Снять с охраны» + «Показать»`, Object.values(pages).every(t => t && t.title.startsWith('Тревога!') && JSON.stringify(t.keys) === JSON.stringify(['Снять с охраны', 'Показать'])), pages);
  check(`${tag}: one main action of 56 px, across the width, and the page's title starts under it`, Object.values(pages).every(t => t && t.mainH >= 56 && t.full && t.headTop >= t.colBottom - 1), pages);
  { const c1 = await textContrast(page, '.ah-take.is-alarm .ah-take-title'), c2 = await textContrast(page, '.ah-take.is-alarm .ah-take-sub'), c3 = await textContrast(page, '.ah-take.is-alarm .is-main span');
    check(`${tag}: the takeover's words hold 4.5:1 (title, line, main key)`, [c1, c2, c3].every(c => c !== null && c >= 4.5), { c1, c2, c3 }); }
  await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(350); await shot(page, `alarm-${dev}-${theme}`);
  // over a sheet: on top, pressable, the sheet starts under it
  const key = await page.evaluate(() => { location.hash = '#lights'; return new Promise(r => setTimeout(() => r(document.querySelector('.ah-tile.kind-light')?.dataset.deviceKey ?? null), 350)); });
  await page.evaluate(k => { location.hash = '#lights?device=' + encodeURIComponent(k); }, key); await page.waitForTimeout(500);
  const over = await page.evaluate(() => { const b = document.querySelector('.ah-take.is-alarm .is-main'), s = document.querySelector('.hm-sheet'), col = document.querySelector('.ah-banners'); if (!b || !s) return null; const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { onTop: !!hit?.closest('.ah-take.is-alarm'), inert: !!b.closest('[inert]'), sheetTop: Math.round(s.getBoundingClientRect().top), colBottom: Math.round(col.getBoundingClientRect().bottom) }; });
  check(`${tag}: over an open sheet, pressable, the sheet starts under it`, !!over && over.onTop && !over.inert && over.sheetTop >= over.colBottom - 1, over);
  if (dev === 'phone') await shot(page, `alarm-over-sheet-${dev}-${theme}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  check(`${tag}: Escape closes the sheet, never the alarm`, await page.evaluate(() => !document.querySelector('.hm-sheet') && !!document.querySelector('.ah-take.is-alarm')));
  // «Снять с охраны» asks, nothing is sent before the answer; «Да» sends the disarm
  const before = (await sent(page)).length;
  await page.locator('.ah-take.is-alarm .is-main').click(); await page.waitForTimeout(400);
  const asked = await page.evaluate(() => ({ dialog: !!document.querySelector('.hm-confirm'), text: document.querySelector('.hm-confirm p')?.textContent ?? '' }));
  check(`${tag}: «Снять с охраны» asks first, nothing sent`, asked.dialog && (await sent(page)).length === before, { asked, sent: (await sent(page)).slice(before) });
  if (dev === 'pad' && theme === 'light') await shot(page, `alarm-asks-${dev}-${theme}`);
  await page.locator('.hm-confirm .at-confirm-yes').click(); await page.waitForTimeout(500);
  const after = (await sent(page)).slice(before);
  check(`${tag}: «Да» sends alarm_control_panel.alarm_disarm, once`, after.filter(c => c === 'alarm_control_panel.alarm_disarm').length === 1, after);
  check(`errors alarm ${tag}`, !errors.length, errors); await ctx.close();
}
// without the house: nothing asked, nothing sent, «Нет связи с домом»
{ const { ctx, page } = await open(C('security', 'triggered', 'light', '#home'), 1070, 764);
  await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(400); const before = (await sent(page)).length;
  await page.locator('.ah-take.is-alarm .is-main').click(); await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ dialog: !!document.querySelector('.hm-confirm'), toast: document.querySelector('.hm-toast')?.textContent ?? '' }));
  check('offline: the alarm\'s main action asks nothing and sends nothing, it says «Нет связи с домом»', !r.dialog && (await sent(page)).length === before && /Нет связи/.test(r.toast), r);
  await ctx.close(); }
// a leak with the valve open: «Перекрыть воду», one tap; gas: «Показать» alone
{ const { ctx, page } = await open(C('security', 'disarmed', 'light', '#lights'), 360, 792);
  await page.evaluate(() => window.atomPreview.setStates({ 'binary_sensor.bath_leak_water_leak': 'on' })); await page.waitForTimeout(500);
  const keys = await page.evaluate(() => [...document.querySelectorAll('.ah-take.is-alarm button')].map(b => b.textContent.trim()));
  check('a leak with the valve open: «Перекрыть воду» + «Показать»', JSON.stringify(keys) === JSON.stringify(['Перекрыть воду', 'Показать']), keys);
  await shot(page, 'leak-valve-open-phone-light'); const before = (await sent(page)).length;
  await page.locator('.ah-take.is-alarm .is-main').click(); await page.waitForTimeout(500);
  const r = { dialog: await page.locator('.hm-confirm').count(), sent: (await sent(page)).slice(before) };
  check('«Перекрыть воду» closes the valve at one tap (no question)', r.dialog === 0 && r.sent.includes('valve.close_valve'), r);
  await ctx.close(); }
{ const { ctx, page } = await open(C('security', 'gas', 'dark', '#home'), 1070, 764);
  const keys = await page.evaluate(() => [...document.querySelectorAll('.ah-take.is-alarm button')].map(b => b.textContent.trim()));
  check('gas: «Показать» alone, it leads to «Безопасность»', JSON.stringify(keys) === JSON.stringify(['Показать']), keys);
  await page.locator('.ah-take.is-alarm .is-main').click(); await page.waitForTimeout(400);
  check('gas: «Показать» opens «Безопасность»', (await page.evaluate(() => location.hash)).startsWith('#security'));
  await ctx.close(); }

// 3. a ring while another sheet is open: the doorbell takes over; «Открыть видео» opens the doorbell, «Позже» dismisses
for (const theme of THEMES) for (const [w, h, dev] of SIZES) {
  const tag = `${dev}/${theme}`, { ctx, page, errors } = await open(C('cameras', 'quiet', theme, '#home?device=e%3Acamera.entrance_camera'), w, h);
  await page.waitForSelector('.at-cam:not(.at-door)');
  const ring = () => page.evaluate(() => window.atomPreview.setStates({ 'event.entrance_doorbell_ring': new Date(Date.now() + 1000).toISOString() }));
  await ring(); await page.waitForTimeout(600);
  const t = await page.evaluate(() => { const b = document.querySelector('.ah-banners .ah-take.is-ring'); if (!b) return null; const s = document.querySelector('.hm-sheet'), col = document.querySelector('.ah-banners');
    return { eyebrow: b.querySelector('.ah-take-eyebrow')?.textContent ?? '', title: b.querySelector('.ah-take-title')?.textContent ?? '', keys: [...b.querySelectorAll('button')].map(x => x.textContent.trim()), frame: !!b.querySelector('.ah-take-frame'), camera: !!document.querySelector('.at-cam:not(.at-door)'), sheetTop: Math.round(s?.getBoundingClientRect().top ?? 0), colBottom: Math.round(col.getBoundingClientRect().bottom) }; });
  check(`${tag}: a ring over another sheet: «Кто-то у двери» with «Открыть видео» + «Позже», the camera's sheet stays under it`, !!t && t.title === 'Кто-то у двери' && JSON.stringify(t.keys) === JSON.stringify(['Открыть видео', 'Позже']) && t.camera && t.sheetTop >= t.colBottom - 1, t);
  { const c = await textContrast(page, '.ah-take.is-ring .ah-take-title'), e = await textContrast(page, '.ah-take.is-ring .ah-take-eyebrow'); check(`${tag}: the ring's words hold 4.5:1`, c >= 4.5 && e >= 4.5, { c, e }); }
  await shot(page, `ring-${dev}-${theme}`);
  if (dev === 'pad' && theme === 'light') { await page.locator('.ah-take.is-ring .ah-take-second').click(); await page.waitForTimeout(400); check(`${tag}: «Позже» dismisses the ring, the camera stays`, await page.evaluate(() => !document.querySelector('.ah-take.is-ring') && !!document.querySelector('.at-cam:not(.at-door)'))); }
  else { await page.locator('.ah-take.is-ring .is-main').click(); await page.waitForTimeout(600); check(`${tag}: «Открыть видео» opens the doorbell's sheet, the takeover goes`, await page.evaluate(() => !!document.querySelector('.at-door') && !document.querySelector('.ah-take.is-ring'))); }
  check(`errors ring ${tag}`, !errors.length, errors); await ctx.close();
}
// the takeover shows the door: its live frame while no camera's sheet holds the stream (another sheet open), Home Assistant's still while one does
for (const theme of THEMES) for (const [w, h, dev] of SIZES) {
  const tag = `${dev}/${theme}`, { ctx, page, errors } = await open(C('cameras', 'quiet', theme, '#lights'), w, h);
  const key = await page.evaluate(() => document.querySelector('.ah-tile.kind-light')?.dataset.deviceKey ?? null);
  await page.evaluate(k => { location.hash = '#lights?device=' + encodeURIComponent(k); }, key); await page.waitForSelector('.hm-sheet'); await page.waitForTimeout(300);
  await page.evaluate(() => window.atomPreview.setStates({ 'event.entrance_doorbell_ring': new Date(Date.now() + 1000).toISOString() })); await page.waitForTimeout(900);
  const f = await page.evaluate(async () => { const fr = document.querySelector('.ah-take.is-ring .ah-take-frame'); if (!fr) return null; const imgs = [...fr.querySelectorAll('img')]; await Promise.all(imgs.map(i => i.decode().catch(() => undefined)));
    return { live: !!fr.querySelector('video, img[src*="/frames/"]'), still: imgs.some(i => /camera_proxy/.test(i.getAttribute('src') ?? '')), shown: [...fr.querySelectorAll('img, video')].some(e => { const r = e.getBoundingClientRect(), fb = fr.getBoundingClientRect(); return (e.tagName === 'VIDEO' || (e.naturalWidth > 0 && /\/frames\//.test(e.getAttribute('src') ?? ''))) && r.width >= fb.width - 2 && r.height >= fb.height - 2; }) }; }); // drawn across the whole frame, not a 0×0 picture
  check(`${tag}: a ring over a lamp's sheet shows the door's live frame, not a still`, !!f && f.live && !f.still && f.shown, f);
  if (theme === 'dark' && dev === 'phone') await shot(page, `ring-over-lamp-${dev}-${theme}`);
  check(`errors ring over a lamp ${tag}`, !errors.length, errors); await ctx.close();
}
{ const { ctx, page } = await open(C('cameras', 'quiet', 'light', '#home?device=e%3Acamera.entrance_camera'), 1070, 764); await page.waitForSelector('.at-cam:not(.at-door)');
  await page.evaluate(() => window.atomPreview.setStates({ 'event.entrance_doorbell_ring': new Date(Date.now() + 1000).toISOString() })); await page.waitForTimeout(900);
  const f = await page.evaluate(() => { const fr = document.querySelector('.ah-take.is-ring .ah-take-frame'); return fr ? { still: [...fr.querySelectorAll('img')].some(i => /camera_proxy/.test(i.getAttribute('src') ?? '')), live: !!fr.querySelector('video, img[src*="/frames/"]') } : null; });
  check('a ring over another camera\'s sheet (one stream at a time) shows Home Assistant\'s still of the doorbell', !!f && f.still && !f.live, f); await ctx.close(); }
await stop(fails.length ? 1 : 0);
