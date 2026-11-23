// The «speaker» family (src/appliances/speaker.*) on the Criuleni snapshot of 21.11.2026 and its settings, inside a shadow root as in HA:
//   - five cards (Max, Lite, Mini 2 in the kitchen, Mini 2 in the kids' room, the Mini 2 Assist satellite), each idle / playing / unavailable,
//     a phone (412×915) and a tablet (1280×800), light and dark: the sheet is drawn, nothing spills sideways, no page error;
//   - the tiles on Home say «Тишина», «артист — трек», «Нет связи»;
//   - a press on the kitchen Mini's play reaches the kitchen's player only (never the kids' one); otherwise no command leaves the panel;
//   - the socket's «off» asks first; the satellite's settings are an administrator's;
//   - «＋ Добавить карточку» → «Колонки» lists the four profiles.
// usage: node scripts/qa-speaker.mjs [out-dir]   (needs `npm run preview:build` first)
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixturePath } from './fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/speaker'); await mkdir(out, { recursive: true });
const live = JSON.parse(await readFile(fixturePath('criuleni-registry-live-20261121.json'), 'utf8'));
const baseConfig = JSON.parse(await readFile(fixturePath('criuleni-config-20261121.json'), 'utf8'));

// ---- the cards, bound the way the catalog suggests (by model and the integration's suffixes); the sockets as an installer would choose them ----
const MODELS = { max: 'Станция Макс (2020)', lite: 'Станция Лайт (2021)', mini: 'Станция Мини 2 (2021)', sat: 'satellite' };
const live_ = e => !e.disabled_by && live.states[e.entity_id];
const own = (dev, re) => live.entities.find(e => e.device_id === dev && live_(e) && re.test(e.entity_id))?.entity_id;
const station = dev => Object.fromEntries(Object.entries({ player: own(dev, /^media_player\./), equalizer: own(dev, /^select\..*_equalizer$/), alarms: own(dev, /^calendar\..*_alarms$/) }).filter(([, v]) => v));
const plugIn = area => { const sw = live.entities.find(e => live_(e) && /^switch\./.test(e.entity_id) && (e.area_id ?? live.devices.find(d => d.id === e.device_id)?.area_id) === area && /яндекс|yandex/i.test(String(live.states[e.entity_id].attributes.friendly_name ?? '')) && !e.entity_category); if (!sw) return {}; const pw = live.entities.find(e => e.device_id === sw.device_id && live_(e) && live.states[e.entity_id].attributes.unit_of_measurement === 'W'); return { plug: sw.entity_id, ...(pw ? { power: pw.entity_id } : {}) }; };
const devs = m => live.devices.filter(d => d.model === m);
const [maxD] = devs(MODELS.max), [liteD] = devs(MODELS.lite), minis = devs(MODELS.mini), [satD] = devs(MODELS.sat);
const kitchenD = minis.find(d => !station(d.id).equalizer) ?? minis[0], kidsD = minis.find(d => d !== kitchenD);
const satB = Object.fromEntries(Object.entries({ satellite: /^assist_satellite\./, player: /^media_player\..*_media_player$/, mics: /^switch\..*_microphones$/, hwMute: /^binary_sensor\..*_hardware_mic_mute$/, ring: /^light\..*_ring$/, wakeWord: /^select\..*_wake_word$/, wakeSound: /^switch\..*_wake_sound$/, voiceLight: /^switch\..*_voice_indication$/, visual: /^select\..*_music_visualization$/, nearest: /^switch\..*_nearest_station_answers$/, restart: /^button\..*_restart$/ }).map(([k, re]) => [k, own(satD.id, re)]).filter(([, v]) => v));
const CARDS = {
  spmax: { profileId: 'yandex.station_max', deviceId: maxD.id, bindings: { ...station(maxD.id), ...plugIn(maxD.area_id) } },
  splite: { profileId: 'yandex.station_lite', deviceId: liteD.id, bindings: { ...station(liteD.id), ...plugIn(liteD.area_id) } },
  spkitchen: { profileId: 'yandex.station_mini2', deviceId: kitchenD.id, bindings: station(kitchenD.id) },
  spkids: { profileId: 'yandex.station_mini2', deviceId: kidsD.id, bindings: station(kidsD.id) },
  spsat: { profileId: 'pulsar.mini2_satellite', deviceId: satD.id, bindings: satB, roomId: kitchenD.area_id },
};
const instances = Object.fromEntries(Object.entries(CARDS).map(([id, c]) => [id, { profileVersion: '1.0.0', placement: ['home', 'room'], ...c }]));
const COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b3d"/><stop offset="1" stop-color="#7a1fa2"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="200" r="120" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="18"/><circle cx="200" cy="200" r="30" fill="#fff" fill-opacity=".8"/></svg>');
/** the snapshot with every card in one state (`idle` lifts the kids' Mini, unavailable on 21.11, back to idle) */
function fixture(state) {
  const fx = structuredClone(live), now = new Date(Date.now() - 63_000).toISOString();
  for (const c of Object.values(CARDS)) {
    const p = c.bindings.player, main = c.bindings.satellite ?? p; if (!p) continue;
    const s = fx.states[p], a = s.attributes;
    if (state === 'playing') fx.states[p] = { ...s, state: 'playing', attributes: { ...a, media_title: c.bindings.satellite ? 'Радио Jazz' : 'Группа крови', media_artist: c.bindings.satellite ? undefined : 'Кино', media_album_name: 'Группа крови', entity_picture: c.bindings.satellite ? undefined : COVER, media_duration: 285, media_position: 0, media_position_updated_at: now, volume_level: a.volume_level ?? 0.4, is_volume_muted: false, shuffle: false, repeat: 'off', alice_state: 'IDLE', supported_features: c.bindings.satellite ? a.supported_features : 515981 | 16 | 32, source_list: undefined } };
    if (state === 'idle' && s.state === 'unavailable') fx.states[p] = { ...s, state: 'idle', attributes: { ...a, volume_level: 0.3, is_volume_muted: false, alice_state: 'IDLE', supported_features: 515981 } };
    if (state === 'unavailable') { fx.states[main] = { ...fx.states[main], state: 'unavailable', attributes: { friendly_name: fx.states[main].attributes.friendly_name } }; if (main !== p) fx.states[p] = { ...fx.states[p], state: 'unavailable', attributes: { friendly_name: a.friendly_name } }; }
  }
  return fx;
}
const config = theme => ({ ...structuredClone(baseConfig), home: { ...baseConfig.home, theme }, profileInstances: instances });

