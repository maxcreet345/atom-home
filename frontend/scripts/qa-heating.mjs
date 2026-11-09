// Everything the Heating card must hold, in one run: every state on every device size in both themes, accessibility (axe), touch targets,
// the words in three languages, and each button's single command. Nothing reaches a device: the preview host records every command.
// usage: node scripts/qa-heating.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout, targets } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/heating'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const port = 4300 + Math.floor(Math.random() * 500), srv = spawn('node', ['scripts/card-preview.mjs', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, no) => { srv.stdout.on('data', d => { if (String(d).includes('ready')) ok(); }); setTimeout(() => no(new Error('preview server did not start')), 15000); });
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 260)}`); };
const report = () => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); };
const finish = async code => { report(); await browser.close().catch(() => {}); srv.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); void finish(1); });
const axeSrc = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
async function open({ scenario = 'normal', w = 1280, h = 800, theme = 'light', lang = 'ru', hash = '#home', accept = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100 }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/preview: commands are rejected/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=heating&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  await page.evaluate(a => window.atomPreview.host.setAccept(a), accept); await page.waitForTimeout(450);
  return { page, ctx, errors };
}
const log = page => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => ({ d: c.domain, s: c.service, ...c.data })));
const axe = async (page, sel) => { await page.addScriptTag({ content: axeSrc }); return page.evaluate(async s => (await window.axe.run(document.querySelector(s) ?? document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(', ')}`), sel); };
const scrollAll = page => page.evaluate(async () => { const m = document.querySelector('.hm-main'); for (let y = 0; y <= m.scrollHeight; y += 300) { m.scrollTop = y; await new Promise(r => setTimeout(r, 20)); } m.scrollTop = 0; });
// 1. every state × every size × both themes: nothing cut, overlapped, too small, no raw text, no page error
const SIZES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [1280, 800, 'pad-wide'], [698, 751, 'open'], [1440, 900, 'mac'], [1920, 1080, 'tv']];
const SCEN = ['normal', 'own', 'manual', 'sleep', 'off', 'silent'];
for (const theme of ['light', 'dark']) for (const [w, h, dev] of SIZES) for (const scenario of SCEN) {
  const tag = `${scenario}/${dev}/${theme}`;
  const home = await open({ scenario, w, h, theme }); const tile = await home.page.$('.at-heat-tile');
  check(`tile shown ${tag}`, !!tile);
  if (tile) { check(`tile layout ${tag}`, (await layout(home.page, '.at-heat-tile')).length === 0, await layout(home.page, '.at-heat-tile')); check(`tile targets ${tag}`, (await targets(home.page, '.at-heat-tile')).length === 0, await targets(home.page, '.at-heat-tile'));
    check(`no «Климат» group tile beside it ${tag}`, !(await home.page.$('.ah-group-tile.kind-climate')));
    if (theme === 'light' && (dev === 'pad-wide' || dev === '13R')) await tile.screenshot({ path: `${out}/tile-${scenario}-${dev}.png` }); }
  check(`no page error home ${tag}`, home.errors.length === 0, home.errors); await home.ctx.close();
  const panel = await open({ scenario, w, h, theme, hash: '#climate' }); await scrollAll(panel.page);
  const lay = await layout(panel.page, '.at-heat-panel'), tg = await targets(panel.page, '.at-heat-panel');
  check(`panel layout ${tag}`, lay.length === 0, lay); check(`panel targets ${tag}`, tg.length === 0, tg);
  const txt = await panel.page.evaluate(() => document.querySelector('.at-heat-panel')?.innerText ?? '');
  check(`panel has 5 rooms and the boiler ${tag}`, (await panel.page.$$('.at-heat-room')).length === 5 && txt.includes('Demir Döküm'));
  check(`no raw text ${tag}`, !/module\.heat|undefined|NaN|null/.test(txt));
  check(`no page error panel ${tag}`, panel.errors.length === 0, panel.errors);
  if (theme === 'light' && dev === 'pad-wide') await panel.page.screenshot({ path: `${out}/panel-${scenario}.png` });
  await panel.ctx.close();
}
// 2. accessibility: no serious or critical axe violation on the tile and the panel
for (const theme of ['light', 'dark']) for (const scenario of ['normal', 'own', 'off', 'silent', 'manual']) {
  const a = await open({ scenario, theme }); const v1 = await axe(a.page, '.at-heat-tile'); check(`axe tile ${scenario}/${theme}`, v1.length === 0, v1); await a.ctx.close();
  const b = await open({ scenario, theme, hash: '#climate' }); const v2 = await axe(b.page, '.at-heat-panel'); check(`axe panel ${scenario}/${theme}`, v2.length === 0, v2); await b.ctx.close();
}
// 3. the words in three languages
for (const lang of ['ru', 'en', 'ro']) { const p = await open({ scenario: 'own', lang, hash: '#climate' }); const t = await p.page.evaluate(() => document.querySelector('.at-heat-panel').innerText + document.title); check(`no missing words ${lang}`, !/module\.heat|clock\.weather/.test(t), t.match(/module\.heat\.[\w.]+/g)); await p.ctx.close(); }
{ const p = await open({ scenario: 'own', hash: '#climate' }); const t = await p.page.evaluate(() => document.querySelector('.at-heat-panel').innerText);
  check('the open window is named and the pause explained', t.includes('центральное окно') && t.includes('Радиатор выключен, пока окно открыто'), t.slice(0, 400));
  check('the own temperature shows its end and the way back', /24° до \d\d:\d\d · ещё 2 ч 4\d мин/.test(t) && t.includes('Вернуть к общей'));
  check('outside is −3 with a real minus', t.includes('На улице −3°')); await p.ctx.close(); }
