// Doorbell card QA on the Criuleni camera snapshot (preview host): home tile, sheet, settings, a simulated ring (auto-open + countdown + «keep»), the cross-sheet banner — phone, tablet, Open.
// usage: node scripts/qa-doorbell.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/doorbell-g4')); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-camera-20261104.json'), 'utf8'));
const config = { schemaVersion: 1, home: { name: 'Мой дом', language: 'ru', theme: 'light' }, modules: { camera_go2rtc: { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264', streamHd: 'entrance_camera_hd' } }, doorbell: { options: { addon: 'a889bffc_go2rtc' } } } };
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
    const tile = await page.evaluate(() => { const t = [...document.querySelectorAll('.hm-camera-tile')].find(x => x.textContent.includes('звонка') || x.textContent.includes('Звонок')); return t ? { line: t.querySelector('.hm-camera-caption small')?.textContent, status: t.querySelector('.at-go2rtc')?.dataset.playerStatus ?? 'none', live: t.querySelector('.hm-live')?.textContent } : null; });
    check(`${label}: doorbell tile quiet, no stream on the tile`, !!tile && /^Тихо/.test(tile.line ?? '') && tile.status === 'idle', JSON.stringify(tile));
    const systems = await page.evaluate(() => { location.hash = '#systems'; return new Promise(r => setTimeout(() => r([...document.querySelectorAll('.hm-card')].map(c => c.textContent).filter(x => /Без звука мелодии|Микрофон выключен|Динамик выключен|Опознать/.test(x)).length), 400)); });
    check(`${label}: no doorbell switches in Systems`, systems === 0, `${systems} leftover tiles`);
    await page.evaluate(() => { location.hash = '#home?device=e%3Acamera.entrance_doorbell'; }); await page.waitForSelector('.at-door'); await shot('sheet');
    const sheet = await page.evaluate(() => { const s = document.querySelector('.at-door'); return { wide: s.classList.contains('is-split'), kind: s.querySelector('.hm-sheet-head small')?.textContent, tools: [...s.querySelectorAll('.at-cam-tool')].map(b => b.textContent + (b.disabled ? '(off)' : '')), rows: [...s.querySelectorAll('.ah-row strong')].map(x => x.textContent), status: s.querySelector('.at-go2rtc')?.dataset.playerStatus, seg: [...s.querySelectorAll('.at-door-seg button')].map(b => b.textContent), banner: !!s.querySelector('.at-door-banner') }; });
    check(`${label}: tools`, sheet.tools.join(',') === 'Снимок,Разговорв Aqara Home(off),Во весь экран,МелодияВключено,МикрофонВключено,ДинамикВключено', sheet.tools.join(','));
    check(`${label}: rows battery + identify, stream tried in the sheet`, sheet.rows.includes('Батарея') && sheet.rows.includes('Опознать') && sheet.kind.startsWith('Звонок') && sheet.status !== 'idle' && !sheet.banner, JSON.stringify(sheet));
    const expectSplit = w >= 800 && w > h; check(`${label}: layout ${expectSplit ? 'two columns' : 'one column'}`, sheet.wide === expectSplit, `is-split=${sheet.wide}`);
    await page.click('.at-door .at-cam-gear'); await page.waitForTimeout(300); await shot('settings');
    const settings = await page.evaluate(() => { const s = document.querySelector('.at-door'); return { page: s.dataset.page, rows: [...s.querySelectorAll('.ah-row strong')].map(x => x.textContent), pills: [...s.querySelectorAll('.at-door-pills .hm-pill')].map(b => b.textContent + (b.classList.contains('is-primary') ? '*' : '')), kv: [...s.querySelectorAll('.at-cam-kv')].map(x => x.textContent) }; });
    check(`${label}: settings page`, settings.page === 'settings' && settings.rows.includes('Открывать лист при звонке') && settings.pills.join(',') === '30 с,60 с*,120 с' && settings.kv.some(x => x.includes('Aqara · SVD-C02')) && settings.kv.some(x => x.startsWith('Последний звонок')), `${settings.rows.join(' | ')} // ${settings.pills} // ${settings.kv.join(' | ')}`);
    await page.click('.at-door-pills .hm-pill:nth-child(3)'); await page.waitForTimeout(300);
    const saved = await page.evaluate(() => window.atomPreview.config.modules.doorbell?.options);
    check(`${label}: 120 s saved to the config`, saved?.autoOpenSec === '120', JSON.stringify(saved));
    await page.click('.at-door-pills .hm-pill:nth-child(2)'); await page.waitForTimeout(200);
    await page.click('[aria-label="Назад"]'); await page.waitForTimeout(200);
    // close the sheet, simulate a ring: the sheet opens by itself with the countdown
    await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(400);
    await page.evaluate(() => { window.fx.states['event.entrance_doorbell_ring'] = { ...window.fx.states['event.entrance_doorbell_ring'], state: new Date().toISOString(), last_changed: new Date().toISOString() }; window.atomPreview.redraw(); });
    await page.waitForTimeout(900); await shot('ring');
    const ring = await page.evaluate(() => { const s = document.querySelector('.at-door'); const t = [...document.querySelectorAll('.hm-camera-tile')].find(x => x.classList.contains('is-danger')); return { open: !!s, cnt: s?.querySelector('.at-door-cnt')?.textContent, alarm: !!document.querySelector('.hm-sheet.is-alarm'), tileLine: t?.querySelector('.hm-camera-caption small')?.textContent ?? null, hash: location.hash }; });
    check(`${label}: ring opens the sheet with a 60 s countdown`, ring.open && /^0:5\d$/.test(ring.cnt ?? '') && ring.alarm && ring.hash.includes('entrance_doorbell'), JSON.stringify(ring));
    const noEvents = await page.evaluate(() => !document.querySelector('.at-door-events'));
    check(`${label}: no events list while opened by the ring`, noEvents, 'events list present');
    await page.click('.at-door-stay'); await page.waitForTimeout(300);
    const kept = await page.evaluate(() => ({ banner: !!document.querySelector('.at-door-banner'), open: !!document.querySelector('.at-door'), events: !!document.querySelector('.at-door-events') }));
    check(`${label}: «keep» cancels the countdown, sheet stays, events back`, !kept.banner && kept.open && kept.events, JSON.stringify(kept));
    // another sheet open: a ring shows the banner instead of switching
    await page.evaluate(() => { location.hash = '#home?device=e%3Acamera.entrance_camera'; }); await page.waitForSelector('.at-cam:not(.at-door)'); await page.waitForTimeout(300);
    await page.evaluate(() => { window.fx.states['event.entrance_doorbell_ring'] = { ...window.fx.states['event.entrance_doorbell_ring'], state: new Date(Date.now() + 1000).toISOString() }; window.atomPreview.redraw(); });
    await page.waitForTimeout(500); await shot('ring-banner');
    const banner = await page.evaluate(() => ({ banner: document.querySelector('.at-door-ring')?.textContent ?? null, stillCamera: !!document.querySelector('.at-cam:not(.at-door)') }));
    check(`${label}: banner over another sheet`, !!banner.banner && banner.banner.includes('Звонок в дверь') && banner.stillCamera, JSON.stringify(banner));
    await page.click('.at-door-ring .hm-pill'); await page.waitForTimeout(500);
    const switched = await page.evaluate(() => ({ door: !!document.querySelector('.at-door'), cnt: document.querySelector('.at-door-cnt')?.textContent ?? null }));
    check(`${label}: «open» switches to the doorbell with countdown`, switched.door && !!switched.cnt, JSON.stringify(switched));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`); for (const e of report.errors) console.log('  ' + e);
process.exit(report.checks.every(c => c.ok) && report.errors.length === 0 ? 0 : 1);
