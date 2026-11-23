// The three info cards (src/appliances/{scale,dashcam,gasmeter}.*) on the Criuleni snapshot of 21.11.2026 and its settings, inside a shadow root as
// in HA, phone 412×915 and tablet 1280×800, light and dark:
//   - each card's sheet in every state (live, healthy, alarm, nobody / no data, unavailable, house offline, only the required field bound);
//   - the tile's second line in the normal and unavailable states; the scale's tile and the Home page never show a weight;
//   - nothing overflows the sheet sideways, no word key leaks, no page error, and not one command reaches a device;
//   - the catalog lists the three under «Здоровье», «Автомобиль», «Счётчики».
// usage: node scripts/qa-info.mjs [out-dir]   (evidence/<family>/ per family; the catalog in evidence/info-catalog/)
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixturePath } from './fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), base = resolve(root, process.argv[2] ?? 'evidence');
for (const d of ['scale', 'dashcam', 'gasmeter', 'info-catalog']) await mkdir(resolve(base, d), { recursive: true });
const live = await readFile(fixturePath('criuleni-registry-live-20261121.json'), 'utf8');
const houseConfig = JSON.parse(await readFile(fixturePath('criuleni-config-20261121.json'), 'utf8'));
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(live); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const errors = [];
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d)); };

