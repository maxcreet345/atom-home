// The Security card and panel in one run, in the shared card preview (its host records every command and reaches nothing): layout on every
// device and orientation in both themes, accessibility (axe), console errors, touch targets, every scenario, the commands each control sends
// (and only on a tap), the admin settings, three languages.
// usage: node scripts/qa-security.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const SAID = '.hm-announce'; // the shell's urgent live region: where an alarm, a leak, gas and the entry delay are announced (round 2)
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/security'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = await freePort();
const server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 260)}`); };
const stop = code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [1024, 768, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd']];
const SCEN = ['disarmed', 'away', 'arming', 'armedOpen', 'pending', 'triggered', 'guard', 'guests', 'vacation', 'leak', 'gas', 'tamper', 'silent'];
// the camera previews ask for frames the preview does not serve: those 404s are the preview's, not the card's
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'disarmed', hash = '#security', tz = 'Europe/Chisinau', init = null, shadow = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: tz }), page = await ctx.newPage(), errors = []; if (init) await ctx.addInitScript(init);
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=security&scenario=${scenario}&theme=${theme}&lang=${lang}${shadow ? '&shadow=1' : ''}${hash}`); await page.waitForFunction(() => window.ready);
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
  const tabs = await page.evaluate(() => { const bar = document.querySelector('.ah-segments.is-sys'); if (!bar) return 'no bar'; const b = [...bar.querySelectorAll('button')].map(x => x.getBoundingClientRect()); const hit = (x, y) => x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5; /* the bar may wrap into rows on a phone: an overlap is two buttons whose rectangles intersect, in a row or across rows */ return b.every((x, i) => x.width > 0 && b.slice(i + 1).every(y => !hit(x, y))) && !!bar.querySelector('.is-active') ? 'ok' : 'overlap'; });
  // since 1.27.0 «Безопасность» is a page of its own: no tabs over it; the tabs of «Устройства» are checked where they are
  check(`«Безопасность» is a page of its own, no tabs over it ${tag}`, tabs === 'no bar', tabs);
  await page.evaluate(() => { location.hash = '#systems'; }); await page.waitForTimeout(350);
  const devTabs = await page.evaluate(() => { const bar = document.querySelector('.ah-segments.is-sys'); if (!bar) return 'no bar'; const b = [...bar.querySelectorAll('button')].map(x => x.getBoundingClientRect()); const hit = (x, y) => x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5; return b.every((x, i) => x.width > 0 && b.every((y, j) => i === j || !hit(x, y))) && !!bar.querySelector('.is-active') ? 'ok' : b.map(x => [Math.round(x.left), Math.round(x.top), Math.round(x.width)]); });
  check(`the tabs of «Устройства» never overlap ${tag}`, devTabs === 'ok', devTabs);
  await page.evaluate(() => { location.hash = '#security'; }); await page.waitForTimeout(350);
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
// the feed reads HA's logbook (a WebSocket read), the device cards open in place
const SAY = { triggered: /Тревога!/, leak: /Протечка!/, gas: /Утечка газа!/, vacation: /Отпуск/, arming: /Постановка/, pending: /Вход/, guard: /Охрана/, away: /Не дома/, disarmed: /Снято с охраны/ };
for (const scenario of SCEN) for (const lang of ['ru', 'en', 'ro']) {
  const { page, ctx, errors } = await open({ lang, scenario }), tag = `${scenario}/${lang}`;
  const l = await layout(page, '.at-sec-panel'); check(`layout ${tag}`, !l.length, l); check(`errors ${tag}`, !errors.length, errors);
  const text = await page.locator('.at-osec-control').innerText();
  if (lang === 'ru' && SAY[scenario]) check(`says it ${tag}`, SAY[scenario].test(text), text.slice(0, 120));
  check(`no raw keys ${tag}`, !/\bsec\.[a-z]/.test(await page.locator('.at-sec-panel').innerText()));
  await ctx.close();
}
// 3. the controls (audit 2026-11-09, docs/SECURITY.md): arming is one tap; disarming, «Отпуск» both ways and opening the water ask first,
// the safe choice focused; nothing leaves on the first tap of a dangerous control, one command leaves on «yes»
const sent = page => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => ({ c: `${x.domain}.${x.service}`, id: x.data?.entity_id, data: x.data })));
const tapSends = async (scenario, sel, want, label) => {
  const { page, ctx, errors } = await open({ scenario }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  await page.locator(sel).first().click(); await page.waitForTimeout(300);
  const l = await sent(page);
  check(`${label} sends ${want || 'nothing'}`, want ? l.length === 1 && l[0].c === want : l.length === 0, l); check(`errors ${label}`, !errors.length, errors); await ctx.close();
};
/** a dangerous control: the tap sends nothing and asks; Escape and «no» send nothing and return the focus; «yes» sends exactly `want` */
const asks = async (scenario, sel, want, label, { text, safe, fill } = {}) => {
  const { page, ctx, errors } = await open({ scenario }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  const btn = page.locator(sel).first(); await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(250);
  check(`${label}: the first tap sends nothing`, (await sent(page)).length === 0, await sent(page));
  check(`${label}: a question is shown`, await page.locator('.at-sec-ask').count() === 1);
  const q = await page.locator('.at-sec-ask').innerText().catch(() => '');
  if (text) check(`${label}: the question says ${text}`, text.test(q), q);
  check(`${label}: the safe choice has the focus`, await page.evaluate(() => document.activeElement?.classList.contains('at-sec-ask-no')), await page.evaluate(() => document.activeElement?.textContent));
  if (safe) check(`${label}: the safe choice is «${safe}»`, (await page.locator('.at-sec-ask-no').innerText()) === safe);
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  check(`${label}: Escape closes it, nothing sent, focus back on the control`, await page.locator('.at-sec-ask').count() === 0 && (await sent(page)).length === 0 && await btn.evaluate(e => e === document.activeElement));
  await btn.click(); await page.waitForTimeout(200); await page.locator('.at-sec-ask-no').click(); await page.waitForTimeout(200);
  check(`${label}: «no» sends nothing`, (await sent(page)).length === 0 && await page.locator('.at-sec-ask').count() === 0);
  await btn.click(); await page.waitForTimeout(200); if (fill) await page.locator('.at-sec-ask input[type=date]').fill(fill);
  const small = await page.evaluate(() => [...document.querySelectorAll('.at-sec-ask button, .at-sec-ask input')].filter(b => b.getBoundingClientRect().height < 43.5).length); check(`${label}: the question's controls are 44 px`, small === 0, small);
  await page.locator('.at-sec-ask-yes').click(); await page.waitForTimeout(350);
  const l = await sent(page); check(`${label}: «yes» sends ${want.join(' + ')}`, l.length === want.length && want.every((w, i) => l[i].c === w), l);
  check(`errors ${label}`, !errors.length, errors); await ctx.close(); return l;
};
await tapSends('disarmed', '.at-sec-main', 'alarm_control_panel.alarm_arm_home', 'arm key (one tap)');
await tapSends('arming', '.at-sec-disarm', 'alarm_control_panel.alarm_disarm', 'cancelling the exit delay (one tap)');
await asks('away', '.at-sec-disarm', ['alarm_control_panel.alarm_disarm'], 'disarm', { text: /Снять дом с охраны\?/ });
await asks('pending', '.at-sec-disarm', ['alarm_control_panel.alarm_disarm'], 'disarm in the entry delay');
await tapSends('disarmed', '.at-osec-group.is-btn >> nth=0', 'input_boolean.turn_on', 'guests switch');
// CODEX-011 (was: «yes» without a date sent the arming alone and left the helper's old date): the house's «no date» is written first
{ const l = await asks('disarmed', '.at-osec-group.is-btn >> nth=1', ['input_datetime.set_datetime', 'alarm_control_panel.alarm_arm_vacation'], '«Отпуск» on', { text: /кран воды закроется, розетки из списка выключатся/ });
  check('«Отпуск» on without a date: the house\'s «no date» goes to the helper before arming', l[0]?.id === 'input_datetime.heating_vacation_return' && l[0]?.data?.datetime === '2099-12-31 00:00:00', l[0]); }
{ const l = await asks('disarmed', '.at-osec-group.is-btn >> nth=1', ['input_datetime.set_datetime', 'alarm_control_panel.alarm_arm_vacation'], '«Отпуск» on with a return date', { fill: '2031-01-15' });
  check('the return date goes to the helper before arming', l[0]?.id === 'input_datetime.heating_vacation_return' && l[0]?.data?.datetime === '2031-01-15 00:00:00', l[0]); }
await asks('vacation', '.at-osec-group.is-btn >> nth=1', ['alarm_control_panel.alarm_disarm'], '«Отпуск» off', { text: /Дом снимется с охраны/ });
await asks('vacation', '.at-sec-valve-btn', ['valve.open_valve'], 'opening the water', { text: /Вода пойдёт сразу/, safe: 'Отмена' });
await asks('leak', '.at-sec-valve-btn', ['valve.open_valve'], 'opening the water during a leak', { text: /^Сейчас протечка: Ванная\. .*Вода пойдёт сразу/s, safe: 'Оставить закрытым' });
await tapSends('disarmed', '.at-sec-valve-btn', 'valve.close_valve', 'closing the water (one tap)');
{ const { page, ctx } = await open({ scenario: 'leak' }); await page.locator('.at-sec-valve-btn').click(); await page.waitForTimeout(200);
  check('during a leak the safe choice is the prominent button, opening is not', await page.evaluate(() => document.querySelector('.at-sec-ask-no').classList.contains('is-primary') && !document.querySelector('.at-sec-ask-yes').classList.contains('is-primary')));
  await page.locator('.at-sec-valve').screenshot({ path: `${out}/leak-valve-ask.png` }); await ctx.close(); }
await tapSends('disarmed', '.at-osec-dev-hit >> nth=1', '', 'device card opens without a command');
await tapSends('disarmed', '.at-sec-set .at-sec-sw-btn >> nth=0', 'input_boolean.turn_off', 'exercise switch');
for (const theme of ['light', 'dark']) for (const [scenario, sel] of [['disarmed', '.at-osec-group.is-btn >> nth=1'], ['leak', '.at-sec-valve-btn'], ['silent', '.at-sec-main']]) for (const [w, h] of [[360, 792], [1070, 764]]) {
  const { page, ctx } = await open({ scenario, theme, w, h }); await page.locator(sel).first().click(); await page.waitForTimeout(250);
  const v = await runAxe(page, '.at-sec-ask'); check(`axe question ${scenario}/${theme}/${w}`, !v.length, v); const l = await layout(page, '.at-sec-panel'); check(`layout with the question ${scenario}/${theme}/${w}`, !l.length, l);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`no sideways scroll with the question ${scenario}/${theme}/${w}`, over <= 0, over); await ctx.close(); }
// 3a. a sensor that does not answer is never «закрыто» / «сухо»: the tile and the panel say it, the card is not calm, arming warns
{ const home = await open({ scenario: 'silent', hash: '#home' }), tile = home.page.locator('.at-sec-tile');
  check('silent: the tile is not calm', /\bis-warn\b/.test(await tile.getAttribute('class')), await tile.getAttribute('class'));
  check('silent: the tile names it', /Не отвечают датчики: 2/.test(await tile.innerText() + await tile.locator('button').getAttribute('aria-label')), await tile.innerText()); check('errors silent tile', !home.errors.length, home.errors); await home.ctx.close();
  const { page, ctx, errors } = await open({ scenario: 'silent' }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  const ctl = await page.locator('.at-osec-control').innerText(), devs = await page.locator('.at-osec-devs').innerText();
  check('silent: the panel does not say «Дверь и окна закрыты»', !/Дверь и окна закрыты/.test(ctl) && /Не отвечают датчики: 2/.test(ctl), ctl.slice(0, 160));
  check('silent: the list says «не отвечают: 2», not «всё закрыто»', /не отвечают: 2/.test(devs) && !/всё закрыто/.test(devs), devs.slice(0, 120));
  check('silent: the window and the gas say «не отвечает»', (devs.match(/не отвечает(?!:)/gi) ?? []).length === 2 && !/ждёт первого срабатывания[\s\S]*Газ|Газ[\s\S]{0,40}ждёт первого/.test(devs), devs.slice(0, 400));
  check('silent: the hero is amber, not calm green', await page.evaluate(() => document.querySelector('.at-osec-control').classList.contains('is-warn') && document.querySelector('.at-osec-control > .at-osec-ring').classList.contains('is-warn')));
  await page.locator('.at-sec-main').click(); await page.waitForTimeout(250);
  check('silent: arming warns first and sends nothing', (await sent(page)).length === 0 && /Не отвечают датчики: 2\. Охрана их не увидит/.test(await page.locator('.at-sec-ask').innerText().catch(() => '')));
  await page.locator('.at-sec-ask-yes').click(); await page.waitForTimeout(300); const l = await sent(page);
  check('silent: …and arms on «yes»', l.length === 1 && l[0].c === 'alarm_control_panel.alarm_arm_home', l); check('errors silent', !errors.length, errors); await ctx.close(); }
// 3b. the countdown ticks every second and reads m:ss; alarms are announced; a tamper makes the panel amber like the tile
{ const { page, ctx } = await open({ scenario: 'pending' }); const read = () => page.locator('.at-osec-count').innerText();
  const a = await read(); await page.waitForTimeout(2300); const b = await read(), sec = x => { const m = x.match(/(\d+):(\d\d)/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  check('the entry delay counts down every second', /· \d:[0-5]\d$/.test(a) && sec(a) - sec(b) >= 2 && sec(a) - sec(b) <= 3, [a, b]);
  check('the countdown is a timer', await page.locator('.at-osec-count[role=timer]').count() === 1);
  check('the entry delay is announced', /Вход — снимите охрану/.test(await page.locator(SAID).innerText())); await ctx.close();
  const home = await open({ scenario: 'pending', hash: '#home', w: 360, h: 792 }); check('the phone tile carries the seconds of the entry delay', /^Вход\u00a0\d:[0-5]\d$/.test(await home.page.locator('.at-sec-tile-word').innerText()), await home.page.locator('.at-sec-tile-word').innerText()); await home.ctx.close(); }
// round 2 (f48, logic half): the word and its seconds are one unbreakable text — «Постановка 1:13» never puts the seconds on a line of their own
for (const [w, h] of [[1070, 764], [764, 1070], [1440, 900]]) { const home = await open({ scenario: 'arming', hash: '#home', w, h }); const word = await home.page.evaluate(() => { const e = document.querySelector('.at-sec-tile-word'), r = document.createRange(); r.selectNodeContents(e); return { text: e.textContent, nodes: e.childNodes.length, lines: new Set([...r.getClientRects()].map(x => Math.round(x.top))).size }; });
  check(`arming: the tile's word and seconds stay on one line ${w}`, /^Постановка\u00a0\d:[0-5]\d$/.test(word.text) && word.nodes === 1 && word.lines === 1, word); await home.ctx.close(); }
for (const [scenario, re] of [['triggered', /Тревога!/], ['leak', /Протечка!/], ['gas', /Утечка газа!/], ['tamper', /Вскрыт корпус датчика/]]) for (const hash of ['#security', '#home']) {
  const { page, ctx } = await open({ scenario, hash }); const live = await page.locator(SAID).innerText();
  check(`announced ${scenario} ${hash}`, re.test(live), live); await ctx.close(); }
// round 2 (f43): the alarm is said ONCE, by the shell's urgent live region, on every page — the tile and the panel no longer carry a role=alert of their own that repeated it
{ const { page, ctx } = await open({ scenario: 'triggered', hash: '#home' }); check('the alarm is announced by the shell only (no second role=alert in the tile)', await page.evaluate(() => document.querySelectorAll('.at-sec-tile [role=alert], .at-sec-panel .at-vh[role=alert]').length === 0 && /Тревога!/.test(document.querySelector('.hm-announce').textContent))); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'disarmed' }); check('a calm house announces nothing', (await page.locator(SAID).innerText()) === ''); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'tamper' }); check('tamper: the panel is amber like the tile', await page.evaluate(() => document.querySelector('.at-osec-control').classList.contains('is-warn') && document.querySelector('.at-osec-control > .at-osec-ring').classList.contains('is-warn') && !!document.querySelector('.at-osec-name small.at-sec-say-warn'))); await ctx.close(); }
// 3c. no connection: nothing is sent, the buttons are off, the panel says its data is old; a refusal is said in words; a double tap is one command
{ const { page, ctx, errors } = await open({ scenario: 'away' }); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(200);
  const off = await page.evaluate(() => [...document.querySelectorAll('.at-osec-key, .at-osec-group.is-btn, .at-sec-valve-btn')].every(b => b.disabled));
  check('offline: every command button is off', off); check('offline: the panel says the data is from before', /данные на момент потери связи/.test(await page.locator('.at-osec-control').innerText()));
  await page.locator('.at-sec-disarm').click({ force: true }).catch(() => {}); await page.waitForTimeout(200); check('offline: nothing is sent', (await sent(page)).length === 0, await sent(page));
  await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForTimeout(200); check('online again: the buttons are back', await page.locator('.at-sec-disarm').isEnabled()); check('errors offline', !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.locator('.at-sec-main').click(); await page.waitForTimeout(400);
  const e = await page.locator('.at-osec-control .at-sec-err').innerText().catch(() => '');
  check('a refused command is said in words', /^Не получилось: \S/.test(e) && !/object Object|preview:/.test(e), e); check('no unhandled rejection after a refusal', !errors.length, errors); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'disarmed' }); await page.evaluate(() => { window.atomPreview.host.setAccept(true); window.atomPreview.host.setDelay(900); });
  await page.locator('.at-sec-main').dblclick(); await page.waitForTimeout(250); const mid = await page.evaluate(() => { const b = document.querySelector('.at-sec-main'); return { busy: b.getAttribute('aria-busy'), off: b.getAttribute('aria-disabled'), hard: b.disabled }; });
  await page.locator('.at-sec-main').click({ force: true }).catch(() => {}); await page.waitForTimeout(1200); const l = await sent(page);
  // round 2 (f0/f69): a waiting control is `aria-disabled` + `aria-busy` and ignores the press; a real `disabled` would drop the keyboard's focus
  check('a double tap on «Под охрану» is one command', l.length === 1, l); check('…and the button waits meanwhile (aria-disabled, not disabled)', mid.busy === 'true' && mid.off === 'true' && mid.hard === false, mid); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'leak' }); const names = await page.evaluate(() => [...document.querySelectorAll('.at-sec-panel button')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(n => /^(Закрыть|Открыть)$/.test(n)));
  check('the valve button is named with the valve', names.length === 0 && /^Кран воды: /.test(await page.locator('.at-sec-valve-btn').getAttribute('aria-label')), names); await ctx.close(); }
