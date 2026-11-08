// Everything the Cameras card and panel must hold, in the shared card preview (its host records every command and reaches nothing):
// layout on every device and orientation in both themes and three languages, accessibility (axe), console errors, the state matrix
// (quiet, a person on the stairs, a ring, a camera offline), which camera the card shows big, the line's words and tone, the panel's filters, every control.
// usage: node scripts/qa-cameras.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/cameras'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = 4300 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 300)}`); };
const report = () => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); };
const stop = code => { report(); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 1500) + ' ' + (e.stack ?? '').split('\n').find(l => l.includes('qa-cameras'))?.trim()); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 1500) + ' ' + (e?.stack ?? '').split('\n').find(l => l.includes('qa-cameras'))?.trim()); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [698, 751, 'open'], [751, 698, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd'], [1280, 720, 'tv'], [320, 640, 'narrow']];
const C700 = 'e:camera.entrance_camera', DOOR = 'e:camera.entrance_doorbell', DOWN = 'e:camera.cam_c44he_ptz_hd', UP = 'e:camera.cam_c44he_fixed_hd';
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'quiet', hash = '#home', reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau', reducedMotion: reduced ? 'reduce' : 'no-preference' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=cameras&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  await page.waitForSelector(hash === '#camera' ? '.at-cams-list, .at-cams-empty' : '.at-cams-tile', { timeout: 8000 }).catch(() => errors.push('screen never settled'));
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))); await page.waitForTimeout(150);
  return { page, ctx, errors };
}
const runAxe = async (page, scope) => { await page.addScriptTag({ content: axe }); return page.evaluate(async sc => { const r = await window.axe.run(document.querySelector(sc), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'], rules: { 'region': { enabled: false } } }); return r.violations.map(v => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target?.join(' ')})`); }, scope); };
const scrollAll = page => page.evaluate(async () => { const m = document.querySelector('.hm-main'); for (let y = 0; y <= m.scrollHeight; y += m.clientHeight * 0.8) { m.scrollTop = y; await new Promise(r => setTimeout(r, 30)); } m.scrollTop = 0; });
const small = (page, sel) => page.evaluate(s => [...document.querySelectorAll(`${s} button`)].filter(b => b.offsetWidth && (b.offsetHeight < 44 || b.offsetWidth < 44)).map(b => `${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 22)} ${b.offsetWidth}x${b.offsetHeight}`), sel);
const tileInfo = page => page.evaluate(() => { const t = document.querySelector('.at-cams-tile'); return t ? { focus: t.dataset.focus, tone: [...t.classList].find(c => /^is-(danger|warning|active|muted)$/.test(c)) ?? null, line: t.querySelector('.at-cams-caption small')?.textContent, thumbs: [...t.querySelectorAll('.at-cams-thumb')].length, live: t.querySelector('.at-cams-main .at-go2rtc')?.dataset.playerStatus ?? null, singles: document.querySelectorAll('.hm-camera-tile').length } : null; });
// a camera's name and its line stay on one line inside the tile and the cell
const extra = page => page.evaluate(() => { const bad = []; for (const e of document.querySelectorAll('.at-cams-caption strong, .at-cams-cap strong, .at-cams-cap small, .at-cams-ev-text strong')) { if (!e.offsetWidth) continue; if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis') bad.push(`cut: ${e.textContent}`); const r = document.createRange(); r.selectNodeContents(e); if (new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1) bad.push(`two lines: ${e.textContent}`); } return bad; });

try {
  // 1. layout, axe, targets: every size, both themes, the tile and the whole panel scrolled through
  if (!process.env.QUICK) for (const [w, h, label] of DEVICES) for (const theme of ['light', 'dark']) for (const scenario of theme === 'light' ? ['quiet', 'person', 'ring', 'offline'] : ['ring']) {
    const tag = `${label}-${theme}-${scenario}`;
    let { page, ctx, errors } = await open({ w, h, theme, scenario });
    check(`${tag}: home tile layout`, true); const lt = await layout(page, '.at-cams-tile'); check(`layout [${tag} tile]`, !lt.length, lt);
    const ex = await extra(page); check(`text [${tag} tile]`, !ex.length, ex);
    const st = await small(page, '.at-cams-tile'); check(`targets [${tag} tile]`, !st.length, st);
    if (scenario === 'quiet' || scenario === 'ring') { const ax = await runAxe(page, '.at-cams-tile'); check(`axe [${tag} tile]`, !ax.length, ax); }
    await page.screenshot({ path: `${out}/${tag}-home.png` }); await ctx.close();
    ({ page, ctx, errors: errors } = await open({ w, h, theme, scenario, hash: '#camera' }));
    await scrollAll(page); const lp = await layout(page, '.at-cams'); check(`layout [${tag} panel]`, !lp.length, lp);
    const ep = await extra(page); check(`text [${tag} panel]`, !ep.length, ep);
    const sp = await small(page, '.at-cams'); check(`targets [${tag} panel]`, !sp.length, sp);
    if (scenario !== 'person') { const ax = await runAxe(page, '.at-cams'); check(`axe [${tag} panel]`, !ax.length, ax); }
    await page.screenshot({ path: `${out}/${tag}-panel.png` });
    check(`errors [${tag}]`, !errors.length, errors); await ctx.close();
  }
  // 2. which camera is big and what the line says
  const want = { quiet: [DOOR, null, /^Тихо · 4 камеры$/], person: [DOWN, 'is-warning', /^Человек · Лестница вниз · сейчас$/], ring: [DOOR, 'is-danger', /^Звонок · Камера звонка · \d\d:\d\d$/], offline: [DOOR, 'is-muted', /^1 камера без связи$/] };
  for (const [scenario, [focus, tone, line]] of Object.entries(want)) {
    const { page, ctx } = await open({ scenario }); const t = await tileInfo(page);
    check(`${scenario}: big camera, tone and line`, t && t.focus === focus && t.tone === tone && line.test(t.line ?? '') && t.thumbs === 3 && t.live === 'live' && t.singles === 0, t); await ctx.close();
  }
  // 3. the panel: summary, cells, filters with counts, the cell of the event, offline camera
  { const { page, ctx } = await open({ scenario: 'person', hash: '#camera' });
    const p = await page.evaluate(() => ({ cells: [...document.querySelectorAll('.at-cams-cell')].map(c => c.dataset.deviceKey), flag: document.querySelector('.at-cams-cell.tone-warning')?.dataset.deviceKey, summary: document.querySelector('.at-cams-summary')?.className, tabs: [...document.querySelectorAll('.at-cams-filter button')].map(b => b.textContent), rows: document.querySelectorAll('.at-cams-ev').length, tab: document.querySelector('.hm-range-tabs [aria-selected="true"]')?.textContent }));
    check('panel: four cells in order, the stairs flagged, the summary yellow, the tab selected', p.cells.join() === [DOOR, C700, DOWN, UP].join() && p.flag === DOWN && /is-warning/.test(p.summary) && p.tab === 'Камеры', p);
    check('panel: filters count the day', p.tabs.join('|') === 'Все19|Звонки2|Люди5|Движение12' && p.rows === 19, p);
    await page.click('.at-cams-filter button:nth-child(2)'); await page.waitForTimeout(150);
    const rings = await page.evaluate(() => [...document.querySelectorAll('.at-cams-ev strong')].map(x => x.textContent)); check('panel: «Звонки» shows the two rings only', rings.join() === 'Звонок,Звонок', rings);
    await page.click('.at-cams-ev'); await page.waitForSelector('.hm-sheet', { timeout: 3000 }).catch(() => {});
    check('panel: an event opens its camera', /device=e%3Acamera.entrance_doorbell/.test(page.url()), page.url());
    await page.waitForTimeout(400); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    await page.click(`.at-cams-cell[data-device-key="${DOWN}"] .at-cams-hit`, { timeout: 8000 }); await page.waitForTimeout(250);
    check('panel: a cell opens its camera', /device=e%3Acamera.cam_c44he_ptz_hd/.test(page.url()), page.url());
    const sheet = await page.evaluate(() => ({ stage: !!document.querySelector('.hm-sheet .at-go2rtc'), title: document.querySelector('.hm-sheet h2')?.textContent })); check('panel: the Sonoff sheet plays its lens', sheet.stage, sheet);
    const log = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws')); check('panel: no command sent', !log.length, log); await ctx.close(); }
  { const { page, ctx } = await open({ scenario: 'offline', hash: '#camera' });
    const o = await page.evaluate(() => ({ off: [...document.querySelectorAll('.at-cams-cell.is-off')].map(c => c.dataset.deviceKey), small: document.querySelector('.at-cams-summary small')?.textContent })); check('offline: the cell dimmed, «На связи 3 из 4»', o.off.join() === 'e:camera.cam_c44he_fixed_hd' && o.small === 'На связи 3 из 4', o); await ctx.close(); }
  // 4. the card's controls: the big picture, a frame and the caption
  { const { page, ctx } = await open({ scenario: 'quiet' });
    const thumbs = await page.evaluate(() => [...document.querySelectorAll('.at-cams-thumb')].map(b => ({ name: b.querySelector('small')?.textContent, live: b.querySelector('.at-go2rtc')?.dataset.playerStatus ?? null })));
    check('tile: the three small cameras are live too, the C700 named after its room', thumbs.map(x => x.name).join() === 'Компьютерная,Лестница вниз,Лестница вверх' && thumbs.every(x => x.live === 'live'), thumbs);
    await page.click('.at-cams-thumb:nth-child(1)'); await page.waitForTimeout(200); check('tile: a small camera opens its sheet', /device=e%3Acamera.entrance_camera/.test(page.url()) && !!(await page.$('.at-cam')), page.url());
    await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    await page.click('.at-cams-main'); await page.waitForTimeout(400); const stage = await page.evaluate(() => ({ layers: [...document.querySelectorAll('.hm-sheet .at-cam-layer')].map(l => `${l.dataset.quality ?? 'low'}:${l.classList.contains('is-pending') ? 'pending' : 'shown'}:${l.querySelector('.at-go2rtc')?.dataset.stream}`) }));
    check('tile: the big picture opens the doorbell, its sheet on 1080p (the 720p gave way)', /device=e%3Acamera.entrance_doorbell/.test(page.url()) && stage.layers.join() === 'high:shown:entrance_doorbell', [page.url(), stage]);
    await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    await page.click('.at-cams-caption'); await page.waitForTimeout(250); check('tile: the caption opens the panel', /#camera$/.test(page.url()), page.url());
    // keyboard: the three kinds of controls are reachable and named
    const names = await page.evaluate(() => { location.hash = '#home'; return new Promise(r => setTimeout(() => r([...document.querySelectorAll('.at-cams-tile button')].map(b => b.getAttribute('aria-label'))), 300)); });
    check('tile: every control has a name', names.length === 5 && names.slice(1, 4).every(Boolean) && names[0] === null && names[4] === null, names); await ctx.close(); }
  // 5. languages: no raw keys, the line in en / ro
  for (const lang of ['en', 'ro']) for (const hash of ['#home', '#camera']) { const { page, ctx, errors } = await open({ lang, scenario: 'person', hash }); const raw = await page.evaluate(() => (document.querySelector('.hm-main').innerText.match(/\b(cams|module)\.[a-z.]+/g) ?? [])); check(`${lang} ${hash}: no raw keys`, !raw.length && !errors.length, [raw, errors]); await page.screenshot({ path: `${out}/${lang}-${hash.slice(1)}.png` }); await ctx.close(); }
  // 6. reduced motion: nothing animates on the card
  { const { page, ctx } = await open({ reduced: true, scenario: 'ring' }); const anim = await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('.at-cams-tile')).length); check('reduced motion: the card is still', anim === 0, anim); await ctx.close(); }
} finally { await browser.close(); }
stop(fails.length ? 1 : 0);
