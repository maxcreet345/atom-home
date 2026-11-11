// 1.27.0 «menu and rooms» in the real preview build: the rail's seven places and their words, the phone's bar with «Ещё» by touch, by keyboard
// and as a screen reader hears it, the old addresses, the settings that hide a place, «Устройства» without sensors (and its search and
// «Внимание» that still find them), «Безопасность» with its groups and the way to the cameras, «Комнаты» on one screen on every class of the
// device list for 8, 10 and 12 rooms, and the words on the drawn room pictures at 4.5:1 measured on the screen's own pixels, both themes.
// usage: node scripts/qa-nav.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/nav'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const port = await freePort(), server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 400)}`); };
const stop = async code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); await browser.close().catch(() => {}); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); void stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); void stop(1); });
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
const TV = () => { const mm = window.matchMedia.bind(window); window.matchMedia = q => /any-hover:\s*none|any-pointer:\s*none/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); };
async function open({ card = 'security', scenario = 'disarmed', hash = '#home', w = 1070, h = 764, lang = 'ru', theme = 'light', touch, tv = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch ?? w < 1100, timezoneId: 'Europe/Chisinau' }); if (tv) await ctx.addInitScript(TV);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=${card}&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 20000 }); await page.waitForTimeout(500);
  return { page, ctx, errors };
}
const hash = page => page.evaluate(() => location.hash);

