// Everything the Energy panel and tile must hold, in one run, in the shared card preview (its host records every command and reaches nothing):
// layout on every device and orientation in both themes and three languages, accessibility (axe), console errors, the state matrix
// (full history, statistics only since November, rooms not assigned, HA refusing, no recorder, feed offline), every control, no command sent.
// usage: node scripts/qa-energy.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
// «Now» is injected (audit 09.11.2026: 14 checks held only in the week of 2–8 November 2026, on some weekdays, at some hours): the run does not
// look at the real clock. The preview server it starts builds the made-up statistics for NOW (ATOM_QA_NOW, scripts/cards/energy.mjs), every
// page's clock starts at NOW (and runs on from there), and every expectation here is counted from NOW. By default NOW is Thursday 5 November
// 2026, 15:20 in Chisinau; QA_NOW=<ISO time> runs the same checks at another instant (the day-of-month ones need the 5th or later; the «fresh»
// scenario, whose statistics begin on 01.11.2026 as the house's did, always runs at the default instant, on a preview server of its own).
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/energy'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = await freePort();
const PINNED = new Date(2026, 10, 5, 15, 20).getTime(), NOW = process.env.QA_NOW ? new Date(process.env.QA_NOW).getTime() : PINNED; if (!Number.isFinite(NOW)) throw new Error('QA_NOW is not a time');
const serve = (p, now) => { const s = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(p)], { stdio: 'pipe', env: { ...process.env, TZ: 'Europe/Chisinau', ATOM_QA_NOW: String(now) } }); return new Promise(r => s.stdout.once('data', () => r(s))); };
const server = await serve(port, NOW), freshServer = NOW === PINNED ? null : await serve(port + 1, PINNED);
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
// where and when a scenario runs: «fresh» at the instant its statistics were made for
const nowOf = scenario => scenario === 'fresh' ? PINNED : NOW, originOf = scenario => scenario === 'fresh' && freshServer ? `http://127.0.0.1:${port + 1}` : origin;
// the page's clock: «now» is the injected instant when the page loads and runs on from it (timers are the real ones)
const pageClock = at => { const D = Date, shift = at - D.now(); class QaDate extends D { constructor(...a) { if (a.length) super(...a); else super(D.now() + shift); } static now() { return D.now() + shift; } } window.Date = QaDate; };
const D0 = new Date(NOW), ruDay = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }), dayOfMonth = k => ruDay(new Date(D0.getFullYear(), D0.getMonth(), k).getTime());
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 260)}`); };
const report = () => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); };
const stop = code => { report(); server.kill(); freshServer?.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [768, 1024, 'open'], [1024, 768, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd'], [1280, 720, 'tv'], [320, 640, 'small']];
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'now', hash = '#energy', reduced = false, clock, admin } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau', reducedMotion: reduced ? 'reduce' : 'no-preference' }), page = await ctx.newPage(), errors = [];
  if (clock) await page.clock.install({ time: clock }); else await page.addInitScript(pageClock, nowOf(scenario));
  if (admin === false) await page.addInitScript(() => { window.__beforeDraw = h => { h.setAdmin(false); }; });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await page.goto(`${originOf(scenario)}/?card=energy&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  if (hash.startsWith('#energy')) await page.waitForSelector('.at-ep-hero, .at-ep-fail, .hm-energy, .at-ep .at-empty', { timeout: 8000 }).catch(() => errors.push('panel never settled'));
  // the animations that end: not the endless ones, and not those a scroll position drives (the tab rows' edge fade, `ah-fade-l` / `ah-fade-r`: their
  // timeline is the scroller, they never «finish», and waiting for them hung the whole run)
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect.getTiming().iterations !== Infinity && a.animationName !== 'at-ep-pulse').map(a => a.finished.catch(() => {})))); await page.waitForTimeout(120);
  return { page, ctx, errors };
}
const runAxe = async (page, scope) => { await page.addScriptTag({ content: axe }); return page.evaluate(async sc => { const r = await window.axe.run(document.querySelector(sc), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'], rules: { region: { enabled: false } } }); return r.violations.filter(v => ['critical', 'serious'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ').slice(0, 120)}`); }, scope); };
const scrollAll = page => page.evaluate(async () => { const m = document.querySelector('.hm-main'); for (let y = 0; y <= m.scrollHeight; y += m.clientHeight * 0.8) { m.scrollTop = y; await new Promise(r => setTimeout(r, 30)); } m.scrollTop = 0; });
const smallTargets = page => page.evaluate(() => [...document.querySelectorAll('.at-ep button')].filter(b => b.offsetWidth && (b.offsetHeight < 44 || b.offsetWidth < 44)).map(b => `${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 18)} ${b.offsetWidth}x${b.offsetHeight}`));
// the chart's texts inside its card (a «1 000 kWh» tick ran past it), the average's label clear of the bars, the half-year axis without a month
// twice, a feed card's name and share each on one line, a number never broken from its unit, the same rule for a room and its only device
const extra = page => page.evaluate(() => {
  const bad = [], card = document.querySelector('.at-ep-chart')?.getBoundingClientRect(), box = e => e.getBoundingClientRect(), lines = e => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; };
  if (card) for (const t of document.querySelectorAll('.at-ep-chart svg text')) { const r = box(t); if (r.width && (r.left < card.left - 0.5 || r.right > card.right + 0.5)) bad.push(`chart text outside the card: ${t.textContent}`); }
  const avg = document.querySelector('.at-ep-avg text'); if (avg) { const a = box(avg); for (const b of document.querySelectorAll('.at-ep-bar :is(path,rect):not(.at-ep-hit)')) { const r = box(b); if (r.height > 0.5 && a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top) { bad.push('the average\'s label over a bar'); break; } } }
  const axis = [...document.querySelectorAll('.at-ep[data-period="half"] .at-ep-axis')].map(t => t.textContent); if (new Set(axis).size !== axis.length) bad.push(`month twice on the axis: ${axis.join(',')}`);
  for (const e of document.querySelectorAll('.at-ep-feed-name, .at-ep-feed-head small')) if (e.textContent.trim() && lines(e) > 1) bad.push(`broken over two lines: ${e.textContent}`);
  const w = document.createTreeWalker(document.querySelector('.at-ep'), NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) { const m = n.textContent.match(/\d (kWh|kW|W|V|A|кВт·ч|кВт|Вт|В|А|лей|lei|ч|h|%)(?![\p{L}\d])/u); if (m) { bad.push(`number and unit can part: «${n.textContent.trim().slice(0, 30)}»`); break; } }
  for (const room of document.querySelectorAll('.at-ep-room:not(.is-rest)')) { const devs = room.querySelectorAll('.at-ep-dev b'); if (devs.length === 1 && room.querySelector('.at-ep-room-line span').textContent !== devs[0].textContent) bad.push(`room ${room.querySelector('.at-ep-room-line span').textContent} vs its device ${devs[0].textContent}`); }
  for (const b of document.querySelectorAll('.at-ep-periods button')) if (b.scrollWidth > b.clientWidth + 1) bad.push(`period label overflows: ${b.textContent}`);
  return bad;
});
// dark: the picked period on a solid pill (white on the light glass was 2,7:1), the secondary text near-white on a darker card
const darkInk = page => page.evaluate(() => {
  const rgba = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; }, lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }, ratio = (p, q) => { const a = lum(p), b = lum(q); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const bad = [], act = document.querySelector('.at-ep-periods button.is-active'), bg = rgba(getComputedStyle(act).backgroundColor), ink = rgba(getComputedStyle(act).color);
  if (bg.a < 0.85 || ratio(bg, ink) < 4.5) bad.push(`picked period ${getComputedStyle(act).color} on ${getComputedStyle(act).backgroundColor}`);
  const card = rgba(getComputedStyle(document.querySelector('.at-ep-card')).backgroundColor); if (!(card.a >= 0.25 && Math.max(card.r, card.g, card.b) < 60)) bad.push(`card glass ${getComputedStyle(document.querySelector('.at-ep-card')).backgroundColor}`);
  for (const sel of ['.at-ep-money', '.at-ep-feed-num', '.at-ep-hero small']) { const c = rgba(getComputedStyle(document.querySelector(sel)).color); if (c.a < 0.9) bad.push(`${sel} ink alpha ${c.a}`); }
  return bad;
});
const ru2 = s => Number(s.replace(/[^\d,]/g, '').replace(',', '.'));
// the truth for a stretch: the made-up statistics' day rows of the three channels, summed in [a, b) (what the hero must show, no row more)
const rng = (period, offset, now = NOW) => { const n = new Date(now), y = n.getFullYear(), mo = n.getMonth(); if (period === 'week') { const mon = new Date(y, mo, n.getDate() - (n.getDay() + 6) % 7 + 7 * offset); return [mon.getTime(), new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7).getTime()]; } if (period === 'month') return [new Date(y, mo + offset, 1).getTime(), new Date(y, mo + offset + 1, 1).getTime()]; if (period === 'half') { const h = mo < 6 ? 0 : 6; return [new Date(y, h + 6 * offset, 1).getTime(), new Date(y, h + 6 * offset + 6, 1).getTime()]; } return [new Date(y + offset, 0, 1).getTime(), new Date(y + offset + 1, 0, 1).getTime()]; };
const truth = (page, [a, b]) => page.evaluate(([a, b]) => ['apt9', 'apt8', 'ev'].reduce((acc, k) => acc + (window.__energyStats.day[`sensor.entrance_spm_${k}_energy_total`] ?? []).filter(([t]) => t >= a && t < b).reduce((x, [, v]) => x + v, 0), 0), [a, b]);
const hero = async page => ru2(await page.locator('.at-ep-hero .at-ep-big .ah-tick > span:last-child').first().textContent());
const near = (shown, exact) => Math.abs(shown - exact) <= (exact < 10 ? 0.051 : 0.51);
const avgRow = async page => ru2(await page.locator('.at-ep-compare .at-ep-row').filter({ hasText: 'В среднем за день' }).locator('b').textContent());
const stepBack = async (page, period, n = 1) => { for (let i = 0; i < n; i++) { await page.click('.at-ep-step:not(.is-next)'); await page.waitForTimeout(150); } await page.waitForSelector(`.at-ep[data-period="${period}"] .at-ep-hero`); await page.waitForTimeout(450); };
// what the children's room's only meter counted today (the made-up statistics' finished hours): under 0,005 kWh the panel lists no device
const kidsToday = page => page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return (window.__energyStats.hour['sensor.kids_tv_meter_total_energy'] ?? []).filter(([t]) => t >= d.getTime()).reduce((a, [, v]) => a + v, 0); });
const commands = page => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws' || !/^(energy\/get_prefs|get_config$|recorder\/)/.test(x.service)).length);
// 1. the panel in every period × every device × both themes (Russian), then three languages on the kiosk and the phone
for (const theme of ['light', 'dark']) for (const [w, h, dev] of DEVICES) for (const period of ['day', 'month', 'year']) {
  const { page, ctx, errors } = await open({ w, h, theme }), tag = `${dev}/${theme}/${period}`;
  if (period !== 'day') { await page.click(`.at-ep-periods button:nth-child(${period === 'month' ? 3 : 5})`); await page.waitForSelector('.at-ep[data-period="' + period + '"] .at-ep-hero'); await page.waitForTimeout(900); }
  await scrollAll(page); const l = await layout(page, '.at-ep'); check(`layout ${tag}`, !l.length, l);
  if (period === 'day') { const t = await smallTargets(page); check(`targets ${tag}`, !t.length, t); }
  const x = await extra(page); check(`chart and cards ${tag}`, !x.length, x);
  if (theme === 'dark' && dev === '13R' && period === 'day') { const c = await darkInk(page); check(`dark contrast ${tag}`, !c.length, c); }
  if (['13R', 'pad', 'phone-land'].includes(dev) && period !== 'year') { const a = await runAxe(page, '.at-ep'); check(`axe ${tag}`, !a.length, a); }
  check(`errors ${tag}`, !errors.length, errors); check(`no command ${tag}`, (await commands(page)) === 0);
  if (['13R', 'pad'].includes(dev)) await page.screenshot({ path: `${out}/${dev}-${theme}-${period}.png`, fullPage: true });
  await ctx.close();
}
for (const lang of ['en', 'ro']) for (const [w, h, dev] of [[1070, 764, 'pad'], [360, 792, '13R']]) for (const period of ['day', 'half']) {
  const { page, ctx, errors } = await open({ w, h, lang }), tag = `${dev}/${lang}/${period}`;
  if (period !== 'day') { await page.click('.at-ep-periods button:nth-child(4)'); await page.waitForSelector('.at-ep[data-period="half"] .at-ep-hero'); await page.waitForTimeout(900); }
  await scrollAll(page); const l = await layout(page, '.at-ep'); check(`layout ${tag}`, !l.length, l);
  const x = await extra(page); check(`chart and cards ${tag}`, !x.length, x);
  const text = await page.locator('.at-ep').innerText(); check(`no Russian left ${tag}`, !/[а-яё]{4,}/i.test(text.replace(/Квартира \d|Зарядка авто|кв\. \d|зарядка|Бойлер|Холодильник|Чайник|Аэрогриль|Очиститель воздуха|Телевизор|Увлажнитель|Яндекс Станция( Макс)?|Пылесос|ИБП \(NAS, роутеры, камеры\)|Компьютер и хаб|Монитор|Кухня|Гостиная|Прихожая|Компьютерная|Детская|Ванная/g, '')), text.match(/[а-яё]{4,}/gi)?.slice(0, 5));
  check(`errors ${tag}`, !errors.length, errors); await page.screenshot({ path: `${out}/${dev}-${lang}-${period}.png`, fullPage: true }); await ctx.close();
}
// 2. the states of the panel
const state = async (scenario, fn, opts = {}) => { const { page, ctx, errors } = await open({ scenario, ...opts }); try { await fn(page); } finally { check(`errors ${scenario}`, !errors.filter(e => !/statistics refused/.test(e)).length, errors); await page.screenshot({ path: `${out}/state-${scenario}${opts.w ? '-' + opts.w : ''}.png`, fullPage: true }); await ctx.close(); } };
await state('statsFail', async page => { check('HA refusing: an alert with a retry, no figures', await page.locator('.at-ep-fail[role=alert] button').count() === 1 && await page.locator('.at-ep-hero').count() === 0);
  const h = await page.locator('.at-ep-fail .hm-pill').evaluate(b => b.offsetHeight); check('retry is 44 px', h >= 44, h);
  const old = await page.$('.at-ep-fail'); await page.click('.at-ep-fail .hm-pill'); await page.waitForSelector('.at-ep-fail[role=alert]'); await page.waitForTimeout(200);
  check('retry: a new alert, announced again, with the time of the attempt', !(await old.evaluate(n => n.isConnected)) && /\d\d:\d\d:\d\d/.test(await page.locator('.at-ep-fail').innerText()));
  check('retry: the focus goes to the title, not to the page', await page.evaluate(() => document.activeElement?.tagName) === 'H2', await page.evaluate(() => document.activeElement?.tagName)); });
await state('noStats', async page => { check('no recorder: the device list as before', await page.locator('.hm-energy').count() === 1 && await page.locator('.at-ep').count() === 0);
  // round 2 of the audit: «12 W», «всего 1 kWh», «Квартира 8 · энергия today 0 kWh» in a Russian panel, and the feed meter's first input alone in its head
  const text = (await page.locator('.hm-energy').innerText()).replace(/\u00a0/g, ' ');
  check('no recorder: units in the panel\'s language, no Latin W / kW / kWh', !/\d\s?(W|kW|kWh|Wh)(?![\p{L}\d])/u.test(text) && /\d Вт/.test(text) && /\d кВт·ч/.test(text), text.match(/\d[\d,.]*\s?(W|kW|kWh|Wh)(?![\p{L}\d])/u)?.[0]);
  check('no recorder: «… энергия today / total» after a channel\'s name is translated', !/today|total|yesterday/i.test(text) && /Квартира 8 · сегодня/.test(text) && /Квартира 8 · всего/.test(text), text.match(/[^\n]*(today|total)[^\n]*/i)?.[0]);
  const spm = (await page.locator('.hm-line', { hasText: 'SPM' }).first().locator(':scope > b').textContent()).replace(/\u00a0/g, ' '); check('no recorder: the feed meter\'s head is all its inputs together (153,4 + 0 + 1 126 + 0 W)', spm === '1,28 кВт', spm); });
for (const lang of ['en', 'ro']) await state('noStats', async page => { const text = (await page.locator('.hm-energy').innerText()).replace(/\u00a0/g, ' '); check(`no recorder ${lang}: its own units and words`, /\d W\b/.test(text) && /\d kWh\b/.test(text) && !/[а-яё]+ (today|total)|\d Вт/i.test(text) && (lang === 'en' ? /· today/.test(text) : /· azi/.test(text)), text.slice(0, 200)); }, { lang });
await state('noRooms', async page => { check('rooms not assigned: one list, no apartment switch (the owner: intended)', await page.locator('.at-ep-rooms .ah-segments').count() === 0 && await page.locator('.at-ep-room').count() > 1); check('rooms not assigned: a hint to Settings → Rooms', await page.locator('.at-ep-rooms-hint').count() === 1); });
// the hint names the panel's own tab and its Rooms page in each language: «Settings → Rooms» was no tab in English, «Camere» a bottom-bar tab
for (const [lang, path] of [['ru', 'Настройка → Комнаты'], ['en', 'Setup → Rooms'], ['ro', 'Configurare → Încăperi']]) await state('noRooms', async page => {
  const hint = (await page.locator('.at-ep-rooms-hint').textContent().catch(() => '')).trim();
  check(`rooms hint ${lang}: ends in «${path}», the tab that exists`, hint.endsWith(path), hint);
}, { lang, w: 1070, h: 764 });
await state('partRooms', async page => { const tabs = await page.locator('.at-ep-rooms .ah-segments button').allInnerTexts(); check('apartments from the config, the unassigned rooms apart', tabs.length === 3 && /Не распределено/.test(tabs[2]), tabs);
  await page.click('.at-ep-rooms .ah-segments button:nth-child(3)'); const used = await kidsToday(page), list = await page.locator('.at-ep-room-list').innerText();
  check('the devices of a room on no feed are listed (today: once its meter counted anything)', /Детская/.test(list) === used > 0.005 && await page.locator('.at-ep-room.is-rest').count() === 0, { used, list });
  await stepBack(page, 'day'); await page.click('.at-ep-rooms .ah-segments button:nth-child(3)'); check('the devices of a room on no feed are listed (yesterday, a whole day)', /Детская/.test(await page.locator('.at-ep-room-list').innerText()) && await page.locator('.at-ep-room.is-rest').count() === 0); });
for (const lang of ['ru', 'ro', 'en']) for (const [w, h] of [[320, 640], [360, 792], [1070, 764]]) { // apartments: each button whole, inside the card
  const { page, ctx, errors } = await open({ scenario: 'partRooms', lang, w, h }); await page.locator('.at-ep-rooms').scrollIntoViewIfNeeded();
  const cut = await page.evaluate(() => { const card = document.querySelector('.at-ep-rooms').getBoundingClientRect(); return [...document.querySelectorAll('.at-ep-rooms .ah-segments button')].filter(b => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > card.right + 0.5 || b.getBoundingClientRect().left < card.left - 0.5 || b.offsetHeight < 44).map(b => `${b.textContent} ${b.scrollWidth}/${b.clientWidth}`); });
  check(`apartment buttons whole ${lang} ${w}`, !cut.length, cut); check(`errors partRooms ${lang} ${w}`, !errors.length, errors); if (w === 360) await page.screenshot({ path: `${out}/rooms-${lang}-${w}.png`, fullPage: true }); await ctx.close();
}
await state('staleFeed', async page => { const tabs = await page.locator('.at-ep-rooms .ah-segments button').allInnerTexts(); check('a room on a feed that is no channel any more: «Не распределено», not hidden in «без своего датчика»', tabs.length === 3 && /Не распределено/.test(tabs[2]), tabs);
  if (tabs.length === 3) { await stepBack(page, 'day'); await page.click('.at-ep-rooms .ah-segments button:nth-child(3)'); check('its devices listed there (yesterday, a whole day)', /Детская/.test(await page.locator('.at-ep-room-list').innerText())); } });
await state('noPrefs', async page => { check('HA without Energy settings: no «settings not read» warning', await page.locator('.at-ep-hero').count() === 1 && await page.locator('.at-ep-prefs').count() === 0); });
await state('gap', async page => { await page.click('.at-ep-step'); await page.waitForSelector('.at-ep-nostats, .at-ep[data-period="day"] .at-ep-hero'); check('a day without statistics: one line, no 0,0 kWh and 0,00 lei', await page.locator('.at-ep-nostats').count() === 1 && await page.locator('.at-ep-hero, .at-ep-rooms, .at-ep-feed').count() === 0); check('earlier days with statistics stay reachable', !(await page.locator('.at-ep-step:not(.is-next)').isDisabled()));
  const why = await page.locator('.at-ep-nostats small').textContent().catch(() => ''); check('a silent day after the statistics began: the meter sent nothing, not «no meters before»', /Счётчик не передавал данные/.test(why) && !/раньше счётчиков не было/.test(why), why);
  // the same day inside its week: an empty slot that reads «no data», never «0,0 kWh ≈ 0,00 лей»
  await page.click('.at-ep-periods button:nth-child(2)'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); if (D0.getDay() === 1) await stepBack(page, 'week'); await page.waitForTimeout(900);
  check('the silent day is an empty slot in the week', await page.locator('.at-ep-bar.is-gap .at-ep-gapslot').count() === 1, await page.locator('.at-ep-bar.is-gap').count());
  if (await page.locator('.at-ep-bar.is-gap').count()) { await page.locator('.at-ep-bar.is-gap').first().click(); const rd = await page.locator('.at-ep-readout').textContent(); check('a tap on it reads «no data», not 0,0 kWh', /Счётчик не передавал данные/.test(rd) && !/кВт·ч|kWh|лей/.test(rd), rd); } });
// the SPM back after the silent yesterday: today's 00:00 holds yesterday's energy too, said so, and it is not «the costliest hour»
const CARRIED = /Включает расход за время без связи/;
const peakSub = page => page.locator('.at-ep-compare .at-ep-row').filter({ hasText: 'Самый затратный' }).locator('small').textContent().catch(() => '');
await state('gap', async page => {
  check('gap, today: the hero says the total includes the silent stretch', CARRIED.test(await page.locator('.at-ep-hero .at-ep-carried').textContent().catch(() => '')));
  const peak = await peakSub(page); check('gap, today: the costliest hour is not the catch-up at 00:00–01:00', !/^00:00/.test(peak), peak);
  const heroNote = await page.locator('.at-ep-hero .at-ep-carried').textContent().catch(() => ''); check('gap, today: the hero note, marked «*», names the hour that holds it', /^\*\u00a000:00/.test(heroNote), heroNote);
  // the SPM put yesterday into today's 00:00, the plugs kept their own days: «без своего датчика» says so. The sessions are built from the
  // charger's power, which HA does not write while the SPM is silent: they cannot hold it, and never say they do
  { const rest = await page.locator('.at-ep-rooms .at-ep-room.is-rest .at-ep-carried').textContent().catch(() => ''); check('gap, today: the rooms\' rest, marked «*», says it holds the silent stretch', CARRIED.test(rest) && /^\*\u00a0/.test(rest), rest); }
  check('gap, today: the charging sessions never claim to include the silent stretch', await page.locator('.at-ep-sessions .at-ep-carried').count() === 0 && !CARRIED.test(await page.locator('.at-ep-sessions').innerText().catch(() => '')));
  await page.click('.at-ep-periods button:nth-child(2)'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); await page.waitForTimeout(900);
  check('gap, week: today\'s bar is the carried one', await page.locator('.at-ep-bar.is-carried').count() === 1, await page.locator('.at-ep-bar.is-carried').count());
  // ...drawn apart from the others (paler, a dotted outline), and the hero note names its day: the tallest bar and «the costliest day» tied together
  const look = await page.evaluate(() => { const st = sel => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); return { op: Number(s.fillOpacity), dash: s.strokeDasharray }; }; return { carried: st('.at-ep-bar.is-carried :is(path,rect):not(.at-ep-hit)'), normal: st('.at-ep-bar:not(.is-carried):not(.is-gap) :is(path,rect):not(.at-ep-hit)'), today: new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long' }) }; });
  const weekNote0 = (await page.locator('.at-ep-hero .at-ep-carried').textContent().catch(() => '')).replace(/ /g, ' ');
  // a week that began yesterday or today has no ordinary bar to compare with (Monday silent, Tuesday carried): the week before has seven
  if (!look.normal) { await stepBack(page, 'week'); look.normal = await page.evaluate(() => { const e = document.querySelector('.at-ep-bar:not(.is-carried):not(.is-gap) :is(path,rect):not(.at-ep-hit)'); if (!e) return null; const s = getComputedStyle(e); return { op: Number(s.fillOpacity), dash: s.strokeDasharray }; }); await page.click('.at-ep-step.is-next'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); await page.waitForTimeout(700); }
  check('gap, week: the carried bar is drawn paler with a dotted outline', !!look.carried && !!look.normal && look.carried.op < 1 && look.carried.dash !== 'none' && look.normal.op === 1 && look.normal.dash === 'none', look);
  const weekNote = (await page.locator('.at-ep-hero .at-ep-carried').textContent().catch(() => '')).replace(/ /g, ' '); check('gap, week: the hero note names today\'s bar', weekNote.includes(look.today) && CARRIED.test(weekNote), { weekNote, today: look.today });
  // the charge while the SPM was silent is missing from the list: said, with how much (the charger's total less the sessions)
  { const legend = ru2(await page.locator('.at-ep-legend button').filter({ hasText: 'Зарядка' }).locator('b').textContent().catch(() => '0')), listed = ru2((await page.locator('.at-ep-sessum').textContent().catch(() => '')).split('·')[1] ?? '0'), missed = await page.locator('.at-ep-sessions .at-ep-missed').textContent().catch(() => ''), m = ru2(missed.split(':').at(-1));
    check('gap, week: the sessions say the charging while the meter was silent is not in the list, and how much', legend - listed > 0.3 ? /сюда не попали/.test(missed) && Math.abs(m - (legend - listed)) <= (legend >= 10 ? 1.01 : 0.11) : missed === '', { legend, listed, missed }); }
  // the carried bar reads its figure; that it holds the silent stretch is for a screen reader (the hero says it): a line of its own moved the chart
  if (await page.locator('.at-ep-bar.is-carried').count()) { await page.locator('.at-ep-bar.is-carried').click(); const rd = await page.locator('.at-ep-readout').evaluate(e => ({ text: e.textContent, sr: [...e.querySelectorAll('.at-vh')].map(x => x.textContent).join(' '), line: e.querySelectorAll('.at-ep-carried').length })); check('gap, week: the carried bar reads its figure, the silent stretch said to a screen reader, no line of its own', /кВт·ч/.test(rd.text) && CARRIED.test(rd.sr) && rd.line === 0, rd); }
  const wp = await peakSub(page); check('gap, week: the costliest day is not today\'s catch-up', !new RegExp(`(^|\\D)${D0.getDate()}[\\s\\u00a0]`).test(wp), wp);
}, { w: 1070, h: 764 });
// the chart stays under the finger whatever the reading says: idle, a normal bar, the silent day («no data», two lines on a phone) and the carried one
for (const [w, h] of [[360, 792], [1070, 764]]) await state('gap', async page => {
  const plotTop = () => page.evaluate(() => document.querySelector('.at-ep-plot').getBoundingClientRect().top - document.querySelector('.at-ep-chart').getBoundingClientRect().top);
  const views = [0, -1], seen = {}; // on a Monday the silent Sunday is in the week before; on a Tuesday the ordinary bars are
  await page.click('.at-ep-periods button:nth-child(2)'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); await page.waitForTimeout(900);
  for (const v of views) {
    if (v) await stepBack(page, 'week');
    await page.locator('.at-ep-plot').scrollIntoViewIfNeeded(); const idle = await plotTop(), tops = { idle };
    for (const [k, sel] of [['normal', '.at-ep-bar:not(.is-gap):not(.is-carried)'], ['gap', '.at-ep-bar.is-gap'], ['carried', '.at-ep-bar.is-carried']]) {
      if (!(await page.locator(sel).count())) continue; seen[k] = true;
      await page.locator(sel).first().click(); tops[k] = await plotTop(); await page.locator(sel).first().click(); await page.waitForTimeout(60);
    }
    check(`the chart does not jump with the reading ${w}x${h} week ${v}`, Object.values(tops).every(t => Math.abs(t - idle) < 1), tops);
  }
  check(`the jump check met the silent and the carried bar ${w}x${h}`, !!seen.gap && !!seen.carried && !!seen.normal, seen);
}, { w, h });
// the carried bar's figure carries a visible «*», the mark of the note under the total (on a 13R lying down that note is scrolled away): the
// reading keeps its height, nothing in it runs out of it, and the chart stays where it was
for (const [w, h] of [[320, 640], [360, 792], [792, 360]]) await state('gap', async page => {
  await page.click('.at-ep-periods button:nth-child(2)'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); await page.waitForTimeout(900);
  if (!(await page.locator('.at-ep-bar.is-carried').count()) && D0.getDay() === 1) await stepBack(page, 'week');
  await page.locator('.at-ep-plot').scrollIntoViewIfNeeded();
  const geo = () => page.evaluate(() => { const r = document.querySelector('.at-ep-readout'), box = r.getBoundingClientRect(); return { top: document.querySelector('.at-ep-plot svg').getBoundingClientRect().top, h: Math.round(box.height), out: [...r.querySelectorAll('*')].filter(e => !e.closest('.at-vh') && e.offsetWidth && (e.getBoundingClientRect().right > box.right + 0.5 || e.getBoundingClientRect().bottom > box.bottom + 0.5)).map(e => e.textContent.slice(0, 20)), over: r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1 }; });
  const idle = await geo(), n = await page.locator('.at-ep-bar.is-carried').count(); check(`carried mark ${w}x${h}: the gap week has a carried bar`, n === 1, n); if (!n) return;
  await page.locator('.at-ep-bar.is-carried').click(); const picked = await geo();
  const mark = await page.locator('.at-ep-readout').evaluate(r => [...r.querySelectorAll('*')].filter(e => !e.closest('.at-vh') && e.children.length === 0 && e.textContent.trim() === '*' && e.offsetWidth > 0 && getComputedStyle(e).visibility !== 'hidden').length);
  check(`carried mark ${w}x${h}: a visible «*» after the figure`, mark === 1, mark);
  check(`carried mark ${w}x${h}: the chart stays, the reading keeps its height and holds its text`, Math.abs(picked.top - idle.top) < 1 && picked.h === idle.h && !picked.out.length && !picked.over, { idle, picked });
  if (w === 792) await page.screenshot({ path: `${out}/carried-pick-${w}x${h}.png` });
}, { w, h });
// a series switched off is still a control (the only way back): its name and figure readable, not faded to 2,5:1
for (const theme of ['light', 'dark']) for (const [w, h] of [[1070, 764], [360, 792]]) {
  const { page, ctx, errors } = await open({ w, h, theme }); await page.click('.at-ep-legend button:nth-child(3)'); await page.waitForTimeout(300);
  const off = await page.locator('.at-ep-legend button.is-off').evaluate(b => ({ opacity: getComputedStyle(b).opacity, pressed: b.getAttribute('aria-pressed') })).catch(() => null);
  const a = await runAxe(page, '.at-ep-legend'); check(`legend off ${theme} ${w}: not faded, contrast holds`, !!off && off.opacity === '1' && off.pressed === 'false' && !a.length, { off, a });
  check(`errors legend off ${theme} ${w}`, !errors.length, errors); await ctx.close();
}
// a Wi-Fi drop inside yesterday: the curve breaks there, never 0 W and never apartment 9 left out of the sum
await state('silentHours', async page => {
  await page.click('.at-ep-step'); await page.waitForSelector('.at-ep[data-period="day"] .at-ep-hero'); await page.waitForTimeout(700);
  check('silent hours: the curve has a dotted gap', await page.locator('.at-ep-curvegap').count() >= 1, await page.locator('.at-ep-curvegap').count());
  check('silent hours: the area breaks at the gap', await page.locator('.at-ep-area').first().evaluate(p => (p.getAttribute('d').match(/M/g) ?? []).length) >= 2);
  // the chart in the middle of the screen: the house's live list stands above it and the tab bar covers the bottom edge
  await page.locator('.at-ep-plot').evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
  const box = await page.locator('.at-ep-plot svg').boundingBox(), at = async (h, m) => { await page.mouse.move(box.x + 34 + (h * 12 + m / 5) / 287 * (box.width - 42), box.y + 80); await page.waitForTimeout(80); return page.locator('.at-ep-readout').textContent(); };
  for (const [h, m, what] of [[14, 30, 'the whole SPM silent'], [13, 30, 'apartment 9 silent']]) { const rd = await at(h, m); check(`silent hours: ${what} at ${h}:${m} reads «no data», not watts`, /Счётчик не передавал данные/.test(rd) && !/\d\s*(к?Вт|k?W)/.test(rd), rd); }
  const ok = await at(10, 0); check('silent hours: a measured minute still reads watts', /\d\s*к?Вт/.test(ok), ok);
  check('silent hours: the hour the meter came back in is said to hold the silent stretch', CARRIED.test(await page.locator('.at-ep-hero .at-ep-carried').textContent().catch(() => '')));
  const peak = await peakSub(page); check('silent hours: the catch-up at 15:00–16:00 is not the costliest hour', !/^15:00/.test(peak), peak);
});
{ // the first read of the start of the statistics failed: asked again on the next refresh, and «Раньше» stops at the first month after it
  const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await page.clock.install({ time: PINNED });
  await page.addInitScript(() => { window.__failFirst = true; window.__beforeDraw = h => { const f = h.statistics; h.statistics = function (ids, a, b, p, t) { if (window.__failFirst && p === 'month' && a < new Date(2001, 0, 1).getTime()) return Promise.reject(new Error('preview: statistics refused (first)')); return f.call(this, ids, a, b, p, t); }; }; });
  await page.goto(`${originOf('fresh')}/?card=energy&scenario=fresh&theme=light&lang=ru#energy`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.at-ep-hero', { timeout: 8000 }).catch(() => errors.push('panel never settled'));
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero'); await page.waitForTimeout(300);
  const before = await page.locator('.at-ep-step:not(.is-next)').isDisabled();
  await page.evaluate(() => { window.__failFirst = false; }); await page.clock.fastForward('05:01'); await page.waitForTimeout(700);
  check('first read failed: «Раньше» not limited while the start is unknown', !before);
  check('first read failed, then the refresh: asked again, «Раньше» disabled at the first month', await page.locator('.at-ep-step:not(.is-next)').isDisabled());
  await page.click('.at-ep-step:not(.is-next)', { force: true }).catch(() => {}); await page.waitForTimeout(300); check('first read repeated: no month before November opens', /Ноябрь/.test(await page.locator('.at-ep-nav h2').textContent()), await page.locator('.at-ep-nav h2').textContent());
  check('errors first read', !errors.filter(e => !/statistics refused/.test(e)).length, errors); await page.screenshot({ path: `${out}/state-firstFail.png`, fullPage: true }); await ctx.close();
}
await state('prefsFail', async page => { check('HA\'s Energy settings unread: said so, not taken for «no parents»', await page.locator('.at-ep-prefs').count() === 1); });
await state('oneSilent', async page => { const net = await page.locator('.at-ep-net').innerText(); check('a silent input reads «нет связи» in the network block', /Квартира 9\s*нет связи/.test(net), net); });
// a channel silent now (its statistics stop where it went quiet): no ▲/▼ and no comparison row in any period, never a false «за прошлый
// период данных нет». A period begun under 20 minutes ago is skipped: its silence is not yet 15 minutes of it
const silentCompare = async (page, tag, periods) => { for (const period of periods) {
  const n = ['day', 'week', 'month', 'half', 'year'].indexOf(period) + 1, d = D0, start = period === 'day' ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : rng(period, 0)[0];
  if (n > 1) { await page.click(`.at-ep-periods button:nth-child(${n})`); await page.waitForSelector(`.at-ep[data-period="${period}"] .at-ep-hero`); await page.waitForTimeout(900); }
  if (NOW - start < 20 * 60000) continue;
  const c = await page.evaluate(() => ({ badge: document.querySelectorAll('.at-ep-hero .at-ep-delta, .at-ep-compare .at-ep-delta').length, compare: document.querySelector('.at-ep-compare')?.innerText ?? '' }));
  check(`${tag} ${period}: no ▲/▼ and no comparison row while a channel is silent`, c.badge === 0 && !/данных нет|было/.test(c.compare), c);
} };
await state('oneSilent', page => silentCompare(page, 'one channel silent 2 h', ['day', 'week', 'month', 'half', 'year']));
await state('offline', page => silentCompare(page, 'the SPM silent 2 h', ['day', 'week', 'month']));
await state('longSilent', page => silentCompare(page, 'one channel silent since yesterday', ['day', 'week']));
await state('fresh', async page => {
  await page.click('.at-ep-periods button:nth-child(2)'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); check('a week against one day of statistics: no «▲ 706 %»', await page.locator('.at-ep-hero .at-ep-delta').count() === 0 && /данных нет/.test(await page.locator('.at-ep-compare').innerText()));
  await page.click('.at-ep-step'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); await page.waitForTimeout(700);
  check('no earlier than the statistics: the week of 1 November is the last', await page.locator('.at-ep-step:not(.is-next)').isDisabled());
  check('focus not lost when «Раньше» switches itself off', await page.evaluate(() => document.activeElement?.tagName) === 'H2');
  { const shown = await hero(page), exact = await truth(page, rng('week', -1, PINNED)); check('the week before: its own days, no Monday of the next week (HA moves the end)', near(shown, exact), { shown, exact }); }
  await page.locator('.at-ep-bar').first().click(); check('a bar before the statistics opens no reading', await page.locator('.at-ep-readout.is-hint').count() === 1, await page.locator('.at-ep-readout').textContent());
  await page.locator('.at-ep-bar').last().click(); const read1 = await page.locator('.at-ep-readout strong').textContent().catch(() => '');
  await page.locator('.at-ep-bar').first().click(); check('a tap before the statistics neither opens the first bar nor clears it', /1 ноября/.test(read1) && (await page.locator('.at-ep-readout strong').textContent().catch(() => '')) === read1, read1);
  // half a year from 01.11: since 1 November, the average per day as the week's, the dashed weekly average a whole week
  await page.click('.at-ep-step.is-next'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); await page.waitForTimeout(400); const weekDay = await avgRow(page);
  await page.click('.at-ep-periods button:nth-child(4)'); await page.waitForSelector('.at-ep[data-period="half"] .at-ep-hero'); await page.waitForTimeout(900);
  const since = await page.locator('.at-ep-since').textContent().catch(() => ''), halfDay = await avgRow(page), dash = ru2(await page.locator('.at-ep-avg text').textContent().catch(() => '0'));
  check('half a year: statistics since 1 November, not Monday 26 October', /1 ноября/.test(since) && !/26 октября/.test(since), since);
  check('half a year: the average per day as the week\'s', halfDay > weekDay * 0.8 && halfDay < weekDay * 1.25, { halfDay, weekDay });
  check('half a year: the dashed weekly average is a whole week, not one day', dash >= 4 * halfDay, { dash, halfDay });
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero'); check('November is the first month', await page.locator('.at-ep-step:not(.is-next)').isDisabled());
  await page.click('.at-ep-periods button:nth-child(5)'); await page.waitForSelector('.at-ep[data-period="year"] .at-ep-hero'); check('statistics since November: said so on the chart', await page.locator('.at-ep-since').count() === 1); const avg = await page.locator('.at-ep-avg text').textContent(); check('the yearly average counts only November', Number(avg.replace(/[^\d,]/g, '').replace(',', '.')) > 100, avg); });
