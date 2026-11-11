// The generic tiles on the whole-house snapshot (audit 10.11.2026): a thermostat with no reading, a socket's on/off in words, scenes that show they wait,
// the single camera's tile from the keyboard and its «Повторить», names that tell eight «Свет» apart, no technical model ids as text.
// usage: node scripts/qa-tiles.mjs [outDir]
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.argv[2] ?? resolve(root, 'evidence/tiles')); await mkdir(out, { recursive: true });
const port = await freePort(), server = spawn(process.execPath, [resolve(root, 'scripts/preview-server.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), report = { checks: [], errors: [] };
const check = (name, ok, extra) => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra === undefined || ok ? '' : ' — ' + JSON.stringify(extra).slice(0, 700)}`); };
const TECH = /\b[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_.-]+\b/; // «roborock.vacuum.s5e», «yeelink.light.ceilc»
try {
  for (const [w, h, label] of [[1070, 764, 'tablet'], [360, 792, 'phone']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    const go = async hash => { await page.goto(`${origin}/${hash}`); await page.waitForSelector('.at-shell', { timeout: 15000 }); await page.waitForTimeout(500); };
    // ---- thermostats: the big number is the room's temperature or «Нет данных», never the setpoint
    await go('#climate');
    const thermo = await page.evaluate(() => [...document.querySelectorAll('.ah-thermo')].map(t => ({ name: t.querySelector('.ah-tile-text strong')?.textContent, reading: t.querySelector('.ah-thermo-value')?.dataset.reading, big: t.querySelector('.ah-thermo-value b')?.textContent, line: t.querySelector('.ah-thermo-value small')?.textContent, steps: [...t.querySelectorAll('.ah-chev')].map(b => b.getAttribute('aria-label')) })));
    const blind = thermo.filter(t => t.reading === 'none'), seeing = thermo.filter(t => t.reading === 'room');
    check(`${label}: there are thermostats with and without a reading on the snapshot`, blind.length >= 1 && seeing.length >= 1, thermo);
    check(`${label}: a thermostat with no reading says «Нет данных», its setpoint stays in the second line`, blind.every(t => t.big === 'Нет данных' && !/^\d/.test(t.big ?? '') && /цель \d/.test(t.line ?? '')), blind);
    check(`${label}: a reading carries its degree sign`, seeing.every(t => /^-?\d+(,\d)?°$/.test(t.big ?? '')), seeing);
    check(`${label}: the steppers are named after their thermostat and what they do`, thermo.every(t => t.steps.length === 0 || (t.steps.length === 2 && t.steps.every(s => s && s.startsWith(t.name) && /цель/.test(s)) && t.steps[0] !== t.steps[1])) && new Set(thermo.flatMap(t => t.steps)).size === thermo.flatMap(t => t.steps).length, thermo.map(t => t.steps));
    await page.screenshot({ path: resolve(out, `${label}-climate.png`) });
    // ---- things you switch: on or off in words and as aria-pressed, not by the glyph's colour alone
    // (since 1.27.0 plugs and relays are no devices of «Устройства»: its search finds them, and they are checked there)
    await go('#systems'); await page.fill('.at-search', 'розетк'); await page.waitForTimeout(250);
    const sw = await page.evaluate(() => [...document.querySelectorAll('.ah-tile.kind-socket, .ah-tile.kind-switch')].map(t => ({ name: t.querySelector('strong')?.textContent, line: t.querySelector('.ah-tile-text small')?.textContent, pressed: t.querySelector('.ah-tile-hit')?.getAttribute('aria-pressed'), off: t.classList.contains('is-off'), on: t.classList.contains('is-on') })));
    check(`${label}: sockets and switches are on the screen`, sw.length >= 1, sw);
    check(`${label}: each says «Вкл» / «Выкл» (or that it has no link) in its second line`, sw.every(t => /^(Вкл|Выкл|Нет связи|Нет данных)( ·|$)/.test(t.line ?? '')), sw);
    check(`${label}: aria-pressed follows the state; a device without a link claims neither`, sw.every(t => t.off ? t.pressed === null : /^Вкл/.test(t.line) ? t.pressed === 'true' : /^Выкл/.test(t.line) ? t.pressed === 'false' : t.pressed === null), sw);
    // ---- the lights page: every tile's accessible name tells it apart
    await go('#lights');
    const lights = await page.evaluate(() => [...document.querySelectorAll('.hm-light-grid .ah-tile')].map(t => ({ hit: t.querySelector('.ah-tile-hit')?.getAttribute('aria-label') ?? t.querySelector('.ah-tile-hit')?.textContent, more: t.querySelector('.ah-tile-more')?.getAttribute('aria-label') })));
    check(`${label}: «Подробнее: …» is different for every lamp`, lights.length >= 2 && new Set(lights.map(l => l.more)).size === lights.length, lights.map(l => l.more));
    // ---- no technical ids as text: the vacuum's hero, every tile caption
    await go('#cleaning');
    const hero = await page.evaluate(() => ({ small: document.querySelector('.at-vac-hero-text small')?.textContent ?? null, h2: document.querySelector('.at-vac-hero-text h2')?.textContent ?? null }));
    check(`${label}: the vacuum's panel shows no technical model id`, hero.h2 !== null && !TECH.test(hero.small ?? ''), hero);
    for (const hash of ['#home', '#systems', '#lights', '#climate']) { await go(hash); const raw = await page.evaluate(() => [...document.querySelectorAll('.ah-tile strong, .ah-tile small, .hm-camera-caption strong, .hm-camera-caption small')].map(e => e.textContent).filter(Boolean)); check(`${label} ${hash}: no technical ids in tile texts`, !raw.some(x => TECH.test(x)), raw.filter(x => TECH.test(x))); }
    // ---- round 2 (10.11.2026) -------------------------------------------------------------------------------------------------------------
    const cmds = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => ({ s: `${c.domain}.${c.service}`, ...c.data })));
    // f0 / f69 / l162: a tile whose command is on its way keeps the keyboard focus — aria-disabled + aria-busy, never `disabled`; a second Enter sends nothing
    await go('#lights');
    { const sel = '.hm-light-grid .ah-tile.kind-light:not(.is-off) .ah-tile-hit';
      check(`${label}: there is a lamp to press on the snapshot`, !!(await page.$(sel)));
      await page.evaluate(() => { window.atomPreview.setAccept(true); window.atomPreview.setDelay(1200); });
      const n0 = (await cmds()).length; await page.focus(sel); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
      const mid = await page.evaluate(q => { const b = document.querySelector(q); return { aria: b.getAttribute('aria-disabled'), busy: b.getAttribute('aria-busy'), disabled: b.disabled, focus: document.activeElement === b, pending: b.closest('.ah-tile').classList.contains('is-pending') }; }, sel);
      await page.keyboard.press('Enter'); await page.waitForTimeout(300); const during = (await cmds()).length - n0;
      await page.waitForFunction(q => !document.querySelector(q).closest('.ah-tile').classList.contains('is-pending'), sel, { timeout: 8000 }).catch(() => {});
      const end = await page.evaluate(q => { const b = document.querySelector(q); return { aria: b.getAttribute('aria-disabled'), busy: b.getAttribute('aria-busy'), disabled: b.disabled, focus: document.activeElement === b }; }, sel);
      check(`${label}: f0 — a pending tile is aria-disabled + aria-busy, not disabled, and keeps the focus`, mid.pending && mid.aria === 'true' && mid.busy === 'true' && mid.disabled === false && mid.focus, mid);
      check(`${label}: f0 — Enter twice is one command`, during === 1 && (await cmds()).length - n0 === 1, { during, total: (await cmds()).length - n0 });
      check(`${label}: f0 — after the answer the tile is free and the focus is still on it`, end.aria === null && end.busy === null && !end.disabled && end.focus, end);
      await page.evaluate(() => { window.atomPreview.setDelay(0); window.atomPreview.setAccept(false); }); }
    // f67 / l188: «+» of a switched-off thermostat in «Климат» asks before it heats, as on Home; l6 / l151: «−» at the device's minimum is off
    await go('#climate');
    { const st = await page.evaluate(() => { const s = window.atomPreview.host.states(); return [...document.querySelectorAll('.ah-thermo')].map(t => { const id = t.dataset.deviceKey.replace(/^e:/, ''), r = s[id]; return { key: t.dataset.deviceKey, id, state: r?.state, target: r?.attributes.temperature, min: r?.attributes.min_temp, step: r?.attributes.target_temp_step ?? 0.5, down: t.querySelector('.ah-chev.is-down')?.disabled, up: t.querySelector('.ah-chev.is-up')?.disabled }; }); });
      const offOne = st.find(x => x.state === 'off' && typeof x.target === 'number' && x.target > x.min), atMin = st.filter(x => typeof x.target === 'number' && x.target === x.min);
      check(`${label}: the snapshot has a switched-off thermostat above its minimum and a radiator at its minimum`, !!offOne && atMin.length >= 1, st);
      check(`${label}: l6 — «−» of a radiator at its minimum is disabled, «+» is not`, atMin.length >= 1 && atMin.every(x => x.down === true && x.up === false), atMin);
      if (offOne) {
        const n0 = (await cmds()).length; await page.click(`.ah-thermo[data-device-key="${offOne.key}"] .ah-chev.is-up`); await page.waitForTimeout(350);
        const ask = await page.evaluate(() => document.querySelector('.hm-confirm p')?.textContent ?? null);
        check(`${label}: f67 — «+» of a switched-off thermostat in «Климат» asks «Включить нагрев до N°» and sends nothing`, /Включить нагрев до/.test(ask ?? '') && (await cmds()).length === n0, { ask, sent: (await cmds()).length - n0 });
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        // f75 / l32 / l55: the same thermostat heating — three quick «+» are ONE command with the sum, the number on the tile follows every tap
        await page.evaluate(id => { window.atomPreview.setStates({ [id]: 'heat' }); window.atomPreview.setAccept(true); window.atomPreview.setDelay(300); }, offOne.id); await page.waitForTimeout(250);
        const up = `.ah-thermo[data-device-key="${offOne.key}"] .ah-chev.is-up`, n1 = (await cmds()).length, want = Math.round((offOne.target + 3 * offOne.step) * 10) / 10;
        await page.focus(up); for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
        const shownNow = await page.evaluate(k => ({ line: document.querySelector(`.ah-thermo[data-device-key="${k}"] .ah-thermo-value small`)?.textContent, focus: document.activeElement?.classList.contains('is-up'), disabled: document.activeElement?.disabled ?? null }), offOne.key);
        const early = (await cmds()).length - n1; await page.waitForTimeout(1600);
        const sent = (await cmds()).slice(n1);
        check(`${label}: f75 — every tap moves the target on the tile at once (${offOne.target}° → ${want}°) and nothing is sent while the taps come`, new RegExp(`цель ${String(want).replace('.', ',')}°`).test(shownNow.line ?? '') && early === 0, { shownNow, early });
        check(`${label}: f75 — three quick «+» are one climate.set_temperature with ${want}`, sent.length === 1 && sent[0].s === 'climate.set_temperature' && sent[0].temperature === want && !('hvac_mode' in sent[0]), sent);
        check(`${label}: f75 — the stepper keeps the focus through its command (not disabled while pending)`, shownNow.focus === true && shownNow.disabled === false, shownNow);
        await page.evaluate(() => { window.atomPreview.setDelay(0); window.atomPreview.setAccept(false); });
      } }
    // l10: a tile with nothing to switch is ONE Tab stop (the tile opens the sheet; «Подробнее» stays for the pointer); a tile you switch keeps both
    await go('#systems'); await page.fill('.at-search', '');
    // the list's own tiles (things you switch) and — through its search, since 1.27.0 sensors are no devices of the list — the sensors' tiles
    { const tilesNow = () => page.evaluate(() => [...document.querySelectorAll('.hm-systems .ah-tile')].map(t => ({ kind: [...t.classList].find(c => c.startsWith('kind-')), sw: t.querySelector('.ah-tile-hit').hasAttribute('aria-pressed'), off: t.classList.contains('is-off'), stops: [...t.querySelectorAll('button')].filter(b => !b.disabled && b.tabIndex >= 0).length, more: t.querySelector('.ah-tile-more')?.getAttribute('aria-hidden') })));
      const listed = await tilesNow(); await page.fill('.at-search', 'датчик'); await page.waitForTimeout(250); const sensors = await tilesNow(); await page.fill('.at-search', ''); await page.waitForTimeout(200);
      const stops = [...listed, ...sensors];
      const read = stops.filter(x => ['kind-environment', 'kind-leak', 'kind-opening', 'kind-measurement', 'kind-motion'].includes(x.kind)), switched = stops.filter(x => x.sw);
      check(`${label}: l10 — a sensor tile is one Tab stop`, read.length >= 1 && read.every(x => x.stops === 1 && x.more === 'true'), read.filter(x => x.stops !== 1));
      check(`${label}: l10 — a tile you switch keeps the tile and «Подробнее»`, switched.length >= 1 && switched.every(x => x.stops === 2 && x.more === null), switched.filter(x => x.stops !== 2));
      // l94: a search's results stand first: the module cards of the tab (the feeder) step aside while something is typed
      { const rows0 = await page.evaluate(() => document.querySelectorAll('.hm-page .at-module-row').length); await page.fill('.at-search', 'zzzz'); await page.waitForTimeout(250); check(`${label}: l94 — while a search is typed no module card stands above the results`, rows0 >= 1 && await page.evaluate(() => document.querySelectorAll('.hm-page .at-module-row').length === 0 && !!document.querySelector('.hm-systems .at-empty')), rows0); await page.fill('.at-search', ''); await page.waitForTimeout(200); } }
    // l97: the valve's sheet offers only what can be done: «Открыть» when closed, «Закрыть» when open
    { const valve = await page.evaluate(() => Object.keys(window.atomPreview.host.states()).find(id => id.startsWith('valve.')) ?? null);
      check(`${label}: the snapshot has a valve`, !!valve);
      if (valve) { const pills = () => page.evaluate(() => [...document.querySelectorAll('.hm-sheet .at-actions .hm-pill')].map(b => b.textContent));
        await page.evaluate(id => window.atomPreview.setStates({ [id]: 'closed' }), valve); await go('#systems?device=' + encodeURIComponent('e:' + valve)); const closed = await pills();
        await page.evaluate(id => window.atomPreview.setStates({ [id]: 'open' }), valve); await page.waitForTimeout(250); const open = await pills();
        check(`${label}: l97 — a closed valve offers «Открыть» only, an open one «Закрыть» only`, closed.join() === 'Открыть' && open.join() === 'Закрыть', { closed, open });
        await page.evaluate(id => window.atomPreview.setStates({ [id]: 'closed' }), valve); await page.keyboard.press('Escape'); await page.waitForTimeout(300); } }
    // f56: with the house off the line a device sheet says so in its head, its controls are aria-disabled (not disabled), and a press tells why without sending
    { await go('#systems'); await page.fill('.at-search', 'розетк'); await page.waitForTimeout(250); const sw = await page.evaluate(() => document.querySelector('.hm-systems .ah-tile.kind-switch:not(.is-off), .hm-systems .ah-tile.kind-socket:not(.is-off)')?.dataset.deviceKey ?? null); await page.fill('.at-search', '');
      check(`${label}: the snapshot has a socket with a link`, !!sw);
      if (sw) { await go('#systems?device=' + encodeURIComponent(sw));
        const on = await page.evaluate(() => ({ badge: document.querySelector('.hm-sheet-head .hm-badge')?.textContent ?? null, aria: document.querySelector('.hm-sheet .ah-power')?.getAttribute('aria-disabled') ?? null }));
        await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(300); const n0 = (await cmds()).length;
        const off = await page.evaluate(() => { const b = document.querySelector('.hm-sheet .ah-power'); return { badge: document.querySelector('.hm-sheet-head .hm-badge')?.textContent ?? null, aria: b?.getAttribute('aria-disabled') ?? null, busy: b?.getAttribute('aria-busy') ?? null, disabled: b?.disabled ?? null }; });
        await page.click('.hm-sheet .ah-power', { force: true }); /* Playwright itself will not press an aria-disabled button */ await page.waitForTimeout(350); const toast = await page.evaluate(() => document.querySelector('.hm-toast')?.textContent ?? null);
        check(`${label}: f56 — on the line the sheet has no «Нет связи» and its power row is not marked`, on.badge === null && on.aria === null, on);
        check(`${label}: f56 — off the line the sheet's head says «Нет связи с домом» and the power row is aria-disabled, not disabled`, off.badge === 'Нет связи с домом' && off.aria === 'true' && off.busy === null && off.disabled === false, off);
        check(`${label}: f56 — a press sends nothing and says why`, (await cmds()).length === n0 && /Нет связи с домом/.test(toast ?? ''), { toast, sent: (await cmds()).length - n0 });
        await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForTimeout(300);
        // l112: the icon of a switched-off setting is grey, of a switched-on one green (admin's «Настройки» fold; the preview is an administrator)
        const rows = await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .ah-row.hm-setting')].filter(r => r.querySelector('[role=switch]')).map(r => ({ on: r.querySelector('[role=switch]').getAttribute('aria-checked') === 'true', tile: r.querySelector('.ah-row-icon')?.getAttribute('style') ?? '' })));
        check(`${label}: l112 — a switched-off setting has a grey icon, a switched-on one a green one`, rows.length >= 1 && rows.every(r => r.tile.includes(r.on ? '#30d158' : '#8e8e93')), rows);
        await page.keyboard.press('Escape'); await page.waitForTimeout(300); } }
    // f47 / f60 / l156: a lamp without a link says «Нет связи» in words in its sheet at every width (the roomy sheet hides the big word) and in the slider; `unknown` is «Нет данных», never «Выключено»
    { const lamp = await page.evaluate(() => { const s = window.atomPreview.host.states(); return Object.keys(s).find(id => id.startsWith('light.') && Array.isArray(s[id].attributes.supported_color_modes) && s[id].attributes.supported_color_modes.some(m => m !== 'onoff') && document.querySelector('.at-shell')) ?? null; });
      await go('#lights'); const key = lamp && await page.evaluate(id => document.querySelector(`.ah-tile[data-device-key="e:${id}"]`) ? `e:${id}` : null, lamp);
      check(`${label}: the snapshot has a dimmable lamp with its own tile`, !!key, { lamp });
      if (key) { const read = () => page.evaluate(() => ({ words: document.querySelector('.hm-sheet .at-light-state')?.innerText ?? '', once: (document.querySelector('.hm-sheet .at-light-state')?.innerText.match(/Нет связи|Нет данных/g) ?? []).length, roomy: document.querySelector('.hm-sheet')?.classList.contains('is-roomy'), slider: document.querySelector('.hm-sheet .at-vs')?.getAttribute('aria-valuetext') ?? null, sdis: document.querySelector('.hm-sheet .at-vs')?.getAttribute('aria-disabled') ?? null }));
        await page.evaluate(id => window.atomPreview.setStates({ [id]: 'unavailable' }), lamp); await go('#lights?device=' + encodeURIComponent(key)); const un = await read();
        check(`${label}: f47 — the sheet of a lamp without a link says «Нет связи» in visible words${un.roomy ? ' (roomy sheet)' : ''} and in the slider's value`, /Нет связи/.test(un.words) && un.once === 1 && un.slider === 'Нет связи' && un.sdis === 'true', un);
        await page.evaluate(id => window.atomPreview.setStates({ [id]: 'unknown' }), lamp); await page.waitForTimeout(250); const unk = await read();
        check(`${label}: l156 — a lamp in «unknown» says «Нет данных», not «Выключено»`, /Нет данных/.test(unk.words) && !/Выключено/.test(unk.words) && unk.slider === 'Нет данных', unk);
        // l193: no technical model id anywhere in the sheet, the folded «Диагностика» included
        const tech = await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .ah-row small, .hm-sheet .ah-row strong, .hm-sheet .ah-hero-main small')].map(e => e.textContent).filter(Boolean));
        check(`${label}: l193 — the sheet prints no technical model id («Модель» row included)`, !tech.some(x => TECH.test(x)), tech.filter(x => TECH.test(x)));
        await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      // the relay lamp: «Нет данных» with no «с …» as if it were known to be off
      await go('#lights'); const relay = await page.evaluate(() => { const s = window.atomPreview.host.states(); for (const t of document.querySelectorAll('.hm-light-grid .ah-tile.kind-light')) { const id = t.dataset.deviceKey.replace(/^e:/, ''), r = s[id]; if (r && t.dataset.deviceKey.startsWith('e:') && !(Array.isArray(r.attributes.supported_color_modes) && r.attributes.supported_color_modes.some(m => m !== 'onoff'))) return id; } return null; });
      check(`${label}: the snapshot has a relay lamp`, !!relay);
      if (relay) { await page.evaluate(id => window.atomPreview.setStates({ [id]: 'unknown' }), relay); await go('#lights?device=' + encodeURIComponent('e:' + relay));
        const hero = await page.evaluate(() => ({ b: document.querySelector('.hm-sheet .at-relay-hero .ah-hero-main b')?.textContent ?? null, small: document.querySelector('.hm-sheet .at-relay-hero .ah-hero-main small')?.textContent ?? '' }));
        check(`${label}: l156 — a relay lamp in «unknown» says «Нет данных» and no «с …»`, hero.b === 'Нет данных' && !/^с \d/.test(hero.small), hero);
        await page.keyboard.press('Escape'); await page.waitForTimeout(300); } }
    // ---- scenes: while the house answers the tile waits, a second tap sends nothing
    await go('#home');
    const scenes = await page.$$('.ah-scene .hm-scene-hit');
    check(`${label}: the snapshot has scene tiles (the owner's buttons) — the wait cannot be checked without them`, scenes.length > 0);
    if (scenes.length) {
      await page.evaluate(() => { window.atomPreview.setAccept(true); window.atomPreview.setDelay(1500); window.__n = window.atomPreview.host.log.length; });
      const confirmFree = await page.evaluate(() => { const hits = [...document.querySelectorAll('.ah-scene .hm-scene-hit')]; hits[hits.length - 1].click(); return new Promise(r => setTimeout(() => r(!document.querySelector('.hm-confirm')), 250)); });
      if (confirmFree) {
        const wait = await page.evaluate(() => { const hits = [...document.querySelectorAll('.ah-scene .hm-scene-hit')], b = hits[hits.length - 1]; const r = { pending: b.closest('.ah-scene').classList.contains('is-pending'), busy: b.getAttribute('aria-busy'), aria: b.getAttribute('aria-disabled'), disabled: b.disabled, text: b.querySelector('small')?.textContent }; b.click(); return r; });
        await page.waitForFunction(() => !document.querySelector('.ah-scene.is-pending'), null, { timeout: 15000 }).catch(() => {});
        const sent = await page.evaluate(() => window.atomPreview.host.log.length - window.__n);
        check(`${label}: a scene tile shows the wait (is-pending, aria-busy, aria-disabled — not disabled, so the focus stays —, «Отправляем…»)`, wait.pending && wait.busy === 'true' && wait.aria === 'true' && wait.disabled === false && wait.text === 'Отправляем…', wait);
        check(`${label}: and one tap is one command`, sent === 1, sent);
        check(`${label}: after the answer the tile is itself again`, await page.evaluate(() => { const hits = [...document.querySelectorAll('.ah-scene .hm-scene-hit')], b = hits[hits.length - 1]; return !b.disabled && b.getAttribute('aria-disabled') === null && ['Готово', 'Сценарий'].includes(b.querySelector('small')?.textContent); })); // «Готово» for two seconds after the house accepted (qa-integration checks the sequence)
      } else { await page.keyboard.press('Escape'); check(`${label}: the last scene of the snapshot sends at once (one that asks first cannot show the wait: give the fixture a scene without a question)`, false); }
      await page.evaluate(() => window.atomPreview.setDelay(0));
    }
    // ---- the single camera's tile: a real button, Enter and Space open it, «Повторить» stands on the tile and does not open the sheet
    await go('#home');
    const cam = await page.evaluate(() => { const t = document.querySelector('.hm-camera-tile'); return t ? { role: t.getAttribute('role'), tab: t.getAttribute('tabindex'), hit: t.querySelector(':scope > button.at-cams-hit')?.getAttribute('aria-label') ?? null, nested: t.querySelectorAll('button button').length } : null; });
    if (cam) {
      check(`${label}: the camera tile is opened by a real, named button (no div with role=button)`, cam.role === null && cam.tab === null && /^Открыть: /.test(cam.hit ?? '') && cam.nested === 0, cam);
      for (const key of ['Enter', ' ']) { await page.focus('.hm-camera-tile > .at-cams-hit'); await page.keyboard.press(key); await page.waitForSelector('.hm-sheet', { timeout: 3000 }).catch(() => {}); check(`${label}: ${key === ' ' ? 'Space' : key} opens the camera`, !!(await page.$('.hm-sheet')) && /device=/.test(await page.evaluate(() => location.hash))); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      const hasPlayer = await page.evaluate(() => !!document.querySelector('.hm-camera-tile .at-go2rtc'));
      if (hasPlayer) {
        await page.waitForSelector('.hm-camera-tile .at-cam-retry', { timeout: 12000 }).catch(() => {});
        const r = await page.evaluate(() => { const b = document.querySelector('.hm-camera-tile .at-cam-retry'); if (!b) return null; const box = b.getBoundingClientRect(), top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { text: b.textContent, tag: b.tagName, onTop: top === b || b.contains(top), wait: document.querySelector('.hm-camera-tile .hm-camera-wait span')?.textContent }; });
        check(`${label}: a tile without a picture says «Нет связи с камерой» and offers «Повторить»`, !!r && r.tag === 'BUTTON' && r.text === 'Повторить' && r.onTop && r.wait === 'Нет связи с камерой', r);
        if (r) { await page.click('.hm-camera-tile .at-cam-retry'); await page.waitForTimeout(300); const after = await page.evaluate(() => ({ sheet: !!document.querySelector('.hm-sheet'), retry: !!document.querySelector('.hm-camera-tile .at-cam-retry'), status: document.querySelector('.hm-camera-tile .at-go2rtc')?.dataset.playerStatus })); check(`${label}: «Повторить» tries again on the tile and does not open the sheet`, !after.sheet && !after.retry, after); }
      }
      await page.screenshot({ path: resolve(out, `${label}-home.png`) });
    } else check(`${label}: the snapshot has a single camera tile on Home (its keyboard and «Повторить» checks did not run)`, false);
    await ctx.close();
  }
  // ---- «Повторить» when the video comes over HA's WebRTC (not an admin, or the add-on's ingress failed): the press starts a new attempt at once
  { const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 }, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage();
    await page.addInitScript(() => { window.__rtc = []; window.__beforeDraw = h => { h.ws = m => { if (m.type === 'camera/webrtc/get_client_config') window.__rtc.push(Date.now()); return Promise.reject({ code: 'unknown_error', message: 'no stream here' }); }; h.subscribe = () => Promise.reject(new Error('no stream here')); }; });
    await page.goto(`${origin}/#home`); await page.waitForSelector('.hm-camera-tile .at-go2rtc', { timeout: 15000 }).catch(() => {});
    if (await page.$('.hm-camera-tile .at-go2rtc')) {
      await page.waitForSelector('.hm-camera-tile .at-cam-retry', { timeout: 15000 }).catch(() => {});
      const before = await page.evaluate(() => ({ path: document.querySelector('.hm-camera-tile .at-go2rtc')?.dataset.path, n: window.__rtc.length, t: Date.now() }));
      await page.click('.hm-camera-tile .at-cam-retry').catch(() => {}); await page.waitForTimeout(700);
      const after = await page.evaluate(t0 => window.__rtc.filter(x => x >= t0).length, before.t);
      check('webrtc: the tile fell back to HA\'s WebRTC and «Повторить» starts a new attempt within a moment', before.path === 'webrtc' && before.n >= 1 && after >= 1, { before, after });
    } else check('the snapshot has a single camera with a player (the WebRTC retry was not exercised)', false);
    await ctx.close(); }
} finally { await browser.close(); server.kill(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`); for (const e of report.errors) console.log('  ' + e);
process.exit(report.checks.every(c => c.ok) && !report.errors.length ? 0 : 1);
