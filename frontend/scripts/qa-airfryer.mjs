// The air fryer card and sheet in one run, in the shared card preview (its host records every command and reaches nothing): layout on every
// device and orientation in both themes, accessibility (axe), console errors, touch targets, every scenario, the commands each control sends
// (and only on a tap), three languages.
// usage: node scripts/qa-airfryer.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
import { card } from './cards/airfryer.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/airfryer'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = await freePort();
const server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 300)}`); };
const stop = code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [1024, 768, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd']];
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
const SHEET = '.at-af.at-kt-sheet', TILE = '[data-module-card="airfryer"]';
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'idle', hash = '#home?device=airfryer' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=airfryer&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  await page.waitForSelector(hash.startsWith('#rooms') ? TILE : SHEET); await page.evaluate(() => window.atomPreview.setAccept(true)); await page.waitForTimeout(250);
  return { page, ctx, errors };
}
const runAxe = async (page, scope) => { await page.addScriptTag({ content: axe }); return page.evaluate(async sc => { const r = await window.axe.run(document.querySelector(sc), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }); return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`); }, scope); };
const small = page => page.evaluate(sel => [...document.querySelectorAll(`${sel} button`)].filter(b => b.offsetWidth && (b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)).map(b => `${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 24)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`), SHEET);
const log = page => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => `${x.domain}.${x.service}:${(x.data?.entity_id ?? '').split('.')[1]?.replace('kitchen_airfryer_', '') ?? ''}${x.data?.value !== undefined ? '=' + x.data.value : ''}${x.data?.option ? '=' + x.data.option : ''}`));
const SCEN = Object.keys(card.scenarios), PROGRAM_FILE = { 'Ручной режим': 'manual', 'Картофель фри': 'fries', 'Стейк': 'steak', 'Йогурт': 'yogurt' };
// 1. every device x both themes x every scenario: the sheet; the settings and the room tile on the main three
for (const theme of ['light', 'dark']) for (const [w, h, dev] of DEVICES) for (const scenario of SCEN) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario }), tag = `${dev}/${theme}/${scenario}`;
  const l = await layout(page, SHEET); check(`layout ${tag}`, !l.length, l);
  const s = await small(page); check(`targets ${tag}`, !s.length, s);
  if (['13R', 'pad', 'mac'].includes(dev)) { const a = await runAxe(page, SHEET); check(`axe ${tag}`, !a.length, a); }
  if (['13R', '13R-land', 'pad', 'pad-port', 'mac'].includes(dev)) await page.screenshot({ path: resolve(out, `sheet-${dev}-${theme}-${scenario}.png`) });
  check(`no commands on open ${tag}`, (await log(page)).length === 0, await log(page));
  if (['idle', 'cooking', 'offline'].includes(scenario)) { await page.locator('.at-kt-gear').click(); await page.waitForTimeout(200); const ls = await layout(page, SHEET); check(`layout settings ${tag}`, !ls.length, ls); if (['13R', 'pad'].includes(dev)) { const a = await runAxe(page, SHEET); check(`axe settings ${tag}`, !a.length, a); await page.screenshot({ path: resolve(out, `settings-${dev}-${theme}-${scenario}.png`) }); } }
  check(`console ${tag}`, !errors.length, errors); await ctx.close();
}
for (const theme of ['light', 'dark']) for (const [w, h, dev] of DEVICES) for (const scenario of ['idle', 'cooking', 'offline', 'turn']) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario, hash: card.home }), tag = `tile ${dev}/${theme}/${scenario}`;
  const l = await layout(page, TILE); check(`layout ${tag}`, !l.length, l);
  if (['13R', 'pad'].includes(dev)) { const a = await runAxe(page, TILE); check(`axe ${tag}`, !a.length, a); await page.locator(TILE).scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(out, `room-${dev}-${theme}-${scenario}.png`) }); }
  if (scenario === 'idle') { await page.locator(`${TILE} .ah-tile-hit`).click(); await page.waitForSelector(SHEET); check(`tile opens the sheet ${tag}`, true); }
  check(`console ${tag}`, !errors.length, errors); await ctx.close();
}
// 2. what each control sends: nothing before «Начать», then the program, its choices and the fryer's start, in that order
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const prog = async (page, name) => { await page.locator('.at-af-prog', { hasText: name }).click(); await page.waitForSelector('.at-af-go'); await page.waitForTimeout(150); };
{ const { page, ctx } = await open({ scenario: 'idle' }); const names = await page.locator('.at-af-prog').allTextContents();
  check('thirteen programs in Mi Home\'s order', eq(names, ['Ручной режим', 'Картофель фри', 'Куриные крылышки', 'Стейк', 'Каре ягнёнка', 'Рыба', 'Креветки', 'Овощи', 'Пирог', 'Пицца', 'Разморозка', 'Сухофрукты', 'Йогурт']), names);
  await prog(page, 'Картофель фри'); check('opening a program sends nothing', (await log(page)).length === 0, await log(page));
  const rows = await page.locator('.at-kt-set .ah-row-text strong').allTextContents(); check('fries: shake, amount, temperature (Mi Home)', eq(rows, ['Напоминание о необходимости встряхивания', 'Количество ингредиентов', 'Температура приготовления']), rows);
  check('fries: «Около 18 мин»', (await page.locator('.at-af-about').textContent()) === 'Около 18 мин', await page.locator('.at-af-about').textContent());
  check('fries: not hotter than 200', await page.locator('[aria-label^="Температура приготовления: +"]').isDisabled());
  await page.locator('.at-af-go').click(); await page.waitForTimeout(400);
  check('fries «Начать»', eq(await log(page), ['select.select_option:mode=French Fries', 'number.set_value:cooking_weight=500', 'number.set_value:target_temperature=200', 'button.press:start']), await log(page)); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'idle' }); await prog(page, 'Ручной режим');
  const rows = await page.locator('.at-kt-set .ah-row-text strong').allTextContents(); check('manual: temperature and time', eq(rows, ['Температура приготовления', 'Время приготовления']), rows);
  const plus = page.locator('[aria-label^="Температура приготовления: +"]'); await plus.click(); await plus.click(); await plus.click(); await page.locator('.at-kt-chips button', { hasText: /^30$/ }).click(); await page.waitForTimeout(900);
  check('choosing sends nothing', (await log(page)).length === 0, await log(page)); check('manual: «Около 30 мин»', (await page.locator('.at-af-about').textContent()) === 'Около 30 мин');
  await page.locator('.at-af-go').click(); await page.waitForTimeout(400);
  check('manual «Начать»', eq(await log(page), ['select.select_option:mode=Manual', 'number.set_value:target_temperature=195', 'number.set_value:target_time=30', 'button.press:start']), await log(page));
  await page.locator('.at-af-go').click({ force: true }).catch(() => undefined); await page.waitForTimeout(300); check('a second tap while it starts sends nothing', (await log(page)).length === 4, await log(page)); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'idle' }); await prog(page, 'Стейк');
  const rows = await page.locator('.at-kt-set .ah-row-text strong').allTextContents(); check('steak: amount, cooking mode, temperature', eq(rows, ['Количество ингредиентов', 'Режим приготовления', 'Температура приготовления']), rows);
  const segs = await page.locator('.at-af-seg button').allTextContents(); check('steak: Mi Home\'s choices', eq(segs, ['Однослойный', 'Двухслойный', 'Хрустящий гриль', 'Обезжирить']), segs);
  await page.locator('.at-af-seg button', { hasText: 'Двухслойный' }).click(); check('steak: two layers, no estimate invented', (await page.locator('.at-af-about').textContent()) === 'Время рассчитает аэрогриль');
  await page.locator('.at-af-go').click(); await page.waitForTimeout(400);
  check('steak «Начать»', eq(await log(page), ['select.select_option:mode=Steak', 'select.select_option:cooking_layers=Double Layer', 'select.select_option:texture=Crispy Roast', 'number.set_value:target_temperature=200', 'button.press:start']), await log(page)); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'idle' }); await prog(page, 'Картофель фри'); await page.locator('.at-kt-set [role="switch"]').click(); await page.locator('.at-af-go').click(); await page.waitForTimeout(400);
  check('fries without the reminder: the switch goes out too', (await log(page)).includes('switch.turn_off:shake_reminder_enabled'), await log(page)); await ctx.close(); }
