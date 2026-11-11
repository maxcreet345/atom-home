// Everything the Heating card must hold, in one run: every state on every device size in both themes, accessibility (axe), touch targets,
// the words in three languages, and each button's single command. Nothing reaches a device: the preview host records every command.
// usage: node scripts/qa-heating.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout, targets } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/heating'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const port = await freePort(), srv = spawn('node', ['scripts/card-preview.mjs', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
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
const SCEN = ['normal', 'own', 'manual', 'sleep', 'off', 'silent', 'vacation'];
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
{ const p = await open({ accept: false, hash: '#climate', w: 402, h: 874 }); await p.page.locator('.at-heat-room').last().locator('[aria-label$="теплее на 0,5°"]').click(); await p.page.waitForTimeout(1200);
  const e = await p.page.evaluate(() => document.querySelectorAll('.at-heat-room')[4].querySelector('.at-heat-err')?.textContent);
  check('a refused room command is said in that room', /Команда не выполнена/.test(e ?? '') && !/object Object|preview:/.test(e ?? ''), e);
  await p.page.evaluate(() => window.atomPreview.host.setAccept(true)); await p.page.locator('.at-heat-room').last().locator('[aria-label$="теплее на 0,5°"]').click(); await p.page.waitForTimeout(1200);
  check('…and the next accepted one clears it', !(await p.page.evaluate(() => document.querySelectorAll('.at-heat-room')[4].querySelector('.at-heat-err')?.textContent))); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); await p.page.locator('.at-heat-hero .at-heat-power').focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(150);
  check('the question puts focus on «Отмена»', await p.page.evaluate(() => document.activeElement?.textContent === 'Отмена'));
  await p.page.keyboard.press('Escape'); await p.page.waitForTimeout(150);
  check('Escape closes it and focus is back on the button', await p.page.evaluate(() => document.activeElement?.classList.contains('at-heat-power') && /Выключить/.test(document.activeElement.textContent)) && (await log(p.page)).length === 0); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); await p.page.locator('.at-heat-room').first().locator('[aria-label$="теплее на 0,5°"]').click(); await settle(p.page); const l = await log(p.page);
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
{ const p = await open({ hash: '#climate' }); const row = p.page.locator('.at-heat-hyst-row').first(); await row.locator('[aria-label$="больше на 0,2°"]').click(); await settle(p.page); const l = await log(p.page);
  check('hysteresis «вниз» +: one command to its helper, 0,8', l.length === 1 && l[0].entity_id === 'input_number.heating_hyst_down' && Math.abs(l[0].value - 0.8) < 1e-9, l);
  check('«вниз» + «вверх» never above 1°', await p.page.evaluate(() => document.querySelectorAll('.at-heat-hyst-row')[1].querySelectorAll('.at-heat-pm')[1].getAttribute('aria-disabled') === 'true'));
  check('the example names the real thresholds', /откроется на 19,7° и закроется на 20,7°/.test(await p.page.locator('.at-heat-hyst-say').innerText())); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); await p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }).click(); await p.page.waitForTimeout(150);
  check('«Отпуск» asks first, nothing sent', (await log(p.page)).length === 0 && await p.page.locator('.at-heat-scen + .at-heat-confirm').isVisible());
  await p.page.locator('.at-heat-scen + .at-heat-confirm .is-danger').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  // CODEX-011 (was: one command, the earlier plan's date left in force): no date given → the house's «no date» first, then the switch
  check('…then turns the heating «Отпуск» on (no security «Отпуск» in this house yet), the house\'s «no date» written first', l.length === 2 && l[0].s === 'set_datetime' && l[0].entity_id === 'input_datetime.heating_vacation_return' && l[0].datetime === '2099-12-31 00:00:00' && l[1].entity_id === 'input_boolean.heating_vacation' && l[1].s === 'turn_on', l); await p.ctx.close(); }
{ const p = await open({ scenario: 'secvac', hash: '#climate' }); await p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }).click(); await p.page.waitForTimeout(150);
  check('with the security\'s «Отпуск» the question names it', /Охрана встанет в «Отпуск»/.test(await p.page.locator('.at-heat-scen + .at-heat-confirm').innerText()));
  await p.page.locator('.at-heat-scen + .at-heat-confirm .is-danger').click(); await p.page.waitForTimeout(150); const l = await log(p.page);
  check('…and arms the security «Отпуск» (the house\'s «no date» written first, CODEX-011)', l.length === 2 && l[0].s === 'set_datetime' && l[0].datetime === '2099-12-31 00:00:00' && l[1].s === 'alarm_arm_vacation' && l[1].entity_id === 'alarm_control_panel.alarmo', l); await p.ctx.close(); }
