// The room page's commands and words in one run, in the shared card preview (its host records every command and reaches nothing) — audit 2026-11-09:
// the valve's button works and asks first, the quick buttons go through the command runner (a refusal is told, a double tap is one command,
// nothing leaves while the house is offline), every «подробнее» opens something, a room with silent sensors does not say «Всё в порядке».
// usage: node scripts/qa-room.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/room'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const port = await freePort(), server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 300)}`); };
const stop = async code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); await browser.close().catch(() => {}); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); void stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); void stop(1); });
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
async function open({ card = 'rooms', scenario = 'live', room, w = 1070, h = 764, lang = 'ru', accept = false, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=${card}&scenario=${scenario}&theme=${theme}&lang=${lang}#rooms${room ? `?room=${room}` : ''}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  if (room) await page.waitForSelector('.rm-page'); await page.evaluate(a => window.atomPreview.host.setAccept(a), accept); await page.waitForTimeout(300);
  return { page, ctx, errors };
}
const sent = page => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => ({ c: `${x.domain}.${x.service}`, id: x.data?.entity_id })));
const toast = page => page.locator('.hm-toast').innerText().catch(() => '');
// 1. the valve on its room's page, by the owner's rule (ROUND-2 «Decided», as in «Безопасность»): shutting the water is ONE tap and never asks,
// opening always asks («Вода пойдёт сразу»). The check that stood here before round 2 expected a question on closing too — it was written
// against the wrong rule (it followed the sheet's `confirm` flag); it now tests the rule itself.
for (const [scenario, label, service, ask] of [['disarmed', 'Перекрыть воду', 'valve.close_valve', null], ['leak', 'Открыть воду', 'valve.open_valve', /Вода пойдёт сразу/]]) for (const [w, h, dev] of [[1070, 764, 'pad'], [360, 792, '13R']]) {
  const { page, ctx, errors } = await open({ card: 'security', scenario, room: 'vannaia', w, h, accept: true }), tag = `${scenario}/${dev}`;
  const btn = page.locator('.rm-tile-act', { hasText: label });
  check(`valve button «${label}» ${tag}`, await btn.count() === 1, await page.locator('.rm-tile-act').allInnerTexts());
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(300);
    const q = await page.locator('.hm-confirm').count() ? await page.locator('.hm-confirm').innerText() : '', first = await sent(page);
    if (ask) { check(`opening the water asks first and sends nothing ${tag}`, ask.test(q) && first.length === 0, q || first);
      if (dev === 'pad') await page.screenshot({ path: `${out}/valve-${scenario}-ask.png` });
      /* during a leak the shell's prominent button is the safe one («Оставить закрытым»): «yes» is found by its words */ await page.locator('.hm-confirm .hm-pill', { hasText: /^Открыть/ }).click().catch(() => {}); await page.waitForTimeout(300); const l = await sent(page);
      check(`valve «yes» sends ${service} ${tag}`, l.length === 1 && l[0].c === service && /^valve\./.test(l[0].id), l); }
    else { check(`shutting the water is one tap: no question, ${service} at once ${tag}`, q === '' && first.length === 1 && first[0].c === service && /^valve\./.test(first[0].id), [q, first]);
      const mid = await btn.evaluate(b => ({ busy: b.getAttribute('aria-busy'), off: b.getAttribute('aria-disabled'), hard: b.disabled })); await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(200);
      check(`…the button waits for the valve (aria-busy, not disabled) and a second tap sends nothing more ${tag}`, mid.busy === 'true' && mid.off === 'true' && !mid.hard && (await sent(page)).length === 1, [mid, await sent(page)]); } }
  check(`errors valve ${tag}`, !errors.length, errors); await ctx.close();
}
// 2. the device buttons of a room (TV, set-top box, speaker, kettle): a refusal is told and leaves no unhandled rejection; a double tap is one
// command and the button waits; without the connection nothing leaves and the person is told
{ const { page, ctx, errors } = await open({ room: 'gostinaia' }), acts = page.locator('.rm-tile-act'), n = await acts.count();
  check('the living room has device buttons', n > 0, n);
  const media = page.locator('.rm-tile', { has: page.locator('.rm-tile-act', { hasText: /^(Включить|Выключить|Пауза|Продолжить)$/ }) }).filter({ hasNot: page.locator('.rm-tile-ic [data-icon="light"]') });
  const btn = (await media.count() ? media.first() : page.locator('.rm-tile').filter({ has: acts }).first()).locator('.rm-tile-act');
  await btn.click(); await page.waitForTimeout(400); const l = await sent(page);
  check('a refused device command is told', l.length === 1 && /\S/.test(await toast(page)) && !/object Object|preview:/.test(await toast(page)), [l, await toast(page)]);
  check('…and leaves no unhandled rejection', !errors.length, errors); await page.screenshot({ path: `${out}/device-refused.png` });
  await page.evaluate(() => { window.atomPreview.host.log.length = 0; window.atomPreview.host.setAccept(true); window.atomPreview.host.setDelay(900); });
  await btn.dblclick(); await page.waitForTimeout(250); const mid = await btn.evaluate(b => ({ busy: b.getAttribute('aria-busy'), off: b.getAttribute('aria-disabled'), hard: b.disabled }));
  await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(1300); const two = await sent(page);
  // round 2 (f0/f69): a waiting button is `aria-disabled` + `aria-busy` and ignores the press — a real `disabled` dropped the keyboard's focus to nowhere
  check('a double tap on a device button is one command', two.length === 1, two); check('…and the button waits meanwhile (aria-disabled, not disabled)', mid.busy === 'true' && mid.off === 'true' && mid.hard === false, mid);
  await page.evaluate(() => { window.atomPreview.host.log.length = 0; }); await btn.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  check('keyboard: the focus stays on the device button while its command is on its way', await btn.evaluate(b => b === document.activeElement && b.getAttribute('aria-busy') === 'true') && (await sent(page)).length === 1, await page.evaluate(() => document.activeElement?.className));
  await page.waitForTimeout(1200); check('keyboard: …and afterwards', await btn.evaluate(b => b === document.activeElement));
  await page.evaluate(() => { window.atomPreview.host.log.length = 0; window.atomPreview.host.setDelay(0); window.atomPreview.setOnline(false); }); await page.waitForTimeout(200);
  // round 2 (f56, l187): offline the button carries the state as ARIA, a press sends nothing AND the person is told why
  const offl = await btn.evaluate(b => ({ soft: b.getAttribute('aria-disabled'), hard: b.disabled }));
  await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(300);
  check('offline: a device button sends nothing', (await sent(page)).length === 0, await sent(page));
  check('offline: …it is aria-disabled, and the press says «Нет связи с домом»', offl.soft === 'true' && offl.hard === false && /Нет связи с домом/.test(await toast(page)), [offl, await toast(page)]);
  const quick = await page.evaluate(() => [...document.querySelectorAll('.rm-q')].map(b => ({ soft: b.getAttribute('aria-disabled'), hard: b.disabled })));
  check('offline: every one-tap tile of the room is aria-disabled', quick.length > 0 && quick.every(q => q.soft === 'true' || q.hard), quick);
  await page.evaluate(() => { const t = document.querySelector('.hm-toast'); if (t) t.textContent = ''; }); await page.locator('.rm-q:not(.is-vac)').first().click({ force: true }).catch(() => {}); await page.waitForTimeout(300);
  check('offline: a one-tap tile sends nothing and says why', (await sent(page)).length === 0 && /Нет связи с домом/.test(await toast(page)), [await sent(page), await toast(page)]);
  await page.screenshot({ path: `${out}/room-offline.png` }); check('errors device buttons', !errors.length, errors); await ctx.close(); }
