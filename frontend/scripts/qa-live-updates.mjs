// The live entry under a real HA rhythm: `hass` is a NEW object several times a second. The preview host never changes, so only this
// catches work restarted on every update (found on 05.11.2026: the 24-hour chart blinked and every panel re-queried HA on every update).
// usage: node scripts/qa-live-updates.mjs   (needs `npm run build`)
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
// ATOM_BUNDLE: a folder with another build of the live entry (`npx vite build --config vite.live.config.ts --outDir <folder>`), so a working tree can be checked without rewriting the tracked bundle
const root = resolve(import.meta.dirname, '..'), bundle = process.env.ATOM_BUNDLE ? resolve(process.env.ATOM_BUNDLE) : resolve(root, '../custom_components/atom_home/frontend');
const fx = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8'));
const config = JSON.parse(await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8'));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer(async (req, res) => { const p = new URL(req.url, 'http://l').pathname; try { if (p === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module" src="/atom-home.js"></script>'); return; } if (p === '/fx.json') { res.end(JSON.stringify({ fx, config })); return; } res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(resolve(bundle, '.' + p))); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
const b = await chromium.launch(); let failed = 0; const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? '✔' : '✘'} ${name} — ${JSON.stringify(info)}`); };
const page = await (await b.newContext({ viewport: { width: 1070, height: 764 } })).newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(origin); await page.waitForFunction(() => customElements.get('atom-home-panel'));
const r = await page.evaluate(async () => {
  const { fx, config } = await (await fetch('/fx.json')).json(); const calls = {}; const sleep = ms => new Promise(s => setTimeout(s, ms));
  const callWS = async m => { calls[m.type] = (calls[m.type] ?? 0) + 1; switch (m.type) { case 'config/area_registry/list': return fx.areas; case 'config/device_registry/list': return fx.devices; case 'config/entity_registry/list': return fx.entities; case 'atom_home/config/get': return { config, version: 'qa', admin: true, revision: 1 }; case 'atom_home/automations': return []; case 'history/history_during_period': { await sleep(150); const now = Date.now() / 1000, out = {}; for (const id of m.entity_ids) out[id] = Array.from({ length: 30 }, (_, i) => ({ s: String(400 + i * 3), lu: now - (30 - i) * 600 })); return out; } default: return null; } };
  let states = fx.states; const co2 = Object.keys(states).filter(id => states[id].attributes?.device_class === 'carbon_dioxide');
  const hass = () => ({ states, user: { id: 'qa', is_admin: true }, connected: true, language: 'ru', callWS, callService: async () => { throw new Error('qa: no commands'); }, connection: {} });
  const el = document.createElement('atom-home-panel'); document.body.append(el); el.style.height = '764px'; el.hass = hass(); const root = el.shadowRoot;
  for (let i = 0; i < 100 && !root.querySelector('.at-shell'); i++) await sleep(100);
  const tick = n => { const next = { ...states }; for (const id of co2) next[id] = { ...states[id], state: String(500 + n) }; states = next; el.hass = hass(); };
  // on the home screen, no sheet open
  const before = { ...calls }; for (let n = 0; n < 25; n++) { tick(n); await sleep(200); }
  const idle = (calls['atom_home/automations'] ?? 0) - (before['atom_home/automations'] ?? 0);
  const tileValue = /524/.test(root.querySelector('.at-air-tile')?.textContent ?? ''); // the CO₂ on the home screen, after the 25 updates above
  // a sensor sheet open, with the chart. Since 1.17 the home screen has the Air tile instead of a CO₂ tile with a chart, so the sensor is found in Systems and opened over the home screen.
  location.hash = '#systems'; await sleep(500);
  const sensorKey = [...root.querySelectorAll('[data-device-key]')].find(x => /°C/.test(x.textContent))?.dataset.deviceKey; location.hash = `#home?device=${encodeURIComponent(sensorKey)}`; await sleep(800);
  const open = { ...calls }; let flips = 0, last = null; const heights = new Set(); const iv = setInterval(() => { const on = !!root.querySelector('.ah-history svg path'); if (on !== last) { flips++; last = on; } const s = root.querySelector('.hm-sheet,[role=dialog]'); if (s) heights.add(Math.round(s.getBoundingClientRect().height)); }, 20);
  for (let n = 0; n < 25; n++) { tick(100 + n); await sleep(200); } clearInterval(iv);
  const sheet = root.querySelector('.hm-sheet,[role=dialog]');
  return { tileValue, idle, history: (calls['history/history_during_period'] ?? 0) - (open['history/history_during_period'] ?? 0), autoOpen: (calls['atom_home/automations'] ?? 0) - (open['atom_home/automations'] ?? 0), flips, heights: [...heights], chart: !!root.querySelector('.ah-history svg path'), sheet: sheet ? sheet.innerText.split('\n').slice(0, 3).join(' / ') : null, value: /624/.test(root.querySelector('.at-shell').textContent) };
});
check('home screen: no automations re-query during 25 updates', r.idle === 0, { queries: r.idle });
check('home screen: the Air tile shows the fresh CO₂', r.tileValue, { sought: 524 });
check('open sheet: no history re-query during 25 updates', r.history === 0, { queries: r.history });
check('open sheet: no automations re-query during 25 updates', r.autoOpen === 0, { queries: r.autoOpen });
check('open sheet: the chart stays on screen, no blinking', r.chart && r.flips <= 1, { flips: r.flips, chart: r.chart });
check('open sheet: the height does not jump', r.heights.length === 1, { heights: r.heights, sheet: r.sheet });
check('fresh values still reach the screen through the same host', r.value, { sought: 624 });

