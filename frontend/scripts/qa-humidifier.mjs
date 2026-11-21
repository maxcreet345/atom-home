// The humidifier card (src/appliances/humidifier.*) on the Criuleni snapshot of 21.11.2026 and its settings, inside a shadow root as in HA,
// a phone (412×915) and a tablet (1280×800), light and dark:
//   - the sheet in every state: on (holding 60 %), off, no water, the plug off (the snapshot as it is), no connection; its tile on Home with its line;
//   - − / + : a burst of taps sends ONE set_humidity with the last value; nothing while the humidifier or the house is offline;
//   - «Нет воды» as a warning on the sheet and as the tile's line; the catalog's «Увлажнители» and the card's form with its preview;
//   - no command reaches a device except the burst pressed on purpose against the preview host. usage: node scripts/qa-humidifier.mjs [out-dir]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/humidifier'); await mkdir(out, { recursive: true });
const live = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-registry-live-20261121.json'), 'utf8'));
const houseConfig = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-config-20261121.json'), 'utf8'));
const dev = live.devices.find(d => d.model === 'deerma.humidifier.jsq2w');
const own = s => live.entities.find(e => e.device_id === dev.id && s.test(e.entity_id))?.entity_id;
const B = { humidifier: own(/^humidifier\./), humidity: own(/_humidity$/), waterShortage: own(/_water_shortage$/), tankLifted: own(/_tank_installed$/), fault: own(/_fault$/), fanLevel: own(/_fan_level$/), temperature: own(/_temperature$/), indicator: own(/_indicator_light$/), buzzer: own(/_buzzer$/) };
const PLUG = { plug: 'switch.living_humidifier_plug', plugPower: 'sensor.living_humidifier_plug_power' };
/** a state of the house: the snapshot with the humidifier as the scenario says */
function fixture(v) {
  const r = structuredClone(live), set = (id, state, attrs = {}) => { r.states[id] = { ...r.states[id], state, attributes: { ...r.states[id].attributes, ...attrs } }; };
  if (v === 'plugOff' || v === 'offline') return r; // as it was on 21.11: the plug off, everything of the humidifier unavailable
  const on = v !== 'off';
  set(B.humidifier, on ? 'on' : 'off', { humidity: 60, current_humidity: 51, mode: v === 'on' ? 'Constant Humidity' : 'None', available_modes: ['Off', 'None', 'Constant Humidity'] });
  set(B.humidity, '52'); set(B.temperature, '22.4'); set(B.waterShortage, v === 'noWater' ? 'on' : 'off'); set(B.tankLifted, 'off'); set(B.fault, v === 'noWater' ? 'Insufficient Water' : 'No Faults');
  set(B.fanLevel, v === 'on' ? 'Level4' : 'Level2'); set(B.buzzer, 'on'); set(B.indicator, 'on'); set(PLUG.plug, 'on'); set(PLUG.plugPower, on && v !== 'noWater' ? '24.6' : '0.8');
  return r;
}
const config = (theme, plug, inst = true) => ({ ...houseConfig, home: { ...houseConfig.home, theme }, profileInstances: !inst ? {} : { hu: { profileId: 'xiaomi.humidifier2', profileVersion: '1.0.0', deviceId: dev.id, bindings: { ...B, ...(plug ? PLUG : {}) }, placement: ['home', 'room'] } } });
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const errors = []; const missing = new Set();
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d)); };
const R = 'document.getElementById("root").shadowRoot';
const STATES = ['on', 'off', 'noWater', 'plugOff', 'offline'];
try {
  for (const [vp, size] of [['phone', { width: 412, height: 915 }], ['tablet', { width: 1280, height: 800 }]]) {
    const page = await (await browser.newContext({ viewport: size, deviceScaleFactor: 2 })).newPage(); page.on('response', r => { if (r.status() === 404) missing.add(new URL(r.url()).pathname); }); page.on('pageerror', e => errors.push(`${vp}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${vp} console: ${m.text()}`); });
    const open = async (hash, { theme = 'light', v = 'on', plug = v !== 'offline', inst = true } = {}) => { await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
      await page.evaluate(async ([cfg, fx]) => { localStorage.clear(); localStorage.setItem('atom-home:config', JSON.stringify(cfg)); await window.mountPreview(document.getElementById('root'), fx); }, [config(theme, plug, inst), fixture(v)]); await page.waitForTimeout(900); };
    const shot = n => page.screenshot({ path: resolve(out, `${vp}-${n}.png`) });
    const log = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws'));
    const q = (sel, fn = 'x => !!x') => page.evaluate(`(${fn})(${R}.querySelector(${JSON.stringify(sel)}))`);
    // 1. the sheet in every state, both themes; its tile on Home
    for (const theme of ['light', 'dark']) for (const v of STATES) {
      await open('#home?device=p:hu', { theme, v }); await page.waitForSelector('.at-hu-sheet', { timeout: 5000 }).catch(() => null);
      const s = await page.evaluate(`(() => { const r = ${R}, el = r.querySelector('.at-hu-sheet'); if (!el) return null; const sh = r.querySelector('.hm-sheet'); return { phase: el.dataset.phase, status: r.querySelector('.at-hu-hero .at-kt-status')?.textContent, num: r.querySelector('.at-hu-num b')?.textContent, warn: r.querySelector('.at-hu-warn')?.dataset.warn ?? null, warnText: r.querySelector('.at-hu-warn')?.textContent ?? '', power: r.querySelector('[data-action="power"],[data-action="plug-on"]')?.textContent ?? null, stepOff: [...r.querySelectorAll('.at-hu-target .hm-round')].every(b => b.disabled), modes: r.querySelectorAll('.at-hu-mode').length, modeOn: r.querySelector('.at-hu-mode.is-on')?.textContent ?? null, overflow: sh ? sh.scrollWidth > sh.clientWidth + 1 : null, clipped: [...el.querySelectorAll('.at-kt-card, .at-hu-hero, .at-hu-warn, button')].filter(c => { const a = c.getBoundingClientRect(), b = el.getBoundingClientRect(); return a.width && (a.right > b.right - 8 || a.left < b.left + 8); }).map(c => c.className).slice(0, 3) }; })()`);
      check(`${vp}:${theme}:${v}:sheet-drawn`, !!s && s.overflow === false && !s.clipped.length, s ?? {});
      if (s) {
        if (v === 'on') check(`${vp}:${theme}:on`, s.phase === 'on' && /Держит 60/.test(s.status) && s.num === '52' && !s.stepOff && s.modes === 4 && s.modeOn === 'Авто' && /Выключить/.test(s.power) && !s.warn, s);
        if (v === 'off') check(`${vp}:${theme}:off`, s.phase === 'off' && s.status === 'Выключен' && /Включить/.test(s.power) && s.modeOn === 'Средне' && !s.warn, s);
        if (v === 'noWater') check(`${vp}:${theme}:noWater-warning`, s.warn === 'noWater' && /Нет воды/.test(s.warnText), s);
        if (v === 'plugOff') check(`${vp}:${theme}:plugOff`, s.phase === 'plugOff' && /Розетка увлажнителя выключена/.test(s.status) && /Включить розетку/.test(s.power) && s.stepOff && s.num === '—', s);
        if (v === 'offline') check(`${vp}:${theme}:offline`, s.phase === 'offline' && /Нет связи/.test(s.status) && s.power === null && s.stepOff, s);
      }
      await shot(`sheet-${v}-${theme}`);
      // the tile on Home
      await open('#home', { theme, v });
      const tile = await page.evaluate(`(() => { const el = ${R}.querySelector('[data-device-key="p:hu"]'); if (!el) return null; el.scrollIntoView({ block: 'center' }); return { line: el.querySelector('.ah-tile-text small')?.textContent ?? '', on: el.classList.contains('is-on') }; })()`);
      const want = { on: /52\s%\s→\s60\s%/, off: /Выключен · 52\s%/, noWater: /Нет воды/, plugOff: /Розетка выключена/, offline: /Нет связи/ }[v];
      check(`${vp}:${theme}:${v}:tile-line`, !!tile && want.test(tile.line), tile ?? {});
      await page.waitForTimeout(250); await shot(`tile-${v}-${theme}`);
      check(`${vp}:${theme}:${v}:no-commands`, (await log()).length === 0, { log: await log() });
    }
    // 2. − / + : a burst is one command; the house offline sends nothing
    await open('#home?device=p:hu', { v: 'on' }); await page.evaluate(() => window.atomPreview.setAccept(true));
    for (let i = 0; i < 4; i++) { await page.evaluate(`${R}.querySelector('.at-hu-target [data-step="1"]').click()`); await page.waitForTimeout(90); }
    const shown = await q('.at-hu-target .at-kt-stepper b', 'x => x?.textContent');
    check(`${vp}:burst-shows-draft`, shown === '64%', { shown });
    check(`${vp}:burst-nothing-before-pause`, (await log()).length === 0);
    await page.waitForTimeout(1200);
    let l = await log(); check(`${vp}:burst-one-command`, l.length === 1 && l[0].domain === 'humidifier' && l[0].service === 'set_humidity' && l[0].data.humidity === 64 && l[0].data.entity_id === B.humidifier, { l });
    await page.evaluate(`${R}.querySelector('.at-hu-mode[data-level="1"]').click()`); await page.waitForTimeout(300);
    l = await log(); check(`${vp}:mode-sends-select`, l.length === 2 && l[1].domain === 'select' && l[1].data.option === 'Level1', { l: l.slice(1) });
    await open('#home?device=p:hu', { v: 'on' }); await page.evaluate(() => { window.atomPreview.setAccept(true); window.atomPreview.setOnline(false); }); await page.waitForTimeout(300);
    const offline = await page.evaluate(`(() => { const r = ${R}; return { step: [...r.querySelectorAll('.at-hu-target .hm-round')].every(b => b.disabled), power: r.querySelector('[data-action="power"]')?.disabled ?? true, modes: [...r.querySelectorAll('.at-hu-mode')].every(b => b.disabled), status: r.querySelector('.at-hu-hero .at-kt-status')?.textContent }; })()`);
    for (const sel of ['.at-hu-target [data-step="1"]', '[data-action="power"]', '.at-hu-mode[data-level="1"]']) await page.evaluate(`${R}.querySelector(${JSON.stringify(sel)})?.click()`);
    await page.waitForTimeout(900);
    check(`${vp}:house-offline-nothing-sent`, offline.step && offline.power && offline.modes && (await log()).length === 0, { offline, log: await log() });
    await shot('sheet-house-offline-light');
    // a burst cut by the house going offline sends nothing later
    await open('#home?device=p:hu', { v: 'on' }); await page.evaluate(() => window.atomPreview.setAccept(true));
    await page.evaluate(`${R}.querySelector('.at-hu-target [data-step="-1"]').click()`); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(1200);
    check(`${vp}:burst-cut-by-offline-sends-nothing`, (await log()).length === 0, { log: await log() });
    // the plug: «Включить розетку» asks first, then switches only the bound plug
    await open('#home?device=p:hu', { v: 'plugOff' }); await page.evaluate(() => window.atomPreview.setAccept(true));
    await page.evaluate(`${R}.querySelector('[data-action="plug-on"]').click()`); await page.waitForTimeout(200);
    check(`${vp}:plug-asks-first`, (await log()).length === 0 && await q('.at-hu-ask'));
    await shot('sheet-plug-ask-light');
    await page.evaluate(`${R}.querySelector('[data-action="plug-yes"]').click()`); await page.waitForTimeout(300);
    l = await log(); check(`${vp}:plug-on-after-yes`, l.length === 1 && l[0].domain === 'switch' && l[0].service === 'turn_on' && l[0].data.entity_id === PLUG.plug, { l });
    // 3. the catalog: «Увлажнители», the card's form and preview
    for (const theme of ['light', 'dark']) {
      await open('#home?device=add-card', { theme, v: 'on', inst: false }); await page.waitForSelector('.at-cards[data-step="list"]');
      await page.click('[data-tab="all"]'); await page.click('[data-category="humidifiers"]'); await page.waitForTimeout(200);
      const ids = await page.$$eval('.at-cards-item', x => x.map(i => i.dataset.profile)); check(`${vp}:${theme}:catalog-humidifiers`, ids.includes('xiaomi.humidifier2'), { ids });
      await shot(`catalog-list-${theme}`);
      await page.click('.at-cards-item[data-profile="xiaomi.humidifier2"]'); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(400);
      const pv = await page.evaluate(`(() => { const r = ${R}; return { tile: !!r.querySelector('.at-cards-preview-tile > *'), sheet: !!r.querySelector('.at-cards-preview-sheet .at-hu-sheet') }; })()`);
      check(`${vp}:${theme}:catalog-form-preview`, pv.tile && pv.sheet, pv);
      await page.evaluate(`${R}.querySelector('[data-part="preview"]')?.scrollIntoView({block:'start'})`); await page.waitForTimeout(250); await shot(`catalog-form-${theme}`);
      check(`${vp}:${theme}:catalog-no-commands`, (await log()).length === 0);
    }
  }
} finally {
  check('no-page-errors', errors.length === 0, { errors }); console.log('404:', [...missing].join(' '));
  await writeFile(resolve(out, 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks, errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
}
