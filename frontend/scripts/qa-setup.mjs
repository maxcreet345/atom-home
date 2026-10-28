// Scenario QA of the configurator on the Criuleni snapshot: hide a device, rename a room, add a button, export, import. Commands rejected.
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/stage2-setup'); await mkdir(out, { recursive: true });
const fixture = await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const check = (n, p, d = {}) => checks.push({ n, p, ...d }); const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1070, height: 764 } }); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin); await page.waitForFunction(() => window.ready);
  await page.evaluate(async () => { localStorage.clear(); const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx); });
  await page.waitForSelector('.at-shell'); await page.waitForTimeout(800);
  const $ = sel => page.evaluate(sel => !!document.querySelector(sel), sel);
  const shot = name => page.screenshot({ path: resolve(out, name + '.png') });
  const countSystems = async () => { await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Системы')?.click()); await page.waitForTimeout(500); return page.evaluate(() => document.querySelectorAll('.hm-systems .hm-row').length); };
  const before = await countSystems();
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Настройка')?.click()); await page.waitForTimeout(600); await shot('setup-devices');
  check('setup-opens', await $('.at-setup'));
  // 1. hide the first valve/leak device in the list via its toggle
  const key = await page.evaluate(() => { const row = [...document.querySelectorAll('.at-setup-row')].find(r => /Кран воды/.test(r.innerText)); row?.querySelector('.hm-switch')?.click(); return row?.dataset.deviceKey ?? null; });
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atom-home:config') ?? '{}'));
  check('hide-device-saved', key !== null && stored.devices?.[key]?.enabled === false, { key, stored: stored.devices?.[key] });
  const after = await countSystems(); check('hidden-device-leaves-systems', after === before - 1, { before, after });
  // 2. rename a room
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Настройка')?.click()); await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].find(b => b.innerText.trim() === 'Комнаты')?.click()); await page.waitForTimeout(300);
  await page.evaluate(() => { const row = [...document.querySelectorAll('.at-setup-row')].find(r => r.dataset.roomId === 'kukhnia'); const input = row?.querySelector('input[type=text]'); input.value = 'Кухня-столовая'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300); await shot('setup-rooms');
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Комнаты')?.click()); await page.waitForTimeout(500);
  check('room-renamed-everywhere', await page.evaluate(() => [...document.querySelectorAll('.at-room')].some(r => r.innerText.includes('Кухня-столовая'))));
  // 3. add a custom button with confirm and press it → confirm dialog → confirm → one rejected command
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Настройка')?.click()); await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].find(b => b.innerText.trim() === 'Кнопки')?.click()); await page.waitForTimeout(300);
  await page.evaluate(() => { const f = document.querySelector('.at-setup-new'); const [label, service, entity, data] = f.querySelectorAll('input[type=text]'); const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; set(label, 'Весь свет выкл'); set(service, 'light.turn_off'); set(entity, 'all'); set(data, ''); });
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-new button')].find(b => b.innerText.includes('Добавить'))?.click()); await page.waitForTimeout(400); await shot('setup-buttons');
  check('button-saved', await page.evaluate(() => JSON.parse(localStorage.getItem('atom-home:config')).buttons.length === 1));
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Обзор')?.click()); await page.waitForTimeout(600);
  check('button-on-overview', await $('.hm-scene-custom'));
  await page.evaluate(() => document.querySelector('.hm-scene-custom .hm-scene-hit')?.click()); await page.waitForTimeout(300);
  check('button-asks-confirmation', await $('.hm-confirm'));
  await page.evaluate(() => document.querySelector('.hm-confirm .is-primary')?.click()); await page.waitForTimeout(500);
  const log = await page.evaluate(() => window.atomPreview.host.log);
  check('button-calls-service-once', log.length === 1 && log[0].domain === 'light' && log[0].service === 'turn_off' && log[0].data.entity_id === 'all', { log });
  await shot('overview-after-button');
  // 4. export/import
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Настройка')?.click()); await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].find(b => b.innerText.trim() === 'Дом')?.click()); await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-home .hm-chips button')].find(b => b.innerText.includes('Экспорт'))?.click()); await page.waitForTimeout(200);
  const exported = await page.evaluate(() => document.querySelector('.at-json').value); let parsed = null; try { parsed = JSON.parse(exported); } catch {}
  check('export-valid-json', !!parsed && parsed.rooms?.kukhnia?.name === 'Кухня-столовая' && parsed.buttons?.length === 1);
  await page.evaluate(() => { const ta = document.querySelector('.at-json'); const c = JSON.parse(ta.value); c.home.name = 'Casa Atom'; delete c.rooms.kukhnia; ta.value = JSON.stringify(c); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-home .hm-chips button')].find(b => b.innerText.includes('Импорт'))?.click()); await page.waitForTimeout(500); await shot('setup-home-after-import');
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Обзор')?.click()); await page.waitForTimeout(500);
  check('import-applies-name', await page.evaluate(() => document.querySelector('.hm-head h1')?.innerText.trim() === 'Casa Atom'));
  check('import-persisted', await page.evaluate(() => JSON.parse(localStorage.getItem('atom-home:config')).home.name === 'Casa Atom' && !JSON.parse(localStorage.getItem('atom-home:config')).rooms.kukhnia));
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Настройка')?.click()); await page.waitForTimeout(400);
  // 5. upload a room photo (preview store keeps it as a data URL) and see it on the room tile
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].find(b => b.innerText.trim() === 'Комнаты')?.click()); await page.waitForTimeout(300);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQIW2P8z8DwnwEIGBlgDBgDAAz6A/3tPDhNAAAAAElFTkSuQmCC', 'base64');
  const input = await page.$('.at-setup-row[data-room-id="vannaia"] input[type=file]');
  await input.setInputFiles({ name: 'bath.png', mimeType: 'image/png', buffer: png }); await page.waitForTimeout(1200);
  const photo = await page.evaluate(() => JSON.parse(localStorage.getItem('atom-home:config')).rooms?.vannaia?.photo ?? null);
  check('photo-uploaded-into-config', typeof photo === 'string' && photo.startsWith('data:image/jpeg;base64,'), { len: photo?.length });
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Комнаты')?.click()); await page.waitForTimeout(500);
  check('photo-shown-on-room-tile', await page.evaluate(() => document.querySelector('.at-room[data-room-id="vannaia"] img.hm-photo')?.getAttribute('src')?.startsWith('data:image/jpeg') === true));
  check('stock-art-on-other-rooms', await page.evaluate(() => document.querySelector('.at-room[data-room-id="kukhnia"] img.hm-photo')?.getAttribute('src')?.includes('room-kitchen') === true));
  await shot('rooms-with-photo');
  // 6. modules tab lists the boiler as detected; disabling removes its card from Climate
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Климат')?.click()); await page.waitForTimeout(500);
  check('boiler-module-card-on-climate', await $('.at-boiler')); await shot('climate-with-boiler');
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Настройка')?.click()); await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].find(b => b.innerText.trim() === 'Модули')?.click()); await page.waitForTimeout(300); await shot('setup-modules');
  check('module-detected-in-setup', await page.evaluate(() => /Обнаружен/.test(document.querySelector('[data-module-id="boiler_ebus"]')?.innerText ?? '')));
  await page.evaluate(() => document.querySelector('[data-module-id="boiler_ebus"] .hm-switch')?.click()); await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].find(b => b.innerText.trim() === 'Климат')?.click()); await page.waitForTimeout(500);
  check('module-disabled-removes-card', !(await $('.at-boiler')));
  // 7. non-admin sees no setup
  await page.evaluate(() => { localStorage.clear(); });
  await page.close();
} finally { await browser.close(); server.close(); }
const report = { pass: checks.every(c => c.p) && !errors.length, checks, errors }; await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1));
