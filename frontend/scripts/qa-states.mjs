// State matrix (loading / unavailable / unknown / error / command delay / confirmation / offline recovery / empty data),
// a responsive breakpoint sweep and preview load metrics — on the Criuleni snapshot with the owner's config (preview host).
// usage: node scripts/qa-states.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview');
const out = resolve(root, process.argv[2] ?? 'evidence/audit-states'); await mkdir(out, { recursive: true });
const base = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8'));
const ownerConfig = JSON.parse(await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8'));
// variants of the snapshot: one entity of every card kind goes unavailable / unknown
const pick = (prefix, extra = () => true) => Object.keys(base.states).find(id => id.startsWith(prefix) && extra(id, base.states[id]));
const kinds = { light: pick('light.', (id, s) => s.state === 'on' || s.state === 'off'), climate: pick('climate.'), camera: pick('camera.'), vacuum: pick('vacuum.'), co2: pick('sensor.', (id, s) => s.attributes.device_class === 'carbon_dioxide'), leak: pick('binary_sensor.', (id, s) => s.attributes.device_class === 'moisture'), power: pick('sensor.', (id, s) => s.attributes.device_class === 'power'), opening: pick('binary_sensor.', (id, s) => ['door', 'window', 'opening'].includes(s.attributes.device_class)) };
const variant = state => { const fx = JSON.parse(JSON.stringify(base)); for (const id of Object.values(kinds)) if (id && fx.states[id]) { fx.states[id] = { ...fx.states[id], state, attributes: state === 'unavailable' ? { friendly_name: fx.states[id].attributes.friendly_name, device_class: fx.states[id].attributes.device_class } : fx.states[id].attributes }; } return JSON.stringify(fx); };
const fixtures = { normal: JSON.stringify(base), unavailable: variant('unavailable'), unknown: variant('unknown') };
let served = fixtures.normal;
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { kinds, checks: [], sweep: [], perf: {}, errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra: typeof extra === 'string' ? extra : JSON.stringify(extra) }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 220) : ''}`); };
const mount = async (page, cfg = ownerConfig) => { await page.goto(origin); await page.waitForFunction(() => window.ready); await page.evaluate(async c => { localStorage.clear(); window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, c); }, cfg); await page.waitForSelector('.at-shell'); await page.waitForTimeout(700); };
const deviceOf = async (page, entityId) => page.evaluate(id => { const t = [...document.querySelectorAll('[data-device-key]')].find(x => x.dataset.deviceKey === 'e:' + id); return t ? { cls: t.className, text: t.innerText.replace(/\s+/g, ' ').slice(0, 120) } : null; }, entityId);
try {
  for (const [w, h, label] of [[402, 874, 'phone'], [1070, 764, 'tablet']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: resolve(out, `${label}-${name}.png`) }); };
    const go = async hash => { await page.evaluate(x => { location.hash = x; }, '#' + hash); await page.waitForTimeout(450); };
    // --- loading: first paint with a throttled network: is there a placeholder and no «0»/«—» values?
    served = fixtures.normal; const cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 });
    const t0 = Date.now(); await page.goto(origin); await page.waitForFunction(() => window.ready); const early = await page.evaluate(() => document.getElementById('root').innerText.trim().slice(0, 80));
    await page.evaluate(async c => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, c); }, ownerConfig); await page.waitForSelector('.at-shell'); const loadMs = Date.now() - t0;
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const firstPaint = await page.evaluate(() => ({ dashes: [...document.querySelectorAll('.ah-tile b, .ah-value-num b')].filter(b => b.textContent.trim() === '—').length, zeros: [...document.querySelectorAll('.ah-value-num b')].filter(b => b.textContent.trim() === '0').length, tiles: document.querySelectorAll('.ah-tile').length }));
    check(`${label}: loading — panel mounted on Slow-3G-like network`, loadMs < 15000 && firstPaint.tiles > 0, { loadMs, early, ...firstPaint }); await shot('01-loading');
    // --- unavailable
    served = fixtures.unavailable; await mount(page); await shot('02-unavailable-home'); await go('rooms'); await go('lights'); await shot('02-unavailable-lights');
    const un = {}; for (const [k, id] of Object.entries(kinds)) { if (!id) continue; await go(k === 'light' ? 'lights' : k === 'climate' ? 'climate' : k === 'vacuum' ? 'cleaning' : k === 'power' ? 'energy' : 'systems'); un[k] = await deviceOf(page, id); }
    check(`${label}: unavailable — tiles say «Нет связи», not «off»`, Object.values(un).filter(Boolean).every(x => /Нет связи/.test(x.text) && /is-off/.test(x.cls)), un);
    await go('lights'); const unLight = kinds.light ? await page.evaluate(id => { const t = [...document.querySelectorAll('[data-device-key]')].find(x => x.dataset.deviceKey === 'e:' + id); const hit = t?.querySelector('.ah-tile-hit'); return { disabled: hit?.disabled ?? null }; }, kinds.light) : null;
    check(`${label}: unavailable light — the tile cannot be tapped`, !!unLight && unLight.disabled === true, unLight);
    await go('lights?device=e%3A' + encodeURIComponent(kinds.light ?? '')); await shot('02-unavailable-sheet');
    const unSheet = await page.evaluate(() => ({ hero: document.querySelector('.hm-sheet .ah-hero-main b, .hm-sheet .at-light-state b')?.innerText ?? null, power: document.querySelector('.hm-sheet .ah-power')?.disabled ?? null }));
    check(`${label}: unavailable light sheet — states «Нет связи», power row disabled`, /Нет связи/.test(unSheet.hero ?? '') && unSheet.power !== false, unSheet);
    // --- unknown
    served = fixtures.unknown; await mount(page); await go('systems'); await shot('03-unknown-systems');
    const unk = {}; for (const k of ['co2', 'leak', 'opening', 'power']) { const id = kinds[k]; if (!id) continue; await go(k === 'power' ? 'energy' : 'systems'); unk[k] = await deviceOf(page, id); }
    check(`${label}: unknown — readings say «Нет данных», never 0 or off`, Object.values(unk).filter(Boolean).every(x => /Нет данных/.test(x.text) && !/\b0\b (ppm|W)/.test(x.text)), unk);
    // --- error: a command is rejected by the host → toast, state unchanged
    served = fixtures.normal; await mount(page); await go('lights'); const lightId = kinds.light; const before = await deviceOf(page, lightId);
    const tapAt = Date.now(); await page.evaluate(id => { const t = [...document.querySelectorAll('[data-device-key]')].find(x => x.dataset.deviceKey === 'e:' + id); t?.querySelector('.ah-tile-hit')?.click(); }, lightId);
    const pending = await page.evaluate(id => { const t = [...document.querySelectorAll('[data-device-key]')].find(x => x.dataset.deviceKey === 'e:' + id); return t?.classList.contains('is-pending') ?? null; }, lightId);
    await page.waitForSelector('.hm-toast', { timeout: 3000 }).catch(() => null); const toastAt = Date.now(); const toast = await page.evaluate(() => document.querySelector('.hm-toast')?.innerText ?? null); const after = await deviceOf(page, lightId); await shot('04-error-toast');
    check(`${label}: error — rejected command shows a toast and the tile keeps its state`, !!toast && /preview|отклон|rejected/i.test(toast) && before?.cls.includes('is-on') === after?.cls.includes('is-on'), { toast, pending, ms: toastAt - tapAt });
    check(`${label}: delay — the tile shows a pending state right after the tap`, pending === true, { pending });
    // double tap must not send twice
    const n0 = await page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').length);
    await page.evaluate(id => { const t = [...document.querySelectorAll('[data-device-key]')].find(x => x.dataset.deviceKey === 'e:' + id); const b = t?.querySelector('.ah-tile-hit'); b?.click(); b?.click(); }, lightId); await page.waitForTimeout(400);
    const n1 = await page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').length);
    check(`${label}: delay — a double tap sends one command while pending`, n1 - n0 <= 1, { sent: n1 - n0 });
    // --- confirmation for risky actions: valve / lock / alarm panel / all lights off / heating from off
    const risky = Object.keys(base.states).filter(id => /^(valve|lock|alarm_control_panel)\./.test(id)).slice(0, 3); const conf = {};
    for (const id of risky) { await go('systems?device=e%3A' + encodeURIComponent(id)); await page.waitForTimeout(300); const btn = await page.$('.hm-sheet .hm-chips .hm-pill, .hm-sheet .at-actions .hm-pill'); if (!btn) { conf[id] = 'no-button'; continue; } await btn.click(); await page.waitForTimeout(300); conf[id] = !!(await page.$('.hm-confirm')); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    await go('lights'); await page.click('.at-lights-bar .hm-pill').catch(() => null); await page.waitForTimeout(300); conf.allLightsOff = !!(await page.$('.hm-confirm')); if (conf.allLightsOff) await shot('05-confirm-all-off'); await page.keyboard.press('Escape');
    check(`${label}: confirmation — valve / lock / alarm / «all lights off» ask first`, Object.values(conf).every(v => v === true || v === 'no-button') && conf.allLightsOff === true, conf);
    // --- offline → online recovery: the banner and the state after return
    await go('home'); await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await page.evaluate(() => { window.dispatchEvent(new Event('offline')); }); await page.waitForTimeout(600); await shot('06-offline');
    const off = await page.evaluate(() => ({ badge: document.querySelector('.hm-badge.tone-danger')?.innerText ?? null, conn: document.querySelector('.hm-conn')?.className ?? null }));
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await page.evaluate(() => { window.dispatchEvent(new Event('online')); }); await page.waitForTimeout(600);
    const back = await page.evaluate(() => ({ badge: document.querySelector('.hm-badge.tone-danger')?.innerText ?? null }));
    check(`${label}: recovery — offline shows «Нет связи с домом», online clears it`, off.badge !== null || /is-off/.test(off.conn ?? ''), { off, back });
    // --- empty data: a room without devices, events without entries
    await go('rooms'); const emptyRoom = await page.evaluate(() => { const r = [...document.querySelectorAll('.at-room')].find(x => !/\d/.test(x.innerText)); return r ? r.innerText.replace(/\s+/g, ' ').slice(0, 60) : null; });
    check(`${label}: empty — a room card without readings has no NaN/undefined`, !/NaN|undefined|null/.test(emptyRoom ?? ''), { emptyRoom });
    const raw = await page.evaluate(() => [...document.body.querySelectorAll('.hm-main *')].map(e => e.childNodes.length === 1 && e.firstChild.nodeType === 3 ? e.textContent.trim() : '').filter(t => /^(light|switch|sensor|binary_sensor|climate|camera|media_player|vacuum)\.[a-z0-9_]+$/.test(t)).slice(0, 5));
    check(`${label}: no raw entity ids on screens`, raw.length === 0, raw);
    await page.close();
  }
  // --- responsive sweep 360…1920: columns of the home grid, nav kind, overflow
  const sweep = await browser.newPage({ viewport: { width: 1440, height: 900 } }); served = fixtures.normal; await mount(sweep); let prev = null;
  for (const w of [360, 402, 480, 600, 698, 764, 874, 1024, 1070, 1280, 1440, 1920]) {
    await sweep.setViewportSize({ width: w, height: w < 700 ? 874 : 900 }); await sweep.waitForTimeout(400);
    const m = await sweep.evaluate(() => { const g = document.querySelector('.hm-main .ah-grid'); const cols = g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; return { cols, nav: document.querySelector('.hm-tabbar') ? 'tabbar' : document.querySelector('aside nav') ? 'rail' : 'none', overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, shell: document.querySelector('.hm-shell')?.className.match(/is-(wide|narrow)/)?.[0] }; });
    const row = { w, ...m, change: prev && (prev.cols !== m.cols || prev.nav !== m.nav) ? 'layout change' : '' }; report.sweep.push(row); if (m.overflowX) check(`sweep ${w}px: no horizontal overflow`, false, row); prev = m;
  }
  check('sweep: no horizontal overflow at any width', report.sweep.every(r => !r.overflowX), report.sweep.map(r => `${r.w}:${r.cols}/${r.nav}`).join(' '));
  await sweep.screenshot({ path: resolve(out, 'sweep-1920.png') }); await sweep.close();
  // --- preview load metrics: bundle bytes, LCP, CLS on a fresh load at phone size
  const perf = await browser.newPage({ viewport: { width: 402, height: 874 } }); await perf.goto(origin);
  await perf.evaluate(() => { window.__lcp = 0; window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await perf.waitForFunction(() => window.ready); await perf.evaluate(async c => { window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, c); }, ownerConfig); await perf.waitForSelector('.at-shell'); await perf.waitForTimeout(1500);
  report.perf = await perf.evaluate(() => ({ lcpMs: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)), jsBytes: performance.getEntriesByType('resource').filter(r => r.name.endsWith('.js')).reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0), domNodes: document.querySelectorAll('*').length, longTasks: performance.getEntriesByType('longtask').length }));
  check('perf (preview, phone): CLS ≤ 0.1 and LCP ≤ 2.5 s', report.perf.cls <= 0.1 && report.perf.lcpMs <= 2500, report.perf); await perf.close();
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} page errors`); if (report.errors.length) console.log(report.errors.join('\n'));