// CODEX-011: an earlier plan's return date, emptied in the question, is cleared in the house before «Отпуск» goes on — and read back as no date
const AHEAD = new Date(Date.now() + 39 * 864e5).toISOString().slice(0, 10);
{ const p = await open({ scenario: 'secvac', hash: '#climate' }); await p.page.evaluate(d => window.atomPreview.setStates({ 'input_datetime.heating_vacation_return': `${d} 00:00:00` }), AHEAD); await p.page.waitForTimeout(150);
  const card = p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }); await card.click(); await p.page.waitForTimeout(150); const q = p.page.locator('.at-heat-scen + .at-heat-confirm'), f = q.locator('input[type=date]');
  check('CODEX-011 heating: the question shows the earlier plan\'s date', (await f.inputValue()) === AHEAD, await f.inputValue());
  await f.fill(''); await q.locator('.is-danger').click(); await p.page.waitForTimeout(250); const l = await log(p.page);
  check('CODEX-011 heating: the emptied date is written as the house\'s «no date» before the arming, nothing else', l.length === 2 && l[0].s === 'set_datetime' && l[0].entity_id === 'input_datetime.heating_vacation_return' && l[0].datetime === '2099-12-31 00:00:00' && l[1].s === 'alarm_arm_vacation', l);
  await p.page.evaluate(() => window.atomPreview.setStates({ 'input_datetime.heating_vacation_return': '2099-12-31 00:00:00', 'alarm_control_panel.alarmo': 'armed_vacation', 'input_boolean.heating_vacation': 'on' })); await p.page.waitForTimeout(150);
  check('CODEX-011 heating: «no date» is read back as no date (no «возвращение» on the card)', !/возвращение|2099|31 дек/i.test(await card.innerText()), await card.innerText()); await p.ctx.close(); }
{ const p = await open({ scenario: 'secvac', hash: '#climate' }); await p.page.evaluate(() => { const h = window.atomPreview.host, orig = h.call.bind(h); h.call = (d, s, data) => d === 'input_datetime' ? (h.log.push({ domain: d, service: s, data }), Promise.reject({ code: 'home_assistant_error', message: 'нет' })) : orig(d, s, data); });
  await p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }).click(); await p.page.waitForTimeout(150); await p.page.locator('.at-heat-scen + .at-heat-confirm .is-danger').click(); await p.page.waitForTimeout(300); const l = await log(p.page);
  const said = await p.page.evaluate(() => document.querySelector('.at-heat-scen')?.parentElement?.querySelector(':scope > .at-heat-err')?.textContent ?? '');
  check('CODEX-011 heating: a refused date write leaves «Отпуск» off (no arming) and says why', l.length === 1 && l[0].s === 'set_datetime' && /Дом отклонил команду/.test(said), [l, said]); await p.ctx.close(); }
// 5. a refused command puts the value back and says so
{ const p = await open({ accept: false }); await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]'); await p.page.waitForTimeout(1200);
  const s = await p.page.evaluate(() => ({ n: document.querySelector('.at-heat-tile .at-heat-step b').textContent, err: document.querySelector('.at-heat-tile .at-heat-err')?.textContent }));
  check('refused: the number goes back, the words say why', s.n.startsWith('20,5') && /Команда не выполнена/.test(s.err ?? '') && !/object Object|preview:/.test(s.err ?? ''), s); await p.ctx.close(); }