// ---- the cards as an installer would add them (bindings of this house; ids are the fixture's, the code never knows them) ----
// the scale's people are found the way the card finds them (the router's weight sensors), so no person's name or figure is written here
const fx0 = JSON.parse(live), scaleDev = fx0.devices.find(d => d.model === 'XMTZC02HM/XMTZC05HM/NUN4049CN');
const scaleWeight = fx0.entities.find(e => e.device_id === scaleDev.id && /_weight$/.test(e.entity_id)).entity_id;
const routerDev = fx0.entities.find(e => fx0.states[e.entity_id]?.attributes.source_entity_id === scaleWeight).device_id;
const PEOPLE = fx0.entities.filter(e => e.device_id === routerDev && e.entity_category !== 'diagnostic' && fx0.states[e.entity_id]?.attributes.device_class === 'weight').map(e => e.entity_id);
const WEIGHED = PEOPLE.find(id => fx0.states[id].attributes.source_entity_id === scaleWeight), WEIGHT = new RegExp(fx0.states[WEIGHED].state.replace('.', '[,.]'));
const BODY = fx0.entities.filter(e => e.platform === 'bodymiscale' && e.entity_id.startsWith('sensor.')).map(e => e.entity_id);
const SCALE = { weight: scaleWeight, stable: fx0.entities.find(e => e.device_id === scaleDev.id && /_stabilized$/.test(e.entity_id)).entity_id, ...Object.fromEntries(PEOPLE.map((id, i) => [`person${i + 1}`, id])) };
const KG = /\d[\d\s,.]*\s*кг(?![а-я])/;
const CAR = { tracker: 'device_tracker.car_dashcam', voltage: 'sensor.car_dashcam_battery_voltage', alarm: 'event.car_dashcam_alarm', network: 'sensor.car_dashcam_network_level', upload: 'binary_sensor.car_dashcam_monitor_upload', simPower: 'binary_sensor.car_dashcam_sim_out_power', firmware: 'sensor.car_dashcam_firmware' };
const GAS = { meter: 'sensor.kitchen_gas_meter', camera: 'camera.kitchen_gas_meter', lastRead: 'input_datetime.kitchen_gas_meter_last_read', answer: 'input_text.kitchen_gas_meter_raw' };
const card = (profileId, bindings, deviceId, name) => ({ profileId, profileVersion: '1.0.0', bindings, placement: ['home', 'room'], ...(deviceId ? { deviceId } : {}), ...(name ? { name } : {}) });
const FAMILIES = {
  scale: { id: 'cScale', profile: 'xiaomi.scale2', bindings: SCALE, deviceId: scaleDev.id, name: 'Весы', required: { weight: SCALE.weight } },
  dashcam: { id: 'cCar', profile: '70mai.a810_up04', bindings: CAR, name: 'Машина', required: { tracker: CAR.tracker } },
  gasmeter: { id: 'cGas', profile: 'meter.gas_camera', bindings: GAS, name: 'Счётчик газа', required: { meter: GAS.meter } },
};
// ---- states: each a mutation of the snapshot made in the page before the panel draws (functions are sent as text) ----
const H = 3600_000;
const STATES = {
  scale: {
    live: 'fx => {}',
    revealed: 'fx => {}',
    history: `fx => { const now = Date.now(), s = fx.states[${JSON.stringify(WEIGHED)}], w = Number(s.state), a = s.attributes; a.weight_history = [2.5, 1.9, 1.4, 1.1, 0.6, 0].map((d, i) => ({ measurement_id: 'm' + i, timestamp: new Date(now - (5 - i) * 6 * 86400000 - 2 * ${H}).toISOString(), weight: Math.round((w + d) * 10) / 10, weight_unit: 'kg' })); const at = a.weight_history.at(-1).timestamp; for (const k of ${JSON.stringify(BODY)}) if (/_last_measurement$/.test(k) && fx.states[k].state !== 'unknown') fx.states[k].state = at; for (const k of Object.keys(fx.states)) if (k.startsWith('bodymiscale.') && fx.states[k].attributes.last_measurement_time) fx.states[k].attributes.last_measurement_time = at; }`,
    nobody: `fx => { for (const id of ${JSON.stringify(PEOPLE)}) { fx.states[id].state = 'unknown'; fx.states[id].attributes.weight_history = []; } for (const k of ${JSON.stringify(BODY)}) fx.states[k].state = 'unknown'; for (const k of Object.keys(fx.states)) if (k.startsWith('bodymiscale.')) delete fx.states[k].attributes.last_measurement_time; }`,
    unavailable: `fx => { for (const k of ['sensor.home_scale_weight', 'binary_sensor.home_scale_stabilized']) fx.states[k].state = 'unavailable'; }`,
    offline: 'fx => {}',
    required: 'fx => {}',
  },
  dashcam: {
    live: `fx => { fx.states['event.car_dashcam_alarm'].attributes.happen_time = Date.now() - 2 * ${H}; }`,
    home: `fx => { const s = fx.states['device_tracker.car_dashcam']; s.state = 'home'; s.attributes.last_update_time = Date.now() - 20 * 60000; fx.states['sensor.car_dashcam_battery_voltage'].state = '12.64'; fx.states['event.car_dashcam_alarm'].attributes.happen_time = Date.now() - 4 * 86400000; fx.states['event.car_dashcam_alarm'].attributes.event_type = 'battery_protection'; }`,
    collision: `fx => { const s = fx.states['device_tracker.car_dashcam']; s.state = 'not_home'; fx.states['sensor.car_dashcam_battery_voltage'].state = '11.62'; const e = fx.states['event.car_dashcam_alarm'].attributes; e.event_type = 'collision'; e.happen_time = Date.now() - 25 * 60000; }`,
    unavailable: `fx => { for (const k of ['device_tracker.car_dashcam', 'sensor.car_dashcam_battery_voltage', 'sensor.car_dashcam_network_level', 'binary_sensor.car_dashcam_monitor_upload', 'binary_sensor.car_dashcam_sim_out_power', 'sensor.car_dashcam_firmware']) fx.states[k].state = 'unavailable'; }`,
    offline: `fx => { fx.states['event.car_dashcam_alarm'].attributes.happen_time = Date.now() - 2 * ${H}; }`,
    required: 'fx => {}',
  },
  gasmeter: {
    live: 'fx => {}',
    healthy: `fx => { const d = fx.states['input_datetime.kitchen_gas_meter_last_read']; d.attributes.timestamp = Math.floor((Date.now() - 4 * 60000) / 1000); fx.states['input_text.kitchen_gas_meter_raw'].state = '00970.684'; }`,
    rejected: `fx => { const d = fx.states['input_datetime.kitchen_gas_meter_last_read']; d.attributes.timestamp = Math.floor((Date.now() - 9 * 60000) / 1000); fx.states['input_text.kitchen_gas_meter_raw'].state = '00969.182'; }`,
    unavailable: `fx => { fx.states['sensor.kitchen_gas_meter'].state = 'unavailable'; fx.states['camera.kitchen_gas_meter'].state = 'unavailable'; }`,
    offline: `fx => { const d = fx.states['input_datetime.kitchen_gas_meter_last_read']; d.attributes.timestamp = Math.floor((Date.now() - 4 * 60000) / 1000); fx.states['input_text.kitchen_gas_meter_raw'].state = '00970.684'; }`,
    required: 'fx => {}',
  },
};
// the tile's expected second line per state (the generic tile: «Недоступно» when the card's main field is gone)
const TILE = {
  scale: { live: /^Взвешивание · 1 нояб/, nobody: /^Взвешиваний ещё не было/, unavailable: /^Взвешивание · 1 нояб/ /* the last weighing stays true while the scale is out of reach */ },
  dashcam: { live: /^Кто-то у машины · (\d\d:\d\d|вчера)/, home: /^Дома · 12,6 В/, collision: /^Удар по машине · /, unavailable: /^Нет связи/ },
  gasmeter: { live: /^Не читается · 970,684 м³/, healthy: /^970,684 м³ · \d\d:\d\d/, unavailable: /^Нет связи/ },
};
// a meter as the kitchen camera sees it, for the preview's frame
const FRAME = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#2b2f33"/><rect x="70" y="110" width="500" height="140" rx="14" fill="#d9d4c7"/><rect x="100" y="140" width="440" height="80" fill="#111"/>${'00970684'.split('').map((d, i) => `<rect x="${108 + i * 54}" y="148" width="46" height="64" fill="${i >= 5 ? '#b3261e' : '#1d1d1d'}" stroke="#444"/><text x="${131 + i * 54}" y="196" font-family="monospace" font-size="44" fill="#f4f4f4" text-anchor="middle">${d}</text>`).join('')}<text x="320" y="290" font-family="sans-serif" font-size="18" fill="#bbb" text-anchor="middle">BK-G4CT · m³</text></svg>`).toString('base64');
/** hourly gas use since the 1st of the month (HA's statistics as the preview serves them) */
const STATS = `(() => { const start = Date.UTC(2026, 9, 31, 22), now = Date.now(), hour = [], day = []; for (let t = start; t + 3600000 <= now; t += 3600000) hour.push([t, (new Date(t).getUTCHours() + 2) % 24 >= 6 && (new Date(t).getUTCHours() + 2) % 24 < 23 ? 0.11 : 0.03]); for (let t = start; t < now; t += 86400000) day.push([t, hour.filter(([x]) => x >= t && x < t + 86400000).reduce((a, [, v]) => a + v, 0)]); return { hour: { 'sensor.kitchen_gas_meter': hour }, day: { 'sensor.kitchen_gas_meter': day }, five: {}, hourMean: {}, dayMinMax: {} }; })()`;

