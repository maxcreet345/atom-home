// A house that is not ours (27.11.2026, scripts/fresh-house-fixture.mjs): every section and room page opens without a crash, every planted
// reading shows somewhere (a sensor dropped silently fails here, whichever card dropped it), «Air» lists only rooms with a sensor, the clock keeps
// its timers block, the administrator is offered the missing helpers and a resident is not. No private data: the gate never skips it.
// usage: node scripts/qa-fresh-house.mjs <outDir>     QA_DIST=<folder> checks another build of the preview (an older release must fail)
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { freshHouse, FRESH_CONFIG, AREAS, READINGS } from './fresh-house-fixture.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/fresh-house')); await mkdir(out, { recursive: true });
const served = JSON.stringify(freshHouse());
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); if (!p.startsWith(dist)) { res.statusCode = 403; res.end(); return; } res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { checks: [], errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra && !ok ? ' — ' + String(extra).slice(0, 400) : ''}`); };
// a number as the panel may print it: «21.7» in English, «21,7» in Romanian and Russian
const shapes = v => { const n = Number(v); return Number.isInteger(n) ? [String(n)] : [n.toFixed(1), n.toFixed(1).replace('.', ',')]; };
const has = (text, v) => shapes(v).some(s => new RegExp(`(^|[^0-9.,])${s.replace('.', '\\.')}([^0-9]|$)`).test(text));
try {
  for (const [w, h, size] of [[402, 874, 'phone'], [1070, 764, 'tablet'], [1440, 900, 'desktop']]) for (const [lang, admin] of [['en', true], ['ro', false]]) {
    const label = `${size}/${lang}/${admin ? 'admin' : 'resident'}`;
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) report.errors.push(`${label} console: ${m.text()}`); });
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async ([cfg, admin]) => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); window.atomPreview.setAdmin(admin); }, [{ ...FRESH_CONFIG, home: { ...FRESH_CONFIG.home, language: lang } }, admin]);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(600);
    const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(500); };
    const text = () => page.evaluate(() => document.querySelector('.at-shell').innerText.replace(/ | /g, ' '));
    const crashed = () => page.evaluate(() => [...document.querySelectorAll('.at-crash, .at-crash-tile')].map(x => x.textContent.trim()).slice(0, 3));
    let seen = '';
    // every section the panel offers here, as the navigation lists it
    const sections = await page.evaluate(() => [...new Set([...document.querySelectorAll('.hm-sidebar a[href^="#"], .hm-tabbar a[href^="#"], .hm-sidebar [data-section], .hm-tabbar [data-section]')].map(a => a.getAttribute('href') ?? `#${a.getAttribute('data-section')}`).filter(Boolean))]);
    const list = sections.length ? sections : ['#home', '#rooms', '#lights', '#systems'];
    for (const s of list) { await go(s); const c = await crashed(); check(`${label}: ${s} opens without a crash`, !c.length, c.join(' | ')); seen += '\n' + await text(); }
    await page.screenshot({ path: `${out}/${size}-${lang}-${admin ? 'admin' : 'resident'}-last-section.png` });
    // every room page
    for (const [id] of AREAS) { await go(`#rooms?room=${id}`); const c = await crashed(); if (c.length) check(`${label}: room ${id} opens without a crash`, false, c.join(' | ')); seen += '\n' + await text(); }
    check(`${label}: every room page opens without a crash`, true);
    // «Air»: only rooms with a sensor; the mean is of the rooms that answer, whatever their ids
    await go('#home?device=air'); const air = await page.evaluate(() => document.querySelector('.at-air-sheet')?.innerText.replace(/ | /g, ' ') ?? '');
    await page.screenshot({ path: `${out}/${size}-${lang}-${admin ? 'admin' : 'resident'}-air.png` }); seen += '\n' + air;
    check(`${label}: «Air» opens`, !!air);
    check(`${label}: «Air» has no row for the hood-only kitchen nor the purifier-only bedroom`, !/2\. Kitchen|4\. Bedroom/.test(air), air.slice(0, 300));
    check(`${label}: «Air» lists the unlinked kids' room, the showroom and the silent bathroom`, /7\. Kids Room/.test(air) && /Showroom/.test(air) && /Bathroom/.test(air), air.slice(0, 400));
    const mean = (21.7 + 22.9 + 19.3) / 3;
    check(`${label}: the mean temperature is of every room that answers (a room id of Criuleni's changes nothing)`, has(air, mean.toFixed(1)), air.slice(0, 300));
    // every planted reading shows somewhere
    for (const [id, , , state, , how] of READINGS) if (how !== 'silent') check(`${label}: ${id} = ${state} shows`, has(seen, state));
    // the clock keeps its timers block; the administrator is offered the missing helpers, a resident is not
    await go('#home?device=clock'); const timers = await page.evaluate(() => { const c = document.querySelector('.at-clock-timers'); return c ? { off: c.classList.contains('is-off'), btn: !!c.querySelector('.at-clock-enable') } : null; });
    check(`${label}: «Time» keeps its timers block (${admin ? 'with' : 'without'} «Turn timers on»)`, !!timers && timers.off && timers.btn === admin, JSON.stringify(timers));
    await go('#home'); await page.waitForTimeout(8200);
    const bar = await page.evaluate(() => !!document.querySelector('.ah-banners .at-helpers-create'));
    check(`${label}: the missing-helpers bar is ${admin ? 'offered' : 'not shown'}`, bar === admin);
    await page.screenshot({ path: `${out}/${size}-${lang}-${admin ? 'admin' : 'resident'}-home.png` });
    await page.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
const bad = report.checks.filter(c => !c.ok);
console.log(`\n${report.checks.length - bad.length}/${report.checks.length} passed, ${report.errors.length} page errors`); report.errors.slice(0, 10).forEach(e => console.log('✖ ' + e));
process.exit(bad.length || report.errors.length ? 1 : 0);
