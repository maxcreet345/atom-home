// Everything the Cameras card and panel must hold, in the shared card preview (its host records every command and reaches nothing):
// layout on every device and orientation in both themes and three languages, accessibility (axe), console errors, the state matrix
// (quiet, a person on the stairs, a ring, a camera offline), which camera the card shows big, the line's words and tone, the panel's filters, every control.
// usage: node scripts/qa-cameras.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium, webkit } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/cameras'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = await freePort();
const server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 300)}`); };
const report = () => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); };
const stop = code => { report(); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 1500) + ' ' + (e.stack ?? '').split('\n').find(l => l.includes('qa-cameras'))?.trim()); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 1500) + ' ' + (e?.stack ?? '').split('\n').find(l => l.includes('qa-cameras'))?.trim()); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [698, 751, 'open'], [751, 698, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd'], [1280, 720, 'tv'], [320, 640, 'narrow']];
const HALL = 'e:camera.hall_camera_sd', C700 = 'e:camera.entrance_camera', DOOR = 'e:camera.entrance_doorbell', DOWN = 'e:camera.cam_c44he_ptz_hd', UP = 'e:camera.cam_c44he_fixed_hd';
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'quiet', hash = '#home', reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau', reducedMotion: reduced ? 'reduce' : 'no-preference' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=cameras&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  await page.waitForSelector(hash === '#camera' ? '.at-cams-list, .at-cams-empty' : '.at-cams-tile', { timeout: 8000 }).catch(() => errors.push('screen never settled'));
  // only animations on the document's clock end by themselves: the scroll-driven edge fades of the segment rows (10.11.2026) never «finish», and waiting for them hangs the run
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity && a.timeline === document.timeline).map(a => a.finished.catch(() => {})))); await page.waitForTimeout(150);
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
  const want = { quiet: [DOOR, null, /^Тихо · 5 камер$/], person: [DOWN, 'is-warning', /^Человек · Лестница вниз · сейчас$/], ring: [DOOR, 'is-danger', /^Звонок · Камера звонка · \d\d:\d\d$/], offline: [DOOR, 'is-muted', /^1 камера без связи$/] };
  for (const [scenario, [focus, tone, line]] of Object.entries(want)) {
    const { page, ctx } = await open({ scenario }); const t = await tileInfo(page);
    check(`${scenario}: big camera, tone and line`, t && t.focus === focus && t.tone === tone && line.test(t.line ?? '') && t.thumbs === 4 && t.live === 'live' && t.singles === 0, t); await ctx.close();
  }
  // 3. the panel: summary, cells, filters with counts, the cell of the event, offline camera
  { const { page, ctx } = await open({ scenario: 'person', hash: '#camera' });
    const p = await page.evaluate(() => ({ cells: [...document.querySelectorAll('.at-cams-cell')].map(c => c.dataset.deviceKey), flag: document.querySelector('.at-cams-cell.tone-warning')?.dataset.deviceKey, summary: document.querySelector('.at-cams-summary')?.className, tabs: [...document.querySelectorAll('.at-cams-filter button')].map(b => b.textContent), rows: document.querySelectorAll('.at-cams-ev').length, tab: document.querySelector('.hm-range-tabs.is-sys [aria-current="page"]')?.textContent })); // the Systems tabs are navigation (aria-current), not a tablist
    check('panel: four cells in order, the stairs flagged, the summary yellow, the tab selected', p.cells.join() === [DOOR, C700, DOWN, UP, HALL].join() && p.flag === DOWN && /is-warning/.test(p.summary) && p.tab === 'Камеры', p);
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
    const o = await page.evaluate(() => ({ off: [...document.querySelectorAll('.at-cams-cell.is-off')].map(c => c.dataset.deviceKey), small: document.querySelector('.at-cams-summary small')?.textContent })); check('offline: the cell dimmed, «На связи 3 из 4»', o.off.join() === 'e:camera.cam_c44he_fixed_hd' && o.small === 'На связи 4 из 5', o); await ctx.close(); }
  // 4. the card's controls: the big picture, a frame and the caption
  { const { page, ctx } = await open({ scenario: 'quiet' });
    const thumbs = await page.evaluate(() => [...document.querySelectorAll('.at-cams-thumb')].map(b => ({ name: b.querySelector('small')?.textContent, live: b.querySelector('.at-go2rtc')?.dataset.playerStatus ?? null })));
    check('tile: the three small cameras are live too, the C700 named after its room', thumbs.map(x => x.name).join() === 'Компьютерная,Лестница вниз,Лестница вверх,Прихожая' && thumbs.filter(x => x.name !== 'Прихожая').every(x => x.live === 'live') /* the hall has no recorded frame in the preview */, thumbs);
    await page.click('.at-cams-thumb:nth-child(1)'); await page.waitForTimeout(200); check('tile: a small camera opens its sheet', /device=e%3Acamera.entrance_camera/.test(page.url()) && !!(await page.$('.at-cam')), page.url());
    await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    await page.click('.at-cams-main'); await page.waitForTimeout(400); const stage = await page.evaluate(() => ({ layers: [...document.querySelectorAll('.hm-sheet .at-cam-layer')].map(l => `${l.dataset.quality ?? 'low'}:${l.classList.contains('is-pending') ? 'pending' : 'shown'}:${l.querySelector('.at-go2rtc')?.dataset.stream}`) }));
    check('tile: the big picture opens the doorbell, its sheet on 1080p (the 720p gave way)', /device=e%3Acamera.entrance_doorbell/.test(page.url()) && stage.layers.join() === 'high:shown:entrance_doorbell', [page.url(), stage]);
    await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    await page.click('.at-cams-caption'); await page.waitForTimeout(250); check('tile: the caption opens the panel', /#camera$/.test(page.url()), page.url());
    // keyboard: the three kinds of controls are reachable and named
    const names = await page.evaluate(() => { location.hash = '#home'; return new Promise(r => setTimeout(() => r([...document.querySelectorAll('.at-cams-tile button')].map(b => b.getAttribute('aria-label'))), 300)); });
    // the big camera and each small one are real buttons with a name (the frame is no longer inside a button, so «Повторить» can stand on it); the caption is named by its own text
    check('tile: every control has a name', names.length === 6 && names.slice(0, 5).every(n => /^Открыть: /.test(n ?? '')) && names[5] === null, names);
    const nested = await page.evaluate(() => document.querySelectorAll('.at-cams-tile button button, .at-cams-tile [role="button"]').length); check('tile: no control inside another control', nested === 0, nested);
    // Enter and Space open the camera from the keyboard
    for (const key of ['Enter', ' ']) { await page.focus('.at-cams-main .at-cams-hit'); await page.keyboard.press(key); await page.waitForSelector('.hm-sheet .at-cam', { timeout: 3000 }).catch(() => {}); check(`tile: ${key === ' ' ? 'Space' : key} opens the big camera`, !!(await page.$('.hm-sheet .at-cam')) && /device=/.test(await page.evaluate(() => location.hash))); await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
    await ctx.close(); }
  // a sheet that has nothing to do with the cameras does not tear their tiles down: the same players stand there when it closes (they only pause behind it)
  { const { page, ctx } = await open({ scenario: 'quiet' });
    await page.evaluate(() => { document.querySelectorAll('.at-cams-tile .at-go2rtc').forEach((n, i) => { n.__kept = i + 1; }); });
    const other = 'air'; await page.click('.at-air-tile .ah-tile-hit'); await page.waitForSelector('.hm-sheet', { timeout: 3000 }).catch(() => {}); // the Air card's sheet: nothing of the cameras in it
    const during = await page.evaluate(() => ({ sheet: !!document.querySelector('.hm-sheet'), cam: !!document.querySelector('.hm-sheet .at-cam'), kept: [...document.querySelectorAll('.at-cams-tile .at-go2rtc')].filter(n => n.__kept).length }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const after = await page.evaluate(() => [...document.querySelectorAll('.at-cams-tile .at-go2rtc')].filter(n => n.__kept).length);
    check('an unrelated sheet opened and closed: the five camera tiles were not rebuilt', !!other && during.sheet && !during.cam && during.kept === 5 && after === 5, { other, during, after }); await ctx.close(); }
  // a camera without a link: the summary is a problem (no «all quiet» check-mark, the count next to it), the cell says it once and shows no LIVE
  { const { page, ctx } = await open({ scenario: 'offline', hash: '#camera' });
    const o = await page.evaluate(() => { const s = document.querySelector('.at-cams-summary'), cell = document.querySelector('.at-cams-cell.is-off'); return { cls: s.className, off: s.dataset.offline, text: s.querySelector('.at-cams-state').textContent, small: s.querySelector('small').textContent, cap: cell?.querySelector('.at-cams-cap small')?.textContent, live: !!cell?.querySelector('.hm-live.is-live'), badge: cell?.querySelector('.hm-live')?.textContent ?? null, frame: cell?.querySelector('.hm-camera-wait span')?.textContent ?? null }; });
    check('offline: the summary warns, counts one camera and «На связи 4 из 5»', /is-warning/.test(o.cls) && o.off === '1' && /1 камера без связи/.test(o.text) && o.small === 'На связи 4 из 5', o);
    check('offline: the cell says «Нет связи с камерой» on the frame and under it, with no LIVE over it', o.cap === 'Нет связи с камерой' && o.frame === 'Нет связи с камерой' && !o.live && o.badge !== 'LIVE', o); await ctx.close(); }
  { const { page, ctx } = await open({ scenario: 'quiet', hash: '#camera' }); const q = await page.evaluate(() => { const s = document.querySelector('.at-cams-summary'); return { cls: s.className, off: s.dataset.offline }; }); check('quiet: the summary carries no warning', !/is-warning|is-danger/.test(q.cls) && q.off === '0', q);
    // the list of events is read again a few seconds after it was woken (the recorder writes every 5 s), not only once
    const reads = () => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain === 'ws' && x.service === 'history/history_during_period' && (x.data.entity_ids?.length ?? 0) > 2).length), r0 = await reads(); await page.waitForTimeout(6600); const r1 = await reads();
    check('events: read again ~6 s after the first read', r0 >= 1 && r1 > r0, [r0, r1]);
    // the filter is a group of toggle buttons that say which one is pressed (not tabs without a panel and without arrow keys)
    const fl = await page.evaluate(() => { const g = document.querySelector('.at-cams-filter'); return { role: g.getAttribute('role'), name: g.getAttribute('aria-label'), pressed: [...g.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')), tabs: g.querySelectorAll('[role="tab"]').length }; });
    check('events filter: a named group, one button pressed, no tab roles', fl.role === 'group' && !!fl.name && fl.pressed.join() === 'true,false,false,false' && fl.tabs === 0, fl); await ctx.close(); }
  // the recorder cannot be read: that is said, with a retry — not «за сутки камеры ничего не заметили» and not zeros in the filters
  { const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.addInitScript(() => { window.__histFail = true; window.__beforeDraw = h => { const ws = h.ws?.bind(h); if (ws) h.ws = m => m.type === 'history/history_during_period' && window.__histFail ? Promise.reject({ code: 'unknown_error', message: 'Recorder is not ready' }) : ws(m); }; });
    await page.goto(`${origin}/?card=cameras&scenario=person&theme=light&lang=ru#camera`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.at-cams-fail', { timeout: 8000 }).catch(() => {});
    const f = await page.evaluate(() => ({ fail: document.querySelector('.at-cams-fail')?.textContent ?? null, counts: [...document.querySelectorAll('.at-cams-filter button b')].length, empty: /ничего не заметили/.test(document.querySelector('.at-cams-events')?.textContent ?? '') }));
    check('history failed: «Не удалось прочитать события» with «Повторить», no counts, no «ничего не заметили»', /Не удалось прочитать события/.test(f.fail ?? '') && /Повторить/.test(f.fail ?? '') && f.counts === 0 && !f.empty, f);
    await page.evaluate(() => { window.__histFail = false; }); await page.click('.at-cams-fail button'); await page.waitForSelector('.at-cams-ev', { timeout: 8000 }).catch(() => {});
    check('history failed: «Повторить» reads the list', (await page.$$('.at-cams-ev')).length > 0 && !(await page.$('.at-cams-fail')));
    // the same in a camera's own sheet (the doorbell's week of events)
    await page.evaluate(() => { window.__histFail = true; location.hash = '#camera?device=e%3Acamera.entrance_doorbell'; }); await page.waitForSelector('.hm-sheet .at-feed-fail', { timeout: 8000 }).catch(() => {});
    const d = await page.evaluate(() => ({ fail: document.querySelector('.hm-sheet .at-feed-fail')?.textContent ?? null, seg: [...document.querySelectorAll('.hm-sheet .at-door-seg button')].map(b => b.textContent), none: /событий не было/.test(document.querySelector('.hm-sheet .at-door-events')?.textContent ?? '') }));
    check('history failed in the doorbell sheet: said so, no «0» counters, no «событий не было»', /Не удалось прочитать события/.test(d.fail ?? '') && !d.seg.some(x => /\d/.test(x)) && !d.none, d); await ctx.close(); }
  // Imou in the hall (09.11.2026): closed shutter on the card and in the panel, the pad turns it, «Закрыть объектив» asks first, the cloud is read once after a command
  { const { page, ctx } = await open({ scenario: 'hallClosed', hash: '#camera' });
    const c = await page.evaluate(() => { const cell = document.querySelector('.at-cams-cell[data-device-key="e:camera.hall_camera_sd"]'); return { wait: cell?.querySelector('.hm-camera-wait span')?.textContent, player: !!cell?.querySelector('.at-go2rtc'), name: cell?.querySelector('.at-cams-cap strong')?.textContent }; });
    check('imou: closed shutter is «Объектив закрыт» without a stream, named after its room', c.wait === 'Объектив закрыт' && !c.player && c.name === 'Прихожая', c);
    const sum = await page.evaluate(() => document.querySelector('.at-cams-summary small')?.textContent); check('imou: a closed lens (stream gone with it) is not «без связи»', sum === 'Все камеры на связи', sum);
    const closedCell = await page.evaluate(() => { const cell = document.querySelector('.at-cams-cell[data-device-key="e:camera.hall_camera_sd"]'), s = document.querySelector('.at-cams-summary'); return { text: cell.innerText, off: cell.classList.contains('is-off'), cap: cell.querySelector('.at-cams-cap small')?.textContent, sum: s.className, n: s.dataset.offline }; });
    check('imou: the closed cell says «Объектив закрыт» and nowhere «Нет связи»; the summary has no warning', closedCell.cap === 'Объектив закрыт' && !/Нет связи/.test(closedCell.text) && !closedCell.off && !/is-warning/.test(closedCell.sum) && closedCell.n === '0', closedCell);
    await page.click('.at-cams-cell[data-device-key="e:camera.hall_camera_sd"] .at-cams-hit'); await page.waitForTimeout(500);
    const sh = await page.evaluate(() => ({ lens: document.querySelector('.hm-sheet .at-cam-lens')?.textContent, pad: [...document.querySelectorAll('.hm-sheet .at-cam-pad-btn')].map(b => b.disabled) }));
    check('imou: closed — the lens button opens, the pad waits', /Открыть объектив/.test(sh.lens ?? '') && sh.pad.length === 4 && sh.pad.every(Boolean), sh); await ctx.close(); }
  { const { page, ctx } = await open({ scenario: 'quiet', hash: '#camera?device=e%3Acamera.hall_camera_sd' }); await page.waitForTimeout(400);
    await page.evaluate(() => window.atomPreview.setAccept(true));
    await page.click('.hm-sheet .at-cam-pad-btn.is-up'); await page.waitForTimeout(200);
    await page.click('.hm-sheet .at-cam-lens'); await page.waitForSelector('.hm-confirm', { timeout: 3000 }).catch(() => {}); const ask = await page.evaluate(() => document.querySelector('.hm-confirm p')?.textContent);
    // the question is open and unanswered for 4 s: the cloud is not asked about a command that has not gone out
    await page.waitForTimeout(4000); const early = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.service === 'update_entity' && x.data.entity_id === 'switch.hall_camera_privacy').length); check('imou: nothing is read from the cloud while «Закрыть объектив» waits for its answer', early === 0, early);
    await page.click('.hm-confirm .is-primary'); await page.waitForTimeout(3400);
    const log = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => `${x.domain}.${x.service}:${x.data.entity_id}`));
    check('imou: up turns it, closing asks first, then the cloud is read once', log.includes('button.press:button.hall_camera_ptz_up') && log.includes('switch.turn_on:switch.hall_camera_privacy') && log.includes('homeassistant.update_entity:switch.hall_camera_privacy') && !!ask, { ask, log });
    await page.click('.hm-sheet .at-cam-gear'); await page.waitForTimeout(300);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .ah-row strong')].map(x => x.textContent));
    check('imou: settings like the C700, plus sound and siren', ['Перевернуть изображение', 'Звуковые подсказки', 'Запись звука', 'Сирена при тревоге', 'Включить сирену', 'Перезагрузить камеру'].every(r => rows.includes(r)), rows); await ctx.close(); }
  // ---- round 2 of the audit (10.11.2026) ----
  // f18: no stream can play, a phone: the summary counts all five cameras, whichever cells are on the screen (a paused tile keeps «no picture»); l79: the sheet of such a camera opens on «Повторить» at once
  { const ctx = await browser.newContext({ viewport: { width: 360, height: 792 }, hasTouch: true, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.route('**/__state**', async route => { const r = await route.fetch(), j = await r.json(); j.frames = {}; await route.fulfill({ response: r, json: j }); });
    await page.addInitScript(() => { window.__beforeDraw = host => { host.subscribe = async () => { throw new Error('refused'); }; }; });
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=light&lang=ru#camera`); await page.waitForFunction(() => window.ready);
    const snap = () => page.evaluate(() => ({ off: document.querySelector('.at-cams-summary')?.dataset.offline, small: document.querySelector('.at-cams-summary small')?.textContent, paused: [...document.querySelectorAll('.at-cams-cell .at-go2rtc')].filter(n => n.dataset.playerStatus === 'paused').length }));
    await page.waitForTimeout(21000); const top = await snap();
    check('f18: every stream down on a phone — «На связи 0 из 5» with the lower cells paused off the screen', top.off === '5' && top.small === 'На связи 0 из 5' && top.paused >= 1, top);
    await page.evaluate(() => [...document.querySelectorAll('.at-cams-cell')].pop().scrollIntoView()); await page.waitForTimeout(11500); const low = await snap();
    check('f18: scrolled to the last cell — still all five without a link', low.off === '5' && low.small === 'На связи 0 из 5' && low.paused >= 1, low);
    await page.evaluate(() => document.querySelector('.at-cams-summary').scrollIntoView()); await page.waitForTimeout(400);
    await page.click('.at-cams-cell .at-cams-hit'); await page.waitForSelector('.hm-sheet .hm-camera-wait', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({ down: !!document.querySelector('.hm-sheet .hm-camera-wait.is-down'), retry: !!document.querySelector('.hm-sheet .at-cam-retry'), text: document.querySelector('.hm-sheet .hm-camera-wait span')?.textContent }));
    check('l79: the sheet of a camera whose tile gave up says «Нет связи с камерой» with «Повторить» at once', st.down && st.retry && st.text === 'Нет связи с камерой', st); await ctx.close(); }
  // l45: the doorbell's week is read twice in a row; the second read failing does not put «Не удалось прочитать события» over the list the first one brought
  { const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.addInitScript(() => { window.__weekReads = 0; window.__beforeDraw = h => { const ws = h.ws?.bind(h); if (ws) h.ws = m => m.type === 'history/history_during_period' && (m.entity_ids?.length ?? 0) <= 2 && ++window.__weekReads > 1 ? Promise.reject({ code: 'unknown_error', message: 'Recorder is busy' }) : ws(m); }; });
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=light&lang=ru#camera?device=e%3Acamera.entrance_doorbell`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.hm-sheet .at-door-ev', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(2600);
    const w = await page.evaluate(() => ({ reads: window.__weekReads, fail: !!document.querySelector('.hm-sheet .at-feed-fail'), rows: document.querySelectorAll('.hm-sheet .at-door-ev').length }));
    check('l45: the second of two reads failed — the list stays, nothing says it could not be read', w.reads >= 2 && !w.fail && w.rows > 0, w); await ctx.close(); }
  // l92: the events filter lives in the address: a reload brings «Звонки» back, a sheet opened and closed keeps it, «Все» clears it
  { const { page, ctx } = await open({ scenario: 'quiet', hash: '#camera' }); const state = () => page.evaluate(() => ({ hash: location.hash, pressed: [...document.querySelectorAll('.at-cams-filter button')].map(b => b.getAttribute('aria-pressed')).join() }));
    await page.click('.at-cams-filter button:nth-child(2)'); await page.waitForTimeout(200); const set = await state();
    await page.reload(); await page.waitForFunction(() => window.ready); await page.waitForSelector('.at-cams-filter'); const again = await state();
    check('l92: «Звонки» is in the address and survives a reload', set.hash === '#camera?filter=ring' && again.hash === '#camera?filter=ring' && again.pressed === 'false,true,false,false', { set, again });
    await page.click('.at-cams-cell .at-cams-hit'); await page.waitForSelector('.hm-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(500); const back = await state();
    await page.click('.at-cams-filter button:nth-child(1)'); await page.waitForTimeout(200); const all = await state();
    check('l92: a sheet opened and closed keeps the filter; «Все» takes it out of the address', back.hash === '#camera?filter=ring' && back.pressed === 'false,true,false,false' && all.hash === '#camera' && all.pressed === 'true,false,false,false', { back, all }); await ctx.close(); }
  // l7: the quality button says what it is; night vision says whether it is pressed
  { const { page, ctx } = await open({ scenario: 'quiet', hash: '#camera?device=e%3Acamera.entrance_camera' }); await page.waitForSelector('.hm-sheet .at-camera-q', { timeout: 4000 }).catch(() => {});
    const q = await page.evaluate(() => { const b = document.querySelector('.hm-sheet .at-camera-q'); return { name: b?.getAttribute('aria-label'), text: b?.textContent, pressed: b?.getAttribute('aria-pressed') }; });
    check('l7: the quality button is named «Качество видео: SD» (the name carries the state)', q.name === 'Качество видео: SD' && q.text === 'SD' && q.pressed === null, q);
    await page.evaluate(() => { location.hash = '#camera?device=e%3Acamera.hall_camera_sd'; }); await page.waitForSelector('.hm-sheet .at-cam-night', { timeout: 4000 }).catch(() => {});
    const n = await page.evaluate(() => document.querySelector('.hm-sheet .at-cam-night')?.getAttribute('aria-pressed')); check('l7: «Ночное видение» is a toggle that says its state', n === 'false' || n === 'true', n); await ctx.close(); }
  // l121: a camera without a link says so once to a screen reader inside the frame (the chip repeats the frame's words); a recorded frame that does not load is not LIVE
  { const { page, ctx } = await open({ scenario: 'offline', hash: '#camera' });
    const o = await page.evaluate(() => { const c = document.querySelector('.at-cams-cell.is-off'); return { chip: c?.querySelector('.hm-live')?.getAttribute('aria-hidden'), frame: c?.querySelector('.hm-camera-wait span')?.textContent, live: [...document.querySelectorAll('.at-cams-cell:not(.is-off) .hm-live')].map(x => x.getAttribute('aria-hidden')) }; });
    check('l121: the «Нет связи» chip of a camera without a link is hidden from a screen reader, a LIVE chip is not', o.chip === 'true' && o.frame === 'Нет связи с камерой' && o.live.length > 0 && o.live.every(x => x === null), o); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.route('**/api/camera_proxy/camera.hall_camera_sd**', r => r.abort());
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=light&lang=ru#camera`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.at-cams-cell'); await page.waitForTimeout(1500);
    const f = await page.evaluate(() => { const c = document.querySelector('.at-cams-cell[data-device-key="e:camera.hall_camera_sd"]'); return { live: !!c?.querySelector('.hm-live.is-live'), status: c?.querySelector('.at-go2rtc')?.dataset.playerStatus, others: document.querySelectorAll('.at-cams-cell .hm-live.is-live').length }; });
    check('l121: a frame that did not load is not shown under LIVE', !f.live && f.status !== 'live' && f.others === 4, f); await ctx.close(); }
  // ---- release classic, cameras (11.11.2026): the Codex review's players and the studio's ST-07 / ST-08, ported from design-2026 (6f68f3d) ----
  // A real player in the sheet: the camera's recorded frame is taken out of the preview, so the panel plays it as in the house — the add-on's stream
  // fails here (no supervisor) and HA's WebRTC takes over, answered by a stand-in peer whose stream is a drawn canvas with a sound track (no camera, no
  // network). `__refuseSound` makes play() refuse sound without a tap, as Safari on an iPhone does.
  const realPlayer = (drop) => async page => {
    await page.route('**/__state**', async route => { const r = await route.fetch(), j = await r.json(); for (const k of drop) delete j.frames[k]; await route.fulfill({ response: r, json: j }); });
    await page.addInitScript(() => {
      window.__refuseSound = false; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (window.__refuseSound && !this.muted) return Promise.reject(new DOMException('a tap is needed', 'NotAllowedError')); return play.call(this); };
      let stream = null; const media = () => { if (stream) return stream; const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = `hsl(${(n++ * 25) % 360} 45% 45%)`; g.fillRect(0, 0, 320, 180); }, 100); stream = c.captureStream(10); const ac = new AudioContext(), osc = ac.createOscillator(), dst = ac.createMediaStreamDestination(); osc.connect(dst); osc.start(); stream.addTrack(dst.stream.getAudioTracks()[0]); return stream; };
      class FakePeer { constructor() { this.connectionState = 'new'; this.iceGatheringState = 'complete'; this.localDescription = null; window.__peers = (window.__peers ?? 0) + 1; }
        addTransceiver() {} createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0' }); } setLocalDescription(d) { this.localDescription = d; return Promise.resolve(); }
        setRemoteDescription() { setTimeout(() => { if (this.connectionState === 'closed') return; const s = media(); for (const t of s.getTracks()) this.ontrack?.({ streams: [s], track: t }); this.connectionState = 'connected'; }, 50); return Promise.resolve(); }
        addIceCandidate() { return Promise.resolve(); } close() { this.connectionState = 'closed'; } }
      window.RTCPeerConnection = FakePeer; window.RTCIceCandidate = class { constructor(x) { Object.assign(this, x); } };
      window.__beforeDraw = h => { const ws = h.ws.bind(h); h.ws = m => m.type === 'camera/webrtc/get_client_config' ? Promise.resolve({ configuration: {} }) : m.type === 'camera/webrtc/candidate' ? Promise.resolve(null) : ws(m); h.subscribe = async (m, cb) => { setTimeout(() => { cb({ type: 'session', session_id: 's' }); cb({ type: 'answer', answer: 'v=0' }); }, 30); return () => undefined; }; };
    });
  };
  // CODEX-015: the sound button stands on the picture (classic: the SD button's dark chip, lower right — it used to lie under the video, out of a pointer's
  // reach), the sound the family turned on survives a new player (here the house off the line and back: the add-on's stream is tried again, then WebRTC
  // again — two new videos), and the button never says «Звук» over a muted picture
  for (const [theme, w, h, touch] of [['light', 1070, 764, false], ['dark', 360, 792, true]]) { // a mouse, and a touch screen (the shell's touch rule once moved the button to the top left)
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await realPlayer(['entrance_camera_h264', 'camera.entrance_camera'])(page);
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=${theme}&lang=ru#camera?device=e%3Acamera.entrance_camera`); await page.waitForFunction(() => window.ready);
    await page.waitForSelector('.hm-sheet .at-cam-sound', { timeout: 15000 }).catch(() => {});
    const state = () => page.evaluate(() => { const s = document.querySelector('.hm-sheet'), m = s?.querySelector('.at-go2rtc'), v = m?.querySelector('video'), b = s?.querySelector('.at-cam-sound'); return { status: m?.dataset.playerStatus, path: m?.dataset.path, muted: v?.muted ?? null, paused: v?.paused ?? null, pressed: b?.getAttribute('aria-pressed') ?? null, chip: s?.querySelector('.at-cam-stage .hm-live')?.textContent ?? null, peers: window.__peers ?? 0 }; });
    const reach = await page.evaluate(() => { const b = document.querySelector('.hm-sheet .at-cam-sound'); if (!b) return null; const r = b.getBoundingClientRect(), st = b.closest('.at-cam-stage').getBoundingClientRect(), live = b.closest('.at-cam-stage').querySelector('.hm-live')?.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2), cs = getComputedStyle(b); return { top: !!hit && b.contains(hit), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(st.right - r.right), bottom: Math.round(st.bottom - r.bottom), apartFromLive: !live || live.right <= r.left, bg: cs.backgroundColor, color: cs.color }; });
    check(`CODEX-015 [${theme} ${w}]: the sound button stands on the picture in the stage's lower right corner — a pointer reaches it; the SD button's dark chip, clear of LIVE`, !!reach && reach.top && reach.w >= 24 && reach.h >= 24 && reach.right >= 0 && reach.right <= 16 && reach.bottom >= 0 && reach.bottom <= 16 && reach.apartFromLive && reach.bg === 'rgba(0, 0, 0, 0.667)' && reach.color === 'rgb(255, 255, 255)', reach);
    await page.screenshot({ path: `${out}/codex015-sound-off-${theme}.png` });
    try { await page.click('.hm-sheet .at-cam-sound', { timeout: 3000 }); } catch { await page.focus('.hm-sheet .at-cam-sound').catch(() => {}); await page.keyboard.press('Enter'); } // the old build hid it under the video: the keyboard still reaches it
    await page.waitForTimeout(400); const on = await state(); await page.screenshot({ path: `${out}/codex015-sound-on-${theme}.png` });
    check(`CODEX-015 [${theme} ${w}]: sound on — the video is heard, the button is pressed, the chip says «Звук»`, on.muted === false && on.pressed === 'true' && /звук/i.test(on.chip ?? ''), on);
    // pressed, it takes the accent as before; its glyph stays readable on it in both themes (≥ 3:1 for a control's graphic)
    const ink = await page.evaluate(() => { const b = document.querySelector('.hm-sheet .at-cam-sound.is-on'); if (!b) return null; const cs = getComputedStyle(b), rgb = s => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number), lum = c => { const [r, g, bl] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; }; const a = lum(rgb(cs.color)), z = lum(rgb(cs.backgroundColor)); return { bg: cs.backgroundColor, color: cs.color, ratio: Math.round(((Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05)) * 100) / 100 }; });
    check(`CODEX-015 [${theme} ${w}]: the pressed sound button is the accent with a readable glyph`, !!ink && ink.bg !== 'rgba(0, 0, 0, 0.667)' && ink.ratio >= 3, ink);
    const rebuild = async () => { const before = (await state()).peers; await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(300); await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForFunction(n => (window.__peers ?? 0) > n && document.querySelector('.hm-sheet .at-go2rtc')?.dataset.playerStatus === 'live', before, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(600); return state(); };
    const kept = await rebuild();
    check(`CODEX-015 [${theme} ${w}]: a new player (the add-on's stream ↔ WebRTC) keeps the sound, and the button says what the video does`, kept.peers > on.peers && kept.status === 'live' && kept.muted === false && kept.pressed === 'true' && /звук/i.test(kept.chip ?? ''), kept);
    await page.evaluate(() => { window.__refuseSound = true; }); const refused = await rebuild();
    check(`CODEX-015 [${theme} ${w}]: a browser that refuses sound without a tap — the picture plays muted and the button goes off (never «Звук» over a silent video)`, refused.peers > kept.peers && refused.status === 'live' && refused.paused === false && refused.muted === true && refused.pressed === 'false' && !/звук/i.test(refused.chip ?? ''), refused);
    check(`CODEX-015 [${theme} ${w}]: no page errors`, !errors.length, errors); await ctx.close();
  }
  // …and the SD/HD button, on a touch screen too, stands in the stage's top right corner (the same touch rule had pushed it half out of the frame, top left)
  for (const [theme, w, h, touch] of [['light', 1070, 764, false], ['dark', 360, 792, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=${theme}&lang=ru#camera?device=e%3Acamera.entrance_camera`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.hm-sheet .at-camera-q', { timeout: 4000 }).catch(() => {});
    const q = await page.evaluate(() => { const b = document.querySelector('.hm-sheet .at-camera-q'); if (!b) return null; const r = b.getBoundingClientRect(), st = b.closest('.at-cam-stage').getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { top: !!hit && b.contains(hit), right: Math.round(st.right - r.right), up: Math.round(r.top - st.top), inside: r.left >= st.left && r.right <= st.right }; });
    check(`CODEX-015 [${theme} ${w}]: the SD/HD button stands in the stage's top right corner, whole and reachable`, !!q && q.top && q.inside && q.right >= 0 && q.right <= 16 && q.up >= 0 && q.up <= 16, q); await ctx.close();
  }
  // CODEX-016: the doorbell's full stream does not come (no recorded frame for it here): the light one plays in front, the full one keeps trying unseen —
  // after its eight seconds it has «Нет связи» and «Повторить», which neither Tab nor a screen reader may reach while it is hidden
  { const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.route('**/__state**', async route => { const r = await route.fetch(), j = await r.json(); delete j.frames.entrance_doorbell; delete j.frames['camera.entrance_doorbell_video']; await route.fulfill({ response: r, json: j }); }); // the 1080p stream and its HA camera
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=light&lang=ru#camera`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.at-cams-cell');
    await page.focus(`.at-cams-cell[data-device-key="${DOOR}"] .at-cams-hit`); await page.keyboard.press('Enter'); await page.waitForSelector('.hm-sheet .at-cam-layer', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(9500);
    const hd = await page.evaluate(() => { const l = document.querySelector('.hm-sheet .at-cam-layer[data-quality="high"]'); return { pending: l?.classList.contains('is-pending'), inert: l?.hasAttribute('inert'), hidden: l?.getAttribute('aria-hidden'), retry: !!l?.querySelector('.at-cam-retry'), low: !!document.querySelector('.hm-sheet .at-cam-layer:not([data-quality])') }; });
    const walked = []; for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); walked.push(await page.evaluate(() => { const a = document.activeElement; return a?.closest('.at-cam-layer[data-quality="high"]') ? 'HD:' + (a.textContent || a.getAttribute('aria-label')) : a?.closest('.hm-sheet') ? 'sheet' : 'out'; })); }
    const tree = await page.locator('.hm-sheet .at-cam-stage').ariaSnapshot().catch(e => 'error: ' + e.message);
    check('CODEX-016: the unseen full-quality layer is inert and aria-hidden while the light one plays', hd.pending && hd.inert && hd.hidden === 'true' && hd.retry && hd.low, hd);
    check('CODEX-016: Tab never lands on its «Повторить»', !walked.some(x => x.startsWith('HD:')), walked.filter(x => x.startsWith('HD:')));
    check('CODEX-016: a screen reader hears neither its «Нет связи с камерой» nor its «Повторить»', !/Повторить|Нет связи/.test(tree), tree);
    await page.screenshot({ path: `${out}/codex016-hd-pending.png` }); await ctx.close(); }
  { const { page, ctx } = await open({ scenario: 'quiet', hash: '#camera?device=e%3Acamera.entrance_doorbell' }); await page.waitForTimeout(600);
    const shown = await page.evaluate(() => { const l = document.querySelector('.hm-sheet .at-cam-layer[data-quality="high"]'); return { pending: l?.classList.contains('is-pending'), inert: l?.hasAttribute('inert') ?? null, hidden: l?.getAttribute('aria-hidden') ?? null }; });
    check('CODEX-016: once the full stream plays, its layer is an ordinary part of the page again', shown.pending === false && shown.inert === false && shown.hidden === null, shown); await ctx.close(); }
  // ST-07: «Всего за неделю: N; остальное — в журнале HA» only for what the chosen filter hides. A busy week is written into the preview's history here
  // (the card's scenarios are not this script's): that many rings at the door, that many motions of the hall's Imou, five hours apart.
  const MORE = /журнале HA|HA logbook|jurnalul HA/;
  const busy = ({ rings, hallMotions }) => async page => page.route('**/__state**', async route => { const r = await route.fetch(), j = await r.json(), now = Date.now(), at = m => (now - m * 60_000) / 1000, week = n => Array.from({ length: n }, (_, i) => 30 + i * 300);
    if (rings) j.camHistory['event.entrance_doorbell_ring'] = week(rings).map(m => ({ s: new Date(now - m * 60_000).toISOString(), lc: at(m) }));
    if (hallMotions) j.camHistory['binary_sensor.hall_camera_motion'] = week(hallMotions).flatMap(m => [{ s: 'on', lc: at(m) }, { s: 'off', lc: at(m - 0.5) }]);
    await route.fulfill({ response: r, json: j }); });
  const feedState = page => page.evaluate(more => { const s = document.querySelector('.hm-sheet .at-door-events'); const line = [...(s?.querySelectorAll('.at-cam-kv') ?? [])].map(x => x.textContent).find(x => new RegExp(more).test(x)) ?? null; return { rows: s?.querySelectorAll('.at-door-ev').length ?? -1, seg: [...(s?.querySelectorAll('.at-door-seg button') ?? [])].map(b => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`), line, n: line ? Number(line.match(/\d+/)?.[0]) : null }; }, MORE.source);
  const sheetOf = async (opts, device, prep) => { const ctx = await browser.newContext({ viewport: { width: opts.w ?? 1070, height: opts.h ?? 764 }, hasTouch: (opts.w ?? 1070) < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    if (prep) await prep(page); await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=${opts.theme ?? 'light'}&lang=${opts.lang ?? 'ru'}#camera`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.at-cams-cell', { timeout: 8000 }).catch(() => {});
    await page.evaluate(d => { location.hash = `#camera?device=${encodeURIComponent(d)}`; }, device); await page.waitForSelector('.hm-sheet .at-door-ev', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1800); return { page, ctx, errors }; };
  const filters = async page => { const res = []; const n = await page.locator('.hm-sheet .at-door-seg button').count(); for (let i = 0; i < n; i++) { await page.locator('.hm-sheet .at-door-seg button').nth(i).click(); await page.waitForTimeout(150); res.push(await feedState(page)); } return res; };
  for (const [theme, lang, w, h] of [['dark', 'ru', 1070, 764], ['light', 'ru', 320, 568], ['light', 'en', 1070, 764], ['dark', 'ro', 320, 568]]) {
    const { page, ctx, errors } = await sheetOf({ w, h, theme, lang }, DOOR);
    const sent0 = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').length), f = await filters(page), sent1 = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').length);
    check(`ST-07 [${theme} ${lang} ${w}×${h}]: Все / Звонки / Движение show 7 / 2 / 5 with nothing «in the HA logbook»; the pressed one says so; counts 2 and 5; nothing sent`, f.map(x => x.rows).join() === '7,2,5' && f.every(x => x.line === null) && f.map(x => x.seg.findIndex(s => s.endsWith('*'))).join() === '0,1,2' && /· 2\*?$/.test(f[0].seg[1]) && /· 5\*?$/.test(f[0].seg[2]) && sent1 === sent0 && !errors.length, { f, sent0, sent1, errors });
    await page.locator('.hm-sheet .at-door-seg button').nth(1).click(); await page.waitForTimeout(150); await page.locator('.hm-sheet .at-door-events').scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${out}/st07-${theme}-${lang}-${w}.png` }); await ctx.close(); // «Звонки» chosen: two rows and no line under them
  }
  { const { page, ctx } = await sheetOf({}, DOOR, busy({ rings: 31 })); const f = await filters(page);
    check('ST-07: 31 rings and 5 motions — Все: 30 rows, «36»; Звонки: 30 rows, «31»; Движение: 5 rows, no line', f.map(x => `${x.rows}:${x.n}`).join() === '30:36,30:31,5:null', f); await ctx.close(); }
  { const { page, ctx } = await sheetOf({}, DOOR, busy({ rings: 30 })); const f = await filters(page);
    check('ST-07: exactly thirty rings — Звонки shows all thirty and promises nothing more', f[1]?.rows === 30 && f[1]?.line === null && f[0]?.n === 35, f); await ctx.close(); }
  { const { page, ctx } = await sheetOf({}, HALL, busy({ hallMotions: 31 })); const f = await filters(page);
    check('ST-07: a camera without a bell (the hall) — no «Звонки»; Движение: 30 rows and «31»', f.length === 2 && f[0].seg.length === 2 && !f[0].seg.some(s => /Звонк/.test(s)) && f[1].rows === 30 && f[1].n === 31, f); await ctx.close(); }
  // …and the list's own states stay apart: still reading, an empty week, a refused read and its retry
  for (const mode of ['pending', 'empty', 'refused']) {
    const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.addInitScript(m => { window.__mode = m; window.__beforeDraw = h => { const ws = h.ws?.bind(h); if (ws) h.ws = q => q.type === 'history/history_during_period' && (q.entity_ids?.length ?? 0) <= 2 && window.__mode ? (window.__mode === 'pending' ? new Promise(() => {}) : window.__mode === 'empty' ? Promise.resolve({}) : Promise.reject({ code: 'unknown_error', message: 'Recorder is not ready' })) : ws(q); }; }, mode);
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=light&lang=ru#camera?device=e%3Acamera.entrance_doorbell`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.hm-sheet .at-door-events', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1800);
    const s = await page.evaluate(() => { const e = document.querySelector('.hm-sheet .at-door-events'); return { text: e?.innerText ?? '', rows: e?.querySelectorAll('.at-door-ev').length ?? -1, fail: !!e?.querySelector('.at-feed-fail') }; });
    if (mode === 'pending') { const f = await feedState(page); check('ST-07: the week still being read says «Читаем журнал…», no counts, no line', /Читаем журнал/.test(s.text) && f.seg.length === 3 && f.seg.every(x => !/\d/.test(x)) && !MORE.test(s.text) && !s.fail && s.rows === 0, { s, f }); }
    if (mode === 'empty') check('ST-07: an empty week says «событий не было», no line', /событий не было/.test(s.text) && s.rows === 0 && !MORE.test(s.text) && !s.fail, s);
    if (mode === 'refused') { await page.evaluate(() => { window.__mode = null; }); await page.click('.hm-sheet .at-feed-fail button'); await page.waitForSelector('.hm-sheet .at-door-ev', { timeout: 8000 }).catch(() => {}); const r = await feedState(page);
      check('ST-07: a refused read is said with «Повторить», and the retry brings the seven events back without a line', s.fail && s.rows === 0 && r.rows === 7 && r.line === null, { s, r }); }
    await ctx.close();
  }
  // ST-08, the sheets' half: out of the video's full screen, the same sheet, its filter, the player, the address and the scroll stand as they were, and the
  // keyboard is back on «Во весь экран»; the next Escape closes the sheet and gives the keyboard back to the camera's cell. Element Fullscreen from a real key
  // press. Headless Chromium does not leave a full screen on Escape (the browser's own window does), so there it is left as the browser would leave it;
  // WebKit leaves it on a real Escape by itself, without handing the key to the page. (The shell's half — in Chromium the first Escape in a full screen
  // closing nothing — is ui/app.tsx's and is not checked here.)
  const fsState = page => page.evaluate(() => { const r = document.querySelector('#root').shadowRoot ?? document, s = r.querySelector('.hm-sheet'), a = r.activeElement, st = s?.querySelector('.at-cam-stage'); return { sheet: !!s, full: r.fullscreenElement ? (r.fullscreenElement === st ? 'stage' : r.fullscreenElement.className) : null, focus: a ? (a.classList.contains('at-cam-full') ? 'full-button' : a.classList.contains('at-cams-hit') ? 'cell:' + a.closest('.at-cams-cell')?.dataset.deviceKey : a.className || a.tagName) : null, hash: location.hash, kept: !!s?.querySelector('.at-cam-stage .hm-camera-mount')?.__kept, pressed: [...(s?.querySelectorAll('.at-door-seg button') ?? [])].map(b => b.getAttribute('aria-pressed')).join(), scroll: (s?.querySelector('.at-cam-left') ?? s)?.scrollTop ?? null, sent: window.atomPreview.host.log.filter(x => x.domain !== 'ws').length }; });
  async function fullscreenRun({ engine = 'chromium', device, theme, lang, w, h, shadow = false }) {
    const type = engine === 'webkit' ? webkit : chromium; let b2; try { b2 = engine === 'chromium' ? browser : await type.launch(); } catch (e) { check(`ST-08 [${engine}]: the browser starts`, false, e.message.split('\n')[0]); return; }
    const tag = `ST-08 [${engine} ${device === DOOR ? 'doorbell' : 'C700'} ${theme} ${lang} ${w}×${h}${shadow ? ' shadow' : ''}]`;
    const ctx = await b2.newContext({ viewport: { width: w, height: h }, hasTouch: false, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=${theme}&lang=${lang}${shadow ? '&shadow=1' : ''}#camera`); await page.waitForFunction(() => window.ready); await page.waitForTimeout(400);
    const cell = page.locator(`.at-cams-cell[data-device-key="${device}"] .at-cams-hit`); await cell.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    if (device === DOOR) { await page.locator('.hm-sheet .at-door-seg button').nth(1).click(); await page.waitForTimeout(150); }
    await page.evaluate(() => { const r = document.querySelector('#root').shadowRoot ?? document, m = r.querySelector('.hm-sheet .at-cam-stage .hm-camera-mount'); if (m) m.__kept = true; });
    await page.locator('.hm-sheet .at-cam-full').focus(); const before = await fsState(page); // the sheet as it stands with the keyboard on the button (focusing it scrolled it into view)
    await page.keyboard.press('Enter'); await page.waitForTimeout(500); const inFull = await fsState(page);
    if (engine === 'chromium') await page.evaluate(() => document.exitFullscreen().catch(() => {})); else await page.keyboard.press('Escape');
    await page.waitForTimeout(500); const back = await fsState(page);
    check(`${tag}: out of the full screen — the same sheet, filter, player, address and scroll; the keyboard on «Во весь экран»; nothing sent`, inFull.full === 'stage' && back.full === null && back.sheet && back.hash === before.hash && back.pressed === before.pressed && back.kept && back.scroll === before.scroll && back.focus === 'full-button' && back.sent === before.sent, { before, inFull, back });
    await page.screenshot({ path: `${out}/st08-${engine}-${device === DOOR ? 'door' : 'c700'}-${theme}-${w}${shadow ? '-shadow' : ''}.png` }); // back from the full screen: the same sheet, the ring on «Во весь экран»
    await page.keyboard.press('Escape'); await page.waitForTimeout(500); const closed = await fsState(page);
    check(`${tag}: the next Escape closes the sheet and gives the keyboard back to the camera's cell`, !closed.sheet && closed.focus === `cell:${device}` && !errors.length, { closed, errors });
    await ctx.close(); if (b2 !== browser) await b2.close();
  }
  await fullscreenRun({ device: DOOR, theme: 'dark', lang: 'en', w: 1070, h: 764 });
  await fullscreenRun({ device: DOOR, theme: 'light', lang: 'ru', w: 320, h: 568 });
  await fullscreenRun({ device: C700, theme: 'light', lang: 'ro', w: 568, h: 320 });
  await fullscreenRun({ device: DOOR, theme: 'dark', lang: 'ru', w: 1070, h: 764, shadow: true });
  await fullscreenRun({ device: C700, theme: 'light', lang: 'en', w: 1070, h: 764, shadow: true });
  await fullscreenRun({ engine: 'webkit', device: DOOR, theme: 'dark', lang: 'en', w: 1070, h: 764 });
  await fullscreenRun({ engine: 'webkit', device: C700, theme: 'light', lang: 'ru', w: 360, h: 792, shadow: true });
  // ST-08: two full screens in a row leave no listener behind; a sheet closed in its full screen leaves none either, and an Escape in the next sheet does
  // its usual thing (the keyboard does not jump to the old button); a refused full screen moves nothing and leaves no unhandled rejection
  { const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, hasTouch: false, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.__fsl = new Set(); const add = Document.prototype.addEventListener, rem = Document.prototype.removeEventListener; Document.prototype.addEventListener = function (t, f, o) { if (t === 'fullscreenchange') window.__fsl.add(f); return add.call(this, t, f, o); }; Document.prototype.removeEventListener = function (t, f, o) { if (t === 'fullscreenchange') window.__fsl.delete(f); return rem.call(this, t, f, o); }; });
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=light&lang=ru#camera`); await page.waitForFunction(() => window.ready); await page.waitForTimeout(400);
    await page.focus(`.at-cams-cell[data-device-key="${DOOR}"] .at-cams-hit`); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    const counts = []; for (let i = 0; i < 2; i++) { await page.locator('.hm-sheet .at-cam-full').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(300); counts.push(await page.evaluate(() => window.__fsl.size)); await page.evaluate(() => document.exitFullscreen().catch(() => {})); await page.waitForTimeout(300); counts.push(await page.evaluate(() => window.__fsl.size)); }
    const twice = await fsState(page);
    check('ST-08: two full screens in a row — one listener while each lasts, none after, the keyboard back on the button each time', counts.join() === '1,0,1,0' && twice.sheet && twice.focus === 'full-button', { counts, twice });
    await page.locator('.hm-sheet .at-cam-full').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(300); await page.evaluate(() => { location.hash = '#camera'; }); await page.waitForTimeout(500); // the sheet goes away while its stage is full screen
    const gone = await page.evaluate(() => ({ listeners: window.__fsl.size, full: !!document.fullscreenElement, sheet: !!document.querySelector('.hm-sheet') }));
    await page.focus(`.at-cams-cell[data-device-key="${C700}"] .at-cams-hit`); await page.keyboard.press('Enter'); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    const other = await fsState(page);
    check('ST-08: a sheet closed in its full screen leaves no listener; Escape in the next sheet closes it and the keyboard goes to that camera\'s cell', gone.listeners === 0 && !gone.full && !gone.sheet && !other.sheet && other.focus === `cell:${C700}` && !errors.length, { gone, other, errors }); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, hasTouch: false, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')); }; delete HTMLVideoElement.prototype.webkitEnterFullscreen; });
    await page.goto(`${origin}/?card=cameras&scenario=quiet&theme=light&lang=ru#camera?device=e%3Acamera.entrance_doorbell`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.hm-sheet .at-cam-full'); await page.waitForTimeout(500);
    await page.locator('.hm-sheet .at-cam-full').focus(); const before = await fsState(page); await page.keyboard.press('Enter'); await page.waitForTimeout(500); const after = await fsState(page);
    check('ST-08: a refused full screen — the sheet, the address and the focus stay, no unhandled rejection', after.sheet && after.hash === before.hash && after.focus === 'full-button' && after.full === null && !errors.length, { after, errors }); await ctx.close(); }
  // 5. languages: no raw keys, the line in en / ro
  for (const lang of ['en', 'ro']) for (const hash of ['#home', '#camera']) { const { page, ctx, errors } = await open({ lang, scenario: 'person', hash }); const raw = await page.evaluate(() => (document.querySelector('.hm-main').innerText.match(/\b(cams|module)\.[a-z.]+/g) ?? [])); check(`${lang} ${hash}: no raw keys`, !raw.length && !errors.length, [raw, errors]); await page.screenshot({ path: `${out}/${lang}-${hash.slice(1)}.png` }); await ctx.close(); }
  // 6. reduced motion: nothing animates on the card
  { const { page, ctx } = await open({ reduced: true, scenario: 'ring' }); const anim = await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('.at-cams-tile')).length); check('reduced motion: the card is still', anim === 0, anim); await ctx.close(); }
} finally { await browser.close(); }
stop(fails.length ? 1 : 0);
