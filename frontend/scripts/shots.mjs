// Isolated screenshots of the preview bundle on a registry snapshot. Commands are rejected by the preview host.
// usage: node scripts/shots.mjs <outDir> [fixture.json] [sizes] [config.json]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/shots')); await mkdir(out, { recursive: true });
const fixture = await readFile(resolve(root, process.argv[3] ?? '../private/fixtures/criuleni-registry.json'), 'utf8');
const sizes = (process.argv[4] ?? '1070x764,764x1070,402x874').split(',').map(s => s.split('x').map(Number));
const config = process.argv[5] ? await readFile(resolve(root, process.argv[5]), 'utf8') : 'null';
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { sizes: {}, errors: [], commands: 0 };
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${w}x${h}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') report.errors.push(`${w}x${h} console: ${m.text().slice(0, 200)}`); });
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx, cfg); }, JSON.parse(config));
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(900);
    const settle = () => page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && /^hm-(enter|sheet|fade|toast)/.test(a.animationName)), null, { timeout: 4000 }).catch(() => {});
    const shot = async name => { await settle(); await page.screenshot({ path: resolve(out, `${w}x${h}-${name}.png`) }); };
    const nav = async label => { await page.evaluate(label => { const map = { 'Обзор': 'home', 'Комнаты': 'rooms', 'Свет': 'lights', 'Климат': 'climate', 'Уборка': 'cleaning', 'Энергия': 'energy', 'Системы': 'systems', 'Настройка': 'setup' }; location.hash = '#' + (map[label] ?? 'home'); return true; }, label); await settle(); return true; };
    const geometry = () => page.evaluate(() => { const main = document.querySelector('.hm-main'); const shell = document.querySelector('.at-shell'); const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const ctl = [...shell.querySelectorAll('button,input,select')].filter(vis); const small = ctl.filter(e => { const r = e.getBoundingClientRect(); return e.classList.contains('hm-switch') ? r.width < 52 || r.height < 30 : e.type === 'range' ? false : r.width < 43.5 || r.height < 41.5; }).map(e => (e.getAttribute('aria-label') ?? e.innerText).slice(0, 40)); const outside = ctl.filter(e => { const r = e.getBoundingClientRect(); return r.x < -.5 || r.right > innerWidth + .5; }).length; return { mainScroll: main ? main.scrollHeight - main.clientHeight : null, small, outside, docScroll: document.documentElement.scrollHeight > innerHeight + 1 }; });
    const sizeReport = {};
    for (const [label, key] of [['Обзор', 'home'], ['Комнаты', 'rooms'], ['Свет', 'lights'], ['Климат', 'climate'], ['Уборка', 'cleaning'], ['Энергия', 'energy'], ['Системы', 'systems']]) { const ok = await nav(label); if (!ok) { sizeReport[key] = 'nav-missing'; continue; } await page.waitForTimeout(300); await shot(key); sizeReport[key] = await geometry(); }
    await nav('Комнаты'); await page.evaluate(() => document.querySelector('.at-room')?.click()); await page.waitForTimeout(400); await shot('room'); sizeReport.room = await geometry();
    await page.evaluate(() => (document.querySelector('.ah-tile-more') ?? document.querySelector('.hm-row-open'))?.click()); await page.waitForTimeout(500); await shot('sheet'); sizeReport.sheet = await geometry();
    await page.evaluate(() => document.querySelector('[aria-label="Закрыть"]')?.click()); await page.waitForTimeout(300);
    await nav('Свет'); await page.evaluate(() => document.querySelector('.hm-light-hit')?.click()); await page.waitForTimeout(600);
    sizeReport.commandsAfterToggle = await page.evaluate(() => window.atomPreview.host.log.length); sizeReport.toastAfterRejected = await page.evaluate(() => document.querySelector('.hm-toast')?.innerText ?? null);
    report.sizes[`${w}x${h}`] = sizeReport; await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1));
