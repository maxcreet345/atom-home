// The NAS card (src/appliances/nas.*) on the Criuleni snapshot of 21.11.2026 and its settings, inside a shadow root as in HA, on a phone (412×915)
// and a tablet (1280×800), light and dark:
//   - the sheet in three states: all well, a warning (drive 2 and a nearly full volume), no answer from the NAS; the tile's line in each;
//   - nothing cut off or off screen (card-checks.mjs), no raw ids, touch targets of 44 px, no page errors;
//   - no stray tiles of the pools, drives and volumes on Home, in the Hall and in «Устройства», with the card or without;
//   - restart and shut down: absent for a resident who is not an administrator; for the administrator each asks first in words, and «Отмена» sends nothing;
//   - «＋ Добавить карточку»: the NAS in the «network» category, its form filled from the house, its preview;
//   - no command reaches a device (the preview host's log stays empty). usage: node scripts/qa-nas.mjs [out-dir]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { layout } from './card-checks.mjs';
import { devicesFor, suggestBindings } from '../src/model/card-catalog.ts';
import { family } from '../src/appliances/nas.profiles.ts';
import { fixturePath } from './fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/nas'); await mkdir(out, { recursive: true });
const liveText = await readFile(fixturePath('criuleni-registry-live-20261121.json'), 'utf8'), live = JSON.parse(liveText);
const houseConfig = JSON.parse(await readFile(fixturePath('criuleni-config-20261121.json'), 'utf8'));
const P = family.profiles[0], dev = devicesFor(live, P)[0], ID = 'cnasqa1';
const inst = { profileId: P.id, profileVersion: P.version, deviceId: dev.id, bindings: suggestBindings(live, P, dev.id), placement: ['home', 'room'] };
const parts = (() => { const ids = new Set([dev.id]); for (let grew = true; grew;) { grew = false; for (const d of live.devices) if (d.via_device_id && ids.has(d.via_device_id) && !ids.has(d.id)) { ids.add(d.id); grew = true; } } ids.delete(dev.id); return [...ids]; })();
const variant = (name) => { const reg = structuredClone(live), set = (id, state) => { reg.states[id] = { ...reg.states[id], state }; };
  if (name === 'warning') { set('sensor.nas_pool_1_disk_2_status', 'Warning'); const total = Number(reg.states['sensor.nas_pool_2_volume_1_total_size_raw'].state); set('sensor.nas_pool_2_volume_1_used_size_raw', String(Math.round(total * 0.94))); set('sensor.nas_pool_2_volume_1_available_size_raw', String(Math.round(total * 0.06))); }
  if (name === 'unavailable') for (const id of Object.keys(reg.states)) if (/^(sensor|button|select)\.(nas|ugreen_nas)_/.test(id)) set(id, 'unavailable');
  return reg; };
