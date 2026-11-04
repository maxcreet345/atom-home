// Laptop and monitor matrix on the Criuleni snapshot (preview host): home and the camera sheet at common 2026 desktop sizes, with and without the HA sidebar (−256 px).
// usage: node scripts/qa-desktop.mjs <outDir> [fixture.json]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/desktop')); await mkdir(out, { recursive: true });
const fixturePath = resolve(root, process.argv[3] ?? '../private/fixtures/criuleni-registry.json');
const fixture = await readFile(fixturePath, 'utf8');
const cameraFx = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-camera-20261104.json'), 'utf8'));
// merge the camera snapshot into the big snapshot so the sheet has its functions
const big = JSON.parse(fixture); const ids = new Set(big.entities.map(e => e.entity_id));
for (const e of cameraFx.entities) if (!ids.has(e.entity_id)) big.entities.push(e);
for (const d of cameraFx.devices) if (!big.devices.some(x => x.id === d.id)) big.devices.push(d);
Object.assign(big.states, cameraFx.states);
const served = JSON.stringify(big);
const config = { schemaVersion: 1, home: { name: 'Мой дом', language: 'ru', theme: 'light' }, modules: { camera_go2rtc: { entities: { camera: 'camera.entrance_camera' }, options: { addon: 'a889bffc_go2rtc', stream: 'entrance_camera_h264', streamHd: 'entrance_camera_hd' } } } };
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
// [label, css width, css height] — CSS pixels after the usual scaling; «-ha» variants subtract the HA sidebar (256) from the width
const SIZES = [
  ['laptop-13-1280x800', 1280, 800], ['laptop-14-fhd-1366x768', 1366, 768], ['mba-13-1440x900', 1440, 900], ['mbp-14-1512x982', 1512, 982], ['fhd-125pct-1536x864', 1536, 864],
  ['mbp-16-1728x1117', 1728, 1117], ['fhd-1920x1080', 1920, 1080], ['wuxga-1920x1200', 1920, 1200], ['qhd-2560x1440', 2560, 1440], ['uw-21x9-2560x1080', 2560, 1080],
  ['uw-34-3440x1440', 3440, 1440], ['uw-38-3840x1600', 3840, 1600], ['4k-150pct-2560x1440', 2560, 1440],
];
const browser = await chromium.launch(); const report = [];
try {
  for (const [label, w0, h0] of SIZES) for (const ha of [false, true]) {
    const w = ha ? w0 - 256 : w0, h = h0 - (ha ? 0 : 0), name = `${label}${ha ? '-ha' : ''}`;
    const page = await browser.newPage({ viewport: { width: w, height: h } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx, cfg); }, config);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(900);
    const geo = await page.evaluate(() => { const shell = document.querySelector('.at-shell'); const main = document.querySelector('.hm-main'); const cls = [...shell.classList].filter(c => /^is-/.test(c)); const tiles = [...document.querySelectorAll('.hm-home > .hm-card, .hm-home > .ah-tile')]; const r = tiles.map(t => t.getBoundingClientRect()); const cols = new Set(r.map(x => Math.round(x.left))).size; const rooms = [...document.querySelectorAll('.hm-room-grid .hm-room')].map(t => t.getBoundingClientRect()); const clock = document.querySelector('.hm-home .hm-clock-tile, .hm-home [class*=clock]')?.getBoundingClientRect(); return { cls, mainW: Math.round(main.getBoundingClientRect().width), scrollH: main.scrollHeight, clientH: main.clientHeight, tiles: tiles.length, cols, tileW: r[0] ? Math.round(r[0].width) : null, roomW: rooms[0] ? Math.round(rooms[0].width) : null, roomCols: new Set(rooms.map(x => Math.round(x.left))).size, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, font: getComputedStyle(document.querySelector('.hm-home .hm-status strong') ?? document.body).fontSize }; });
    await page.screenshot({ path: resolve(out, `${name}-home.png`) });
    await page.evaluate(() => { location.hash = '#home?device=e%3Acamera.entrance_camera'; }); await page.waitForSelector('.at-cam'); await page.waitForTimeout(700);
    const sheet = await page.evaluate(() => { const s = document.querySelector('.hm-sheet'); const r = s.getBoundingClientRect(); const left = s.querySelector('.at-cam-left')?.getBoundingClientRect(); const stage = s.querySelector('.at-cam-stage')?.getBoundingClientRect(); return { split: s.classList.contains('is-split'), w: Math.round(r.width), h: Math.round(r.height), leftW: left ? Math.round(left.width) : null, stageW: stage ? Math.round(stage.width) : null, stageH: stage ? Math.round(stage.height) : null }; });
    await page.screenshot({ path: resolve(out, `${name}-sheet.png`) });
    report.push({ name, w, h, ...geo, sheet, errors });
    console.log(`${name.padEnd(28)} ${w}x${h} ${geo.cls.join(' ')} main=${geo.mainW} tiles=${geo.tiles}/${geo.cols}cols tileW=${geo.tileW} rooms=${geo.roomCols}cols×${geo.roomW} scroll=${geo.scrollH}/${geo.clientH} ovfX=${geo.overflowX} | sheet ${sheet.split ? 'split' : 'one'} ${sheet.w}x${sheet.h} stage=${sheet.stageW}x${sheet.stageH}${errors.length ? ' ERR ' + errors.join('; ') : ''}`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
