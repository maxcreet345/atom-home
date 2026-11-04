// Clock QA on the Criuleni snapshot + synthetic sun/timers/people (preview host): the home tile (analog, timer, digital), the «Time» sheet, starting a timer, settings — six sizes.
// usage: node scripts/qa-clock.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/clock')); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-camera-20261104.json'), 'utf8'));
const row = (state, attributes = {}) => ({ state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() });
const ent = (id, platform = 'synthetic') => ({ entity_id: id, device_id: null, area_id: null, name: null, original_name: null, platform, entity_category: null, disabled_by: null, hidden_by: null });
const today = new Date(); const iso = (h, m, d = 0) => { const x = new Date(today); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const nowH = today.getHours() + today.getMinutes() / 60; const daytime = nowH > 6.9 && nowH < 16.7;
Object.assign(fixture.states, {
  'sun.sun': row(daytime ? 'above_horizon' : 'below_horizon', { next_rising: iso(6, 52, 1), next_setting: daytime ? iso(16, 42) : (nowH <= 6.9 ? iso(16, 42) : iso(16, 42, 1)), elevation: daytime ? 23 : -20 }),
  'weather.forecast_home': row('cloudy', { temperature: 8.5, friendly_name: 'Погода' }),
  'timer.atom_1': row('idle', { duration: '0:10:00', friendly_name: 'Atom таймер 1' }), 'timer.atom_2': row('idle', { duration: '0:10:00' }), 'timer.atom_3': row('idle', { duration: '0:10:00' }),
  'input_text.atom_timer_labels': row('{}', { max: 255 }), 'input_boolean.timer_done': row('off'), 'input_boolean.timer_announce': row('on'), 'input_boolean.timer_push': row('on'),
  'person.gayane': row('home', { friendly_name: 'Gayane Grigorean', entity_picture: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }), 'person.ararat': row('Atom Service', { friendly_name: 'Ararat Melconean' }), 'person.daniela': row('not_home', { friendly_name: 'Daniela Melconean' }),
  'media_player.living_yandex_max': row('idle', { friendly_name: 'Гостиная · Яндекс Станция Макс' }), 'light.kids_chandelier': row('off', { friendly_name: 'Люстра', supported_color_modes: ['color_temp'] }), 'input_boolean.alarm_ringing': row('off'), 'input_text.alarm_ringing': row(''),
  'calendar.living_yandex_max_alarms': row('off', { friendly_name: 'Гостиная · Станция Макс · будильники и таймеры', message: 'Будильник', start_time: iso(7, 0, 1) }),
});
for (const [area_id, name] of [['gostinaia', 'Гостиная'], ['detskaia', 'Детская']]) if (!fixture.areas.some(a => a.area_id === area_id)) fixture.areas.push({ area_id, name, icon: null, picture: null });
Object.assign(fixture.states, { 'media_player.kids_yandex_mini': row('idle', { friendly_name: 'Детская · Яндекс Станция Мини' }) });
fixture.entities.push({ ...ent('media_player.kids_yandex_mini', 'yandex_station'), area_id: 'detskaia' });
fixture.entities.push({ ...ent('media_player.living_yandex_max', 'yandex_station'), area_id: 'gostinaia' }, { ...ent('light.kids_chandelier'), area_id: 'detskaia' }, ent('input_boolean.alarm_ringing'), ent('input_text.alarm_ringing'));
fixture.entities.push(...['sun.sun', 'weather.forecast_home', 'timer.atom_1', 'timer.atom_2', 'timer.atom_3', 'input_text.atom_timer_labels', 'input_boolean.timer_done', 'input_boolean.timer_announce', 'input_boolean.timer_push', 'person.gayane', 'person.ararat', 'person.daniela', 'calendar.living_yandex_max_alarms'].map(id => ent(id)));
const config = { schemaVersion: 1, home: { name: 'Мой дом', language: 'ru', theme: 'light' }, modules: { camera_go2rtc: { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264' } }, doorbell: { options: { addon: 'a889bffc_go2rtc' } } } };
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
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(700);
    const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: resolve(out, `${label}-${name}.png`) }); };
    await shot('home');
    const tile = await page.evaluate(() => { const t = document.querySelector('button.ah-clock'); return t ? { arc: !!t.querySelector('.ah-clock-arc'), sun: !!t.querySelector('.ah-clock-sun'), sec: !!t.querySelector('.ah-hand.is-sec'), date: t.querySelector('.ah-clock-date')?.textContent, nums: t.querySelectorAll('.ah-clock-nums text').length } : null; });
    check(`${label}: clock tile — arc, sun, seconds hand, date, 12 numerals`, !!tile && tile.arc && tile.sun && tile.sec && /\d/.test(tile.date ?? '') && tile.nums === 12, JSON.stringify(tile));
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(400); await shot('sheet');
    const sheet = await page.evaluate(() => { const s = document.querySelector('.at-clock'); const sheetEl = document.querySelector('.hm-sheet'); return { wide: s.classList.contains('is-split'), big: s.querySelector('.at-clock-big b')?.textContent, date: s.querySelector('.at-clock-date')?.textContent, sun: [...s.querySelectorAll('.at-clock-sun-row b')].map(x => x.textContent), cards: s.querySelectorAll('.at-clock-card').length, people: [...s.querySelectorAll('.at-clock-person')].map(p => p.textContent), avatar: s.querySelector('.at-clock-person.is-home b img')?.getAttribute('src'), alarms: s.querySelectorAll('.ah-row .at-door-when').length, face: !!s.querySelector('.at-clock-face-wrap'), scroll: sheetEl.scrollHeight - sheetEl.clientHeight }; });
    const expectSplit = w >= 800 && w > h;
    check(`${label}: sheet — time, date with week and weather, sun, 4 cards, people, alarm, no scroll`, /^\d\d:\d\d$/.test(sheet.big ?? '') && /неделя/.test(sheet.date ?? '') && /8,5°/.test(sheet.date ?? '') && sheet.sun.includes('06:52') && sheet.sun.includes('16:42') && sheet.cards === 4 && sheet.people.length === 3 && sheet.people[0].includes('дома') && (sheet.avatar ?? '').startsWith('data:image/png') && sheet.alarms === 1 && sheet.wide === expectSplit && sheet.face === expectSplit && (sheet.scroll <= 1 || h < 700), JSON.stringify(sheet));
    // the timer window
    await page.click('.at-clock-new'); await page.waitForTimeout(400); await shot('timer-win');
    const tw = await page.evaluate(() => { const s = document.querySelector('.at-win'); return { win: !!s, title: s?.querySelector('h3')?.textContent, presets: [...s.querySelectorAll('.at-clock-grid:not(.is-named) .at-clock-tile')].map(b => b.querySelector('b').textContent), named: [...s.querySelectorAll('.at-clock-grid.is-named .at-clock-tile strong')].map(b => b.textContent) }; });
    check(`${label}: timer window opens with the station step first (no presets yet)`, tw.win && tw.title === 'Новый таймер' && tw.presets.length === 0 && tw.named.length === 0, JSON.stringify(tw));
    // the station is a mandatory choice: presets wait until it is made
    const waiting = await page.evaluate(() => ({ required: !!document.querySelector('.at-clock-stations.is-required'), disabled: document.querySelector('.at-clock-grid .at-clock-tile')?.disabled, chips: [...document.querySelectorAll('.at-clock-stations .hm-pill')].map(b => b.textContent) }));
    check(`${label}: timer waits for the station choice`, waiting.required && waiting.disabled === undefined && waiting.chips.join(',') === 'Без Алисы,Гостиная,Детская', JSON.stringify(waiting));
    await page.click('.at-clock-stations .hm-pill:nth-child(2)'); await page.waitForTimeout(200);
    const tw2 = await page.evaluate(() => { const s = document.querySelector('.at-win'); return { presets: [...s.querySelectorAll('.at-clock-grid:not(.is-named) .at-clock-tile')].map(b => b.querySelector('b').textContent), named: [...s.querySelectorAll('.at-clock-grid.is-named .at-clock-tile strong')].map(b => b.textContent) }; });
    check(`${label}: presets appear once the station is chosen`, tw2.presets.join(',') === '1,3,5,10,15,30,1' && tw2.named.join(',') === 'Яйца,Чай,Паста,Стирка,Духовка,своё…', JSON.stringify(tw2));
    // start a 4-minute «Чай» with Alice in the living room: label carries the station, Alice gets the phrase
    await page.click('.at-clock-grid.is-named .at-clock-tile:nth-child(2)'); await page.waitForTimeout(400);
    const log = await page.evaluate(() => window.atomPreview.host.log.slice(-3));
    check(`${label}: named preset «Чай» with Alice → label|240|station, timer.start 00:04:00, Alice command`, log.length === 3 && log[0].domain === 'input_text' && log[0].data.value === '{"timer.atom_1":"Чай|240|living_yandex_max"}' && log[1].domain === 'timer' && log[1].service === 'start' && log[1].data.duration === '00:04:00' && log[2].domain === 'yandex_station' && log[2].data.command === 'поставь таймер на 4 минуты', JSON.stringify(log));
    const closed = await page.evaluate(() => !document.querySelector('.at-win'));
    check(`${label}: the window closes after the start`, closed, 'window still open');
    await page.click('.at-clock-new'); await page.waitForTimeout(300);
    const reset = await page.evaluate(() => !!document.querySelector('.at-clock-stations.is-required'));
    check(`${label}: the choice is asked again next time`, reset, 'still chosen');
    await page.click('.at-clock-stations .hm-pill:nth-child(1)'); await page.waitForTimeout(150);
    // custom time wheel
    await page.click('.at-clock-tile.is-dial'); await page.waitForTimeout(300);
    const dialLoc = page.locator('.at-clock-dial'); await dialLoc.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); const dialBox = await dialLoc.boundingBox(); await dialLoc.click({ position: { x: dialBox.width * 0.9, y: dialBox.height / 2 } }); await page.waitForTimeout(200);
    const dial = await page.evaluate(() => ({ dial: !!document.querySelector('.at-clock-dial'), value: document.querySelector('.at-clock-dial .value')?.textContent, go: document.querySelector('.at-clock-go')?.textContent, knob: !!document.querySelector('.at-clock-dial .knob') }));
    check(`${label}: dial opens at 10:00, a tap at 3 o'clock sets 15:00`, dial.dial && dial.knob && /^1[456]:00$/.test(dial.value ?? '') && /1[456]:00/.test(dial.go ?? ''), JSON.stringify(dial));
    // running timer: mutate the snapshot and redraw — the tile shows the countdown, the sheet a ring
    await page.evaluate(() => { window.fx.states['timer.atom_1'] = { ...window.fx.states['timer.atom_1'], state: 'active', attributes: { duration: '0:10:00', finishes_at: new Date(Date.now() + 581000).toISOString() } }; window.fx.states['input_text.atom_timer_labels'] = { ...window.fx.states['input_text.atom_timer_labels'], state: '{"timer.atom_1":"Чай|600"}' }; window.atomPreview.redraw(); });
    await page.waitForTimeout(600); await shot('timer');
    const run = await page.evaluate(() => { const s = document.querySelector('.at-clock'); return { rows: s.querySelectorAll('.at-clock-trow').length, left: s.querySelector('.at-clock-ring b')?.textContent, label: s.querySelector('.at-clock-tt strong')?.textContent, ctl: s.querySelectorAll('.at-clock-ctl').length, icon: !!s.querySelector('.at-clock-trow-icon svg') }; });
    check(`${label}: running timer row with ring, label, pause and cancel`, run.rows === 1 && /^9:(40|41)$/.test(run.left ?? '') && run.label === 'Чай' && run.ctl === 2 && run.icon, JSON.stringify(run));
    await page.evaluate(() => document.querySelector('.at-win-head .hm-icon-btn:last-child')?.click()); await page.waitForTimeout(200);
    await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(500); await shot('home-timer');
    const tileT = await page.evaluate(() => { const t = document.querySelector('button.ah-clock'); return { timer: t.classList.contains('is-timer'), big: t.querySelector('.ah-clock-big b')?.textContent, ring: !!t.querySelector('.ah-clock-ring'), hands: t.querySelectorAll('.ah-hand').length }; });
    check(`${label}: tile shows the countdown ring instead of hands`, tileT.timer && /^9:(3|4)\d$/.test(tileT.big ?? '') && tileT.ring && tileT.hands === 0, JSON.stringify(tileT));
    // timer done: the house banner
    await page.evaluate(() => { window.fx.states['timer.atom_1'] = { ...window.fx.states['timer.atom_1'], state: 'idle', attributes: { duration: '0:10:00' } }; window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'on' }; window.atomPreview.redraw(); });
    await page.waitForTimeout(600); await shot('banner');
    const banner = await page.evaluate(() => ({ text: document.querySelector('.at-house-banner')?.textContent ?? null, tileTimer: document.querySelector('button.ah-clock')?.classList.contains('is-timer') }));
    check(`${label}: timer-done banner with Stop, tile back to hands`, !!banner.text && banner.text.includes('Таймер готов') && banner.text.includes('Чай · 10 мин') && banner.text.includes('Стоп') && banner.tileTimer === false, JSON.stringify(banner));
    await page.click('.at-house-banner .hm-pill'); await page.waitForTimeout(300); const stop = await page.evaluate(() => window.atomPreview.host.log.slice(-1)[0]);
    check(`${label}: Stop turns the flag off`, stop?.domain === 'input_boolean' && stop.service === 'turn_off' && stop.data.entity_id === 'input_boolean.timer_done', JSON.stringify(stop));
    // alarms: add one for the kids' room with sunrise and 5 repeats, save through the store, toggle it
    await page.evaluate(() => { location.hash = '#home?device=clock'; }); await page.waitForSelector('.at-clock'); await page.waitForTimeout(300);
    await page.click('.at-clock-alarms .at-alarm-add'); await page.waitForTimeout(400); await shot('alarm-win');
    const kids = await page.evaluate(() => { const w = document.querySelector('.at-win'); const chips = [...(w?.querySelectorAll('.at-alarm-editor .at-clock-presets:first-of-type .hm-pill') ?? [])].map(x => x.textContent); const b = [...(w?.querySelectorAll('.at-alarm-editor .at-clock-presets:first-of-type .hm-pill') ?? [])].find(x => x.textContent === 'Детская'); b?.click(); return { win: !!w, title: w?.querySelector('h3')?.textContent, chip: !!b, chips }; });
    check(`${label}: editor window opens with speaker rooms only (Гостиная, Детская), not Подъезд`, kids.win && kids.title === 'Новый будильник' && kids.chip && kids.chips.join(',') === 'Гостиная,Детская', JSON.stringify(kids));
    await page.waitForTimeout(200);
    await page.fill('.at-alarm-time input[type=time]', '07:30');
    const ed = await page.evaluate(() => { const e = document.querySelector('.at-alarm-editor'); const rep = [...e.querySelectorAll('.hm-pill')].find(x => x.textContent === '×5'); rep?.click(); return { light: [...e.querySelectorAll('.ah-row strong')].map(x => x.textContent), lightOn: e.querySelector('.ah-row .hm-switch')?.getAttribute('aria-checked'), noStation: e.textContent.includes('нет Станции'), rep: !!rep }; });
    check(`${label}: kids' room → sunrise with the chandelier on by default, Alice offered, repeats chosen`, ed.light.includes('Свет: плавный рассвет') && !ed.light.includes('Push на телефоны') && ed.lightOn === 'true' && !ed.noStation && ed.rep, JSON.stringify(ed));
    await page.click('.at-alarm-save'); await page.waitForTimeout(500); await shot('alarm');
    const saved = await page.evaluate(() => { const r = document.querySelector('.at-win .at-alarm-row'); const chip = document.querySelector('.at-alarm-chip'); return { rows: document.querySelectorAll('.at-win .at-alarm-row').length, text: r?.textContent, chip: chip?.textContent, cfg: window.atomPreview.config.alarms?.map(a => `${a.room} ${a.time} light=${a.light} fade=${a.fadeMin} rep=${a.repeats}`) }; });
    check(`${label}: alarm saved, listed in the alarms window and as a chip on the card`, saved.rows === 1 && /Детская · 07:30/.test(saved.text ?? '') && /рассвет 15 мин/.test(saved.text ?? '') && /07:30Детская/.test(saved.chip ?? '') && saved.cfg?.[0] === 'detskaia 07:30 light=true fade=15 rep=5', JSON.stringify(saved));
    await page.evaluate(() => document.querySelector('.at-win-head .hm-icon-btn:last-child')?.click()); await page.waitForTimeout(200);
    // the integration rings: flag + text → banner with Stop
    await page.evaluate(() => { window.fx.states['input_boolean.alarm_ringing'] = { ...window.fx.states['input_boolean.alarm_ringing'], state: 'on' }; window.fx.states['input_text.alarm_ringing'] = { ...window.fx.states['input_text.alarm_ringing'], state: 'a1|Детская|07:30|Дети|4' }; window.atomPreview.redraw(); });
    await page.waitForTimeout(500); await shot('alarm-banner');
    const ab = await page.evaluate(() => document.querySelector('.at-house-banner')?.textContent ?? null);
    check(`${label}: alarm banner with room, time and repeats left`, !!ab && ab.includes('Будильник · Детская · 07:30') && /ещё 4 повтор(а|ов)?/.test(ab) && ab.includes('Стоп'), String(ab));
    await page.evaluate(() => { window.fx.states['input_boolean.alarm_ringing'] = { ...window.fx.states['input_boolean.alarm_ringing'], state: 'off' }; window.atomPreview.redraw(); });
    // settings: digital style persists per device
    await page.evaluate(() => { window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'off' }; window.atomPreview.redraw(); location.hash = '#home?device=clock'; }); await page.waitForSelector('.at-clock'); await page.click('.at-clock .at-cam-gear'); await page.waitForTimeout(300); await shot('settings');
    const settings = await page.evaluate(() => { const s = document.querySelector('.at-win'); return { win: !!s, rows: [...(s?.querySelectorAll('.ah-row strong') ?? [])].map(x => x.textContent), switches: s?.querySelectorAll('.hm-switch').length }; });
    check(`${label}: settings window rows`, settings.win && settings.rows.includes('Секундная стрелка') && settings.rows.includes('Объявлять таймер на Станциях') && settings.switches === 5, JSON.stringify(settings));
    await page.click('.at-win .at-clock-seg button:nth-child(2)'); await page.waitForTimeout(200); await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(500); await shot('home-digital');
    const digital = await page.evaluate(() => ({ digital: !!document.querySelector('button.ah-clock .ah-clock-digital'), stored: localStorage.getItem('atom-home:clock') }));
    check(`${label}: digital tile after the setting`, digital.digital && /"style":"digital"/.test(digital.stored ?? ''), JSON.stringify(digital));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`); for (const e of report.errors) console.log('  ' + e);
process.exit(report.checks.every(c => c.ok) && report.errors.length === 0 ? 0 : 1);