// 6. audit 2026-11-09 (docs/HEATING.md)
const setStates = (page, over) => page.evaluate(o => window.atomPreview.setStates(o), over).then(() => page.waitForTimeout(150));
{ // the tile was drawn in «Авто»; the mode becomes «Ручной»; «+» and the screen is left within the pause: the value goes to the rooms' manual helpers
  const p = await open({}); await setStates(p.page, { 'input_select.heating_mode': 'Ручной' });
  await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]'); await p.page.waitForTimeout(150); await p.page.locator('.at-heat-open').click(); await settle(p.page); const l = await log(p.page);
  check('left within the pause after the mode changed: the rooms\' manual helpers, not «Дома»', l.length === 5 && l.every(c => /_heating_manual_temp$/.test(c.entity_id)) && !l.some(c => c.entity_id === 'input_number.heating_home_temp'), l); await p.ctx.close(); }
{ const p = await open({}); await setStates(p.page, { 'sensor.heating_scenario': 'Сон' });
  await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]'); await p.page.waitForTimeout(150); await p.page.locator('.at-heat-open').click(); await settle(p.page); const l = await log(p.page);
  check('left within the pause after the scenario changed: the scenario\'s own change, «Дома» untouched', l.length === 2 && l.some(c => c.entity_id === 'input_number.heating_scenario_override_temp') && !l.some(c => c.entity_id === 'input_number.heating_home_temp'), l); await p.ctx.close(); }
{ const p = await open({}); await press(p.page, '.at-heat-tile [aria-label$="больше на 0,5°"]', 3); await press(p.page, '.at-heat-tile [aria-label$="меньше на 0,5°"]', 3); await settle(p.page); const l = await log(p.page);
  check('+ + + − − − back to the house\'s value sends nothing', l.length === 0, l);
  check('…and nothing is left «pending»', !(await p.page.locator('.at-heat-tile .at-heat-step.is-pending').count())); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); const names = await p.page.evaluate(() => [...document.querySelectorAll('.at-heat-room')].map(r => [...r.querySelectorAll('.at-heat-pm')].map(b => b.getAttribute('aria-label'))));
  check('a room\'s − / + are named with the room', names.length === 5 && names[0][0] === 'Гостиная: холоднее на 0,5°' && names[0][1] === 'Гостиная: теплее на 0,5°' && new Set(names.flat()).size === 10, names);
  // after the common temperature changed the rooms' own steppers wait half a minute, with the reason
  await press(p.page, '.at-heat-hero [aria-label$="больше на 0,5°"]'); await settle(p.page);
  const room = p.page.locator('.at-heat-room').first(); check('after a common change the rooms\' − / + wait (aria-disabled + aria-busy, the focus can stay), and say why', await room.locator('.at-heat-pm').first().evaluate(b => b.getAttribute('aria-disabled') === 'true' && b.getAttribute('aria-busy') === 'true' && !b.disabled) && /Применяю общую температуру/.test(await room.locator('.at-heat-room-line').innerText()), await room.innerText());
  await room.locator('[aria-label$="теплее на 0,5°"]').click({ force: true }).catch(() => {}); await settle(p.page); const l = await log(p.page);
  check('…and a tap on one sends nothing', l.length === 1 && l[0].entity_id === 'input_number.heating_home_temp', l); await p.ctx.close(); }
{ // «Отпуск» stands: the rooms are held, their steppers are off with the reason; the card asks before it takes the house off guard
  const p = await open({ scenario: 'vacation', hash: '#climate' }), room = p.page.locator('.at-heat-room').first();
  check('in «Отпуск» a room\'s − / + are off and say why', await room.locator('.at-heat-pm').first().isDisabled() && await room.locator('.at-heat-pm').last().isDisabled() && /В «Отпуске» комнаты не меняются/.test(await room.locator('.at-heat-room-line').innerText()), await room.innerText());
  await room.locator('.at-heat-pm').last().click({ force: true }).catch(() => {}); await settle(p.page); check('…and send nothing', (await log(p.page)).length === 0, await log(p.page));
  const card = p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }); check('a return date left from the last trip is not shown', !/возвращение/.test(await card.innerText()) && /защита труб/.test(await card.innerText()), await card.innerText());
  await card.click(); await p.page.waitForTimeout(200); const q = p.page.locator('.at-heat-scen + .at-heat-confirm');
  check('the active «Отпуск» card asks before disarming and sends nothing', (await log(p.page)).length === 0 && /Выключить «Отпуск»\? Дом снимется с охраны/.test(await q.innerText().catch(() => '')), await q.innerText().catch(() => ''));
  check('…with the focus on «Отмена»', await p.page.evaluate(() => document.activeElement?.textContent === 'Отмена'));
  await p.page.keyboard.press('Escape'); await p.page.waitForTimeout(200); check('Escape cancels it, nothing sent, focus back on the card', !(await q.count()) && (await log(p.page)).length === 0 && await card.evaluate(e => e === document.activeElement));
  await card.click(); await p.page.waitForTimeout(150); await q.locator('.is-danger').click(); await p.page.waitForTimeout(200); const l = await log(p.page);
  check('…and «yes» takes the house off guard', l.length === 1 && l[0].s === 'alarm_disarm' && l[0].entity_id === 'alarm_control_panel.alarmo', l); await p.ctx.close(); }
{ const p = await open({ scenario: 'secvac', hash: '#climate' }); await p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }).click(); await p.page.waitForTimeout(150);
  const q = p.page.locator('.at-heat-scen + .at-heat-confirm'); check('the «Отпуск» question has a return date field, empty when the old date has passed', await q.locator('input[type=date]').count() === 1 && (await q.locator('input[type=date]').inputValue()) === '');
  await q.locator('input[type=date]').fill('2031-01-15'); await q.locator('.is-danger').click(); await p.page.waitForTimeout(250); const l = await log(p.page);
  check('…the date is written, then the guard is armed in «Отпуск»', l.length === 2 && l[0].s === 'set_datetime' && l[0].entity_id === 'input_datetime.heating_vacation_return' && l[0].datetime === '2031-01-15 00:00:00' && l[1].s === 'alarm_arm_vacation', l); await p.ctx.close(); }
{ const p = await open({}); const t = () => p.page.locator('.at-heat-tile-head small').innerText();
  await setStates(p.page, { 'binary_sensor.kitchen_boiler_ebus_signal': 'off' });
  check('a silent eBUS shows on the tile', /котёл не на связи/.test(await t()) && await p.page.evaluate(() => document.querySelector('.at-heat-tile').classList.contains('hz-warn')), await t());
  await setStates(p.page, { 'binary_sensor.kitchen_boiler_ebus_signal': 'on', 'switch.kitchen_boiler_heat_relay': 'unavailable' });
  check('a relay that does not answer shows on the tile', /реле котла не на связи/.test(await t()), await t()); await p.ctx.close(); }
{ const p = await open({ scenario: 'silent', w: 402, h: 874 }); await p.page.locator('.at-heat-open').click(); await p.page.waitForSelector('.at-heat-panel'); await p.page.waitForTimeout(500);
  const at = await p.page.evaluate(() => { const el = document.querySelector('.at-heat-room[data-room="office"]'), r = el.getBoundingClientRect(); return { focus: document.activeElement === el, inView: r.top >= 0 && r.bottom <= innerHeight + 1, top: Math.round(r.top) }; });
  check('a tile with a problem opens the panel at the room with the problem', at.focus && at.inView, at); await p.ctx.close();
  const q = await open({ w: 402, h: 874 }); await q.page.locator('.at-heat-open').click(); await q.page.waitForSelector('.at-heat-panel'); await q.page.waitForTimeout(400);
  check('…and a calm tile opens it at the top', await q.page.evaluate(() => document.querySelector('.hm-main').scrollTop === 0 && !document.activeElement?.hasAttribute('data-room'))); await q.ctx.close(); }
{ const p = await open({ hash: '#climate' }), facts = () => p.page.locator('.at-heat-hero-facts').innerText(), boiler = () => p.page.locator('.at-heat-boiler').innerText();
  await setStates(p.page, { 'binary_sensor.kitchen_window_center_contact': 'unavailable' });
  check('a window sensor without a connection is not «Все окна закрыты»', /Окон без связи: 1/.test(await facts()) && !/Все окна закрыты/.test(await facts()), await facts());
  const foot = await p.page.locator('.at-heat-room[data-room="kitchen"] footer').innerText(); check('…nor «Окна закрыты (2)» in its room', /Окно: нет связи/.test(foot) && !/Окна закрыты/.test(foot), foot);
  await setStates(p.page, { 'binary_sensor.kitchen_window_center_contact': 'off', 'switch.kitchen_boiler_heat_relay': 'unavailable' });
  check('a relay without a connection is not «Нет запроса»', /Реле котла не на связи/.test(await boiler()) && !/Нет запроса/.test(await boiler()) && !/горячая вода/.test(await boiler()) && /Реле котла не на связи/.test(await facts()), await boiler());
  await setStates(p.page, { 'switch.kitchen_boiler_heat_relay': 'on', 'sensor.kitchen_boiler_flame': 'unknown' });
  check('an unknown flame is not «Не горит»', !/Не горит/.test(await boiler()) && /Пламя: нет данных/.test(await boiler()) && !/Котёл не греет/.test(await facts()), await boiler());
  await setStates(p.page, { 'sensor.kitchen_boiler_flame': 'on', 'sensor.kitchen_boiler_pressure': '1.59' });
  check('1,59 bar is not «Норма 1,0–1,5»', /По паспорту 1,0–1,5/.test(await boiler()) && !/Норма 1,0–1,5/.test(await boiler()), await boiler());
  await setStates(p.page, { 'sensor.kitchen_boiler_pressure': '1.32', 'sensor.heating_scenario': 'unknown' });
  check('1,32 bar is «Норма 1,0–1,5»', /Норма 1,0–1,5/.test(await boiler()));
  check('an unknown scenario marks no card «Сейчас»', await p.page.locator('.at-heat-scen-card.is-now').count() === 0);
  await setStates(p.page, { 'sensor.heating_scenario': 'Дома', 'weather.forecast_home': 'clear-night' });
  check('the weather word of a clear night is said', /На улице −3° · \S/.test(await p.page.locator('.at-heat-hero-text small').first().innerText()), await p.page.locator('.at-heat-hero-text small').first().innerText());
  await setStates(p.page, { 'select.kids_trv_temperature_sensor_select': 'local_temperature' }); const kids = await p.page.locator('.at-heat-room[data-room="kids"]').innerText();
  check('a head on its own sensor says «у радиатора», not «в комнате»', /у радиатора/.test(kids) && !/в комнате/.test(kids) && /Головка меряет сама у радиатора/.test(kids), kids); await p.ctx.close(); }
{ const p = await open({ scenario: 'silent', hash: '#climate' }); const b = await p.page.locator('.at-heat-boiler').innerText(); check('no pressure reading, no «Норма»', !/Норма|По паспорту/.test(b), b); await p.ctx.close(); }
// ST-05: the silent boiler's note says exactly what the relay says — no data, asks for heat, does not — and never that the heating works
const NOTE = { ru: { null: 'Нет данных от котла и реле. Работа отопления не подтверждена.', on: 'Нет данных от котла. Реле запрашивает тепло; работа горелки не подтверждена.', off: 'Нет данных от котла. Реле не запрашивает тепло.' },
  en: { null: 'No data from the boiler or relay. Heating operation is not confirmed.', on: 'No data from the boiler. The relay is requesting heat; burner operation is not confirmed.', off: 'No data from the boiler. The relay is not requesting heat.' },
  ro: { null: 'Nu există date de la centrală sau releu. Funcționarea încălzirii nu este confirmată.', on: 'Nu există date de la centrală. Releul solicită căldură; funcționarea arzătorului nu este confirmată.', off: 'Nu există date de la centrală. Releul nu solicită căldură.' } };
