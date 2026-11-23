// Scenario QA of the card catalog (PROMPT-CARD-CATALOG.md, 20.11.2026) on the Criuleni snapshot of 18.11 with a second Purifier 4 in the bedroom,
// the house's own settings of 18.11 in the browser's store. Local preview, emulated screens (phone 412×915, tablet 1280×800); commands are recorded
// and refused by the preview host. usage: node scripts/qa-catalog.mjs [out-dir]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixturePath } from './fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/card-catalog'); await mkdir(out, { recursive: true });
const live = JSON.parse(await readFile(fixturePath('criuleni-registry-live-20261118.json'), 'utf8'));
const houseConfig = await readFile(fixturePath('atom-home-config-20261118.json'), 'utf8');
const LIVING = '80babb9d488a0bbd7d08db9a6ab67aa5';
/** the second purifier of the same model: its own HA device and entities in the bedroom */
function withSecond(reg) {
  const r = structuredClone(reg), own = r.entities.filter(e => e.device_id === LIVING);
  r.devices.push({ ...r.devices.find(d => d.id === LIVING), id: 'bedroomPurifierDevice', name: 'Спальня · Очиститель воздуха (Xiaomi Air Purifier 4)', area_id: 'spalnia' });
  for (const e of own) { const id = e.entity_id.replace('living_air_purifier', 'bedroom_air_purifier'); r.entities.push({ ...e, entity_id: id, device_id: 'bedroomPurifierDevice', area_id: null }); const s = structuredClone(reg.states[e.entity_id]); if (typeof s.attributes.friendly_name === 'string') s.attributes.friendly_name = s.attributes.friendly_name.replace('Гостиная', 'Спальня'); if (id.endsWith('_pm25')) s.state = '41'; r.states[id] = s; }
  return r;
}
/** a second object: the same house without Criuleni's heating helpers — one central thermostat, no heads in the scheme (local data, emulation) */
function secondObject(reg) { const r = structuredClone(reg); for (const id of Object.keys(r.states)) if (/^input_select\.heating_mode$|^climate\.[a-z]+_trv$/.test(id)) delete r.states[id]; return r; }
const fixtures = { criuleni: JSON.stringify(withSecond(live)), second: JSON.stringify(secondObject(live)) };
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname.startsWith('/fixture-')) { res.setHeader('content-type', 'application/json'); res.end(fixtures[u.pathname.slice(9, -5)]); return; }
  if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(houseConfig); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d)); }; const errors = [];
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('atom-home:config') ?? '{}'));
async function open(page, fixture, { keep = false } = {}) {
  await page.goto(origin); await page.waitForFunction(() => window.ready);
  await page.evaluate(async ({ fixture, keep }) => { if (!keep) { localStorage.clear(); localStorage.setItem('atom-home:config', await (await fetch('/config.json')).text()); } const fx = await (await fetch(`/fixture-${fixture}.json`)).json(); await window.mountPreview(document.getElementById('root'), fx); }, { fixture, keep });
  await page.waitForSelector('.hm-shell'); await page.waitForTimeout(700);
}
// commands to the house's devices: the preview host also records its read-only WebSocket reads (`ws`: supervisor/api, energy/get_prefs), which are no command
const log = page => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => ({ domain: c.domain, service: c.service, entity: c.data.entity_id })));
const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash).then(() => page.waitForTimeout(500));
try {
  for (const [vp, size] of [['phone', { width: 412, height: 915 }], ['tablet', { width: 1280, height: 800 }]]) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 }); page.on('pageerror', e => errors.push(`${vp}: ${e.message}`));
    const shot = (name, full = false) => page.screenshot({ path: resolve(out, `${vp}-${name}.png`), fullPage: full });
    const sheetShot = async name => { await page.waitForTimeout(450); await page.evaluate(() => { const s = document.querySelector('.hm-sheet'); if (s) s.scrollTop = 0; }); await shot(name); }; // after the sheet's own entrance (.38 s)
    const scrollSheet = async sel => { await page.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), sel); await page.waitForTimeout(250); };
    await open(page, 'criuleni');
    await shot('01-home-before');
    const before = await stored(page);
    // 1. «＋ Добавить карточку» on Home
    check(`${vp}:add-button-on-home`, await page.locator('.ah-home [data-action="open-catalog"]').count() === 1);
    await page.click('.ah-home [data-action="open-catalog"]'); await page.waitForSelector('.at-cards[data-step="list"]');
    await sheetShot('02-catalog-found');
    const foundIds = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile));
    check(`${vp}:found-lists-purifier-and-both-heating`, foundIds.includes('xiaomi.purifier4') && foundIds.includes('heating.single') && foundIds.includes('heating.rooms'), { foundIds });
    // 2. two equal ways to the model: the search, and «Очистители воздуха → Xiaomi»
    await page.fill('.at-cards-search input', 'Purifier 4'); await page.waitForTimeout(200);
    const bySearch = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile)); await sheetShot('03-search-purifier4');
    await page.fill('.at-cards-search input', 'zhimi.airp.mb5'); await page.waitForTimeout(150); const byCode = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile));
    await page.fill('.at-cards-search input', ''); await page.click('[data-tab="all"]'); await page.click('[data-category="air_purifier"]'); await page.click('[data-brand="Xiaomi"]'); await page.waitForTimeout(200);
    const byBrowse = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile)); await sheetShot('04-category-brand');
    check(`${vp}:search-and-browse-one-profile`, JSON.stringify(bySearch) === '["xiaomi.purifier4"]' && JSON.stringify(byBrowse) === '["xiaomi.purifier4"]' && JSON.stringify(byCode) === '["xiaomi.purifier4"]', { bySearch, byBrowse, byCode });
    await page.click('[data-category="air_purifier"]'); await page.click('[data-category="heating"]'); await page.waitForTimeout(150);
    const heat = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile)); await sheetShot('05-category-heating');
    check(`${vp}:heating-both-cards`, JSON.stringify(heat) === '["heating.single","heating.rooms"]', { heat });
    await page.click('[data-category="heating"]');
    // 3. the purifier's form: own device, then only its fields
    await page.click('.at-cards-item[data-profile="xiaomi.purifier4"]'); await page.waitForSelector('.at-cards[data-step="form"]');
    check(`${vp}:two-devices-of-the-model`, await page.locator('.at-cards-device').count() === 2);
    await page.click(`.at-cards-device[data-device="${LIVING}"]`); await page.waitForTimeout(250);
    const roles = await page.$$eval('.at-cards-field', l => l.map(f => [f.dataset.role, f.querySelector('select').value]));
    check(`${vp}:fields-only-of-this-card`, roles.map(r => r[0]).join(',') === 'fan,pm25,filter,filterDays,temperature,humidity,ionizer,favoriteLevel,brightness,childLock,buzzer', { roles });
    check(`${vp}:fields-suggested-from-own-device`, roles.filter(r => r[1]).every(r => r[1].includes('living_air_purifier')) && roles.find(r => r[0] === 'fan')[1] === 'fan.living_air_purifier' && roles.find(r => r[0] === 'pm25')[1] === 'sensor.living_air_purifier_pm25', { roles });
    // 1.36.1: opened from Home, a card whose device stands in a room goes «В комнате» by default (not «На главной»), in that device's room —
    // and both follow the device chosen until the installer presses a place or picks a room himself
    const placeOf = () => page.evaluate(() => ({ area: document.querySelector('[data-part="place"] select')?.value, ...Object.fromEntries([...document.querySelectorAll('[data-place]')].map(b => [b.dataset.place, b.getAttribute('aria-checked')])) }));
    const place0 = await placeOf();
    await page.click('.at-cards-device[data-device="bedroomPurifierDevice"]'); await page.waitForTimeout(200); const place1 = await placeOf();
    await page.click(`.at-cards-device[data-device="${LIVING}"]`); await page.waitForTimeout(250); const place2 = await placeOf();
    check(`${vp}:place-default-is-the-devices-room`, JSON.stringify(place0) === '{"area":"gostinaia","home":"false","room":"true"}' && JSON.stringify(place1) === '{"area":"spalnia","home":"false","room":"true"}' && JSON.stringify(place2) === JSON.stringify(place0), { place0, place1, place2 });
    await sheetShot('06-form-device-fields');
    await scrollSheet('[data-part="preview"]'); await shot('07-form-preview');
    check(`${vp}:preview-inert`, await page.evaluate(() => { const p = document.querySelector('.at-cards-preview'); return !!p && p.inert === true && !!p.querySelector('.ah-tile') && !!p.querySelector('.ah-sheet[data-kind="fan"]'); }));
    // a press inside the preview does nothing
    await page.evaluate(() => document.querySelector('.at-cards-preview button')?.click());
    await page.fill('[data-part="place"] input[type="text"]', 'Очиститель'); await page.click('[data-place="room"]').catch(() => undefined);
    const placeNow = await page.$$eval('[data-place]', l => l.map(b => [b.dataset.place, b.getAttribute('aria-checked')]));
    if (!placeNow.find(p => p[0] === 'room' && p[1] === 'true')) await page.click('[data-place="room"]');
    if (!placeNow.find(p => p[0] === 'home' && p[1] === 'true') && (await page.$$eval('[data-place="home"]', l => l[0]?.getAttribute('aria-checked'))) !== 'true') await page.click('[data-place="home"]');
    await scrollSheet('[data-part="place"]'); await shot('08-form-place');
    check(`${vp}:no-command-before-save`, (await log(page)).length === 0, { log: await log(page) });
    await page.click('[data-action="add-card"]'); await page.waitForTimeout(700);
    let cfg = await stored(page), ids = Object.keys(cfg.profileInstances ?? {});
    check(`${vp}:saved-one-instance`, ids.length === 1 && cfg.profileInstances[ids[0]].deviceId === LIVING && cfg.profileInstances[ids[0]].bindings.fan === 'fan.living_air_purifier', { cards: cfg.profileInstances });
    check(`${vp}:no-command-after-save`, (await log(page)).length === 0);
    // the house's own settings are all still there (rooms, devices, buttons, alarms, tariffs), only the new key added
    const parts = c => JSON.stringify([c.home?.name, c.rooms, c.devices, c.buttons, c.alarms, c.energy, c.sections, c.modules]);
    check(`${vp}:house-settings-kept`, parts(cfg) === parts(before), { cfg: parts(cfg).length, before: parts(before).length });
    const idA = ids[0];
    // 4. on Home and in the living room: the same card, the same sheet
    await go(page, '#home'); await shot('09-home-with-card');
    check(`${vp}:card-on-home`, await page.evaluate(() => [...document.querySelectorAll('.ah-home .ah-tile')].some(t => /Очиститель/.test(t.innerText))));
    await go(page, '#rooms?room=gostinaia'); await shot('10-living-room-with-card', true);
    const roomTiles = await page.evaluate(() => [...document.querySelectorAll('.rm-page .ah-tile, .rm-page .rm-tile')].filter(t => /Очиститель/.test(t.innerText)).length);
    check(`${vp}:card-in-room-once`, roomTiles === 1, { roomTiles });
    await page.evaluate(() => [...document.querySelectorAll('.rm-page .ah-tile')].find(t => /Очиститель/.test(t.innerText))?.querySelector('.ah-tile-more')?.click()); await page.waitForTimeout(500);
    const roomSheet = await page.evaluate(() => location.hash);
    await go(page, `#home?device=p:${idA}`); const homeSheet = await page.evaluate(() => document.querySelector('.hm-sheet .ah-sheet')?.dataset.kind + '|' + document.querySelector('.hm-sheet h2')?.innerText);
    await sheetShot('11-card-sheet');
    check(`${vp}:same-device-from-home-and-room`, decodeURIComponent(roomSheet).includes(`p:${idA}`) && homeSheet.startsWith('fan|'), { roomSheet, homeSheet });
    check(`${vp}:sheet-has-modes-speed-filter`, await page.evaluate(() => { const s = document.querySelector('.hm-sheet'); return !!s && /Режим/.test(s.innerText) && /Скорость/.test(s.innerText) && /PM2[.,]5/i.test(s.innerText); }));
    // 5. the second purifier, from the bedroom: its own device first, an external PM2.5 chosen on purpose
    await go(page, '#rooms?room=spalnia');
    check(`${vp}:add-button-in-room`, await page.locator('.rm-page [data-action="open-catalog"]').count() === 1);
    await page.click('.rm-page [data-action="open-catalog"]'); await page.waitForSelector('.at-cards[data-step="list"]');
    const inRoom = await page.evaluate(() => document.querySelector('.at-cards-item[data-profile="xiaomi.purifier4"]')?.innerText ?? '');
    check(`${vp}:room-first`, /в этой комнате/i.test(inRoom), { inRoom });
    await page.click('.at-cards-item[data-profile="xiaomi.purifier4"]'); await page.waitForSelector('.at-cards[data-step="form"]');
    check(`${vp}:room-device-preselected`, await page.evaluate(() => document.querySelector('.at-cards-device[aria-checked="true"]')?.dataset.device) === 'bedroomPurifierDevice');
    await page.selectOption('.at-cards-field[data-role="pm25"] select', 'sensor.living_air_purifier_pm25'); await page.waitForTimeout(200);
    check(`${vp}:external-said`, /внешний датчик/.test(await page.evaluate(() => document.querySelector('.at-cards-field[data-role="pm25"]')?.innerText ?? '')));
    await sheetShot('12-second-form');
    await page.click('[data-action="add-card"]'); await page.waitForTimeout(700);
    cfg = await stored(page); ids = Object.keys(cfg.profileInstances);
    const idB = ids.find(i => i !== idA), A = cfg.profileInstances[idA], B = cfg.profileInstances[idB];
    check(`${vp}:two-independent-instances`, ids.length === 2 && A.deviceId === LIVING && B.deviceId === 'bedroomPurifierDevice' && A.bindings.fan === 'fan.living_air_purifier' && B.bindings.fan === 'fan.bedroom_air_purifier' && A.bindings.pm25 === 'sensor.living_air_purifier_pm25' && B.bindings.pm25 === 'sensor.living_air_purifier_pm25' && B.bindings.filter === 'sensor.bedroom_air_purifier_filter_life', { A, B });
    check(`${vp}:no-command-after-second-save`, (await log(page)).length === 0);
    await shot('13-bedroom-with-card', true);
    // 6. a reload: the bindings are what was saved
    await open(page, 'criuleni', { keep: true });
    const reread = await stored(page);
    check(`${vp}:bindings-survive-reload`, JSON.stringify(reread.profileInstances) === JSON.stringify(cfg.profileInstances));
    // 7. power on the bedroom's card goes to the bedroom purifier only
    await go(page, '#rooms?room=spalnia');
    await page.evaluate(() => [...document.querySelectorAll('.rm-page .ah-tile')].find(t => /Очиститель/.test(t.innerText))?.querySelector('.ah-tile-hit')?.click()); await page.waitForTimeout(600);
    const sent = await log(page);
    check(`${vp}:power-targets-own-fan`, sent.length === 1 && sent[0].domain === 'fan' && sent[0].entity === 'fan.bedroom_air_purifier', { sent });
    // 8. a lost sensor: said in the card, with «Заменить» for the administrator, no stand-in
    await page.evaluate(() => window.atomPreview.setStates({ 'sensor.living_air_purifier_filter_life': 'unavailable' })); await page.waitForTimeout(300);
    await go(page, `#home?device=p:${idA}`); await page.waitForTimeout(300); await sheetShot('14-lost-sensor');
    check(`${vp}:lost-note`, await page.evaluate(() => { const n = document.querySelector('.hm-sheet .at-cards-lostnote'); return !!n && /Ресурс фильтра/.test(n.innerText) && !!n.querySelector('[data-action="fix-card"]'); }));
    await page.click('[data-action="fix-card"]'); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(300);
    check(`${vp}:edit-opens-with-lost-field`, await page.evaluate(() => document.querySelector('.at-cards-field[data-role="filter"]')?.classList.contains('is-lost') && !!document.querySelector('[data-action="remove-card"]')));
    // an edit starts from the place that was saved (here both), never from the default of a new card
    { const saved = (await stored(page)).profileInstances[idA].placement, shown = await page.$$eval('[data-place]', l => l.filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.dataset.place));
      check(`${vp}:edit-keeps-saved-place`, saved.length === 2 && [...saved].sort().join() === [...shown].sort().join(), { saved, shown }); }
    await page.evaluate(() => document.querySelector('.at-cards-field[data-role="filter"]')?.scrollIntoView({ block: 'center' })); await shot('15-edit-lost-field');
    // 9. a resident sees the published cards, and no «＋»
    await page.evaluate(() => { window.atomPreview.host.setAdmin(false); }); await go(page, '#home'); await page.evaluate(() => window.atomPreview.redraw()); await page.waitForTimeout(400);
    check(`${vp}:resident-sees-card`, await page.evaluate(() => [...document.querySelectorAll('.ah-home .ah-tile')].some(t => /Очиститель/.test(t.innerText)) && !document.querySelector('[data-action="open-catalog"]')));
    await shot('16-home-resident');
    await page.evaluate(() => { window.atomPreview.host.setAdmin(true); window.atomPreview.redraw(); });
    // 10. «Центральный термостат и комнаты» on Criuleni: the heating screen with the installer's rooms
    await go(page, '#home?device=add-card'); await page.click('[data-tab="all"]'); await page.click('[data-category="heating"]'); await page.click('.at-cards-item[data-profile="heating.rooms"]'); await page.waitForSelector('.at-cards[data-step="form"]');
    await page.selectOption('.at-cards-field[data-role="central"] select', 'climate.living_thermostat');
    await page.selectOption('.at-cards-field[data-role="mode"] select', 'input_select.heating_mode').catch(() => undefined);
    await page.selectOption('.at-cards-field[data-role="homeTemp"] select', 'input_number.heating_home_temp').catch(() => undefined);
    for (const area of ['kukhnia', 'spalnia']) { await page.click('[data-action="add-room"]'); await page.waitForTimeout(150); const rows = page.locator('.at-cards-room'); await rows.last().locator('select').first().selectOption(area); await page.waitForTimeout(150); }
    const roomRows = await page.$$eval('.at-cards-room', l => l.map(r => [...r.querySelectorAll('.at-cards-field')].map(f => [f.dataset.role, f.querySelector('select').value])));
    check(`${vp}:heat-rooms-suggested`, roomRows.length === 2 && roomRows[0].find(x => x[0] === 'trv')[1] === 'climate.kitchen_trv' && roomRows[0].find(x => x[0] === 'air')[1] === 'sensor.kitchen_climate_temperature' && roomRows[0].find(x => x[0] === 'timer')[1] === 'timer.kitchen_heating_override', { roomRows });
    check(`${vp}:kitchen-air-no-boiler`, await page.evaluate(() => [...document.querySelectorAll('.at-cards-room')][0].querySelector('.at-cards-field[data-role="air"] select') && ![...[...document.querySelectorAll('.at-cards-room')][0].querySelectorAll('.at-cards-field[data-role="air"] option')].some(o => /boiler|target|kettle|_trv/.test(o.value))));
    await scrollSheet('[data-part="rooms"]'); await shot('17-heat-rooms-form');
    await scrollSheet('[data-part="preview"]'); await shot('18-heat-rooms-preview');
    await page.click('[data-action="add-card"]'); await page.waitForTimeout(700);
    check(`${vp}:no-command-after-heating-save`, (await log(page)).length === 1, { log: await log(page) });
    await go(page, '#climate'); await page.waitForTimeout(500); await shot('19-climate-two-rooms', true);
    check(`${vp}:heating-screen-installer-rooms`, await page.evaluate(() => [...document.querySelectorAll('.at-heat-room')].map(r => r.dataset.room).length === 2 && !document.querySelector('.at-heat-boiler') && !document.querySelector('.at-heat-scen')));
    await go(page, '#home'); await shot('20-home-heating-card');
    await page.close();
    // 11. the second object: one central thermostat
    const p2 = await browser.newPage({ viewport: size, deviceScaleFactor: 2 }); p2.on('pageerror', e => errors.push(`${vp}/second: ${e.message}`));
    await open(p2, 'second'); await p2.evaluate(() => { location.hash = '#home?device=add-card'; }); await p2.waitForSelector('.at-cards[data-step="list"]');
    await p2.click('[data-category="heating"]'); await p2.waitForTimeout(150);
    await p2.click('.at-cards-item[data-profile="heating.single"]'); await p2.waitForSelector('.at-cards[data-step="form"]');
    await p2.selectOption('.at-cards-field[data-role="thermostat"] select', 'climate.living_thermostat');
    await p2.selectOption('.at-cards-field[data-role="air"] select', 'sensor.living_air_purifier_temperature').catch(() => undefined);
    await p2.screenshot({ path: resolve(out, `${vp}-21-single-form.png`) });
    await p2.click('[data-action="add-card"]'); await p2.waitForTimeout(700);
    await p2.evaluate(() => { location.hash = '#home'; }); await p2.waitForTimeout(600); await p2.screenshot({ path: resolve(out, `${vp}-22-single-home.png`) });
    check(`${vp}:single-thermostat-tile`, await p2.evaluate(() => !!document.querySelector('.ah-home .hm-thermo, .ah-home [class*="thermo"]')));
    check(`${vp}:single-no-command`, (await log(p2)).length === 0);
    await p2.close();
  }
} finally { await browser.close(); server.close(); }
const failed = checks.filter(c => !c.p);
await writeFile(resolve(out, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
console.log(`${checks.length - failed.length}/${checks.length} checks, ${errors.length} page errors`); if (errors.length) console.log(errors.join('\n'));
process.exit(failed.length || errors.length ? 1 : 0);
