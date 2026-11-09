// A card on a REAL device: its own Chrome over USB opens the shared preview (commands go nowhere, so everything can be pressed) and everything the device shows is measured there.
// Both orientations for real: the page asks Android to turn the screen the way a video player does (fullscreen + screen.orientation.lock), so the display turns and no system setting changes. Only if a device refuses, its viewport is swapped and the run is marked «swapped».
// USB drops are normal on some cables: the run waits for the device and goes on from where it stopped. It works in one tab of its own and closes it; other tabs are never touched; whatever was in front comes back.
// If Fully Kiosk has WebView debugging on, the same is done inside the kiosk at its true size (tags fully-*), plus the REAL panel read-only (tags live-*: looking and measuring, nothing is pressed), and Fully goes back to the address it had.
// A kiosk without debugging is still checked (tags kiosk-*): the preview and the real panel open in Fully itself and adb takes the pictures in small pieces, a weak cable survives that. The preview is scrolled by swipes, safe there; the real panel is only looked at, no touch. Fully goes back to the panel at the end (address in private/panel-url.txt, not in git).
// Every card is scrolled from top to bottom, a screenshot at each step (<tag>-scroll<N>.png). The scroll is set by script, no touch, so nothing can be pressed by it.
// Writes report.json and screenshots to outDir.
// usage: node scripts/device-audit.mjs <serial> <card> <outDir> [cdpPort] [--fully-only]   needs scripts/card-preview.mjs running on 4173
import { chromium } from '../node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout, targets } from './card-checks.mjs';
const FULLY_ONLY = process.argv.includes('--fully-only'), [serial, cardName, outArg, portArg] = process.argv.slice(2).filter(a => a !== '--fully-only'), port = Number(portArg ?? 9333), root = resolve(import.meta.dirname, '..'), out = resolve(outArg), MARK = `http://127.0.0.1:4173/?card=${cardName}&atom-audit=1`, ATTEMPTS = 5; await mkdir(out, { recursive: true });
const { card } = await import(`./cards/${cardName}.mjs`), axeSrc = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const adb = (...a) => execFileSync('adb', ['-s', serial, ...a], { encoding: 'utf8', timeout: 20000, maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] });
const focus = () => { try { return adb('shell', 'dumpsys window | grep -m1 mCurrentFocus').match(/Window\{\S+ \S+ ([^/}\s]+)/)?.[1] ?? null; } catch { return null; } };
const backOnline = async () => { for (let i = 0; i < 40; i++) { try { if (adb('get-state').trim() === 'device') return true; } catch {} if (i % 8 === 7) try { execFileSync('adb', ['-s', serial, 'reconnect'], { timeout: 8000, stdio: 'ignore' }); } catch {} await wait(3000); } return false; };
await backOnline();
const report = { serial, card: cardName, model: adb('shell', 'getprop', 'ro.product.model').trim(), android: adb('shell', 'getprop', 'ro.build.version.release').trim(), foregroundBefore: focus(), drops: 0, runs: [] }, done = new Set();
const save = () => writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
let visit = 0, browser, page;
const fullySocket = () => { try { const pid = adb('shell', 'pidof', 'de.ozerov.fully').trim().split(/\s+/)[0]; if (!pid) return null; const name = `webview_devtools_remote_${pid}`; return adb('shell', 'cat /proc/net/unix').includes(name) ? name : null; } catch { return null; } };
let fullyHome = null;
const panelUrl = await readFile(resolve(root, '../private/panel-url.txt'), 'utf8').then(t => t.trim()).catch(() => null);
const fullyRuns = () => { try { return !!adb('shell', 'pidof', 'de.ozerov.fully').trim(); } catch { return false; } };
/** A picture of the screen in small pieces: on a weak cable a whole file drops the connection. */
async function grab(file) {
  const remote = '/sdcard/atom-audit.png', bs = 16384; let size = 0;
  for (let t = 0; t < 8 && !size; t++) try { execFileSync('adb', ['-s', serial, 'shell', 'screencap', '-p', remote], { stdio: 'ignore', timeout: 20000 }); size = Number(adb('shell', 'stat', '-c', '%s', remote).trim()); } catch { await backOnline(); }
  if (!size) throw new Error('no picture from the device');
  const parts = [], total = Math.ceil(size / bs); for (let i = 0; i < total; i++) for (let t = 0; ; t++) try { const b = execFileSync('adb', ['-s', serial, 'exec-out', 'dd', `if=${remote}`, `bs=${bs}`, `skip=${i}`, 'count=1'], { timeout: 15000, maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); if (!b.length) throw new Error('empty'); parts.push(b); break; } catch (e) { if (t > 12) throw e; await backOnline(); await wait(800); }
  try { adb('shell', 'rm', '-f', remote); } catch {}
  const data = Buffer.concat(parts); await writeFile(file, data); return createHash('sha1').update(data).digest('hex');
}
const openInKiosk = async url => { adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-n', 'de.ozerov.fully/.FullyActivity', '-d', `"${url}"`); await wait(6000); };
async function kioskByEye() {
  if (!panelUrl) throw new Error('private/panel-url.txt is missing: the kiosk could not be sent back, so it is not touched');
  adb('reverse', 'tcp:4173', 'tcp:4173'); const [dx, dy] = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)\s*$/).slice(1).map(Number);
  const shoot = async (tag, url, swipes) => { if (done.has(tag)) return; await openInKiosk(url); const png = `${tag}.png`; let last = await grab(resolve(out, png)); const scroll = { scrollable: false, shots: [], reachedBottom: !swipes }; if (swipes) for (let i = 1; i <= 12; i++) { adb('shell', 'input', 'swipe', String(Math.round(dx * 0.92)), String(Math.round(dy * 0.8)), String(Math.round(dx * 0.92)), String(Math.round(dy * 0.3)), '450'); await wait(900); const shot = `${tag}-scroll${i}.png`, h = await grab(resolve(out, shot)); if (h === last) { scroll.reachedBottom = true; break; } scroll.scrollable = true; scroll.shots.push(shot); last = h; } report.runs.push({ tag, png, kiosk: true, measured: false, live: !swipes, scroll }); done.add(tag); await save(); };
  const preview = (scenario, theme, hash) => `http://127.0.0.1:4173/?card=${cardName}&scenario=${scenario}&theme=${theme}&v=${++visit}${hash}`;
  await shoot('kiosk-live-home', `${panelUrl}${card.home}`, false); await shoot('kiosk-live-sheet', `${panelUrl}${card.sheet}`, false);
  for (const scenario of Object.keys(card.scenarios)) await shoot(`kiosk-sheet-${scenario}-light`, preview(scenario, 'light', card.sheet), true);
  for (const scenario of (card.darkScenarios ?? ['calm', 'wet', 'bad'])) if (card.scenarios[scenario]) await shoot(`kiosk-sheet-${scenario}-dark`, preview(scenario, 'dark', card.sheet), true);
  for (const scenario of (card.homeScenarios ?? ['calm', 'wet'])) if (card.scenarios[scenario]) await shoot(`kiosk-home-${scenario}-light`, preview(scenario, 'light', card.home), false);
}
/** Walk the card from top to bottom. The scroller is whatever holds the card and has more to show; the real panel lives in a shadow root. */
async function scrollThrough(tag, rootSel) {
  const box = await page.evaluate(sel => { const deep = (q, r = document) => { const hit = r.querySelector(q); if (hit) return hit; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) { const x = deep(q, e.shadowRoot); if (x) return x; } return null; }; const root = deep(sel); if (!root) return null; const tall = e => e && e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY); let el = [root, ...root.querySelectorAll('*')].find(tall); for (let a = root; !el && a; a = a.parentElement ?? a.getRootNode().host) if (tall(a)) el = a; window.__auditScroller = el ?? null; return el ? { height: el.scrollHeight, view: el.clientHeight } : { height: 0, view: 0 }; }, rootSel);
  if (!box) return { scrollable: false, found: false, shots: [] };
  if (!box.height) return { scrollable: false, found: true, shots: [] };
  const shots = []; let top = 0, reached = false;
  for (let i = 1; i <= 30 && !reached; i++) { top += Math.round(box.view * 0.85); const at = await page.evaluate(y => { const el = window.__auditScroller; el.scrollTop = y; return { top: el.scrollTop, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 }; }, top); reached = at.bottom; await wait(250); const png = `${tag}-scroll${i}.png`; await page.screenshot({ path: resolve(out, png), timeout: 25000 }); shots.push(png); }
  await page.evaluate(() => { if (window.__auditScroller) window.__auditScroller.scrollTop = 0; delete window.__auditScroller; });
  return { scrollable: true, found: true, height: box.height, view: box.view, reachedBottom: reached, shots };
}
async function session(engine) {
  const prefix = engine === 'fully' ? 'fully-' : ''; adb('reverse', 'tcp:4173', 'tcp:4173');
  let ctx;
  if (engine === 'fully') {
    adb('shell', 'am', 'start', '-n', 'de.ozerov.fully/.FullyActivity'); await wait(2500); const name = fullySocket(); if (!name) throw new Error('Fully does not answer');
    adb('forward', `tcp:${port}`, `localabstract:${name}`); browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); ctx = browser.contexts()[0]; page = ctx.pages().find(p => !p.url().startsWith('devtools')) ?? ctx.pages()[0]; if (!page) throw new Error('Fully shows no page'); fullyHome ??= page.url();
  } else {
    adb('forward', `tcp:${port}`, 'localabstract:chrome_devtools_remote');
    adb('shell', 'am', 'start', '--windowingMode', '1', '-a', 'android.intent.action.VIEW', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-d', `"${MARK}"`);
    await wait(3000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); ctx = browser.contexts()[0];
    for (let i = 0; i < 10 && !page; i++) { page = ctx.pages().find(p => p.url().includes('atom-audit')); if (!page) await wait(500); }
    page ??= await ctx.newPage(); await page.bringToFront();
  }
  page.setDefaultTimeout(25000); const cdp = await ctx.newCDPSession(page), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const state = () => page.evaluate(() => ({ w: innerWidth, h: innerHeight, type: screen.orientation?.type, fullscreen: !!document.fullscreenElement }));
  report[engine === 'fully' ? 'fullyEngine' : 'chrome'] = browser.version();
  if (engine === 'fully' && !done.has('live-done')) { // the real panel: look and measure, press nothing
    const base = fullyHome.split('#')[0]; for (const [name, hash, rootSel] of [['home', card.home, card.tileRoot], ['sheet', card.sheet, card.sheetRoot]]) { const tag = `live-${name}`; if (done.has(tag)) continue; errors.length = 0; const t0 = Date.now(); await page.goto(base + hash, { waitUntil: 'load' }); await page.waitForSelector(rootSel, { timeout: 25000 }); await wait(1500); const png = `${tag}.png`; await page.screenshot({ path: resolve(out, png), timeout: 25000 }); const issues = await layout(page, rootSel); await page.evaluate(axeSrc).catch(() => {}); const axe = await page.evaluate(sel => window.axe ? window.axe.run(document.querySelector(sel) ?? document.body, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }).then(r => [...r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') })), ...r.incomplete.filter(v => v.id === 'color-contrast').map(v => ({ id: 'color-contrast-incomplete', impact: 'undetermined', nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }))]) : null, rootSel); const scroll = name === 'sheet' ? await scrollThrough(tag, rootSel) : null; report.runs.push({ tag, png, live: true, screen: { how: 'as it stands', ...(await state()) }, loadMs: Date.now() - t0, issues, axe, errors: [...errors], scroll, sideScroll: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) }); done.add(tag); await save(); } done.add('live-done');
  }
  const openIt = async (scenario, theme, hash) => { await page.goto(`http://127.0.0.1:4173/?card=${cardName}&scenario=${scenario}&theme=${theme}&v=${++visit}${hash}`, { waitUntil: 'load' }); await page.waitForFunction(() => window.ready, null, { timeout: 25000 }); await page.waitForSelector('.at-shell', { timeout: 15000 }); };
  const screenSize = () => page.evaluate(() => ({ long: Math.max(screen.width, screen.height), short: Math.min(screen.width, screen.height), dpr: devicePixelRatio, touch: navigator.maxTouchPoints }));
  let deviceSize = null, overridden = false; // read once, before any swap: the size of the device as it really stands
  const turn = want => page.evaluate(async o => { try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); await screen.orientation.lock(o); return { ok: true }; } catch (e) { return { ok: false, why: String(e) }; } }, want);
  const fit = async want => { deviceSize ??= await state(); const deviceWay = deviceSize.h >= deviceSize.w ? 'portrait' : 'landscape'; if (engine === 'fully' && want === deviceWay) { if (overridden) { await page.setViewportSize({ width: deviceSize.w, height: deviceSize.h }); overridden = false; await wait(300); } return { how: 'real', by: 'the device stands this way', ...(await state()) }; } const got = await turn(want); await wait(got.ok ? 1200 : 200); const now = await state(), right = want === 'portrait' ? now.h >= now.w : now.w >= now.h; if (got.ok && right) return { how: 'real', ...now }; const s = await screenSize(); await page.setViewportSize(want === 'portrait' ? { width: s.short, height: s.long } : { width: s.long, height: s.short }); overridden = true; await wait(300); return { how: 'swapped', why: got.why ?? 'the screen did not turn', ...(await state()) }; };
  const measure = async (name, hash, rootSel, scenario, theme, want) => { const tag = `${prefix}${name}-${scenario}-${theme}-${want}`; if (done.has(tag)) return; errors.length = 0; const t0 = Date.now(); await openIt(scenario, theme, hash); const loadMs = Date.now() - t0; report.screen ??= await screenSize(); const screenNow = await fit(want), png = `${tag}.png`; await wait(500); await page.screenshot({ path: resolve(out, png), timeout: 25000 }); const issues = await layout(page, rootSel), small = name === 'sheet' ? await targets(page, rootSel) : []; await page.evaluate(axeSrc); const axe = await page.evaluate(sel => window.axe.run(document.querySelector(sel) ?? document.body, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }).then(r => [...r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') })), ...r.incomplete.filter(v => v.id === 'color-contrast').map(v => ({ id: 'color-contrast-incomplete', impact: 'undetermined', nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }))]), rootSel); const scroll = name === 'sheet' ? await scrollThrough(tag, rootSel) : null; report.runs.push({ tag, png, orientation: want, screen: screenNow, loadMs, issues, smallTargets: small, axe, errors: [...errors], scroll, sideScroll: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) }); done.add(tag); await save(); };
  for (const want of ['portrait', 'landscape']) { for (const scenario of Object.keys(card.scenarios)) await measure('sheet', card.sheet, card.sheetRoot, scenario, 'light', want); for (const scenario of (card.darkScenarios ?? ['calm', 'wet', 'bad'])) if (card.scenarios[scenario]) await measure('sheet', card.sheet, card.sheetRoot, scenario, 'dark', want); for (const scenario of (card.homeScenarios ?? ['calm', 'wet'])) if (card.scenarios[scenario]) await measure('home', card.home, card.tileRoot, scenario, 'light', want); }
  // real presses with a real touch event: everything stays inside the preview
  for (const [scenario, s] of Object.entries(card.scenarios)) if (s.press) for (const want of ['portrait', 'landscape']) { const tag = `${prefix}press-${scenario}-${want}`; if (done.has(tag)) continue; await openIt(scenario, 'light', card.sheet); const screenNow = await fit(want); await page.evaluate(() => window.atomPreview.setAccept(true)); const b = await page.$(card.actionButton), sent = [], png = `${tag}.png`; if (b) { await b.scrollIntoViewIfNeeded(); const box = await b.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(700); sent.push(...await page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => ({ d: c.domain, s: c.service, ...c.data })))); await page.screenshot({ path: resolve(out, png), timeout: 25000 }); } report.runs.push({ tag, png, orientation: want, screen: screenNow, button: !!b, sent }); done.add(tag); await save(); }
}
async function leave(engine) { try { await page?.evaluate(async () => { try { screen.orientation.unlock(); await document.exitFullscreen(); } catch {} }); } catch {} if (engine === 'fully') { try { if (fullyHome) await page?.goto(fullyHome, { waitUntil: 'commit', timeout: 10000 }); } catch {} } else { try { await page?.close(); } catch {} } try { await browser?.close(); } catch {} page = browser = undefined; }
// the kiosk first: that is what the owner looks at. Chrome adds the really turned screen. A phone that does not keep Fully running (the Open uses the HA app) is not sent into it.
const kiosk = fullySocket() ? 'fully' : fullyRuns() ? 'eyes' : null, engines = [...(kiosk ? [kiosk] : []), ...(FULLY_ONLY ? [] : ['chrome'])]; report.engines = engines;
for (const engine of engines) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try { if (engine === 'eyes') await kioskByEye(); else await session(engine); delete report.failed; break; } catch (e) { report.failed = `${engine}: ${String(e?.message ?? e).slice(0, 300)}`; report.drops++; await save(); await leave(engine); if (attempt === ATTEMPTS || !(await backOnline())) break; await wait(2000); }
  }
  await leave(engine);
}
// the kiosk ends where it was, even if the last connection failed
const kioskHome = fullyHome ?? (kiosk === 'eyes' ? panelUrl && `${panelUrl}${card.home}` : null); if (kioskHome) try { adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-n', 'de.ozerov.fully/.FullyActivity', '-d', `"${kioskHome}"`); } catch {}
report.summary = { runs: report.runs.length, realTurn: report.runs.filter(r => r.screen?.how === 'real').length, swapped: report.runs.filter(r => r.screen?.how === 'swapped').length, issues: report.runs.filter(r => r.issues?.length).length, smallTargets: report.runs.filter(r => r.smallTargets?.length).length, axe: report.runs.filter(r => r.axe?.some(x => x.impact !== 'undetermined')).length, axeContrastUndetermined: report.runs.filter(r => r.axe?.some(x => x.impact === 'undetermined')).length, errors: report.runs.filter(r => r.errors?.length).length, sideScroll: report.runs.filter(r => r.sideScroll).length, presses: report.runs.filter(r => r.sent?.length === 1).length, live: report.runs.filter(r => r.live).length, scrolled: report.runs.filter(r => r.scroll?.scrollable).length, notToBottom: report.runs.filter(r => r.scroll?.scrollable && !r.scroll.reachedBottom).length, scrollerNotFound: report.runs.filter(r => r.scroll && !r.scroll.found).length, fully: report.runs.filter(r => r.tag.startsWith('fully-')).length, kioskByEye: report.runs.filter(r => r.kiosk).length, slowestLoadMs: Math.max(0, ...report.runs.map(r => r.loadMs ?? 0)) };
try { adb('forward', '--remove', `tcp:${port}`); adb('reverse', '--remove', 'tcp:4173'); const before = report.foregroundBefore; if (before === 'de.ozerov.fully') adb('shell', 'am', 'start', '-n', 'de.ozerov.fully/.FullyActivity'); else adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await wait(800); report.foregroundAfter = focus(); } catch (e) { report.restoreFailed = String(e?.message ?? e).slice(0, 200); }
await save(); console.log(JSON.stringify({ serial, model: report.model, screen: report.screen, summary: report.summary, drops: report.drops, failed: report.failed, foregroundBefore: report.foregroundBefore, foregroundAfter: report.foregroundAfter }));
process.exit(report.failed ? 1 : 0);
