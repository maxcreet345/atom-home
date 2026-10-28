// Card-by-card review helper: element screenshots and contact sheets.
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/cards'); await mkdir(out, { recursive: true });
const fixture = await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const check = (n, p, d = {}) => checks.push({ n, p, ...d }); const errors = [];
// Card-by-card review: element screenshots of every module/card/sheet type in both themes, then contact sheets.
import { execSync } from 'node:child_process';
const ownerConfig = JSON.parse(await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8'));
const traian = await readFile(resolve(root, '../private/fixtures/traian-registry.json'), 'utf8');
const shots = [];
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1070, height: 764 }, deviceScaleFactor: 2 }); page.on('pageerror', e => errors.push(`${theme}: ${e.message}`));
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async ([cfg, th]) => { localStorage.clear(); const fx = await (await fetch('/fixture.json')).json(); const on = 'light.vannaia_svet_tualet'; fx.states[on] = { ...fx.states[on], state: 'on', attributes: { ...fx.states[on].attributes, brightness: 180, supported_color_modes: ['brightness'], color_mode: 'brightness' } }; const c = JSON.parse(cfg); c.home.theme = th; await window.mountPreview(document.getElementById('root'), fx, c); }, [JSON.stringify(ownerConfig), theme]);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(800);
    const go = async id => { await page.evaluate(id => { location.hash = '#' + id; }, id); await page.waitForTimeout(500); };
    const snap = async (name, sel, nth = 0) => { const loc = page.locator(sel).nth(nth); if (await loc.count() === 0) { shots.push({ name, theme, missing: true }); return; } const f = resolve(out, `${theme}-${name}.png`); await loc.screenshot({ path: f }); shots.push({ name, theme, f }); };
    await go('home');
    await snap('clock', '.ah-clock'); await snap('thermostat', '.ah-thermo'); await snap('camera', '.hm-camera-tile'); await snap('module-pressure', '.ah-module'); await snap('scene', '.ah-scene');
    await snap('value-air', '.ah-value.hm-status'); await snap('value-energy', '.ah-value', 1); await snap('value-leaks', '.ah-value', 2);
    await go('lights'); await snap('tile-light-off', '.ah-tile.kind-light:not(.is-off)'); await snap('tile-light-unavailable', '.ah-tile.kind-light.is-off'); await snap('tile-switch', '.ah-tile.kind-switch'); await snap('tile-valve', '.ah-tile.kind-valve'); await snap('tile-media', '.ah-tile.kind-media:not(.is-off)'); await snap('tile-vacuum', '.ah-tile.kind-vacuum'); await snap('tile-climate', '.ah-tile.kind-climate'); await snap('tile-environment', '.ah-tile.kind-environment'); await snap('tile-leak', '.ah-tile.kind-leak');
    await snap('tile-light-on', '.ah-tile.kind-light.is-on'); await go('systems');
    await page.evaluate(() => document.querySelector('.ah-tile.kind-light.is-on .ah-tile-more').click()); await page.waitForTimeout(500); await snap('sheet-light-on', '.hm-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await go('rooms'); await snap('room-tile', '.at-room'); await snap('room-tile-nophoto', '.at-room', 8);
    await page.evaluate(() => document.querySelector('.at-room').click()); await page.waitForTimeout(500); await snap('room-pills', '.ah-room-pills'); await snap('room-section', '.hm-section');
    await go('climate'); await page.waitForTimeout(800); await snap('boiler-card', '.at-boiler'); await snap('thermostat-page-tile', '.ah-climate-grid .ah-thermo', 2);
    await go('energy'); await snap('energy-card', '.hm-line');
    await go('cleaning'); await snap('vacuum-card', '.ah-tile-stack');
    await go('systems'); await snap('systems-section', '.hm-systems .hm-section', 0);
    await go('lights'); await snap('lights-toolbar', '.hm-toolbar');
    // sheets per kind
    await go('home'); await snap('group-lights', '.ah-group-tile.kind-lights'); await snap('rooms-strip', '.ah-rooms-strip');
    for (const [name, kind] of [['sheet-light', 'light'], ['sheet-switch', 'switch'], ['sheet-valve', 'valve'], ['sheet-media', 'media'], ['sheet-vacuum', 'vacuum'], ['sheet-environment', 'environment'], ['sheet-leak', 'leak'], ['sheet-climate', 'climate']]) {
      await go(kind === 'light' ? 'lights' : kind === 'climate' ? 'climate' : kind === 'vacuum' ? 'cleaning' : 'systems'); const ok = await page.evaluate(k => { const b = document.querySelector(`.ah-tile.kind-${k}:not(.is-off) .ah-tile-more`); if (!b) return false; b.click(); return true; }, kind); await page.waitForTimeout(500);
      if (ok) await snap(name, '.hm-sheet'); else shots.push({ name, theme, missing: true });
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    }
    await go('home'); await page.evaluate(() => document.querySelector('.hm-camera-tile').click()); await page.waitForTimeout(600); await snap('sheet-camera', '.hm-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('.ah-scene .ah-tile-hit').click()); await page.waitForTimeout(400); await snap('toast', '.hm-toast');
    // confirm dialog
    await page.evaluate(() => { const cfg = window.atomPreview.config; cfg.buttons = [...cfg.buttons, { id: 'qa_confirm', label: 'Проверка', service: 'script.turn_on', target: { entity_id: 'script.x' }, confirm: true }]; window.atomPreview.redraw?.(); }); await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelectorAll('.ah-scene strong')].find(s => s.innerText === 'Проверка')?.closest('button').click()); await page.waitForTimeout(300); await snap('confirm', '.hm-confirm'); await page.keyboard.press('Escape');
    // setup tabs
    await go('setup'); for (const [i, name] of ['setup-devices', 'setup-rooms', 'setup-sections', 'setup-buttons', 'setup-modules', 'setup-home'].entries()) { await page.evaluate(i => document.querySelectorAll('.at-setup-tabs button')[i]?.click(), i); await page.waitForTimeout(300); if (i === 0) await page.evaluate(() => document.querySelector('.at-setup-row .hm-row-open')?.click()); await page.waitForTimeout(300); await snap(name, '.at-setup'); }
    // phone size versions of the key modules
    await page.setViewportSize({ width: 390, height: 844 }); await go('home'); await page.waitForTimeout(500);
    await snap('ph-clock', '.ah-clock'); await snap('ph-thermostat', '.ah-thermo'); await go('lights'); await snap('ph-tile-light', '.ah-tile.kind-light:not(.is-off)'); await go('home'); await snap('ph-value-air', '.ah-value.hm-status'); await snap('ph-camera', '.hm-camera-tile'); await snap('ph-tabbar', '.hm-tabbar');
    await go('lights'); await page.evaluate(() => document.querySelector('.ah-tile.kind-light:not(.is-off) .ah-tile-more').click()); await page.waitForTimeout(500); await snap('ph-sheet-light', '.hm-sheet');
    await page.close();
  }
  // Traian: feeder card + sheet-less module
  const page = await browser.newPage({ viewport: { width: 1070, height: 764 }, deviceScaleFactor: 2 }); page.on('pageerror', e => errors.push(`traian: ${e.message}`));
  await page.goto(origin); await page.waitForFunction(() => window.ready);
  await page.evaluate(async fx => { localStorage.clear(); await window.mountPreview(document.getElementById('root'), JSON.parse(fx)); }, traian); await page.waitForSelector('.at-shell'); await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = '#systems'; }); await page.waitForTimeout(600);
  const f = resolve(out, 'light-feeder-card.png'); await page.locator('.at-feeder').screenshot({ path: f }); shots.push({ name: 'feeder-card', theme: 'light', f });
  await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(600); const f2 = resolve(out, 'light-feeder-compact.png'); await page.locator('[data-module-card="pet_feeder"]').first().screenshot({ path: f2 }); shots.push({ name: 'feeder-compact', theme: 'light', f: f2 });
  await page.close();
} finally { await browser.close(); server.close(); }
// contact sheets (ImageMagick): tiles / sheets / setup, per theme
const groups = { tiles: n => !/^sheet|^setup|^ph-|confirm|toast/.test(n), sheets: n => /^sheet|^ph-sheet|confirm|toast/.test(n), setup: n => /^setup/.test(n), phone: n => /^ph-(?!sheet)/.test(n) };
for (const theme of ['light', 'dark']) for (const [g, test] of Object.entries(groups)) { const files = shots.filter(s => s.theme === theme && s.f && test(s.name)).map(s => s.f); if (!files.length) continue; try { execSync(`magick montage ${files.map(f => `"${f}"`).join(' ')} -tile 4x -geometry 420x420+10+10 -background "#888" -label '%t' -pointsize 20 "${resolve(out, `montage-${theme}-${g}.png`)}"`); } catch (e) { console.error('montage failed', g, String(e).slice(0, 200)); } }
const report = { missing: shots.filter(s => s.missing).map(s => `${s.theme}/${s.name}`), count: shots.filter(s => s.f).length, errors }; await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
