// The Security card and panel in one run, in the shared card preview (its host records every command and reaches nothing): layout on every
// device and orientation in both themes, accessibility (axe), console errors, touch targets, every scenario, the commands each control sends
// (and only on a tap), the admin settings, three languages.
// usage: node scripts/qa-security.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/security'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
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
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'disarmed', hash = '#security' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=security&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  await page.waitForSelector(hash === '#home' ? '.at-sec-tile' : '.at-sec-panel'); await page.waitForTimeout(250);
  return { page, ctx, errors };
}
const runAxe = async (page, scope) => { await page.addScriptTag({ content: axe }); return page.evaluate(async sc => { const r = await window.axe.run(document.querySelector(sc), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }); return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`); }, scope); };
const small = page => page.evaluate(() => [...document.querySelectorAll('.at-sec-panel button, .at-sec-panel input')].filter(b => b.offsetWidth && (b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)).map(b => `${(b.getAttribute('aria-label') || b.textContent || b.type).trim().slice(0, 24)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`));
const log = page => page.evaluate(() => window.atomPreview.host.log.map(x => `${x.domain}.${x.service}`));
// 1. every device × both themes: the panel at rest and in alarm, the home tile
for (const theme of ['light', 'dark']) for (const [w, h, dev] of DEVICES) for (const scenario of ['disarmed', 'triggered']) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario }), tag = `${dev}/${theme}/${scenario}`;
  const l = await layout(page, '.at-sec-panel'); check(`layout ${tag}`, !l.length, l);
  const s = await small(page); check(`targets ${tag}`, !s.length, s);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`no sideways scroll ${tag}`, over <= 0, over);
  const tabs = await page.evaluate(() => { const bar = document.querySelector('.ah-segments.is-sys'); if (!bar) return 'no bar'; const b = [...bar.querySelectorAll('button')].map(x => x.getBoundingClientRect()); return b.slice(1).every((r, i) => r.left >= b[i].right - 0.5) && !!bar.querySelector('.is-active') ? 'ok' : 'overlap'; });
  check(`system tabs never overlap ${tag}`, tabs === 'ok', tabs);
  if (['13R', 'pad', 'mac'].includes(dev)) { const a = await runAxe(page, '.at-sec-panel'); check(`axe ${tag}`, !a.length, a); }
  if (['13R', 'pad'].includes(dev)) await page.screenshot({ path: `${out}/${dev}-${theme}-${scenario}.png`, fullPage: true });
  check(`errors ${tag}`, !errors.length, errors); check(`no command ${tag}`, !(await log(page)).some(x => !x.startsWith('ws.')), await log(page)); await ctx.close();
}
for (const theme of ['light', 'dark']) for (const [w, h, dev] of [[360, 792, '13R'], [1070, 764, 'pad'], [1920, 1080, 'hd']]) for (const scenario of ['away', 'leak']) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario, hash: '#home' }), tag = `home ${dev}/${theme}/${scenario}`;
  const l = await layout(page, '.at-sec-tile'); check(`layout ${tag}`, !l.length, l);
  const a = await runAxe(page, '.at-sec-tile'); check(`axe ${tag}`, !a.length, a);
  check(`one tile tells leaks and openings ${tag}`, await page.evaluate(() => !document.querySelector('.ah-face .ah-tile [data-icon="water"], .ah-face .ah-tile [data-icon="door"]')));
  check(`errors ${tag}`, !errors.length, errors); await ctx.close();
}
// 2. every scenario, three languages: the words it must say
const SAY = { triggered: /Тревога!/, leak: /Протечка!/, gas: /Утечка газа!/, vacation: /Отпуск/, arming: /Постановка/, pending: /Вход/, guard: /Охрана/, away: /Не дома/, disarmed: /Снято с охраны/ };
for (const scenario of SCEN) for (const lang of ['ru', 'en', 'ro']) {
  const { page, ctx, errors } = await open({ lang, scenario }), tag = `${scenario}/${lang}`;
  const l = await layout(page, '.at-sec-panel'); check(`layout ${tag}`, !l.length, l); check(`errors ${tag}`, !errors.length, errors);
  const text = await page.locator('.at-sec-hero').innerText();
  if (lang === 'ru' && SAY[scenario]) check(`says it ${tag}`, SAY[scenario].test(text), text.slice(0, 120));
  check(`no raw keys ${tag}`, !/\bsec\.[a-z]/.test(await page.locator('.at-sec-panel').innerText()));
  await ctx.close();
}
// 3. the controls: each sends its own command, only on a tap
const tapSends = async (scenario, sel, want, label) => {
  const { page, ctx, errors } = await open({ scenario }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  await page.locator(sel).first().click(); await page.waitForTimeout(300);
  const l = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => ({ c: `${x.domain}.${x.service}`, id: x.data?.entity_id })));
  check(`${label} sends ${want}`, l.length === 1 && l[0].c === want, l); check(`errors ${label}`, !errors.length, errors); await ctx.close();
};
await tapSends('disarmed', '.at-sec-main', 'alarm_control_panel.alarm_arm_home', 'arm button');
await tapSends('away', '.at-sec-main', 'alarm_control_panel.alarm_disarm', 'disarm button');
await tapSends('disarmed', '.at-sec-mode.is-switch >> nth=0', 'input_boolean.turn_on', 'guests switch');
await tapSends('disarmed', '.at-sec-mode.is-switch >> nth=1', 'alarm_control_panel.alarm_arm_vacation', 'vacation switch on');
await tapSends('vacation', '.at-sec-mode.is-switch >> nth=1', 'alarm_control_panel.alarm_disarm', 'vacation switch off');
await tapSends('leak', '.at-sec-valve .hm-pill', 'valve.open_valve', 'valve button');
await tapSends('disarmed', '.at-sec-set .at-sec-sw-btn >> nth=0', 'input_boolean.turn_off', 'exercise switch');
// 4. the settings: the vacation list edits the label in the registry; a refusal shows, the switch stays as it was
{ const { page, ctx } = await open({ scenario: 'disarmed' });
  const before = await page.locator('.at-sec-set-loads .at-sec-sw-btn').first().getAttribute('aria-checked');
  await page.locator('.at-sec-set-loads .at-sec-sw-btn').first().click(); await page.waitForTimeout(300);
  const ws = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain === 'ws').map(x => x.service));
  check('vacation list asks the registry', ws.includes('config/entity_registry/get'), ws);
  check('a refused save is told', await page.locator('.at-sec-err').count() === 1);
  check('a refused save leaves the switch', (await page.locator('.at-sec-set-loads .at-sec-sw-btn').first().getAttribute('aria-checked')) === before);
  const n = await page.locator('.at-sec-set-loads li').count(); check('13 sockets listed', n === 13, n);
  const kept = await page.locator('.at-sec-set-loads .at-sec-sw-btn[aria-checked="true"]').count(); check('5 kept by default', kept === 5, kept);
  await ctx.close(); }
stop(fails.length ? 1 : 0);