// 2a. round 2 (l50, l101, l110): a one-tap tile says and does what the device's card below does
{ const { page, ctx, errors } = await open({ room: 'gostinaia', accept: true }); const tv = page.locator('.rm-q', { hasText: 'Телевизор' }), card = page.locator('.rm-tile', { hasText: 'Телевизор' }).first();
  const word = async () => (await tv.locator('small').innerText()), status = async () => (await card.locator('.rm-tile-name small').innerText());
  check('TV in standby: the quick tile says what the card says («Спит (ожидание)»), not «Выкл.»', await word() === 'Спит (ожидание)' && await status() === await word(), [await word(), await status()]);
  check('…its name tells the action, and it is not a toggle that reads «off»', /Выключить/.test(await tv.getAttribute('aria-label') ?? '') && (await tv.getAttribute('aria-pressed')) === null, await tv.getAttribute('aria-label'));
  await tv.click(); await page.waitForTimeout(300); const l = await sent(page);
  check('…and a tap sends what the card\'s button sends: turn_off', l.length === 1 && l[0].c === 'media_player.turn_off' && l[0].id === 'media_player.living_tv' && (await card.locator('.rm-tile-act').innerText()) === 'Выключить', l);
  await page.evaluate(() => window.atomPreview.setStates({ 'media_player.living_tv': 'unavailable' })); await page.waitForTimeout(250);
  check('an unavailable TV: the quick tile says «Нет связи» like its card, and is off', await word() === 'Нет связи' && await status() === 'Нет связи' && await tv.evaluate(b => b.disabled), [await word(), await status()]);
  const lamp = page.locator('.rm-q', { hasText: 'Свет' }).first(); check('a switched-off lamp\'s quick tile says «Выкл.» (the short pair fits the tile at any font size)', (await lamp.locator('small').innerText()) === 'Выкл.', await lamp.locator('small').innerText());
  check('errors quick tiles', !errors.length, errors); await ctx.close(); }