await state('offline', async page => { const now = await page.locator('.at-ep-now').innerText(); check('feed silent: «нет связи» instead of a figure', /нет связи/.test(now) && !/\d\s*(к?Вт|k?W)/.test(now), now);
  // the day's history: its chart once the day holds anything (a feed silent since before midnight leaves the night's day empty, and says so)
  const used = await hero(page); check('the history still there', used >= 0.05 ? await page.locator('.at-ep-chart svg').count() === 1 : await page.locator('.at-ep-chart .at-ep-readout.is-hint').count() === 1, used); });
await state('now', async page => {
  const sections = { periods: await page.locator('.at-ep-periods button').count(), money: await page.locator('.at-ep-hero .at-ep-money').count(), badge: await page.locator('.at-ep-hero .at-ep-delta').count(), chart: await page.locator('.at-ep-chart svg').count(), feeds: await page.locator('.at-ep-feed').count(), rooms: await page.locator('.at-ep-rooms .ah-segments button').count(), forecast: await page.locator('.at-ep-compare .at-ep-row.is-strong').count(), net: await page.locator('.at-ep-netrow').count(), sessions: await page.locator('.at-ep-sessions').count() };
  check('the layout approved on 08.11.2026: 5 periods, hero with lei and badge, chart, a block per bill (the car inside apartment 8, owner 09.11.2026), rooms per apartment, forecast, network, sessions', JSON.stringify(sections) === JSON.stringify({ periods: 5, money: 1, badge: 1, chart: 1, feeds: 2, rooms: 2, forecast: 1, net: 2, sessions: 1 }), sections);
  check('no tariff of the owner\'s: ANRE\'s figure for Premier Energy, its day, where to write one\'s own', /^Тариф по данным ANRE для Premier Energy: 3,56\u00a0лей за кВт·ч с 2 апреля 2026, без НДС\. Свой тариф: Настройка → Энергия$/.test(await page.locator('.at-ep-tariff').textContent()) && await page.locator('.at-ep-tariff').getAttribute('data-tariff') === 'anre', await page.locator('.at-ep-tariff').textContent());
  // one spelling of the units in Russian, the rooms' own (Вт, кВт, кВт·ч): no Latin one beside a figure anywhere on the panel
  { const text = await page.locator('.at-ep').innerText(), latin = text.match(/\d[\s\u00a0](kWh|kW|W|V|A)(?![\p{L}\d])/gu); check('ru: the units are Вт, кВт, кВт·ч, В — no «W», «kWh» beside a figure', !latin && /\d[\s\u00a0]кВт·ч/.test(text) && /\d[\s\u00a0]к?Вт(?!·)/.test(text) && /\d[\s\u00a0]В(?![\p{L}])/u.test(text), latin?.slice(0, 5)); }
  check('a normal day: nothing said to hold a silent stretch', await page.locator('.at-ep-carried, .at-ep-bar.is-carried').count() === 0, await page.locator('.at-ep-carried').allTextContents());
  const relays = await page.evaluate(() => [...document.querySelectorAll('.at-ep .hm-switch, .at-ep [role=switch], .at-ep button')].filter(b => b.matches('.hm-switch, [role=switch]') || /включ|выключ|реле|relay|turn (on|off)/i.test(b.textContent)).length); check('no relay buttons on the panel', relays === 0, relays);
  check('the panel opened on #energy takes focus on its title', await page.evaluate(() => document.activeElement === document.querySelector('.at-ep-nav h2')));
  check('the focused title draws no ring (it is not a control)', await page.evaluate(() => getComputedStyle(document.querySelector('.at-ep-nav h2')).outlineStyle) === 'none', await page.evaluate(() => getComputedStyle(document.querySelector('.at-ep-nav h2')).outline));
  const a11y = await page.evaluate(() => ({ tabs: document.querySelectorAll('.at-ep [role=tab], .at-ep [role=tablist]').length, periods: document.querySelector('.at-ep-periods').getAttribute('role'), pressed: document.querySelector('.at-ep-periods button').getAttribute('aria-pressed'), rooms: document.querySelector('.at-ep-rooms .ah-segments')?.getAttribute('aria-label'), plot: document.querySelector('.at-ep-plot').getAttribute('role'), desc: !!document.getElementById(document.querySelector('.at-ep-plot').getAttribute('aria-describedby') ?? '-'), live: document.querySelector('.at-ep-readout').getAttribute('aria-live'), rd: document.querySelector('.at-ep-plot').getAttribute('aria-roledescription') }));
  check('switches are pressed buttons in named groups, the chart a described group, the hint live', a11y.tabs === 0 && a11y.periods === 'group' && a11y.pressed === 'true' && !!a11y.rooms && a11y.plot === 'group' && a11y.desc && a11y.live === 'polite' && !!a11y.rd, a11y);
  // (the wall tablet is a touch screen: its visible line names no keys since round 2 — the chart's description does; a mouse's line is checked below)
  check('keyboard way named in the chart\'s description', /←/.test(await page.locator('#at-ep-hint').textContent()) && /Esc/.test(await page.locator('#at-ep-hint').textContent()));
  const anim = await page.evaluate(() => { const l = document.querySelector('.at-ep-live'), p = document.querySelector('.at-ep-nowmark .is-pulse'); return { own: getComputedStyle(l).animationName, after: getComputedStyle(l, '::after').animationName, shadow: getComputedStyle(l).boxShadow, pulse: p ? getComputedStyle(p).animationIterationCount : '3', kf: [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).filter(r => r.name === 'at-ep-live').map(r => r.cssText).join('') }; });
  check('the live dot animates transform and opacity only, the now-pulse stops', anim.own === 'none' && anim.after === 'at-ep-live' && anim.shadow === 'none' && !/box-shadow/.test(anim.kf) && anim.pulse === '3', anim);
  check('numbers in columns are tabular', /tabular-nums/.test(await page.locator('.at-ep-row b').first().evaluate(e => getComputedStyle(e).fontVariantNumeric)));
  // the week's dashed average is the comparison's daily one
  await page.click('.at-ep-periods button:nth-child(2)'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-avg text'); await page.waitForTimeout(300);
  const avgs = await page.evaluate(() => [document.querySelector('.at-ep-avg text').textContent, [...document.querySelectorAll('.at-ep-compare .at-ep-row')].find(r => /В среднем за день/.test(r.textContent))?.querySelector('b').textContent]);
  check('one daily average on the screen', avgs[1] !== undefined && ru2(avgs[0]) === ru2(avgs[1]), avgs);
  // a drag across the month's bars reads the bar under the finger, a tap on the picked one clears it
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-bar'); await page.waitForTimeout(900);
  await page.locator('.at-ep-plot').evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); const b2 = await page.locator('.at-ep-bar').nth(1).boundingBox(), b5 = await page.locator('.at-ep-bar').nth(4).boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height - 2); await page.mouse.down(); await page.mouse.move(b5.x + b5.width / 2, b5.y + b5.height - 2, { steps: 6 }); await page.mouse.up();
  check('dragging across the bars', (await page.locator('.at-ep-readout strong').textContent()).replace(/\u00a0/g, ' ').includes(dayOfMonth(5)), dayOfMonth(5));
  await page.mouse.click(b5.x + b5.width / 2, b5.y + b5.height - 2); check('a tap on the picked bar clears it', await page.locator('.at-ep-readout.is-hint').count() === 1);
  // «Позже» back to today: the focus goes to the title, not to nothing; a finished day is not «к вчера в это время»
  await page.click('.at-ep-periods button:nth-child(1)'); await page.waitForSelector('.at-ep[data-period="day"] .at-ep-hero'); await page.click('.at-ep-step'); await page.waitForSelector('.at-ep[data-period="day"] .at-ep-hero'); await page.waitForTimeout(300);
  const badge = await page.locator('.at-ep-hero .at-ep-delta').textContent().catch(() => ''); check('a finished day compares with the previous day', /к предыдущему дню/.test(badge) && !/в это время/.test(badge), badge);
  await page.focus('.at-ep-step.is-next'); await page.keyboard.press('Enter'); await page.waitForTimeout(400); check('focus not lost when «Позже» switches itself off', await page.evaluate(() => document.activeElement?.tagName) === 'H2');
});
await state('now', async page => { // past periods hold exactly their own days; a finished month is compared with the whole one before it
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero'); await stepBack(page, 'month');
  { const shown = await hero(page), exact = await truth(page, rng('month', -1)); check('last month: its own days, not the 1st of this one', near(shown, exact), { shown, exact }); }
  const days = o => { const [a, b] = rng('month', o); return Math.round((b - a) / 86400000); }; let k = -1; while (k > -12 && days(k) >= days(k - 1)) k--;
  await stepBack(page, 'month', -1 - k); { const before = ru2(await page.locator('.at-ep-compare .at-ep-row small').filter({ hasText: 'было' }).first().textContent().catch(() => '0')), exact = await truth(page, rng('month', k - 1)); check(`a ${days(k)}-day month against the whole ${days(k - 1)}-day one before`, near(before, exact), { before, exact }); }
  await page.click('.at-ep-periods button:nth-child(4)'); await page.waitForSelector('.at-ep[data-period="half"] .at-ep-hero'); await stepBack(page, 'half');
  { const shown = await hero(page), exact = await truth(page, rng('half', -1)); check('the half before: its own days, not the Monday-started week before it', near(shown, exact), { shown, exact }); }
  await page.click('.at-ep-periods button:nth-child(5)'); await page.waitForSelector('.at-ep[data-period="year"] .at-ep-hero'); await page.waitForTimeout(400);
  check('this year compares with last year, whole from its first hour', await page.locator('.at-ep-hero .at-ep-delta').count() === 1);
  await stepBack(page, 'year'); { const shown = await hero(page), exact = await truth(page, rng('year', -1)); check('last year: its own months, not January after it', near(shown, exact), { shown, exact }); }
});
{ // a kiosk screen that comes back: the panel and the tile read again at once, not after the next tick
  const { page, ctx, errors } = await open({ clock: NOW });
  await page.evaluate(() => { const h = window.atomPreview.host, f = h.statistics, g = h.energyMonth; window.__reads = 0; window.__months = 0; h.statistics = function (...a) { window.__reads++; return f.apply(this, a); }; h.energyMonth = function (...a) { window.__months++; return g.apply(this, a); }; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hide === true }); window.__hide = true; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward('06:00'); await page.waitForTimeout(300); const asleep = await page.evaluate(() => window.__reads);
  await page.evaluate(() => { window.__hide = false; document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(500);
  check('the screen back after 6 minutes: the panel reads at once', asleep === 0 && await page.evaluate(() => window.__reads) > 0, { asleep, after: await page.evaluate(() => window.__reads) }); check('errors screen back', !errors.length, errors); await ctx.close();
  const t = await open({ clock: NOW, hash: '#home' });
  await t.page.evaluate(() => { const h = window.atomPreview.host, g = h.energyMonth; window.__months = 0; h.energyMonth = function (...a) { window.__months++; return g.apply(this, a); }; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hide === true }); window.__hide = true; document.dispatchEvent(new Event('visibilitychange')); });
  await t.page.clock.fastForward('11:00'); await t.page.waitForTimeout(300); const tAsleep = await t.page.evaluate(() => window.__months);
  await t.page.evaluate(() => { window.__hide = false; document.dispatchEvent(new Event('visibilitychange')); }); await t.page.waitForTimeout(400);
  check('the tile: no month read while hidden, one at once when back', tAsleep === 0 && await t.page.evaluate(() => window.__months) === 1, { tAsleep, after: await t.page.evaluate(() => window.__months) }); await t.ctx.close();
}
await state('now', async page => { // touch: a tap by the reading clears it; the chart does not move when the reading starts
  await page.locator('.at-ep-plot').scrollIntoViewIfNeeded(); const box = await page.locator('.at-ep-plot svg').boundingBox(), y0 = box.y; await page.touchscreen.tap(box.x + box.width * 0.2, box.y + 60); const read = await page.locator('.at-ep-readout.is-hint').count() === 0, y1 = (await page.locator('.at-ep-plot svg').boundingBox()).y;
  check('a finger reads a minute and the chart stays where it was', read && Math.abs(y1 - y0) < 1, { read, y0, y1 });
  await page.touchscreen.tap(box.x + box.width * 0.2 + 1, box.y + 60); check('a second tap by the reading clears it', await page.locator('.at-ep-readout.is-hint').count() === 1);
}, { w: 360, h: 792 });
// the bars' hint wraps to two lines on a pad and a 13R on its side (ru «…Esc — сброс»): the first tap's one-line reading must not move the chart
for (const [w, h] of [[764, 1070], [768, 1024], [792, 360]]) for (const lang of ['ru', 'ro', 'en']) for (const period of [2, 3]) {
  const { page, ctx, errors } = await open({ w, h, lang }); await page.click(`.at-ep-periods button:nth-child(${period})`); await page.waitForSelector('.at-ep[data-period] .at-ep-bar'); await page.waitForTimeout(900);
  await page.locator('.at-ep-plot').scrollIntoViewIfNeeded(); const y = async () => (await page.locator('.at-ep-plot svg').boundingBox()).y, y0 = await y();
  await page.locator('.at-ep-bar').last().click(); const read = await page.locator('.at-ep-readout.is-hint').count() === 0, y1 = await y();
  await page.locator('.at-ep-bar').last().click(); const y2 = await y();
  check(`the chart stays under the finger ${w}x${h} ${lang} ${period === 2 ? 'week' : 'month'}`, read && Math.abs(y1 - y0) < 1 && Math.abs(y2 - y0) < 1, { read, y0, y1, y2 }); check(`errors jump ${w} ${lang}`, !errors.length, errors); await ctx.close();
}
// a day older than HA's 5-minute statistics: drawn from every channel's hourly means, 00:00 to 24:00, no gap
await state('now', async page => {
  await stepBack(page, 'day', 15); await page.waitForTimeout(400);
  const c = await page.evaluate(() => { const svg = document.querySelector('.at-ep-plot svg'), xs = [...document.querySelectorAll('.at-ep-area')].flatMap(p => (p.getAttribute('d').match(/[\d.]+(?=,)/g) ?? []).map(Number)); return { gaps: document.querySelectorAll('.at-ep-curvegap').length, right: Math.max(0, ...xs), width: svg?.getBoundingClientRect().width ?? 0 }; });
  check('a day 15 back: no gap, the curve to 24:00', c.gaps === 0 && c.right >= c.width - 8 - 1, c);
}, { w: 1070, h: 764 });
{ // the 5-minute refresh: keeps the picked bar; a failed one keeps the report and says it will retry
  const { page, ctx, errors } = await open({ clock: NOW });
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-bar'); await page.waitForTimeout(900); await page.locator('.at-ep-bar').nth(2).click();
  await page.clock.fastForward('05:01'); await page.waitForTimeout(600); check('the refresh keeps the picked bar', (await page.locator('.at-ep-readout strong').textContent().catch(() => '')).replace(/\u00a0/g, ' ').includes(dayOfMonth(3)), dayOfMonth(3));
  await page.evaluate(() => { window.__energyStats = 'fail'; }); await page.clock.fastForward('05:01'); await page.waitForTimeout(600);
  check('a failed refresh keeps the report and says so', await page.locator('.at-ep-hero').count() === 1 && await page.locator('.at-ep-stale').count() === 1 && await page.locator('.at-ep-fail').count() === 0);
  check('errors refresh', !errors.filter(e => !/statistics refused/.test(e)).length, errors); await ctx.close();
}
{ // a past day open across midnight: the title stays with the data
  const n = D0, late = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 0).getTime(), { page, ctx } = await open({ clock: late });
  await page.click('.at-ep-step'); await page.waitForSelector('.at-ep[data-period="day"] .at-ep-hero'); const t0 = await page.locator('.at-ep-nav h2').textContent();
  await page.clock.fastForward('02:00'); await page.click('.at-ep-legend button:nth-child(3)'); await page.waitForTimeout(200); const t1 = await page.locator('.at-ep-nav h2').textContent();
  check('the title stays with the day shown across midnight', t0 === t1, [t0, t1]); await ctx.close();
}
{ // Setup → Rooms: the feed of each room
  const { page, ctx } = await open({ hash: '#setup' }); await page.waitForSelector('.at-setup'); await page.click('.at-setup-tabs button:nth-child(2)'); await page.waitForTimeout(300);
  const opts = await page.locator('.at-setup-row[data-room-id="kukhnia"] select').first().evaluate(s => [...s.options].map(o => o.textContent)).catch(() => []);
  check('Setup → Rooms: a feed per room', opts.length === 3 && opts.includes('Квартира 9') && opts.includes('Квартира 8'), opts); await ctx.close();
}
await state('charging', async page => { const now = await page.locator('.at-ep-now').innerText(); check('charging now: the charger in the live split', /3,5\s*кВт/.test(now), now); });
// 3. every control
await state('now', async page => {
  check('next disabled on today', await page.locator('.at-ep-step.is-next').isDisabled());
  await page.click('.at-ep-step'); await page.waitForTimeout(500); check('back: yesterday', /Вчера/.test(await page.locator('.at-ep-nav h2').textContent())); check('yesterday has no live figure', await page.locator('.at-ep-now').count() === 0);
  await page.click('.at-ep-step.is-next'); await page.waitForTimeout(500); check('forward: today again', /Сегодня/.test(await page.locator('.at-ep-nav h2').textContent()));
  const areas = await page.locator('.at-ep-area').count(); await page.click('.at-ep-legend button:nth-child(3)'); check('legend hides a series', await page.locator('.at-ep-area').count() === areas - 1 && await page.locator('.at-ep-legend button:nth-child(3)').getAttribute('aria-pressed') === 'false');
  await page.click('.at-ep-legend button:nth-child(1)'); await page.click('.at-ep-legend button:nth-child(2)'); check('the last series cannot be hidden', await page.locator('.at-ep-area').count() >= 1);
  await page.click('.at-ep-legend button:nth-child(1)'); await page.click('.at-ep-legend button:nth-child(3)');
  await page.locator('.at-ep-plot').evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
  const box = await page.locator('.at-ep-plot svg').boundingBox(); await page.mouse.move(box.x + box.width * 0.12, box.y + 80); check('the finger reads a minute', /^\d\d:\d\d/.test(await page.locator('.at-ep-readout strong').textContent()));
  await page.focus('.at-ep-plot'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Escape'); check('keyboard: Esc clears the reading', await page.locator('.at-ep-readout.is-hint').count() === 1);
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-bar'); await page.waitForTimeout(900);
  await page.locator('.at-ep-bar').nth(2).click(); check('a bar shows its day', (await page.locator('.at-ep-readout strong').textContent()).replace(/\u00a0/g, ' ').includes(dayOfMonth(3)) && await page.locator('.at-ep-bar.is-dim').count() > 0);
  await page.focus('.at-ep-plot'); await page.keyboard.press('ArrowRight'); check('keyboard: arrows move along the bars', (await page.locator('.at-ep-readout strong').textContent()).replace(/\u00a0/g, ' ').includes(dayOfMonth(4)));
  await page.click('.at-ep-rooms .ah-segments button:nth-child(2)'); check('apartment 8 rooms', /Компьютерная/.test(await page.locator('.at-ep-room-list').innerText()));
  const more = page.locator('.at-ep-sessions .at-ep-more'); if (await more.count()) { await more.click(); check('all sessions', await more.getAttribute('aria-expanded') === 'true'); }
  await page.locator('.at-ep-dev').first().click(); await page.waitForTimeout(300); check('a device opens its page', /device=/.test(page.url()), page.url());
  check('no command after every control', (await commands(page)) === 0);
});
await state('now', async page => { const a = await page.evaluate(() => getComputedStyle(document.querySelector('.at-ep-bar, .at-ep-draw')).animationName); check('reduced motion: a fade only', /fade|none/.test(a), a); }, { reduced: true });
// the owner's rule (09.11.2026): a past month is billed at the tariff of its own time; the year names the change; the settings keep the history
await state('tariff', async page => {
  const note = () => page.locator('.at-ep-tariff').textContent(), money = async () => ru2(await page.locator('.at-ep-hero .at-ep-money').textContent());
  const n = D0, m1 = new Date(n.getFullYear(), n.getMonth(), 1).getTime(), m0 = new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime(), y0 = new Date(n.getFullYear(), 0, 1).getTime(), day1 = new Date(m1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
  check('the panel\'s own tariff is named with its day', (await note()) === `Тариф 4,00 лей за кВт·ч с ${day1}` && await page.locator('.at-ep-tariff').getAttribute('data-tariff') === 'panel', await note());
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero'); await page.waitForTimeout(600);
  const kwhNow = await truth(page, [m1, NOW]), leiNow = await money(); check('this month at 4 lei', Math.abs(leiNow - kwhNow * 4) <= Math.max(1, kwhNow * 4 * 0.012), { kwhNow, leiNow });
  await page.click('.at-ep-step'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero'); await page.waitForTimeout(600);
  const kwhPrev = await truth(page, [m0, m1]), leiPrev = await money(); check('last month at 3 lei, the tariff of its own time', Math.abs(leiPrev - kwhPrev * 3) <= Math.max(1, kwhPrev * 3 * 0.012), { kwhPrev, leiPrev });
  check('last month\'s note names its own price', /^Тариф 3,00 лей за кВт·ч с 1 января 2025$/.test(await note()), await note());
  await page.click('.at-ep-periods button:nth-child(5)'); await page.waitForSelector('.at-ep[data-period="year"] .at-ep-hero'); await page.waitForTimeout(800);
  check('the year names the change with its day', (await note()) === `Тариф за кВт·ч менялся: 3,00 лей до ${day1}, с ${day1} — 4,00 лей`, await note());
  const before = await truth(page, [y0, m1]), after = await truth(page, [m1, NOW]), leiYear = await money(); check('the year: the months before at 3 lei, this one at 4', Math.abs(leiYear - (before * 3 + after * 4)) <= (before * 3 + after * 4) * 0.012, { before, after, leiYear });
  if (n.getMonth() === 0) await stepBack(page, 'year'); // in January the month before is last year's December
  const bar = page.locator('.at-ep-bar').nth((n.getMonth() + 11) % 12); await bar.click(); await page.waitForTimeout(200); const read = await page.locator('.at-ep-readout').textContent(), readKwh = ru2(read.match(/([\d\s ]+(?:,\d+)?) кВт·ч/)[1]), readLei = ru2(read.match(/([\d\s ]+(?:,\d+)?) лей/)[1]);
  check('a past month\'s bar reads at its own price', Math.abs(readLei - readKwh * 3) <= Math.max(1, readKwh * 3 * 0.012), { read, readKwh, readLei });
});
{ // Настройка → Энергия: ANRE's figures offered until the owner writes his own; a row per change, saved to the config, read by the panel
  const { page, ctx, errors } = await open({ hash: '#setup' });
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].find(b => b.innerText.trim() === 'Энергия')?.click()); await page.waitForTimeout(400);
  check('the Energy tab opens the tariff page', await page.locator('.at-setup-tariff').count() === 1);
  const status = () => page.locator('.at-tariff-now').textContent();
  check('no tariff yet: ANRE named with both figures and their days', /ANRE/.test(await status()) && /3,59 лей с 1 августа 2025, 3,56 лей с 2 апреля 2026/.test(await status()), await status());
  check('tariff page a11y', (await runAxe(page, '.at-setup')).length === 0, await runAxe(page, '.at-setup'));
  await page.click('[data-action="use-anre"]'); await page.waitForTimeout(500);
  const saved = () => page.evaluate(() => window.atomPreview.config.energy.tariffs);
  check('ANRE\'s figures taken: two rows, in the config', await page.locator('[data-tariff-from]').count() === 2 && JSON.stringify(await saved()) === JSON.stringify([{ from: '2025-08-01', lei: 3.59 }, { from: '2026-04-02', lei: 3.56 }]), await saved());
  check('the current one is named', /^Сейчас: 3,56 лей за кВт·ч с 2 апреля 2026$/.test(await status()), await status());
  const price = page.locator('[data-tariff-from="2026-04-02"] .at-field:nth-child(2) input'); await price.fill('4'); await price.press('Tab'); await page.waitForTimeout(500); // a text field with a decimal keyboard since the audit of 09.11 (a comma is a decimal sign in ru/ro); saved when the field is left
  check('a price edited is saved', (await saved()).at(-1).lei === 4 && /4,00 лей/.test(await status()), await saved());
  const today = await page.evaluate(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; });
  await page.click('[data-action="add-tariff"]'); await page.waitForTimeout(500); const list = await saved();
  check('a change added today at the current price; a second one today cannot be added', list.length === 3 && list.at(-1).from === today && list.at(-1).lei === 4 && await page.locator('[data-action="add-tariff"]').isDisabled(), list);
  await page.locator(`[data-tariff-from="${today}"] button.hm-pill`).click(); await page.waitForTimeout(300);
  check('deleting a change asks first', /Удалить цену 4,00\s*лей/.test(await page.locator('.at-setup-ask p').textContent().catch(() => '')) && (await saved()).length === 3, await saved());
  await page.click('.at-setup-ask [data-answer="yes"]'); await page.waitForTimeout(500);
  check('a change deleted', (await saved()).length === 2 && !(await page.locator('[data-action="add-tariff"]').isDisabled()));
  const small = await page.evaluate(() => [...document.querySelectorAll('.at-setup-tariff button, .at-setup-tariff input')].filter(b => b.offsetWidth && b.offsetHeight < 40).map(b => `${(b.getAttribute('aria-label') || b.textContent || b.type).trim().slice(0, 18)} ${b.offsetWidth}x${b.offsetHeight}`));
  check('tariff controls at least 40 px high (as the other setup fields)', small.length === 0, small);
  await page.evaluate(() => { location.hash = '#energy'; }); await page.waitForSelector('.at-ep-hero'); await page.waitForTimeout(600);
  check('the panel reads the saved tariff', (await page.locator('.at-ep-tariff').textContent()) === 'Тариф 4,00 лей за кВт·ч с 2 апреля 2026' && await page.locator('.at-ep-tariff').getAttribute('data-tariff') === 'panel', await page.locator('.at-ep-tariff').textContent());
  check('tariff page: no errors', errors.length === 0, errors); await ctx.close();
}
// the panel's place is in the address (audit 09.11.2026): the period, and a past period by its first day, survive a reload and a device's sheet;
// a period switch is no new history entry
{ const { page, ctx, errors } = await open({}), hash = () => page.evaluate(() => location.hash), h2 = () => page.locator('.at-ep-nav h2').textContent(), entries = () => page.evaluate(() => history.length), n0 = await entries();
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero');
  check('the period is in the address', await hash() === '#energy?filter=month', await hash());
  await stepBack(page, 'month'); const prev = new Date(D0.getFullYear(), D0.getMonth() - 1, 1), want = `#energy?filter=month.${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`, title = await h2();
  check('a past period is in the address by its first day', await hash() === want, [await hash(), want]);
  check('switching the period and stepping add no history entries', await entries() === n0, [n0, await entries()]);
  await page.reload(); await page.waitForFunction(() => window.ready); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero'); await page.waitForTimeout(500);
  check('a reload keeps the period and the month that was open', await h2() === title && await hash() === want, [title, await h2(), await hash()]);
  await page.locator('.at-ep-dev').first().click(); await page.waitForTimeout(400); check('a device\'s sheet keeps the place under it', /filter=month\./.test(await hash()) && /device=/.test(await hash()) && await h2() === title, await hash());
  await page.goBack(); await page.waitForTimeout(400); check('back from the sheet: the same month', await hash() === want && await h2() === title, await hash());
  await page.click('.at-ep-step.is-next'); await page.waitForTimeout(500); check('«Позже» to the running month: no date in the address', await hash() === '#energy?filter=month', await hash());
  await page.click('.at-ep-periods button:nth-child(1)'); await page.waitForTimeout(400); check('today is the plain address', await hash() === '#energy', await hash());
  check('errors place', !errors.length, errors); await ctx.close(); }
{ // yesterday left open across midnight is still that day: «Раньше» goes to the day before it, «Позже» to the day after, one day a step
  const late = new Date(D0.getFullYear(), D0.getMonth(), D0.getDate(), 23, 50).getTime(), { page, ctx } = await open({ clock: late }), h2 = async () => (await page.locator('.at-ep-nav h2').textContent()).replace(/ /g, ' '), day = k => ruDay(new Date(D0.getFullYear(), D0.getMonth(), D0.getDate() + k).getTime());
  await page.click('.at-ep-step:not(.is-next)'); await page.waitForSelector('.at-ep[data-period="day"] .at-ep-hero'); const t0 = await h2();
  await page.clock.fastForward('20:00'); await page.waitForTimeout(200);
  await page.click('.at-ep-step:not(.is-next)'); await page.waitForTimeout(600); const t1 = await h2();
  await page.click('.at-ep-step.is-next'); await page.waitForTimeout(600); const t2 = await h2();
  await page.click('.at-ep-step.is-next'); await page.waitForTimeout(600); const t3 = await h2();
  check('across midnight «Раньше» from yesterday is the day before it, not the same day again', t0 === `Вчера, ${day(-1)}` && t1.includes(day(-2)), [t0, t1]);
  check('…and «Позже» goes a day a step: the day that was open, then the old today (now «Вчера»)', t2.includes(day(-1)) && t3 === `Вчера, ${day(0)}`, [t2, t3]);
  await ctx.close(); }
