// Camera card QA on the Criuleni camera snapshot (preview host, commands rejected): home tile, sheet, settings page, closed lens — phone and tablet.
// usage: node scripts/qa-camera.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/camera-c700')); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-camera-20261104.json'), 'utf8'));
const config = { schemaVersion: 1, home: { name: 'Мой дом', language: 'ru', theme: 'light' }, modules: { camera_go2rtc: { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264', streamHd: 'entrance_camera_hd' } } } };
let served = JSON.stringify(fixture);
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { checks: [], errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`); };
try {
  for (const [w, h, label] of [[402, 874, 'phone'], [874, 402, 'phone-land'], [1070, 764, 'tablet'], [764, 1070, 'tablet-port'], [698, 751, 'open'], [751, 698, 'open-land']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) report.errors.push(`${label} console: ${m.text()}`); }); // camera_proxy frames are 404 on the preview host
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx, cfg); }, config);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(700);
    const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: resolve(out, `${label}-${name}.png`) }); };
    await shot('home');
    // two cameras or more are one Cameras card (09.11.2026): C700 is its big live picture, its own line is on its cell in the Cameras panel
    const tile = await page.evaluate(async () => { const t = document.querySelector('.at-cams-tile'); const r = t ? { focus: t.dataset.focus, live: t.querySelector('.at-cams-main .at-go2rtc') ? 'player' : 'none' } : null; location.hash = '#camera'; await new Promise(x => setTimeout(x, 400)); const c = document.querySelector('.at-cams-cell[data-device-key="e:camera.entrance_camera"]'); const out = { ...r, line: c?.querySelector('.at-cams-cap small')?.textContent }; location.hash = '#home'; await new Promise(x => setTimeout(x, 300)); return out; });
    check(`${label}: home tile second line`, tile?.focus === 'e:camera.entrance_camera' && tile.live === 'player' && tile.line === 'Слежение за человеком', JSON.stringify(tile));
    const systems = await page.evaluate(() => { location.hash = '#systems'; return new Promise(r => setTimeout(() => r([...document.querySelectorAll('.hm-card')].map(c => c.textContent).filter(x => /ИИ|Патрул|Слежен|Время на картинке|Детекция/.test(x)).length), 400)); });
    check(`${label}: no camera switches in Systems`, systems === 0, `${systems} leftover tiles`);
    await page.evaluate(() => { location.hash = '#home?device=e%3Acamera.entrance_camera'; }); await page.waitForSelector('.at-cam'); await shot('sheet');
    const sheet = await page.evaluate(() => { const s = document.querySelector('.at-cam'); const rows = [...s.querySelectorAll('.ah-row strong')].map(x => x.textContent); return { wide: s.classList.contains('is-split'), power: s.querySelector('.at-cam-lens')?.textContent, hero: !!s.querySelector('.ah-hero'), rows, tools: [...s.querySelectorAll('.at-cam-tool')].map(b => b.textContent + (b.disabled ? '(off)' : '')), gear: !!s.querySelector('.at-cam-gear'), live: (() => { const l = s.querySelector('.at-cam-stage .hm-live'); return l ? getComputedStyle(l).bottom : null; })() }; });
    check(`${label}: lens tool, no hero`, sheet.power === 'Закрыть объектив' && sheet.hero === false, `${sheet.power} / hero=${sheet.hero}`);
    check(`${label}: LIVE at the bottom of the stage`, sheet.live === '10px', String(sheet.live));
    check(`${label}: rows`, sheet.rows.length >= 16 && sheet.rows.includes('Слежение за человеком') && sheet.rows.includes('Плач ребёнка') && sheet.rows.includes('Громкость динамика') && !sheet.rows.includes('Время на картинке'), `${sheet.rows.length} rows: ${sheet.rows.join(' | ')}`);
    check(`${label}: tools`, sheet.tools.join(',') === 'Снимок,Разговор(off),Во весь экран,Закрыть объектив,Ночное видениеАвто,HDRВыкл', sheet.tools.join(','));
    const expectSplit = w >= 800 && w > h; check(`${label}: layout ${expectSplit ? 'two columns' : 'one column'}`, sheet.wide === expectSplit, `is-split=${sheet.wide}`);
    await page.click('.at-cam-gear'); await page.waitForTimeout(300); await shot('settings');
    const settings = await page.evaluate(() => { const s = document.querySelector('.at-cam'); return { page: s.dataset.page, rows: [...s.querySelectorAll('.ah-row strong')].map(x => x.textContent), kv: [...s.querySelectorAll('.at-cam-kv')].map(x => x.textContent), title: s.querySelector('h2, .at-cam-h3')?.textContent }; });
    check(`${label}: settings page`, settings.page === 'settings' && settings.rows.includes('Время на картинке') && settings.rows.includes('Перевернуть изображение') && settings.kv.some(x => x.includes('Нет карты')) && settings.kv.some(x => x.includes('H.265')), `${settings.title}: ${settings.rows.join(' | ')} // ${settings.kv.join(' | ')}`);
    await page.click('[aria-label="Назад"]'); await page.waitForTimeout(300);
    await page.click('.at-cam-night'); await page.waitForTimeout(400); const night = await page.evaluate(() => window.atomPreview?.host?.log?.slice(-1)[0] ?? null);
    check(`${label}: night button cycles Auto → On`, !!night && night.service === 'select_option' && night.data.option === 'On', JSON.stringify(night));
    const back = await page.evaluate(() => document.querySelector('.at-cam')?.dataset.page); check(`${label}: back to main`, back === 'main', String(back));
    // closing the lens asks for confirmation; the preview host rejects the command
    await page.click('.at-cam-lens'); await page.waitForTimeout(300); const confirmText = await page.evaluate(() => document.querySelector('.hm-confirm p')?.textContent ?? '');
    check(`${label}: close lens asks first`, confirmText.includes('Закрыть объектив'), confirmText); await shot('confirm');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // closed lens: swap the snapshot and remount
    served = JSON.stringify({ ...fixture, states: { ...fixture.states, 'switch.entrance_camera_power': { ...fixture.states['switch.entrance_camera_power'], state: 'off' } } });
    await page.evaluate(async cfg => { location.hash = '#home'; const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx, cfg); }, config); await page.waitForTimeout(600); await shot('home-closed');
    const closedTile = await page.evaluate(() => { const t = document.querySelector('.at-cams-tile'); return t ? { focus: t.dataset.focus, wait: t.querySelector('.at-cams-main .hm-camera-wait span')?.textContent, player: !!t.querySelector('.at-cams-main .at-go2rtc') } : null; });
    check(`${label}: closed lens tile`, closedTile?.focus === 'e:camera.entrance_camera' && closedTile.wait === 'Объектив закрыт' && !closedTile.player, JSON.stringify(closedTile));
    await page.evaluate(() => { location.hash = '#home?device=e%3Acamera.entrance_camera'; }); await page.waitForSelector('.at-cam'); await shot('sheet-closed');
    const closedSheet = await page.evaluate(() => { const s = document.querySelector('.at-cam'); return { power: s.querySelector('.at-cam-lens')?.textContent, stage: s.querySelector('.at-cam-stage-closed span')?.textContent, snapshotOff: s.querySelector('.at-cam-snapshot')?.disabled }; });
    check(`${label}: closed lens sheet`, closedSheet.power === 'Открыть объектив' && closedSheet.stage === 'Объектив закрыт' && closedSheet.snapshotOff === true, JSON.stringify(closedSheet));
    served = JSON.stringify(fixture);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`); for (const e of report.errors) console.log('  ' + e);
process.exit(report.checks.every(c => c.ok) && report.errors.length === 0 ? 0 : 1);
