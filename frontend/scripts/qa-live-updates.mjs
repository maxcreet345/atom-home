// The live entry under a real HA rhythm: `hass` is a NEW object several times a second. The preview host never changes, so only this
// catches work restarted on every update (found on 05.11.2026: the 24-hour chart blinked and every panel re-queried HA on every update).
// usage: node scripts/qa-live-updates.mjs   (needs `npm run build`)
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), bundle = resolve(root, '../custom_components/atom_home/frontend');
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
  // a sensor sheet open, with the chart
  const air = [...root.querySelectorAll('.ah-tile-hit')].find(x => /ppm/.test(x.textContent)); air.click(); await sleep(500);
  const open = { ...calls }; let flips = 0, last = null; const heights = new Set(); const iv = setInterval(() => { const on = !!root.querySelector('.ah-history svg path'); if (on !== last) { flips++; last = on; } const s = root.querySelector('.hm-sheet,[role=dialog]'); if (s) heights.add(Math.round(s.getBoundingClientRect().height)); }, 20);
  for (let n = 0; n < 25; n++) { tick(100 + n); await sleep(200); } clearInterval(iv);
  const sheet = root.querySelector('.hm-sheet,[role=dialog]');
  return { idle, history: (calls['history/history_during_period'] ?? 0) - (open['history/history_during_period'] ?? 0), autoOpen: (calls['atom_home/automations'] ?? 0) - (open['atom_home/automations'] ?? 0), flips, heights: [...heights], chart: !!root.querySelector('.ah-history svg path'), sheet: sheet ? sheet.innerText.split('\n').slice(0, 3).join(' / ') : null, value: /624/.test(root.querySelector('.at-shell').textContent) };
});
check('home screen: no automations re-query during 25 updates', r.idle === 0, { queries: r.idle });
check('open sheet: no history re-query during 25 updates', r.history === 0, { queries: r.history });
check('open sheet: no automations re-query during 25 updates', r.autoOpen === 0, { queries: r.autoOpen });
check('open sheet: the chart stays on screen, no blinking', r.chart && r.flips <= 1, { flips: r.flips, chart: r.chart });
check('open sheet: the height does not jump', r.heights.length === 1, { heights: r.heights, sheet: r.sheet });
check('fresh values still reach the screen through the same host', r.value, { sought: 624 });
check('no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
await b.close(); server.close(); console.log(`${failed ? 'FAILED ' + failed : 'all passed'}`); process.exit(failed ? 1 : 0);
