// The kettle card and sheet in one run, in the shared card preview (its host records every command and reaches nothing): layout on every
// device and orientation in both themes, accessibility (axe), console errors, touch targets, every scenario, the commands each control sends
// (and only on a tap), the admin settings, three languages.
// usage: node scripts/qa-security.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/kettle'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = (p => p === 5060 || p === 5061 ? 5062 : p)(4800 + Math.floor(Math.random() * 400));
const server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 260)}`); };
const stop = code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [1024, 768, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd']];
const SCEN = ['disarmed', 'away', 'arming', 'armedOpen', 'pending', 'triggered', 'guard', 'guests', 'vacation', 'leak', 'gas', 'tamper'];
// the camera previews ask for frames the preview does not serve: those 404s are the preview's, not the card's
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'disarmed', hash = '#home?device=kettle' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=kettle&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  await page.waitForSelector(hash === '#home' ? '[data-module-card="kettle"]' : '.at-kt-sheet'); await page.waitForTimeout(250);
  return { page, ctx, errors };
}
const runAxe = async (page, scope) => { await page.addScriptTag({ content: axe }); return page.evaluate(async sc => { const r = await window.axe.run(document.querySelector(sc), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }); return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`); }, scope); };
const small = page => page.evaluate(() => [...document.querySelectorAll('.at-kt-sheet button, .at-kt-sheet input')].filter(b => b.offsetWidth && (b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)).map(b => `${(b.getAttribute('aria-label') || b.textContent || b.type).trim().slice(0, 24)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`));
const log = page => page.evaluate(() => window.atomPreview.host.log.map(x => `${x.domain}.${x.service}`));

// 1. every device x both themes: the kettle sheet, its settings (the gear), the home tile
for (const theme of ['light', 'dark']) for (const [w, h, dev] of DEVICES) for (const scenario of ['idle', 'heating', 'keep']) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario }), tag = `${dev}/${theme}/${scenario}`;
  const l = await layout(page, '.at-kt-sheet'); check(`layout ${tag}`, !l.length, l);
  const s = await small(page); check(`targets ${tag}`, !s.length, s);
  if (['13R', 'pad', 'mac'].includes(dev)) { const a = await runAxe(page, '.at-kt-sheet'); check(`axe ${tag}`, !a.length, a); }
  await page.locator('.at-kt-mode-hit').first().click(); await page.waitForTimeout(250);
  const lo = await layout(page, '.at-kt-sheet'); check(`layout open mode ${tag}`, !lo.length, lo);
  await page.locator('.at-kt-gear').click(); await page.waitForTimeout(250);
  check(`gear opens settings ${tag}`, await page.locator('.at-kt-sheet.is-settings').count() === 1);
  const ls = await layout(page, '.at-kt-sheet'); check(`layout settings ${tag}`, !ls.length, ls);
  const ss = await small(page); check(`targets settings ${tag}`, !ss.length, ss);
  if (['13R', 'pad'].includes(dev)) { const a = await runAxe(page, '.at-kt-sheet'); check(`axe settings ${tag}`, !a.length, a); }
  await page.locator('.at-kt-back').click(); await page.waitForTimeout(200);
  check(`back returns ${tag}`, await page.locator('.at-kt-sheet:not(.is-settings)').count() === 1);
  check(`errors ${tag}`, !errors.length, errors); check(`no command ${tag}`, !(await log(page)).some(x => !x.startsWith('ws.')), await log(page)); await ctx.close();
}
for (const theme of ['light', 'dark']) for (const [w, h, dev] of [[360, 792, '13R'], [1070, 764, 'pad'], [1920, 1080, 'hd']]) for (const scenario of ['idle', 'heating', 'offline']) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario, hash: '#home' }), tag = `home ${dev}/${theme}/${scenario}`;
  const l = await layout(page, '[data-module-card="kettle"]'); check(`layout ${tag}`, !l.length, l);
  const a = await runAxe(page, '[data-module-card="kettle"]'); check(`axe ${tag}`, !a.length, a);
  check(`no «function …» tiles ${tag}`, !(await page.locator('.ah-tile', { hasText: 'function' }).count()));
  check(`errors ${tag}`, !errors.length, errors); await ctx.close();
}
// 2. the commands, only on a tap (MIOT: number + switch); the scenarios in three languages
const sends = async (scenario, steps, label, want) => { const { page, ctx } = await open({ scenario }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  for (const st of steps) { await page.locator(st).first().click(); await page.waitForTimeout(250); }
  const l = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => `${x.domain}.${x.service}`)); check(`${label}`, JSON.stringify(l) === JSON.stringify(want), l); await ctx.close(); };
await sends('idle', ['.at-kt-mode-hit >> nth=1', '.at-kt-go'], 'boil: target, keep-warm off, power on', ['number.set_value', 'switch.turn_off', 'switch.turn_on']);
await sends('idle', ['.at-kt-mode-hit >> nth=2', '.at-kt-go'], 'warm water: target, keep temp, keep time, keep-warm on, power on', ['number.set_value', 'number.set_value', 'number.set_value', 'switch.turn_on', 'switch.turn_on']);
await sends('heating', ['.at-kt-stop'], 'stop presses the kettle\'s stop', ['button.press']);
await sends('idle', ['.at-kt-gear', '.at-kt-set .at-kt-sw >> nth=0'], 'settings switch', ['switch.turn_on']);
for (const scenario of Object.keys({ idle: 1, heating: 1, boil: 1, keep: 1, lifted: 1, knob: 1, offline: 1 })) for (const lang of ['ru', 'en', 'ro']) {
  const { page, ctx, errors } = await open({ lang, scenario }), tag = `${scenario}/${lang}`;
  const l = await layout(page, '.at-kt-sheet'); check(`layout ${tag}`, !l.length, l); check(`errors ${tag}`, !errors.length, errors);
  check(`no raw keys ${tag}`, !/module\.kettle\./.test(await page.locator('.at-kt-sheet').innerText()));
  if (scenario === 'lifted' || scenario === 'offline') check(`start disabled ${tag}`, await page.locator('.at-kt-mode-hit').first().click().then(() => page.locator('.at-kt-go').isDisabled()));
  await ctx.close();
}
stop(fails.length ? 1 : 0);
