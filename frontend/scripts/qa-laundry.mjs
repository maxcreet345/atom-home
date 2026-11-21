// The laundry cards (src/appliances/laundry.*) on the Criuleni snapshot of 21.11.2026 and its settings, inside a shadow root as in HA:
//   - both machines (LG washer, Samsung DV8400D dryer) as catalog instances, in every state (idle, running, done, error, unavailable),
//     phone 412×915 and tablet 1280×800, light and dark: the sheet's words, its tile's line, no overflow, nothing clipped;
//   - the short generic «appliance» card of each machine and the dryer's SmartThings copy are gone where the card is (Bathroom page,
//     «Устройства»), and the card's own tile is there once;
//   - start / pause / stop ask first: the press sends nothing, «Отмена» sends nothing, «да» sends exactly the one command (preview host);
//   - with remote control off on the machine the card says so and offers nothing to press;
//   - the catalog lists both cards under «Стирка и сушка»; no command reaches a device otherwise.
// usage: node scripts/qa-laundry.mjs [out-dir]   (after `npm run preview:build`)
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/laundry');
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const live = await readFile(resolve(root, '../private/fixtures/criuleni-registry-live-20261121.json'), 'utf8');
const axeSrc = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const baseConfig = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-config-20261121.json'), 'utf8'));
const CLOUD = 'sensor.vannaia_vannaia_sushilnaia_mashina_oblako_smartthings_otkliucheno_est_localthings_progress';
const WASHER_DEV = '3b7ac90207cc36d288dca057d95b9929', DRYER_DEV = '4ad5abb20db718389ace669f8f249df9', CLOUD_DEV = 'dc67341f5fdf6b20dbeb5e129dc6f23d';
// the cards as the installer adds them («＋ Добавить карточку»: the suggested fields, the plug and the cloud copy picked by hand)
const INSTANCES = {
  lnWasher: { profileId: 'lg.washer_f_r7', profileVersion: '1.0.0', deviceId: WASHER_DEV, placement: ['home', 'room'], bindings: { status: 'sensor.bath_washer_current_status', endsAt: 'sensor.bath_washer_remaining_time', total: 'sensor.bath_washer_total_time', remote: 'binary_sensor.bath_washer_remote_start', operation: 'select.bath_washer_operation', error: 'event.bath_washer_error', notify: 'event.bath_washer_notification', delayEnd: 'number.bath_washer_delayed_end', delayEndAt: 'sensor.bath_washer_delayed_end', cycles: 'sensor.bath_washer_cycles', power: 'switch.bath_washer_power', plugPower: 'sensor.bath_washer_socket_power', plugEnergy: 'sensor.bath_washer_socket_energy_total', plugToday: 'sensor.bath_washer_socket_energy_today' } },
  lnDryer: { profileId: 'samsung.dryer_dv8400', profileVersion: '1.0.0', deviceId: DRYER_DEV, placement: ['home', 'room'], bindings: { running: 'binary_sensor.bath_dryer_running', machine: 'sensor.bath_dryer_machine_state', stage: 'sensor.bath_dryer_stage', progress: 'sensor.bath_dryer_progress', left: 'sensor.bath_dryer_remaining', finishAt: 'sensor.bath_dryer_estimated_finish', alarm: 'sensor.bath_dryer_alarm_code', remote: 'binary_sensor.bath_dryer_smart_control', childLock: 'binary_sensor.bath_dryer_child_lock', power: 'binary_sensor.bath_dryer_power', cycle: 'select.bath_dryer_cycle', dryLevel: 'select.bath_dryer_dry_level', dryTime: 'select.bath_dryer_dry_time', delay: 'number.bath_dryer_delay_start', finishBy: 'time.bath_dryer_finish_by', start: 'button.bath_dryer_start', pause: 'button.bath_dryer_pause', stop: 'button.bath_dryer_stop', wrinkle: 'switch.bath_dryer_wrinkle_prevent', wrinkleActive: 'binary_sensor.bath_dryer_wrinkle_prevent_active', damp: 'switch.bath_dryer_damp_alert', drumClean: 'sensor.bath_dryer_drum_clean_due_in', light: 'light.vannaia_vannaia_sushilnaia_mashina_samsung_dv8400d_drum_light', buzzer: 'select.bath_dryer_buzzer_sound', finishSound: 'select.bath_dryer_finish_sound', energy: 'sensor.bath_dryer_energy', cloud: CLOUD, plugPower: 'sensor.bath_dryer_socket_power', plugEnergy: 'sensor.bath_dryer_socket_energy_total', plugToday: 'sensor.bath_dryer_socket_energy_today' } },
};
// a state of a machine: what changes in the snapshot (state and attributes); `+N` minutes from now is written as {at: N}
const W = 'bath_washer', D = 'bath_dryer';
const SCEN = {
  washer: {
    idle: { [`sensor.${W}_current_status`]: { state: 'initial' }, [`binary_sensor.${W}_remote_start`]: { state: 'on' }, [`sensor.${W}_socket_power`]: { state: '3' } },
    running: { [`sensor.${W}_current_status`]: { state: 'rinsing' }, [`sensor.${W}_remaining_time`]: { at: 42 }, [`sensor.${W}_total_time`]: { state: '82' }, [`binary_sensor.${W}_remote_start`]: { state: 'on' } },
    done: { [`sensor.${W}_current_status`]: { state: 'end', lc: -6 }, [`sensor.${W}_socket_power`]: { state: '2' }, [`event.${W}_notification`]: { at: -6, attributes: { event_type: 'washing_is_complete' } } },
    error: { [`sensor.${W}_current_status`]: { state: 'error' }, [`event.${W}_error`]: { at: -1, attributes: { event_type: 'water_drain_error' } }, [`sensor.${W}_socket_power`]: { state: '4' } },
    unavailable: { [`sensor.${W}_current_status`]: { state: 'unavailable' }, [`sensor.${W}_remaining_time`]: { state: 'unavailable' } },
  },
  dryer: {
    idle: { [`binary_sensor.${D}_power`]: { state: 'on' }, [`binary_sensor.${D}_smart_control`]: { state: 'on' }, [`sensor.${D}_remaining`]: { state: '190' } },
    running: { [`binary_sensor.${D}_power`]: { state: 'on' }, [`binary_sensor.${D}_smart_control`]: { state: 'on' }, [`sensor.${D}_machine_state`]: { state: 'active' }, [`binary_sensor.${D}_running`]: { state: 'on', lc: -60 }, [`sensor.${D}_stage`]: { state: 'drying' }, [`sensor.${D}_progress`]: { state: '58' }, [`sensor.${D}_remaining`]: { state: '42' }, [`sensor.${D}_estimated_finish`]: { at: 42 }, [`switch.${D}_wrinkle_prevent`]: { state: 'on' }, [`sensor.${D}_socket_power`]: { state: '2210' } },
    done: { [`binary_sensor.${D}_power`]: { state: 'on' }, [`sensor.${D}_stage`]: { state: 'finish' }, [`binary_sensor.${D}_wrinkle_prevent_active`]: { state: 'on' }, [`binary_sensor.${D}_running`]: { state: 'off', lc: -12 }, [`switch.${D}_wrinkle_prevent`]: { state: 'on' } },
    error: { [`binary_sensor.${D}_power`]: { state: 'on' }, [`sensor.${D}_alarm_code`]: { state: 'ErrorCode_dE, FilterAlarm' } },
    unavailable: { [`binary_sensor.${D}_running`]: { state: 'unavailable' }, [`sensor.${D}_machine_state`]: { state: 'unavailable' }, [`sensor.${D}_stage`]: { state: 'unavailable' } },
  },
};
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(live); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = [], errors = [];
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d).slice(0, 400)); };
const R = 'document.getElementById("root").shadowRoot';
const VIEWS = { phone: { width: 412, height: 915 }, tablet: { width: 1280, height: 800 } };
async function open(page, { hash, theme = 'light', lang = 'ru', cards = true, washer = null, dryer = null, stats = null }) {
  const cfg = structuredClone(baseConfig); cfg.home.theme = theme; cfg.home.language = lang; if (cards) cfg.profileInstances = INSTANCES;
  await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
  await page.evaluate(async ({ cfg, mods, stats }) => {
    if (stats) { const now = Date.now(), from = now - stats.minutes * 60_000, H = 3_600_000; window.__energyStats = { hour: { [stats.id]: [[Math.floor((from - 2 * H) / H) * H, 0]] }, day: {}, five: {}, hourMean: {}, dayMinMax: {}, fiveE: { [stats.id]: Array.from({ length: Math.floor(stats.minutes / 5) }, (_, i) => [from + 60_000 + i * 300_000, stats.per5]) } }; }
    localStorage.clear(); localStorage.setItem('atom-home:config', JSON.stringify(cfg));
    const fx = await (await fetch('/fixture.json')).json(), now = Date.now(), iso = m => new Date(now + m * 60_000).toISOString();
    for (const mod of mods) for (const [id, m] of Object.entries(mod)) { const s = fx.states[id] = { ...fx.states[id] }; if (m.state !== undefined) s.state = m.state; if (m.at !== undefined) s.state = iso(m.at); if (m.attributes) s.attributes = { ...s.attributes, ...m.attributes }; s.last_changed = iso(m.lc ?? -2); }
    await window.mountPreview(document.getElementById('root'), fx);
  }, { cfg, mods: [washer, dryer].filter(Boolean), stats });
  await page.waitForTimeout(1000);
}
const commands = page => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => ({ d: c.domain, s: c.service, e: c.data.entity_id, o: c.data.option })));
const text = (page, sel) => page.evaluate(`(${R}.querySelector(${JSON.stringify(sel)})?.innerText ?? '')`);
/** anything wider than its sheet, text cut by its box */
const overflow = page => page.evaluate(`(() => { const s = ${R}.querySelector('.at-ln'); if (!s) return ['no sheet']; const r = s.getBoundingClientRect(), bad = [];
  for (const el of s.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (!b.width) continue; if (b.right > r.right + 1 || b.left < r.left - 1) bad.push('wide:' + (el.className?.baseVal ?? el.className) + ':' + Math.round(b.left) + '-' + Math.round(b.right)); if (['P', 'SMALL', 'STRONG', 'B', 'BUTTON', 'LI', 'H2', 'H3'].includes(el.tagName) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') bad.push('clip:' + el.tagName + ':' + el.textContent.slice(0, 30)); }
  return bad.slice(0, 6); })()`);