// 3. «Убрать <комнату>»: the same guarantees
{ const { page, ctx, errors } = await open({ room: 'kukhnia' }), vac = page.locator('.rm-q.is-vac');
  check('the kitchen has «Убрать»', await vac.count() === 1);
  if (await vac.count()) {
    await vac.click(); await page.waitForTimeout(400); const l = await sent(page);
    check('a refused «Убрать» is told, with no unhandled rejection', l.length === 1 && l[0].c === 'vacuum.clean_area' && /\S/.test(await toast(page)) && !errors.length, [l, await toast(page), errors]);
    await page.evaluate(() => { window.atomPreview.host.log.length = 0; window.atomPreview.host.setAccept(true); window.atomPreview.host.setDelay(900); });
    await vac.dblclick(); await page.waitForTimeout(250); const off = await vac.evaluate(b => b.getAttribute('aria-disabled') === 'true' && b.getAttribute('aria-busy') === 'true' && !b.disabled); await page.waitForTimeout(1200); const two = await sent(page);
    check('a double tap on «Убрать» is one command, the button waits (aria-disabled, not disabled)', two.length === 1 && off, [two, off]);
    // round 2 (l49): the robot answers seconds later — the button waits until its phase changes (as its own panel does), not just for the house's «ok»
    await page.waitForTimeout(800); check('«Убрать» still waits after the house answered, until the robot starts', await vac.getAttribute('aria-busy') === 'true');
    await vac.click({ force: true }).catch(() => {}); await page.waitForTimeout(200); check('…and a tap meanwhile sends nothing more', (await sent(page)).length === 1, await sent(page));
    await page.evaluate(() => window.atomPreview.setStates({ 'vacuum.living_robot_vacuum': 'cleaning' })); await page.waitForTimeout(400);
    check('the robot started: no more waiting, the tile says «Уже убирает» and is off', await vac.getAttribute('aria-busy') === null && await vac.getAttribute('aria-disabled') === 'true' && /Уже убирает/.test(await vac.innerText()), await vac.innerText());
    await page.evaluate(() => { window.atomPreview.host.log.length = 0; window.atomPreview.setStates({ 'vacuum.living_robot_vacuum': 'returning' }); }); await page.waitForTimeout(300);
    check('while the robot drives home «Убрать» is off too and says so', await vac.getAttribute('aria-disabled') === 'true' && /Едет на базу/.test(await vac.innerText()), await vac.innerText());
    await vac.click({ force: true }).catch(() => {}); await page.waitForTimeout(200); check('…a tap then sends nothing', (await sent(page)).length === 0, await sent(page));
    await page.evaluate(() => window.atomPreview.setStates({ 'vacuum.living_robot_vacuum': 'docked' })); await page.waitForTimeout(300);
    await page.evaluate(() => { window.atomPreview.host.log.length = 0; window.atomPreview.setOnline(false); }); await page.waitForTimeout(200); await vac.click({ force: true }).catch(() => {}); await page.waitForTimeout(300);
    check('offline: «Убрать» sends nothing', (await sent(page)).length === 0, await sent(page)); }
  check('errors «Убрать»', !errors.length, errors); await ctx.close(); }