// «Свой тариф: Настройка → Энергия» (flow audit 09.11.2026): a way there for the one who may open the settings, the price's source alone for anyone else
await state('now', async page => {
  const b = page.locator('.at-ep-tariff [data-action="tariff"]'); check('admin: «Настройка → Энергия» is a button, 44 px', await b.count() === 1 && (await b.textContent()) === 'Настройка → Энергия' && await b.evaluate(e => e.tagName === 'BUTTON' && e.offsetHeight >= 44 && e.offsetWidth >= 44));
  await b.click(); await page.waitForTimeout(400); check('…that opens the settings on their Energy tab', await page.evaluate(() => location.hash) === '#setup?filter=energy', await page.evaluate(() => location.hash)); });
await state('now', async page => { const text = await page.locator('.at-ep-tariff').textContent(); check('not an admin: where the price is from, and no way to the settings closed to him', await page.locator('.at-ep-tariff button').count() === 0 && /без НДС\.$/.test(text) && !/Свой тариф|Настройка/.test(text), text); }, { admin: false });
// ----- round 2 of the audit of 09.11.2026 -----
const bare = async ({ w = 1070, h = 764, scenario = 'now', touch = false, tz = 'Europe/Chisinau', init, clock, hash = '#energy', wait = '.at-ep-hero' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, timezoneId: tz }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  if (clock) await page.clock.install({ time: clock }); else await page.addInitScript(pageClock, nowOf(scenario)); if (init) await page.addInitScript(init);
  await page.goto(`${originOf(scenario)}/?card=energy&scenario=${scenario}&theme=light&lang=ru${hash}`); await page.waitForFunction(() => window.ready); if (wait) await page.waitForSelector(wait, { timeout: 8000 }).catch(() => errors.push(`never showed ${wait}`));
  return { page, ctx, errors };
};
// a 4K monitor (the shell is drawn 1,5×) and a 5K2K one: the chart marks the point under the pointer, and a tap on a bar picks that bar. The mark
// ran half as far again as the pointer (797 → 910, 1136 → 1422 px), and a click on Tuesday's bar picked nothing
for (const [w, h] of [[3840, 2160], [5120, 2160], [1920, 1080]]) {
  const { page, ctx, errors } = await bare({ w, h, scenario: 'evening' }); await page.waitForTimeout(900);
  const zoom = Number(await page.evaluate(() => getComputedStyle(document.querySelector('.hm-shell')).zoom)); check(`${w}x${h}: the shell's zoom is ${w > 2560 ? '1,5' : '1'}`, zoom === (w > 2560 ? 1.5 : 1), zoom);
  await page.locator('.at-ep-plot').scrollIntoViewIfNeeded(); const box = await page.locator('.at-ep-plot svg').boundingBox(), off = [];
  for (const f of [0.08, 0.12, 0.2, 0.35, 0.5, 0.6]) { const x = box.x + box.width * f; await page.mouse.move(x, box.y + box.height / 2); await page.waitForTimeout(60); const line = await page.locator('.at-ep-cross line').boundingBox(); off.push(line ? Math.round(Math.abs(line.x + line.width / 2 - x)) : 999); }
  check(`${w}x${h}: the day's mark is under the pointer (within a 5-minute slot)`, off.every(d => d <= Math.ceil(box.width / 288) + 2), off);
  await page.click('.at-ep-periods button:nth-child(2)'); await page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); await page.waitForTimeout(900); await page.locator('.at-ep-plot').scrollIntoViewIfNeeded();
  const hits = page.locator('.at-ep-bar .at-ep-hit'), n = await page.locator('.at-ep-bar').count(), picked = [];
  for (let i = 0; i < n; i++) { const r = await hits.nth(i).boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height - 6); await page.waitForTimeout(80); picked.push(await page.evaluate(() => [...document.querySelectorAll('.at-ep-bar')].findIndex(b => b.classList.contains('is-pick')))); }
  check(`${w}x${h}: a click on each bar of the week picks that bar`, n >= 2 && picked.every((k, i) => k === i), picked);
  check(`${w}x${h}: errors`, !errors.length, errors); if (w === 3840) await page.screenshot({ path: `${out}/zoom-4k-week.png` }); await ctx.close();
}
// the feed's meter silent and not caught up: no share is printed (it was «Кухня 2,1 кВт·ч · 110 %», and «0 %» beside 2,1 kWh), the block says why,
// and its total is never below what its rooms used
const kwhOf = s => ru2(s.match(/[\d\s\u00a0]+(?:,\d+)?(?=\s*кВт·ч)/)?.[0] ?? 'x');
for (const scenario of ['offline', 'oneSilent', 'longSilent', 'now', 'silentHours']) await state(scenario, async page => {
  const r = await page.evaluate(() => ({ total: document.querySelector('.at-ep-rooms-total b')?.textContent ?? '', note: document.querySelector('.at-ep-shares')?.textContent ?? null, rows: [...document.querySelectorAll('.at-ep-room')].map(x => ({ rest: x.classList.contains('is-rest'), kwh: x.querySelector('.at-ep-room-line span').textContent, pct: x.querySelector('.at-ep-room-line small').textContent, bar: parseFloat(x.querySelector('.at-ep-meter i').style.width) })) }));
  const rooms = r.rows.filter(x => !x.rest), sumRooms = rooms.reduce((a, x) => a + kwhOf(x.kwh), 0), pcts = r.rows.map(x => x.pct ? ru2(x.pct) : null), silent = ['offline', 'oneSilent', 'longSilent'].includes(scenario);
  check(`rooms ${scenario}: no share above 100 %, no «0 %» beside a room that used energy`, pcts.every(v => v === null || v <= 100) && rooms.every((x, i) => !(kwhOf(x.kwh) >= 0.1 && pcts[i] === 0)), r.rows);
  check(`rooms ${scenario}: the total is not below the rooms' sum`, kwhOf(r.total) >= sumRooms - 0.16, { total: r.total, sumRooms });
  check(`rooms ${scenario}: every bar within its track`, r.rows.every(x => x.bar >= 0 && x.bar <= 100), r.rows.map(x => x.bar));
  if (silent) check(`rooms ${scenario}: the meter was silent — no per cent at all, the block says so, «Без своего датчика» is «—» not 0`, pcts.every(v => v === null) && /молчал/.test(r.note ?? '') && r.rows.find(x => x.rest)?.kwh === '—', r);
  else check(`rooms ${scenario}: shares as before, adding up to 100 %`, r.note === null && pcts.every(v => v !== null) && Math.abs(pcts.reduce((a, v) => a + v, 0) - 100) <= r.rows.length, r);
});
{ // while the statistics are read: the words are ON the screen in the chart card (they were in a visually hidden span: two blank cards for 9 s)
  const { page, ctx, errors } = await bare({ wait: null, init: () => { window.__beforeDraw = h => { const f = h.statistics; h.statistics = function (...a) { return new Promise(r => setTimeout(r, 2500)).then(() => f.apply(this, a)); }; }; } });
  await page.waitForSelector('.at-ep-skel.is-chart'); const seen = await page.evaluate(() => { const card = document.querySelector('.at-ep-skel.is-chart'), p = [...card.querySelectorAll('*')].find(e => e.textContent.trim() === 'Загружаю статистику'); if (!p) return { text: card.textContent }; const r = p.getBoundingClientRect(), c = card.getBoundingClientRect(), st = getComputedStyle(p); return { w: r.width, h: r.height, inside: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom, clip: st.clip, clipPath: st.clipPath, hidden: st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0, busy: document.querySelector('.at-ep').getAttribute('aria-busy') }; });
  check('loading: «Загружаю статистику» is visible text inside the chart card', seen.w > 60 && seen.h >= 12 && seen.inside && seen.clip === 'auto' && seen.clipPath === 'none' && !seen.hidden && seen.busy === 'true', seen);
  await page.screenshot({ path: `${out}/loading.png` }); await page.waitForSelector('.at-ep-hero', { timeout: 9000 }); check('loading: then the report', await page.locator('.at-ep-skel').count() === 0); check('loading: errors', !errors.length, errors); await ctx.close();
}
{ // a screen with a finger only is not told about arrow keys and Esc; the chart's own description (for a keyboard attached to anything) keeps them
  const t = await bare({ touch: true, w: 360, h: 792 }), m = await bare({ touch: false });
  const read = page => page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches, seen: document.querySelector('.at-ep-readout').textContent, said: document.getElementById('at-ep-hint').textContent })), a = await read(t.page), b = await read(m.page);
  check('touch only: the visible hint names no keys, the description does', a.coarse && !/←|Esc/.test(a.seen) && /Проведите/.test(a.seen) && /←/.test(a.said), a);
  check('a mouse and a keyboard: the hint names the keys', !b.coarse && /←/.test(b.seen) && /Esc/.test(b.seen), b);
  await t.page.click('.at-ep-periods button:nth-child(2)'); await t.page.waitForSelector('.at-ep[data-period="week"] .at-ep-hero'); const bars = await read(t.page); check('touch only: the bars\' hint too', !/←|Esc/.test(bars.seen) && /Нажмите на столбец/.test(bars.seen), bars);
  await t.ctx.close(); await m.ctx.close();
}
{ // the house's zone comes from the host (Home Assistant's config), not from a read of the panel's own: a browser in New York at 18:30 of the 5th
  // shows the house's day, already the 6th — at once, and with no `get_config` sent
  const { page, ctx, errors } = await bare({ tz: 'America/New_York', clock: new Date(Date.UTC(2026, 10, 5, 23, 30)), init: () => { window.__timeZone = 'Europe/Chisinau'; }, wait: '.at-ep-nav h2' });
  const title = await page.locator('.at-ep-nav h2').textContent(), asked = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.service === 'get_config').length);
  check('a browser in another zone: «Сегодня» is the house\'s day', title === 'Сегодня, 6 ноября', title); check('…and the panel asks Home Assistant\'s settings no second time', asked === 0, asked);
  check('another zone: errors', !errors.filter(e => !/never showed/.test(e)).length, errors); await ctx.close();
}
{ // the focus stays on the control that was pressed: the panel's own «Обзор» tab, and the button one left the panel by when «Back» returns to it
  const { page, ctx } = await bare(); await page.focus('.rm-energy-tabs button:nth-child(2)'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.focus('.rm-energy-tabs button:nth-child(1)'); await page.keyboard.press('Enter'); await page.waitForSelector('.at-ep-hero'); await page.waitForTimeout(300);
  check('«Обзор» pressed from the keyboard keeps the focus (the title took it)', await page.evaluate(() => document.activeElement === document.querySelector('.rm-energy-tabs button:nth-child(1)')), await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent?.slice(0, 20)}`));
  // leave by the menu from the keyboard, come «Back»: the place that was pressed still has the focus (the period's title took it) — since 1.27.0
  // «Энергия» is a page of the menu of its own, with no tabs of «Системы» over it, so one leaves it by the menu
  await page.locator('.hm-sidebar nav button', { hasText: 'Устройства' }).focus(); const tab = await page.evaluate(() => document.activeElement.textContent); await page.keyboard.press('Enter'); await page.waitForFunction(() => !location.hash.startsWith('#energy')); await page.waitForTimeout(300);
  await page.goBack(); await page.waitForSelector('.at-ep-hero'); await page.waitForTimeout(400);
  check('«Back» to the panel: the focus stays on the menu place that was pressed, not on the period\'s title', await page.evaluate(() => document.activeElement?.closest('.hm-sidebar nav') ? document.activeElement.textContent : null) === tab, await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent?.slice(0, 30)}`));
  await page.locator('.hm-sidebar nav button').last().focus(); await page.keyboard.press('Tab'); // …and the panel is still reached by Tab, right after the menu's last place
  check('…and Tab goes on into the panel', await page.evaluate(() => !!document.activeElement?.closest('.hm-page')), await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
  await ctx.close();
}
// 4. the tile on the home face, in every scenario and on the small tiles
for (const scenario of ['now', 'charging', 'offline', 'oneSilent', 'fresh']) for (const [w, h] of [[1070, 764], [320, 640], [792, 360]]) { const { page, ctx, errors } = await open({ scenario, hash: '#home', w, h }); const l = await layout(page, '.at-energy-tile'); check(`tile layout ${scenario} ${w}x${h}`, !l.length, l); check(`tile errors ${scenario} ${w}x${h}`, !errors.length, errors); await ctx.close(); }
{ // the owner: now → today → month every 4 s; the tile's today and month are the panel's
  const { page, ctx } = await open({ hash: '#home' }), sub = () => page.locator('.at-energy-tile small').textContent(), seq = [await sub()];
  for (let i = 0; i < 2; i++) { await page.waitForTimeout(4150); seq.push(await sub()); }
  check('the tile rolls now → today → month', seq[0] === 'сейчас' && seq[1] === 'сегодня' && /^за \p{L}+/u.test(seq[2]), seq);
  const label = await page.locator('.at-energy-tile .ah-tile-hit').getAttribute('aria-label'), today = label.match(/(\d[\d\s\u00a0]*(?:,\d+)?) кВт·ч сегодня/)?.[1], month = label.match(/(\d[\d\s\u00a0]*(?:,\d+)?) кВт·ч за/)?.[1], nowW = label.match(/: (\d[\d\s\u00a0]*(?:,\d+)? к?Вт) сейчас/)?.[1];
  await page.click('.at-energy-tile .ah-tile-hit'); await page.waitForSelector('.at-ep-hero');
  check('the panel is the #energy route, not a sheet', /^#energy/.test(await page.evaluate(() => location.hash)) && await page.locator('.hm-sheet').count() === 0);
  check('opening the panel from the tile puts the focus on its title', await page.evaluate(() => document.activeElement === document.querySelector('.at-ep-nav h2')));
  const day = await page.locator('.at-ep-hero .at-ep-big .ah-tick').first().textContent(), heroNow = (await page.locator('.at-ep-now .at-ep-big.is-now').innerText()).replace(/\s+/g, ' ').trim();
  check('one «now»: the tile\'s figure is the panel\'s, unit and all', !!nowW && nowW.replace(/\s+/g, ' ') === heroNow, { nowW, heroNow });
  await page.click('.at-ep-periods button:nth-child(3)'); await page.waitForSelector('.at-ep[data-period="month"] .at-ep-hero'); await page.waitForTimeout(400); const mon = await page.locator('.at-ep-hero .at-ep-big .ah-tick').first().textContent();
  check('the tile\'s today and month are the panel\'s', today === day && month === mon, { today, day, month, mon }); await ctx.close();
}
{ const { page, ctx } = await open({ hash: '#home', reduced: true }); await page.waitForTimeout(4500); check('reduced motion: the tile stays on «сейчас», no dots', await page.locator('.at-energy-tile small').textContent() === 'сейчас' && await page.locator('.at-energy-dots').count() === 0); await ctx.close(); }
{ const { page, ctx } = await open({ hash: '#home', scenario: 'oneSilent' }); const txt = await page.locator('.at-energy-tile').innerText(); check('one silent channel: «нет связи», never a partial sum', /нет связи/.test(txt) && !/\d/.test(txt), txt); await ctx.close(); }
await browser.close(); stop(fails.length ? 1 : 0);