const R = 'document.getElementById("root").shadowRoot';
try {
  for (const [vp, size] of [['phone', { width: 412, height: 915 }], ['tablet', { width: 1280, height: 800 }]]) for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 }), page = await ctx.newPage(); page.on('pageerror', e => errors.push(`${vp}/${theme}: ${e.message}`));
    const open = async (hash, { fam, state, required = false, stats = false } = {}) => {
      const cfg = structuredClone(houseConfig); cfg.home.theme = theme; cfg.profileInstances = Object.fromEntries(Object.values(FAMILIES).map(f => [f.id, card(f.profile, required && FAMILIES[fam] === f ? f.required : f.bindings, f.deviceId, state === 'required' && FAMILIES[fam] === f ? undefined : f.name)]));
      await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
      await page.evaluate(async ({ cfg, mut, frame, stats }) => { localStorage.clear(); localStorage.setItem('atom-home:config', JSON.stringify(cfg)); window.__frames = { 'camera.kitchen_gas_meter': frame }; if (stats) window.__energyStats = (0, eval)(stats);
        const fx = await (await fetch('/fixture.json')).json(); (0, eval)(`(${mut})`)(fx); await window.mountPreview(document.getElementById('root'), fx); }, { cfg, mut: fam ? STATES[fam][state] : 'fx => {}', frame: FRAME, stats: stats ? STATS : null });
      await page.waitForTimeout(900);
    };
    const tag = (f, s) => `${vp}/${theme}/${f}/${s}`;
    const cmds = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').length);
    for (const [fam, states] of Object.entries(STATES)) for (const state of Object.keys(states)) {
      const f = FAMILIES[fam], out = resolve(base, fam);
      // the sheet
      await open(`#home?device=p:${f.id}`, { fam, state, required: state === 'required', stats: fam === 'gasmeter' });
      if (state === 'offline') { await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(300); }
      const sheet = await page.evaluate(([fam, R]) => { const r = eval(R), s = r.querySelector(`[data-appliance="${fam}"]`); if (!s) return null; const sec = s.closest('.hm-sheet'); return { text: s.innerText, over: [...s.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(), p = s.getBoundingClientRect(); return b.width > 0 && (b.right > p.right + 1 || b.left < p.left - 1); }).map(e => e.className).slice(0, 5), scroll: sec ? sec.scrollWidth - sec.clientWidth : 0 }; }, [fam, R]);
      check(`${tag(fam, state)}:sheet`, !!sheet, {});
      if (!sheet) continue;
      check(`${tag(fam, state)}:no-word-keys`, !/\b(scale|dashcam|gasmeter|cat\.[a-z]|ui|state)\.[a-zA-Z]/.test(sheet.text), { text: sheet.text.slice(0, 200) });
      check(`${tag(fam, state)}:no-sideways-overflow`, !sheet.over.length && sheet.scroll <= 1, sheet);
      if (fam === 'scale') {
        if (state !== 'revealed') check(`${tag(fam, state)}:weight-folded`, !WEIGHT.test(sheet.text) && !KG.test(sheet.text), {});
        if (state === 'revealed' || state === 'history') { await page.click('[data-action="reveal"]').catch(() => undefined); await page.click('.at-sc-person-hit').catch(() => undefined); await page.waitForTimeout(250);
          const txt = await page.evaluate(R2 => eval(R2).querySelector('[data-appliance="scale"]').innerText, R); check(`${tag(fam, state)}:revealed-shows-figures`, WEIGHT.test(txt) && /ИМТ/.test(txt), {}); }
      }
      if (fam === 'gasmeter') {
        const g = await page.evaluate(R2 => { const r = eval(R2); return { problem: r.querySelector('[data-problem]')?.dataset.problem ?? null, img: !!r.querySelector('.at-gm-still img'), use: [...r.querySelectorAll('.at-gm-fig b')].map(b => b.textContent) }; }, R);
        const want = { live: 'stale', healthy: null, rejected: 'rejected', offline: null, unavailable: null, required: null }[state];
        check(`${tag(fam, state)}:problem=${want}`, g.problem === want, g);
        if (state === 'healthy') check(`${tag(fam, state)}:still-and-statistics`, g.img && g.use.every(u => /\d/.test(u)), g);
        if (state === 'required') check(`${tag(fam, state)}:no-still-without-camera`, !g.img, g);
      }
      await page.screenshot({ path: resolve(out, `${vp}-${theme}-${state}-sheet.png`) });
      if (vp === 'phone') { await page.evaluate(R2 => { const s = eval(R2).querySelector('.hm-sheet'); if (s) s.scrollTop = s.scrollHeight; }, R); await page.waitForTimeout(150); await page.screenshot({ path: resolve(out, `${vp}-${theme}-${state}-sheet-end.png`) }); }
      check(`${tag(fam, state)}:no-commands`, await cmds() === 0);
      // the tile on Home
      if (TILE[fam][state] || state === 'live') {
        await open('#home', { fam, state, stats: fam === 'gasmeter' });
        const tile = await page.evaluate(([id, R2]) => { const r = eval(R2), el = r.querySelector(`[data-device-key="p:${id}"]`); return el ? { line: el.querySelector('.ah-tile-text small')?.textContent ?? '', name: el.querySelector('.ah-tile-text strong')?.textContent ?? '' } : null; }, [f.id, R]);
        check(`${tag(fam, state)}:tile`, tile && (!TILE[fam][state] || TILE[fam][state].test(tile.line)), tile ?? {});
        if (fam === 'scale') for (const page2 of ['#home', '#systems', '#rooms?room=none']) { if (page2 !== '#home') await open(page2, { fam, state }); const txt = await page.evaluate(R2 => eval(R2).querySelector('.hm-shell').innerText, R); check(`${tag(fam, state)}:no-weight-on-${page2}`, !WEIGHT.test(txt) && !KG.test(txt), { at: (txt.match(KG) ?? [])[0] }); }
        if (fam === 'scale') await open('#home', { fam, state });
        // the Kitchen (1.36.1): the card with no device stands for the camera's own HA device — one «Счётчик газа» there, its card, and no second tile
        if (fam === 'gasmeter' && state === 'live') { await open('#rooms?room=kukhnia', { fam, state, stats: true });
          const room = await page.evaluate(([id, R2]) => { const r = eval(R2); return { cards: r.querySelectorAll(`[data-device-key="p:${id}"]`).length, plain: [...r.querySelectorAll('.rm-tile .rm-tile-name strong')].map(e => e.textContent).filter(n => /газ/i.test(n)) }; }, [f.id, R]);
          check(`${tag(fam, state)}:kitchen-one-gas-meter`, room.cards === 1 && room.plain.length === 0, room);
          await open('#home', { fam, state, stats: true }); }
        const loc = page.locator(`[data-device-key="p:${f.id}"]`); if (await loc.count()) { await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await loc.screenshot({ path: resolve(out, `${vp}-${theme}-${state}-tile.png`) }); }
        check(`${tag(fam, state)}:tile-no-commands`, await cmds() === 0);
      }
    }
    // the catalog: the three categories, each with its card
    await open('#home?device=add-card'); await page.waitForSelector('.at-cards[data-step="list"]'); await page.click('[data-tab="all"]'); await page.waitForTimeout(200);
    for (const [cat, id] of [['health', 'xiaomi.scale2'], ['car', '70mai.a810_up04'], ['meters', 'meter.gas_camera']]) {
      await page.click(`[data-category="${cat}"]`); await page.waitForTimeout(150);
      const ids = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile)); check(`${vp}/${theme}:catalog-${cat}`, ids.includes(id), { ids });
      await page.screenshot({ path: resolve(base, 'info-catalog', `${vp}-${theme}-${cat}.png`) });
      // its form and its preview (the tile and the sheet, inert)
      await page.click(`.at-cards-item[data-profile="${id}"]`); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(base, 'info-catalog', `${vp}-${theme}-${cat}-form.png`) });
      await page.click('.at-cards-back'); await page.waitForSelector('.at-cards[data-step="list"]'); await page.click('[data-tab="all"]'); await page.waitForTimeout(100); await page.click(`[data-category="${cat}"]`);
    }
    check(`${vp}/${theme}:catalog-no-commands`, await cmds() === 0);
    await ctx.close();
  }
} finally {
  check('no-page-errors', errors.length === 0, { errors: errors.slice(0, 10) });
  await writeFile(resolve(base, 'info-catalog', 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks, errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
}
