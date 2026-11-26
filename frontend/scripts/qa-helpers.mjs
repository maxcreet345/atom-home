// Helpers QA (26.11.2026): a house without the clock's and the alarm's helpers — the administrator's bar «не хватает помощников», «Позже», «Создать», the «Время» sheet's «Включить таймеры»; a resident sees no bar; a house that has them all sees none. Six sizes.
// usage: node scripts/qa-helpers.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixturePath } from './fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview'); // QA_DIST: another build of the preview
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/helpers')); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile(fixturePath('criuleni-camera-20261104.json'), 'utf8'));
const row = (state, attributes = {}) => ({ state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() });
const ent = (id, platform = 'synthetic') => ({ entity_id: id, device_id: null, area_id: null, name: null, original_name: null, platform, entity_category: null, disabled_by: null, hidden_by: null });
const today = new Date(); const iso = (h, m, d = 0) => { const x = new Date(today); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const nowH = today.getHours() + today.getMinutes() / 60; const daytime = nowH > 6.9 && nowH < 16.7;
Object.assign(fixture.states, {
  'sun.sun': row(daytime ? 'above_horizon' : 'below_horizon', { next_rising: iso(6, 52, 1), next_setting: daytime ? iso(16, 42) : (nowH <= 6.9 ? iso(16, 42) : iso(16, 42, 1)), elevation: daytime ? 23 : -20 }),
  'weather.forecast_home': row('cloudy', { temperature: 8.5, friendly_name: 'Погода' }),
  'timer.atom_1': row('idle', { duration: '0:10:00', friendly_name: 'Atom таймер 1' }), 'timer.atom_2': row('idle', { duration: '0:10:00' }), 'timer.atom_3': row('idle', { duration: '0:10:00' }),
  'input_text.atom_timer_labels': row('{}', { max: 255 }), 'input_boolean.timer_done': row('off'), 'input_boolean.timer_announce': row('on'), 'input_boolean.timer_push': row('on'),
  'person.galina': row('home', { friendly_name: 'Galina Lupu', entity_picture: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }), 'person.andrei': row('Atom Service', { friendly_name: 'Andrei Popescu' }), 'person.daniela': row('not_home', { friendly_name: 'Daniela Popescu' }),
  'media_player.living_yandex_max': row('idle', { friendly_name: 'Гостиная · Яндекс Станция Макс' }), 'light.kids_chandelier': row('off', { friendly_name: 'Люстра', supported_color_modes: ['color_temp'] }), 'input_boolean.alarm_ringing': row('off'), 'input_text.alarm_ringing': row(''),
  'calendar.living_yandex_max_alarms': row('off', { friendly_name: 'Гостиная · Станция Макс · будильники и таймеры', message: 'Будильник', start_time: iso(7, 0, 1) }),
});
for (const [area_id, name] of [['gostinaia', 'Гостиная'], ['detskaia', 'Детская']]) if (!fixture.areas.some(a => a.area_id === area_id)) fixture.areas.push({ area_id, name, icon: null, picture: null });
Object.assign(fixture.states, { 'media_player.kids_yandex_mini': row('idle', { friendly_name: 'Детская · Яндекс Станция Мини' }) });
fixture.entities.push({ ...ent('media_player.kids_yandex_mini', 'yandex_station'), area_id: 'detskaia' });
fixture.entities.push({ ...ent('media_player.living_yandex_max', 'yandex_station'), area_id: 'gostinaia' }, { ...ent('light.kids_chandelier'), area_id: 'detskaia' }, ent('input_boolean.alarm_ringing'), ent('input_text.alarm_ringing'));
fixture.entities.push(...['sun.sun', 'weather.forecast_home', 'timer.atom_1', 'timer.atom_2', 'timer.atom_3', 'input_text.atom_timer_labels', 'input_boolean.timer_done', 'input_boolean.timer_announce', 'input_boolean.timer_push', 'person.galina', 'person.andrei', 'person.daniela', 'calendar.living_yandex_max_alarms'].map(id => ent(id)));
const config = { schemaVersion: 1, home: { name: 'Мой дом', language: 'ru', theme: 'light' }, modules: { camera_go2rtc: { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264' } }, doorbell: { options: { addon: 'a889bffc_go2rtc' } } } };
fixture.states['input_text.atom_light_sleep'] = row('', { max: 255 }); fixture.entities.push(ent('input_text.atom_light_sleep'));
const full = JSON.stringify(fixture);
const off = JSON.parse(full); for (const id of ['timer.atom_1', 'timer.atom_2', 'timer.atom_3']) { delete off.states[id]; off.entities.find(e => e.entity_id === id).disabled_by = 'user'; } const disabled = JSON.stringify(off);
const GONE = ['timer.atom_1', 'timer.atom_2', 'timer.atom_3', 'input_text.atom_timer_labels', 'input_boolean.timer_done', 'input_boolean.alarm_ringing', 'input_text.alarm_ringing', 'input_text.atom_light_sleep'];
for (const id of GONE) delete fixture.states[id]; fixture.entities = fixture.entities.filter(e => !GONE.includes(e.entity_id));
const served = JSON.stringify(fixture);
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/disabled.json') { res.setHeader('content-type', 'application/json'); res.end(disabled); return; } if (u.pathname === '/full.json') { res.setHeader('content-type', 'application/json'); res.end(full); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { checks: [], errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`); };
try {
  for (const [w, h, label] of [[402, 874, 'phone'], [874, 402, 'phone-land'], [1070, 764, 'tablet'], [764, 1070, 'tablet-port'], [698, 751, 'open'], [751, 698, 'open-land'], [1920, 1080, 'desktop']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) report.errors.push(`${label} console: ${m.text()}`); });
    const shot = async name => { await page.waitForTimeout(400); await page.screenshot({ path: resolve(out, `${label}-${name}.png`) }); };
    const mount = async (file, admin) => { await page.goto(origin); await page.waitForFunction(() => window.ready); await page.evaluate(async ([cfg, file, admin]) => { window.fx = await (await fetch(file)).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); window.atomPreview.setAdmin(admin); }, [config, file, admin]); await page.waitForSelector('.at-shell'); };
    const bar = () => page.evaluate(() => { const b = document.querySelector('.ah-banners .at-house-banner[aria-label^="Панели не хватает"]'); return b ? { text: b.querySelector('.ah-take-title')?.textContent, sub: b.querySelector('.ah-take-sub')?.textContent, btns: [...b.querySelectorAll('button')].map(x => x.textContent), fits: b.getBoundingClientRect().right <= innerWidth + 0.5 && [...b.querySelectorAll('button')].every(x => x.getBoundingClientRect().height >= 40), clip: [...b.querySelectorAll('p,button')].some(x => x.scrollWidth > x.clientWidth + 1) } : null; });
    await mount('/fixture.json', true);
    check(`${label}: no bar in the first seconds (helpers still loading while HA starts)`, !(await bar()));
    await page.waitForTimeout(8300);
    const b = await bar(); await shot('bar');
    check(`${label}: admin sees the bar — title, what breaks, count 8, «Позже» and «Создать», whole and fitting`, !!b && /таймеры в «Время», баннер будильника, «Выключить через» у света/.test(b.sub ?? '') && /8 шт/.test(b.sub ?? '') && b.btns.join('|') === 'Позже|Создать' && b.fits && !b.clip, JSON.stringify(b));
    const tops = await page.evaluate(() => { const h = document.querySelector('.ah-banners')?.getBoundingClientRect().bottom ?? 0; const t = document.querySelector('.hm-head, .at-head, header'); return { banners: Math.round(h), head: Math.round(t?.getBoundingClientRect().top ?? 0) }; });
    check(`${label}: the page starts under the bar (nothing covered)`, tops.head >= tops.banners - 1, JSON.stringify(tops));
    // «Создать»: the integration hands out the list; the panel creates each helper once
    await page.evaluate(() => { const host = window.atomPreview.host; window.sent = []; let claims = 0; host.ws = async m => { window.sent.push(m); if (m.type === 'atom_home/helpers/claim') return { create: claims++ ? [] : [{ entity_id: 'timer.atom_1', params: { name: 'Atom 1', restore: true } }, { entity_id: 'input_text.atom_timer_labels', params: { name: 'Atom timer labels', max: 255 } }] }; return {}; }; });
    await page.click('.at-helpers-create'); await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ sent: window.sent.map(m => m.type).filter(t => !t.startsWith('supervisor/')), toast: document.querySelector('.hm-toast, .at-toast, [class*=toast]')?.textContent ?? '' }));
    await shot('created');
    check(`${label}: «Создать» claims, then creates each helper once, and says so`, after.sent.join(',') === 'atom_home/helpers/claim,timer/create,input_text/create' && /Помощники созданы/.test(after.toast), JSON.stringify(after));
    await page.click('.at-helpers-later'); await page.waitForTimeout(300);
    check(`${label}: «Позже» hides the bar`, !(await bar()));
    // the «Время» sheet without timers
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(400); await shot('sheet-admin');
    const sh = await page.evaluate(() => { const c = document.querySelector('.at-clock-timers.is-off'); return c ? { head: c.querySelector('h3')?.textContent, btn: c.querySelector('.at-clock-enable')?.textContent, text: c.querySelector('.at-clock-empty')?.textContent, overflow: document.querySelector('.hm-sheet')?.scrollHeight > document.querySelector('.hm-sheet')?.clientHeight + 1 } : null; });
    check(`${label}: «Время» keeps a «Таймеры» block with «Включить таймеры» for the admin`, !!sh && sh.head === 'Таймеры' && sh.btn === 'Включить таймеры' && /нужны помощники/.test(sh.text ?? ''), JSON.stringify(sh));
    await page.evaluate(() => { window.sent = []; }); await page.click('.at-clock-enable'); await page.waitForTimeout(400);
    const note = await page.evaluate(() => ({ note: document.querySelector('.at-clock-timers.is-off [role=status]')?.textContent, sent: window.sent.map(m => m.type) }));
    check(`${label}: «Включить таймеры» goes through the claim and says what happened`, note.sent[0] === 'atom_home/helpers/claim' && !!note.note, JSON.stringify(note));
    await shot('sheet-enabled');
    // a resident: no bar, the sheet says the administrator will do it
    await mount('/fixture.json', false); await page.waitForTimeout(8300);
    check(`${label}: a resident sees no bar`, !(await bar()));
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(400); await shot('sheet-resident');
    const rs = await page.evaluate(() => { const c = document.querySelector('.at-clock-timers.is-off'); return c ? { btn: !!c.querySelector('.at-clock-enable'), text: c.querySelector('.at-clock-empty')?.textContent } : null; });
    check(`${label}: a resident's sheet says the administrator turns timers on, with no button`, !!rs && !rs.btn && /администратор/.test(rs.text ?? ''), JSON.stringify(rs));
    // a house with every helper (the first house): no bar, timers as before
    await mount('/full.json', true); await page.waitForTimeout(8300);
    check(`${label}: a house with all helpers sees no bar`, !(await bar()));
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(300);
    check(`${label}: and its «Время» shows the timers with «Новый таймер»`, await page.evaluate(() => !!document.querySelector('.at-clock-timers:not(.is-off) .at-clock-new') && !document.querySelector('.at-clock-timers.is-off')));
    // the owner switched the timers off: nothing to create (it would make timer.atom_1_2) — no bar, and the sheet says where to switch them on
    await mount('/disabled.json', true); await page.waitForTimeout(8300);
    check(`${label}: timers disabled by the owner — no bar`, !(await bar()));
    await page.click('button.ah-clock'); await page.waitForSelector('.at-clock'); await page.waitForTimeout(300); await shot('sheet-disabled');
    const ds = await page.evaluate(() => { const c = document.querySelector('.at-clock-timers.is-off'); return c ? { btn: !!c.querySelector('.at-clock-enable'), text: c.querySelector('.at-clock-empty')?.textContent } : null; });
    check(`${label}: …and the sheet says they are disabled, with no «Включить таймеры»`, !!ds && !ds.btn && /отключены/.test(ds.text ?? ''), JSON.stringify(ds));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
const bad = report.checks.filter(c => !c.ok);
console.log(`\n${report.checks.length - bad.length}/${report.checks.length} passed, ${report.errors.length} page errors`); report.errors.slice(0, 10).forEach(e => console.log('  ' + e));
process.exit(bad.length || report.errors.length ? 1 : 0);
