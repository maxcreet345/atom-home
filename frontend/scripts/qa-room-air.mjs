// A room's place in «Воздух» set on the settings page (27.11.2026, model/air.ts): on a house that is not ours (scripts/fresh-house-fixture.mjs)
// every room with a sensor has the three fields, rooms with none have none; the first change writes every sensed room (so the first house's
// defaults never half-apply), it is kept by the store, and «Air» counts by it at once — «Do not count» takes the showroom out of the mean,
// «Show only» keeps its row but not its number in the mean. Phone and tablet, light and dark. No private data: the gate never skips it.
// usage: node scripts/qa-room-air.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { freshHouse, FRESH_CONFIG } from './fresh-house-fixture.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/room-air')); await mkdir(out, { recursive: true });
const served = JSON.stringify(freshHouse());
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); if (!p.startsWith(dist)) { res.statusCode = 403; res.end(); return; } res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { checks: [], errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra && !ok ? ' — ' + String(extra).slice(0, 400) : ''}`); };
const SENSED = ['living_room', 'kids_room', 'bathroom', 'spalnia'], BARE = ['kitchen', 'bedroom', 'hallway'];
const has = (text, v) => [v.toFixed(1), v.toFixed(1).replace('.', ',')].some(s => text.includes(s));
try {
  for (const [w, h, size, theme] of [[402, 874, 'phone', 'light'], [1070, 764, 'tablet', 'dark']]) {
    const label = `${size}/${theme}`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) report.errors.push(`${label} console: ${m.text()}`); });
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); window.atomPreview.setAdmin(true); }, { ...FRESH_CONFIG, home: { ...FRESH_CONFIG.home, language: 'en', theme } });
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(500);
    const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(500); };
    const airText = async () => { await go('#home?device=air'); return page.evaluate(() => document.querySelector('.at-air-sheet')?.innerText.replace(/ | /g, ' ') ?? ''); };
    check(`${label}: before any setting the mean is of the three rooms that answer`, has(await airText(), (21.7 + 22.9 + 19.3) / 3));
    await go('#setup'); await page.locator('.at-setup-tabs button', { hasText: /^Rooms$/ }).click(); await page.waitForTimeout(400);
    const fields = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.at-setup-row[data-room-id]')].map(r => [r.getAttribute('data-room-id'), ['air-scale', 'air-count', 'air-actions'].filter(f => r.querySelector(`select[data-field="${f}"]`)).length])));
    check(`${label}: every room with a sensor has the three fields`, SENSED.every(id => fields[id] === 3), JSON.stringify(fields));
    check(`${label}: a room with no sensor has none`, BARE.every(id => !fields[id]), JSON.stringify(fields));
    check(`${label}: the hint says what the fields are for`, await page.locator('[data-setting="air-hint"]').isVisible());
    const row = page.locator('.at-setup-row[data-room-id="spalnia"]');
    await row.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/${size}-${theme}-rooms.png` });
    const sel = row.locator('select[data-field="air-count"]'); const box = await sel.boundingBox();
    const sibling = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.at-setup-row .at-field select:not([data-field^="air-"]), .at-setup-row .at-field input')].map(e => e.getBoundingClientRect().height).filter(Boolean)));
    /* the settings page's fields are 40 px (apple.css .at-field): the new ones are no smaller than their neighbours and stay inside the screen */
    check(`${label}: the field is as tall as the page's other fields and inside the screen`, box && box.height >= Math.min(40, sibling) && box.x >= 0 && box.x + box.width <= w, JSON.stringify({ box, sibling }));
    await sel.selectOption('off'); await page.waitForTimeout(600);
    const saved = await page.evaluate(async () => (await window.atomPreview.store.load()).config.rooms);
    check(`${label}: «Do not count» is kept`, saved?.spalnia?.air?.count === 'off', JSON.stringify(saved?.spalnia));
    check(`${label}: the first change writes every sensed room, so nothing half-applies`, SENSED.every(id => saved?.[id]?.air?.scale && saved[id].air.count), JSON.stringify(saved));
    check(`${label}: the bathroom is seeded as a bathroom`, saved?.bathroom?.air?.scale === 'bath', JSON.stringify(saved?.bathroom));
    let air = await airText(); await page.screenshot({ path: `${out}/${size}-${theme}-air-off.png` });
    check(`${label}: «Do not count» — the mean is of the other two`, has(air, (21.7 + 22.9) / 2), air.slice(0, 300));
    await go('#setup'); await page.locator('.at-setup-tabs button', { hasText: /^Rooms$/ }).click(); await page.waitForTimeout(300);
    await page.locator('.at-setup-row[data-room-id="spalnia"] select[data-field="air-count"]').selectOption('aside'); await page.waitForTimeout(600);
    air = await airText();
    check(`${label}: «Show only» — its row stays, its number is not in the mean`, /Showroom/.test(air) && air.includes('19') && has(air, (21.7 + 22.9) / 2), air.slice(0, 300));
    await page.reload(); await page.waitForFunction(() => window.ready);
    const kept = await page.evaluate(async () => { const s = window.atomPreview?.store; return s ? (await s.load()).config.rooms?.spalnia?.air?.count : 'no-store'; });
    if (kept !== 'no-store') check(`${label}: kept after a reload`, kept === 'aside', kept);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
const bad = report.checks.filter(c => !c.ok);
console.log(`\n${report.checks.length - bad.length}/${report.checks.length} passed, ${report.errors.length} page errors`); report.errors.slice(0, 10).forEach(e => console.log('✖ ' + e));
process.exit(bad.length || report.errors.length ? 1 : 0);
