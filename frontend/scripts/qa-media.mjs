// The media family (TVs and TV boxes) on the Criuleni snapshot of 21.11.2026 and its settings, inside a shadow root as in HA, phone 412×915
// and tablet 1280×800, light and dark:
//   - every model's sheet in four states (off / on / playing / unavailable): drawn, its state said, nothing overflows, no page errors;
//   - the Home tiles of the six cards say their line; the AirPlay twin of the 55U6 and the SmartThings twin of the Samsung have no tile of their own;
//   - «＋ Добавить карточку» → «Телевизоры и приставки» lists the six models; the Hisense form fills its fields and previews the card;
//   - no command reaches a device, except one OK pressed on purpose on the Living room TV's pad: it goes to remote.living_tv only, as KEY_OK.
// usage: node scripts/qa-media.mjs [out-dir]   (after `npm run preview:build`)
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixturePath } from './fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/media'); await mkdir(out, { recursive: true });
const live = await readFile(fixturePath('criuleni-registry-live-20261121.json'), 'utf8');
const houseConfig = await readFile(fixturePath('criuleni-config-20261121.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(live); return; }
  if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(houseConfig); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;

// the six cards, bound as the catalog form binds them (the sibling fields picked by the installer)
const CARDS = {
  cLiving: { profileId: 'hisense.65u8kq', deviceId: 'c339d2b7922ebb3d7dee15e8a8e29fb8', bindings: { tv: 'media_player.living_tv', remote: 'remote.living_tv', app: 'sensor.living_tv_active_app', source: 'sensor.living_tv_active_source', pictureMode: 'select.living_tv_picture_mode', soundMode: 'select.living_tv_sound_mode', backlight: 'number.living_tv_backlight', brightness: 'number.living_tv_brightness', contrast: 'number.living_tv_contrast', audioOnly: 'switch.living_tv_audio_only' } },
  cKids: { profileId: 'hisense.55u6', deviceId: 'a1fbaf6aa3512bb01267a26ecc90b7af', bindings: { tv: 'media_player.kids_tv', remote: 'remote.kids_tv', app: 'sensor.kids_tv_active_app', source: 'sensor.kids_tv_active_source', pictureMode: 'select.kids_tv_picture_mode', soundMode: 'select.kids_tv_sound_mode', backlight: 'number.kids_tv_backlight', brightness: 'number.kids_tv_brightness', contrast: 'number.kids_tv_contrast', audioOnly: 'switch.kids_tv_audio_only', airplay: 'media_player.kids_tv_airplay' } },
  cSamsung: { profileId: 'samsung.q60t', deviceId: '9b0b4d59d91437ab0c241956da3cfbf3', bindings: { tv: 'media_player.bedroom_tv', remote: 'remote.bedroom_tv', smartthings: 'media_player.bedroom_tv_smartthings', pictureMode: 'select.spalnia_spalnia_televizor_smartthings_samsung_qe50q60t_picture_mode', channel: 'sensor.bedroom_tv_channel', channelName: 'sensor.bedroom_tv_channel_name' } },
  cApple: { profileId: 'apple.tv4k3', deviceId: '149d56f98bdc5fae322bf9531665a348', bindings: { tv: 'media_player.living_appletv', remote: 'remote.living_appletv' } },
  cStick: { profileId: 'xiaomi.mitv_stick', deviceId: 'cf46578fb719da34527f1c1814e0bf6d', bindings: { tv: 'media_player.kids_mitv_stick', remote: 'remote.kids_mitv_stick' } },
  cCast: { profileId: 'google.chromecast', deviceId: 'b9a72dcb8e854d8413e04ae7cee02ecb', bindings: { tv: 'media_player.bedroom_chromecast', remote: 'remote.bedroom_chromecast' } },
};
// cover art without the network: a small drawn poster
const ART = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5f6d"/><stop offset="1" stop-color="#3a1c71"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="60" r="26" fill="#fff" opacity=".85"/><path d="M52 46v28l22-14z" fill="#3a1c71"/></svg>').toString('base64');
// the states of each card: [entity → state, attributes]
const on = (extra = {}) => ['on', { volume_level: 0.11, is_volume_muted: false, ...extra }];
const SCEN = {
  off: {},
  on: { 'media_player.living_tv': on({ source: 'HDMI3', media_title: 'Apple TV' }), 'remote.living_tv': ['on'], 'sensor.living_tv_active_source': ['HDMI3'],
    'media_player.kids_tv': on({ source: 'HDMI1', media_title: 'Mi TV Stick' }), 'remote.kids_tv': ['on'],
    'media_player.bedroom_tv': on({ source: 'TV' }), 'remote.bedroom_tv': ['on'], 'media_player.bedroom_tv_smartthings': ['on', { sound_mode: 'Стандартный', source: 'digital_tv' }], 'select.spalnia_spalnia_televizor_smartthings_samsung_qe50q60t_picture_mode': ['Стандартный'], 'sensor.bedroom_tv_channel': ['5'], 'sensor.bedroom_tv_channel_name': ['Moldova 1'],
    'media_player.living_appletv': ['idle', { app_name: 'TV' }], 'remote.living_appletv': ['on'],
    'media_player.kids_mitv_stick': on({ app_name: 'Kinopub' }), 'remote.kids_mitv_stick': ['on'],
    'media_player.bedroom_chromecast': on({ app_name: 'YouTube', restored: undefined }), 'remote.bedroom_chromecast': ['on'] },
  playing: { 'media_player.living_tv': ['playing', { volume_level: 0.18, is_volume_muted: false, source: 'YouTube', app_name: 'YouTube', media_title: 'Карпаты: зимний поход — фильм о горах', entity_picture: ART }], 'remote.living_tv': ['on'], 'sensor.living_tv_active_app': ['YouTube'],
    'media_player.kids_tv': ['playing', { volume_level: 0.24, is_volume_muted: true, source: 'HDMI1', media_title: 'Mi TV Stick' }], 'remote.kids_tv': ['on'],
    'media_player.bedroom_tv': ['playing', { volume_level: 0.09, is_volume_muted: false, source: 'TV' }], 'remote.bedroom_tv': ['on'], 'media_player.bedroom_tv_smartthings': ['on', { sound_mode: 'Усиление' }], 'select.spalnia_spalnia_televizor_smartthings_samsung_qe50q60t_picture_mode': ['Кино'], 'sensor.bedroom_tv_channel_name': ['Moldova 1'],
    'media_player.living_appletv': ['playing', { app_name: 'Infuse', source: 'Infuse', media_title: 'The Long Way Home', media_artist: 'S1 · E3', entity_picture: ART, volume_level: 0.4 }], 'remote.living_appletv': ['on'],
    // Android TV Remote does not report playback (HA docs): «on» with the open app is all it ever says
    'media_player.kids_mitv_stick': ['on', { app_name: 'YouTube Kids', is_volume_muted: false }], 'remote.kids_mitv_stick': ['on'],
    'media_player.bedroom_chromecast': ['on', { app_name: 'Netflix', restored: undefined }], 'remote.bedroom_chromecast': ['on'] },
  unavailable: Object.fromEntries(Object.values(CARDS).flatMap(c => Object.values(c.bindings)).map(id => [id, ['unavailable']])),
};
const WANT = { off: id => id === 'cCast' ? 'unavailable' : 'off', on: () => 'on', playing: id => id === 'cStick' || id === 'cCast' ? 'on' : 'playing', unavailable: () => 'unavailable' };

const browser = await chromium.launch(); const checks = []; const errors = [];
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d)); };
const R = () => document.getElementById('root').shadowRoot;
try {
  for (const [vp, size] of [['phone', { width: 412, height: 915 }], ['tablet', { width: 1280, height: 800 }]]) for (const theme of ['light', 'dark']) {
    const page = await (await browser.newContext({ viewport: size, deviceScaleFactor: 2 })).newPage(); page.on('pageerror', e => errors.push(`${vp}/${theme}: ${e.message}`));
    const open = async (hash, scen, cards = CARDS) => { await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
      await page.evaluate(async ({ theme, over, cards }) => { localStorage.clear(); const cfg = JSON.parse(await (await fetch('/config.json')).text()); cfg.home.theme = theme; cfg.home.language = 'ru';
        cfg.profileInstances = Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, { ...c, profileVersion: '1.0.0', placement: ['home', 'room'] }])); localStorage.setItem('atom-home:config', JSON.stringify(cfg));
        const fx = await (await fetch('/fixture.json')).json();
        for (const [id, [state, attrs]] of Object.entries(over)) { const s = fx.states[id]; if (!s) continue; const a = { ...s.attributes, ...(attrs ?? {}) }; for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k]; fx.states[id] = { ...s, state, attributes: a }; }
        await window.mountPreview(document.getElementById('root'), fx); }, { theme, over: SCEN[scen] ?? {}, cards }); await page.waitForTimeout(900); };
    const log = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws'));
    const tag = `${vp}/${theme}`;
    // 1. every model in every state
    for (const scen of Object.keys(SCEN)) for (const id of Object.keys(CARDS)) {
      await open(`#home?device=p:${id}`, scen);
      const r = await page.evaluate(id => { const sh = document.getElementById('root').shadowRoot, s = sh.querySelector('.at-md-sheet'); if (!s) return null; const over = [...s.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(), p = s.getBoundingClientRect(); return b.width > 0 && !e.closest('.at-md-art-bg') && (b.right > p.right + 1 || b.left < p.left - 1); }).map(e => e.className?.baseVal ?? e.className).slice(0, 4);
        return { profile: s.dataset.media, phase: s.dataset.phase, title: s.querySelector('.at-md-head h2')?.textContent, said: s.querySelector('.at-md-what small')?.textContent, big: s.querySelector('.at-md-what b')?.textContent ?? null, over, wide: s.scrollWidth > s.clientWidth + 1, keys: s.querySelectorAll('.at-md-ring button').length, chips: s.querySelectorAll('.at-md-chips button').length, err: s.querySelector('[role="alert"]')?.textContent ?? null }; }, id);
      const name = `${tag}/${scen}/${id}`;
      check(`${name}: sheet drawn`, r && r.profile === CARDS[id].profileId, r ?? {});
      if (!r) continue;
      check(`${name}: phase ${WANT[scen](id)}`, r.phase === WANT[scen](id), { phase: r.phase, said: r.said });
      check(`${name}: nothing overflows`, !r.over.length && !r.wide, { over: r.over });
      check(`${name}: no error shown`, !r.err, { err: r.err });
      if (scen === 'playing' && ['cLiving', 'cApple', 'cStick', 'cCast'].includes(id)) check(`${name}: says what plays`, !!r.big && r.big !== 'Ничего не запущено', r);
      if (scen === 'on' && id === 'cLiving') check(`${name}: the input by its device, inputs listed`, r.big === 'Apple TV' && r.chips >= 6, r);
      await page.screenshot({ path: resolve(out, `${vp}-${theme}-${scen}-${CARDS[id].profileId.replace(/\W/g, '_')}.png`) });
      if (scen === 'playing' && ['cLiving', 'cSamsung'].includes(id) && vp === 'phone') { // the gear: picture and sound
        const gear = await page.$('.at-md-gear'); check(`${name}: gear`, !!gear); if (gear) { await gear.click(); await page.waitForTimeout(250); const n = await page.evaluate(() => document.getElementById('root').shadowRoot.querySelectorAll('[data-media-set]').length); check(`${name}: picture and sound rows`, n >= (id === 'cLiving' ? 6 : 2), { n }); await page.screenshot({ path: resolve(out, `${vp}-${theme}-${scen}-${CARDS[id].profileId.replace(/\W/g, '_')}-settings.png`) }); }
      }
      check(`${name}: no commands`, (await log()).length === 0);
    }
    // 2. the Home tiles and the twins
    await open('#home', 'playing'); await page.waitForTimeout(300);
    const tiles = await page.evaluate(ids => { const sh = document.getElementById('root').shadowRoot; return { lines: Object.fromEntries(ids.map(id => [id, sh.querySelector(`[data-device-key="p:${id}"] .ah-tile-text small`)?.textContent ?? null])), twins: [...sh.querySelectorAll('[data-device-key]')].map(e => e.dataset.deviceKey).filter(k => /airplay|smartthings/.test(k)) }; }, Object.keys(CARDS));
    check(`${tag}: home tiles say their line`, tiles.lines.cLiving?.startsWith('YouTube · Карпаты') && tiles.lines.cApple?.startsWith('Infuse · The Long Way Home') && /^Mi TV Stick( · |$)/.test(tiles.lines.cKids ?? '') && tiles.lines.cSamsung?.startsWith('Телевидение · Moldova 1') && tiles.lines.cCast?.startsWith('Включён · Netflix'), tiles.lines);
    check(`${tag}: no AirPlay / SmartThings twin tile`, tiles.twins.length === 0, tiles);
    await page.evaluate(() => document.getElementById('root').shadowRoot.querySelector('[data-device-key="p:cLiving"]')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(out, `${vp}-${theme}-home-tiles.png`), fullPage: false });
    // 3. the catalog: «Телевизоры и приставки»
    await open('#home?device=add-card', 'off', {}); // no card yet: the TVs are offered, not «already has a card» await page.waitForSelector('.at-cards[data-step="list"]', { timeout: 5000 }).catch(() => undefined);
    await page.click('[data-tab="all"]').catch(() => undefined); await page.waitForTimeout(150); await page.click('[data-category="tv"]').catch(() => undefined); await page.waitForTimeout(250);
    const list = await page.$$eval('.at-cards-item', l => l.map(x => ({ id: x.dataset.profile, title: x.querySelector('strong')?.textContent })));
    check(`${tag}: catalog «tv» lists the six models`, list.length === 6 && ['hisense.65u8kq', 'hisense.55u6', 'samsung.q60t', 'apple.tv4k3', 'xiaomi.mitv_stick', 'google.chromecast'].every(id => list.some(x => x.id === id)) && list.every(x => x.title && !/^cat\./.test(x.title)), { list });
    await page.screenshot({ path: resolve(out, `${vp}-${theme}-catalog-tv.png`) });
    if (theme === 'light') {
      await page.click('.at-cards-item[data-profile="hisense.65u8kq"]'); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(350);
      const form = await page.evaluate(() => { const r = document.getElementById('root').shadowRoot, b = r.querySelector('[data-action="add-card"]'); return { ready: !!b && b.getAttribute('aria-disabled') !== 'true', preview: r.querySelectorAll('.at-cards-preview-tile > *').length, sheet: !!r.querySelector('.at-md-sheet') }; });
      check(`${tag}: Hisense form filled and previewed`, form.ready && form.preview > 0 && form.sheet, form);
      await page.screenshot({ path: resolve(out, `${vp}-${theme}-catalog-form-hisense.png`) });
      // the preview is inert and drawn on a host that refuses: even a scripted press sends nothing
      await page.evaluate(() => { const r = document.getElementById('root').shadowRoot; for (const b of r.querySelectorAll('.at-cards-preview .at-md-sheet button')) b.click(); }); await page.waitForTimeout(300);
    }
    check(`${tag}: catalog sent nothing`, (await log()).length === 0);
    // 4. one OK pressed on purpose on the Living room TV: to its own remote only, as VIDAA's KEY_OK
    if (vp === 'phone' && theme === 'light') {
      await open('#home?device=p:cLiving', 'on'); await page.click('.at-md-ok'); await page.waitForTimeout(400);
      const sent = await log(); check(`${tag}: OK → remote.living_tv KEY_OK only`, sent.length === 1 && sent[0].domain === 'remote' && sent[0].service === 'send_command' && sent[0].data.entity_id === 'remote.living_tv' && sent[0].data.command === 'KEY_OK', { sent });
      await page.screenshot({ path: resolve(out, `${vp}-${theme}-pressed-ok-refused-by-preview.png`) });
      // the Home tile: a tap opens the TV's card and sends nothing (appliance cards open on a tap; power is the card's first button)
      await open('#home', 'on'); await page.evaluate(() => document.getElementById('root').shadowRoot.querySelector('[data-device-key="p:cLiving"]')?.scrollIntoView({ block: 'center' }));
      await page.click('[data-device-key="p:cLiving"] .ah-tile-hit'); await page.waitForTimeout(400);
      const tap = await log();
      check(`${tag}: tile tap opens the TV sheet and sends nothing`, tap.length === 0 && await page.evaluate(() => document.getElementById('root').shadowRoot.querySelector('.at-md-sheet')?.dataset.media === 'hisense.65u8kq'), { tap });
      // the house offline: everything quiet, nothing sent
      await open('#home?device=p:cLiving', 'on'); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(300);
      const off = await page.evaluate(() => { const s = document.getElementById('root').shadowRoot.querySelector('.at-md-sheet'); return { phase: s?.dataset.phase, enabled: [...(s?.querySelectorAll('.at-md-ring button, .at-md-acts button') ?? [])].filter(b => !b.disabled).length }; });
      check(`${tag}: house offline — nothing to press`, off.phase === 'offline' && off.enabled === 0, off);
      await page.screenshot({ path: resolve(out, `${vp}-${theme}-house-offline.png`) });
    }
    await page.context().close();
  }
} finally {
  check('no-page-errors', errors.length === 0, { errors });
  await writeFile(resolve(out, 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks: checks.filter(c => !c.p).concat(checks.filter(c => c.p).map(c => ({ n: c.n, p: true }))), errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
}
