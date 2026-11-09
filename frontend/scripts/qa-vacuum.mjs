// Everything the Vacuum card must hold, in one run: every state on every device size in both themes, accessibility (axe), touch targets,
// the words in three languages, and each button's single command. Nothing reaches the robot: the preview host records every command.
// usage: node scripts/qa-vacuum.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout, targets } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/vacuum'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const port = 4300 + Math.floor(Math.random() * 500), srv = spawn('node', ['scripts/card-preview.mjs', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
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
  check('cleaning tile: room and progress', /Убирает · Кухня · \d+ %/.test(t), t); check('cleaning tile: the Roborock render, not the drawing', await p.page.locator('.at-vac-tile .at-vac-pic.is-out img').count() === 1); await p.ctx.close(); }
{ const p = await open({ scenario: 'docked' }); check('docked tile: the robot on its dock', await p.page.locator('.at-vac-tile .at-vac-pic.is-home img').count() === 1); await p.ctx.close(); }
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
  check('a refused command is said on the tile', /не дошла/.test(await p.page.locator('.at-vac-tile .at-heat-err').innerText())); await p.ctx.close(); }
// 6. the offline robot offers nothing to press
{ const p = await open({ scenario: 'offline' }); check('offline: start not pressable', await p.page.locator('.at-vac-go').getAttribute('aria-disabled') === 'true'); await p.page.locator('.at-vac-go').click({ force: true }); await p.page.waitForTimeout(150); check('offline: nothing sent', (await log(p.page)).length === 0); await p.ctx.close(); }
await finish(fails.length ? 1 : 0);