// 3d. round 2 of the audit (10.11.2026)
const ALARM = 'alarm_control_panel.alarmo', active = page => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}.${a.className}` : ''; });
// f0/f69: the keyboard's focus stays on the pressed key while its command is on its way, and moves to the other key when the new state switches the pressed one off
{ const { page, ctx, errors } = await open({ scenario: 'disarmed', w: 1440, h: 900 }); await page.evaluate(() => { window.atomPreview.host.setAccept(true); window.atomPreview.host.setDelay(600); });
  await page.locator('.at-sec-main').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  check('keyboard: the focus stays on «Под охрану» while it waits', /at-sec-main/.test(await active(page)), await active(page));
  await page.waitForTimeout(900); check('keyboard: …and after the house answered', /at-sec-main/.test(await active(page)) && (await sent(page)).length === 1, [await active(page), await sent(page)]);
  await page.keyboard.press('Enter'); await page.waitForTimeout(150); check('keyboard: a press on the waiting key sends nothing more', (await sent(page)).length === 1, await sent(page));
  await page.evaluate(id => window.atomPreview.setStates({ [id]: 'armed_home' }), ALARM); await page.waitForTimeout(300);
  check('keyboard: armed — the focus is on «С охраны», not lost', /at-sec-disarm/.test(await active(page)), await active(page)); check('errors keyboard focus', !errors.length, errors); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'disarmed', w: 1440, h: 900 }); await page.evaluate(() => { window.atomPreview.host.setAccept(true); window.atomPreview.host.setDelay(500); });
  for (const [sel, name] of [['.at-osec-group.is-btn >> nth=0', '«Гости»'], ['.at-sec-valve-btn', 'the valve\'s «Закрыть»'], ['.at-sec-set .at-sec-sw-btn >> nth=0', 'the exercise switch']]) { const b = page.locator(sel).first(); await b.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const st = await b.evaluate(e => ({ here: e === document.activeElement, hard: e.disabled, soft: e.getAttribute('aria-disabled'), busy: e.getAttribute('aria-busy') })); check(`keyboard: the focus stays on ${name} while it waits`, st.here && !st.hard && st.soft === 'true' && st.busy === 'true', st); await page.waitForTimeout(700); }
  await ctx.close(); }
// l85: while the house is being armed the water can still be shut — a command waits for its own answer only
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  await page.locator('.at-sec-main').click(); await page.waitForTimeout(300); const v = page.locator('.at-sec-valve-btn');
  const mid = await page.evaluate(() => ({ arm: document.querySelector('.at-sec-main').getAttribute('aria-busy'), valve: document.querySelector('.at-sec-valve-btn').getAttribute('aria-disabled'), hard: document.querySelector('.at-sec-valve-btn').disabled, guests: document.querySelector('.at-osec-group.is-btn').getAttribute('aria-disabled') }));
  check('while arming waits, the valve\'s «Закрыть» and «Гости» are free', mid.arm === 'true' && mid.valve === null && mid.hard === false && mid.guests === null, mid);
  await v.click(); await page.waitForTimeout(300); const l = await sent(page);
  check('…and «Закрыть» shuts the water at once', l.length === 2 && l[1].c === 'valve.close_valve', l); check('errors l85', !errors.length, errors); await ctx.close(); }
// f23: a valve that does not answer says so and gets no command; `unknown` still may be shut
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(() => { window.atomPreview.host.setAccept(true); window.atomPreview.setStates({ 'valve.bath_water': 'unavailable' }); }); await page.waitForTimeout(250);
  const card = await page.locator('.at-sec-valve').innerText(), st = await page.evaluate(() => ({ off: document.querySelector('.at-sec-valve-btn').disabled, warn: document.querySelector('.at-sec-valve .at-osec-now').classList.contains('is-warn') }));
  check('an unavailable valve says «Кран не отвечает», amber, its button is off', /Кран не отвечает/.test(card) && st.off && st.warn, [card, st]);
  await page.locator('.at-sec-valve-btn').click({ force: true }).catch(() => {}); await page.waitForTimeout(250); check('…and nothing is sent to it', (await sent(page)).length === 0, await sent(page));
  await page.screenshot({ path: `${out}/valve-offline.png` });
  await page.evaluate(() => window.atomPreview.setStates({ 'valve.bath_water': 'unknown' })); await page.waitForTimeout(250);
  check('a valve in `unknown` says «нет данных» and may still be shut', /нет данных/i.test(await page.locator('.at-sec-valve').innerText()) && await page.locator('.at-sec-valve-btn').isEnabled()); check('errors f23', !errors.length, errors); await ctx.close(); }
// l2: the «Уведомления» strip is a group of pressed buttons, like the other strips — no tabs without arrows and a tabpanel
{ const { page, ctx } = await open({ scenario: 'disarmed' }); const strip = page.locator('.at-osec-feed .at-osec-chips');
  const a = await strip.evaluate(g => ({ role: g.getAttribute('role'), name: g.getAttribute('aria-label'), pressed: [...g.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')), tabs: g.querySelectorAll('[role=tab],[aria-selected]').length }));
  check('the feed strip is role=group with aria-pressed buttons', a.role === 'group' && a.name === 'Уведомления' && a.pressed.join() === 'true,false,false' && a.tabs === 0, a);
  await strip.locator('button[aria-pressed]', { hasText: 'Тревоги' }).click(); await page.waitForTimeout(150);
  check('…and the pressed one follows the choice', (await strip.evaluate(g => [...g.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')).join())) === 'false,true,false');
  check('no tablist is left in the panel', await page.locator('.at-sec-panel [role=tablist], .at-sec-panel [role=tab]').count() === 0); await ctx.close(); }
// l164: Escape closes the question wherever the focus stands, gives the focus back, and the key ends there (in a shadow root too, as in the real HA)
for (const shadow of [false, true]) { const { page, ctx, errors } = await open({ scenario: 'away', shadow }); const btn = page.locator('.at-sec-disarm');
  await btn.click(); await page.waitForTimeout(250); await page.locator('.at-osec-devs .at-osec-chips button').first().focus();
  const seen = await page.evaluate(() => { window.__esc = []; window.addEventListener('keydown', e => { if (e.key === 'Escape') window.__esc.push(e.defaultPrevented); }); return true; });
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const back = await btn.evaluate(e => { const r = e.getRootNode(); return r.activeElement === e; });
  check(`Escape closes the question with the focus elsewhere, focus back on its opener${shadow ? ' (shadow)' : ''}`, seen && await page.locator('.at-sec-ask').count() === 0 && back && (await sent(page)).length === 0, [await page.locator('.at-sec-ask').count(), back]);
  check(`…and the shell does not see that Escape as its own${shadow ? ' (shadow)' : ''}`, (await page.evaluate(() => window.__esc)).every(Boolean), await page.evaluate(() => window.__esc));
  check(`…and the page stays${shadow ? ' (shadow)' : ''}`, /#security/.test(await page.evaluate(() => location.hash)) && await page.locator('.at-sec-panel').count() === 1); check(`errors l164 ${shadow}`, !errors.length, errors); await ctx.close(); }
// l56: a disarm question is withdrawn when the house was disarmed from another device
{ const { page, ctx, errors } = await open({ scenario: 'away' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); await page.locator('.at-sec-disarm').click(); await page.waitForTimeout(250);
  const asked = await page.locator('.at-sec-ask').count(); await page.evaluate(id => window.atomPreview.setStates({ [id]: 'disarmed' }), ALARM); await page.waitForTimeout(300);
  check('disarmed elsewhere: the open question is withdrawn, nothing sent', asked === 1 && await page.locator('.at-sec-ask').count() === 0 && (await sent(page)).length === 0, [asked, await page.locator('.at-sec-ask').count(), await sent(page)]); check('errors l56', !errors.length, errors); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'vacation' }); await page.locator('.at-sec-valve-btn').click(); await page.waitForTimeout(250); const asked = await page.locator('.at-sec-ask').count();
  await page.evaluate(() => window.atomPreview.setStates({ 'valve.bath_water': 'open' })); await page.waitForTimeout(300); check('the valve opened elsewhere: its question is withdrawn', asked === 1 && await page.locator('.at-sec-ask').count() === 0); await ctx.close(); }
// l147: a return date in the past, typed by keyboard, is said — «Отпуск» does not start without the date the person believes they set
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  await page.locator('.at-osec-group.is-btn >> nth=1').click(); await page.waitForTimeout(250); const date = page.locator('.at-sec-ask input[type=date]');
  await date.fill('2020-01-15'); await page.locator('.at-sec-ask-yes').click(); await page.waitForTimeout(300);
  const st = await page.evaluate(() => { const i = document.querySelector('.at-sec-ask input[type=date]'), e = document.querySelector('.at-sec-ask .at-sec-err'); return { open: !!i, invalid: i?.getAttribute('aria-invalid'), says: e?.textContent ?? '', linked: !!e && i?.getAttribute('aria-describedby') === e.id, role: e?.getAttribute('role'), focus: document.activeElement === i }; });
  check('a past return date: nothing is sent, the question stays', (await sent(page)).length === 0 && st.open, [await sent(page), st]);
  check('…the field is marked invalid, the reason is said and tied to it, the focus is in the field', st.invalid === 'true' && /уже прошла/.test(st.says) && st.linked && st.role === 'alert' && st.focus, st);
  await page.locator('.at-sec-ask').screenshot({ path: `${out}/vacation-past-date.png` });
  await date.fill(''); await page.waitForTimeout(100); check('…and the mark goes when the field is corrected', await page.locator('.at-sec-ask .at-sec-err').count() === 0 && (await date.getAttribute('aria-invalid')) === null);
  await page.locator('.at-sec-ask-yes').click(); await page.waitForTimeout(350); const l = await sent(page);
  // CODEX-011 (was: the arming alone): an emptied field is «no date» — written to the house as its «no date», then the arming
  check('an emptied field is «no date»: the house\'s «no date», then «Отпуск»', l.length === 2 && l[0].c === 'input_datetime.set_datetime' && l[0].data?.datetime === '2099-12-31 00:00:00' && l[1].c === 'alarm_control_panel.alarm_arm_vacation', l); check('errors l147', !errors.length, errors); await ctx.close(); }
// l47: the helper's date is a calendar date of the house — «до 23 ноября» from a browser west of UTC too
for (const tz of ['America/New_York', 'Pacific/Auckland']) { const { page, ctx } = await open({ scenario: 'vacation', tz }); const chip = await page.locator('.at-osec-group.is-btn >> nth=1').innerText();
  check(`«Отпуск до 23 ноября» in ${tz}`, /до 23 ноября/.test(chip), chip); await ctx.close(); }
// l54: the delay's seconds do not depend on the device's clock — a tablet five minutes behind (or ahead) does not show 5:18 (or 0:00)
for (const off of [-300000, 300000]) { const { page, ctx } = await open({ scenario: 'pending', init: `(() => { const R = Date, off = ${off}; class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })()` });
  const text = await page.locator('.at-osec-count').innerText().catch(() => ''), m = text.match(/(\d+):(\d\d)/), left = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  check(`the entry delay on a device whose clock is ${off / 60000} min off reads the real seconds`, left > 3 && left <= 30, text); await ctx.close(); }
// l119: a sensor that «не отвечает» shows no signal bars and no battery beside it
{ const { page, ctx } = await open({ scenario: 'silent' }); const rows = await page.evaluate(() => [...document.querySelectorAll('.at-osec-dev')].map(d => ({ now: d.querySelector('.at-osec-now')?.textContent ?? '', icons: d.querySelectorAll('.at-osec-icons .at-osec-bars, .at-osec-icons .at-osec-batt').length })));
  const silent = rows.filter(r => /^не отвечает$/i.test(r.now)), fine = rows.filter(r => /закрыто/i.test(r.now));
  check('silent sensors carry no bars and battery; the ones that answer do', silent.length === 2 && silent.every(r => r.icons === 0) && fine.length > 0 && fine.some(r => r.icons > 0), [silent, fine.slice(0, 2)]);
  await page.locator('.at-osec-dev-hit').first().click(); await page.waitForTimeout(150); const open1 = await page.locator('.at-osec-dev.is-open .at-osec-rows').innerText();
  check('…and its opened card lists no signal or battery either', !/Сигнал|Батарея/.test(open1), open1); await ctx.close(); }
// l58: the feed is read again when the link to the house returns
{ const { page, ctx, errors } = await open({ scenario: 'away' }); const reads = () => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain === 'ws' && x.service === 'logbook/get_events').length);
  const first = await reads(); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(250); const offline = await reads();
  await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForTimeout(350); const again = await reads();
  check('the feed asks the logbook once, not while offline, and again when the link returns', first === 1 && offline === 1 && again === 2, [first, offline, again]);
  check('…and still shows its events', await page.locator('.at-osec-ev').count() > 0); check('errors l58', !errors.length, errors); await ctx.close(); }
// l126: a refusal with the house's own reason is one sentence with one colon
{ const { page, ctx } = await open({ scenario: 'disarmed' }); await page.evaluate(() => window.atomPreview.setRefusal({ code: 'service_validation_error', message: 'Охрана занята' })); await page.locator('.at-sec-main').click(); await page.waitForTimeout(400);
  const e = await page.locator('.at-osec-control .at-sec-err').innerText().catch(() => '');
  check('a refusal with a reason has one colon', e === 'Дом отклонил команду: Охрана занята', e); await ctx.close(); }
// l5 / l98 / l158 / l166 / l195: no «Тревога!. …» for a screen reader, in the live region and in the tile's name
for (const lang of ['ru', 'en', 'ro']) for (const scenario of ['triggered', 'leak', 'gas', 'pending', 'tamper']) {
  const p = await open({ scenario, lang }), live = await p.page.locator(SAID).innerText(); await p.ctx.close();
  const h = await open({ scenario, lang, hash: '#home' }), name = await h.page.locator('.at-sec-tile .ah-tile-hit').getAttribute('aria-label'), tileLive = await h.page.locator(SAID).innerText(); await h.ctx.close();
  check(`no double punctuation ${scenario}/${lang}`, live.length > 5 && ![live, name, tileLive].some(x => /[!?.…]\s*\./.test(x)), [live, name]);
}
// l59 / l160: Romanian — the exercise line counts its days, the questions use one form of address, the mode has one name
{ const { page, ctx } = await open({ scenario: 'disarmed', lang: 'ro' }); const valve = await page.locator('.at-sec-valve').innerText(); check('ro: «profilaxie la 7 zile»', /profilaxie la 7 zile la 03:00/.test(valve), valve);
  await page.locator('.at-osec-group.is-btn >> nth=1').click(); await page.waitForTimeout(200); const q = await page.locator('.at-sec-ask').innerText();
  check('ro: the «Отпуск» question names the mode as its button does and addresses politely', /^Porniți «Concediu»\?/.test(q) && !/Vacanță/.test(q), q.slice(0, 80)); await ctx.close();
  const a = await open({ scenario: 'away', lang: 'ro' }); await a.page.locator('.at-sec-disarm').click(); await a.page.waitForTimeout(200); const d = await a.page.locator('.at-sec-ask p').innerText();
  check('ro: «Dezarmați casa?»', d === 'Dezarmați casa?', d); await a.ctx.close(); }
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
// ---- 5. release classic, step 4 (ported from design-2026 pass 3): ST-06, CODEX-011, CODEX-002, CODEX-010 — each fails on the classic build before ----
const UNKNOWN = { ru: 'Нет связи с охраной', en: 'Alarm offline', ro: 'Alarma fără legătură' }, AHEAD = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10), LATER = new Date(Date.now() + 39 * 864e5).toISOString().slice(0, 10);
const vacKey = page => page.locator('.at-osec-group.is-btn').nth(1);
// ST-06 acceptance 1: the alarm panel unavailable / unknown — «Отпуск» cannot be pressed (a press at its place asks nothing, writes no date, arms
// nothing); «Гости» and closing the water still go, one command each; the state line says why
for (const [theme, lang, st] of [['light', 'ru', 'unavailable'], ['light', 'ru', 'unknown'], ['dark', 'ru', 'unavailable'], ['light', 'en', 'unavailable'], ['dark', 'ro', 'unknown']]) {
  const { page, ctx, errors } = await open({ w: 320, h: 568, theme, lang, scenario: 'disarmed' }), tag = `${st} ${theme} ${lang} 320×568`;
  await page.evaluate(s => { window.atomPreview.host.setAccept(true); window.atomPreview.setStates({ [s[0]]: s[1] }); }, [ALARM, st]); await page.waitForTimeout(250);
  const vac = vacKey(page); await vac.scrollIntoViewIfNeeded(); const dis = await vac.evaluate(b => b.disabled), box = await vac.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(250); const asked = await page.locator('.at-sec-ask').count();
  await page.locator('.at-osec-group.is-btn').nth(0).click(); await page.waitForTimeout(250); await page.locator('.at-sec-valve-btn').click(); await page.waitForTimeout(300);
  const l = await sent(page), state = await page.locator('.at-osec-control .at-osec-state').innerText();
  check(`ST-06 ${tag}: «Отпуск» is disabled; a press asks nothing, writes no date, arms nothing`, dis && asked === 0 && !l.some(x => x.c === 'input_datetime.set_datetime' || x.c === 'alarm_control_panel.alarm_arm_vacation'), { dis, asked, l });
  check(`ST-06 ${tag}: «Гости» and closing the water still go, one command each`, l.length === 2 && l[0].c === 'input_boolean.turn_on' && l[1].c === 'valve.close_valve', l);
  check(`ST-06 ${tag}: the state says why («${UNKNOWN[lang]}»)`, state.trim() === UNKNOWN[lang], state); check(`errors ST-06 ${tag}`, !errors.length, errors);
  if (theme === 'dark' && lang === 'ro') await page.locator('.at-osec-control').screenshot({ path: `${out}/st06-unknown-320-dark-ro.png` }); await ctx.close(); }
// ST-06 acceptance 2: the alarm panel is lost while «Отпуск» asks — the question is withdrawn, the focus lands on the state line that says why, Enter
// sends nothing; when the panel is back «Отпуск» can be pressed again, and no question or command comes by itself
for (const [w, h, theme, lang] of [[320, 568, 'light', 'ru'], [568, 320, 'dark', 'ro']]) {
  const { page, ctx, errors } = await open({ w, h, theme, lang, scenario: 'disarmed' }), tag = `${w}×${h} ${theme} ${lang}`; await page.evaluate(() => window.atomPreview.host.setAccept(true));
  await vacKey(page).click(); await page.waitForTimeout(250); await page.locator('.at-sec-ask input[type=date]').fill(AHEAD, { timeout: 3000 }).catch(() => {});
  await page.evaluate(a => window.atomPreview.setStates({ [a]: 'unknown' }), ALARM); await page.waitForTimeout(350); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ asked: document.querySelectorAll('.at-sec-ask').length, focus: document.activeElement?.classList.contains('at-osec-state') ?? false, text: document.querySelector('.at-osec-control .at-osec-state')?.textContent ?? '' }));
  check(`ST-06 ${tag}: the alarm lost while «Отпуск» asks — the question goes, the focus is on the state line («${UNKNOWN[lang]}»), nothing is sent`, st.asked === 0 && st.focus && st.text === UNKNOWN[lang] && (await sent(page)).length === 0, [st, await sent(page)]);
  await page.evaluate(a => window.atomPreview.setStates({ [a]: 'disarmed' }), ALARM); await page.waitForTimeout(350);
  check(`ST-06 ${tag}: back — «Отпуск» can be pressed, no question and no command by themselves`, await vacKey(page).isEnabled() && await page.locator('.at-sec-ask').count() === 0 && (await sent(page)).length === 0, await sent(page));
  check(`errors ST-06 ${tag}`, !errors.length, errors); await ctx.close(); }
// ST-06 acceptance 3: one intent while it waits — one date write, then one arming; «Отпуск» shows on only when the house says so; a refused date
// write arms nothing, says why, frees the key, and a new intent works
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(() => { window.atomPreview.host.setAccept(true); window.atomPreview.host.setDelay(1500); });
  await vacKey(page).click(); await page.waitForTimeout(200); await page.locator('.at-sec-ask input[type=date]').fill(AHEAD, { timeout: 3000 }).catch(() => {}); await page.locator('.at-sec-ask-yes').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(300);
  const mid = await vacKey(page).evaluate(b => ({ busy: b.getAttribute('aria-busy'), off: b.getAttribute('aria-disabled'), on: b.getAttribute('aria-pressed'), hard: b.disabled }));
  await vacKey(page).click({ force: true }); await page.waitForTimeout(200); const asked = await page.locator('.at-sec-ask').count(); await page.waitForTimeout(3600); const l = await sent(page);
  check('ST-06: «Отпуск» waits (aria-busy + aria-disabled, not disabled, not yet «on») and a second press asks nothing', mid.busy === 'true' && mid.off === 'true' && !mid.hard && mid.on === 'false' && asked === 0, { mid, asked });
  check('ST-06: one date write, then one arming', l.length === 2 && l[0].c === 'input_datetime.set_datetime' && l[0].data?.datetime === `${AHEAD} 00:00:00` && l[1].c === 'alarm_control_panel.alarm_arm_vacation', l); check('errors ST-06 pending', !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(() => { const h = window.atomPreview.host, orig = h.call.bind(h); let first = true; h.setAccept(true); h.call = (d, s, data) => { if (d === 'input_datetime' && first) { first = false; h.log.push({ domain: d, service: s, data }); return Promise.reject({ code: 'home_assistant_error', message: 'Помощник занят' }); } return orig(d, s, data); }; });
  await vacKey(page).click(); await page.waitForTimeout(200); await page.locator('.at-sec-ask-yes').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400);
  const e = await page.locator('.at-osec-control .at-sec-err').innerText().catch(() => ''), free = await vacKey(page).evaluate(b => b.getAttribute('aria-busy') === null && b.getAttribute('aria-disabled') === null), l1 = await sent(page);
  check('ST-06 / CODEX-011: a refused date write arms nothing, says why, frees «Отпуск»', l1.length === 1 && l1[0].c === 'input_datetime.set_datetime' && e === 'Дом отклонил команду: Помощник занят' && free, { l1, e, free });
  await vacKey(page).click(); await page.waitForTimeout(200); await page.locator('.at-sec-ask-yes').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); const l2 = await sent(page);
  check('ST-06: …and a new intent works (date, then the arming)', l2.length === 3 && l2[1].c === 'input_datetime.set_datetime' && l2[2].c === 'alarm_control_panel.alarm_arm_vacation', l2); check('errors ST-06 refusal', !errors.length, errors); await ctx.close(); }
// ST-06 acceptance 4: the alarm panel is lost between the date write and its answer — exactly the one write already begun, no arming,
// «Не получилось: Нет связи с охраной», the key free
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(() => { const h = window.atomPreview.host, orig = h.call.bind(h); h.setAccept(true); h.call = (d, s, data) => { if (d === 'input_datetime') { h.log.push({ domain: d, service: s, data }); return new Promise(ok => { window.__dateDone = ok; }); } return orig(d, s, data); }; });
  await vacKey(page).click(); await page.waitForTimeout(200); await page.locator('.at-sec-ask input[type=date]').fill(AHEAD, { timeout: 3000 }).catch(() => {}); await page.locator('.at-sec-ask-yes').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(300);
  await page.evaluate(a => window.atomPreview.setStates({ [a]: 'unknown' }), ALARM); await page.waitForTimeout(300); await page.evaluate(() => window.__dateDone?.()); await page.waitForTimeout(500);
  const l = await sent(page), e = await page.locator('.at-osec-control .at-sec-err').innerText().catch(() => ''), busy = await page.locator('.at-sec-panel [aria-busy="true"]').count();
  check('ST-06: the alarm lost between the date and the arming — one date write, no arming, «Не получилось: Нет связи с охраной», nothing waits', l.length === 1 && l[0].c === 'input_datetime.set_datetime' && e === 'Не получилось: Нет связи с охраной' && busy === 0, { l, e, busy }); check('errors ST-06 lost midway', !errors.length, errors); await ctx.close(); }
// CODEX-011: the earlier plan's date, emptied in the question, is cleared in the house before «Отпуск» — and the house's «no date» is read back as
// no date; in «Настройка» of the panel an emptied return date is written as «no date» too (it was dropped in silence)
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(d => { window.atomPreview.host.setAccept(true); window.atomPreview.setStates({ 'input_datetime.heating_vacation_return': `${d} 00:00:00` }); }, LATER); await page.waitForTimeout(250);
  await vacKey(page).click(); await page.waitForTimeout(250); const f = page.locator('.at-sec-ask input[type=date]'), was = await f.inputValue();
  await f.fill('', { timeout: 3000 }).catch(() => {}); await page.locator('.at-sec-ask-yes').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); const l = await sent(page);
  check('CODEX-011: the question shows the earlier plan\'s date; emptied, the house\'s «no date» is written before the arming', was === LATER && l.length === 2 && l[0].c === 'input_datetime.set_datetime' && l[0].id === 'input_datetime.heating_vacation_return' && l[0].data?.datetime === '2099-12-31 00:00:00' && l[1].c === 'alarm_control_panel.alarm_arm_vacation', { was, l });
  await page.evaluate(a => window.atomPreview.setStates({ 'input_datetime.heating_vacation_return': '2099-12-31 00:00:00', [a]: 'armed_vacation' }), ALARM); await page.waitForTimeout(300);
  const row = await vacKey(page).innerText(), setDate = await page.locator('.at-sec-set input[type=date]').inputValue().catch(() => 'none');
  check('CODEX-011: «no date» is read back as no date — the mode row names no day, the setting\'s field is empty', !/2099|31 декабря|[Дд]о \d/.test(row) && setDate === '', { row, setDate }); check('errors CODEX-011', !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await open({ scenario: 'disarmed' }); await page.evaluate(d => { window.atomPreview.host.setAccept(true); window.atomPreview.setStates({ 'input_datetime.heating_vacation_return': `${d} 00:00:00` }); }, LATER); await page.waitForTimeout(250);
  const f = page.locator('.at-sec-set input[type=date]'); await f.scrollIntoViewIfNeeded(); const was = await f.inputValue(); await f.fill(''); await page.keyboard.press('Tab'); await page.waitForTimeout(400); const l = await sent(page);
  check('CODEX-011: «Настройка → Дата возвращения» emptied writes the house\'s «no date», not nothing', was === LATER && l.length === 1 && l[0].c === 'input_datetime.set_datetime' && l[0].data?.datetime === '2099-12-31 00:00:00', { was, l }); check('errors CODEX-011 settings', !errors.length, errors); await ctx.close(); }
// CODEX-002 / CODEX-010: the office («Атом + Окапи») — its own look (rings, two keys), the house's safety rules
async function openOffice({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'armed', hash = '#security' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=okapi-security&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  await page.waitForSelector(hash === '#home' ? '.at-osec-tile' : '.at-osec-wrap'); await page.waitForTimeout(250); await page.evaluate(() => window.atomPreview.host.setAccept(true)); return { page, ctx, errors };
}
const MASTER = 'alarm_control_panel.master', ZONES = ['alarm_control_panel.master', 'alarm_control_panel.shourum', 'alarm_control_panel.servis'], DOOR = 'binary_sensor.atom_service_usa_service_door';
for (const [scenario, theme, w, h] of [['armed', 'light', 1070, 764], ['armed', 'dark', 360, 792], ['pending', 'light', 1070, 764], ['triggered', 'light', 1070, 764]]) {
  const { page, ctx, errors } = await openOffice({ scenario, theme, w, h }), key = page.locator('.at-osec-key').nth(1), tag = `${scenario} ${theme} ${w}`;
  await key.click(); await page.waitForTimeout(250);
  check(`CODEX-002 office ${tag}: the first tap on «С охраны» sends nothing and asks «Снять здание с охраны?»`, (await sent(page)).length === 0 && /^Снять здание с охраны\?/.test(await page.locator('.at-sec-ask').innerText().catch(() => '')), await sent(page));
  check(`CODEX-002 office ${tag}: the safe choice «Отмена» comes first and has the focus`, await page.evaluate(() => document.activeElement?.classList.contains('at-sec-ask-no') && document.activeElement?.textContent === 'Отмена' && document.querySelector('.at-sec-ask-btns button')?.classList.contains('at-sec-ask-no')));
  if (scenario === 'armed' && await page.locator('.at-sec-ask').count()) { const v = await runAxe(page, '.at-sec-ask'); check(`CODEX-002 office ${tag}: axe on the question`, !v.length, v); const lay = await layout(page, '.at-osec-wrap'); check(`CODEX-002 office ${tag}: layout with the question`, !lay.length, lay);
    await page.locator('.at-osec-control').screenshot({ path: `${out}/office-ask-${theme}-${w}.png` }); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  check(`CODEX-002 office ${tag}: Escape closes it, nothing sent, the focus back on «С охраны»`, await page.locator('.at-sec-ask').count() === 0 && (await sent(page)).length === 0 && await key.evaluate(e => e === document.activeElement));
  await key.click(); await page.waitForTimeout(200); await page.locator('.at-sec-ask-no').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(200);
  check(`CODEX-002 office ${tag}: «Отмена» sends nothing`, (await sent(page)).length === 0 && await page.locator('.at-sec-ask').count() === 0);
  await key.click(); await page.waitForTimeout(200); await page.locator('.at-sec-ask-yes').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); const l = await sent(page);
  check(`CODEX-002 office ${tag}: «С охраны» on «yes» disarms the master, once`, l.length === 1 && l[0].c === 'alarm_control_panel.alarm_disarm' && l[0].id === MASTER, l);
  check(`CODEX-002 office ${tag}: the office keeps its rings and two keys`, await page.locator('.at-osec-control .at-osec-ring').count() >= 3 && await page.locator('.at-osec-key').count() === 2);
  check(`errors CODEX-002 office ${tag}`, !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await openOffice({ scenario: 'arming' }); await page.locator('.at-osec-key').nth(1).click(); await page.waitForTimeout(350); const l = await sent(page);
  check('CODEX-002 office: cancelling an arming that has not finished stays one tap', l.length === 1 && l[0].c === 'alarm_control_panel.alarm_disarm' && await page.locator('.at-sec-ask').count() === 0, l); check('errors CODEX-002 arming', !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await openOffice({ scenario: 'armed' }); await page.locator('.at-osec-key').nth(1).click(); await page.waitForTimeout(250); const asked = await page.locator('.at-sec-ask').count();
  await page.evaluate(z => window.atomPreview.setStates(Object.fromEntries(z.map(id => [id, 'disarmed']))), ZONES); await page.waitForTimeout(350);
  const st = await page.evaluate(() => ({ asked: document.querySelectorAll('.at-sec-ask').length, focus: document.activeElement?.classList.contains('at-osec-state') ?? false }));
  check('CODEX-002 office: disarmed from Ajax meanwhile — the question is withdrawn, nothing sent, the focus on the state line (the key is off now)', asked === 1 && st.asked === 0 && st.focus && (await sent(page)).length === 0, [asked, st, await sent(page)]);
  await page.locator('.at-osec-key').nth(0).click(); await page.waitForTimeout(350); const l = await sent(page);
  check('CODEX-002 office: «Под охрану» with every device answering stays one tap', l.length === 1 && l[0].c === 'alarm_control_panel.alarm_arm_away' && l[0].id === MASTER && await page.locator('.at-sec-ask').count() === 0, l); check('errors CODEX-002 withdrawn', !errors.length, errors); await ctx.close(); }
for (const st of ['unavailable', 'unknown']) for (const theme of ['light', 'dark']) {
  const tag = `${st} ${theme}`, home = await openOffice({ scenario: 'armed', hash: '#home', theme }); await home.page.evaluate(z => window.atomPreview.setStates(Object.fromEntries(z.map(id => [id, 'disarmed']))), ZONES); await home.page.waitForTimeout(250);
  const before = await home.page.evaluate(() => { const t = document.querySelector('.at-osec-tile'); return { cls: t.className, text: t.innerText.replace(/\s+/g, ' ') }; });
  await home.page.evaluate(([d, s]) => window.atomPreview.setStates({ [d]: s }), [DOOR, st]); await home.page.waitForTimeout(250);
  const after = await home.page.evaluate(() => { const t = document.querySelector('.at-osec-tile'); return { cls: t.className, text: t.innerText.replace(/\s+/g, ' '), name: t.querySelector('.ah-tile-hit')?.getAttribute('aria-label') ?? '' }; });
  check(`CODEX-010 office tile ${tag}: calm and «Двери и окна закрыты» while every device answers`, /\bis-calm\b/.test(before.cls) && /Двери и окна закрыты/.test(before.text), before);
  check(`CODEX-010 office tile ${tag}: a door sensor that does not answer — not calm, never «Двери и окна закрыты», it names the door`, /\bis-warn\b/.test(after.cls) && !/Двери и окна закрыты/.test(after.text + after.name) && /Не отвечает: Дверь Сервиса/.test(after.text), after);
  if (st === 'unavailable') await home.page.locator('.at-osec-tile').screenshot({ path: `${out}/office-tile-silent-${theme}.png` });
  check(`errors CODEX-010 tile ${tag}`, !home.errors.length, home.errors); await home.ctx.close();
  const { page, ctx, errors } = await openOffice({ scenario: 'armed', theme }); await page.evaluate(([d, s]) => window.atomPreview.setStates({ [d]: s }), [DOOR, st]); await page.waitForTimeout(250);
  const p = await page.evaluate(() => ({ say: document.querySelector('.at-osec-name small')?.textContent ?? '', head: document.querySelector('.at-osec-devs .hm-section-head small')?.textContent ?? '', ctl: document.querySelector('.at-osec-control').className }));
  check(`CODEX-010 office panel ${tag}: armed with a silent door — not «Всё закрыто, здание под охраной»; the list says «не отвечают: 1», not «всё закрыто»`, p.say === 'Не отвечает: Дверь Сервиса' && p.head === 'не отвечают: 1' && /\bis-warn\b/.test(p.ctl), p);
  const card = page.locator('.at-osec-dev', { hasText: 'Дверь Сервиса' }).first(); check(`CODEX-010 office panel ${tag}: the door's own card says «Нет данных»`, /Нет данных/.test(await card.innerText()), await card.innerText());
  await page.evaluate(z => window.atomPreview.setStates(Object.fromEntries(z.map(id => [id, 'disarmed']))), ZONES); await page.waitForTimeout(250); await page.locator('.at-osec-key').nth(0).click(); await page.waitForTimeout(250);
  const q = await page.locator('.at-sec-ask').innerText().catch(() => ''); check(`CODEX-010 office ${tag}: arming with it says which and asks first, nothing sent`, /^Не отвечает: Дверь Сервиса\. Охрана его не увидит\. Поставить всё равно\?/.test(q) && (await sent(page)).length === 0, q);
  await page.locator('.at-sec-ask-yes').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(350); const l = await sent(page);
  check(`CODEX-010 office ${tag}: …and arms on «yes»`, l.length === 1 && l[0].c === 'alarm_control_panel.alarm_arm_away', l); check(`errors CODEX-010 panel ${tag}`, !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await openOffice({ scenario: 'armed' }), GLASS = 'binary_sensor.showroom_evrinet_miscare_showroom_2_glass_break';
  await page.evaluate(g => window.atomPreview.setStates({ [g]: 'unknown' }), GLASS); await page.waitForTimeout(250); const calm = await page.evaluate(() => document.querySelector('.at-osec-control').className);
  const card = page.locator('.at-osec-dev', { hasText: 'Движение в Шоуруме' }).first(); await card.locator('.at-osec-dev-hit').click(); await page.waitForTimeout(200); const rows = await card.locator('.at-osec-rows').innerText();
  check('CODEX-010 office: a glass break that has not said its state is «Нет данных», never «Норма» (the building stays guarded)', /Разбитие стекла\s*Нет данных/.test(rows) && !/Разбитие стекла\s*Норма/.test(rows) && /\bis-armed\b/.test(calm), { rows, calm });
  await page.evaluate(g => window.atomPreview.setStates({ [g]: 'unavailable' }), GLASS); await page.waitForTimeout(250);
  check('CODEX-010 office: an unavailable glass break makes the building amber and names the device', /\bis-warn\b/.test(await page.evaluate(() => document.querySelector('.at-osec-control').className)) && /Не отвечает: Движение в Шоуруме/.test(await page.locator('.at-osec-name small').innerText()), await page.locator('.at-osec-name small').innerText());
  check('errors CODEX-010 glass', !errors.length, errors); await ctx.close(); }
stop(fails.length ? 1 : 0);