for (const theme of ['light', 'dark']) for (const lang of ['ru', 'en', 'ro']) {
  const p = await open({ scenario: 'silent', hash: '#climate', w: 1070, h: 764, theme, lang }), tag = `${theme} ${lang}`;
  for (const [relay, want] of [['unavailable', 'null'], ['unknown', 'null'], ['on', 'on'], ['off', 'off']]) {
    await setStates(p.page, { 'switch.kitchen_boiler_heat_relay': relay }); await p.page.locator('.at-heat-boiler').scrollIntoViewIfNeeded();
    const b = await p.page.evaluate(() => ({ note: document.querySelectorAll('.at-heat-bnote').length === 1 ? document.querySelector('.at-heat-bnote').textContent : null, chip: document.querySelector('.at-heat-relay')?.textContent ?? '', lost: document.querySelector('.at-heat-relay')?.classList.contains('is-lost') }));
    check(`ST-05 ${tag}: relay ${relay} — the note says «${NOTE[lang][want].slice(0, 40)}…»`, b.note === NOTE[lang][want], b.note);
    if (lang === 'ru') check(`ST-05 ${tag}: relay ${relay} — the relay's chip agrees`, want === 'null' ? b.lost && /Реле котла не на связи/.test(b.chip) : want === 'on' ? b.chip === 'Реле: запрос тепла' : !b.lost && b.chip !== 'Реле: запрос тепла', b); }
  check(`ST-05 ${tag}: nothing is sent`, (await log(p.page)).length === 0, await log(p.page)); check(`ST-05 ${tag}: no page error`, !p.errors.length, p.errors); await p.ctx.close(); }
