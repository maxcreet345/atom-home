import { existsSync } from 'node:fs';
import { freePort } from './free-port.mjs';
// Everything the Vacuum card must hold, in one run: every state on every device size in both themes, accessibility (axe), touch targets,
// the words in three languages, and each button's single command. Nothing reaches the robot: the preview host records every command.
// usage: node scripts/qa-vacuum.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout, targets } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/vacuum'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const port = await freePort(), srv = spawn('node', ['scripts/card-preview.mjs', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, no) => { srv.stdout.on('data', d => { if (String(d).includes('ready')) ok(); }); setTimeout(() => no(new Error('preview server did not start')), 15000); });
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
let last = '';
const check = (name, ok, info) => { last = name; if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 260)}`); };
const report = () => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); };
const finish = async code => { report(); await browser.close().catch(() => {}); srv.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped after «' + last + '»: ' + e.message.slice(0, 300)); void finish(1); });
const axeSrc = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
async function open({ scenario = 'cleaning', w = 1280, h = 800, theme = 'light', lang = 'ru', hash = '#home', accept = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100 }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/preview: commands are rejected|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=vacuum&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  await page.evaluate(a => window.atomPreview.host.setAccept(a), accept); await page.waitForTimeout(450);
  return { page, ctx, errors };
}
const log = page => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => ({ d: c.domain, s: c.service, ...c.data })));
const axe = async (page, sel) => { await page.addScriptTag({ content: axeSrc }); return page.evaluate(async s => (await window.axe.run(document.querySelector(s) ?? document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`), sel); };
const scrollAll = page => page.evaluate(async () => { const m = document.querySelector('.hm-main'); if (!m) return; for (let y = 0; y <= m.scrollHeight; y += 300) { m.scrollTop = y; await new Promise(r => setTimeout(r, 20)); } m.scrollTop = 0; });
const RAW = /module\.vac|undefined|NaN|null|\[object/;
// the Roborock renders live in the house's private photos (not in the repository): where they are absent the card must fall back to the drawn robot, and the checks say which of the two they saw
const PICS = existsSync(resolve(root, '../private/camera-frames/vacuum-robot.webp')) && existsSync(resolve(root, '../private/camera-frames/vacuum-dock.webp'));
// 1. every state × every size × both themes
const SIZES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [1280, 800, 'pad-wide'], [698, 751, 'open'], [1440, 900, 'mac'], [1920, 1080, 'tv']];
const SCEN = ['cleaning', 'docked', 'paused', 'returning', 'warn', 'error', 'offline', 'unlinked', 'drawn'];
const ONLY = process.env.QA_ONLY;
if (!ONLY && !process.env.QA_AXE) for (const theme of ['light', 'dark']) for (const [w, h, dev] of SIZES) for (const scenario of SCEN) {
  const tag = `${scenario}/${dev}/${theme}`;
  const home = await open({ scenario, w, h, theme }); const tile = await home.page.$('.at-vac-tile');
  check(`tile shown ${tag}`, !!tile);
  if (tile) { const l = await layout(home.page, '.at-vac-tile'), tg = await targets(home.page, '.at-vac-tile'); check(`tile layout ${tag}`, l.length === 0, l); check(`tile targets ${tag}`, tg.length === 0, tg);
    check(`no «Уборка» group tile beside it ${tag}`, !(await home.page.$('.ah-group-tile.kind-cleaning')));
    check(`tile no raw text ${tag}`, !RAW.test(await tile.innerText()));
    if (theme === 'light' && (dev === 'pad-wide' || dev === '13R')) await tile.screenshot({ path: `${out}/tile-${scenario}-${dev}.png` }); }
  check(`no page error home ${tag}`, home.errors.length === 0, home.errors); await home.ctx.close();
  for (const hash of ['#cleaning', '#cleaning?filter=settings']) {
    const panel = await open({ scenario, w, h, theme, hash }); await scrollAll(panel.page); const where = hash.includes('settings') ? 'settings' : 'panel';
    const lay = await layout(panel.page, '.at-vac-panel'), tg = await targets(panel.page, '.at-vac-panel');
    check(`${where} layout ${tag}`, lay.length === 0, lay); check(`${where} targets ${tag}`, tg.length === 0, tg);
    const txt = await panel.page.evaluate(() => document.querySelector('.at-vac-panel')?.innerText ?? '');
    check(`${where} no raw text ${tag}`, txt.length > 50 && !RAW.test(txt), txt.match(RAW)?.[0]);
    check(`${where} no sideways scroll ${tag}`, await panel.page.evaluate(() => { const m = document.querySelector('.hm-main'); return !m || m.scrollWidth <= m.clientWidth + 1; }));
    check(`no page error ${where} ${tag}`, panel.errors.length === 0, panel.errors);
    if (theme === 'light' && (dev === 'pad-wide' || dev === '13R') && (scenario === 'cleaning' || scenario === 'warn')) await panel.page.screenshot({ path: `${out}/${where}-${scenario}-${dev}.png` });
    await panel.ctx.close();
  }
}
// 2. accessibility
if (!ONLY || process.env.QA_AXE) for (const theme of ['light', 'dark']) for (const scenario of ['cleaning', 'docked', 'warn', 'error', 'offline']) {
  const a = await open({ scenario, theme }); const v1 = await axe(a.page, '.at-vac-tile'); check(`axe tile ${scenario}/${theme}`, v1.length === 0, v1); await a.ctx.close();
  const b = await open({ scenario, theme, hash: '#cleaning' }); const v2 = await axe(b.page, '.at-vac-panel'); check(`axe panel ${scenario}/${theme}`, v2.length === 0, v2); await b.ctx.close();
  const c = await open({ scenario, theme, hash: '#cleaning?filter=settings' }); const v3 = await axe(c.page, '.at-vac-panel'); check(`axe settings ${scenario}/${theme}`, v3.length === 0, v3); await c.ctx.close();
}
// 3. the words in three languages, and what the owner reads
for (const lang of ['ru', 'en', 'ro']) for (const hash of ['#home', '#cleaning', '#cleaning?filter=settings']) { const p = await open({ scenario: 'warn', lang, hash }); const t = await p.page.evaluate(() => document.querySelector('.hm-main')?.innerText ?? ''); check(`no missing words ${lang} ${hash}`, !/module\.vac/.test(t), t.match(/module\.vac\.[\w.]+/g)); await p.ctx.close(); }
{ const p = await open({}); const t = await p.page.locator('.at-vac-tile').innerText();
  check('cleaning tile: room and progress', /Убирает · Кухня · \d+ %/.test(t), t); await p.page.waitForTimeout(600); check(PICS ? 'cleaning tile: the Roborock render, not the drawing' : 'cleaning tile: the render is not on this machine — the drawn robot stands in, no broken picture', PICS ? await p.page.locator('.at-vac-tile .at-vac-pic.is-out img').count() === 1 : await p.page.locator('.at-vac-tile svg.at-vac-buddy').count() === 1 && await p.page.locator('.at-vac-tile .at-vac-pic img').count() === 0); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked' }); await p.page.waitForTimeout(600); check(PICS ? 'docked tile: the robot on its dock' : 'docked tile: the render is not on this machine — the drawn robot stands in, no broken picture', PICS ? await p.page.locator('.at-vac-tile .at-vac-pic.is-home img').count() === 1 : await p.page.locator('.at-vac-tile svg.at-vac-buddy').count() === 1 && await p.page.locator('.at-vac-tile .at-vac-pic img').count() === 0); await p.ctx.close(); }
{ const p = await open({ scenario: 'drawn' }); check('without renders the drawn robot stands in', await p.page.locator('.at-vac-tile svg.at-vac-buddy').count() === 1); await p.ctx.close(); }
{ const p = await open({ scenario: 'warn', hash: '#cleaning' }); const t = await p.page.locator('.at-vac-panel').innerText();
  check('warn: the dock says what is wrong', t.includes('База: бак грязной воды полон'), t.slice(0, 300)); check('warn: the sensors are due', t.includes('Пора менять: Датчики')); await p.ctx.close(); }
{ const p = await open({ scenario: 'error' }); check('error: the words', (await p.page.locator('.at-vac-tile').innerText()).includes('Ошибка: застрял')); await p.page.locator('.at-vac-go').click(); await p.page.waitForTimeout(150); const l = await log(p.page); check('error: «Продолжить» resumes once freed', l.length === 1 && l[0].s === 'start', l); await p.ctx.close(); }
{ const p = await open({ scenario: 'unlinked', hash: '#cleaning' }); check('unlinked: the rooms say they need linking', (await p.page.locator('.at-vac-panel').innerText()).includes('не связаны с зонами HA')); await p.ctx.close(); }
{ const p = await open({ hash: '#cleaning' }); check('nine rooms in the robot\'s order', (await p.page.locator('.at-vac-room:not(.is-all) span').allInnerTexts()).join(',').replace(/\u00a0/g, ' ') === 'Гостиная,Коридор у спальни,Спальня,Прихожая,Детская,Коридор у ванной,Кухня,Компьютерная,Ванная');
  check('the room it is in now is marked', (await p.page.locator('.at-vac-room.is-here').innerText()).includes('Кухня')); await p.ctx.close(); }
// 4. every button sends one command, with the right data
const E = 'vacuum.living_robot_vacuum';
{ const p = await open({}); await p.page.locator('.at-vac-tile .at-vac-go').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('cleaning tile main: pause', l.length === 1 && l[0].s === 'pause' && l[0].entity_id === E, l);
  await p.page.locator('.at-vac-tile .at-vac-home').click(); await p.page.waitForTimeout(150); const d = (await log(p.page)).slice(1);
  check('tile «На базу»: return_to_base', d.length === 1 && d[0].s === 'return_to_base', d); await p.ctx.close(); }
{ const p = await open({ scenario: 'paused' }); await p.page.locator('.at-vac-tile .at-vac-go').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('paused tile main: start (resume)', l.length === 1 && l[0].s === 'start', l); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked' }); await p.page.locator('.at-vac-tile .at-vac-go').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('docked tile main: start the whole flat', l.length === 1 && l[0].s === 'start', l);
  await p.page.locator('.at-vac-tile .at-vac-home').click({ force: true }); await p.page.waitForTimeout(150); check('docked «На базе» sends nothing', (await log(p.page)).length === 1); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked', hash: '#cleaning' }); const rooms = p.page.locator('.at-vac-room:not(.is-all)');
  await rooms.nth(6).click(); await rooms.nth(0).click(); check('the main button counts the rooms', (await p.page.locator('.at-vac-big').innerText()).includes('Убрать 2 комнаты'));
  await p.page.locator('.at-vac-big').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('two rooms ×1: clean_area in the order chosen', l.length === 1 && l[0].s === 'clean_area' && JSON.stringify(l[0].cleaning_area_id) === '["kukhnia","gostinaia"]', l);
  await p.page.locator('.at-vac-repeat button', { hasText: '×2' }).click(); await p.page.locator('.at-vac-big').click(); await p.page.waitForTimeout(150); const r = (await log(p.page)).slice(1);
  check('two rooms ×2: app_segment_clean with repeat', r.length === 1 && r[0].s === 'send_command' && r[0].command === 'app_segment_clean' && JSON.stringify(r[0].params) === '[{"segments":[7,1],"repeat":2}]', r);
  await p.page.locator('.at-vac-room.is-all').click(); check('«Вся квартира» clears the choice', (await p.page.locator('.at-vac-room.is-on').count()) === 1);
  await p.page.locator('.at-vac-mode', { hasText: 'Пылесос и швабра' }).click(); await p.page.waitForTimeout(150); const m = (await log(p.page)).slice(2);
  check('mode: select_option on the cleaning mode', m.length === 1 && m[0].s === 'select_option' && m[0].option === 'vac_and_mop' && m[0].entity_id === 'select.living_robot_vacuum_cleaning_mode', m);
  await p.page.locator('.at-vac-dockbtn', { hasText: 'Помыть швабру' }).click(); await p.page.waitForTimeout(150); const w = (await log(p.page)).slice(3);
  check('dock «Помыть швабру»: its switch on', w.length === 1 && w[0].s === 'turn_on' && w[0].entity_id === 'switch.living_robot_vacuum_dock_mop_washing', w);
  await p.page.locator('.at-vac-corner .at-vac-icon').first().click(); await p.page.waitForTimeout(150); const lo = (await log(p.page)).slice(4);
  check('«Найти»: locate', lo.length === 1 && lo[0].s === 'locate', lo);
  await p.page.locator('.at-vac-corner .at-vac-icon').last().click(); await p.page.waitForTimeout(300);
  check('the gear opens the settings', await p.page.locator('.at-vac-panel.is-settings').count() === 1 && /filter=settings/.test(p.page.url())); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked', hash: '#cleaning' }); await p.page.locator('.at-vac-seg button', { hasText: 'Турбо' }).first().click({ force: true }); await p.page.waitForTimeout(150);
  check('in «Умный» the suction is not pressable', (await log(p.page)).length === 0); await p.ctx.close(); }
{ const p = await open({ hash: '#cleaning' }); await p.page.locator('.at-vac-side', { hasText: 'Стоп' }).click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('cleaning «Стоп»: stop', l.length === 1 && l[0].s === 'stop', l);
  await p.page.locator('.at-vac-room:not(.is-all)').first().click({ force: true }); check('rooms are not chosen while it cleans', (await p.page.locator('.at-vac-room.is-on').count()) === 1);
  await p.page.locator('.at-vac-dockbtn').first().click({ force: true }); await p.page.waitForTimeout(150); check('dock jobs wait for the robot on the dock', (await log(p.page)).length === 1); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked', hash: '#cleaning?filter=settings' }); const part = p.page.locator('.at-vac-part', { hasText: 'Фильтр' }).first();
  await part.locator('.at-vac-pill').click(); await p.page.waitForTimeout(150); check('«Сброс» asks first and sends nothing', (await log(p.page)).length === 0 && await part.locator('.at-vac-part-ask').isVisible());
  check('…with focus on «Отмена»', await p.page.evaluate(() => document.activeElement?.textContent === 'Отмена'));
  await part.locator('.is-danger').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('…then presses the filter reset', l.length === 1 && l[0].s === 'press' && l[0].entity_id === 'button.living_robot_vacuum_reset_air_filter_consumable', l);
  await p.page.locator('.at-vac-set-row', { hasText: 'Не беспокоить' }).locator('.at-vac-switch').click(); await p.page.waitForTimeout(150); const d = (await log(p.page)).slice(1);
  check('«Не беспокоить»: its switch on', d.length === 1 && d[0].s === 'turn_on' && d[0].entity_id === 'switch.living_robot_vacuum_do_not_disturb', d);
  await p.page.locator('.at-vac-routine').click(); await p.page.waitForTimeout(150); const r = (await log(p.page)).slice(2);
  check('«Полная уборка»: the Roborock routine button', r.length === 1 && r[0].s === 'press' && /polnaia_uborka/.test(r[0].entity_id), r);
  await p.page.locator('.at-vac-set-head .hm-back').click(); await p.page.waitForTimeout(300); check('back returns to the panel', await p.page.locator('.at-vac-panel:not(.is-settings)').count() === 1); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked', hash: '#cleaning' }); await p.page.locator('.at-vac-repeat button', { hasText: '×2' }).click(); await p.page.locator('.at-vac-big').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('whole flat ×2: every linked room twice', l.length === 1 && l[0].command === 'app_segment_clean' && JSON.stringify(l[0].params) === '[{"segments":[1,2,3,4,5,6,7,9,10],"repeat":2}]', l); await p.ctx.close(); }
// 5. a refused command is said
{ const p = await open({ accept: false }); await p.page.locator('.at-vac-tile .at-vac-go').click(); await p.page.waitForTimeout(400);
  const said = await p.page.locator('.at-vac-tile .at-heat-err').innerText(); check('a refused command is said on the tile, in a sentence', /[а-яё]{4}/i.test(said) && !/object|undefined/i.test(said), said); await p.ctx.close(); }
// 6. the offline robot offers nothing to press
{ const p = await open({ scenario: 'offline' }); check('offline: start not pressable', await p.page.locator('.at-vac-go').getAttribute('aria-disabled') === 'true'); await p.page.locator('.at-vac-go').click({ force: true }); await p.page.waitForTimeout(150); check('offline: nothing sent', (await log(p.page)).length === 0); await p.ctx.close(); }
{ const p = await open({ scenario: 'offline', hash: '#cleaning' });
  const off = await p.page.evaluate(() => ({ modes: [...document.querySelectorAll('.at-vac-mode')].map(b => b.getAttribute('aria-disabled')), chips: [...document.querySelectorAll('#at-vac-mode .at-vac-seg button')].map(b => b.disabled), stop: document.querySelector('.at-vac-side')?.getAttribute('aria-disabled') ?? null }));
  check('offline: every mode and every chip is locked', off.modes.length > 0 && off.modes.every(x => x === 'true') && off.chips.every(Boolean), off);
  await p.page.evaluate(() => { document.querySelectorAll('.at-vac-mode, #at-vac-mode .at-vac-seg button, .at-vac-routine, .at-vac-dockbtn').forEach(b => b.click()); }); await p.page.waitForTimeout(250);
  check('offline: pressing them sends nothing', (await log(p.page)).length === 0, await log(p.page)); await p.ctx.close(); }
// 7. the house itself off the line (the robot is fine): nothing is sent, and the tile says why
{ const p = await open({ scenario: 'docked' }); await p.page.evaluate(() => window.atomPreview.setOnline(false)); await p.page.waitForTimeout(200); await p.page.locator('.at-vac-tile .at-vac-go').click({ force: true }); await p.page.waitForTimeout(400);
  const said = await p.page.locator('.at-vac-tile .at-heat-err').innerText().catch(() => ''); check('house offline: no command leaves the panel', (await log(p.page)).length === 0, await log(p.page)); check('house offline: the tile says «Нет связи с домом» (or the shell does)', /Нет связи с домом/.test(said) || /Нет связи с домом/.test(await p.page.evaluate(() => document.body.innerText)), said); await p.ctx.close(); }
// settings: the last volume picked is the one the robot ends on; a refusal puts the slider back; «‹ Пылесос» is a step back in history, not a new entry
{ const p = await open({ scenario: 'docked', hash: '#cleaning?filter=settings' }); await p.page.waitForSelector('.at-vac-range'); await p.page.evaluate(() => window.atomPreview.setDelay(800));
  const setVol = v => p.page.evaluate(n => { const el = document.querySelector('.at-vac-range'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(n)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await setVol(50); await p.page.waitForTimeout(200); await setVol(80); await p.page.waitForFunction(() => window.atomPreview.host.log.filter(c => c.service === 'set_value' && c.domain === 'number').length >= 2, null, { timeout: 8000 }).catch(() => {});
  const vols = (await log(p.page)).filter(c => c.d === 'number' && c.s === 'set_value').map(c => c.value); check('volume: 50 and, during its wait, 80 → the robot gets 50 and then 80', vols.join() === '50,80', vols);
  await p.page.waitForTimeout(1000); await p.page.evaluate(() => { window.atomPreview.setDelay(0); window.atomPreview.host.setAccept(false); }); const shown0 = await p.page.evaluate(() => document.querySelector('.at-vac-range').value);
  await p.page.evaluate(() => { window.__volBefore = document.querySelector('.at-vac-range').closest('.at-vac-set-row').querySelector('small').textContent; }); await setVol(20); await p.page.waitForTimeout(500);
  const back = await p.page.evaluate(() => ({ row: document.querySelector('.at-vac-range').closest('.at-vac-set-row').querySelector('small').textContent, was: window.__volBefore, err: document.querySelector('.at-vac-set .at-heat-err, .at-vac-card .at-heat-err')?.textContent ?? '' }));
  check('volume refused: the row goes back to what the robot has (100 % in this snapshot), not the value that was refused', back.row === '100 %', back); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked', hash: '#home' }); await p.page.locator('.at-vac-tile .at-vac-open').click(); await p.page.waitForSelector('.at-vac-panel'); await p.page.locator('.at-vac-corner .at-vac-icon').last().click(); await p.page.waitForSelector('.at-vac-panel.is-settings'); await p.page.locator('.at-vac-set-head .hm-back').click(); await p.page.waitForSelector('.at-vac-panel:not(.is-settings)');
  await p.page.evaluate(() => { history.back(); }).catch(() => {}); await p.page.waitForTimeout(600); check('after «‹ Пылесос» the system Back goes to where the panel was opened from (Дом), not back into the settings', /#home/.test(p.page.url()) && !/filter=settings/.test(p.page.url()) && await p.page.locator('.at-vac-panel.is-settings').count() === 0, p.page.url()); await p.ctx.close(); }
// 8. audit 10.11.2026 — states: a trip to the dock mid-job, a leftover error, «unknown», a code without a word, a part past its life, the map that did not load
{ const p = await open({ scenario: 'washing' }); const t = await p.page.evaluate(() => { const tile = document.querySelector('.at-vac-tile'); return { say: tile.querySelector('.at-vac-tile-head small')?.textContent, go: tile.querySelector('.at-vac-go')?.className, pct: tile.querySelector('.at-vac-go-pct')?.textContent ?? null }; });
  check('washing the mop mid-job: the tile says so with the progress and offers «Пауза», not «Убрать всё»', /^Моет швабру · 91/.test(t.say ?? '') && /is-pause/.test(t.go ?? '') && /91/.test(t.pct ?? ''), t);
  await p.page.evaluate(() => { location.hash = '#cleaning'; }); await p.page.waitForSelector('.at-vac-panel');
  const pn = await p.page.evaluate(() => ({ rooms: [...document.querySelectorAll('.at-vac-room')].map(b => b.getAttribute('aria-disabled')), stop: [...document.querySelectorAll('.at-vac-side small')].map(x => x.textContent), big: document.querySelector('.at-vac-big')?.className }));
  check('washing the mop mid-job: the panel keeps «Стоп» and «Пауза», the rooms stay locked', pn.stop.includes('Стоп') && /is-pause/.test(pn.big ?? '') && pn.rooms.length > 0 && pn.rooms.every(x => x === 'true'), pn); await p.ctx.close(); }
{ const p = await open({ scenario: 'leftover' }); const t = await p.page.evaluate(() => { const tile = document.querySelector('.at-vac-tile'); return { alert: tile.querySelector('.at-vac-alert')?.textContent ?? null, label: tile.querySelector('.at-vac-open')?.getAttribute('aria-label'), cls: tile.className }; });
  check('a leftover error on a docked robot is named on the tile and in its label', /застряла основная щётка/.test(t.alert ?? '') && /застряла основная щётка/.test(t.label ?? '') && /vz-care/.test(t.cls), t);
  await p.page.evaluate(() => { location.hash = '#cleaning'; }); await p.page.waitForSelector('.at-vac-alerts');
  check('…and in the panel, not «Пылесос сообщил об ошибке»', /застряла основная щётка/.test(await p.page.locator('.at-vac-alerts').innerText()));
  await p.page.evaluate(() => { location.hash = '#cleaning?filter=settings'; }); await p.page.waitForSelector('.at-vac-part');
  const part = await p.page.evaluate(() => { const a = [...document.querySelectorAll('.at-vac-part')].find(x => /Фильтр$/.test(x.querySelector('strong')?.textContent ?? '')); return { text: a?.querySelector('.at-vac-part-nums')?.innerText.replace(/\s+/g, ' ') ?? null, low: a?.classList.contains('is-low') }; });
  check('a part past its life: «13 ч просрочено», no minus sign, marked low', /^13 ?ч просрочено/.test(part.text ?? '') && !/[-−]/.test(part.text ?? '') && part.low, part); await p.ctx.close(); }
{ const p = await open({ scenario: 'unknown' }); const t = await p.page.evaluate(() => { const tile = document.querySelector('.at-vac-tile'); return { say: tile.querySelector('.at-vac-tile-head small')?.textContent, go: tile.querySelector('.at-vac-go')?.getAttribute('aria-disabled'), home: tile.querySelector('.at-vac-home')?.getAttribute('aria-disabled') }; });
  check('«unknown» is not «Нет связи с пылесосом»: the tile says what the sensors say and its buttons work', !/Нет связи/.test(t.say ?? '') && /Убирает/.test(t.say ?? '') && t.go === null && t.home === null, t);
  await p.page.locator('.at-vac-tile .at-vac-home').click(); await p.page.waitForTimeout(250); check('«unknown»: «На базу» is sent', (await log(p.page)).some(c => c.s === 'return_to_base'), await log(p.page)); await p.ctx.close(); }
for (const lang of ['ru', 'ro', 'en']) { const p = await open({ scenario: 'newcode', lang }); const say = await p.page.evaluate(() => document.querySelector('.at-vac-tile .at-vac-tile-head small')?.textContent ?? ''); check(`a code without a word is «код …» in ${lang}, not made-up English`, /brand_new_fault_77/.test(say) && !/Brand new fault/.test(say) && /(код|cod|code) brand_new_fault_77/.test(say), say); await p.ctx.close(); }
{ const p = await open({ scenario: 'unlinked', hash: '#cleaning' }); const txt = await p.page.locator('.at-vac-panel').innerText(); check('rooms not linked: the robot\'s own word for the room («Кухню», «кухню») is nowhere', !/кухню/i.test(txt), txt.slice(0, 200)); await p.ctx.close(); }
// the map and the robot's photo that did not load (the preview has neither file) give way to words and the drawn robot, never to a broken-image glyph with an alt text
{ const p = await open({ scenario: 'cleaning', hash: '#cleaning' }); await p.page.waitForTimeout(1200);
  const m = await p.page.evaluate(() => { const map = document.querySelector('.at-vac-map'), img = map.querySelector('img'); return { broken: !!img && img.complete && img.naturalWidth === 0, note: map.querySelector('.at-vac-note')?.textContent ?? null, pics: [...document.querySelectorAll('.at-vac-pic img')].filter(i => i.complete && i.naturalWidth === 0).length }; });
  check('no broken picture stays on the panel', !m.broken && m.pics === 0 && (m.note === null || m.note === 'Карты пока нет'), m);
  // «Режим уборки»: the side button moves the focus into the mode card — onto the mode that is on (found by a ref: the live panel is a shadow root)
  await p.page.evaluate(() => { location.hash = '#cleaning'; }); const d = await open({ scenario: 'docked', hash: '#cleaning' }); await d.page.locator('.at-vac-bar-btns .at-vac-side').first().click(); await d.page.waitForTimeout(500);
  check('«Режим уборки» puts the focus on the mode card, on the mode that is on', await d.page.evaluate(() => !!document.activeElement?.closest('#at-vac-mode') && document.activeElement.matches('.at-vac-mode[aria-pressed="true"]')), await d.page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  check('round2 l154: the button is named once («Режим уборки: Умный»)', await d.page.locator('.at-vac-bar-btns .at-vac-side').first().getAttribute('aria-label') === 'Режим уборки: Умный', await d.page.locator('.at-vac-bar-btns .at-vac-side').first().getAttribute('aria-label'));
  await d.page.evaluate(() => window.atomPreview.setStates({ 'select.living_robot_vacuum_cleaning_mode': 'unknown' })); await d.page.waitForTimeout(200);
  check('round2 l154: …and just «Режим уборки» while the mode is not known, never «Режим уборки: Режим уборки»', await d.page.locator('.at-vac-bar-btns .at-vac-side').first().getAttribute('aria-label') === 'Режим уборки', await d.page.locator('.at-vac-bar-btns .at-vac-side').first().getAttribute('aria-label'));
  await d.page.locator('.at-vac-bar-btns .at-vac-side').first().click(); await d.page.waitForTimeout(400); check('round2 l154: with no mode on, the focus goes to the heading', await d.page.evaluate(() => document.activeElement?.tagName === 'H2' && !!document.activeElement.closest('#at-vac-mode'))); await d.ctx.close(); await p.ctx.close(); }
// 9. round 2 of the audit (10.11.2026): per-key waiting, the mode chips' pending, off the line a press answers, focus after the browser's «Back», the choice kept
const MODE = 'select.living_robot_vacuum_cleaning_mode';
{ const p = await open({ scenario: 'docked', hash: '#cleaning' }); await p.page.evaluate(() => window.atomPreview.host.setDelay(900));
  const chip = p.page.locator('.at-vac-mode', { hasText: 'Пылесос и швабра' }); await chip.focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(200);
  const c = await p.page.evaluate(() => { const a = document.activeElement; return { text: a?.textContent ?? '', pressed: a?.getAttribute('aria-pressed'), busy: a?.getAttribute('aria-busy'), dis: a?.disabled, on: a?.classList.contains('is-on'), others: [...document.querySelectorAll('.at-vac-mode')].filter(b => b !== a).map(b => b.getAttribute('aria-pressed')).join() }; });
  check('round2 l153: the pressed mode chip is the chosen one at once and waits (aria-busy), the focus stays on it', /Пылесос и швабра/.test(c.text) && c.pressed === 'true' && c.busy === 'true' && c.dis === false && c.on && !/true/.test(c.others), c);
  await p.page.keyboard.press('Enter'); await p.page.locator('.at-vac-mode', { hasText: 'Швабра' }).last().click({ force: true }); await p.page.waitForTimeout(100);
  check('round2 f0: a second press while it is on its way sends nothing more', (await log(p.page)).length === 1, await log(p.page));
  await p.page.locator('.at-vac-dockbtn', { hasText: 'Помыть швабру' }).click(); await p.page.waitForTimeout(150);
  const two = await p.page.evaluate(() => ({ mode: document.querySelector('.at-vac-mode[aria-pressed="true"]')?.getAttribute('aria-busy'), dock: [...document.querySelectorAll('.at-vac-dockbtn')].find(b => /Помыть швабру/.test(b.textContent))?.getAttribute('aria-busy') }));
  check('round2 l51: a second command with another key does not take the waiting look off the first', two.mode === 'true' && two.dock === 'true', two);
  await p.page.waitForTimeout(1300); const after = await p.page.evaluate(() => { const b = document.querySelector('.at-vac-mode[aria-pressed="true"]'); return { text: b?.textContent ?? '', busy: b?.getAttribute('aria-busy'), locked: [...document.querySelectorAll('.at-vac-mode')].some(x => x.getAttribute('aria-disabled') === 'true') }; });
  check('round2 l153: accepted — the chip keeps waiting for the robot to show the mode, the row is free again', /Пылесос и швабра/.test(after.text) && after.busy === 'true' && !after.locked, after);
  await p.page.evaluate(id => window.atomPreview.setStates({ [id]: 'vac_and_mop' }), MODE); await p.page.waitForTimeout(250);
  const done = await p.page.evaluate(() => { const b = document.querySelector('.at-vac-mode[aria-pressed="true"]'); return { text: b?.textContent ?? '', busy: b?.getAttribute('aria-busy') }; });
  check('round2 l153: the robot shows the mode — the wait is over', /Пылесос и швабра/.test(done.text) && done.busy !== 'true', done); await p.ctx.close(); }
{ // a refused mode goes back to what the robot has, and says so; another control's accepted command does not erase that line
  const p = await open({ scenario: 'docked', hash: '#cleaning', accept: false }); await p.page.locator('.at-vac-mode', { hasText: 'Пылесос и швабра' }).click(); await p.page.waitForTimeout(300);
  const line = () => p.page.evaluate(() => document.querySelector('#at-vac-mode .at-heat-err')?.textContent ?? '');
  check('round2 l153: a refused mode returns to the robot\'s own and is said', /Умный/.test(await p.page.locator('.at-vac-mode[aria-pressed="true"]').innerText()) && /Команда не выполнена/.test(await line()), await line());
  await p.page.evaluate(() => window.atomPreview.host.setAccept(true)); await p.page.locator('.at-vac-corner .at-vac-icon').first().click(); await p.page.waitForTimeout(300);
  check('round2 l51: an accepted «Найти» does not erase the mode\'s refusal', /Команда не выполнена/.test(await line()) && (await log(p.page)).some(c => c.s === 'locate'), await line()); await p.ctx.close(); }
{ // l89: the house off the line — a press on a dimmed button tells why next to it, nothing is sent
  const p = await open({ scenario: 'paused', hash: '#cleaning' }); await p.page.evaluate(id => window.atomPreview.setStates({ [id]: 'vac_and_mop' }), MODE); /* in «Умный» the robot picks the suction itself: those chips are really disabled */ await p.page.evaluate(() => window.atomPreview.setOnline(false)); await p.page.waitForTimeout(200);
  const dim = await p.page.evaluate(() => ({ big: document.querySelector('.at-vac-big')?.getAttribute('aria-disabled'), bigDis: document.querySelector('.at-vac-big')?.disabled, modes: [...document.querySelectorAll('.at-vac-mode')].map(b => b.getAttribute('aria-disabled')).join(), chips: [...document.querySelectorAll('#at-vac-mode .at-vac-seg button')].map(b => `${b.disabled}/${b.getAttribute('aria-disabled')}`) }));
  check('round2 l89: off the line the buttons are dimmed (aria-disabled), not dead', dim.big === 'true' && dim.bigDis === false && !/null/.test(dim.modes) && dim.chips.length > 0 && dim.chips.every(x => x === 'false/true'), dim);
  await p.page.locator('.at-vac-big').focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(250);
  check('round2 l89: «Продолжить» off the line says «Нет связи с домом» in the bar and keeps the focus', /Нет связи с домом/.test(await p.page.locator('.at-vac-bar .at-heat-err').innerText().catch(() => '')) && await p.page.evaluate(() => document.activeElement?.classList.contains('at-vac-big')));
  await p.page.locator('#at-vac-mode .at-vac-seg button:not(.is-on)').first().click({ force: true }); await p.page.waitForTimeout(250);
  check('round2 l89: a mode chip off the line says it in the mode card', /Нет связи с домом/.test(await p.page.locator('#at-vac-mode .at-heat-err').innerText().catch(() => '')));
  check('round2 l89: nothing was sent', (await log(p.page)).length === 0, await log(p.page)); await p.ctx.close();
  const t = await open({ scenario: 'docked' }); await t.page.evaluate(() => window.atomPreview.setOnline(false)); await t.page.waitForTimeout(200); await t.page.locator('.at-vac-tile .at-vac-go').click({ force: true }); await t.page.waitForTimeout(300);
  check('round2 l89: the tile\'s own line says «Нет связи с домом»', /Нет связи с домом/.test(await t.page.locator('.at-vac-tile .at-heat-err').innerText().catch(() => '')) && (await log(t.page)).length === 0); await t.ctx.close(); }
{ // l0: the browser's «Back» from the settings puts the focus on the gear, as «‹ Пылесос» does
  const p = await open({ scenario: 'docked', hash: '#cleaning' }); await p.page.locator('.at-vac-corner .at-vac-icon').last().click(); await p.page.waitForSelector('.at-vac-panel.is-settings'); await p.page.waitForTimeout(200);
  await p.page.goBack(); await p.page.waitForSelector('.at-vac-panel:not(.is-settings)'); await p.page.waitForTimeout(300);
  check('round2 l0: after the browser\'s «Back» the focus is on the gear', await p.page.evaluate(() => document.activeElement === document.querySelectorAll('.at-vac-corner .at-vac-icon')[1]), await p.page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100)));
  // l92: the rooms chosen and the passes live through a reload
  const rooms = p.page.locator('.at-vac-room:not(.is-all)'); await rooms.nth(6).click(); await rooms.nth(0).click(); await p.page.locator('.at-vac-repeat button', { hasText: '×2' }).click(); await p.page.waitForTimeout(100);
  await p.page.reload(); await p.page.waitForFunction(() => window.ready === true, null, { timeout: 15000 }); await p.page.waitForSelector('.at-vac-room'); await p.page.evaluate(() => window.atomPreview.host.setAccept(true)); await p.page.waitForTimeout(300);
  const kept = await p.page.evaluate(() => ({ on: [...document.querySelectorAll('.at-vac-room:not(.is-all).is-on')].map(b => `${b.querySelector('.at-vac-room-n')?.textContent}:${b.querySelector('span')?.textContent}`), repeat: document.querySelector('.at-vac-repeat button[aria-pressed="true"]')?.textContent, big: document.querySelector('.at-vac-big')?.textContent ?? '' }));
  check('round2 l92: after a reload the two rooms, their order and ×2 are still chosen', kept.on.length === 2 && kept.on.some(x => /^1:Кухня/.test(x)) && kept.on.some(x => /^2:Гостиная/.test(x)) && kept.repeat === '×2' && /Убрать 2 комнаты/.test(kept.big), kept);
  await p.page.locator('.at-vac-big').click(); await p.page.waitForTimeout(200); const l = await log(p.page);
  check('round2 l92: …and the command is the same as before the reload', l.length === 1 && l[0].command === 'app_segment_clean' && JSON.stringify(l[0].params) === '[{"segments":[7,1],"repeat":2}]', l); await p.ctx.close(); }
for (const lang of ['ru', 'en', 'ro']) { // l118: the time fields follow the panel's language where the browser allows; f54: the suction words of en / ro stay whole on a phone
  const s = await open({ scenario: 'docked', lang, hash: '#cleaning?filter=settings' }); const langs = await s.page.evaluate(() => [...document.querySelectorAll('.at-vac-times input[type=time]')].map(i => i.getAttribute('lang')));
  check(`round2 l118: the time fields carry the panel's language (${lang})`, langs.length === 4 && langs.every(x => x === lang), langs); await s.ctx.close();
  if (lang === 'ru') continue;
  const p = await open({ scenario: 'paused', lang, w: 360, h: 792, hash: '#cleaning' }); await p.page.evaluate(id => window.atomPreview.setStates({ [id]: 'vac_and_mop' }), MODE); await p.page.waitForTimeout(200); const broken = await p.page.evaluate(() => [...document.querySelectorAll('#at-vac-mode .at-vac-row')].slice(0, 1).flatMap(row => [...row.querySelectorAll('.at-vac-seg button')]).filter(b => { const r = document.createRange(); r.selectNodeContents(b); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1; }).map(b => b.textContent));
  const n = await p.page.locator('#at-vac-mode .at-vac-row').first().locator('.at-vac-seg button').count();
  check(`round2 f54: no suction word breaks in the middle at 360 px (${lang})`, n === 5 && broken.length === 0, { n, broken }); await p.ctx.close(); }
// release classic, step 4 — studio ST-13: a setting is sent only to an entity that answers. The dock's empty mode and the volume are entities of
// their own: one that went `unavailable` takes no command (its controls are off and say «Нет связи»), the other keeps working; an `unknown` robot
// locks nothing; a target that goes silent between the press and the send cancels that one send. The harness changes both the house's live states
// (what the command reads) and the registry (what is drawn).
{ const EMPTY = 'select.living_robot_vacuum_dock_empty_mode', VOL = 'number.living_robot_vacuum_volume';
  const setBoth = (page, over) => page.evaluate(o => { const s = window.atomPreview.host.states(); for (const [id, v] of Object.entries(o)) if (s[id]) s[id] = { ...s[id], state: v }; window.atomPreview.setStates(o); }, over);
  const setVol = (page, n, change = true) => page.evaluate(([n, change]) => { const el = document.querySelector('.at-vac-range'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(n)); el.dispatchEvent(new Event('input', { bubbles: true })); if (change) el.dispatchEvent(new Event('change', { bubbles: true })); }, [n, change]);
  const chip = (page, word) => page.locator('.at-vac-set .at-vac-row', { hasText: /Режим самоочистки|Self-empty|Golire/ }).locator('.at-vac-seg button', { hasText: word });
  const clearLog = page => page.evaluate(() => { window.atomPreview.host.log.length = 0; });
  for (const [lang, theme, w, h, off] of [['ru', 'light', 1070, 764, 'Нет связи'], ['ro', 'dark', 360, 792, 'Fără conexiune']]) {
    const p = await open({ scenario: 'docked', lang, theme, w, h, hash: '#cleaning?filter=settings' }); await p.page.waitForSelector('.at-vac-range');
    await setBoth(p.page, { [EMPTY]: 'unavailable', [VOL]: 'unavailable' }); await p.page.waitForTimeout(250); await clearLog(p.page);
    const seen = await p.page.evaluate(() => { const row = [...document.querySelectorAll('.at-vac-set .at-vac-row')][0], r = document.querySelector('.at-vac-range'); return { chips: [...row.querySelectorAll('.at-vac-seg button')].map(b => b.disabled), hint: row.querySelector('.at-vac-row-head small')?.textContent ?? '', slider: r.disabled, say: r.closest('.at-vac-set-row').querySelector('small').textContent, valuetext: r.getAttribute('aria-valuetext') }; });
    check(`ST-13 ${lang}/${theme}: the dock's empty mode and the volume that do not answer are off and say «${off}» (no false «0 %»)`, seen.chips.length > 1 && seen.chips.every(Boolean) && seen.hint === off && seen.slider && seen.say === off && seen.valuetext === off, seen);
    for (const b of await p.page.locator('.at-vac-set .at-vac-row').first().locator('.at-vac-seg button').all()) await b.click({ force: true }).catch(() => {});
    await setVol(p.page, 40); await p.page.locator('.at-vac-range').focus().catch(() => {}); await p.page.keyboard.press('ArrowLeft'); await p.page.waitForTimeout(400);
    check(`ST-13 ${lang}/${theme}: …presses, a drag and the arrows send nothing to them`, (await log(p.page)).length === 0, await log(p.page));
    if (lang === 'ru') await p.page.screenshot({ path: `${out}/st13-silent-settings.png` });
    await setBoth(p.page, { [EMPTY]: 'max' }); await p.page.waitForTimeout(250); await clearLog(p.page); await chip(p.page, /Умный|Smart|Inteligent/).click(); await p.page.waitForTimeout(400);
    const l = await log(p.page);
    check(`ST-13 ${lang}/${theme}: the dock answers again while the volume does not — exactly one select_option, the volume still off`, l.length === 1 && l[0].d === 'select' && l[0].s === 'select_option' && l[0].entity_id === EMPTY && await p.page.evaluate(() => document.querySelector('.at-vac-range').disabled), l);
    check(`errors ST-13 ${lang}`, !p.errors.length, p.errors); await p.ctx.close(); }
  { const p = await open({ scenario: 'docked', hash: '#cleaning?filter=settings' }); await p.page.waitForSelector('.at-vac-range');
    await setBoth(p.page, { 'vacuum.living_robot_vacuum': 'unknown' }); await p.page.waitForTimeout(250); await clearLog(p.page);
    await chip(p.page, 'Умный').click(); await p.page.waitForTimeout(400); await setVol(p.page, 95); await p.page.waitForTimeout(500);
    const l = await log(p.page);
    check('ST-13: a robot that says nothing yet (`unknown`) locks nothing: one select_option and one number.set_value 95', l.length === 2 && l.some(c => c.d === 'select' && c.entity_id === EMPTY) && l.some(c => c.d === 'number' && c.s === 'set_value' && c.entity_id === VOL && c.value === 95), l); await p.ctx.close(); }
  { const p = await open({ scenario: 'docked', hash: '#cleaning?filter=settings' }); await p.page.waitForSelector('.at-vac-range'); await p.page.evaluate(() => window.atomPreview.setDelay(800)); await clearLog(p.page);
    await setVol(p.page, 95); await p.page.waitForTimeout(150); await setVol(p.page, 90); await p.page.waitForTimeout(150);
    await p.page.evaluate(id => { const s = window.atomPreview.host.states(); s[id] = { ...s[id], state: 'unavailable' }; }, VOL); /* silent while 95 is on its way and 90 waits */ await p.page.waitForTimeout(1500);
    const vols = (await log(p.page)).filter(c => c.d === 'number').map(c => c.value);
    check('ST-13: 95 on its way, 90 waiting, then the volume goes silent — only 95 left, the waiting 90 is not sent', vols.join() === '95', vols);
    await p.page.evaluate(id => { const s = window.atomPreview.host.states(); s[id] = { ...s[id], state: '95.0' }; window.atomPreview.setStates({ [id]: '95.0' }); }, VOL); await p.page.waitForTimeout(250); await setVol(p.page, 90); await p.page.waitForTimeout(1200);
    check('ST-13: …it answers again — 90 is exactly one more command', (await log(p.page)).filter(c => c.d === 'number').map(c => c.value).join() === '95,90', (await log(p.page)).filter(c => c.d === 'number'));
    await p.page.evaluate(() => window.atomPreview.setDelay(0)); await p.ctx.close(); }
  for (const lang of ['ru', 'en', 'ro']) { const p = await open({ scenario: 'docked', lang, w: 360, h: 792, hash: '#cleaning?filter=settings' }); await p.page.waitForSelector('.at-vac-range'); await p.page.evaluate(() => window.atomPreview.setOnline(false)); await p.page.waitForTimeout(250); await clearLog(p.page);
    await chip(p.page, /Умный|Smart|Inteligent/).click({ force: true }).catch(() => {}); await setVol(p.page, 30); await p.page.waitForTimeout(400);
    const said = await p.page.evaluate(() => document.querySelector('.at-vac-panel.is-settings')?.innerText ?? '');
    check(`ST-13 ${lang}: the house off the line is not a silent entity — nothing leaves and the settings say the house is not reached`, (await log(p.page)).length === 0 && /Нет связи с домом|No connection to the home|Fără conexiune cu casa/.test(said), { sent: await log(p.page), said: said.slice(0, 200) });
    await p.ctx.close(); }
}
// release classic, step 4 — studio ST-14: the vacuum's time rows never widen their card. Where «с [22:00] — до [08:00]» does not fit (a 320 / 344 px
// phone, large text, a 12-hour «10:00 PM») each field gets its own line with its word beside it; a wider card keeps the one row; the field still sends
// exactly what was typed.
for (const [w, h, lang, theme, font, locale] of [[320, 568, 'ro', 'dark', '100%', 'en-US'], [320, 568, 'ru', 'light', '100%', 'ru-RU'], [344, 882, 'en', 'dark', '100%', 'en-US'], [360, 792, 'ru', 'light', '100%', 'ru-RU'], [320, 568, 'ru', 'light', '150%', 'en-US'], [568, 320, 'ro', 'light', '200%', 'en-US'], [1070, 764, 'ro', 'dark', '100%', 'en-US'], [1070, 764, 'ru', 'light', '200%', 'ru-RU']]) {
  const tag = `${w}x${h} ${lang}/${theme} ${font} ${locale}`, ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, locale }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); await page.goto(`${origin}/?card=vacuum&scenario=docked&theme=${theme}&lang=${lang}#cleaning?filter=settings`); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  await page.evaluate(f => { document.documentElement.style.fontSize = f; }, font); await page.waitForTimeout(400); await page.evaluate(() => document.querySelector('.at-vac-times')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
  const m = await page.evaluate(() => [...document.querySelectorAll('.at-vac-times')].map(t => { const card = t.closest('.at-vac-card'), cs = getComputedStyle(card), cr = card.getBoundingClientRect(), left = cr.left + parseFloat(cs.paddingLeft), right = cr.right - parseFloat(cs.paddingRight);
    const fields = [...t.querySelectorAll('input')].map(i => { const r = i.getBoundingClientRect(), was = i.style.cssText; i.style.width = 'max-content'; i.style.minWidth = '0'; const need = i.getBoundingClientRect().width; i.style.cssText = was; return { l: Math.round(r.left), r: Math.round(r.right), top: Math.round(r.top), h: Math.round(r.height), whole: need <= r.width + 1 }; });
    return { card: [card.scrollWidth, card.clientWidth], inside: fields.every(f => f.l >= left - 1 && f.r <= right + 1), whole: fields.every(f => f.whole), tall: fields.every(f => f.h >= 44), oneRow: fields.length === 2 && Math.abs(fields[0].top - fields[1].top) < 2, fields }; }));
  const wide = w >= 1000 && font === '100%';
  check(`ST-14 ${tag}: the time rows stay inside their card (the card never wider than its box), each field ≥ 44 px (whole where they stack); ${wide ? 'a wide card keeps the one row' : 'one under the other where they do not fit'}`, m.length === 2 && m.every(x => x.card[0] <= x.card[1] + 1 && x.inside && x.tall && (x.oneRow || x.whole)) && (!wide || m.every(x => x.oneRow)), m); // one under the other each field is the card's width and whole; the one row keeps the classic 112 px field (a 12-hour «10:00 PM» is cut there as before: design phase 2 #51, a look change not taken)
  if (w === 320 && font === '100%') await page.screenshot({ path: `${out}/st14-${w}-${lang}-${theme}.png` });
  check(`errors ST-14 ${tag}`, !errors.length, errors); await ctx.close(); }
{ const p = await open({ scenario: 'docked', w: 320, h: 568, hash: '#cleaning?filter=settings' }); await p.page.evaluate(() => window.atomPreview.host.setAccept(true)); await p.page.evaluate(() => { window.atomPreview.host.log.length = 0; });
  await p.page.evaluate(() => { const id = Object.keys(window.atomPreview.host.states()).find(i => /^switch\..*(do_not_disturb|dnd)/.test(i)); if (id) window.atomPreview.setStates({ [id]: 'on' }); }); await p.page.waitForTimeout(250); // «Не беспокоить» on: its times can be set
  const f = p.page.locator('.at-vac-times input').first(); await f.scrollIntoViewIfNeeded(); await f.fill('22:15'); await f.press('Enter'); await f.press('Tab'); await p.page.waitForTimeout(500);
  const l = (await log(p.page)).filter(c => c.d === 'time');
  check('ST-14 320: a field one under the other still sends what was typed — one time.set_value 22:15:00', l.length === 1 && l[0].s === 'set_value' && /22:15/.test(String(l[0].time)), l); await p.ctx.close(); }
await finish(fails.length ? 1 : 0);