// ===== Audit 2026-11-09: the settings guard, the loads that retry by themselves, one render per burst, the registry by events =====
{
  const page2 = await (await b.newContext({ viewport: { width: 1070, height: 764 } })).newPage(); page2.on('pageerror', e => errors.push(String(e)));
  await page2.goto(origin); await page2.waitForFunction(() => customElements.get('atom-home-panel'));
  const g = await page2.evaluate(async () => {
    const { fx, config } = await (await fetch('/fx.json')).json(); const calls = {}, sets = [], subs = {}; const sleep = ms => new Promise(s => setTimeout(s, ms)); const world = { configDown: true, registryDown: true, revision: 5, connected: true };
    const callWS = async m => { calls[m.type] = (calls[m.type] ?? 0) + 1; switch (m.type) {
      case 'config/area_registry/list': return fx.areas; case 'config/device_registry/list': return fx.devices;
      case 'config/entity_registry/list': if (world.registryDown) throw { code: 'unknown_error', message: 'registry is not ready' }; return fx.entities;
      case 'atom_home/config/get': if (world.configDown) throw { code: 'unknown_error', message: 'storage is not ready' }; return { config, version: 'qa', admin: true, revision: world.revision };
      case 'atom_home/config/set': sets.push({ expected: m.expected_revision, name: m.config?.home?.name, language: m.config?.home?.language }); return { saved: true, revision: ++world.revision };
      case 'atom_home/automations': return []; default: return null; } };
    let states = fx.states;
    const connection = { subscribeEvents: async (cb, type) => { subs[type] = cb; return () => { delete subs[type]; }; } };
    const hass = () => ({ states, user: { id: 'qa', is_admin: true }, connected: world.connected, language: 'en', callWS, callService: async () => { throw { code: 'service_validation_error', message: 'qa: refused' }; }, connection });
    const el = document.createElement('atom-home-panel'); document.body.append(el); el.style.height = '764px'; el.hass = hass(); const root = el.shadowRoot; const out = {};
    const until = async (f, ms = 8000) => { for (let i = 0; i < ms / 50; i++) { if (f()) return true; await sleep(50); } return false; };
    // 1. the registry will not come: the skeleton says so in the language Home Assistant speaks, and the read is tried again by itself
    await until(() => (calls['config/entity_registry/list'] ?? 0) >= 1); await sleep(100);
    out.failSkeleton = root.querySelector('.hm-skeleton p')?.textContent ?? null; out.rawError = /registry:|unknown_error|not ready/.test(root.textContent);
    const before = calls['config/entity_registry/list']; for (let i = 0; i < 10; i++) { el.hass = hass(); await sleep(20); } out.noRetryStorm = calls['config/entity_registry/list'] - before; // a state update is not a reason to try again
    world.registryDown = false; out.registryCameBack = await until(() => !!root.querySelector('.at-shell .hm-page')); await sleep(200);
    // 2. the settings will not come: the house is shown on the factory set, says so, and saves NOTHING
    out.pendingNote = root.querySelector('.at-config-pending')?.textContent ?? null; out.titleWhilePending = root.querySelector('.hm-head h1')?.textContent;
    root.querySelector('.at-lang .at-pill-btn')?.click(); await sleep(150); [...root.querySelectorAll('.at-lang-menu button')].find(x => /Română/.test(x.textContent))?.click(); await sleep(400);
    out.setsWhilePending = sets.length; out.toastWhilePending = root.querySelector('.hm-toast')?.textContent ?? null; out.langAfterRefusedSave = root.querySelector('.at-shell')?.getAttribute('lang');
    // 3. the settings arrive (the read is retried within seconds): the note goes, the real house is shown, a save carries the revision it read
    world.configDown = false; out.configCameBack = await until(() => !root.querySelector('.at-config-pending') && root.querySelector('.hm-head h1')?.textContent === config.home.name, 12000);
    root.querySelector('.hm-toast')?.click(); root.querySelector('.at-lang .at-pill-btn')?.click(); await sleep(150); [...root.querySelectorAll('.at-lang-menu button')].find(x => /English/.test(x.textContent))?.click(); await until(() => sets.length > 0, 3000);
    out.saveAfterLoad = sets[0] ?? null;
    // 4. one render for a burst of state changes; none for a `hass` that changed nothing the panel shows
    await sleep(300); let draws = 0; const draw = el.draw.bind(el); el.draw = () => { draws++; draw(); };
    const co2 = Object.keys(states).filter(id => states[id].attributes?.device_class === 'carbon_dioxide'); location.hash = '#home'; await sleep(300);
    const t0 = performance.now(); for (let n = 0; n < 20; n++) { const next = { ...states }; for (const id of co2) next[id] = { ...states[id], state: String(700 + n) }; states = next; el.hass = hass(); } out.burstSyncMs = Math.round(performance.now() - t0);
    await sleep(400); out.burstDraws = draws; out.burstShown = /719/.test(root.querySelector('.at-air-tile')?.textContent ?? '');
    draws = 0; for (let n = 0; n < 10; n++) el.hass = hass(); await sleep(300); out.sameStateDraws = draws;
    // 5. the registry is read again when Home Assistant says it changed (a burst of events is one read), not on a five-minute timer
    out.subscribed = Object.keys(subs).sort(); const r0 = calls['config/entity_registry/list'];
    for (let i = 0; i < 5; i++) subs['entity_registry_updated']?.({ event_type: 'entity_registry_updated' }); subs['device_registry_updated']?.({}); await sleep(1700); out.readsAfterEvents = calls['config/entity_registry/list'] - r0;
    // 6. back after a lost connection: the registry and the settings are read afresh, once
    const r1 = calls['config/entity_registry/list'], c1 = calls['atom_home/config/get']; world.connected = false; el.hass = hass(); await sleep(300); out.offlineBadge = root.querySelector('.hm-head .hm-badge.tone-danger')?.textContent ?? null; out.offlineSaid = [...root.querySelectorAll('.at-shell > [aria-live="assertive"] .at-vh')].map(x => x.textContent);
    world.connected = true; el.hass = hass(); await sleep(600); out.reconnectReads = { registry: calls['config/entity_registry/list'] - r1, config: calls['atom_home/config/get'] - c1 }; out.backSaid = root.querySelector('.at-shell > [aria-live="polite"]')?.textContent ?? null;
    // 7. a refusal the way hass.callService sends it is a sentence
    location.hash = '#lights'; await sleep(400); root.querySelector('.ah-tile.kind-light .ah-tile-hit:not([disabled])')?.click(); await sleep(400); out.refusal = root.querySelector('.hm-toast')?.textContent ?? null;
    return out;
  });
  check('registry read fails: the skeleton says «retrying» in HA\'s language, no raw error', g.failSkeleton === 'Could not load the home. Retrying…' && !g.rawError, { skeleton: g.failSkeleton, rawError: g.rawError });
  check('registry read fails: state updates do not make a retry storm, the read comes back by itself', g.noRetryStorm === 0 && g.registryCameBack, { extraReads: g.noRetryStorm, cameBack: g.registryCameBack });
  check('settings read fails: the panel says the settings are not loaded', /not loaded|не загружены|nu sunt încă/.test(g.pendingNote ?? ''), { note: g.pendingNote, title: g.titleWhilePending });
  check('settings read fails: nothing is saved over the house\'s settings', g.setsWhilePending === 0 && /not loaded|не загружены|nu sunt încă/.test(g.toastWhilePending ?? '') && g.langAfterRefusedSave !== 'ro', { sets: g.setsWhilePending, toast: g.toastWhilePending, lang: g.langAfterRefusedSave });
  check('settings arrive: the note goes, the real house is shown, a save carries the revision that was read', g.configCameBack && g.saveAfterLoad?.expected === 5 && g.saveAfterLoad?.language === 'en' && g.saveAfterLoad?.name === config.home.name, { cameBack: g.configCameBack, save: g.saveAfterLoad });
  check('a burst of 20 state changes is one render, and it shows the last value', g.burstDraws === 1 && g.burstShown && g.burstSyncMs < 50, { draws: g.burstDraws, shown: g.burstShown, syncMs: g.burstSyncMs });
  check('a new hass with the same states draws nothing', g.sameStateDraws === 0, { draws: g.sameStateDraws });
  check('the registry is re-read on Home Assistant\'s events, a burst is one read', g.subscribed.includes('entity_registry_updated') && g.subscribed.includes('device_registry_updated') && g.subscribed.includes('area_registry_updated') && g.readsAfterEvents === 1, { subscribed: g.subscribed, reads: g.readsAfterEvents });
  check('reconnect: the loss is said once, the registry and the settings are read afresh once, the return is said', g.offlineBadge !== null && g.offlineSaid.length === 1 && g.reconnectReads.registry === 1 && g.reconnectReads.config === 1 && !!g.backSaid, { badge: g.offlineBadge, said: g.offlineSaid, reads: g.reconnectReads, back: g.backSaid });
  check('a refused command ({ code, message } of hass.callService) is a sentence, never «[object Object]»', /qa: refused/.test(g.refusal ?? '') && !/object Object/.test(g.refusal ?? ''), { toast: g.refusal });
}
check('no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
await b.close(); server.close(); console.log(`${failed ? 'FAILED ' + failed : 'all passed'}`); process.exit(failed ? 1 : 0);