for (const theme of ['light', 'dark']) for (const lang of ['ru', 'ro']) { const p = await open({ scenario: 'silent', hash: '#climate', w: 360, h: 792, theme, lang });
  for (const relay of ['unavailable', 'on', 'off']) { await setStates(p.page, { 'switch.kitchen_boiler_heat_relay': relay }); const n = p.page.locator('.at-heat-bnote'); await n.scrollIntoViewIfNeeded();
    const g = await n.evaluate(e => { const r = e.getBoundingClientRect(), box = e.closest('.at-heat-boiler').getBoundingClientRect(); return { fits: e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1, inside: r.left >= box.left - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    check(`ST-05 360×792 ${theme} ${lang}: relay ${relay} — the note is whole inside the boiler card, no sideways scroll`, g.fits && g.inside && g.page <= 0, g); }
  if (lang === 'ro') await p.page.locator('.at-heat-boiler').screenshot({ path: `${out}/boiler-silent-360-${theme}-ro.png` }); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); const note = () => p.page.locator('.at-heat-bnote').count();
  check('ST-05: the boiler on the bus has no note', (await note()) === 0);
  await setStates(p.page, { 'binary_sensor.kitchen_boiler_ebus_signal': 'off' }); const said = await p.page.locator('.at-heat-bnote').innerText().catch(() => '');
  check('ST-05: the bus silent, the relay asking — the note says the relay asks, the burner unconfirmed', said === NOTE.ru.on, said);
  await setStates(p.page, { 'binary_sensor.kitchen_boiler_ebus_signal': 'on' });
  check('ST-05: the bus back — the note goes, the readings return, nothing sent', (await note()) === 0 && /52/.test(await p.page.locator('.at-heat-bgrid').innerText()) && (await log(p.page)).length === 0, await p.page.locator('.at-heat-bgrid').innerText()); await p.ctx.close(); }
{ const p = await open({ scenario: 'manual', hash: '#climate' }); await setStates(p.page, { 'sensor.heating_scenario': 'Сон' });
  check('in «Ручной» «Сон» is not marked «Сейчас»', await p.page.locator('.at-heat-scen-card.is-now').count() === 0);
  await setStates(p.page, { 'sensor.heating_scenario': 'Отпуск', 'sensor.heating_target_temp': '8' }); const hero = await p.page.locator('.at-heat-hero-temp').innerText();
  check('«Ручной» + «Отпуск»: the big number is the 8° the heads hold, named «Отпуск», and is not stepped', /^8\s*°/.test(hero.trim()) && /Отпуск/.test(hero) && await p.page.locator('.at-heat-hero .at-heat-pm').first().isDisabled(), hero);
  check('…and «Отпуск» is the card marked «Сейчас»', /Отпуск/.test(await p.page.locator('.at-heat-scen-card.is-now').innerText().catch(() => ''))); await p.ctx.close(); }
{ // «вверх +», then «вниз +» within the pause: together never above 1°
  const p = await open({ hash: '#climate' }), rows = p.page.locator('.at-heat-hyst-row');
  await rows.nth(1).locator('[aria-label$="больше на 0,2°"]').click(); await p.page.waitForTimeout(120); await rows.nth(0).locator('[aria-label$="больше на 0,2°"]').click({ force: true }); await settle(p.page); const l = await log(p.page);
  check('hysteresis: an unsent «вверх» already limits «вниз»', l.length === 1 && l[0].entity_id === 'input_number.heating_hyst_up' && Math.abs(l[0].value - 0.4) < 1e-9, l); await p.ctx.close(); }
{ const p = await open({ hash: '#climate' }); await p.page.evaluate(() => window.atomPreview.setOnline(false)); await p.page.waitForTimeout(200);
  check('offline: the panel says its data is from before', /данные на момент потери связи/.test(await p.page.locator('.at-heat-hero').innerText()));
  check('offline: every − / + is off', await p.page.evaluate(() => [...document.querySelectorAll('.at-heat-panel .at-heat-pm')].every(b => b.disabled || b.getAttribute('aria-disabled') === 'true')));
  check('offline: the house\'s − / + is dimmed, not dead (aria-disabled, the focus can stay on it)', await p.page.evaluate(() => [...document.querySelectorAll('.at-heat-hero .at-heat-pm')].every(b => !b.disabled && b.getAttribute('aria-disabled') === 'true')));
  await p.page.locator('.at-heat-hero .at-heat-pm').last().click({ force: true }).catch(() => {}); await p.page.locator('.at-heat-scen-card', { hasText: 'Эко' }).click({ force: true }); await p.page.locator('.at-heat-mode button', { hasText: 'Ручной' }).click({ force: true }); await settle(p.page);
  check('offline: nothing is sent', (await log(p.page)).length === 0, await log(p.page)); await p.ctx.close(); }
// 7. round 2 of the audit (10.11.2026): pending and offline keep the focus and answer, per-key waiting, «Отпуск» on its way, the question's order
{ // f0 / f69: a control whose command is on its way is aria-disabled + aria-busy, never `disabled` — the keyboard focus stays on it
  const p = await open({ hash: '#climate' }); await p.page.evaluate(() => window.atomPreview.host.setDelay(900));
  await p.page.locator('.at-heat-hero .at-heat-mode button', { hasText: 'Ручной' }).focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(250);
  const m = await p.page.evaluate(() => { const a = document.activeElement, g = a?.closest('.at-heat-mode'); return { on: a?.textContent, dis: a?.disabled, aria: a?.getAttribute('aria-disabled'), busy: g?.getAttribute('aria-busy') ?? null }; });
  check('round2 f0: the mode button waits with the focus on it (aria-disabled + aria-busy, not disabled)', m.on === 'Ручной' && m.dis === false && m.aria === 'true' && m.busy === 'true', m);
  await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(100); check('round2 f0: …and a second Enter meanwhile sends nothing more', (await log(p.page)).length === 1, await log(p.page));
  // l51: a second command with another key does not take the waiting look off the first
  await p.page.locator('.at-heat-scen-card', { hasText: 'Эко' }).focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(150);
  const two = await p.page.evaluate(() => ({ mode: document.querySelector('.at-heat-hero .at-heat-mode')?.getAttribute('aria-busy'), eco: document.activeElement?.getAttribute('aria-busy'), ecoDis: document.activeElement?.disabled, focus: document.activeElement?.textContent ?? '' }));
  check('round2 l51: two commands wait at once, each on its own control; the focus is on the second', two.mode === 'true' && two.eco === 'true' && two.ecoDis === false && /Эко/.test(two.focus), two);
  await p.page.waitForTimeout(1400); check('round2 l51: both are free again after the house answered', await p.page.evaluate(() => !document.querySelector('.at-heat-panel [aria-busy="true"]')));
  // the house's «+» from the keyboard, twice: the focus never leaves the button, one command with the last value
  const before = (await log(p.page)).length; await p.page.locator('.at-heat-hero [aria-label$="больше на 0,5°"]').focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(150); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(2200);
  const st = (await log(p.page)).slice(before); check('round2 f69: two Enter on «+» are two steps and one command, the focus stays on «+»', st.length >= 1 && new Set(st.map(c => c.value)).size === 1 && await p.page.evaluate(() => /больше на 0,5°$/.test(document.activeElement?.getAttribute('aria-label') ?? '')), st); await p.ctx.close(); }
{ // l51: an accepted command does not erase another control's refusal
  const p = await open({ hash: '#climate', accept: false }); await p.page.locator('.at-heat-scen-card', { hasText: 'Эко' }).click(); await p.page.waitForTimeout(300);
  const line = () => p.page.evaluate(() => document.querySelector('.at-heat-scen')?.parentElement?.querySelector(':scope > .at-heat-err')?.textContent ?? '');
  check('round2 l51: the refused «Эко» is said under the scenarios', /Команда не выполнена/.test(await line()), await line());
  await p.page.evaluate(() => window.atomPreview.host.setAccept(true)); await p.page.locator('.at-heat-hero .at-heat-mode button', { hasText: 'Ручной' }).click(); await p.page.waitForTimeout(300);
  check('round2 l51: …and stays after another control\'s command was accepted', /Команда не выполнена/.test(await line()), await line());
  await p.page.locator('.at-heat-scen-card', { hasText: 'Эко' }).click(); await p.page.waitForTimeout(300); check('round2 l51: its own accepted command clears it', (await line()) === '', await line()); await p.ctx.close(); }
{ // l89: off the line a press on a dimmed control tells why, in the control's own place; nothing is sent, the focus stays
  const p = await open({ hash: '#climate' }); await p.page.evaluate(() => window.atomPreview.setOnline(false)); await p.page.waitForTimeout(200);
  await p.page.locator('.at-heat-hero [aria-label$="больше на 0,5°"]').focus(); await p.page.keyboard.press('Enter'); await p.page.waitForTimeout(150);
  const hero = await p.page.evaluate(() => ({ err: document.querySelector('.at-heat-hero .at-heat-err')?.textContent ?? '', focus: document.activeElement?.getAttribute('aria-label') ?? '' }));
  check('round2 l89: offline «+» says «Нет связи с домом» in the hero and keeps the focus', /Нет связи с домом/.test(hero.err) && /больше на 0,5°$/.test(hero.focus), hero);
  await p.page.locator('.at-heat-scen-card', { hasText: 'Эко' }).click({ force: true }); await p.page.waitForTimeout(150);
  check('round2 l89: offline «Эко» says it under the scenarios', /Нет связи с домом/.test(await p.page.evaluate(() => document.querySelector('.at-heat-scen')?.parentElement?.querySelector(':scope > .at-heat-err')?.textContent ?? '')));
  await p.page.locator('.at-heat-room').first().locator('.at-heat-pm').last().click({ force: true }); await p.page.waitForTimeout(150);
  check('round2 l89: offline room «+» says it in the room', /Нет связи с домом/.test(await p.page.locator('.at-heat-room').first().locator('.at-heat-err').innerText().catch(() => '')));
  await settle(p.page); check('round2 l89: nothing was sent', (await log(p.page)).length === 0, await log(p.page)); await p.ctx.close(); }
{ // f20: the exit delay towards «Отпуск» — the card is «Включается…», a tap asks to switch OFF and that disarms
  const p = await open({ scenario: 'arming', hash: '#climate' }), card = p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' });
  const c = await card.evaluate(b => ({ text: b.innerText, busy: b.getAttribute('aria-busy'), checked: b.getAttribute('aria-checked'), dis: b.disabled }));
  check('round2 f20: «Отпуск» is «Включается…» (aria-busy) during the exit delay', /Включается…/.test(c.text) && !/Включить/.test(c.text) && c.busy === 'true' && c.checked === 'true' && c.dis === false, c);
  await card.click(); await p.page.waitForTimeout(200); const q = p.page.locator('.at-heat-scen + .at-heat-confirm'), words = await q.innerText().catch(() => '');
  check('round2 f20: a tap asks to switch it off, never a second «Включить?»', /Выключить «Отпуск»\?/.test(words) && !/Включить «Отпуск»/.test(words) && await q.locator('input[type=date]').count() === 0 && (await log(p.page)).length === 0, words);
  await q.locator('.is-danger').click(); await p.page.waitForTimeout(200); const l = await log(p.page);
  check('round2 f20: …and «yes» cancels the arming (alarm_disarm)', l.length === 1 && l[0].s === 'alarm_disarm' && l[0].entity_id === 'alarm_control_panel.alarmo', l); await p.ctx.close(); }
{ // l127 / l146: «Отмена» first, the action second, in both questions; l147: a past return date is said and «Отпуск» is not switched on
  const p = await open({ scenario: 'secvac', hash: '#climate' }); await p.page.locator('.at-heat-hero .at-heat-power').click(); await p.page.waitForTimeout(150);
  const order = sel => p.page.evaluate(s => [...document.querySelectorAll(`${s} button`)].map(b => b.classList.contains('is-danger') ? 'action' : b.textContent), sel);
  check('round2 l127: «Выключить отопление?» — «Отмена» first, the action second', JSON.stringify(await order('.at-heat-hero .at-heat-confirm')) === '["Отмена","action"]', await order('.at-heat-hero .at-heat-confirm'));
  await p.page.keyboard.press('Escape'); await p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }).click(); await p.page.waitForTimeout(200);
  check('round2 l146: «Включить „Отпуск“?» — «Отмена» first, the action second', JSON.stringify(await order('.at-heat-scen + .at-heat-confirm')) === '["Отмена","action"]', await order('.at-heat-scen + .at-heat-confirm'));
  const q = p.page.locator('.at-heat-scen + .at-heat-confirm'), date = q.locator('input[type=date]'); await date.fill('2020-01-15'); await q.locator('.is-danger').click(); await p.page.waitForTimeout(200);
  const bad = await p.page.evaluate(() => { const i = document.querySelector('.at-heat-confirm input[type=date]'); return { open: !!i, invalid: i?.getAttribute('aria-invalid'), said: i ? document.getElementById(i.getAttribute('aria-describedby') ?? '')?.textContent ?? '' : '', focus: document.activeElement === i }; });
  check('round2 l147: a past return date is said in the field (aria-invalid + words), the question stays', bad.open && bad.invalid === 'true' && /уже прошла/.test(bad.said) && bad.focus, bad);
  check('round2 l147: …and «Отпуск» is not switched on without it', (await log(p.page)).length === 0, await log(p.page));
  await date.fill('2031-01-15'); await p.page.waitForTimeout(100); check('round2 l147: a new date takes the words away', await p.page.evaluate(() => !document.querySelector('.at-heat-confirm input[type=date]')?.getAttribute('aria-invalid') && !document.getElementById('at-heat-back-err')));
  await q.locator('.is-danger').click(); await p.page.waitForTimeout(250); const l = await log(p.page);
  check('round2 l147: …and goes out before the arming', l.length === 2 && l[0].s === 'set_datetime' && l[0].datetime === '2031-01-15 00:00:00' && l[1].s === 'alarm_arm_vacation', l); await p.ctx.close(); }
{ // f68: the hysteresis is the administrator's; everyone else reads one line and has nothing to press
  const p = await open({ hash: '#climate' }); check('round2 f68: an administrator has the two steppers', await p.page.locator('.at-heat-hyst .at-heat-pm').count() === 4);
  await p.page.evaluate(() => window.atomPreview.setAdmin(false)); await p.page.waitForTimeout(250);
  const g = await p.page.evaluate(() => { const h = document.querySelector('.at-heat-hyst'); return { there: !!h, buttons: h?.querySelectorAll('button, input').length ?? -1, text: h?.textContent ?? '' }; });
  check('round2 f68: a household member reads one line with the values and has no button', g.there && g.buttons === 0 && /0,6°/.test(g.text) && /0,2°/.test(g.text) && /администратор/i.test(g.text), g);
  check('round2 f68: …and nothing was sent', (await log(p.page)).length === 0); await p.ctx.close(); }
{ // l120: heating off — no scenario card says «Сейчас»; a silent bus beside an asking relay — the chip is the relay's own word, the hero's fact a warning
  const p = await open({ scenario: 'off', hash: '#climate' }); check('round2 l120: heating off — no scenario carries «Сейчас»', await p.page.locator('.at-heat-scen-card.is-now').count() === 0 && !/Сейчас/.test(await p.page.locator('.at-heat-scen').innerText()), await p.page.locator('.at-heat-scen').innerText()); await p.ctx.close();
  const s = await open({ scenario: 'silent', hash: '#climate' }); await setStates(s.page, { 'switch.kitchen_boiler_heat_relay': 'on' });
  const b = await s.page.evaluate(() => ({ chip: document.querySelector('.at-heat-relay')?.textContent ?? '', state: document.querySelector('.at-heat-boiler header small')?.textContent ?? '', fact: document.querySelector('.at-heat-hero-facts li')?.className ?? '' }));
  check('round2 l120: «Нет связи по eBUS» stands beside «Реле: запрос тепла», the hero\'s fact is a warning', /Нет связи по eBUS/.test(b.state) && b.chip === 'Реле: запрос тепла' && /is-warn/.test(b.fact) && !/is-hot/.test(b.fact), b); await s.ctx.close(); }
{ // l24: the room's sensor is gone while the head is still set to it
  const p = await open({ hash: '#climate' }); const id = await p.page.evaluate(() => { const st = window.atomPreview.host.states(); return ['sensor.kids_co2_temperature', 'sensor.kids_climate_temperature'].find(x => st[x]) ?? null; });
  check('round2 l24: the preview house has the kids\' room sensor', !!id); await setStates(p.page, { [id ?? 'sensor.kids_co2_temperature']: 'unavailable' }); const r = await p.page.locator('.at-heat-room[data-room="kids"]').innerText();
  check('round2 l24: a room whose sensor does not answer says «последнее», not «в комнате»', /последнее/.test(r) && /Датчик комнаты не отвечает/.test(r) && !/в комнате/.test(r), r);
  await p.ctx.close(); }