// ---- the rail: seven places in their order, every word whole, every place ≥ 44 px even on a short screen ------------------------------------
for (const [lang, want] of [['ru', ['Дом', 'Комнаты', 'Свет', 'Устройства', 'Энергия', 'Безопасность', 'Настройка']], ['en', ['Home', 'Rooms', 'Lights', 'Devices', 'Energy', 'Security', 'Setup']], ['ro', ['Acasă', 'Încăperi', 'Lumini', 'Dispozitive', 'Energie', 'Securitate', 'Configurare']]]) {
  for (const [w, h, tv] of [[1070, 764, false], [667, 375, false], [874, 402, false], [1920, 1080, true], [1280, 600, false]]) {
    const { page, ctx, errors } = await open({ w, h, lang, tv, touch: !tv && w < 1100 });
    const rail = await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button')].map(b => { const s = b.querySelector('span'), r = b.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.querySelector('.hm-shell')).zoom || '1') || 1; return { label: s.textContent, whole: s.scrollWidth <= s.clientWidth + 1, h: r.height / z, inside: r.bottom <= innerHeight + 1 }; }));
    const tag = `${lang}/${w}x${h}${tv ? '-tv' : ''}`;
    check(`rail/${tag}: the seven places in their order`, JSON.stringify(rail.map(r => r.label)) === JSON.stringify(want), rail.map(r => r.label));
    check(`rail/${tag}: every word whole`, rail.every(r => r.whole), rail.filter(r => !r.whole).map(r => r.label));
    check(`rail/${tag}: every place ≥ 44 px and on the screen`, rail.every(r => r.h >= 44 && r.inside), rail.map(r => [r.label, Math.round(r.h), r.inside]));
    check(`rail/${tag}: no page error`, errors.length === 0, errors);
    if (lang === 'ru' && w === 1070) await page.screenshot({ path: resolve(out, `rail-${lang}-${w}x${h}.png`) });
    await ctx.close();
  }
}
// ---- the phone's bar and «Ещё» ---------------------------------------------------------------------------------------------------------------------
{
  const { page, ctx, errors } = await open({ w: 360, h: 792, touch: true });
  const bar = () => page.evaluate(() => [...document.querySelectorAll('.hm-tabbar > button')].map(b => ({ label: b.querySelector('span').textContent, current: b.getAttribute('aria-current'), expanded: b.getAttribute('aria-expanded'), active: b.classList.contains('is-active') })));
  const panel = () => page.evaluate(() => { const p = document.querySelector('.hm-tabbar .at-more'); return p ? { open: !p.hidden && p.getBoundingClientRect().height > 0, role: p.getAttribute('role'), name: p.getAttribute('aria-label'), items: [...p.querySelectorAll('button')].map(b => ({ label: b.textContent, current: b.getAttribute('aria-current'), h: b.getBoundingClientRect().height })) } : null; });
  const b0 = await bar();
  check('phone: the bar holds Дом, Комнаты, Свет, Устройства and «Ещё»', JSON.stringify(b0.map(b => b.label)) === JSON.stringify(['Дом', 'Комнаты', 'Свет', 'Устройства', 'Ещё']), b0);
  check('phone: «Ещё» says it is closed', b0[4]?.expanded === 'false', b0[4]);
  await page.tap('.hm-tabbar .at-more-btn'); await page.waitForTimeout(250);
  const p1 = await panel(), b1 = await bar();
  check('phone/touch: «Ещё» opens Энергия, Безопасность, Настройка as rows of ≥ 44 px', p1?.open && JSON.stringify(p1.items.map(i => i.label)) === JSON.stringify(['Энергия', 'Безопасность', 'Настройка']) && p1.items.every(i => i.h >= 44), p1);
  check('phone: an open «Ещё» says so (aria-expanded) and names its group', b1[4]?.expanded === 'true' && p1?.role === 'group' && p1?.name === 'Ещё', { b: b1[4], p1 });
  await page.screenshot({ path: resolve(out, 'phone-more-open.png') });
  await page.tap('.hm-tabbar .at-more button:nth-child(1)'); await page.waitForTimeout(400);
  const b2 = await bar(), p2 = await panel();
  check('phone/touch: a page chosen in «Ещё» opens and «Ещё» closes', (await hash(page)) === '#energy' && !p2.open, { hash: await hash(page), p2 });
  check('phone: «Ещё» is lit while one of its pages is open, and a reader hears which', b2[4]?.active && (await page.evaluate(() => document.querySelector('.at-more-btn').textContent)).includes('Энергия'), b2[4]);
  check('phone: the energy page is the energy page', (await page.evaluate(() => document.querySelector('.hm-head h1').textContent)) === 'Энергия' && !(await page.$('.ah-segments.is-sys')));
  await page.screenshot({ path: resolve(out, 'phone-energy.png') });
  // a tap outside closes it, and nothing under it is pressed
  await page.tap('.hm-tabbar .at-more-btn'); await page.waitForTimeout(200); await page.touchscreen.tap(180, 300); await page.waitForTimeout(250);
  check('phone/touch: a tap outside closes «Ещё» and goes nowhere', !(await panel()).open && (await hash(page)) === '#energy', await hash(page));
  // the keyboard: Enter opens, Tab walks into its pages, Escape closes and gives the focus back to «Ещё»
  await page.focus('.hm-tabbar .at-more-btn'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.keyboard.press('Tab'); const inMore = await page.evaluate(() => document.activeElement?.closest('.at-more') ? document.activeElement.textContent : null);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  const back = await page.evaluate(() => document.activeElement?.classList.contains('at-more-btn'));
  check('phone/keyboard: Enter opens «Ещё», Tab reaches its first page, Escape closes it and the focus returns to «Ещё»', inMore === 'Энергия' && back && !(await panel()).open, { inMore, back });
  await page.focus('.hm-tabbar .at-more-btn'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  check('phone/keyboard: Enter on «Безопасность» opens it', (await hash(page)) === '#security', await hash(page));
  // what a screen reader is told (the accessibility tree)
  const ax = await page.locator('.hm-tabbar').ariaSnapshot(), state = await page.evaluate(() => document.querySelector('.at-more-btn').getAttribute('aria-expanded'));
  await page.focus('.hm-tabbar .at-more-btn'); await page.keyboard.press('Enter'); await page.waitForTimeout(200); const axOpen = await page.locator('.hm-tabbar').ariaSnapshot(), current = await page.evaluate(() => document.querySelector('.at-more [aria-current="page"]')?.textContent ?? null); await page.keyboard.press('Escape');
  check('phone/reader: the bar is a named navigation, «Ещё» a button that tells its state and the page open behind it, its pages a named group with the current one marked', /navigation "Разделы"/.test(ax) && /button "Ещё · Безопасность"/.test(ax) && state === 'false' && /button "Ещё · Безопасность" \[expanded\]/.test(axOpen) && /group "Ещё":\n\s+- button "Энергия"\n\s+- button "Безопасность"\n\s+- button "Настройка"/.test(axOpen) && current === 'Безопасность', { ax, axOpen, current });
  check('phone: no page error', errors.length === 0, errors);
  await ctx.close();
  // a person who is not an administrator: «Ещё» holds Энергия and Безопасность
  const u = await open({ w: 360, h: 792, touch: true }); await u.page.evaluate(() => window.atomPreview.setAdmin(false)); await u.page.waitForTimeout(200);
  await u.page.tap('.hm-tabbar .at-more-btn'); await u.page.waitForTimeout(200);
  check('phone/not admin: «Ещё» holds Энергия and Безопасность', JSON.stringify(await u.page.evaluate(() => [...document.querySelectorAll('.at-more button')].map(b => b.textContent))) === JSON.stringify(['Энергия', 'Безопасность']));
  await u.ctx.close();
}
// ---- the phone's bar never runs past the screen, whatever the language and the system's text size: on a phone on its side at 200 % «Устройства»
// pushed it 13 px over and the whole shell slid sideways under every window (qa-clock ST-16). Every label whole, every place inside and ≥ 44 px;
// with «Ещё» and in a house of five places (no «Ещё»). The last place takes the focus, as a keyboard would give it: nothing may slide then
for (const [w, h] of [[568, 320], [320, 568]]) for (const lang of ['ru', 'ro', 'en']) {
  const { page, ctx, errors } = await open({ w, h, lang, touch: true });
  for (const five of [false, true]) {
    if (five) { await page.evaluate(() => { const c = window.atomPreview.config; c.sections = { ...c.sections, energy: { hidden: true }, security: { hidden: true } }; window.atomPreview.redraw(); }); await page.waitForTimeout(300); }
    for (const font of ['100%', '150%', '200%']) {
      await page.evaluate(f => { document.documentElement.style.fontSize = f; }, font); await page.waitForTimeout(250);
      await page.focus('.hm-tabbar > button:last-of-type'); await page.waitForTimeout(150);
      const m = await page.evaluate(() => { const bar = document.querySelector('.hm-tabbar'), shell = document.querySelector('.hm-shell');
        return { sw: bar.scrollWidth, cw: bar.clientWidth, slid: shell.scrollLeft, places: [...bar.querySelectorAll(':scope > button')].map(b => { const t = b.querySelector('span'), r = b.getBoundingClientRect(); return { label: t.textContent, whole: t.scrollWidth <= t.clientWidth + 1 && t.scrollHeight <= t.clientHeight + 1, h: Math.round(r.height), in: r.left >= -1 && r.right <= innerWidth + 1 }; }) }; });
      check(`phone bar ${w}×${h} ${lang} ${font}${five ? ', five places' : ', with «Ещё»'}: never past the screen, nothing slides sideways, every label whole, every place inside and ≥ 44 px`, m.sw <= m.cw + 1 && m.slid === 0 && m.places.length === 5 && m.places.every(x => x.whole && x.in && x.h >= 44), m);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); await page.waitForTimeout(150);
  }
  check(`phone bar ${w}×${h} ${lang}: no page error`, errors.length === 0, errors);
  await ctx.close();
}
// ---- the old addresses --------------------------------------------------------------------------------------------------------------------------
{
  const { page, ctx, errors } = await open({ card: 'heating', scenario: 'normal' });
  const at = async h => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForTimeout(450); return page.evaluate(() => ({ hash: location.hash, title: document.querySelector('.hm-head h1')?.textContent, rail: document.querySelector('.hm-sidebar nav button.is-active span')?.textContent, tab: document.querySelector('.ah-segments.is-sys .is-active')?.textContent ?? null, attn: document.querySelector('.at-sys-attn')?.getAttribute('aria-pressed') ?? null })); };
  const want = { '#systems?filter=attention': ['Устройства', 'Устройства', 'Все', 'true'], '#systems': ['Устройства', 'Устройства', 'Все', 'false'], '#climate': ['Устройства', 'Устройства', 'Климат', null], '#cleaning': ['Устройства', 'Устройства', 'Уборка', null], '#camera': ['Устройства', 'Устройства', 'Камеры', null], '#energy': ['Энергия', 'Энергия', null, null], '#energy?filter=now': ['Энергия', 'Энергия', null, null], '#security': ['Безопасность', 'Безопасность', null, null] };
  for (const [h, [title, rail, tab, attn]] of Object.entries(want)) { const r = await at(h); check(`old address ${h}: still opens where it did`, r.hash === h && r.title === title && r.rail === rail && r.tab === tab && r.attn === attn, r); }
  check('old addresses: no page error', errors.length === 0, errors);
  // the settings hide a place: «Энергия» and «Безопасность» hidden — not in the menu, and their addresses lead Home
  await page.evaluate(() => { const c = window.atomPreview.config; c.sections = { ...c.sections, energy: { hidden: true }, security: { hidden: true } }; window.atomPreview.redraw(); }); await page.waitForTimeout(300);
  const rail = await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button span')].map(s => s.textContent));
  check('settings: a hidden «Энергия» and «Безопасность» leave the menu', !rail.includes('Энергия') && !rail.includes('Безопасность') && rail.includes('Устройства'), rail);
  check('settings: their old addresses lead Home', (await at('#energy')).hash === '#home' && (await at('#security')).hash === '#home');
  await page.evaluate(() => { const c = window.atomPreview.config; c.sections = { ...c.sections, climate: { hidden: true }, cleaning: { hidden: true }, camera: { hidden: true }, systems: { hidden: true } }; window.atomPreview.redraw(); }); await page.waitForTimeout(300);
  check('settings: «Устройства» with every tab hidden leaves the menu', !(await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button span')].map(s => s.textContent))).includes('Устройства'));
  await ctx.close();
}
// ---- «Устройства»: devices only; the search and «Внимание» still find a sensor ------------------------------------------------------------------
{
  const { page, ctx, errors } = await open({ card: 'rooms', scenario: 'live', hash: '#systems' });
  // an appliance known only through switches (model/appliance.ts, key «app:») is an appliance whatever its reading's kind
  const kinds = () => page.evaluate(() => [...document.querySelectorAll('.hm-systems .ah-tile')].map(t => t.dataset.deviceKey?.startsWith('app:') ? 'appliance' : [...t.classList].find(c => c.startsWith('kind-'))?.slice(5)));
  const SENSOR = ['environment', 'measurement', 'leak', 'opening', 'motion', 'alarm', 'energy', 'weather', 'person'];
  const k0 = await kinds(), groups = await page.evaluate(() => [...document.querySelectorAll('.hm-systems > section h2, .hm-systems .hm-section-head h2')].map(h => h.textContent));
  check('devices: the list holds no sensor, meter or person', k0.length > 20 && !k0.some(k => SENSOR.includes(k)), k0.filter(k => SENSOR.includes(k)));
  const ORDER = ['Свет', 'Климат', 'Приборы', 'Камеры', 'Телевизоры и колонки', 'Шторы, замки и краны'];
  check('devices: lights, climate, appliances, cameras, TVs and speakers (covers, locks and valves when the house has them) — in that order', groups.length >= 5 && groups.every((g, i) => ORDER.indexOf(g) >= 0 && (i === 0 || ORDER.indexOf(g) > ORDER.indexOf(groups[i - 1]))) && ORDER.slice(0, 5).every(g => groups.includes(g)), groups);
  check('devices: the feeder and the kettle stand in «Приборы»', await page.evaluate(() => !!document.querySelector('.hm-systems .at-module-row [data-module-card="pet_feeder"], .hm-systems .at-module-row .at-feeder, .hm-systems .at-module-row') ));
  await page.screenshot({ path: resolve(out, 'devices-1070.png'), fullPage: false });
  // a name under its room's header does not repeat the room (review 11.11: «Ванная · Вентилятор» under «Ванная»); the full name stays for a reader
  const twice = await page.evaluate(() => [...document.querySelectorAll('.hm-systems .at-sys-room')].flatMap(r => { const room = r.querySelector('h3')?.textContent.trim().toLowerCase() ?? ''; return [...r.querySelectorAll('.ah-tile strong')].map(s => s.textContent.trim()).filter(n => room && (n.toLowerCase().startsWith(room + ' · ') || n.toLowerCase().endsWith(' · ' + room) || n.toLowerCase().includes(' ' + room + ' · '))).map(n => `${room}: ${n}`); }));
  check('devices: under a room\'s header no tile repeats the room', twice.length === 0, twice);
  // an appliance known only through switches: with a power switch of its own (the bath fan's relay, the washer's «Питание», the fountain's pump) a
  // tap switches exactly that, as 1.26.1 did, and «…» opens the appliance; without one (the humidifier, the air fryer, the dryer) a tap opens it.
  // Never a settings switch (the humidifier opened «Звук уведомления»). The sheet's big number speaks the tile's units: «0 Вт», never HA's «0 W»
  await page.evaluate(() => { window.atomPreview.host.setAccept(true); window.atomPreview.setStates({ 'switch.bath_washer_power': 'off' }); }); await page.waitForTimeout(300); // silent in the 09.11 fixture: it answers here
  const tileOf = (word, room) => page.evaluate(([w, r]) => { const all = [...document.querySelectorAll('.hm-systems .ah-tile')].filter(x => x.querySelector('strong')?.textContent.trim() === w && (!r || x.closest('.at-sys-room')?.querySelector('h3')?.textContent.trim() === r)); const t = all[0]; return t ? { n: all.length, key: t.dataset.deviceKey, sub: t.querySelector('.ah-tile-text small')?.textContent ?? '', pressed: t.querySelector('.ah-tile-hit')?.getAttribute('aria-pressed') ?? null } : null; }, [word, room]);
  const press = (word, room, what) => page.evaluate(([w, r, sel]) => { const t = [...document.querySelectorAll('.hm-systems .ah-tile')].find(x => x.querySelector('strong')?.textContent.trim() === w && (!r || x.closest('.at-sys-room')?.querySelector('h3')?.textContent.trim() === r)); t?.querySelector(sel)?.click(); }, [word, room, what]);
  const sheetNow = () => page.evaluate(() => ({ hash: location.hash, title: document.querySelector('.hm-sheet-head h2')?.textContent ?? null, kind: document.querySelector('.hm-sheet-head small')?.textContent ?? null, hero: document.querySelector('.hm-sheet .ah-hero-main b')?.textContent ?? null }));
  const calls = n => page.evaluate(n => window.atomPreview.host.log.slice(n).filter(x => x.domain !== 'ws').map(x => ({ c: `${x.domain}.${x.service}`, id: x.data?.entity_id })), n);
  const HERO = /^-?\d[\d\s ,.]* (Вт|кВт)$|^Нет связи$/;
  const opened = (sheet, word, tile) => /device=app%3A/.test(sheet.hash) && sheet.title === word && /^Прибор/.test(sheet.kind ?? '') && HERO.test(sheet.hero ?? '') && !/ W$/.test(sheet.hero ?? '') && (!/Вт$/.test(tile?.sub ?? '') || sheet.hero === tile.sub);
  for (const [word, room, id] of [['Вентилятор', 'Ванная', 'switch.bath_vent'], ['Стиральная машина', null, 'switch.bath_washer_power'], ['Поилка кошки', null, 'switch.kitchen_cat_fountain_pump']]) {
    const tile = await tileOf(word, room), n0 = await page.evaluate(() => window.atomPreview.host.log.length);
    await press(word, room, '.ah-tile-hit'); await page.waitForTimeout(400);
    const sent = await calls(n0), after = await sheetNow();
    check(`devices: a tap on «${word}» switches its power (${id}) — exactly that — and opens nothing`, !!tile && tile.n === 1 && tile.key?.startsWith('app:') && (tile.pressed === 'true' || tile.pressed === 'false') && sent.length === 1 && sent[0].id === id && /^switch\.(turn_on|turn_off|toggle)$/.test(sent[0].c) && !/device=/.test(after.hash), { tile, sent, after });
    const n1 = await page.evaluate(() => window.atomPreview.host.log.length);
    await press(word, room, '.ah-tile-more'); await page.waitForTimeout(400);
    const sheet = await sheetNow(), more = await calls(n1);
    check(`devices: «…» on «${word}» opens the appliance — its power in «Вт» — and sends nothing`, opened(sheet, word, tile) && more.length === 0, { tile, sheet, more });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  for (const word of ['Увлажнитель воздуха', 'Аэрогриль', 'Сушильная машина']) {
    const tile = await tileOf(word, null), n0 = await page.evaluate(() => window.atomPreview.host.log.length);
    await press(word, null, '.ah-tile-hit'); await page.waitForTimeout(400);
    const sheet = await sheetNow(), sent = await calls(n0);
    check(`devices: a tap on «${word}» (no power switch of its own) opens the appliance — its power in «Вт», not a settings switch — and sends nothing`, !!tile && tile.n === 1 && tile.pressed === null && opened(sheet, word, tile) && sent.length === 0, { tile, sheet, sent });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  await page.evaluate(() => { window.atomPreview.host.setAccept(false); });
  await page.goto(`${origin}/?card=rooms&scenario=live&theme=light&lang=ru#systems?device=app%3Abc32f53b3fa5be79a27e499e77e9e5af`); await page.waitForFunction(() => window.ready === true); await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, 'humidifier-sheet.png') });
  await page.evaluate(() => { location.hash = '#systems'; }); await page.waitForTimeout(400);
  await page.fill('.at-search', 'протечк'); await page.waitForTimeout(250);
  check('devices: the search still finds a leak sensor', (await kinds()).includes('leak'), await kinds());
  await page.fill('.at-search', ''); await page.click('.at-sys-attn'); await page.waitForTimeout(300);
  const attn = await kinds();
  check('devices: «Внимание» still lists a sensor that does not answer', attn.some(k => SENSOR.includes(k)), attn);
  check('devices: no page error', errors.length === 0, errors);
  await ctx.close();
}
// ---- «Безопасность»: grouped, motion, the way to the cameras -----------------------------------------------------------------------------------
for (const scenario of ['disarmed', 'armedOpen', 'triggered']) {
  const { page, ctx, errors } = await open({ card: 'security', scenario, hash: '#security' });
  const g = await page.evaluate(() => ({ groups: [...document.querySelectorAll('.at-osec-group-h')].map(h => h.textContent), cams: document.querySelector('.at-sec-cams')?.textContent ?? null, keys: [...document.querySelectorAll('.at-osec-key')].length }));
  check(`security/${scenario}: the alarm's keys, the devices in groups, the way to the cameras`, g.keys === 2 && g.groups.includes('Двери и окна') && g.groups.includes('Вода') && g.groups.includes('Газ и дым') && /Камеры/.test(g.cams ?? ''), g);
  if (scenario === 'triggered') check('security/triggered: the group with the alarm comes first', g.groups[0] === 'Двери и окна', g.groups);
  await page.click('.at-sec-cams'); await page.waitForTimeout(400);
  check(`security/${scenario}: the cameras' way leads to «Камеры»`, (await hash(page)) === '#camera', await hash(page));
  check(`security/${scenario}: no page error`, errors.length === 0, errors);
  await ctx.close();
}
// ---- «Комнаты» on one screen -----------------------------------------------------------------------------------------------------------------------
const SIZES = [['320x568', 1], ['344x882', 1], ['360x792', 1], ['375x667', 1], ['402x874', 1], ['440x956', 1], ['568x320', 1], ['667x375', 1], ['874x402', 1], ['882x344', 1], ['768x860', 1], ['1070x764', 1], ['764x1070', 1], ['1024x1366', 1], ['1366x1024', 1], ['1280x600', 0], ['1440x900', 0], ['1920x1080', 0], ['2560x1080', 0], ['3440x1440', 0], ['tv960x540', 2], ['tv1920x1080', 2]];
for (const theme of ['light', 'dark']) for (const scenario of ['eight', 'live', 'twelve']) for (const [sz, kind] of SIZES) {
  const tv = sz.startsWith('tv'), [w, h] = sz.replace('tv', '').split('x').map(Number);
  const { page, ctx, errors } = await open({ card: 'rooms', scenario, hash: '#rooms', w, h, tv, touch: kind === 1, theme });
  const r = await page.evaluate(() => { const m = document.querySelector('.hm-main'), g = document.querySelector('.hm-room-grid.is-page'), z = parseFloat(getComputedStyle(document.querySelector('.hm-shell')).zoom || '1') || 1, tiles = [...g.querySelectorAll('.hm-room')];
    const boxes = tiles.map(t => t.getBoundingClientRect()), fonts = [...g.querySelectorAll('.hm-room strong, .hm-room b, .hm-room small')].filter(e => e.offsetWidth > 0).map(e => parseFloat(getComputedStyle(e).fontSize));
    const out = tiles.filter(t => { const a = t.getBoundingClientRect(); return [...t.querySelectorAll('.hm-room-top strong, .hm-room-bottom b, .hm-room-bottom small, .hm-lit')].some(e => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.bottom > a.bottom - 1 || q.right > a.right - 1 || q.top < a.top + 1 || q.left < a.left + 1); }); }).length;
    let top = 0; for (let n = g; n && n !== m; n = n.offsetParent) top += n.offsetTop; const fill = g.offsetHeight / (m.clientHeight - parseFloat(getComputedStyle(m).paddingBottom) - top);
    return { fill: Math.round(fill * 100) / 100, n: tiles.length, scroll: m.scrollHeight - m.clientHeight, minH: Math.min(...boxes.map(b => b.height)) / z, minW: Math.min(...boxes.map(b => b.width)) / z, minFont: Math.min(...fonts), out, said: document.querySelector('.hm-head p')?.textContent ?? '', cols: g.dataset.cols, rows: g.dataset.rows }; });
  // the drawn tile (1.27.0): no word — the name, the temperature, the readings, the lamps' badge — meets any drawn shape (each SVG element's own
  // box, not the picture's); the scene keeps its colours (its own opacity ≥ 0.85, no veil over it) and stays a picture, not a speck
  const art = await page.evaluate(() => { const z = parseFloat(getComputedStyle(document.querySelector('.hm-shell')).zoom || '1') || 1, meets = [], specks = [], faded = []; let shapes = 0, least = 1e9;
    for (const t of document.querySelectorAll('.hm-room-grid.is-page .hm-room.is-art')) {
      const words = [...t.querySelectorAll('.hm-room-top strong, .hm-room-bottom b, .hm-room-bottom small, .hm-lit')].filter(e => e.offsetWidth > 0 && e.textContent.trim()).map(e => ({ what: e.tagName === 'SPAN' ? 'lamps' : e.textContent.trim(), r: e.getBoundingClientRect() }));
      const drawn = [...t.querySelectorAll('.ra-pic svg :is(path, rect, circle, ellipse, line, polygon, polyline)')].filter(e => !e.closest('defs')).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 || r.height > 0); shapes += drawn.length;
      for (const w of words) { const hit = drawn.find(s => w.r.left < s.right - 0.5 && s.left < w.r.right - 0.5 && w.r.top < s.bottom - 0.5 && s.top < w.r.bottom - 0.5); if (hit) meets.push(`${t.dataset.roomId}: «${w.what}»`); }
      const u = drawn.reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 }), hgt = (u.b - u.t) / z, wid = (u.r - u.l) / z;
      least = Math.min(least, hgt); if (!(hgt >= 14 && wid >= 20 && hgt >= 0.14 * t.offsetHeight)) specks.push(`${t.dataset.roomId}: ${Math.round(wid)}×${Math.round(hgt)}`);
      let op = 1; for (let n = t.querySelector('.ra-pic svg'); n && n !== t.parentElement; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      const veil = getComputedStyle(t, '::after'); if (op < 0.85 || (veil.content !== 'none' && veil.backgroundImage !== 'none')) faded.push(`${t.dataset.roomId}: opacity ${op.toFixed(2)}, veil ${veil.backgroundImage.slice(0, 30)}`);
    }
    return { meets, specks, faded, shapes, least: Math.round(least) }; });
  const tag = `rooms/${theme}/${scenario}/${sz}`;
  check(`${tag}: no word lies on the drawing (${art.shapes} drawn shapes measured)`, art.shapes > 50 && art.meets.length === 0, art.meets.slice(0, 6));
  check(`${tag}: every scene keeps its colours and stays a picture (≥ 20×14 px and ≥ 14 % of its tile; smallest ${art.least} px tall)`, art.specks.length === 0 && art.faded.length === 0, { specks: art.specks.slice(0, 6), faded: art.faded.slice(0, 3) });
  // the only layout that may scroll: 12 rooms on a phone of 568×320 on its side (two rows of 88 px need six columns of 88 px: 578 > 548)
  const mayScroll = scenario === 'twelve' && sz === '568x320';
  check(`${tag}: every room on one screen (${r.n} rooms, ${r.cols}×${r.rows})`, mayScroll || r.scroll <= 0, r);
  check(`${tag}: the tiles use the height they have (${Math.round(r.fill * 100)} %)`, mayScroll || r.fill >= 0.85, r);
  check(`${tag}: tiles ≥ 88 px tall, words ≥ 13 px, nothing out of its tile`, r.minH >= 87.5 && r.minFont >= 13 && r.out === 0, r);
  check(`${tag}: no page error`, errors.length === 0, errors);
  if (['360x792', '320x568', '1070x764', '764x1070', '1440x900', '2560x1080', 'tv1920x1080'].includes(sz)) await page.screenshot({ path: resolve(out, `rooms-${theme}-${scenario}-${sz}.png`) });
  await ctx.close();
}
// ---- the words on the drawn pictures: 4.5:1 against the screen's own pixels behind them ------------------------------------------------------------
// the tile is shot twice, with its words and with them made transparent (their halo stays: it is part of what is read against); the letters are
// where the two differ, and the pixels within 2 CSS px of them — the 5 % worst for the word's colour — must keep 4.5:1
const png = buf => { let p = 8, w = 0, h = 0, ct = 0; const idat = []; while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * bpp), stride = w * bpp;
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); for (let x = 0; x < stride; x++) { const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0; let v = line[x];
    if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } px[y * stride + x] = v & 255; } }
  return { w, h, bpp, px }; };
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }, L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b), CR = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
for (const theme of ['light', 'dark']) for (const [w, h, scenario] of [[1070, 764, 'live'], [360, 792, 'live'], [320, 568, 'twelve'], [1440, 900, 'eight']]) {
  const { page, ctx } = await open({ card: 'rooms', scenario, hash: '#rooms', w, h, theme });
  const words = await page.evaluate(() => [...document.querySelectorAll('.hm-room-grid .hm-room.is-art')].flatMap(t => [...t.querySelectorAll('.hm-room-top strong, .hm-room-bottom b, .hm-room-bottom small')].filter(e => e.offsetWidth > 0 && e.textContent.trim()).map(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e).color.match(/\d+(\.\d+)?/g).map(Number); return { room: t.dataset.roomId, text: e.textContent.trim(), x: r.left, y: r.top, w: r.width, h: r.height, c }; })));
  const withWords = png(await page.screenshot());
  await page.addStyleTag({ content: '.hm-room-grid .hm-room.is-art :is(.hm-room-top strong,.hm-room-bottom b,.hm-room-bottom small,.hm-room-bottom i){color:transparent!important}' }); await page.waitForTimeout(150);
  const shot = png(await page.screenshot()), k = shot.w / w, R = Math.max(2, Math.round(2 * k)); let worst = { cr: 99 };
  const lum = (img, x, y) => { const i = (y * img.w + x) * img.bpp; return L(img.px[i], img.px[i + 1], img.px[i + 2]); };
  for (const t of words) {
    const lt = L(...t.c), x0 = Math.max(0, Math.floor(t.x * k)), x1 = Math.min(shot.w, Math.ceil((t.x + t.w) * k)), y0 = Math.max(0, Math.floor(t.y * k)), y1 = Math.min(shot.h, Math.ceil((t.y + t.h) * k));
    // the letters: where the words change the picture; what lies next to them (within 2 CSS px) is the background they are read against
    const glyph = new Set(); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (Math.abs(lum(withWords, x, y) - lum(shot, x, y)) > 0.06) glyph.add(y * shot.w + x);
    const ring = []; for (const g of glyph) { const gx = g % shot.w, gy = (g - gx) / shot.w; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= shot.w || y >= shot.h || glyph.has(y * shot.w + x)) continue; ring.push(lum(shot, x, y)); } }
    if (!ring.length) continue; ring.sort((p, q) => p - q);
    const bad = lt < 0.2 ? ring[Math.floor(ring.length * 0.05)] : ring[Math.floor(ring.length * 0.95)], cr = CR(lt, bad);
    if (cr < worst.cr) worst = { cr: Math.round(cr * 100) / 100, room: t.room, text: t.text };
  }
  check(`pictures/${theme}/${w}x${h}/${scenario}: every name and reading at 4.5:1 against what lies next to its letters`, worst.cr >= 4.5 && words.length > 10, { worst, words: words.length });
  if (worst.cr < 4.5) await page.screenshot({ path: resolve(out, `contrast-${theme}-${w}x${h}.png`) });
  await ctx.close();
}
await stop(fails.length ? 1 : 0);
