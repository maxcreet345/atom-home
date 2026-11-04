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
  'person.gayane': row('home', { friendly_name: 'Gayane Grigorean' }), 'person.ararat': row('Atom Service', { friendly_name: 'Ararat Melconean' }), 'person.daniela': row('not_home', { friendly_name: 'Daniela Melconean' }),
  'calendar.living_yandex_max_alarms': row('off', { friendly_name: 'Гостиная · Станция Макс · будильники и таймеры', message: 'Будильник', start_time: iso(7, 0, 1) }),
});
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
    const tile = await page.evaluate(() => { const t = document.querySelector('button.ah-clock'); return t ? { arc: !!t.querySelector('.ah-clock-arc'), sun: !!t.querySelector('.ah-clock-sun'), sec: !!t.querySelector('.ah-sec'), date: t.querySelector('.ah-clock-date')?.textContent, nums: t.querySelectorAll('.ah-clock-nums text').length } : null; });
    check(`${label}: clock tile — arc, sun, seconds hand, date, 12 numerals`, !!tile && tile.arc && tile.sun && tile.sec && /\d/.test(tile.date ?? '') && tile.nums === 12, JSON.stringify(tile));
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(400); await shot('sheet');
    const sheet = await page.evaluate(() => { const s = document.querySelector('.at-clock'); return { wide: s.classList.contains('is-split'), big: s.querySelector('.at-clock-big b')?.textContent, date: s.querySelector('.at-clock-date')?.textContent, sun: [...s.querySelectorAll('.at-clock-sun-row b')].map(x => x.textContent), presets: [...s.querySelectorAll('.at-clock-preset')].map(b => b.textContent), people: [...s.querySelectorAll('.at-clock-person')].map(p => p.textContent), alarms: s.querySelectorAll('.ah-row .at-door-when').length, face: !!s.querySelector('.at-clock-face-wrap') }; });
    const expectSplit = w >= 800 && w > h;
    check(`${label}: sheet — time, date with week and weather, sun, presets, people, alarm`, /^\d\d:\d\d$/.test(sheet.big ?? '') && /неделя/.test(sheet.date ?? '') && /8,5°/.test(sheet.date ?? '') && sheet.sun.includes('06:52') && sheet.sun.includes('16:42') && sheet.presets.join(',') === '1,3,5,10,15,30,своё…' && sheet.people.length === 3 && sheet.people[0].includes('дома') && sheet.alarms === 1 && sheet.wide === expectSplit && sheet.face === expectSplit, JSON.stringify(sheet));
    // start a 10-minute timer with a label: the preview host records the commands
    await page.click('.at-clock-labels .hm-pill:nth-child(2)'); await page.click('.at-clock-preset:nth-child(4)'); await page.waitForTimeout(400);
    const log = await page.evaluate(() => window.atomPreview.host.log.slice(-2));
    check(`${label}: preset 10 → label saved, timer.start 00:10:00`, log.length === 2 && log[0].domain === 'input_text' && log[0].data.value === '{"timer.atom_1":"Чай|600"}' && log[1].domain === 'timer' && log[1].service === 'start' && log[1].data.duration === '00:10:00' && log[1].data.entity_id === 'timer.atom_1', JSON.stringify(log));
    // custom time wheel
    await page.click('.at-clock-preset.is-custom'); await page.waitForTimeout(300); const wheel = await page.evaluate(() => ({ wheel: !!document.querySelector('.at-clock-wheel'), go: document.querySelector('.at-clock-go')?.textContent }));
    check(`${label}: custom wheel opens at 10:00`, wheel.wheel && /10:00/.test(wheel.go ?? ''), JSON.stringify(wheel));
    // running timer: mutate the snapshot and redraw — the tile shows the countdown, the sheet a ring
    await page.evaluate(() => { window.fx.states['timer.atom_1'] = { ...window.fx.states['timer.atom_1'], state: 'active', attributes: { duration: '0:10:00', finishes_at: new Date(Date.now() + 581000).toISOString() } }; window.fx.states['input_text.atom_timer_labels'] = { ...window.fx.states['input_text.atom_timer_labels'], state: '{"timer.atom_1":"Чай|600"}' }; window.atomPreview.redraw(); });
    await page.waitForTimeout(600); await shot('timer');
    const run = await page.evaluate(() => { const s = document.querySelector('.at-clock'); return { rows: s.querySelectorAll('.at-clock-trow').length, left: s.querySelector('.at-clock-ring b')?.textContent, label: s.querySelector('.at-clock-tt strong')?.textContent, ctl: s.querySelectorAll('.at-clock-ctl').length }; });
    check(`${label}: running timer row with ring, label, pause and cancel`, run.rows === 1 && /^9:(40|41)$/.test(run.left ?? '') && run.label === 'Чай' && run.ctl === 2, JSON.stringify(run));
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
    // settings: digital style persists per device
    await page.evaluate(() => { window.fx.states['input_boolean.timer_done'] = { ...window.fx.states['input_boolean.timer_done'], state: 'off' }; window.atomPreview.redraw(); location.hash = '#home?device=clock'; }); await page.waitForSelector('.at-clock'); await page.click('.at-clock .at-cam-gear'); await page.waitForTimeout(300); await shot('settings');
    const settings = await page.evaluate(() => { const s = document.querySelector('.at-clock'); return { page: s.dataset.page, rows: [...s.querySelectorAll('.ah-row strong')].map(x => x.textContent), switches: s.querySelectorAll('.hm-switch').length }; });
    check(`${label}: settings rows`, settings.page === 'settings' && settings.rows.includes('Секундная стрелка') && settings.rows.includes('Объявлять таймер на Станциях') && settings.switches === 5, JSON.stringify(settings));
    await page.click('.at-clock .at-clock-seg button:nth-child(2)'); await page.waitForTimeout(200); await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(500); await shot('home-digital');
    const digital = await page.evaluate(() => ({ digital: !!document.querySelector('button.ah-clock .ah-clock-digital'), stored: localStorage.getItem('atom-home:clock') }));
    check(`${label}: digital tile after the setting`, digital.digital && /"style":"digital"/.test(digital.stored ?? ''), JSON.stringify(digital));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`); for (const e of report.errors) console.log('  ' + e);
process.exit(report.checks.every(c => c.ok) && report.errors.length === 0 ? 0 : 1);