for (const [w, h, dev] of DEVICES) for (const theme of ['light', 'dark']) for (const name of ['Ручной режим', 'Картофель фри', 'Стейк', 'Йогурт']) { const { page, ctx, errors } = await open({ w, h, theme, scenario: 'idle' }), tag = `program ${name} ${dev}/${theme}`; await prog(page, name);
  const l = await layout(page, SHEET); check(`layout ${tag}`, !l.length, l); const sm = await small(page); check(`targets ${tag}`, !sm.length, sm);
  if (['13R', 'pad', 'mac'].includes(dev)) { const a = await runAxe(page, SHEET); check(`axe ${tag}`, !a.length, a); }
  if (['13R', '13R-land', 'pad', 'pad-port'].includes(dev)) await page.screenshot({ path: resolve(out, `program-${dev}-${theme}-${PROGRAM_FILE[name]}.png`) });
  check(`console ${tag}`, !errors.length, errors); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'cooking' });
  const names = await page.locator('.at-af-acts button').allTextContents(); check('cooking: «Пауза» and «Отменить»', eq(names, ['Пауза', 'Отменить']), names);
  check('cooking: no program grid', await page.locator('.at-af-prog').count() === 0);
  const plus = page.locator('[aria-label^="Температура: +"]'); await plus.click(); await plus.click(); await page.waitForTimeout(1200); check('cooking: two taps on «+» are one command, 210 °C', eq(await log(page), ['number.set_value:target_temperature=210']), await log(page));
  await page.locator('.at-af-acts button').first().click(); await page.waitForTimeout(300); check('«Пауза» presses pause', (await log(page)).at(-1) === 'button.press:pause', await log(page)); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'turn' });
  const names = await page.locator('.at-af-acts button').allTextContents(); check('turn: «Продолжить» and «Отменить»', eq(names, ['Продолжить', 'Отменить']), names);
  await page.locator('.at-af-acts button').nth(1).click(); await page.waitForTimeout(300); check('«Отменить» presses cancel', eq(await log(page), ['button.press:cancel']), await log(page)); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'offline' });
  check('offline: nothing to press in the hero', await page.locator('.at-af-acts button').count() === 0);
  check('offline: every control is disabled', await page.locator(`${SHEET} .at-kt-col:nth-child(2) button:not(:disabled)`).count() === 0);
  check('offline: says it is off', (await page.locator('.at-kt-status').textContent()).includes('выключен')); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'standby' }); check('standby: on the network, the programs can be opened', await page.locator('.at-af-prog:not(:disabled)').count() === 13); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'bare' });
  const text = await page.locator(SHEET).innerText(); check('bare: no «0 °C», no «0 мин»', !/(^|\s)0\s*(°C|мин)/.test(text), text.slice(0, 200)); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'fault' });
  check('fault: no program can be started', await page.locator('.at-af-prog:not(:disabled)').count() === 0); check('fault: said in words', (await page.locator('.at-kt-status').textContent()).includes('Неисправность')); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'long' }); check('long: 6:52 ч', (await page.locator('.at-af-time').textContent()).replace(/\s/g, '') === '6:52ч', await page.locator('.at-af-time').textContent()); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.locator('.at-kt-gear').click(); await page.locator('[data-fryer-switch="autoKeep"] button').click(); await page.waitForTimeout(300);
  check('a setting is one switch call', JSON.stringify(await log(page)) === JSON.stringify(['switch.turn_off:auto_keep_warm']), await log(page)); await ctx.close(); }
// 3. three languages: no key shown raw, nothing cut
for (const lang of ['ru', 'en', 'ro']) for (const scenario of ['idle', 'cooking', 'offline']) for (const [w, h, dev] of [[360, 792, '13R'], [1070, 764, 'pad']]) { const { page, ctx } = await open({ w, h, lang, scenario });
  const text = await page.locator(SHEET).innerText(); check(`no raw key ${lang}/${scenario}/${dev}`, !/module\.|\{[a-z]+\}/.test(text), text.match(/module\.\S+|\{[a-z]+\}/)?.[0]);
  const l = await layout(page, SHEET); check(`layout ${lang}/${scenario}/${dev}`, !l.length, l); if (lang !== 'ru') await page.screenshot({ path: resolve(out, `lang-${lang}-${dev}-${scenario}.png`) }); await ctx.close(); }
await browser.close(); stop(fails.length ? 1 : 0);