// 4. every button sends one command, with the right data
const press = async (page, sel, n = 1) => { for (let i = 0; i < n; i++) await page.locator(sel).first().click(); };
const settle = page => page.waitForTimeout(900); // the stepper sends after 700 ms of quiet
{ const p = await open({}); await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]', 2); await settle(p.page); const l = await log(p.page);
  check('tile + + : one command, «Дома» 21,5', l.length === 1 && l[0].entity_id === 'input_number.heating_home_temp' && l[0].value === 21.5, l);
  await p.page.locator('.at-heat-tile .at-heat-mode button', { hasText: 'Ручной' }).click(); await p.page.waitForTimeout(100); const m = (await log(p.page)).slice(1);
  check('tile «Ручной»: select_option', m.length === 1 && m[0].s === 'select_option' && m[0].option === 'Ручной', m); await p.ctx.close(); }
{ const p = await open({ scenario: 'sleep' }); await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]'); await settle(p.page); const l = await log(p.page);
  check('in «Сон» the change is the scenario\'s own', l.some(c => c.entity_id === 'input_number.heating_scenario_override_temp' && c.value === 19.5) && l.some(c => c.s === 'turn_on' && c.entity_id === 'input_boolean.heating_scenario_override') && !l.some(c => c.entity_id === 'input_number.heating_home_temp'), l); await p.ctx.close(); }
{ const p = await open({ scenario: 'manual' }); await press(p.page, '.at-heat-tile [aria-label$="меньше на 0,5°"]'); await settle(p.page); const l = await log(p.page);
  check('in «Ручной» the common − starts from the coldest room and sets every room at once', l.length === 5 && l.every(c => /_heating_manual_temp$/.test(c.entity_id) && c.value === 19), l); await p.ctx.close(); }
{ const p = await open({}); await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]'); await p.page.locator('.at-heat-open').click(); await settle(p.page); const l = await log(p.page);
  check('a tap is not lost when the card is left within the pause', l.length === 1 && l[0].value === 21, l); await p.ctx.close(); }
{ const p = await open({ accept: false, hash: '#climate', w: 402, h: 874 }); await p.page.locator('.at-heat-room').last().locator('[aria-label$="больше на 0,5°"]').click(); await p.page.waitForTimeout(1200);
  const e = await p.page.evaluate(() => document.querySelectorAll('.at-heat-room')[4].querySelector('.at-heat-err')?.textContent);
  check('a refused room command is said in that room', /не дошла/.test(e ?? ''), e);
  await p.page.evaluate(() => window.atomPreview.host.setAccept(true)); await p.page.locator('.at-heat-room').last().locator('[aria-label$="больше на 0,5°"]').click(); await p.page.waitForTimeout(1200);
  check('…and the next accepted one clears it', !(await p.page.evaluate(() => document.querySelectorAll('.at-heat-room')[4].querySelector('.at-heat-err')?.textContent))); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); await p.page.locator('.at-heat-hero .at-heat-power').focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(150);
  check('the question puts focus on «Отмена»', await p.page.evaluate(() => document.activeElement?.textContent === 'Отмена'));
  await p.page.keyboard.press('Escape'); await p.page.waitForTimeout(150);
  check('Escape closes it and focus is back on the button', await p.page.evaluate(() => document.activeElement?.classList.contains('at-heat-power') && /Выключить/.test(document.activeElement.textContent)) && (await log(p.page)).length === 0); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); await p.page.locator('.at-heat-room').first().locator('[aria-label$="больше на 0,5°"]').click(); await settle(p.page); const l = await log(p.page);
  check('room +: the head itself', l.length === 1 && l[0].s === 'set_temperature' && l[0].entity_id === 'climate.living_trv' && l[0].temperature === 21, l);
  await p.page.locator('.at-heat-scen-card', { hasText: 'Эко' }).click(); await p.page.waitForTimeout(100); const e = (await log(p.page)).slice(1);
  check('«Эко»: its switch on', e.length === 1 && e[0].s === 'turn_on' && e[0].entity_id === 'input_boolean.heating_eco', e);
  await p.page.locator('.at-heat-hero .at-heat-power').click(); await p.page.waitForTimeout(100);
  check('«Выключить отопление» asks first and sends nothing', (await log(p.page)).length === 2 && await p.page.locator('.at-heat-confirm').isVisible());
  await p.page.locator('.at-heat-confirm .is-danger').click(); await p.page.waitForTimeout(100); const o = (await log(p.page)).slice(2);
  check('…then turns the thermostat off', o.length === 1 && o[0].s === 'set_hvac_mode' && o[0].hvac_mode === 'off' && o[0].entity_id === 'climate.living_thermostat', o); await p.ctx.close(); }
{ const p = await open({ scenario: 'own', hash: '#climate' }); await p.page.locator('.at-heat-own button').click(); await p.page.waitForTimeout(100); const l = await log(p.page);
  check('«Вернуть к общей»: the room\'s timer cancelled', l.length === 1 && l[0].s === 'cancel' && l[0].entity_id === 'timer.kids_heating_override', l);
  check('a paused room has no ± to press', (await p.page.locator('.at-heat-room.is-window .at-heat-pm').count()) === 0); await p.ctx.close(); }
{ const p = await open({ scenario: 'off' }); await p.page.locator('.at-heat-tile .at-heat-power').click(); await p.page.waitForTimeout(100); const l = await log(p.page);
  check('off tile «Включить»: heat at once', l.length === 1 && l[0].hvac_mode === 'heat', l); await p.ctx.close(); }
// 5. a refused command puts the value back and says so
{ const p = await open({ accept: false }); await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]'); await p.page.waitForTimeout(1200);
  const s = await p.page.evaluate(() => ({ n: document.querySelector('.at-heat-tile .at-heat-step b').textContent, err: document.querySelector('.at-heat-tile .at-heat-err')?.textContent }));
  check('refused: the number goes back, the words say why', s.n.startsWith('20,5') && /не дошла/.test(s.err ?? ''), s); await p.ctx.close(); }
await finish(fails.length ? 1 : 0);