for (const lang of ['ru', 'en', 'ro']) { const p = await open({ scenario: 'arming', lang, hash: '#climate' }); await p.page.evaluate(() => window.atomPreview.setAdmin(false)); await p.page.waitForTimeout(200); const t = await p.page.evaluate(() => document.querySelector('.hm-main')?.innerText ?? ''); check(`round2: no missing words ${lang}`, !/module\.heat/.test(t), t.match(/module\.heat\.[\w.]+/g)); await p.ctx.close(); }
for (const theme of ['light', 'dark']) for (const [w, h] of [[360, 792], [1070, 764]]) { const p = await open({ scenario: 'arming', theme, w, h, hash: '#climate' }); const v = await axe(p.page, '.at-heat-panel'), lay = await layout(p.page, '.at-heat-panel'); check(`round2 f20: axe «Включается…» ${theme}/${w}`, v.length === 0, v); check(`round2 f20: layout «Включается…» ${theme}/${w}`, lay.length === 0, lay); await p.ctx.close(); }
for (const theme of ['light', 'dark']) for (const [scenario, w, h] of [['secvac', 360, 792], ['secvac', 1070, 764], ['vacation', 360, 792], ['vacation', 1070, 764]]) {
  const p = await open({ scenario, theme, w, h, hash: '#climate' }); await p.page.locator('.at-heat-scen-card', { hasText: 'Отпуск' }).click(); await p.page.waitForTimeout(200);
  const v = await axe(p.page, '.at-heat-panel'); check(`axe with the «Отпуск» question ${scenario}/${theme}/${w}`, v.length === 0, v);
  const lay = await layout(p.page, '.at-heat-panel'), tg = await targets(p.page, '.at-heat-confirm'); check(`layout with the «Отпуск» question ${scenario}/${theme}/${w}`, lay.length === 0, lay); check(`targets of the «Отпуск» question ${scenario}/${theme}/${w}`, tg.length === 0, tg); await p.ctx.close(); }
// ST-10 (studio): on design-2026 a reset took the heating buttons' fill away (words at 1,1–1,3:1). Classic never had that reset (measured: every
// «Включить», «Выключить отопление», «Отмена» and question action ≥ 5,38:1 light and dark at 1070×764 and 360×792); this pins the fill
for (const theme of ['light', 'dark']) for (const [scenario, hash] of [['off', '#home'], ['off', '#climate'], ['normal', '#climate']]) { const p = await open({ scenario, theme, hash, w: 360, h: 792 });
  if (scenario === 'normal') { await p.page.locator('.at-heat-hero .at-heat-power').click(); await p.page.waitForTimeout(150); }
  const bg = await p.page.evaluate(() => [...document.querySelectorAll('.at-heat-power')].map(b => ({ t: b.textContent, bg: getComputedStyle(b).backgroundColor })));
  check(`ST-10 ${scenario}${hash} ${theme}: every heating button has a fill`, bg.length > 0 && bg.every(x => !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(x.bg)), bg); await p.ctx.close(); }
await finish(fails.length ? 1 : 0);
