// Light card QA on the Criuleni snapshot + a synthetic chandelier with an ambient light and a hub indicator (preview host): the Lights page, the chandelier sheet (slider, levels, temperature, effects, ambient), the relay sheet — six sizes.
// usage: node scripts/qa-light.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/light')); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-camera-20261104.json'), 'utf8'));
const row = (state, attributes = {}) => ({ state, attributes, last_changed: new Date(Date.now() - 3600e3).toISOString(), last_updated: new Date().toISOString() });
const ent = (id, device_id, extra = {}) => ({ entity_id: id, device_id, area_id: null, name: null, original_name: null, platform: 'synthetic', entity_category: null, disabled_by: null, hidden_by: null, ...extra });
for (const [area_id, name] of [['detskaia', 'Детская'], ['kompiuternaia', 'Компьютерная']]) if (!fixture.areas.some(a => a.area_id === area_id)) fixture.areas.push({ area_id, name, icon: null, picture: null });
fixture.devices.push({ id: 'dev_chandelier', name: 'Люстра', model: 'yeelink.light.ceilc', manufacturer: 'Yeelight', area_id: 'detskaia' }, { id: 'dev_hub', name: 'Xiaomi hub', model: 'Automatically generated definition', manufacturer: 'Xiaomi', area_id: 'kompiuternaia' });
fixture.entities = fixture.entities.filter(e => !['light.kids_chandelier', 'light.kids_chandelier_ambient', 'light.office_mi_hub_router'].includes(e.entity_id));
fixture.entities.push(ent('light.kids_chandelier', 'dev_chandelier'), ent('light.kids_chandelier_ambient', 'dev_chandelier'), ent('light.office_mi_hub_router', 'dev_hub'), ent('sensor.hub_illuminance', 'dev_hub', { device_class: 'illuminance' }));
Object.assign(fixture.states, {
  'light.kids_chandelier': row('on', { friendly_name: 'Люстра', brightness: 153, color_temp_kelvin: 3500, min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500, supported_color_modes: ['color_temp'], color_mode: 'color_temp', effect_list: ['Day', 'Night'], effect: 'Day', supported_features: 36 }),
  'light.kids_chandelier_ambient': row('on', { friendly_name: 'Подсветка люстры', brightness: 115, rgb_color: [255, 126, 182], min_color_temp_kelvin: 1700, max_color_temp_kelvin: 6500, supported_color_modes: ['color_temp', 'rgb'], color_mode: 'rgb', supported_features: 32 }),
  'light.office_mi_hub_router': row('off', { friendly_name: 'Индикатор хаба', supported_color_modes: ['xy'] }),
  'sensor.hub_illuminance': row('120', { unit_of_measurement: 'lx', device_class: 'illuminance' }),
});
Object.assign(fixture.states, { 'input_text.atom_light_sleep': row('light.living_light|17:40', { max: 255 }) }); fixture.entities.push(ent('input_text.atom_light_sleep', null));
const relay = Object.keys(fixture.states).find(id => /^light\.(living|hall|kitchen)_light$/.test(id)) ?? 'light.living_light';
if (!fixture.states[relay]) { fixture.entities.push(ent(relay, null, { area_id: 'detskaia' })); fixture.states[relay] = row('on', { friendly_name: 'Гостиная · Свет', supported_color_modes: ['onoff'] }); }
const config = { schemaVersion: 1, home: { name: 'Мой дом', language: 'ru', theme: 'light' }, modules: {}, rooms: {}, devices: {}, entities: {}, sections: {}, buttons: [] };
const served = JSON.stringify(fixture);
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { checks: [], errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`); };
try {
  for (const [w, h, label] of [[402, 874, 'phone'], [874, 402, 'phone-land'], [1070, 764, 'tablet'], [764, 1070, 'tablet-port'], [698, 751, 'open'], [751, 698, 'open-land']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) report.errors.push(`${label} console: ${m.text()}`); });
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, config);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(500);
    const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: resolve(out, `${label}-${name}.png`) }); };
    const lastCall = () => page.evaluate(() => window.atomPreview.host.log.slice(-1)[0] ?? null);
    const go = async hash => { await page.evaluate(x => { location.hash = x; }, hash); await page.waitForTimeout(500); };
    // Lights page: lamps of rooms only, the chandelier one glowing tile with the ambient dot
    await go('#lights'); await shot('lights');
    const nav = await page.evaluate(() => ({ nav: [...document.querySelectorAll('.hm-tabbar button, aside nav button')].map(b => b.textContent.trim()), tabs: [...document.querySelectorAll('.hm-range-tabs button')].map(b => b.textContent.trim()), rooms: [...document.querySelectorAll('.at-lights-room h2')].map(h => h.textContent), chandelierIcon: (() => { const t = [...document.querySelectorAll('.hm-light-grid .ah-tile')].find(x => x.querySelector('strong')?.textContent === 'Люстра'); return t?.querySelector('.ah-glyph path')?.getAttribute('d')?.slice(0, 10); })() }));
    check(`${label}: «Свет» in the nav under Rooms, not in the Systems tabs; lights grouped by room; the chandelier has its own glyph`, nav.nav.indexOf('Свет') === nav.nav.indexOf('Комнаты') + 1 && !nav.tabs.includes('Свет') && nav.rooms.length >= 1 && nav.rooms.includes('Детская') && (nav.chandelierIcon ?? '').startsWith('M12 2v4M4'), JSON.stringify(nav));
    const lights = await page.evaluate(() => { const tiles = [...document.querySelectorAll('.hm-light-grid .ah-tile')]; return { names: tiles.map(t => t.querySelector('strong')?.textContent), hub: tiles.some(t => /хаба/i.test(t.textContent ?? '')), ambient: tiles.filter(t => t.textContent?.includes('Подсветка')).length, chandelier: (() => { const t = tiles.find(x => x.querySelector('strong')?.textContent === 'Люстра'); return t ? { on: t.classList.contains('is-on'), glow: getComputedStyle(t).getPropertyValue('--glow').trim(), dot: !!t.querySelector('.at-tile-amb'), line: t.querySelector('small')?.textContent } : null; })() }; });
    check(`${label}: lights page — no hub indicator, no ambient tile, chandelier lit with glow and dot`, !lights.hub && lights.ambient === 0 && !!lights.chandelier && lights.chandelier.on && lights.chandelier.glow === '0.60' && lights.chandelier.dot && /Вкл · 60 %/.test(lights.chandelier.line ?? ''), JSON.stringify(lights));
    // the room page: light rows with switches, a brightness strip under the chandelier, the room switch
    await go('#rooms?room=detskaia'); await page.waitForSelector('.at-light-rows'); await shot('room');
    const rows = await page.evaluate(() => { const sec = document.querySelector('.at-light-rows-sec'); return { head: !!sec.querySelector('.hm-section-head .hm-switch'), rows: [...sec.querySelectorAll('.at-light-row')].map(r => ({ name: r.querySelector('strong')?.textContent, line: r.querySelector('small')?.textContent, on: r.classList.contains('is-on'), mini: !!r.querySelector('.at-light-mini'), sw: r.querySelector('.hm-switch')?.getAttribute('aria-checked') })) }; });
    const ch = rows.rows.find(r => r.name === 'Люстра');
    check(`${label}: room light rows — chandelier 60 % with a strip, switches, the room switch`, rows.head && rows.rows.length >= 1 && !!ch && ch.on && ch.mini && /60 %/.test(ch.line ?? '') && ch.sw === 'true', JSON.stringify(rows));
    await page.$eval('.at-light-row .at-light-mini', el => { el.value = '35'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(150); const mini = await lastCall();
    await page.click('.at-light-rows-sec .hm-section-head .hm-switch'); await page.waitForTimeout(200); const roomSw = await page.evaluate(() => window.atomPreview.host.log.slice(-2));
    check(`${label}: strip sets 35 %, the room switch turns the lit lamps off`, mini?.data.brightness_pct === 35 && mini?.data.entity_id === 'light.kids_chandelier' && roomSw.some(c => c.service === 'toggle' && c.data.entity_id === 'light.kids_chandelier'), JSON.stringify({ mini: mini?.data, roomSw }));
    // The chandelier sheet
    await go('#lights?device=e%3Alight.kids_chandelier'); await page.waitForSelector('.at-light-body'); await shot('chandelier');
    const sheet = await page.evaluate(() => { const b = document.querySelector('.at-light-body'), sheetEl = document.querySelector('.hm-sheet'); return { pct: b.querySelector('.at-vs-pct')?.textContent, fill: b.querySelector('.at-vs')?.style.getPropertyValue('--p'), state: b.querySelector('.at-light-state small')?.textContent, levels: [...b.querySelectorAll('.at-light-level')].map(x => x.textContent), temp: b.querySelector('.at-light-title b')?.textContent, presets: [...b.querySelectorAll('.at-temp-preset')].map(x => x.textContent), seg: [...b.querySelectorAll('.at-light-seg button')].map(x => `${x.textContent}${x.classList.contains('is-on') ? '*' : ''}`), amb: b.querySelector('.at-amb .ah-row-text small')?.textContent, dots: b.querySelectorAll('.at-amb-dot').length, range: !!b.querySelector('.at-amb-range'), scroll: sheetEl.scrollHeight - sheetEl.clientHeight }; });
    check(`${label}: chandelier sheet — 60 %, 3 500 K, Day, levels, presets, ambient rose 45 %, six colours + whites, no scroll on the tablet`, sheet.pct?.replace(/\s/g, '') === '60%' && sheet.fill === '60%' && /3\s?500\sK/.test(sheet.state ?? '') && /День/.test(sheet.state ?? '') && sheet.levels.length === 5 && /3\s?500\sK/.test(sheet.temp ?? '') && sheet.presets.length === 4 && sheet.seg.join(',') === 'День*,Ночь' && /Роза · 45 %/.test(sheet.amb ?? '') && sheet.dots === 8 && sheet.range && (sheet.scroll <= 1 || !(w >= 1000 && w > h)), JSON.stringify(sheet));
    // tap the slider at 30 % from the top → 70 %
    const vs = await page.$('.at-vs'); const box = await vs.boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3); await page.waitForTimeout(250);
    const tapped = await page.evaluate(() => ({ pct: document.querySelector('.at-vs-pct')?.textContent, call: window.atomPreview.host.log.slice(-1)[0] }));
    check(`${label}: slider tap sets ~70 % with a transition`, /^(6[89]|7[0-2])/.test(tapped.pct ?? '') && tapped.call?.service === 'turn_on' && Math.abs(tapped.call.data.brightness_pct - 70) <= 2 && tapped.call.data.transition === 0.3 && tapped.call.data.entity_id === 'light.kids_chandelier', JSON.stringify(tapped));
    // drag the slider down to ~20 %: throttled calls, the last one wins
    await page.evaluate(() => { window.__before = window.atomPreview.host.log.length; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height * (0.3 + 0.05 * i)); await page.waitForTimeout(20); } await page.mouse.up(); await page.waitForTimeout(300);
    const dragged = await page.evaluate(() => { const log = window.atomPreview.host.log; return { n: log.length - window.__before, last: log.slice(-1)[0]?.data.brightness_pct, pct: document.querySelector('.at-vs-pct')?.textContent }; });
    check(`${label}: slider drag — throttled, ends near 20 %`, Math.abs(dragged.last - 20) <= 3 && /^(1[7-9]|2[0-3])/.test(dragged.pct ?? '') && dragged.n <= 6, JSON.stringify(dragged));
    // night light level, daylight preset, the Night effect, an ambient colour and the ambient switch
    await page.click('.at-light-level:first-child'); await page.waitForTimeout(150); const night = await lastCall();
    await page.click('.at-temp-preset:last-child'); await page.waitForTimeout(150); const day = await lastCall();
    await page.click('.at-light-seg button:last-child'); await page.waitForTimeout(150); const effect = await lastCall();
    await page.click('.at-amb-dot:nth-child(5)'); await page.waitForTimeout(150); const mint = await lastCall();
    await page.click('.at-amb-dot.is-white:last-child'); await page.waitForTimeout(150); const cold = await lastCall();
    await page.click('.at-amb .hm-switch'); await page.waitForTimeout(150); const sw = await lastCall();
    await shot('chandelier-after');
    check(`${label}: night 1 %, daylight 5500 K, effect Night, mint, cold white, ambient toggle`, night?.data.brightness_pct === 1 && day?.data.color_temp_kelvin === 5500 && effect?.data.effect === 'Night' && JSON.stringify(mint?.data.rgb_color) === '[95,214,200]' && cold?.data.color_temp_kelvin === 6000 && cold?.data.entity_id === 'light.kids_chandelier_ambient' && sw?.service === 'toggle' && sw?.data.entity_id === 'light.kids_chandelier_ambient', JSON.stringify({ night: night?.data, day: day?.data, effect: effect?.data, mint: mint?.data, cold: cold?.data, sw: sw?.data }));
    await page.click('.at-sleep-chips .hm-pill:first-child'); await page.waitForTimeout(200); const sleep = await lastCall();
    check(`${label}: «Выключить через 15 мин» goes to the integration`, sleep?.domain === 'ws' && sleep?.service === 'atom_home/light/sleep' && sleep?.data.minutes === 15 && sleep?.data.entity_id === 'light.kids_chandelier', JSON.stringify(sleep));
    await page.click('.at-light-level.is-off'); await page.waitForTimeout(150); const off = await lastCall();
    check(`${label}: «Выключить» turns the lamp off`, off?.service === 'turn_off' && off?.data.entity_id === 'light.kids_chandelier', JSON.stringify(off));
    // the temperature strip: tap at the warm end
    const strip = await page.$('.at-temp-strip'); await strip.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); const sb = await strip.boundingBox(); await page.mouse.click(sb.x + 1, sb.y + sb.height / 2); await page.waitForTimeout(150); const warm = await lastCall();
    check(`${label}: temperature strip tap at the warm end → 2700 K`, warm?.data.color_temp_kelvin <= 2750 && warm?.data.entity_id === 'light.kids_chandelier', JSON.stringify(warm?.data));
    // the relay sheet
    await go(`#lights?device=e%3A${relay}`); await page.waitForSelector('.at-relay-hero'); await shot('relay');
    const rel = await page.evaluate(() => { const b = document.querySelector('.at-light-sheet'); return { hero: b.querySelector('.ah-hero-main b')?.textContent, sub: b.querySelector('.ah-hero-main small')?.textContent, glyphOn: b.querySelector('.at-relay-glyph')?.classList.contains('is-on'), power: b.querySelector('.ah-power strong')?.textContent, slider: !!b.querySelector('.at-vs') }; });
    const relayOn = fixture.states[relay].state === 'on';
    check(`${label}: relay sheet — state, since, power row, no slider`, rel.hero === (relayOn ? 'Включено' : 'Выключено') && (!relayOn || /с \d\d:\d\d/.test(rel.sub ?? '')) && rel.glyphOn === relayOn && rel.power === (relayOn ? 'Выключить' : 'Включить') && !rel.slider, JSON.stringify(rel));
    const pend = await page.evaluate(() => ({ at: document.querySelector('.at-sleep')?.getAttribute('data-sleep'), text: document.querySelector('.at-sleep-at strong')?.textContent }));
    await page.click('.at-sleep-at .hm-pill'); await page.waitForTimeout(200); const cancel = await lastCall();
    check(`${label}: the relay shows «выключится в 17:40», cancel sends 0`, pend.at === '17:40' && /17:40/.test(pend.text ?? '') && cancel?.service === 'atom_home/light/sleep' && cancel?.data.minutes === 0, JSON.stringify({ pend, cancel: cancel?.data }));
    await page.click('.at-light-sheet .ah-power'); await page.waitForTimeout(150); const tog = await lastCall();
    check(`${label}: relay power row toggles the light`, tog?.service === 'toggle' && tog?.data.entity_id === relay, JSON.stringify(tog));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`); if (report.errors.length) console.log(report.errors.join('\n'));
process.exit(report.checks.every(c => c.ok) && !report.errors.length ? 0 : 1);
