// Clock QA on the Criuleni snapshot + synthetic sun/timers/people (preview host): the home tile (analog, timer, digital), the «Time» sheet, starting a timer, settings — six sizes.
// usage: node scripts/qa-clock.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview'); // QA_DIST: another build of the preview
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
    await page.evaluate(() => window.atomPreview.setAccept(true)); // the house accepts: a refused start is checked apart, below
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
    await page.evaluate(() => { const at = new Date().toISOString(); /* a state that changes carries the moment of the change, as in Home Assistant */ window.fx.states['timer.atom_1'] = { ...window.fx.states['timer.atom_1'], state: 'idle', attributes: { duration: '0:10:00' }, last_changed: at }; window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'on', last_changed: at }; window.atomPreview.redraw(); });
    await page.waitForTimeout(600); await shot('banner');
    const banner = await page.evaluate(() => ({ text: document.querySelector('.at-house-banner')?.textContent ?? null, tileTimer: document.querySelector('button.ah-clock')?.classList.contains('is-timer') }));
    check(`${label}: timer-done banner with Stop, tile back to hands`, !!banner.text && banner.text.includes('Таймер готов') && banner.text.includes('Чай · 10 мин') && banner.text.includes('Стоп') && banner.tileTimer === false, JSON.stringify(banner));
    await page.click('.at-house-banner .hm-pill'); await page.waitForTimeout(300); const stop = await page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').slice(-1)[0]); // the last COMMAND: a camera's own read on the socket may come after it
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

  // ---- audit 2026-11-09: refusals, double taps, the editor's keyboard and names, the nearest alarm, the right timer in the banner ----
  for (const [w, h, label] of [[1070, 764, 'audit-tablet'], [360, 792, 'audit-phone']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, config);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(600);
    const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: resolve(out, `${label}-${name}.png`) }); };
    const cmds = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => `${c.domain}.${c.service}`));
    const clear = () => page.evaluate(() => { window.atomPreview.host.log.length = 0; });
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(300);
    // a house that refuses (HA's {code, message}): the timer is not started twice, Alice is not told, the reason is in Russian, the window stays
    await page.evaluate(() => { window.atomPreview.setAccept(true); const h = window.atomPreview.host, real = h.call.bind(h); h.call = async (d, s, data) => { if (d === 'timer') { h.log.push({ domain: d, service: s, data }); throw { code: 'service_validation_error', message: 'Timer is busy' }; } return real(d, s, data); }; window.__timerCall = real; });
    await page.click('.at-clock-new'); await page.waitForTimeout(300); await page.click('.at-clock-stations .hm-pill:nth-child(2)'); await page.waitForTimeout(200); await clear();
    await page.click('.at-clock-grid:not(.is-named) .at-clock-tile:nth-child(2)'); await page.waitForTimeout(500);
    const refused = { log: await cmds(), win: await page.evaluate(() => !!document.querySelector('.at-win')), note: await page.evaluate(() => document.querySelector('.at-win .at-alarm-note')?.textContent ?? ''), role: await page.evaluate(() => document.querySelector('.at-win .at-alarm-note')?.getAttribute('role') ?? ''), under: await page.evaluate(() => document.querySelectorAll('.at-clock .at-cam-note').length) };
    check(`${label}: a refused timer.start does not go on to Alice and gives the slot's label back`, refused.log.filter(x => x === 'timer.start').length === 1 && !refused.log.includes('yandex_station.send_command') && refused.log.at(-1) === 'input_text.set_value' && refused.win, JSON.stringify(refused));
    check(`${label}: the refusal is said in Russian, never «[object Object]» or raw English alone`, /Дом отклонил команду|Команда не выполнена/.test(refused.note) && !/object Object/.test(refused.note), refused.note);
    check(`${label}: round 2 f17 — the timer's refusal stands inside the «Новый таймер» window (role=alert), not under it`, refused.win && refused.role === 'alert' && refused.under === 0, JSON.stringify(refused));
    // one intent, one timer: two fast taps while the commands are on their way
    await page.evaluate(() => { window.atomPreview.host.call = window.__timerCall; window.atomPreview.setRefusal(null); window.atomPreview.setAccept(true); window.atomPreview.setDelay(250); }); await clear();
    await page.evaluate(() => { const b = document.querySelectorAll('.at-clock-grid:not(.is-named) .at-clock-tile'); b[1].click(); b[2].click(); b[1].click(); }); await page.waitForTimeout(120);
    const pending = await page.evaluate(() => ({ disabled: [...document.querySelectorAll('.at-win .at-clock-tile')].every(b => b.disabled), dots: document.querySelector('.at-clock-grid:not(.is-named) .at-clock-tile:nth-child(2) b')?.textContent, stations: [...document.querySelectorAll('.at-clock-stations .hm-pill')].every(b => b.disabled) }));
    await page.waitForTimeout(1200); const twice = await cmds();
    check(`${label}: a second tap during the start sets no second timer`, twice.filter(x => x === 'timer.start').length === 1 && twice.filter(x => x === 'yandex_station.send_command').length === 1 && pending.disabled && pending.stations && pending.dots === '…', JSON.stringify({ twice, pending }));
    await page.evaluate(() => window.atomPreview.setDelay(0));
    // the speaker refuses, the timer runs: it is not written down as «у Алисы», and the sheet says so
    await page.evaluate(() => { const h = window.atomPreview.host, real = h.call.bind(h); window.__realCall = real; h.call = async (d, s, data) => { if (d === 'yandex_station') { h.log.push({ domain: d, service: s, data }); throw { code: 'home_assistant_error', message: 'Station offline' }; } return real(d, s, data); }; });
    await page.click('.at-clock-new'); await page.waitForTimeout(300); await page.click('.at-clock-stations .hm-pill:nth-child(2)'); await page.waitForTimeout(200); await clear();
    await page.click('.at-clock-grid:not(.is-named) .at-clock-tile:nth-child(1)'); await page.waitForTimeout(600);
    const alice = await page.evaluate(() => ({ log: window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => c.domain === 'input_text' ? c.data.value : `${c.domain}.${c.service}`), note: document.querySelector('.at-clock .at-cam-note')?.textContent ?? '' }));
    check(`${label}: Alice refused → the label loses the station and the sheet says the timer runs in the panel only`, alice.log.length === 4 && /\|60\|living_yandex_max"/.test(alice.log[0]) && alice.log[1] === 'timer.start' && alice.log[2] === 'yandex_station.send_command' && /\|60"/.test(alice.log[3]) && !/living_yandex_max/.test(alice.log[3]) && /Алиса не приняла команду/.test(alice.note), JSON.stringify(alice));
    await page.evaluate(() => { window.atomPreview.host.call = window.__realCall; });
    // a long label keeps the station (it was cut at 32 characters and «Отмена» went to a speaker that does not exist)
    await page.evaluate(() => { window.fx.states['timer.atom_2'] = { ...window.fx.states['timer.atom_2'], state: 'active', attributes: { duration: '0:00:15', finishes_at: new Date(Date.now() + 14000).toISOString() } }; window.fx.states['timer.atom_3'] = { ...window.fx.states['timer.atom_3'], state: 'paused', attributes: { duration: '0:01:30', remaining: '0:00:05' } }; window.fx.states['input_text.atom_timer_labels'] = { ...window.fx.states['input_text.atom_timer_labels'], state: JSON.stringify({ 'timer.atom_2': 'Очень длинная подпись|15|living_yandex_max', 'timer.atom_3': 'Стирка|90' }) }; window.atomPreview.redraw(); });
    await page.waitForTimeout(400); await shot('timers'); await clear();
    const rows = await page.evaluate(() => [...document.querySelectorAll('.at-clock-trow')].map(r => r.querySelector('.at-clock-tt')?.textContent ?? ''));
    check(`${label}: short timers are named by their real length («15 с», «1 мин 30 с»), not «0 мин» / «2 мин»`, rows.some(r => /Очень длинная подпись15 с · и у Алисы/.test(r)) && rows.some(r => /Стирка1 мин 30 с · пауза/.test(r)), JSON.stringify(rows));
    await page.evaluate(() => [...document.querySelectorAll('.at-clock-trow')].find(r => /Очень длинная/.test(r.textContent))?.querySelector('.at-clock-ctl.is-stop')?.click()); await page.waitForTimeout(400);
    const cancel = await page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => `${c.domain}.${c.service}:${c.data.entity_id}`));
    check(`${label}: «Отмена» of a long-labelled timer reaches its speaker`, cancel.join(',') === 'timer.cancel:timer.atom_2,yandex_station.send_command:media_player.living_yandex_max', JSON.stringify(cancel));
    // the tile shows the timer that RUNS, not the paused one with less time left
    await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(500);
    const tile = await page.evaluate(() => document.querySelector('button.ah-clock .ah-clock-big')?.textContent ?? '');
    check(`${label}: the tile shows the running timer, the paused one is «+1»`, /^0:(0\d|1[0-4])Очень длинная подпись/.test(tile) && !/пауза/.test(tile), tile);
    // the banner names the timer that has just ended, not the first slot that has a label
    await page.evaluate(() => { const at = new Date().toISOString(); window.fx.states['timer.atom_1'] = { ...window.fx.states['timer.atom_1'], state: 'idle', last_changed: new Date(Date.now() - 3600000).toISOString() }; window.fx.states['timer.atom_2'] = { ...window.fx.states['timer.atom_2'], state: 'active' }; window.fx.states['timer.atom_3'] = { ...window.fx.states['timer.atom_3'], state: 'idle', attributes: { duration: '0:01:30' }, last_changed: at }; window.fx.states['input_text.atom_timer_labels'] = { ...window.fx.states['input_text.atom_timer_labels'], state: JSON.stringify({ 'timer.atom_1': 'Чай|240', 'timer.atom_2': 'Паста|600', 'timer.atom_3': 'Стирка|90' }) }; window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'on', last_changed: at }; window.atomPreview.redraw(); });
    await page.waitForTimeout(500); await shot('banner');
    const banner = await page.evaluate(() => document.querySelector('.at-house-banner')?.textContent ?? '');
    check(`${label}: «Таймер готов» is signed by the timer that ended (Стирка · 1 мин 30 с)`, /Таймер готов/.test(banner) && /Стирка · 1 мин 30 с/.test(banner) && !/Чай|Паста/.test(banner), banner);
    await page.evaluate(() => { for (const id of ['timer.atom_1', 'timer.atom_2', 'timer.atom_3']) window.fx.states[id] = { ...window.fx.states[id], state: 'idle' }; window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'off' }; window.fx.states['input_text.atom_timer_labels'] = { ...window.fx.states['input_text.atom_timer_labels'], state: '{}' }; window.fx.states['person.gayane'] = { ...window.fx.states['person.gayane'], state: 'unknown' }; window.atomPreview.redraw(); location.hash = '#home?device=clock'; });
    await page.waitForSelector('.at-clock'); await page.waitForTimeout(400);
    // «кто дома»: no data is not «не дома»
    const who = await page.evaluate(() => [...document.querySelectorAll('.at-clock-person')].map(p => p.textContent));
    check(`${label}: a person with no data is «нет данных», not «не дома»`, who.some(x => /Gayane.*нет данных/.test(x)) && !who.some(x => /Gayane.*не дома/.test(x)), JSON.stringify(who));
    check(`${label}: day length and time to the next sun event never say «60 мин»`, await page.evaluate(() => !/ 60 мин/.test(document.querySelector('.at-clock-sun')?.textContent ?? '')));
    // the alarm editor: focus moves in, fields have names, the chosen days are said by state, shape and words
    const opener = '.at-clock-alarms .at-alarm-add'; await page.focus(opener); await page.keyboard.press('Enter'); await page.waitForTimeout(400); await shot('editor');
    const ed = await page.evaluate(() => { const w = document.querySelector('.at-win'), days = [...w.querySelectorAll('.at-alarm-days .hm-pill.is-day')]; return { focusIn: !!document.activeElement?.closest('.at-win'), time: w.querySelector('input[type=time]')?.getAttribute('aria-label'), label: w.querySelector('.at-alarm-time .at-clock-label-input')?.getAttribute('aria-label'), pressed: days.map(d => d.getAttribute('aria-pressed')).join(','), names: days.map(d => d.getAttribute('aria-label')).join(','), bar: days.map(d => getComputedStyle(d, '::after').content !== 'none' && getComputedStyle(d, '::after').height === '2px').join(','), words: w.querySelector('.at-alarm-when')?.textContent, group: w.querySelector('.at-alarm-days')?.getAttribute('role'), others: [...w.querySelectorAll('.at-alarm-editor .hm-pill')].every(b => b.hasAttribute('aria-pressed') || /at-alarm-(save|delete)/.test(b.className) || b.textContent === 'Отмена'), placeholder: getComputedStyle(w.querySelector('.at-clock-label-input'), '::placeholder').opacity }; });
    check(`${label}: editor — focus inside, time and label named, days pressed/unpressed with a bar and in words`, ed.focusIn && ed.time === 'Время будильника' && ed.label === 'Подпись будильника' && ed.pressed === 'true,true,true,true,true,false,false' && /^понедельник,вторник/.test(ed.names) && ed.bar === 'true,true,true,true,true,false,false' && ed.words === 'Звонит: будни' && ed.group === 'group' && ed.others && ed.placeholder === '1', JSON.stringify(ed));
    await page.evaluate(() => [...document.querySelectorAll('.at-alarm-days .hm-pill.is-small')].find(b => b.textContent === 'один раз')?.click()); await page.waitForTimeout(200);
    const once = await page.evaluate(() => ({ words: document.querySelector('.at-alarm-when')?.textContent, pressed: [...document.querySelectorAll('.at-alarm-days .hm-pill.is-small')].map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`).join(',') }));
    check(`${label}: «один раз» says what the house does — rings once, then switches off`, once.words === 'Один раз: прозвонит и выключится' && once.pressed === 'будни:false,выходные:false,один раз:true', JSON.stringify(once));
    // Escape closes the window only: first the editor's window, the sheet stays; the focus returns to the button that opened it
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    const esc1 = await page.evaluate(sel => ({ win: !!document.querySelector('.at-win'), sheet: !!document.querySelector('.at-clock'), back: document.activeElement === document.querySelector(sel) }), opener);
    check(`${label}: Escape in the editor closes the editor, not the «Время» sheet under it`, esc1.sheet && (!esc1.win || await page.evaluate(() => !document.querySelector('.at-alarm-editor'))), JSON.stringify(esc1));
    check(`${label}: round 2 l150 — «+ Будильник» from the sheet: one Escape leads back to the sheet, not into the list «Будильники»`, esc1.sheet && !esc1.win && esc1.back, JSON.stringify(esc1));
    if (esc1.win) { await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
    const esc2 = await page.evaluate(sel => ({ win: !!document.querySelector('.at-win'), sheet: !!document.querySelector('.at-clock'), back: document.activeElement === document.querySelector(sel) }), opener);
    check(`${label}: the windows are gone, the sheet is open, focus is back on «+ Будильник»`, !esc2.win && esc2.sheet && esc2.back, JSON.stringify(esc2));
    // two alarms: the card shows the one that rings next first (not the earliest by the clock); a save the house refuses is said in Russian
    const soon = await page.evaluate(() => { const n = new Date(Date.now() + 2 * 3600000), p = x => String(x).padStart(2, '0'), late = new Date(Date.now() - 3600000); return { soon: `${p(n.getHours())}:${p(n.getMinutes())}`, past: `${p(late.getHours())}:${p(late.getMinutes())}`, sameDay: n.getDate() === new Date().getDate() && late.getDate() === new Date().getDate() }; });
    const base = { room: 'detskaia', days: [1, 2, 3, 4, 5, 6, 7], enabled: true, label: '', alice: 'tts', phrase: '', station: 'media_player.kids_yandex_mini', light: false, lightEntity: '', fadeMin: 15, push: false, repeats: 0, repeatEveryMin: 5 };
    await page.reload();
    await page.waitForFunction(() => window.ready); await page.evaluate(async cfg => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, { ...config, alarms: [{ ...base, id: 'past', time: soon.past }, { ...base, id: 'soon', time: soon.soon }, { ...base, id: 'off', time: soon.soon, enabled: false, room: 'gostinaia' }] });
    await page.evaluate(() => { location.hash = '#home?device=clock'; }); await page.waitForSelector('.at-clock'); await page.waitForTimeout(400);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.at-alarm-chip b')].map(b => b.textContent));
    if (soon.sameDay && soon.past < soon.soon) check(`${label}: the alarms card starts with the one that rings next`, chips[0] === soon.soon && chips[1] === soon.past, JSON.stringify({ chips, soon }));
    else check(`${label}: the alarms card shows two alarms (order not asserted within two hours of midnight)`, chips.length === 2, JSON.stringify({ chips, soon }));
    // an alarm «один раз» is switched off by the house after it rings: the panel reads the settings again when the ringing flag changes
    await page.evaluate(async () => { const other = window.atomPreview.store.client(), c = (await other.load()).config; await other.saveAlarms(c.alarms.map(a => a.id === 'soon' ? { ...a, enabled: false } : a)); });
    const stale = await page.evaluate(() => window.atomPreview.config.alarms.find(a => a.id === 'soon')?.enabled);
    await page.evaluate(() => { window.fx.states['input_boolean.alarm_ringing'] = { ...window.fx.states['input_boolean.alarm_ringing'], state: 'on' }; window.atomPreview.redraw(); }); await page.waitForTimeout(400);
    await page.evaluate(() => { window.fx.states['input_boolean.alarm_ringing'] = { ...window.fx.states['input_boolean.alarm_ringing'], state: 'off' }; window.atomPreview.redraw(); }); await page.waitForTimeout(400);
    const fresh = await page.evaluate(() => ({ cfg: window.atomPreview.config.alarms.find(a => a.id === 'soon')?.enabled, chips: [...document.querySelectorAll('.at-alarm-chip b')].length }));
    check(`${label}: after a ring the list of alarms is read again (an alarm the house switched off is shown off at once)`, stale === true && fresh.cfg === false && fresh.chips === 1, JSON.stringify({ stale, fresh }));
    await page.click('.at-clock-all'); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('.at-win .at-alarm-row .at-alarm-main')?.click()); await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.atomPreview.config.alarms.length);
    await page.click('.at-alarm-delete'); await page.waitForTimeout(250); await shot('delete-ask');
    const ask = await page.evaluate(() => ({ text: document.querySelector('.at-alarm-ask span')?.textContent ?? '', n: window.atomPreview.config.alarms.length, editor: !!document.querySelector('.at-alarm-editor') }));
    check(`${label}: «Удалить» asks first, by the alarm's room and time`, /^Удалить будильник «Детская · \d\d:\d\d»\?$/.test(ask.text) && ask.n === before && ask.editor, JSON.stringify(ask));
    await page.evaluate(() => { window.atomPreview.store.saveAlarms = async () => { throw { code: 'unknown_error', message: 'Configuration was changed elsewhere' }; }; });
    await page.click('.at-alarm-delete-yes'); await page.waitForTimeout(400);
    const fail = await page.evaluate(() => ({ note: document.querySelector('.at-win .at-alarm-note')?.textContent ?? '', role: document.querySelector('.at-win .at-alarm-note')?.getAttribute('role'), editor: !!document.querySelector('.at-alarm-editor'), n: window.atomPreview.config.alarms.length }));
    check(`${label}: a refused alarm save is said in Russian inside the editor, nothing is lost`, /[а-яё]{4}/i.test(fail.note) && !/object Object|Configuration was changed/.test(fail.note) && fail.role === 'alert' && fail.editor && fail.n === before, JSON.stringify(fail));
    await page.close();
  }

  // ---- audit 2026-11-09, round 2: refusals inside the window, waiting buttons, the editor's exits, focus in a shadow root, the first touch ----
  const mount = async (page, cfg, query = '') => { await page.goto(origin + '/' + query); await page.waitForFunction(() => window.ready); await page.evaluate(async c => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, c); }, cfg); await page.waitForSelector('.at-shell'); await page.waitForTimeout(600); };
  const alarmBase = { room: 'detskaia', days: [1, 2, 3, 4, 5, 6, 7], enabled: true, label: '', alice: 'tts', phrase: '', station: 'media_player.kids_yandex_mini', light: false, lightEntity: '', fadeMin: 15, push: false, repeats: 0, repeatEveryMin: 5 };
  { const label = 'round2', page = await browser.newPage({ viewport: { width: 1070, height: 764 } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    await page.addInitScript(() => { window.__audio = 0; const Real = window.AudioContext; if (Real) window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__audio++; } }; });
    await mount(page, config);
    const cmds = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => `${c.domain}.${c.service}`)), clear = () => page.evaluate(() => { window.atomPreview.host.log.length = 0; });
    // f73: the first touch builds no AudioContext (it blocked the main thread under the finger); the first sound does, once
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(2600);
    const touched = await page.evaluate(() => window.__audio);
    await page.evaluate(() => { window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'on' }; window.atomPreview.redraw(); }); await page.waitForTimeout(500);
    const rang = await page.evaluate(() => window.__audio);
    await page.evaluate(() => { window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'off' }; window.atomPreview.redraw(); }); await page.waitForTimeout(200);
    await page.evaluate(() => { window.fx.states['input_boolean.alarm_ringing'] = { ...window.fx.states['input_boolean.alarm_ringing'], state: 'on' }; window.atomPreview.redraw(); }); await page.waitForTimeout(500);
    const again = await page.evaluate(() => window.__audio);
    await page.evaluate(() => { window.fx.states['input_boolean.alarm_ringing'] = { ...window.fx.states['input_boolean.alarm_ringing'], state: 'off' }; window.atomPreview.redraw(); }); await page.waitForTimeout(200);
    check(`${label}: f73 — no AudioContext after the first touch (2.6 s), one when the first banner sounds, the same one for the next`, touched === 0 && rang === 1 && again === 1, JSON.stringify({ touched, rang, again }));
    // f17: the house is away — the window says so itself
    await page.evaluate(() => window.atomPreview.setAccept(true)); await page.click('.at-clock-new'); await page.waitForTimeout(300); await page.click('.at-clock-stations .hm-pill:nth-child(1)'); await page.waitForTimeout(150);
    await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(150); await clear();
    await page.click('.at-clock-grid:not(.is-named) .at-clock-tile:nth-child(3)'); await page.waitForTimeout(400);
    const away = await page.evaluate(() => ({ win: !!document.querySelector('.at-win'), note: document.querySelector('.at-win .at-alarm-note')?.textContent ?? '', role: document.querySelector('.at-win .at-alarm-note')?.getAttribute('role'), under: document.querySelectorAll('.at-clock .at-cam-note').length, sent: window.atomPreview.host.log.filter(c => c.domain !== 'ws').length }));
    check(`${label}: f17 — no connection: «Нет связи с домом» inside the timer window, nothing sent, nothing under the window`, away.win && away.note === 'Нет связи с домом' && away.role === 'alert' && away.under === 0 && away.sent === 0, JSON.stringify(away)); await page.screenshot({ path: resolve(out, `${label}-timer-offline.png`) });
    await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForTimeout(150);
    // l40: the label is refused, the timer and Alice would accept — nothing is started, the reason is in the window
    await page.evaluate(() => { const h = window.atomPreview.host, real = h.call.bind(h); window.__realCall = real; h.call = async (d, s, data) => { if (d === 'input_text') { h.log.push({ domain: d, service: s, data }); throw { code: 'service_validation_error', message: 'Value too long' }; } return real(d, s, data); }; });
    await page.click('.at-clock-stations .hm-pill:nth-child(2)'); await page.waitForTimeout(150); await clear();
    await page.click('.at-clock-grid:not(.is-named) .at-clock-tile:nth-child(1)'); await page.waitForTimeout(500);
    const unlabelled = { log: await cmds(), win: await page.evaluate(() => !!document.querySelector('.at-win')), note: await page.evaluate(() => document.querySelector('.at-win .at-alarm-note')?.textContent ?? '') };
    check(`${label}: l40 — a refused label starts no timer and tells Alice nothing (the speaker could not be told «отмени» later)`, unlabelled.log.join(',') === 'input_text.set_value' && unlabelled.win && /Дом отклонил команду: Value too long/.test(unlabelled.note), JSON.stringify(unlabelled));
    await page.evaluate(() => { window.atomPreview.host.call = window.__realCall; }); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    // l41: pause and cancel wait for the house — the buttons are busy and disabled while the command is on its way
    await page.evaluate(() => { window.fx.states['timer.atom_1'] = { ...window.fx.states['timer.atom_1'], state: 'active', attributes: { duration: '0:10:00', finishes_at: new Date(Date.now() + 581000).toISOString() } }; window.atomPreview.setDelay(500); window.atomPreview.redraw(); }); await page.waitForTimeout(300); await clear();
    await page.evaluate(() => { const b = document.querySelector('.at-clock-trow .at-clock-ctl'); b.click(); b.click(); }); await page.waitForTimeout(150);
    const waiting = await page.evaluate(() => [...document.querySelectorAll('.at-clock-trow .at-clock-ctl')].map(b => ({ disabled: b.disabled, busy: b.getAttribute('aria-busy') })));
    await page.waitForTimeout(900); const paused = { log: await cmds(), after: await page.evaluate(() => [...document.querySelectorAll('.at-clock-trow .at-clock-ctl')].map(b => b.disabled)) };
    check(`${label}: l41 — «Пауза» waits: both buttons of the row disabled, the pressed one busy, one command, free again afterwards`, waiting.length === 2 && waiting.every(b => b.disabled) && waiting[0].busy === 'true' && paused.log.join(',') === 'timer.pause' && paused.after.every(d => !d), JSON.stringify({ waiting, paused }));
    await page.click('.at-clock .at-cam-gear'); await page.waitForTimeout(300); await clear();
    await page.evaluate(() => { const sw = [...document.querySelectorAll('.at-win .hm-switch')].at(-1); sw.click(); sw.click(); }); await page.waitForTimeout(150);
    const sw = await page.evaluate(() => [...document.querySelectorAll('.at-win .hm-switch')].at(-1).classList.contains('is-pending'));
    await page.waitForTimeout(900); const swLog = await cmds(), swAfter = await page.evaluate(() => [...document.querySelectorAll('.at-win .hm-switch')].at(-1).classList.contains('is-pending'));
    check(`${label}: l41 — a shared switch («push») shows the wait and sends one command`, sw && !swAfter && swLog.length === 1 && /^input_boolean\.turn_(on|off)$/.test(swLog[0]), JSON.stringify({ sw, swAfter, swLog }));
    await page.evaluate(() => { window.atomPreview.setDelay(0); window.fx.states['timer.atom_1'] = { ...window.fx.states['timer.atom_1'], state: 'idle' }; window.atomPreview.redraw(); }); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    // f72: a tap beside the editor closes it only while nothing was typed
    await page.click('.at-clock-alarms .at-alarm-add'); await page.waitForTimeout(400);
    const scrimAt = await page.evaluate(() => document.elementFromPoint(8, 400)?.className ?? '');
    await page.mouse.click(8, 400); await page.waitForTimeout(350);
    const clean = await page.evaluate(() => ({ win: !!document.querySelector('.at-win'), sheet: !!document.querySelector('.at-clock') }));
    await page.click('.at-clock-alarms .at-alarm-add'); await page.waitForTimeout(400); await page.fill('.at-alarm-time .at-clock-label-input', 'Проверка'); await page.mouse.click(8, 400); await page.waitForTimeout(350);
    const typed = await page.evaluate(() => ({ editor: !!document.querySelector('.at-win .at-alarm-editor'), value: document.querySelector('.at-alarm-time .at-clock-label-input')?.value ?? null }));
    check(`${label}: f72 — a tap on the dim layer closes an untouched editor and keeps one with something typed`, /at-win-scrim/.test(scrimAt) && !clean.win && clean.sheet && typed.editor && typed.value === 'Проверка', JSON.stringify({ scrimAt, clean, typed })); await page.screenshot({ path: resolve(out, `${label}-editor-kept.png`) });
    await page.click('.at-alarm-actions .hm-pill:nth-child(2)'); await page.waitForTimeout(350);
    const cancelled = await page.evaluate(() => ({ win: !!document.querySelector('.at-win'), sheet: !!document.querySelector('.at-clock'), n: window.atomPreview.config.alarms?.length ?? 0 }));
    check(`${label}: f72 / l150 — «Отмена» still closes it (nothing saved), straight back to the sheet`, !cancelled.win && cancelled.sheet && cancelled.n === 0, JSON.stringify(cancelled));
    // f14: where the left half scrolls (a television's 960×540) it is a stop for the keyboard and the remote, named, and the arrows scroll it
    const tabAt1070 = await page.evaluate(() => { const el = document.querySelector('.at-clock .at-cam-left'); return { tab: el.getAttribute('tabindex'), scrolls: el.scrollHeight > el.clientHeight + 1 }; });
    await page.setViewportSize({ width: 960, height: 540 }); await page.waitForTimeout(500);
    const pane = await page.evaluate(() => { const el = document.querySelector('.at-clock .at-cam-left'); return el ? { tab: el.getAttribute('tabindex'), role: el.getAttribute('role'), name: el.getAttribute('aria-label'), scrolls: el.scrollHeight > el.clientHeight + 1 } : null; });
    await page.focus('.at-clock .at-cam-left').catch(() => undefined); await page.keyboard.press('End'); await page.waitForTimeout(400);
    const scrolled = await page.evaluate(() => ({ top: document.querySelector('.at-clock .at-cam-left')?.scrollTop ?? 0, focus: document.activeElement?.className ?? '' })); await page.screenshot({ path: resolve(out, `${label}-tv-pane.png`) });
    check(`${label}: f14 — the scrolling left half of «Время» takes the focus (tabindex 0, group «Часы и солнце») and the keyboard scrolls it; no stop where it does not scroll`, !!pane && pane.scrolls && pane.tab === '0' && pane.role === 'group' && pane.name === 'Часы и солнце' && scrolled.top > 0 && /at-cam-left/.test(scrolled.focus) && (tabAt1070.scrolls ? tabAt1070.tab === '0' : tabAt1070.tab === null), JSON.stringify({ pane, scrolled, tabAt1070 }));
    await page.close(); }
  { const label = 'round2-list', page = await browser.newPage({ viewport: { width: 1070, height: 764 } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    await mount(page, { ...config, alarms: [{ ...alarmBase, id: 'one', time: '07:10' }] }); await page.evaluate(() => { location.hash = '#home?device=clock'; }); await page.waitForSelector('.at-clock'); await page.waitForTimeout(400);
    // l150: opened from the list, the editor goes back to the list
    await page.click('.at-clock-all'); await page.waitForTimeout(300); await page.click('.at-win .at-alarm-row .at-alarm-main'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const toList = await page.evaluate(() => ({ list: !!document.querySelector('.at-win .at-alarms'), editor: !!document.querySelector('.at-alarm-editor') }));
    check(`${label}: l150 — an editor opened from the list «Будильники» goes back to that list`, toList.list && !toList.editor, JSON.stringify(toList));
    // l148: the question's default answer is «Отмена»
    await page.focus('.at-win .at-alarm-row .at-alarm-main'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); await page.focus('.at-alarm-delete'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const asked = await page.evaluate(() => ({ focus: document.activeElement?.textContent ?? '', inAsk: !!document.activeElement?.closest('.at-alarm-ask'), yes: document.activeElement?.classList.contains('at-alarm-delete-yes') }));
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const kept = await page.evaluate(() => ({ n: window.atomPreview.config.alarms.length, ask: !!document.querySelector('.at-alarm-ask'), focus: document.activeElement?.className ?? '' }));
    check(`${label}: l148 — «Удалить» asks with the focus on «Отмена»; Enter twice deletes nothing and the focus is back on «Удалить»`, asked.focus === 'Отмена' && asked.inAsk && !asked.yes && kept.n === 1 && !kept.ask && /at-alarm-delete/.test(kept.focus), JSON.stringify({ asked, kept }));
    // l149: a refused save is said once, where the person looks — in the editor, and in the list when a switch there was refused
    await page.evaluate(() => { window.atomPreview.store.saveAlarms = async () => { throw { code: 'home_assistant_error', message: 'Storage is read-only' }; }; });
    await page.click('.at-alarm-save'); await page.waitForTimeout(400);
    const said = await page.evaluate(() => { const text = document.querySelector('.at-win .at-alarm-note')?.textContent ?? ''; return { text, inWin: document.querySelectorAll('.at-win .at-alarm-note').length, under: document.querySelectorAll('.at-clock .at-cam-note').length, toast: document.querySelector('.hm-toast')?.textContent ?? '' }; });
    check(`${label}: l149 — a refused alarm save: one line in the editor, none under the window`, /Дом отклонил команду: Storage is read-only/.test(said.text) && said.inWin === 1 && said.under === 0, JSON.stringify(said));
    check(`${label}: l149 — …and no toast repeating it (ui/app.tsx applyAlarms)`, said.toast === '', JSON.stringify(said));
    await page.waitForTimeout(4200); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('.at-win .at-alarm-row .hm-switch'); await page.waitForTimeout(400);
    const listSaid = await page.evaluate(() => ({ text: document.querySelector('.at-win .at-alarms ~ .at-alarm-note, .at-win .at-alarm-note')?.textContent ?? '', role: document.querySelector('.at-win .at-alarm-note')?.getAttribute('role'), on: document.querySelector('.at-win .at-alarm-row .hm-switch')?.getAttribute('aria-checked') }));
    check(`${label}: l149 — a refused switch in the list «Будильники» is said in that window (it was written under it)`, /Дом отклонил команду: Storage is read-only/.test(listSaid.text) && listSaid.role === 'alert' && listSaid.on === 'true', JSON.stringify(listSaid));
    await page.close(); }
  // f71 / f1: the same panel inside a shadow root, as Home Assistant mounts it — Tab walks the window, the focus comes back, the editor opened from a room page takes the focus
  { const label = 'round2-shadow', page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    await page.addInitScript(() => { window.R = () => document.getElementById('root')?.shadowRoot ?? document; window.A = () => window.R().activeElement; window.say = el => el ? `${el.tagName.toLowerCase()}:${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 20) ?? ''}` : 'none'; });
    await mount(page, config, '?shadow=1');
    const inShadow = await page.evaluate(() => !!document.getElementById('root').shadowRoot && document.activeElement !== window.A());
    await page.focus('button.ah-clock'); await page.keyboard.press('Enter'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(500);
    await page.focus('.at-clock-alarms .at-alarm-add'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    const first = await page.evaluate(() => ({ at: window.say(window.A()), inWin: !!window.A()?.closest('.at-win'), host: document.activeElement?.id }));
    const walk = []; for (let i = 0; i < 10; i++) /* the native time field takes a Tab per part */ { await page.keyboard.press('Tab'); await page.waitForTimeout(60); walk.push(await page.evaluate(() => ({ at: window.say(window.A()), inWin: !!window.A()?.closest('.at-win') }))); }
    check(`${label}: f71 — in a shadow root Tab moves through the alarm editor (ten presses, five or more different stops, all inside the window)`, inShadow && first.inWin && walk.every(x => x.inWin) && new Set(walk.map(x => x.at)).size >= 5, JSON.stringify({ inShadow, first, walk }));
    await page.evaluate(() => window.R().querySelector('.at-win .at-win-head button').focus()); await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(80);
    const wrap = await page.evaluate(() => { const all = [...window.R().querySelectorAll('.at-win button, .at-win input')].filter(x => !x.disabled && x.offsetParent !== null); return { at: window.say(window.A()), last: window.A() === all.at(-1) }; });
    await page.keyboard.press('Tab'); await page.waitForTimeout(80); const wrapBack = await page.evaluate(() => window.A() === window.R().querySelector('.at-win .at-win-head button'));
    check(`${label}: f71 — Shift+Tab from the first control goes to the last one and Tab comes back: the focus never leaves the window`, wrap.last && wrapBack, JSON.stringify({ wrap, wrapBack }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const closed = await page.evaluate(() => ({ win: !!window.R().querySelector('.at-win'), sheet: !!window.R().querySelector('.at-clock'), back: window.A() === window.R().querySelector('.at-clock-alarms .at-alarm-add'), at: window.say(window.A()) }));
    check(`${label}: f71 — Escape closes the window and the focus is back on «+ Будильник» (it fell to <body>: the opener was remembered as the shadow host)`, !closed.win && closed.sheet && closed.back, JSON.stringify(closed));
    // f1: from a room page, with the keyboard
    await page.keyboard.press('Escape'); await page.waitForTimeout(400); await page.evaluate(() => { location.hash = '#rooms?room=detskaia'; }); await page.waitForSelector('.rm-alarms'); await page.waitForTimeout(400);
    await page.focus('.rm-alarms'); await page.keyboard.press('Enter'); await page.waitForSelector('.at-win'); await page.waitForTimeout(700);
    const fromRoom = await page.evaluate(() => ({ editor: !!window.R().querySelector('.at-win .at-alarm-editor'), inWin: !!window.A()?.closest('.at-win'), at: window.say(window.A()) })); await page.screenshot({ path: resolve(out, `${label}-from-room.png`) });
    await page.keyboard.press('Tab'); await page.waitForTimeout(80); const stays = await page.evaluate(() => !!window.A()?.closest('.at-win'));
    check(`${label}: f1 — the alarm editor opened from a room page holds the focus (it stayed in the sheet under the window)`, fromRoom.editor && fromRoom.inWin && stays, JSON.stringify({ fromRoom, stays }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ win: !!window.R().querySelector('.at-win'), sheet: !!window.R().querySelector('.at-clock'), inSheet: !!window.A()?.closest('.hm-sheet'), at: window.say(window.A()) }));
    check(`${label}: f1 / l150 — Escape closes the window; the focus is on a control of the sheet, not on <body>`, !after.win && after.sheet && after.inSheet, JSON.stringify(after));
    await page.close(); }
  // the tile's minute follows the real minute: at 10:00:50 it says 10:00 and, twelve seconds later, 10:01 (the shell's own clock ticks every 20 s, so the hand stood behind)
  { const page = await browser.newPage({ viewport: { width: 1070, height: 764 } }); page.on('pageerror', e => report.errors.push(`minute: ${e.message}`));
    await page.clock.install({ time: new Date(2026, 10, 10, 10, 0, 50) }); await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, config);
    await page.waitForSelector('button.ah-clock'); const t0 = await page.evaluate(() => document.querySelector('button.ah-clock .at-vh')?.textContent ?? '');
    await page.clock.runFor(12000); await page.waitForTimeout(100);
    const t1 = await page.evaluate(() => ({ text: document.querySelector('button.ah-clock .at-vh')?.textContent ?? '', min: document.querySelector('button.ah-clock .ah-hand.is-min')?.getAttribute('x2') }));
    check('minute: the tile turns to 10:01 at the minute, not up to 20 s later', /^10:00/.test(t0) && /^10:01/.test(t1.text), JSON.stringify({ t0, t1 }));
    await page.close(); }
  // release classic, step 4 — studio ST-16: the alarm editor keeps to its window's width at any text size and on a 320 px phone: nothing scrolls
  // sideways, every control stands inside, no word is cut («Али…» at 320 px), «Алиса»'s modes go under its name when they do not fit beside it; and
  // it still saves exactly what was set.
  for (const [w, h, font, theme, lang] of [[320, 568, '100%', 'light', 'ru'], [320, 568, '150%', 'dark', 'ru'], [320, 568, '200%', 'light', 'en'], [360, 792, '200%', 'dark', 'ro'], [360, 792, '150%', 'light', 'ru'], [568, 320, '200%', 'light', 'ru'], [1070, 764, '200%', 'dark', 'en']]) {
    const tag = `${w}x${h} ${font} ${theme} ${lang}`, page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`ST-16 ${tag}: ${e.message}`));
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async ([cfg, th, lg]) => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, { ...cfg, home: { ...cfg.home, theme: th, language: lg } }); }, [config, theme, lang]);
    await page.waitForSelector('.at-shell'); await page.evaluate(f => { document.documentElement.style.fontSize = f; location.hash = '#home?device=clock'; }, font); await page.waitForSelector('.at-clock'); await page.waitForTimeout(300);
    await page.click('.at-clock-alarms .at-alarm-add'); await page.waitForTimeout(400);
    await page.evaluate(() => [...document.querySelectorAll('.at-win .at-alarm-editor .at-clock-presets:first-of-type .hm-pill')].at(-1)?.click()); await page.waitForTimeout(150); // the room with a station: «Алиса» and its modes
    await page.evaluate(() => [...document.querySelectorAll('.at-alarm-editor .at-clock-seg button')][1]?.click()); await page.waitForTimeout(150); // «Фраза»: the phrase field too
    const m = await page.evaluate(() => {
      const win = document.querySelector('.at-win'), body = win.querySelector('.at-win-body'), wr = win.getBoundingClientRect(), br = body.getBoundingClientRect();
      const out = [...body.querySelectorAll('button,input,select,strong,small,p')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > br.right + 1 || r.left < br.left - 1); }).map(e => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 24));
      const cut = [...body.querySelectorAll('.ah-row-text strong,.ah-row-text small')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 24));
      const alice = [...body.querySelectorAll('.ah-row')].find(r => r.querySelector('.at-clock-seg')), modes = alice ? [...alice.querySelectorAll('.at-clock-seg button')].map(b => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), whole: b.scrollWidth <= b.clientWidth + 1, in: r.right <= br.right + 1 }; }) : [];
      const name = alice?.querySelector('.ah-row-text strong'), time = body.querySelector('.at-alarm-time input[type=time]'), whole = (() => { const was = time.style.cssText; time.style.maxWidth = 'none'; time.style.minWidth = '0'; time.style.width = 'max-content'; const need = time.getBoundingClientRect().width; time.style.cssText = was; return need <= time.getBoundingClientRect().width + 1; })(); // the time inside its field: its own width is what «07:00 AM» and the clock need
      return { timeWhole: whole, pan: [body.scrollWidth, body.clientWidth], page: [document.documentElement.scrollWidth, innerWidth], winIn: wr.left >= -1 && wr.right <= innerWidth + 1, out, cut, alice: !!alice, nameWhole: !!name && name.scrollWidth <= name.clientWidth + 1 && name.getBoundingClientRect().width >= 20, modes };
    });
    check(`ST-16 ${tag}: the alarm editor keeps to its window — nothing sideways, every control inside, no word cut («Алиса» whole, the time not cut in its field), its modes whole and inside`, m.timeWhole && m.pan[0] <= m.pan[1] + 1 && m.page[0] <= m.page[1] && m.winIn && !m.out.length && !m.cut.length && m.alice && m.nameWhole && m.modes.length === 3 && m.modes.every(x => x.whole && x.in && x.h >= 30), JSON.stringify(m).slice(0, 400));
    if (w === 320) await page.screenshot({ path: resolve(out, `st16-${w}-${font.replace('%', '')}-${theme}.png`) });
    if (font === '200%' && w === 320) { // it still saves exactly what was set
      await page.fill('.at-alarm-time input[type=time]', '07:30'); await page.evaluate(() => document.querySelector('.at-alarm-editor .at-alarm-save')?.scrollIntoView({ block: 'nearest' })); await page.click('.at-alarm-editor .at-alarm-save'); await page.waitForTimeout(500);
      const saved = await page.evaluate(() => window.atomPreview.config.alarms.map(a => a.time));
      check(`ST-16 ${tag}: «Сохранить» is reached and saves 07:30`, saved.includes('07:30'), JSON.stringify(saved)); }
    await page.close(); }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`); for (const e of report.errors) console.log('  ' + e);
process.exit(report.checks.every(c => c.ok) && report.errors.length === 0 ? 0 : 1);