const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = [], errors = [];
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d)); };
const R = 'document.getElementById("root").shadowRoot';
try {
  for (const [vp, size] of [['phone', { width: 412, height: 915 }], ['tablet', { width: 1280, height: 800 }]]) for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 }), page = await ctx.newPage(); page.on('pageerror', e => errors.push(`${vp}/${theme}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${vp}/${theme} console: ${m.text()}`); });
    const open = async (hash, state, admin = true, inst = instances) => { await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
      await page.evaluate(async ({ cfg, fx, admin }) => { localStorage.clear(); localStorage.setItem('atom-home:config', JSON.stringify(cfg)); window.__beforeDraw = h => h.setAdmin(admin); await window.mountPreview(document.getElementById('root'), fx); }, { cfg: { ...config(theme), profileInstances: inst }, fx: fixture(state), admin }); await page.waitForTimeout(900); };
    const log = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws'));
    const tag = (...x) => [vp, theme, ...x].join('-');
    // 1. every card in every state
    for (const state of ['idle', 'playing', 'unavailable']) for (const id of Object.keys(CARDS)) {
      await open(`#home?device=p:${id}`, state);
      const info = await page.evaluate(`(() => { const s = ${R}.querySelector('[data-speaker="${id}"]'); if (!s) return null; const sc = s.closest('.hm-sheet, [role=dialog]') ?? s.parentElement; const wide = [...s.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); const b = s.getBoundingClientRect(); return r.width > 0 && (r.right > b.right + 1 || r.left < b.left - 1); }).map(e => e.className).slice(0, 4); return { phase: s.dataset.phase, over: s.scrollWidth - s.clientWidth, wide, text: s.textContent }; })()`);
      check(`${tag(id, state)}:sheet-drawn`, !!info, {});
      if (!info) continue;
      check(`${tag(id, state)}:nothing-spills`, info.over <= 1 && !info.wide.length, { over: info.over, wide: info.wide });
      const want = state === 'unavailable' ? 'offline' : state === 'playing' ? 'playing' : 'silent';
      check(`${tag(id, state)}:phase-${want}`, info.phase === want, { phase: info.phase });
      if (state === 'playing' && id !== 'spsat') check(`${tag(id, state)}:track-and-cover`, /Группа крови/.test(info.text) && /Кино/.test(info.text) && await page.evaluate(`!!${R}.querySelector('.at-sp-cover.has-cover img')`));
      if (state === 'unavailable') check(`${tag(id, state)}:says-no-connection`, /Нет связи/.test(info.text));
      await page.screenshot({ path: resolve(out, `${tag(id, state)}.png`) });
      if (vp === 'phone' && (id === 'spmax' || id === 'spsat') && state !== 'unavailable') { await page.evaluate(`${R}.querySelector('[data-speaker] .at-kt-cols')?.lastElementChild?.scrollIntoView({block:'end'})`); await page.waitForTimeout(200); await page.screenshot({ path: resolve(out, `${tag(id, state)}-lower.png`) }); }
    }
    check(`${tag()}:no-commands-while-looking`, (await log()).length === 0);
    // 2. the tiles on Home
    for (const state of ['idle', 'playing', 'unavailable']) {
      await open('#home', state);
      const text = await page.evaluate(`[...${R}.querySelectorAll('.ah-tile-text small')].map(x => x.textContent).join(' | ')`);
      const want = state === 'idle' ? /Тишина/ : state === 'playing' ? /Кино — Группа крови/ : /Нет связи/;
      check(`${tag('tiles', state)}:line`, want.test(text), { text: text.slice(0, 400) });
      if (state === 'idle') check(`${tag('tiles', state)}:satellite-ready`, /Готова слушать/.test(text));
      const first = await page.evaluate(`(() => { const s = [...${R}.querySelectorAll('.ah-tile-text small')].find(x => /Кино|Тишина|Нет связи|Готова/.test(x.textContent)); s?.scrollIntoView({block:'center'}); return !!s; })()`); await page.waitForTimeout(250);
      if (first) await page.screenshot({ path: resolve(out, `${tag('tiles', state)}.png`) });
    }
    // 3. the catalog: «Колонки»
    await open('#home?device=add-card', 'idle'); await page.waitForSelector('.at-cards[data-step="list"]'); await page.click('[data-tab="all"]'); await page.waitForTimeout(150); await page.click('[data-category="speakers"]'); await page.waitForTimeout(250);
    const listed = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile));
    check(`${tag('catalog')}:four-speakers`, ['yandex.station_max', 'yandex.station_lite', 'yandex.station_mini2', 'pulsar.mini2_satellite'].every(p => listed.includes(p)) && listed.length === 4, { listed });
    const titles = await page.$$eval('.at-cards-item strong', l => l.map(x => x.textContent)); check(`${tag('catalog')}:titles`, titles.every(x => x && !/^cat\./.test(x)), { titles });
    await page.screenshot({ path: resolve(out, `${tag('catalog')}.png`) });
    // a house with no speaker card yet: the Mini 2's form offers both Minis; the kitchen's fills itself and previews its own card
    await open('#home?device=add-card', 'idle', true, {}); await page.waitForSelector('.at-cards[data-step="list"]'); await page.click('[data-tab="all"]'); await page.waitForTimeout(150);
    { await page.click('.at-cards-item[data-profile="yandex.station_mini2"]'); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(300); check(`${tag('catalog')}:two-minis-offered`, await page.evaluate(`${R}.querySelectorAll('.at-cards-device').length`) === 2); await page.click(`.at-cards-device[data-device="${kitchenD.id}"]`); await page.waitForTimeout(400); await page.evaluate(`${R}.querySelector('[data-part="preview"]')?.scrollIntoView({block:'start'})`); await page.waitForTimeout(250); await page.screenshot({ path: resolve(out, `${tag('catalog-form-mini2')}.png`) }); check(`${tag('catalog')}:preview-drawn`, await page.evaluate(`${R}.querySelectorAll('.at-cards-preview-tile > *').length`) > 0); }
    check(`${tag()}:no-commands-in-catalog`, (await log()).length === 0);
    if (theme === 'light') {
      // 4. two Mini 2: the kitchen's play reaches the kitchen's player only
      await open('#home?device=p:spkitchen', 'idle'); await page.click('.at-sp-play'); await page.waitForTimeout(400);
      const sent = await log(); const ids = sent.map(c => c.data.entity_id);
      check(`${tag()}:kitchen-play-reaches-kitchen-only`, sent.length === 1 && ids[0] === CARDS.spkitchen.bindings.player && !ids.includes(CARDS.spkids.bindings.player), { sent });
      await open('#home?device=p:spkids', 'idle'); await page.click('.at-sp-play'); await page.waitForTimeout(400);
      const sent2 = await log(); check(`${tag()}:kids-play-reaches-kids-only`, sent2.length === 1 && sent2[0].data.entity_id === CARDS.spkids.bindings.player, { sent2 });
      // 5. the socket asks before it cuts the station's power; «Отмена» sends nothing
      await open('#home?device=p:spmax', 'idle'); await page.evaluate(`${R}.querySelector('[data-speaker-switch="plug"] button').click()`); await page.waitForTimeout(200);
      check(`${tag()}:plug-off-asks`, await page.evaluate(`!!${R}.querySelector('.at-sp-ask')`) && (await log()).length === 0); await page.screenshot({ path: resolve(out, `${tag('spmax-plug-ask')}.png`) });
      await page.evaluate(`${R}.querySelector('.at-sp-ask .hm-pill:not(.at-sp-yes)').click()`); await page.waitForTimeout(150); check(`${tag()}:plug-cancel-sends-nothing`, (await log()).length === 0);
      // «Сказать Алисе»: one play_media to this station
      await page.locator('.at-sp-field input').scrollIntoViewIfNeeded(); await page.fill('.at-sp-field input', 'включи джаз'); await page.evaluate(`${R}.querySelector('.at-sp-say-acts .hm-pill.is-primary').click()`); await page.waitForTimeout(300);
      const said = await log(); check(`${tag()}:say-alice`, said.length === 1 && said[0].service === 'play_media' && said[0].data.media_content_type === 'command' && said[0].data.entity_id === CARDS.spmax.bindings.player, { said });
      // 7. the house offline: said as the house's, not as a station without power; nothing is sent
      await open('#home?device=p:spmax', 'playing'); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(300);
      const offTxt = await page.evaluate(`${R}.querySelector('[data-speaker]')?.textContent ?? ''`);
      check(`${tag()}:house-offline-words`, /Нет связи с домом/.test(offTxt) && !/включена в розетку/.test(offTxt) && !/Группа крови/.test(offTxt), { offTxt: offTxt.slice(0, 200) }); await page.screenshot({ path: resolve(out, `${tag('spmax-house-offline')}.png`) });
      // 8. a volume moved while «play» still waits for the station: it is not lost, the last value goes out after it
      await open('#home?device=p:spmax', 'idle'); await page.evaluate(() => { window.atomPreview.setAccept(true); window.atomPreview.host.setDelay(600); });
      await page.evaluate(`${R}.querySelector('.at-sp-play').click()`); await page.waitForTimeout(100);
      await page.evaluate(`(() => { const i = ${R}.querySelector('.at-sp-vol input'); for (const v of [40, 52]) { i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
      await page.waitForTimeout(6500); const vl = (await log()).filter(c => c.service === 'volume_set');
      check(`${tag()}:volume-waits-not-lost`, vl.length === 1 && vl[0].data.volume_level === 0.52 && vl[0].data.entity_id === CARDS.spmax.bindings.player, { vl });
      // 9. the rooms (the «Кто тянет сейчас» list may name the station by its socket — that is no card): one card per station (no auto-made speaker beside it), its line, the room's alarms row still there
      for (const [id, dev] of [['spmax', maxD], ['spkitchen', kitchenD]]) {
        await open(`#rooms?room=${dev.area_id}`, 'playing'); await page.waitForTimeout(300);
        const room = await page.evaluate(`(() => { const r = ${R}; const names = [...r.querySelectorAll('.ah-tile-text strong, .rm-row-tx strong')].map(x => x.textContent.trim()).filter(x => /Станци/i.test(x)); return { names, alarms: !!r.querySelector('.rm-alarms'), text: r.textContent }; })()`);
        const want = id === 'spmax' ? /Станция Макс/ : /Станция Мини 2(?! Assist)/;
        check(`${tag('room', id)}:one-card`, room.names.filter(n => want.test(n) && !/Assist|сател/i.test(n)).length === 1, { names: room.names });
        check(`${tag('room', id)}:line`, /Кино — Группа крови/.test(room.text));
        check(`${tag('room', id)}:alarms-row-kept`, room.alarms);
        await page.screenshot({ path: resolve(out, `${tag('room', id)}.png`) });
      }
      // 6. the satellite's settings: an administrator's only
      await open('#home?device=p:spsat', 'idle', false); check(`${tag()}:sat-no-gear-for-resident`, !(await page.evaluate(`!!${R}.querySelector('[data-speaker] .at-kt-gear')`)));
      await open('#home?device=p:spsat', 'idle', true); await page.click('[data-speaker] .at-kt-gear'); await page.waitForTimeout(200); await page.screenshot({ path: resolve(out, `${tag('spsat-settings')}.png`) });
      await page.evaluate(`${R}.querySelector('.at-sp-restart').click()`); await page.waitForTimeout(150); check(`${tag()}:restart-asks`, await page.evaluate(`!!${R}.querySelector('.at-sp-ask')`) && (await log()).length === 0);
    }
    await ctx.close();
  }
} finally {
  check('no-page-errors', errors.length === 0, { errors: errors.slice(0, 10) });
  await writeFile(resolve(out, 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks, errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
}