const fixtures = { ok: JSON.stringify(variant('ok')), warning: JSON.stringify(variant('warning')), unavailable: JSON.stringify(variant('unavailable')) };
const cfgOf = (theme, withCard = true) => JSON.stringify({ ...houseConfig, home: { ...houseConfig.home, theme, language: 'ru' }, profileInstances: { ...(houseConfig.profileInstances ?? {}), ...(withCard ? { [ID]: inst } : {}) } });
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  const fx = /^\/fixture-(\w+)\.json$/.exec(u.pathname); if (fx) { res.setHeader('content-type', 'application/json'); res.end(fixtures[fx[1]]); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(), checks = [], errors = [];
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d).slice(0, 400)); };
const R = 'document.getElementById("root").shadowRoot';
const VIEWS = [['phone', { width: 412, height: 915 }], ['tablet', { width: 1280, height: 800 }]];
try {
  for (const [vp, size] of VIEWS) for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, hasTouch: vp === 'phone' }), page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${vp}/${theme}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${vp}/${theme}: ${m.text()}`); });
    const open = async (hash, fx = 'ok', withCard = true, admin = true) => { await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
      await page.evaluate(async ([cfg, fx, admin]) => { localStorage.clear(); localStorage.setItem('atom-home:config', cfg); window.__beforeDraw = h => h.setAdmin(admin); await window.mountPreview(document.getElementById('root'), await (await fetch(`/fixture-${fx}.json`)).json()); }, [cfgOf(theme, withCard), fx, admin]); await page.waitForTimeout(900); };
    const shot = n => page.screenshot({ path: resolve(out, `${vp}-${theme}-${n}.png`) });
    const log = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').length);
    const q = (sel, f = 'textContent') => page.evaluate(`[...${R}.querySelectorAll(${JSON.stringify(sel)})].map(e => e.${f})`);
    const scrollSheet = to => page.evaluate(`(() => { let e = ${R}.querySelector('.at-nas-sheet'); while (e && !(e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement; if (e) e.scrollTop = ${to === 'end' ? 'e.scrollHeight' : 0}; return !!e; })()`);
    const small = () => page.evaluate(`[...${R}.querySelectorAll('.at-nas-sheet button')].filter(b => b.offsetWidth && (b.offsetWidth < 44 || b.offsetHeight < 44)).map(b => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 20) + ' ' + b.offsetWidth + 'x' + b.offsetHeight)`);
    const want = { ok: /^Всё в порядке$/, warning: /^Диск 2: внимание$/, unavailable: /^Нет связи с NAS$/ };
    const tileWant = { ok: /^Свободно 3,7 ТБ · всё в порядке/, warning: /^Диск 2: внимание · и ещё 1/, unavailable: /Нет связи/ };
    for (const state of ['ok', 'warning', 'unavailable']) {
      await open(`#home?device=p:${ID}`, state); await page.waitForFunction(`!!${R}.querySelector('.at-nas-sheet')`, null, { timeout: 5000 }).catch(() => undefined);
      const say = ((await q('[data-nas-say]'))[0] ?? '').replace(/\u00a0/g, ' '); check(`${vp}/${theme}/${state}: the sentence`, want[state].test(say ?? ''), { say });
      // closed folds hide their rows outside the fold's box, which the shared check reads as clipped: every check runs with them open
      await page.evaluate(`${R}.querySelectorAll('.at-nas-sheet details').forEach(d => d.open = true)`); await page.waitForTimeout(150);
      const l = await layout(page, '.at-nas-sheet'); check(`${vp}/${theme}/${state}: layout`, !l.length, { l });
      await page.evaluate(`${R}.querySelectorAll('.at-nas-sheet details').forEach(d => d.open = false)`); await page.waitForTimeout(100);
      const s = await small(); check(`${vp}/${theme}/${state}: 44 px targets`, !s.length, { s });
      if (state === 'ok') { check(`${vp}/${theme}: four drives, two volumes, the load`, (await q('[data-nas-disk]')).length === 4 && (await q('[data-nas-volume]')).length === 2 && (await q('[data-nas-load]')).length >= 5); }
      if (state === 'warning') { const more = (await q('.at-nas-issues li')).map(x => x.replace(/\u00a0/g, ' ')); check(`${vp}/${theme}: the rest listed under the sentence`, more.length === 1 && /^Том 2 почти заполнен: 94 %$/.test(more[0]), { more }); const d2 = await page.evaluate(`${R}.querySelector('[data-nas-disk="2"]')?.className`); check(`${vp}/${theme}: drive 2 marked`, /is-warn/.test(d2 ?? ''), { d2 }); const v2 = await page.evaluate(`${R}.querySelector('[data-nas-volume="2"]')?.className`); check(`${vp}/${theme}: volume 2 marked full`, /is-full/.test(v2 ?? ''), { v2 }); }
      await shot(`${state}-1-top`); if (await scrollSheet('end')) { await page.waitForTimeout(200); await shot(`${state}-2-end`); }
      if (state === 'ok') { // the folds open: pools with their drives and volumes, the device
        await page.evaluate(`${R}.querySelectorAll('.at-nas-sheet details').forEach(d => d.open = true)`); await page.waitForTimeout(200);
        const lf = await layout(page, '.at-nas-sheet'); check(`${vp}/${theme}: layout with the folds open`, !lf.length, { lf });
        check(`${vp}/${theme}: the pools list their drives`, (await q('[data-nas-pool-disk]')).length === 4);
        const txt = (await q('.at-nas-sheet', 'innerText'))[0] ?? ''; check(`${vp}/${theme}: no serial, MAC, owner or IP on the card`, !/HB670EE|6c:1f:f7|@mail|192\.168\.|WD-WX81/i.test(txt));
        await page.evaluate(`(() => { const f = [...${R}.querySelectorAll('.at-nas-sheet details')][0]; f?.scrollIntoView({ block: 'start' }); })()`); await page.waitForTimeout(200); await shot(`ok-3-folds`);
      }
      // the tile on Home says the same thing
      await open('#home', state); const tile = (await page.evaluate(`${R}.querySelector('[data-device-key="p:${ID}"]')?.innerText ?? ''`)).replace(/\u00a0/g, ' ');
      check(`${vp}/${theme}/${state}: the tile's line`, tileWant[state].test((tile ?? '').split('\n').slice(1).join(' ')), { tile });
      if (theme === 'light') { await page.evaluate(`${R}.querySelector('[data-device-key="p:${ID}"]')?.scrollIntoView({ block: 'center' })`); await page.waitForTimeout(200); await shot(`${state}-0-tile`); }
      check(`${vp}/${theme}/${state}: no commands`, await log() === 0);
    }
    if (theme === 'light') {
      // the drives' own tiles: there before the card, gone with it — on Home, in the Hall and in «Устройства»
      const count = () => page.evaluate(`${R}.querySelectorAll(${JSON.stringify(parts.map(id => `[data-device-key="d:${id}"]`).join(',') || 'x')}).length`);
      const before = {}, after = {};
      const own = {}, cardCount = () => page.evaluate(`${R}.querySelectorAll('[data-device-key="p:${ID}"]').length`);
      for (const h of ['#home', '#rooms?room=prikhozhaia', '#systems']) { await open(h, 'ok', false); before[h] = await count(); await open(h, 'ok', true); after[h] = await count(); own[h] = await cardCount(); }
      // the card is put on Home and in the room: one tile on each — in the Hall too, where the NAS is none of the room's own devices (1.36.1)
      check(`${vp}: the card stands once on Home and once in the Hall`, own['#home'] === 1 && own['#rooms?room=prikhozhaia'] === 1, { own });
      // the panel lists a NAS's parts as «sensor (air)» (model/device-list.ts) and never draws them: with the card or without, no stray drive tiles
      check(`${vp}: no stray tiles of the pools, drives or volumes`, Object.values(after).every(x => x === 0) && Object.values(before).every(x => x === 0), { before, after });
      // a resident who is not an administrator: no power buttons, no modes
      await open(`#home?device=p:${ID}`, 'ok', true, false);
      check(`${vp}: not an administrator — no control`, (await q('[data-nas-manage]')).length === 0 && (await q('[data-nas-button]')).length === 0);
      // the administrator: each button asks first, in words; «Отмена» sends nothing
      await open(`#home?device=p:${ID}`, 'ok', true, true);
      check(`${vp}: administrator — restart and shut down are there`, (await q('[data-nas-button]')).length === 2);
      for (const k of ['reboot', 'shutdown']) {
        await page.evaluate(`${R}.querySelector('[data-nas-button="${k}"]').scrollIntoView({ block: 'center' })`); await page.locator(`[data-nas-button="${k}"]`).click(); await page.waitForTimeout(250);
        const ask = (await q('.at-setup-ask p'))[0] ?? ''; check(`${vp}: ${k} asks first, saying what happens`, k === 'reboot' ? /Перезагрузить NAS\?.*недоступны несколько минут/.test(ask) : /Выключить NAS\?.*кнопкой на корпусе/.test(ask), { ask });
        await shot(`admin-ask-${k}`); await page.locator('.at-setup-ask [data-answer="no"]').click(); await page.waitForTimeout(200);
        check(`${vp}: ${k} cancelled — nothing sent`, await log() === 0 && (await q('.at-setup-ask')).length === 0);
      }
      await scrollSheet('end'); await page.waitForTimeout(150); await shot('admin-manage');
      // a mode button sends exactly its option, on purpose, to the preview host (which refuses it): one command, said in words
      await page.locator('[data-nas-select="fanMode"] button', { hasText: 'Тихо' }).click(); await page.waitForTimeout(300);
      const sent = await page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => `${c.domain}.${c.service} ${c.data.entity_id} ${c.data.option}`));
      check(`${vp}: a fan mode tap sends that one option`, sent.length === 1 && sent[0] === 'select.select_option select.nas_fan_mode Quiet', { sent });
      check(`${vp}: the refusal is said`, (await q('.at-nas-err')).length === 1);
      // the catalog: the NAS under «network», its form filled from the house, its preview
      await open('#home?device=add-card', 'ok', false); await page.waitForSelector('.at-cards[data-step="list"]');
      await page.click('[data-tab="all"]'); await page.click('[data-category="network"]'); await page.waitForTimeout(200);
      const listed = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile)); check(`${vp}: the NAS in «network»`, listed.includes(P.id), { listed }); await shot('catalog-network');
      await page.click(`.at-cards-item[data-profile="${P.id}"]`); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(400);
      const ready = await page.evaluate(`${R}.querySelector('[data-action="add-card"]')?.getAttribute('aria-disabled') !== 'true'`); check(`${vp}: the form is filled and ready`, ready);
      await shot('catalog-form'); await page.evaluate(`${R}.querySelector('[data-part="preview"]')?.scrollIntoView({ block: 'start' })`); await page.waitForTimeout(250); await shot('catalog-preview');
      check(`${vp}: the preview draws the tile and the sheet`, (await q('.at-cards-preview .at-nas-sheet')).length === 1 && (await q('.at-cards-preview-tile > *')).length > 0);
      check(`${vp}: catalog — no commands`, await log() === 0);
    }
    await ctx.close();
  }
} finally {
  check('no page errors', errors.length === 0, { errors });
  await writeFile(resolve(out, 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks, errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
  process.exitCode = checks.every(c => c.p) ? 0 : 1;
}
