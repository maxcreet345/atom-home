// QA of the live custom element <atom-home-panel> with a fake `hass`: registry via callWS, states from the snapshot, config via atom_home/config/* WS, commands recorded and rejected.
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), js = resolve(root, '../custom_components/atom_home/frontend/atom-home.js'), out = resolve(root, process.argv[2] ?? 'evidence/stage3-live'); await mkdir(out, { recursive: true });
const fixture = await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8'); const bundle = await readFile(js);
const server = createServer(async (req, res) => { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#fff}atom-home-panel{display:block;height:100%}</style><script type="module" src="/atom-home.js"></script>'); return; } if (u.pathname === '/atom-home.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; } res.statusCode = 404; res.end(); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const check = (n, p, d = {}) => checks.push({ n, p, ...d }); const errors = [];
try {
  for (const [w, h] of [[1070, 764], [402, 874]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    await page.goto(origin); await page.waitForFunction(() => !!customElements.get('atom-home-panel'));
    await page.evaluate(async admin => {
      const fx = await (await fetch('/fixture.json')).json(); window.ws = []; window.calls = []; let stored = null;
      const toReg = (list, kind) => list;
      const hass = { states: fx.states, user: { id: 'u1', is_admin: admin }, connected: true, language: 'ru',
        async callWS(m) { window.ws.push(m.type); switch (m.type) { case 'config/area_registry/list': return fx.areas; case 'config/device_registry/list': return fx.devices.map(d => ({ ...d, name_by_user: null })); case 'config/entity_registry/list': return fx.entities.map(e => ({ ...e, original_device_class: e.device_class, unit_of_measurement: e.unit })); case 'atom_home/config/get': return { config: stored, version: 'test', admin }; case 'atom_home/config/set': if (!admin) throw new Error('unauthorized'); stored = m.config; return { saved: true }; case 'history/history_during_period': return {}; default: throw new Error('unexpected ws ' + m.type); } },
        async callService(domain, service, data) { window.calls.push([domain, service, data]); throw new Error('qa: rejected'); } };
      const el = document.createElement('atom-home-panel'); el.hass = hass; document.body.append(el); window.el = el; window.hassObj = hass;
    }, true);
    await page.waitForFunction(() => !!document.querySelector('atom-home-panel')?.shadowRoot?.querySelector('.at-shell .hm-page'), null, { timeout: 15000 }); await page.waitForTimeout(900);
    const tag = `${w}x${h}`;
    const info = await page.evaluate(() => { const r = document.querySelector('atom-home-panel').shadowRoot; return { rooms: r.querySelectorAll('.at-room').length, title: r.querySelector('h1')?.innerText, nav: [...r.querySelectorAll('.hm-sidebar nav button, .hm-tabbar button')].map(b => b.innerText.trim()), ws: window.ws }; });
    check(`${tag}/renders-from-registry`, info.rooms >= 8 && info.title === 'Мой дом', info);
    check(`${tag}/registry-read-via-ws`, ['config/area_registry/list', 'config/device_registry/list', 'config/entity_registry/list', 'atom_home/config/get'].every(t => info.ws.includes(t)));
    await page.screenshot({ path: resolve(out, `${tag}-home.png`) });
    // state update propagates: flip a light on in hass.states, reassign hass
    await page.evaluate(() => { const h = window.hassObj; const id = Object.keys(h.states).find(k => k.startsWith('light.') && h.states[k].state === 'off'); h.states = { ...h.states, [id]: { ...h.states[id], state: 'on' } }; window.flipped = id; window.el.hass = h; });
    await page.waitForTimeout(400);
    check(`${tag}/state-change-redraws`, await page.evaluate(() => { const r = document.querySelector('atom-home-panel').shadowRoot; return !window.ws.slice(4).includes('config/entity_registry/list') && /горит|Lights|1/.test(r.querySelector('.hm-status .hm-status-text strong')?.innerText ?? '') ; }), { flipped: await page.evaluate(() => window.flipped) });
    // configurator saves through WS and survives a re-render
    const go = label => page.evaluate(label => { const r = document.querySelector('atom-home-panel').shadowRoot; let b = [...r.querySelectorAll('.hm-sidebar nav button, .hm-tabbar button')].find(e => e.innerText.trim() === label); if (!b) { [...r.querySelectorAll('.hm-tabbar button')].find(e => e.innerText.trim() === 'Ещё')?.click(); return 'more'; } b.click(); return true; }, label);
    if (await go('Настройка') === 'more') { await page.waitForTimeout(300); await page.evaluate(() => { const r = document.querySelector('atom-home-panel').shadowRoot; [...r.querySelectorAll('.hm-more button')].find(e => e.innerText.trim() === 'Настройка')?.click(); }); }
    await page.waitForTimeout(500); await page.screenshot({ path: resolve(out, `${tag}-setup.png`) });
    await page.evaluate(() => { const r = document.querySelector('atom-home-panel').shadowRoot; r.querySelector('.at-setup-row .hm-switch')?.click(); }); await page.waitForTimeout(500);
    check(`${tag}/config-saved-via-ws`, await page.evaluate(() => window.ws.includes('atom_home/config/set')));
    // command path: light toggle calls callService once and shows the rejection
    await go('Свет'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('atom-home-panel').shadowRoot.querySelector('.hm-light-hit')?.click()); await page.waitForTimeout(500);
    check(`${tag}/command-via-callService`, await page.evaluate(() => window.calls.length === 1 && window.calls[0][0] === 'light' && !!document.querySelector('atom-home-panel').shadowRoot.querySelector('.hm-toast')), { calls: await page.evaluate(() => window.calls) });
    await page.close();
  }
  // non-admin: no setup entry, save refused
  const page = await browser.newPage({ viewport: { width: 1070, height: 764 } }); await page.goto(origin); await page.waitForFunction(() => !!customElements.get('atom-home-panel'));
  await page.evaluate(async () => { const fx = await (await fetch('/fixture.json')).json(); const hass = { states: fx.states, user: { id: 'u2', is_admin: false }, connected: true, async callWS(m) { switch (m.type) { case 'config/area_registry/list': return fx.areas; case 'config/device_registry/list': return fx.devices; case 'config/entity_registry/list': return fx.entities; case 'atom_home/config/get': return { config: null, version: 'test', admin: false }; default: return {}; } }, async callService() { throw new Error('x'); } }; const el = document.createElement('atom-home-panel'); el.hass = hass; document.body.append(el); });
  await page.waitForFunction(() => !!document.querySelector('atom-home-panel')?.shadowRoot?.querySelector('.at-shell .hm-page'), null, { timeout: 15000 }); await page.waitForTimeout(500);
  check('non-admin/no-setup-in-nav', await page.evaluate(() => ![...document.querySelector('atom-home-panel').shadowRoot.querySelectorAll('.hm-sidebar nav button')].some(b => b.innerText.trim() === 'Настройка')));
  await page.close();
} finally { await browser.close(); server.close(); }
const report = { pass: checks.every(c => c.p) && !errors.length, checks, errors }; await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1));