// 4. every «подробнее» of every room opens something; a card with nothing to open is not a button
for (const card of ['rooms', 'security']) {
  const first = await open({ card, scenario: card === 'rooms' ? 'live' : 'disarmed', w: 1440, h: 900 }), rooms = await first.page.locator('.hm-room-grid.is-page .at-room').count(); await first.ctx.close();
  check(`rooms listed (${card})`, rooms > 3, rooms); let opened = 0; const dead = [];
  for (let i = 0; i < rooms; i++) {
    const { page, ctx, errors } = await open({ card, scenario: card === 'rooms' ? 'live' : 'disarmed', w: 1440, h: 900 }); const tile = page.locator('.hm-room-grid.is-page .at-room').nth(i), title = await tile.getAttribute('title'); await tile.click();
    const shown = await page.waitForSelector('.rm-page', { timeout: 8000 }).then(() => true, () => false); check(`the room «${title}» opens its page (${card})`, shown, await page.evaluate(() => location.hash)); if (!shown) { await ctx.close(); continue; } await page.waitForTimeout(300);
    const name = await page.locator('.hm-head-title h1').innerText(), tiles = await page.locator('.rm-tile-open').count();
    for (let k = 0; k < tiles; k++) { const b = page.locator('.rm-tile-open').nth(k), label = await b.getAttribute('aria-label'); await b.click(); await page.waitForTimeout(250);
      const ok = await page.evaluate(() => /device=/.test(location.hash) && !!document.querySelector('.hm-sheet')); if (ok) opened++; else dead.push(`${name}: ${label}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200); if (await page.evaluate(() => /device=/.test(location.hash))) { await page.goBack(); await page.waitForTimeout(200); } }
    check(`errors room ${name} (${card})`, !errors.length, errors); await ctx.close();
  }
  check(`every «подробнее» opens a sheet (${card}: ${opened} opened)`, dead.length === 0 && opened > 0, dead);
}
// 5. the words: a room whose sensors are all silent is not «Всё в порядке»; the labels of the readings are at least 12 px
{ const { page, ctx, errors } = await open({ room: 'gostinaia' }); const before = await page.locator('.rm-hero-main').innerText();
  // every sensor of the room stops answering, as HA would send it
  const ids = await page.evaluate(async room => { const h = window.atomPreview.host, r = await h.registry(), area = new Map(r.devices.map(d => [d.id, d.area_id])), st = h.states(); return r.entities.filter(e => (e.area_id ?? area.get(e.device_id)) === room && /^(sensor|binary_sensor)\./.test(e.entity_id) && st[e.entity_id]).map(e => e.entity_id); }, 'gostinaia');
  await page.evaluate(list => window.atomPreview.setStates(Object.fromEntries(list.map(i => [i, 'unavailable']))), ids); await page.waitForTimeout(250);
  const hero = await page.locator('.rm-hero').innerText(), cls = await page.locator('.rm-hero').getAttribute('class');
  check('a room with every sensor silent says so, not «Всё в порядке»', ids.length > 0 && /Датчики не на связи/.test(hero) && !/Всё в порядке/.test(hero) && /is-muted/.test(cls), [before, hero, cls]);
  await page.screenshot({ path: `${out}/room-silent.png` }); check('errors silent room', !errors.length, errors); await ctx.close(); }
// 5a. round 2 (f21, f22, l110, l111): the hero's words
{ const { page, ctx, errors } = await open({ card: 'security', scenario: 'disarmed', room: 'vannaia' });
  await page.evaluate(() => window.atomPreview.setStates({ 'binary_sensor.bath_leak_water_leak': 'unknown' })); await page.waitForTimeout(250); let hero = await page.locator('.rm-hero').innerText();
  check('a leak sensor in `unknown` waits for its first alarm: calm, no dash, no «не на связи»', /Всё в порядке/.test(hero) && /Ждёт первого срабатывания\nПротечка/.test(hero) && !/не на связи|—/.test(hero) && /is-ok/.test(await page.locator('.rm-hero').getAttribute('class')), hero);
  await page.screenshot({ path: `${out}/leak-waits.png` });
  await page.evaluate(() => window.atomPreview.setStates({ 'binary_sensor.bath_leak_water_leak': 'unavailable' })); await page.waitForTimeout(250); hero = await page.locator('.rm-hero').innerText();
  check('an unavailable leak sensor «Не отвечает», and the room does not say «Всё в порядке»', /Не отвечает\nПротечка/.test(hero) && !/Всё в порядке|Сухо/.test(hero) && /Часть датчиков не на связи/.test(hero), hero);
  check('errors leak words', !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await open({ card: 'security', scenario: 'disarmed', room: 'kukhnia' }); const before = await page.locator('.rm-hero').innerText();
  await page.evaluate(() => window.atomPreview.setStates({ 'binary_sensor.kitchen_window_left_contact': 'unavailable' })); await page.waitForTimeout(250);
  const hero = await page.locator('.rm-hero').innerText(), cell = await page.evaluate(() => { const li = [...document.querySelectorAll('.rm-hero-cells li')].find(x => /Окна/.test(x.textContent)); return li ? { text: li.querySelector('b').textContent, cls: li.className } : null; });
  check('one silent window of three: the cell counts it, amber — not plain «Закрыты»', /Закрыты/.test(before) && cell?.text === 'Закрыты · 1 без связи' && /is-warn/.test(cell.cls), [cell, hero]);
  check('…and the verdict does not say «Всё в порядке» (nor that and its opposite at once)', !/Всё в порядке/.test(hero) && /Часть датчиков не на связи/.test(hero), hero);
  await page.screenshot({ path: `${out}/window-part-silent.png` });
  await page.evaluate(() => window.atomPreview.setStates({ 'binary_sensor.kitchen_leak_sink_water_leak': 'unavailable', 'binary_sensor.kitchen_window_left_contact': 'off' })); await page.waitForTimeout(250);
  check('one silent leak sensor of two is not plain «Сухо»', /Сухо · 1 без связи\nПротечка/.test(await page.locator('.rm-hero').innerText()), await page.locator('.rm-hero').innerText());
  check('errors part silent', !errors.length, errors); await ctx.close(); }
{ const { page, ctx } = await open({ room: 'gostinaia' }); const had = await page.locator('.rm-hero-main > b').count();
  const ids = await page.evaluate(() => Object.keys(window.atomPreview.host.states()).filter(id => /^sensor\./.test(id) && window.atomPreview.host.states()[id].attributes.device_class === 'temperature'));
  await page.evaluate(list => window.atomPreview.setStates(Object.fromEntries(list.map(i => [i, 'unavailable']))), ids); await page.waitForTimeout(250);
  const main = await page.locator('.rm-hero-main').innerText(); check('a room without a temperature reading shows no «— °» number at all', had === 1 && await page.locator('.rm-hero-main > b').count() === 0 && !/—\s*°|°/.test(main.split('\n')[0]), main); await ctx.close(); }
{ const { page, ctx } = await open({ room: 'gostinaia' }); const px = await page.evaluate(() => [...document.querySelectorAll('.rm-hero-cells small')].map(e => parseFloat(getComputedStyle(e).fontSize)));
  check('the reading labels are at least 12 px', px.length > 0 && px.every(v => v >= 12), px); await ctx.close(); }
for (const lang of ['ru', 'en', 'ro']) { const { page, ctx, errors } = await open({ card: 'security', scenario: 'leak', room: 'vannaia', lang }); const t = await page.locator('.rm-page').innerText();
  check(`no raw keys ${lang}`, !/\broom\.[a-z]/.test(t), t.match(/room\.[\w.]+/g)); check(`errors ${lang}`, !errors.length, errors); await ctx.close(); }

// 6. release classic, step 4 — studio ST-01: the room's lamp says its BULB's state (the device's backlight and night-light flag answer on their own)
// and sends nothing to a bulb that does not answer. The house changes both its live states (what a command reads) and the registry (what is drawn).
const setBoth = (page, over) => page.evaluate(o => { const s = window.atomPreview.host.states(); for (const [id, v] of Object.entries(o)) if (s[id]) s[id] = { ...s[id], state: v }; window.atomPreview.setStates(o); }, over);
const lampQ = page => page.locator('.rm-q', { hasText: /Люстра|Chandelier|Candelabru|Lustră/ }).first();
const qState = page => lampQ(page).evaluate(b => ({ word: b.querySelector('small')?.textContent ?? '', disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), soft: b.getAttribute('aria-disabled') }));
const clear = page => page.evaluate(() => { window.atomPreview.host.log.length = 0; });
const centre = async loc => { const r = await loc.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
{ const { page, ctx, errors } = await open({ scenario: 'evening', room: 'detskaia', w: 360, h: 792, accept: true });
  check('ST-01: the children\'s room has its lamp in the one-tap row, lit', (await qState(page)).word === 'Вкл.' && (await qState(page)).pressed === 'true', await qState(page));
  await setBoth(page, { 'light.kids_chandelier': 'unavailable' }); await page.waitForTimeout(250); await clear(page);
  const silent = await qState(page), live = await page.evaluate(() => ['light.kids_chandelier_ambient', 'binary_sensor.kids_chandelier_nightlight'].map(id => window.atomPreview.host.states()[id]?.state));
  check('ST-01: the bulb silent while its backlight answers — «Нет связи», disabled, no aria-pressed (never «Выкл.»)', silent.word === 'Нет связи' && silent.disabled && silent.pressed === null && live.every(s => s && s !== 'unavailable'), { silent, live });
  const [x, y] = await centre(lampQ(page)); await page.mouse.click(x, y); await page.waitForTimeout(300);
  check('ST-01: …a press on it sends nothing', (await sent(page)).length === 0, await sent(page));
  const tv = page.locator('.rm-q', { hasText: 'Телевизор' }); await tv.click(); await page.waitForTimeout(300);
  check('ST-01: …the TV beside it keeps working (one command)', (await sent(page)).length === 1 && /^media_player\./.test((await sent(page))[0].c), await sent(page));
  await page.screenshot({ path: `${out}/st01-silent-bulb-360.png` });
  await setBoth(page, { 'light.kids_chandelier': 'on' }); await page.waitForTimeout(250); const back = await qState(page);
  check('ST-01: the bulb answers again — «Вкл.», pressed, enabled, without a reload', back.word === 'Вкл.' && back.pressed === 'true' && !back.disabled, back);
  await clear(page); await lampQ(page).click(); await page.waitForTimeout(300);
  check('ST-01: …and a tap on a lit lamp is one turn_off', JSON.stringify(await sent(page)) === JSON.stringify([{ c: 'light.turn_off', id: 'light.kids_chandelier' }]), await sent(page));
  await setBoth(page, { 'light.kids_chandelier': 'off' }); await page.waitForTimeout(250); const dark = await qState(page); await clear(page); await lampQ(page).click(); await page.waitForTimeout(300);
  check('ST-01: an «off» lamp says «Выкл.», aria-pressed false, and a tap is one turn_on', dark.word === 'Выкл.' && dark.pressed === 'false' && JSON.stringify(await sent(page)) === JSON.stringify([{ c: 'light.turn_on', id: 'light.kids_chandelier' }]), { dark, sent: await sent(page) });
  await setBoth(page, { 'light.kids_chandelier': 'unavailable', 'light.kids_chandelier_ambient': 'unavailable', 'binary_sensor.kids_chandelier_nightlight': 'unavailable' }); await page.waitForTimeout(250);
  const gone = await lampQ(page).count() ? await qState(page) : null;
  check('ST-01: every entity of the room\'s only lamp silent — the lamp stays in the row as «Нет связи» (it has no other card)', !!gone && gone.word === 'Нет связи' && gone.disabled && gone.pressed === null, gone);
  check('errors ST-01 silent', !errors.length, errors); await ctx.close(); }
for (const [lang, theme, word] of [['ru', 'light', 'Нет данных'], ['en', 'dark', 'No data'], ['ro', 'light', 'Fără date']]) {
  const { page, ctx, errors } = await open({ scenario: 'evening', room: 'detskaia', w: 360, h: 792, lang, theme, accept: true });
  await setBoth(page, { 'light.kids_chandelier': 'unknown' }); await page.waitForTimeout(250); await clear(page); const q = await qState(page);
  await lampQ(page).click(); await page.waitForTimeout(300);
  check(`ST-01 ${lang}/${theme}: the bulb answers without a state — «${word}», no aria-pressed, pressable: one light.turn_on`, q.word === word && q.pressed === null && !q.disabled && JSON.stringify(await sent(page)) === JSON.stringify([{ c: 'light.turn_on', id: 'light.kids_chandelier' }]), { q, sent: await sent(page) });
  if (lang === 'ru') await page.screenshot({ path: `${out}/st01-unknown-360.png` });
  check(`errors ST-01 unknown ${lang}`, !errors.length, errors); await ctx.close(); }

// 7. release classic, step 4 — studio ST-02: the room's only lamp has no card below (its card would repeat the one-tap tile), so its brightness
// sheet is opened from the tile itself, the way a lamp's tile opens it on «Главная» and in «Свет»: a long press, a right click, the menu key.
// The tap stays the power; opening sends nothing; the sheet is the lamp's own; Escape / «Назад» bring the room back with the focus on the tile.
const where2 = page => page.evaluate(() => ({ hash: decodeURIComponent(location.hash), sheet: !!document.querySelector('.hm-sheet'), title: document.querySelector('.hm-sheet h2')?.textContent ?? '', onLamp: document.activeElement?.classList.contains('rm-q') && /Люстра/.test(document.activeElement.textContent), top: document.querySelector('.hm-main')?.scrollTop ?? 0 }));
const lampSheet = w => /device=e:light\.kids_chandelier/.test(w.hash) && w.sheet && /Люстра/.test(w.title);
const holdOn = async (page, loc, ms = 650) => { const [x, y] = await centre(loc); await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(400); };
for (const [w, h] of [[360, 792], [1070, 764]]) {
  const { page, ctx, errors } = await open({ scenario: 'evening', room: 'detskaia', w, h, accept: true }), tag = `${w}x${h}`;
  await page.evaluate(() => { const m = document.querySelector('.hm-main'); if (m) m.scrollTop = 40; }); await page.waitForTimeout(100); const before = await where2(page); await clear(page);
  await holdOn(page, lampQ(page)); const held = await where2(page);
  check(`ST-02 ${tag}: a long press on the room's only lamp opens its own sheet and sends nothing (the release is no tap)`, lampSheet(held) && (await sent(page)).length === 0, { held, sent: await sent(page) });
  if (w === 360) await page.screenshot({ path: `${out}/st02-sheet-360.png` });
  const preset = page.locator('.hm-sheet button', { hasText: /^60\s*%$/ }).first(); const has60 = await preset.count();
  if (has60) { await preset.click(); await page.waitForTimeout(300); }
  check(`ST-02 ${tag}: …it is the brightness sheet: «60 %» is one light.turn_on with brightness_pct 60`, has60 === 1 && (await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => `${x.domain}.${x.service}:${x.data?.entity_id}:${x.data?.brightness_pct}`))).join() === 'light.turn_on:light.kids_chandelier:60', await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); const esc = await where2(page);
  check(`ST-02 ${tag}: Escape brings the room back — the same room, the focus on the lamp's tile, the page where it stood`, esc.hash === '#rooms?room=detskaia' && !esc.sheet && esc.onLamp && Math.abs(esc.top - before.top) <= 1, { esc, before });
  await clear(page); await lampQ(page).click({ button: 'right' }); await page.waitForTimeout(400); const right = await where2(page);
  check(`ST-02 ${tag}: a right click opens the same sheet, nothing sent`, lampSheet(right) && (await sent(page)).length === 0, { right, sent: await sent(page) });
  await page.goBack(); await page.waitForTimeout(400); const back = await where2(page);
  check(`ST-02 ${tag}: the browser's «Назад» brings the room back with the focus on the lamp`, back.hash === '#rooms?room=detskaia' && !back.sheet && back.onLamp, back);
  await lampQ(page).focus(); await page.keyboard.press('ContextMenu'); await page.waitForTimeout(400); const key = await where2(page);
  check(`ST-02 ${tag}: from the keyboard — the menu key on the focused lamp opens its sheet, nothing sent`, lampSheet(key) && (await sent(page)).length === 0, key);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check(`ST-02 ${tag}: …Escape gives the focus back to the lamp`, (await where2(page)).onLamp, await where2(page));
  await page.keyboard.press('Enter'); await page.waitForTimeout(400); const tap = await where2(page);
  check(`ST-02 ${tag}: Enter on the lamp stays the power: one light.turn_off, no sheet`, !tap.sheet && JSON.stringify(await sent(page)) === JSON.stringify([{ c: 'light.turn_off', id: 'light.kids_chandelier' }]), { tap, sent: await sent(page) });
  check(`errors ST-02 ${tag}`, !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await open({ scenario: 'evening', room: 'detskaia', w: 360, h: 792, accept: true }), cdp = await ctx.newCDPSession(page);
  const [x, y] = await centre(lampQ(page)); await clear(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await page.waitForTimeout(700); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(500);
  check('ST-02 touch: a finger held on the lamp opens its sheet and sends nothing', lampSheet(await where2(page)) && (await sent(page)).length === 0, { at: await where2(page), sent: await sent(page) });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await setBoth(page, { 'light.kids_chandelier': 'unavailable' }); await page.waitForTimeout(250); await clear(page); await holdOn(page, lampQ(page));
  check('ST-02: a bulb that does not answer — its sheet still opens from the room (it says «Нет связи» there too), nothing sent', lampSheet(await where2(page)) && (await sent(page)).length === 0 && /Нет связи/.test(await page.locator('.hm-sheet').innerText()), { at: await where2(page), sent: await sent(page) });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); await setBoth(page, { 'light.kids_chandelier': 'on' }); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(250); await clear(page); await holdOn(page, lampQ(page));
  check('ST-02: the house offline — the sheet still opens to read, nothing sent', lampSheet(await where2(page)) && (await sent(page)).length === 0, { at: await where2(page), sent: await sent(page) });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check('ST-02: only the room\'s lamp opens this way (the TV and «Убрать» have their own cards / actions)', await page.evaluate(() => [...document.querySelectorAll('.rm-q[data-opens]')].map(b => b.textContent)).then(l => l.length === 1 && /Люстра/.test(l[0])));
  check('errors ST-02 touch/silent/offline', !errors.length, errors); await ctx.close(); }
await stop(fails.length ? 1 : 0);
