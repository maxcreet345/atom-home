// «Воздух» on a second house (26.11.2026): only one area links its sensors; an unlinked room shows its own sensor; a room with a hood or a purifier alone is no row.
// usage: node scripts/qa-air-newhouse.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixturePath } from './fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview'); // QA_DIST: another build of the preview
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/air-new')); await mkdir(out, { recursive: true });
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

// a second house: only the living room links its sensors on the area; the kids' room has a climate sensor of its own, unlinked;
// the kitchen holds only a hood, the bedroom only a purifier (owner, 26.11.2026)
const add = (id, area, dc, state, unit) => { fixture.states[id] = row(state, { ...(dc ? { device_class: dc } : {}), ...(unit ? { unit_of_measurement: unit } : {}), friendly_name: id }); fixture.devices.push({ id: `dev_${id}`, name: id, model: null, manufacturer: null, area_id: area, entry_type: null }); fixture.entities.push({ ...ent(id), device_id: `dev_${id}` }); };
for (const [area_id, name] of [['nh_living', '3. Living Room'], ['nh_kids', '7. Kids Room 1'], ['nh_kitchen', '2. Kitchen'], ['nh_bedroom', '4. Bedroom']]) fixture.areas.push({ area_id, name, icon: null, picture: null, temperature_entity_id: area_id === 'nh_living' ? 'sensor.nh_living_temperature' : null, humidity_entity_id: area_id === 'nh_living' ? 'sensor.nh_living_humidity' : null });
add('sensor.nh_living_temperature', 'nh_living', 'temperature', '20.4', '°C'); add('sensor.nh_living_humidity', 'nh_living', 'humidity', '53', '%'); add('sensor.nh_living_co2', 'nh_living', 'carbon_dioxide', '410', 'ppm'); add('sensor.nh_living_pm25', 'nh_living', 'pm25', '7', 'µg/m³');
add('sensor.nh_kids_temperature', 'nh_kids', 'temperature', '22.1', '°C'); add('sensor.nh_kids_humidity', 'nh_kids', 'humidity', '47', '%');
add('fan.nh_kitchen_hood', 'nh_kitchen', null, 'off'); add('fan.nh_bedroom_air_purifier', 'nh_bedroom', null, 'off');
fixture.areas = fixture.areas.filter(a => a.area_id.startsWith('nh_')); // the second house has none of the first house's rooms
const served = JSON.stringify(fixture);
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { checks: [], errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`); };
try {
  for (const [w, h, label] of [[1252, 718, 'desktop'], [402, 874, 'phone'], [1070, 764, 'tablet']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, config);
    await page.waitForSelector('.at-shell'); await page.evaluate(() => { location.hash = '#home?device=air'; }); await page.waitForSelector('.at-air-sheet'); await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(out, `${label}-air.png`) });
    const t = await page.evaluate(() => document.querySelector('.at-air-sheet').innerText.replace(/\u00a0/g, ' '));
    check(`${label}: the kids' room shows its own unlinked sensor`, /Kids Room 1[\s\S]*22[.,]1°[\s\S]*47 ?%/.test(t), t.slice(0, 400));
    check(`${label}: the hood-only kitchen and the purifier-only bedroom are not rows`, !/2\. Kitchen/.test(t) && !/4\. Bedroom/.test(t));
    check(`${label}: the summary means the two rooms that answer`, /21[.,]3°/.test(t) && /50 ?%/.test(t) && !/Нет данных/.test(t), t.slice(0, 200));
    check(`${label}: the living room keeps its four readings`, /Living Room[\s\S]*20[.,]4°[\s\S]*53 ?%[\s\S]*410[\s\S]*7/.test(t));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
const bad = report.checks.filter(c => !c.ok); console.log(`${report.checks.length - bad.length}/${report.checks.length} passed, ${report.errors.length} page errors`); report.errors.forEach(e => console.log('  ' + e)); process.exit(bad.length || report.errors.length ? 1 : 0);