try {
  for (const [vp, size] of Object.entries(VIEWS)) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, timezoneId: 'Europe/Chisinau', hasTouch: vp === 'phone' }); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${vp}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${vp}: ${m.text()}`); });
    const shot = n => page.screenshot({ path: resolve(out, `${vp}-${n}.png`) });
    // ---- every state, both themes ----
    for (const theme of ['light', 'dark']) for (const [machine, id] of [['washer', 'lnWasher'], ['dryer', 'lnDryer']]) for (const state of Object.keys(SCEN[machine])) {
      await open(page, { hash: `#home?device=p:${id}`, theme, [machine]: SCEN[machine][state] }); await page.waitForTimeout(250);
      const tag = `${vp}:${theme}:${machine}:${state}`, sheet = await text(page, '.at-ln'), phase = await page.evaluate(`${R}.querySelector('.at-ln-hero')?.dataset.laundryPhase`);
      check(`${tag}:sheet-drawn`, sheet.length > 0 && phase === state, { phase });
      check(`${tag}:no-raw-keys`, !/laundry\.|cat\.r\./.test(sheet), { sheet: sheet.slice(0, 200) });
      check(`${tag}:no-overflow`, (await overflow(page)).length === 0, { bad: await overflow(page) });
      const want = { washer: { idle: /Ожидание/, running: /Полоскание · осталось 4[12] мин/, done: /Готово[\s\S]*Бельё можно доставать/, error: /Ошибка: вода не сливается/, unavailable: /Нет связи со стиральной машиной/ }, dryer: { idle: /Ожидание[\s\S]*Программа займёт 3 ч 10 мин/, running: /Сушка · осталось 4[12] мин/, done: /Готово · защита от сминания/, error: /Ошибка: код dE[\s\S]*Почистите фильтр ворса/, unavailable: /Нет связи с сушильной машиной/ } }[machine][state];
      check(`${tag}:words`, want.test(sheet), { sheet: sheet.slice(0, 300) });
      if (state === 'running') check(`${tag}:end-time-and-stages`, /Закончит в \d\d:\d\d/.test(sheet) && (await page.evaluate(`${R}.querySelectorAll('.at-ln-steps li').length`)) >= 2);
      if (machine === 'dryer' && state === 'running') check(`${tag}:program-name`, /Эко хлопок/.test(sheet));
      await shot(`${machine}-${state}-${theme}`);
      if (state === 'running' && theme === 'light') { await page.evaluate(`${R}.querySelector('[data-laundry-card="program"]')?.scrollIntoView({block:'start'})`); await page.waitForTimeout(200); await shot(`${machine}-${state}-${theme}-options`); }
      check(`${tag}:no-commands`, (await commands(page)).length === 0);
    }
    // ---- tile lines on Home ----
    for (const [machine, id, state, want] of [['washer', 'lnWasher', 'running', /^Полоскание · осталось 4[12] мин$/], ['washer', 'lnWasher', 'done', /^Готово$/], ['washer', 'lnWasher', 'error', /^Ошибка: вода не сливается$/], ['washer', 'lnWasher', 'unavailable', /^(Недоступно|Нет связи)/], ['dryer', 'lnDryer', 'running', /^Сушка · осталось 4[12] мин$/], ['dryer', 'lnDryer', 'done', /^Готово · защита от сминания$/], ['dryer', 'lnDryer', 'unavailable', /^(Недоступно|Нет связи)/]]) {
      await open(page, { hash: '#home', [machine]: SCEN[machine][state] });
      const line = await page.evaluate(`(${R}.querySelector('[data-device-key="p:${id}"] .ah-tile-text small')?.innerText ?? '')`);
      check(`${vp}:tile:${machine}:${state}`, want.test(line.trim()), { line });
      if (state === 'running' && machine === 'dryer') { await page.evaluate(`${R}.querySelector('[data-device-key="p:lnDryer"]')?.scrollIntoView({block:'center'})`); await page.waitForTimeout(200); await shot('home-tiles-running'); }
    }
    // ---- one card per machine: the generic short card and the SmartThings copy are gone (room page, «Устройства») ----
    const keysOn = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(700); return page.evaluate(`[...${R}.querySelectorAll('[data-device-key],[data-lay-mark]')].map(x => x.dataset.deviceKey ?? x.getAttribute('data-lay-mark'))`); };
    const devicesOf = keys => keys.filter(k => [WASHER_DEV, DRYER_DEV, CLOUD_DEV].some(d => k.includes(d)) || /bath_washer_(?!socket|leak)|bath_dryer_(?!socket)|oblako_smartthings/.test(k));
    await open(page, { hash: '#home', cards: false });
    const roomBefore = devicesOf(await keysOn('#rooms?room=vannaia')); await shot('before-room-vannaia'); const listBefore = devicesOf(await keysOn('#systems'));
    check(`${vp}:before:short-cards-were-there`, roomBefore.some(k => k.includes(WASHER_DEV)) && roomBefore.some(k => k.includes(DRYER_DEV)) && listBefore.length > 0, { roomBefore, listBefore });
    await open(page, { hash: '#home', washer: SCEN.washer.running, dryer: SCEN.dryer.running });
    const roomAfter = await keysOn('#rooms?room=vannaia'); await shot('room-vannaia');
    const places = await page.evaluate(`[['${WASHER_DEV}', 'p:lnWasher'], ['${DRYER_DEV}', 'p:lnDryer']].map(([d, k]) => { const at = [...${R}.querySelectorAll('[data-lay-mark="t:' + d + '"]')]; const el = at[0]?.nextElementSibling; return at.length === 1 && !!el && (el.matches('[data-device-key="' + k + '"]') || !!el.querySelector('[data-device-key="' + k + '"]')) && !el.querySelector('.rm-tile-open'); })`); const listAfter = await keysOn('#systems'); await page.evaluate(`${R}.querySelector('[data-device-key="p:lnWasher"]')?.scrollIntoView({block:'center'})`); await page.waitForTimeout(200); await shot('devices-list');
    check(`${vp}:room:cards-once`, roomAfter.filter(k => k === 'p:lnWasher').length === 1 && roomAfter.filter(k => k === 'p:lnDryer').length === 1, { roomAfter });
    // the room draws each machine in its own place (`t:<device>`) BY its card: the place holds the card, never the room's short tile
    check(`${vp}:room:machine-places-hold-the-cards`, places.every(Boolean) && !roomAfter.includes(`t:${CLOUD_DEV}`), { places, roomAfter });
    check(`${vp}:room:no-short-cards`, devicesOf(roomAfter).every(k => k === `t:${WASHER_DEV}` || k === `t:${DRYER_DEV}`), { before: roomBefore, after: devicesOf(roomAfter) });
    check(`${vp}:list:cards-once`, listAfter.filter(k => k === 'p:lnWasher').length === 1 && listAfter.filter(k => k === 'p:lnDryer').length === 1, { listAfter: listAfter.filter(k => /^p:|app:/.test(k)) });
    check(`${vp}:list:no-short-cards`, devicesOf(listAfter).length === 0, { before: listBefore, after: devicesOf(listAfter) });
    const roomText = await page.evaluate(`${R}.querySelector('.rm-page')?.innerText ?? ''`);
    // ---- confirmation: nothing goes without «да» ----
    for (const [machine, id, act, want] of [['washer', 'lnWasher', 'pause', { d: 'select', s: 'select_option', e: 'select.bath_washer_operation', o: 'stop' }], ['dryer', 'lnDryer', 'pause', { d: 'button', s: 'press', e: 'button.bath_dryer_pause' }], ['dryer', 'lnDryer', 'stop', { d: 'button', s: 'press', e: 'button.bath_dryer_stop' }]]) {
      await open(page, { hash: `#home?device=p:${id}`, [machine]: SCEN[machine].running }); await page.evaluate(() => window.atomPreview.setAccept(true));
      const btn = `[data-laundry-act="${act}"]`;
      await page.click(btn); await page.waitForTimeout(250);
      const asked = await page.evaluate(`!!${R}.querySelector('.hm-confirm')`), q = await text(page, '.hm-confirm');
      check(`${vp}:${machine}:${act}:press-asks-sends-nothing`, asked && (await commands(page)).length === 0, { q });
      if (act === 'pause' && machine === 'dryer') await shot('dryer-confirm-pause');
      await page.click('.hm-confirm [data-answer="no"]'); await page.waitForTimeout(200);
      check(`${vp}:${machine}:${act}:cancel-sends-nothing`, (await commands(page)).length === 0 && !(await page.evaluate(`!!${R}.querySelector('.hm-confirm')`)));
      await page.click(btn); await page.waitForTimeout(200); await page.click('.hm-confirm [data-answer="yes"]'); await page.waitForTimeout(400);
      const sent = await commands(page);
      check(`${vp}:${machine}:${act}:yes-sends-exactly-one`, sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(want), { sent });
    }
    // ---- start asks too ----
    for (const [machine, id, want] of [['washer', 'lnWasher', { d: 'select', s: 'select_option', e: 'select.bath_washer_operation', o: 'start' }], ['dryer', 'lnDryer', { d: 'button', s: 'press', e: 'button.bath_dryer_start' }]]) {
      await open(page, { hash: `#home?device=p:${id}`, [machine]: SCEN[machine].idle }); await page.evaluate(() => window.atomPreview.setAccept(true));
      await page.click('[data-laundry-act="start"]'); await page.waitForTimeout(250); const q = await text(page, '.hm-confirm');
      check(`${vp}:${machine}:start:press-asks-sends-nothing`, q.length > 0 && (await commands(page)).length === 0, { q });
      if (machine === 'dryer') await shot('dryer-confirm-start');
      await page.click('.hm-confirm [data-answer="no"]'); await page.waitForTimeout(200); check(`${vp}:${machine}:start:cancel-sends-nothing`, (await commands(page)).length === 0);
      await page.click('[data-laundry-act="start"]'); await page.waitForTimeout(200); await page.click('.hm-confirm [data-answer="yes"]'); await page.waitForTimeout(400);
      const sent = await commands(page); check(`${vp}:${machine}:start:yes-sends-exactly-one`, sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(want), { sent });
    }
    // ---- the house offline: «нет связи», nothing to press, nothing sent ----
    for (const [machine, id] of [['washer', 'lnWasher'], ['dryer', 'lnDryer']]) {
      await open(page, { hash: `#home?device=p:${id}`, [machine]: SCEN[machine].running }); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(300);
      const sheet = await text(page, '.at-ln'), live = await page.evaluate(`[...${R}.querySelectorAll('.at-ln button')].filter(b => !b.disabled && !b.closest('.hm-sheet-head') && !b.classList.contains('at-kt-gear')).map(b => b.textContent)`);
      check(`${vp}:${machine}:offline`, /Нет связи/.test(sheet) && !/осталось/.test(sheet) && live.length === 0 && (await commands(page)).length === 0, { live, sheet: sheet.slice(0, 120) });
      if (machine === 'washer') await shot('washer-offline');
    }
    // ---- the energy of this cycle from the plug's meter (HA statistics) ----
    await open(page, { hash: '#home?device=p:lnDryer', dryer: SCEN.dryer.running, stats: { id: 'sensor.bath_dryer_socket_energy_total', minutes: 60, per5: 0.1 } }); await page.waitForTimeout(500);
    const energy = await text(page, '.at-ln-energy'); check(`${vp}:dryer:cycle-energy`, /За цикл 1(,\d+)?\s?кВт·ч/.test(energy), { energy }); await shot('dryer-running-cycle-energy');
    // ---- Romanian and English: the longer words fit ----
    for (const lang of ['ro', 'en']) for (const [machine, id] of [['washer', 'lnWasher'], ['dryer', 'lnDryer']]) for (const state of ['idle', 'running', 'error']) {
      await open(page, { hash: `#home?device=p:${id}`, lang, [machine]: SCEN[machine][state] }); await page.waitForTimeout(200);
      const sheet = await text(page, '.at-ln'), bad = await overflow(page);
      check(`${vp}:${lang}:${machine}:${state}`, sheet.length > 0 && !/laundry\.|cat\.r\./.test(sheet) && bad.length === 0, { bad, sheet: sheet.slice(0, 120) });
      if (state === 'running') await shot(`${machine}-running-${lang}`);
    }
    // ---- accessibility of the sheet (axe, serious and critical) ----
    for (const [machine, id] of [['washer', 'lnWasher'], ['dryer', 'lnDryer']]) {
      await open(page, { hash: `#home?device=p:${id}`, [machine]: SCEN[machine].running });
      await page.addScriptTag({ content: axeSrc });
      const v = await page.evaluate(async R => { const el = eval(R).querySelector('.at-ln'); const r = await window.axe.run(el, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }); return r.violations.filter(x => ['serious', 'critical'].includes(x.impact)).map(x => `${x.id}: ${x.nodes.map(n => n.target.join(' ')).slice(0, 2).join(' | ')}`); }, R);
      check(`${vp}:${machine}:axe`, v.length === 0, { v });
    }
    // ---- remote control off: said in words, nothing to press ----
    for (const [machine, id, mods, re] of [['washer', 'lnWasher', { ...SCEN.washer.running, 'binary_sensor.bath_washer_remote_start': { state: 'off' } }, /Дистанционный запуск выключен/], ['dryer', 'lnDryer', { ...SCEN.dryer.running, 'binary_sensor.bath_dryer_smart_control': { state: 'off' } }, /Удалённое управление выключено/]]) {
      await open(page, { hash: `#home?device=p:${id}`, [machine]: mods });
      const sheet = await text(page, '.at-ln'), enabled = await page.evaluate(`[...${R}.querySelectorAll('[data-laundry-act]')].filter(b => !b.disabled).length`);
      const settings = await page.evaluate(`[...${R}.querySelectorAll('[data-laundry-field] button, [data-laundry-switch] button')].filter(b => !b.disabled).length`);
      check(`${vp}:${machine}:remote-off-said`, re.test(sheet) && enabled === 0 && settings === 0, { enabled, settings });
      await shot(`${machine}-remote-off`);
      check(`${vp}:${machine}:remote-off:no-commands`, (await commands(page)).length === 0);
    }
    // ---- the dryer's settings screen (gear) ----
    await open(page, { hash: '#home?device=p:lnDryer', dryer: SCEN.dryer.idle }); await page.click('.at-ln .at-kt-gear'); await page.waitForTimeout(250);
    const set = await text(page, '.at-ln'); check(`${vp}:dryer:settings`, /Громкость сигнала[\s\S]*Громко[\s\S]*Мелодия окончания/.test(set), { set: set.slice(0, 200) }); await shot('dryer-settings');
    check(`${vp}:settings:no-commands`, (await commands(page)).length === 0);
    // ---- the catalog ----
    await open(page, { hash: '#home?device=add-card', cards: false }); await page.waitForSelector('.at-cards[data-step="list"]');
    await page.click('[data-tab="all"]'); await page.waitForTimeout(150); await page.click('[data-category="laundry"]'); await page.waitForTimeout(200);
    const listed = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile)); await shot('catalog-laundry');
    check(`${vp}:catalog:laundry`, listed.includes('lg.washer_f_r7') && listed.includes('samsung.dryer_dv8400') && listed.length === 2, { listed });
    await page.click('[data-tab="found"]'); await page.waitForTimeout(150);
    const found = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile));
    check(`${vp}:catalog:found-here`, found.includes('lg.washer_f_r7') && found.includes('samsung.dryer_dv8400'), { found });
    for (const pid of ['lg.washer_f_r7', 'samsung.dryer_dv8400']) {
      await page.click(`.at-cards-item[data-profile="${pid}"]`); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(400);
      const devs = await page.evaluate(`${R}.querySelectorAll('[data-part="device"] input[type=radio], [data-part="device"] option, [data-device-choice]').length`);
      const preview = await page.evaluate(`${R}.querySelectorAll('.at-cards-preview-tile > *').length`);
      check(`${vp}:catalog:${pid}:preview`, preview > 0, { preview, devs });
      await page.evaluate(`${R}.querySelector('[data-part="preview"]')?.scrollIntoView({block:'start'})`); await page.waitForTimeout(250); await shot(`catalog-form-${pid.replace(/\W/g, '_')}`);
      await page.click('.at-cards-back'); await page.waitForSelector('.at-cards[data-step="list"]');
    }
    check(`${vp}:catalog:no-commands`, (await commands(page)).length === 0);
    void roomText;
    await ctx.close();
  }
} finally {
  check('no-page-errors', errors.length === 0, { errors: errors.slice(0, 5) });
  await writeFile(resolve(out, 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks, errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
  process.exitCode = checks.every(c => c.p) ? 0 : 1;
}
