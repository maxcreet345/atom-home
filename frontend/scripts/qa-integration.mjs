// The integration pass of the audit of 09.11.2026: what six fix agents left to each other, checked in the page. Each check fails without its fix.
// The shell's live region against the camera's LIVE badge, the climate sheet's hero and steppers, «Готово» on a scene, light timers read from the
// integration's own answer, security fields that keep what is typed, the vacuum's button waiting for the robot, panels dimmed off the line,
// people chips against the avatar stack, the «restart Home Assistant» note, the house's time zone, the version written into the tracked bundle.
// usage: node scripts/qa-integration.mjs [outDir]      (QA_DIST=<dir> checks another preview build)      exit code 1 on any failure
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { freePort } from './free-port.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.argv[2] ?? resolve(root, 'evidence/integration')); await mkdir(out, { recursive: true });
// a port nobody holds (the standing previews, other agents' servers and this script's own two never collide), and a start that cannot hang
const kids = [];
process.on('exit', () => { for (const k of kids) try { k.kill(); } catch { /* gone */ } });
const serve = async script => { const port = await freePort(), s = spawn(process.execPath, [resolve(root, 'scripts', script), String(port)], { stdio: 'pipe' }); kids.push(s); let said = ''; s.stderr.on('data', d => { said += d; });
  await new Promise((res, rej) => { s.stdout.once('data', res); s.once('exit', c => rej(new Error(`${script} stopped (${c}): ${said.slice(0, 300)}`))); setTimeout(() => rej(new Error(`${script} did not start in 40 s: ${said.slice(0, 300)}`)), 40000).unref(); });
  return { s, origin: `http://127.0.0.1:${port}` }; };
// nothing here may wait for ever: a stall of three minutes ends the run as a failure
let beat = Date.now(); setInterval(() => { if (Date.now() - beat > 180000) { console.log('✘ the script stalled for three minutes and was stopped'); process.exit(1); } }, 5000).unref();
const house = await serve('preview-server.mjs'), cards = await serve('card-preview.mjs');
const browser = await chromium.launch(), report = { checks: [], errors: [] };
const check = (name, ok, extra) => { beat = Date.now(); report.checks.push({ name, ok: !!ok, extra }); console.log(`${ok ? '✔' : '✘'} ${name}${extra === undefined || ok ? '' : ' — ' + JSON.stringify(extra).slice(0, 700)}`); };
const open = async ({ w = 1070, h = 764, url, tz = 'Europe/Chisinau', touch = w < 1100, init, mobile = false }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: mobile, timezoneId: tz }), page = await ctx.newPage();
  page.on('pageerror', e => report.errors.push(`${url}: ${e.message}`));
  if (init) await page.addInitScript(init);
  const go = async u => { await page.goto(u); await page.waitForSelector('.at-shell', { timeout: 20000 }); await page.waitForFunction(() => !!window.atomPreview, null, { timeout: 20000 }); await page.waitForTimeout(450); };
  await go(url); return { ctx, page, go };
};
const H = (hash, q = '') => `${house.origin}/${q}${hash}`, C = (card, scenario, hash, extra = '') => `${cards.origin}/?card=${card}&scenario=${scenario}&theme=light&lang=ru${extra}${hash}`;
const sent = page => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').length);
try {
  // ---- 1. the shell's live region is not the camera's LIVE badge
  { const { ctx, page } = await open({ url: H('#home') });
    const live = await page.evaluate(() => { const a = document.querySelector('.hm-shell > .hm-announce'), cs = a && getComputedStyle(a), mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return { region: !!a, live: a?.getAttribute('aria-live'), bg: cs?.backgroundColor, blur: cs?.backdropFilter, events: cs?.pointerEvents, midInRegion: !!mid?.closest('.hm-announce'), mid: mid?.className?.toString().slice(0, 60),
        big: [...document.querySelectorAll('.hm-live')].filter(e => { const r = e.getBoundingClientRect(); return r.width > innerWidth / 2 || r.height > 80; }).length, shellChild: [...document.querySelectorAll('.hm-shell > .hm-live')].length }; });
    check('the live region is «hm-announce»: assertive, see-through, takes no taps', live.region && live.live === 'assertive' && /rgba\(0, 0, 0, 0\)|transparent/.test(live.bg) && (live.blur === 'none' || !live.blur) && live.events === 'none' && !live.midInRegion, live);
    check('nothing called «hm-live» covers the screen or is the shell\'s own child', live.big === 0 && live.shellChild === 0, live);
    await page.evaluate(() => { window.atomPreview.host.setRefusal({ code: 'home_assistant_error', message: 'нет' }); document.querySelector('.hm-light-grid .ah-tile-hit, .ah-tile.kind-light .ah-tile-hit, .ah-scene .hm-scene-hit')?.click(); }); await page.waitForTimeout(700);
    const toast = await page.evaluate(() => { const t = document.querySelector('.hm-announce .hm-toast'), r = t?.getBoundingClientRect(); return t ? { w: r.width, h: r.height, events: getComputedStyle(t).pointerEvents } : null; });
    check('a toast lives inside it and can be tapped away', !toast || (toast.events === 'auto' && toast.h < 200), toast);
    await page.screenshot({ path: resolve(out, 'home-1070.png') }); await ctx.close(); }

  // ---- 2. the climate sheet: no setpoint as the room's temperature, steppers with real names
  { const { ctx, page, go } = await open({ url: H('#climate') });
    const blind = await page.evaluate(() => { const t = [...document.querySelectorAll('.ah-thermo')].find(x => x.querySelector('.ah-thermo-value')?.dataset.reading === 'none'); return t ? { key: t.dataset.deviceKey, name: t.querySelector('.ah-tile-text strong')?.textContent } : null; });
    check('the snapshot has a thermostat with no reading', !!blind, blind);
    if (blind) { await go(H(`#climate?device=${encodeURIComponent(blind.key)}`)); await page.waitForSelector('.ah-hero-climate', { timeout: 8000 }).catch(() => {});
      const hero = await page.evaluate(() => { const h = document.querySelector('.ah-hero-climate'); return h ? { reading: h.querySelector('.ah-hero-main')?.dataset.reading, big: h.querySelector('.ah-hero-main b')?.textContent, small: h.querySelector('.ah-hero-main small')?.textContent, target: h.querySelector('.ah-target strong')?.textContent, live: h.querySelector('.ah-target span')?.getAttribute('aria-live'), steps: [...h.querySelectorAll('.ah-target .hm-round')].map(b => b.getAttribute('aria-label')), title: document.querySelector('.hm-sheet-head h2')?.textContent } : null; });
      check('its sheet shows «—» as the big number, never the setpoint', hero && hero.reading === 'none' && hero.big === '—' && /Нет данных/.test(hero.small ?? ''), hero);
      check('the setpoint stays in «цель», announced politely when it changes', hero && (!hero.steps.length || (/^-?\d+(,\d)?°$/.test(hero.target ?? '') && hero.live === 'polite')), hero);
      check('the steppers say what they do and to which device', hero && (!hero.steps.length || (hero.steps.length === 2 && hero.steps[0] !== hero.steps[1] && hero.steps.every(s => s && s.length > 8 && /цель/.test(s) && !/^.{0,3}[−+]$/.test(s)))), hero?.steps);
      await page.screenshot({ path: resolve(out, 'climate-sheet-no-reading.png') }); }
    // a valve's sheet: the window's «×» and the valve's own «Закрыть» are told apart
    const valve = await page.evaluate(() => { const st = window.atomPreview.host.states(); return Object.keys(st).find(id => id.startsWith('valve.')) ?? null; });
    if (valve) { await go(H(`#systems?device=${encodeURIComponent('e:' + valve)}`)); await page.waitForTimeout(300);
      const names = await page.evaluate(() => [...document.querySelectorAll('.hm-sheet button')].map(b => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim()).filter(n => /Закрыть/.test(n)));
      check('a valve\'s sheet has no two buttons with one name', new Set(names).size === names.length && (names.length === 0 || names.includes('Закрыть окно')), names); }
    for (const dev of ['air', 'clock']) { await go(H(`#home?device=${dev}`)); await page.waitForTimeout(300); const x = await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .hm-icon-btn')].filter(b => b.textContent.trim() === '×').map(b => b.getAttribute('aria-label'))); check(`the «×» of the ${dev} sheet is «Закрыть окно»`, x.length === 0 || x.every(n => n === 'Закрыть окно'), x); }
    await ctx.close(); }

  // ---- 3. a scene says «Готово» when the house accepted, and nothing of the kind when it refused
  { const { ctx, page } = await open({ url: H('#home') });
    const free = await page.evaluate(() => { window.atomPreview.setAccept(true); const hits = [...document.querySelectorAll('.ah-scene .hm-scene-hit')]; if (!hits.length) return null; hits[hits.length - 1].click(); return new Promise(r => setTimeout(() => r(!document.querySelector('.hm-confirm')), 250)); });
    if (free === null) check('the snapshot has scene tiles (the «Готово» sequence cannot be checked without them)', false);
    else { if (!free) await page.evaluate(() => [...document.querySelectorAll('.hm-confirm button')].at(-1).click());
      await page.waitForFunction(() => !document.querySelector('.ah-scene.is-pending'), null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(150);
      const done = await page.evaluate(() => { const s = [...document.querySelectorAll('.ah-scene')].at(-1); return { cls: s.className, text: s.querySelector('small')?.textContent }; });
      check('after the house accepted, the scene tile says «Готово»', /is-done/.test(done.cls) && done.text === 'Готово', done);
      await page.waitForTimeout(2300); check('…for two seconds, then it is «Сценарий» again', await page.evaluate(() => [...document.querySelectorAll('.ah-scene')].at(-1).querySelector('small')?.textContent === 'Сценарий'));
      await page.evaluate(() => { window.atomPreview.setAccept(false); [...document.querySelectorAll('.ah-scene .hm-scene-hit')].at(-1).click(); }); await page.waitForTimeout(250);
      await page.evaluate(() => [...document.querySelectorAll('.hm-confirm button')].at(-1)?.click()); await page.waitForTimeout(700);
      const refused = await page.evaluate(() => ({ text: [...document.querySelectorAll('.ah-scene')].at(-1).querySelector('small')?.textContent, toast: document.querySelector('.hm-toast')?.textContent ?? null }));
      check('a refused scene does not say «Готово» (the toast says why)', refused.text !== 'Готово' && !!refused.toast, refused); }
    await ctx.close(); }

  // ---- 4. «Выключить через»: the integration's own list of timers, not only the mirror helper
  { const { ctx, page, go } = await open({ url: H('#lights'), init: () => { window.__lightSleep = {}; } });
    const lamp = await page.evaluate(() => { const st = window.atomPreview.host.states(), mirror = st['input_text.atom_light_sleep']?.state ?? ''; const t = [...document.querySelectorAll('.ah-tile.kind-light[data-device-key^="e:light."]:not(.is-off)')].map(x => x.dataset.deviceKey).find(k => st[k.slice(2)] && !mirror.includes(k.slice(2))); return t ?? null; });
    check('a lamp that is not in the mirror helper', !!lamp, lamp);
    // CODEX-018: the timers are built from the test's own clock (now + minutes), and their exact time is checked, not only its pattern
    const hhmm = ms => page.evaluate(ms => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(ms), ms), held = Date.now() + 75 * 60_000;
    if (lamp) { await page.evaluate(([id, at]) => { const d = new Date(at), off = -d.getTimezoneOffset(), p = n => String(n).padStart(2, '0'); window.__lightSleep[id] = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${off < 0 ? '-' : '+'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`; /* the integration's form: local wall clock with its offset */ }, [lamp.slice(2), held]); // the integration holds a timer the mirror helper had no room for
      await go(H(`#lights?device=${encodeURIComponent(lamp)}`)); await page.waitForSelector('.at-sleep', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
      const s = await page.evaluate(() => ({ at: document.querySelector('.at-sleep')?.dataset.sleep, text: document.querySelector('.at-sleep-at strong')?.textContent ?? null, chips: document.querySelectorAll('.at-sleep-chips .hm-pill').length }));
      const want = await hhmm(held); check('a timer the helper does not hold is shown from the integration\'s answer, at its exact time', s.at === want && (s.text ?? '').includes(want) && s.chips === 0, { ...s, want });
      await page.click('.at-sleep-at .hm-pill'); await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ at: document.querySelector('.at-sleep')?.dataset.sleep, chips: document.querySelectorAll('.at-sleep-chips .hm-pill').length }));
      check('«Отменить» takes the answer\'s list: the choices are back at once', after.at === '' && after.chips === 3, after);
      await page.evaluate(id => window.atomPreview.setStates({ [id]: 'on' }), lamp.slice(2)); await page.waitForTimeout(200); // the choices are offered for a lamp that is on
      const minutes = Number((await page.locator('.at-sleep-chips .hm-pill:nth-child(2)').textContent())?.match(/\d+/)?.[0]), t0 = Date.now();
      await page.click('.at-sleep-chips .hm-pill:nth-child(2)'); await page.waitForTimeout(300); const t1 = Date.now();
      const shown = await page.evaluate(() => document.querySelector('.at-sleep')?.dataset.sleep ?? ''), ok = [await hhmm(t0 + minutes * 60_000), await hhmm(t1 + minutes * 60_000 + 1000)];
      check(`and a new timer is shown from the answer to the command: now + ${minutes} min (CODEX-018)`, minutes > 0 && ok.includes(shown), { shown, ok, minutes }); }
    await ctx.close(); }

  // ---- 5. security: the settings fields keep what is being typed; the room filter is a group of pressed buttons
  { const { ctx, page } = await open({ url: C('security', 'vacation', '#security') });
    const roles = await page.evaluate(() => { const g = document.querySelector('.at-sec-panel .at-osec-chips'); return g ? { role: g.getAttribute('role'), name: g.getAttribute('aria-label'), tabs: g.querySelectorAll('[role=tab]').length, pressed: [...g.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')) } : null; });
    check('the room filter: role=group with a name, buttons with aria-pressed, no tabs', roles && roles.role === 'group' && !!roles.name && roles.tabs === 0 && roles.pressed.filter(p => p === 'true').length === 1 && roles.pressed.every(p => p === 'true' || p === 'false'), roles);
    const field = page.locator('.at-sec-set input[type=number]:not([disabled])').first();
    if (await field.count()) { await field.scrollIntoViewIfNeeded(); const was = await field.inputValue(); await field.focus(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('1');
      await page.evaluate(() => window.atomPreview.redraw()); await page.evaluate(() => { const st = window.atomPreview.host.states(), id = Object.keys(st).find(k => k.startsWith('sensor.')); window.atomPreview.setStates({ [id]: st[id].state }); }); await page.waitForTimeout(120);
      const mid = await field.inputValue(); await page.keyboard.type('4'); await page.waitForTimeout(80); const typed = await field.inputValue();
      check('a number half typed survives the house\'s redraws', mid === '1' && typed === '14', { was, mid, typed });
      const n = await sent(page); await page.keyboard.press('Enter'); await page.waitForTimeout(250); const call = await page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').at(-1));
      check('Enter sends it once', (await sent(page)) - n === 1 && call?.service === 'set_value' && call?.data?.value === 14, call);
      await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(150); check('leaving the field brings the house\'s own value back (the preview refused the command)', (await field.inputValue()) === was, { was, now: await field.inputValue() }); }
    else check('the security settings have a number field on this scenario', false);
    await page.screenshot({ path: resolve(out, 'security-settings.png') }); await ctx.close(); }

  // ---- 6. the vacuum: the button waits for the robot; off the line the panel is dimmed and takes no commands
  { const { ctx, page } = await open({ url: C('vacuum', 'docked', '#cleaning') });
    await page.evaluate(() => window.atomPreview.setAccept(true)); const n0 = await sent(page);
    await page.click('.at-vac-big'); await page.waitForTimeout(1200);
    const held = await page.evaluate(() => { const b = document.querySelector('.at-vac-big'); const r = { busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled') }; b.click(); return r; }); await page.waitForTimeout(300);
    check('after the house accepted «start» the button still waits for the robot', held.busy === 'true' && held.disabled === 'true', held);
    check('a second tap meanwhile sends nothing', (await sent(page)) - n0 === 1, (await sent(page)) - n0);
    await page.evaluate(() => { const st = window.atomPreview.host.states(), id = Object.keys(st).find(k => k.startsWith('vacuum.') && st[k].state === 'docked'); window.atomPreview.setStates({ [id]: 'cleaning' }); }); await page.waitForTimeout(700);
    check('the robot\'s new phase frees the button', await page.evaluate(() => document.querySelector('.at-vac-big').getAttribute('aria-busy') !== 'true'));
    await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(250); const n1 = await sent(page);
    const off = await page.evaluate(() => { const p = document.querySelector('.at-vac-panel'), b = document.querySelector('.at-vac-big'); b.click(); document.querySelector('.at-vac-side:last-child')?.click(); const dim = document.querySelector('.at-vac-map'); return { stale: p.classList.contains('is-stale'), line: document.querySelector('.at-vac-stale')?.textContent ?? null, disabled: b.getAttribute('aria-disabled'), opacity: dim ? getComputedStyle(dim).opacity : null }; }); await page.waitForTimeout(300);
    check('off the line: dimmed, «данные на момент потери связи», the buttons are disabled', off.stale && /потери связи/.test(off.line ?? '') && off.disabled === 'true' && Number(off.opacity) < 1, off);
    check('and nothing is sent', (await sent(page)) === n1, (await sent(page)) - n1);
    await page.screenshot({ path: resolve(out, 'vacuum-offline.png') });
    await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForTimeout(250); check('back on the line the panel is itself again', await page.evaluate(() => !document.querySelector('.at-vac-panel').classList.contains('is-stale') && !document.querySelector('.at-vac-stale')));
    await ctx.close(); }
  { const { ctx, page } = await open({ url: C('cameras', 'quiet', '#camera') });
    await page.waitForSelector('.at-cams', { timeout: 8000 }).catch(() => {}); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(250);
    const off = await page.evaluate(() => { const c = document.querySelector('.at-cams'), g = document.querySelector('.at-cams-grid'); return c ? { stale: c.classList.contains('is-stale'), line: c.querySelector('.at-cams-summary small')?.textContent, opacity: g ? getComputedStyle(g).opacity : null, warn: c.querySelector('.at-cams-summary').classList.contains('is-warning') } : null; });
    check('the cameras panel off the line: dimmed and said so, not «все на связи»', off && off.stale && /потери связи/.test(off.line ?? '') && Number(off.opacity) < 1 && off.warn, off);
    await page.screenshot({ path: resolve(out, 'cameras-offline.png') }); await ctx.close(); }

  // the room page's «Камеры» card looks at the camera that has the event, not at the room's first one (room-card-focus-fixed had no scripted gate)
  { const { ctx, page } = await open({ url: C('cameras', 'person', '#camera') }); await page.waitForSelector('.at-cams-cell', { timeout: 8000 }).catch(() => {});
    const hot = await page.evaluate(() => { const c = document.querySelector('.at-cams-cell[class*="tone-"]'); return c ? { key: c.dataset.deviceKey, name: c.querySelector('.at-cams-cap strong')?.textContent } : null; });
    await page.evaluate(() => { location.hash = '#rooms'; }); await page.waitForTimeout(500);
    const rooms = await page.evaluate(() => [...document.querySelectorAll('.hm-room-grid .hm-room, .hm-room-grid [data-room], .hm-room-grid button')].map(r => (r.textContent ?? '').trim().slice(0, 30)));
    let focus = null; for (let i = 0; i < rooms.length && focus === null; i++) { await page.evaluate(() => { location.hash = '#rooms'; }); await page.waitForTimeout(350); await page.evaluate(i => [...document.querySelectorAll('.hm-room-grid .hm-room, .hm-room-grid [data-room], .hm-room-grid button')][i]?.click(), i); await page.waitForTimeout(450); focus = await page.evaluate(k => { const t = [...document.querySelectorAll('.at-cams-tile')].find(x => [...x.querySelectorAll('.at-cams-thumb, .at-cams-main')].length > 1 || x.dataset.focus === k); return t ? t.dataset.focus : null; }, hot?.key); }
    check('the room with several cameras shows the one with the person first', !!hot && focus === hot.key, { hot, focus, rooms: rooms.length });
    await ctx.close(); }

  // ---- 7. the header: chips where there is room, the avatar stack on a compact panel and a phone on its side
  for (const [w, h, chips] of [[1070, 764, true], [1440, 900, true], [792, 360, false], [700, 900, false], [360, 792, false]]) { const { ctx, page } = await open({ w, h, url: `${cards.origin}/?card=header&scenario=allHome&theme=light&lang=ru#home` });
    const head = await page.evaluate(() => { const b = document.querySelector('.at-people-btn'), hd = document.querySelector('.at-head-tools')?.parentElement; return { chips: document.querySelectorAll('.at-person-chip').length, stack: !!document.querySelector('.at-people-stack'), cut: [...document.querySelectorAll('.at-person-chip b, .at-person-chip small')].filter(e => e.scrollWidth > e.clientWidth + 1).length, btnH: b?.getBoundingClientRect().height ?? 0, headH: hd?.getBoundingClientRect().height ?? 0, over: document.querySelector('.hm-main') ? document.querySelector('.hm-main').scrollWidth - document.querySelector('.hm-main').clientWidth : 0 }; });
    check(`${w}x${h}: ${chips ? 'a chip per person, none cut' : 'the avatar stack with one summary'}`, chips ? head.chips >= 2 && head.cut === 0 : head.chips === 0 && head.stack, head);
    if (w === 792) { check('792x360: the header is one row', head.headH > 0 && head.headH <= 96, head); await page.screenshot({ path: resolve(out, 'header-792x360.png') }); }
    await ctx.close(); }
  // the smallest phone on its side: the bars leave more than half of the 320 px to the tiles
  { const { ctx, page } = await open({ w: 568, h: 320, mobile: true, url: H('#home') });
    const bars = await page.evaluate(() => { const hd = document.querySelector('.hm-head'), tb = document.querySelector('.hm-tabbar'); return { head: Math.round(hd?.getBoundingClientRect().height ?? 0), bar: Math.round(tb?.getBoundingClientRect().height ?? 0), cut: [...(tb?.querySelectorAll('button span') ?? [])].filter(x => x.scrollWidth > x.clientWidth + 1).length, small: [...(tb?.querySelectorAll(':scope > button') ?? [])].filter(b => b.getBoundingClientRect().height < 44).length /* the bar's own places; «Ещё»'s pages (1.27.0) are 52 px rows of their own, hidden until it opens */ }; });
    check('568x320: header and tab bar together leave 170 px or more, the tabs stay 44 px with whole words', bars.bar > 0 && bars.head + bars.bar <= 150 && bars.cut === 0 && bars.small === 0, bars);
    await page.screenshot({ path: resolve(out, 'home-568x320.png') }); await ctx.close(); }
  // a television (no hover, 4K): the shell is zoomed; a menu stays on the screen
  { const { ctx, page } = await open({ w: 2560, h: 1440, touch: false, init: () => { const mm = window.matchMedia.bind(window); window.matchMedia = q => /any-hover:\s*none|any-pointer:\s*none/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q); } /* no hover, no pointer, no touch points: a touch screen of this size is a kiosk now, laid out 1:1 */, url: `${cards.origin}/?card=header&scenario=long&theme=light&lang=ru#home` });
    const zoom = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.hm-shell')).zoom) || 1);
    await page.evaluate(() => document.querySelector('.at-people-btn')?.click()); await page.waitForTimeout(350);
    const m = await page.evaluate(() => { const x = document.querySelector('.at-people-menu'); if (!x) return null; const r = x.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, right: r.right, left: r.left, vh: innerHeight, vw: innerWidth, max: x.style.maxHeight, dx: x.style.getPropertyValue('--dx') }; });
    check(`a zoomed shell (×${zoom}): the people menu is inside the screen`, zoom > 1 && m && m.bottom <= m.vh + 1 && m.left >= -1 && m.right <= m.vw + 1 && (!m.max || parseFloat(m.max) * zoom <= m.vh), { zoom, m });
    await ctx.close(); }

  // a slider under a finger: 44 px to touch, and the row is no taller for it
  { const { ctx, page, go } = await open({ w: 360, h: 792, mobile: true, url: H('#systems') });
    const keys = await page.evaluate(() => [...document.querySelectorAll('.ah-tile[data-device-key]')].map(x => x.dataset.deviceKey)); let found = null;
    for (const k of keys) { await page.evaluate(h => { location.hash = h; }, `#systems?device=${encodeURIComponent(k)}`); await page.waitForTimeout(250); await page.evaluate(() => document.querySelectorAll('.hm-sheet details').forEach(d => { d.open = true; })); found = await page.evaluate(() => { const i = document.querySelector('.hm-sheet .ah-slider input[type=range]'); if (!i) return null; const r = i.getBoundingClientRect(), row = i.closest('.ah-slider').getBoundingClientRect(), label = i.closest('.ah-slider').querySelector('.ah-row-text').getBoundingClientRect(); return { h: Math.round(r.height), row: Math.round(row.height), label: Math.round(label.height) }; }); if (found) break; }
    check('a sheet with a slider on the snapshot', !!found, keys.length);
    if (found) check('the slider takes 44 px of touch and the row stays compact', found.h >= 44 && found.row <= found.label + 18 + 6 + 6 + 28, found);
    await ctx.close(); }

  // ---- 8. an update without a restart of Home Assistant: the administrator is told once
  { const { ctx, page } = await open({ url: H('#home') });
    check('no note while the versions agree', await page.evaluate(() => !document.querySelector('.hm-toast')));
    await page.evaluate(() => window.atomPreview.setRestartNeeded(true)); await page.waitForTimeout(350);
    const said = await page.evaluate(() => document.querySelector('.hm-toast')?.textContent ?? null);
    check('«нужен перезапуск Home Assistant» is said', /нужен перезапуск Home Assistant/.test(said ?? ''), said);
    await page.evaluate(() => { document.querySelector('.hm-toast')?.click(); }); await page.waitForTimeout(200); await page.evaluate(() => { window.atomPreview.setRestartNeeded(false); window.atomPreview.setRestartNeeded(true); window.atomPreview.redraw(); }); await page.waitForTimeout(350);
    check('once: closed, it does not come back', await page.evaluate(() => !document.querySelector('.hm-toast')));
    await ctx.close();
    const b = await open({ url: H('#home'), init: () => { window.__beforeDraw = h => h.setAdmin(false); } });
    await b.page.evaluate(() => window.atomPreview.setRestartNeeded(true)); await b.page.waitForTimeout(350);
    check('a household member who cannot restart is not told', await b.page.evaluate(() => !document.querySelector('.hm-toast')), await b.page.evaluate(() => document.querySelector('.hm-toast')?.textContent ?? null));
    await b.ctx.close(); }

  // ---- 9. the house's time zone: a browser in New York shows the house's clock
  { const want = () => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Chisinau' }).format(Date.now()), local = () => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }).format(Date.now());
    const { ctx, page, go } = await open({ tz: 'America/New_York', url: H('#home?device=clock'), init: () => { window.__timeZone = 'Europe/Chisinau'; } });
    await page.waitForSelector('.at-clock-big', { timeout: 8000 }).catch(() => {}); const before = want(), shown = await page.evaluate(() => document.querySelector('.at-clock-big b')?.textContent ?? null), after = want();
    check('the clock sheet shows the house\'s time, not the browser\'s', (shown === before || shown === after) && shown !== local(), { shown, house: after, browser: local() });
    const tile = await (async () => { await go(H('#home')); return page.evaluate(() => { const c = document.querySelector('.ah-clock, .at-clock-tile'); return c ? (c.getAttribute('aria-label') ?? '') + ' ' + c.textContent : null; }); })();
    check('the clock tile too', tile !== null && (tile.includes(want()) || tile.includes(before)), { tile: tile?.slice(0, 120), house: want() });
    // CODEX-014: the rail's clock and the header's greeting by the house's clock too
    const rail = await page.evaluate(() => document.querySelector('.hm-sidebar .hm-clock strong')?.textContent ?? null), h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Chisinau' }).format(Date.now()));
    check('CODEX-014: the rail\'s clock shows the house\'s time, not the browser\'s', rail !== null && (rail === want() || rail === before) && rail !== local(), { rail, house: want(), browser: local() });
    const greet = await page.evaluate(() => document.querySelector('.hm-head-title p')?.textContent ?? ''), word = h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    check('CODEX-014: the greeting by the house\'s hour', greet.startsWith(word), { greet, houseHour: h });
    await ctx.close(); }

  // ---- 10. the tracked bundle knows the version it was built for (the «restart» note compares it with the integration's)
  { const version = JSON.parse(await readFile(resolve(root, '../custom_components/atom_home/manifest.json'), 'utf8')).version, bundle = await readFile(resolve(root, '../custom_components/atom_home/frontend/atom-home.js'), 'utf8');
    check(`the tracked bundle carries «${version}» (rebuild after a version bump: npm run build)`, bundle.includes('data-atom-version') && new RegExp('["\'`]' + version.replace(/\./g, '\\.') + '["\'`]').test(bundle), { version, attr: bundle.includes('data-atom-version') }); }
  // ================= round 2 of the audit (NAV): the shell's focus, arrows, banners, questions, routing, live regions =================
  // the deep focused element (inside the preview's shadow root too), as a short description
  const active = page => page.evaluate(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; if (!a || a === document.body) return 'body'; return `${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]}|${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}`; });
  const where = page => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const r = a.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), rail: !!a.closest('.hm-sidebar, .hm-tabbar'), main: !!a.closest('.hm-main'), sheet: !!a.closest('.hm-sheet'), tag: a.tagName, type: a.type ?? '', inView: r.top >= -1 && r.bottom <= innerHeight + 1 }; });
  const cmds = page => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').map(c => `${c.domain}.${c.service}`));
  const allCmds = page => page.evaluate(() => window.atomPreview.host.log.map(c => c.domain === 'ws' ? `ws:${c.data?.type ?? c.service}` : `${c.domain}.${c.service}`));
  const state = page => page.evaluate(() => ({ hash: location.hash, confirm: !!document.querySelector('.hm-confirm'), sheet: !!document.querySelector('.hm-sheet'), toast: document.querySelector('.hm-toast')?.textContent ?? null }));
  const toast = page => page.evaluate(() => document.querySelector('.hm-toast')?.textContent ?? null);
  const watchLive = page => page.evaluate(() => { window.__said = []; new MutationObserver(list => { for (const m of list) { for (const n of m.addedNodes) if (!(n.nodeType === 1 && n.closest('[aria-hidden="true"]'))) window.__said.push((n.textContent ?? '').trim()); } }).observe(document.querySelector('.hm-shell > .hm-announce'), { childList: true, subtree: true }); });
  // a television as the round-2 auditor emulated it: no hover, no pointer (and no touch points: the context has none)
  const TV = () => { const mm = window.matchMedia.bind(window); window.matchMedia = q => /any-hover:\s*none|any-pointer:\s*none/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q); };
  // the clock module's «будильник звонит» flag, there from the first draw
  const ALARM = () => { window.__beforeDraw = h => { const at = new Date().toISOString(), S = h.states(); S['input_boolean.alarm_ringing'] = { state: 'on', attributes: {}, last_changed: at, last_updated: at }; }; };
  // ---- 11. f0 / f69: the keyboard's place survives a command (with the keyboard, the house accepts slowly), in the page and inside a shadow root
  for (const shadow of [false, true]) { const q = shadow ? '&shadow=1' : '', hq = shadow ? '?shadow=1' : '', tag = shadow ? ' (shadow root)' : '';
    const cases = [
      ['a Home tile', H('#lights', hq), '.ah-tile.kind-light:not(.is-unavailable) .ah-tile-hit'],
      ['a room page button', null, '.rm-tile-act:not([disabled])'],
      ['a security button', C('security', 'disarmed', '#security', q), '.at-sec-main'],
      ['a heating stepper', C('heating', 'normal', '#climate', q), '.at-heat-pm:not([disabled])'],
      ['a vacuum button', C('vacuum', 'docked', '#cleaning', q), '.at-vac-big'],
    ];
    for (const [name, url, sel] of cases) {
      const { ctx, page, go } = await open({ url: url ?? H('#rooms', hq) });
      if (!url) { // the first room that has a quick button
        const rooms = await page.locator('.hm-room-grid.is-page button').count(); let found = false;
        for (let i = 0; i < rooms && !found; i++) { await go(H('#rooms', hq)); await page.locator('.hm-room-grid.is-page button').nth(i).click(); await page.waitForTimeout(400); found = (await page.locator(sel).filter({ hasNotText: /вод/i }).count()) > 0; }
      }
      const loc = (url ? page.locator(sel) : page.locator(sel).filter({ hasNotText: /вод/i })).first();
      if (!(await loc.count())) { check(`focus kept: ${name}${tag} — control present`, false, sel); await ctx.close(); continue; }
      await page.evaluate(() => { window.atomPreview.setAccept(true); window.atomPreview.setDelay(700); });
      await loc.focus(); const before = await active(page), n0 = await sent(page);
      await page.keyboard.press('Enter'); await page.waitForTimeout(200); const during = await active(page);
      await page.waitForTimeout(5200); const after = await active(page);
      check(`focus kept: ${name}${tag}`, before !== 'body' && after === before && (await sent(page)) > n0, { before, during, after, sent: (await sent(page)) - n0 });
      await ctx.close();
    }
    // a sheet's power row
    { const { ctx, page, go } = await open({ url: H('#lights', hq) });
      const key = await page.locator('.ah-tile.kind-light:not(.is-unavailable)').first().getAttribute('data-device-key');
      await go(H(`#lights?device=${encodeURIComponent(key)}`, hq)); await page.evaluate(() => { window.atomPreview.setAccept(true); window.atomPreview.setDelay(700); });
      const row = page.locator('.hm-sheet button.hm-pill, .hm-sheet .ah-power, .hm-sheet .ah-row.is-button').first(); await row.focus(); const before = await active(page);
      await page.keyboard.press('Enter'); await page.waitForTimeout(5200); const after = await active(page);
      check(`focus kept: a sheet's power row${tag}`, before !== 'body' && after === before, { before, after }); await ctx.close(); }
    // the net itself: a card that still DISABLES its control while it waits
    { const { ctx, page } = await open({ url: H('#lights', hq) });
      const loc = page.locator('.ah-tile.kind-light .ah-tile-hit').first(); await loc.focus(); const before = await active(page);
      await loc.evaluate(el => { el.disabled = true; }); await page.waitForTimeout(400); const during = await active(page);
      await loc.evaluate(el => { el.disabled = false; }); await page.waitForTimeout(300); const after = await active(page);
      check(`the net: a focused control that was disabled gets the focus back when it is free${tag}`, before !== 'body' && after === before, { before, during, after });
      // …but not when the person moved on meanwhile
      await loc.evaluate(el => { el.disabled = true; }); await page.waitForTimeout(200); const other = page.locator('.ah-tile.kind-light .ah-tile-hit').nth(1); await other.focus(); const moved = await active(page);
      await loc.evaluate(el => { el.disabled = false; }); await page.waitForTimeout(300);
      check(`the net: nothing is taken from somebody who moved the focus${tag}`, (await active(page)) === moved && moved !== before, { moved, now: await active(page) });
      await ctx.close(); }
  }
  // ---- 12. f5: the arrows of a remote; l145: a touch kiosk is not a television
  // ---- f5: arrows
  for (const [w, h, tv] of [[1920, 1080, true], [1070, 764, false]]) { const { ctx, page, go } = await open({ w, h, touch: false, url: H('#home'), init: tv ? TV : undefined }); const tag = `${w}x${h}${tv ? ' TV' : ''}`;
    if (tv) check(`${tag}: the shell is a television (zoomed)`, await page.evaluate(() => document.querySelector('.hm-shell').classList.contains('is-tv') && Number(getComputedStyle(document.querySelector('.hm-shell')).zoom) > 1));
    if (tv) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); const a = await where(page); check(`${tag}: with nothing focused an arrow lands on the page's first control`, !!a && a.main, a);
      // release «classic»: the house status strip stands above the tiles — the arrows lead from it down into them; the walk below starts at the first tile
      const inStrip = await page.evaluate(() => !!document.activeElement?.closest('.ah-status')); if (inStrip) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); check(`${tag}: from the status strip ArrowDown goes down into Home's tiles`, await page.evaluate(() => !!document.activeElement?.closest('.hm-home')), await where(page)); }
      await page.locator('.hm-home button:not([disabled])').first().focus(); }
    else { await page.locator('.hm-home button:not([disabled])').first().focus(); }
    const seen = []; let moved = 0, prev = await where(page);
    // the direction is judged with both controls measured AFTER the step (release «classic»: with the status strip above them the tiles reach below the
    // fold, the step scrolls the page, and a control measured before the scroll is not comparable with one measured after it)
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) { await page.evaluate(() => { window.__from = document.activeElement; }); await page.keyboard.press(k); await page.waitForTimeout(120); const a = await where(page); prev = await page.evaluate(() => { const f = window.__from, r = f?.isConnected ? f.getBoundingClientRect() : null; return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; }) ?? prev; if (a && prev && (a.x !== prev.x || a.y !== prev.y)) { moved++; const ok = k === 'ArrowRight' ? a.x > prev.x : k === 'ArrowLeft' ? a.x < prev.x : k === 'ArrowDown' ? a.y > prev.y : a.y < prev.y; seen.push(`${k}:${ok ? 'ok' : 'WRONG'}:${a.inView ? '' : 'offscreen'}`); } else seen.push(`${k}:stay`); prev = a; }
    check(`${tag}: arrows walk the Home tiles, each in its direction and into view`, moved >= 4 && !seen.some(s => /WRONG|offscreen/.test(s)), seen);
    let rail = false; for (let i = 0; i < 12 && !rail; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(80); rail = !!(await where(page))?.rail; }
    check(`${tag}: ArrowLeft reaches the navigation rail`, rail, await where(page));
    // along the rail: down, or up when ←/→ brought the focus to its last button (with the status strip above them Home's tiles sit lower, so a row
    // low on the page meets «Настройка», under which there is nothing more of the rail) — as on design-2026
    const atEnd = await page.evaluate(() => { const b = [...document.querySelectorAll('.hm-sidebar nav button')]; return b.length > 1 && document.activeElement === b.at(-1); });
    await page.keyboard.press(atEnd ? 'ArrowUp' : 'ArrowDown'); await page.waitForTimeout(100); const r2 = await where(page); check(`${tag}: and walks it`, !!r2?.rail, { ...r2, atEnd });
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); check(`${tag}: ArrowRight goes back to the page`, !!(await where(page))?.main, await where(page));
    // OK opens a sheet; the arrows stay inside it (the page under it is inert)
    await page.evaluate(() => document.querySelector('.ah-tile.kind-light .ah-tile-hit, .hm-page .ah-tile-more, .hm-page button.ah-clock')?.focus());
    // a slider in a light's sheet keeps its arrows
    const dimm = await page.evaluate(() => { const s = window.atomPreview.host.states(); return Object.keys(s).find(i => i.startsWith('light.') && (s[i].attributes?.supported_color_modes ?? []).some(m => m !== 'onoff')); });
    if (dimm) { await page.evaluate(id => { window.atomPreview.setAccept(true); window.atomPreview.setStates({ [id]: 'on' }); location.hash = '#lights?device=' + encodeURIComponent('e:' + id); }, dimm); await page.waitForTimeout(700);
      const ok = await page.evaluate(() => { const s = document.querySelector('.hm-sheet [role=slider], .hm-sheet input[type=range]'); if (!s) return false; s.focus(); return true; });
      if (ok) { const a0 = await active(page), n0 = await sent(page); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(500);
        check(`${tag}: a slider in a light's sheet keeps its arrows (focus stays, the value is sent)`, (await active(page)) === a0 && (await sent(page)) > n0, { a0, now: await active(page), sent: (await sent(page)) - n0 }); }
      else check(`${tag}: the light's sheet has a slider`, false, dimm);
      await page.keyboard.press('Tab'); await page.waitForTimeout(100); let inside = true; for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown']) { await page.keyboard.press(k); await page.waitForTimeout(70); const a = await where(page); if (a && !a.sheet) inside = false; }
      check(`${tag}: in a sheet the arrows never leave it for the page underneath`, inside, await where(page)); }
    if (!tv) { // a text field in «Настройка» keeps its arrows
      await go(H('#setup')); const field = page.locator('.hm-page input[type=search], .hm-page input[type=text], .hm-page input:not([type])').first();
      if (await field.count()) { await field.focus(); const a0 = await active(page); for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp']) await page.keyboard.press(k); check(`${tag}: a text field in «Настройка» keeps its arrows`, (await active(page)) === a0, { a0, now: await active(page) }); }
      else check(`${tag}: «Настройка» has a text field`, false);
      // somebody who clicked last scrolls with the arrows as before
      await go(H('#home')); await page.mouse.click(w / 2, 20); const b0 = await active(page); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120); check(`${tag}: after a click the arrows are left to scrolling`, (await active(page)) === b0, { b0, now: await active(page) }); }
    await ctx.close(); }
  // l145: a touch kiosk of 1920 px is not a television
  { const { ctx, page } = await open({ w: 1920, h: 1080, touch: true, mobile: true, url: H('#home') });
    const k = await page.evaluate(() => { const s = document.querySelector('.hm-shell'); return { tv: s.classList.contains('is-tv'), zoom: Number(getComputedStyle(s).zoom) || 1, touch: navigator.maxTouchPoints, noHover: matchMedia('(any-hover: none)').matches }; });
    check('a 1920×1080 touch screen without hover is laid out 1:1, not as a television', !k.tv && k.zoom === 1 && k.touch > 0, k); await ctx.close(); }
  // ---- 13. f43 / l1 / f45: the house's alarm over every page and sheet; the valve's question during a leak
  // ---- f43: the alarm banner on every page and over a sheet
  // release «classic» (from design 2026 phase 2): the banner became a takeover — its one main action by its reason (the alarm and the entry delay: «Снять с охраны», which asks; a leak
  // with the valve already shut, gas: «Показать») and «Показать» beside it when the main one is not it
  for (const [scenario, word, keys] of [['triggered', 'Тревога!', ['Снять с охраны', 'Показать']], ['pending', 'Вход — снимите охрану', ['Снять с охраны', 'Показать']], ['leak', 'Протечка!', ['Показать']], ['gas', 'Утечка газа!', ['Показать']]]) {
    const { ctx, page, go } = await open({ url: C('security', scenario, '#home') });
    // count what the live region is given, from now on
    await page.evaluate(() => { window.__said = []; const live = document.querySelector('.hm-shell > .hm-announce'); new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) window.__said.push((n.textContent ?? '').trim()); }).observe(live, { childList: true, subtree: true, characterData: true }); });
    const read = () => page.evaluate(() => { const b = document.querySelector('.ah-take.is-alarm'); return b ? { text: b.querySelector('.ah-take-title')?.textContent ?? '', timer: b.querySelector('[role=timer]')?.textContent?.trim() ?? null, buttons: [...b.querySelectorAll('button')].map(x => x.textContent.trim()), inLive: !!b.closest('[aria-live]'), top: Math.round(b.getBoundingClientRect().top) } : null; });
    const pages = {}; for (const hash of ['#home', '#lights', '#energy', '#rooms']) { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(350); pages[hash] = await read(); }
    check(`${scenario}: the takeover «${word}» stands on #home, #lights, #energy, #rooms with «${keys.join('» + «')}»`, Object.values(pages).every(b => b && b.text.startsWith(word) && JSON.stringify(b.buttons) === JSON.stringify(keys) && !b.inLive), pages);
    if (scenario === 'pending') { const t1 = pages['#rooms']?.timer; await page.waitForTimeout(1300); const t2 = (await read())?.timer; check('pending: the entry delay counts down in a timer outside the live region', /^\d:\d\d$/.test(t1 ?? '') && /^\d:\d\d$/.test(t2 ?? '') && t1 !== t2, { t1, t2 }); }
    else check(`${scenario}: no countdown`, Object.values(pages).every(b => b && b.timer === null));
    // over an open device sheet
    const key = await page.evaluate(() => { location.hash = '#lights'; return new Promise(r => setTimeout(() => r(document.querySelector('.ah-tile.kind-light')?.dataset.deviceKey ?? null), 350)); });
    if (key) { await page.evaluate(k => { location.hash = '#lights?device=' + encodeURIComponent(k); }, key); await page.waitForTimeout(450);
      const over = await page.evaluate(() => { const b = document.querySelector('.ah-take.is-alarm'), s = document.querySelector('.hm-sheet'); if (!b || !s) return null; const r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { sheet: true, onTop: !!top?.closest('.ah-take.is-alarm'), inert: !!b.closest('[inert]') }; });
      check(`${scenario}: the takeover stands over an open device sheet and can be pressed`, over && over.onTop && !over.inert, over); }
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.atomPreview.redraw()); await page.waitForTimeout(40); }
    await page.locator('.ah-take.is-alarm button', { hasText: 'Показать' }).click(); await page.waitForTimeout(500);
    const at = await page.evaluate(() => ({ hash: location.hash, sheet: !!document.querySelector('.hm-sheet'), panel: !!document.querySelector('.at-sec-panel'), banner: !!document.querySelector('.ah-take.is-alarm') }));
    check(`${scenario}: «Показать» leads to «Безопасность» (the sheet is closed), where the page itself says it and the takeover is gone`, at.hash === '#security' && !at.sheet && at.panel && !at.banner, at);
    const said = await page.evaluate(() => window.__said.filter(s => s));
    const live = await page.evaluate(() => [...document.querySelectorAll('.hm-shell > .hm-announce > span.at-vh')].map(s => s.textContent));
    check(`${scenario}: the live region holds the alarm's words once and was given nothing more through pages, a sheet and 8 redraws`, live.filter(s => s.startsWith(word)).length === 1 && said.filter(s => s.startsWith(word)).length === 0, { live, said });
    await ctx.close(); }
  // calm: no banner; the alarm appearing is announced once
  { const { ctx, page } = await open({ url: C('security', 'disarmed', '#lights') });
    check('a calm house has no alarm takeover and nothing in the live region', await page.evaluate(() => !document.querySelector('.ah-take.is-alarm') && !document.querySelector('.hm-shell > .hm-announce > span')));
    await page.evaluate(() => { window.__said = []; new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) window.__said.push((n.textContent ?? '').trim()); }).observe(document.querySelector('.hm-shell > .hm-announce'), { childList: true, subtree: true }); });
    // focus on a tile, then the leak: the banner is the next Tab stop and does not take the focus away
    await page.locator('.hm-page button:not([disabled])').first().focus(); const before = await active(page);
    await page.evaluate(() => window.atomPreview.setStates({ 'binary_sensor.bath_leak_water_leak': 'on' })); await page.waitForTimeout(400);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.atomPreview.redraw()); await page.waitForTimeout(30); }
    const said = await page.evaluate(() => window.__said.filter(Boolean));
    check('a leak that starts is announced once (across 8 redraws) and shown on «Свет»', said.length === 1 && /^Протечка!/.test(said[0]) && await page.evaluate(() => !!document.querySelector('.ah-take.is-alarm')), said);
    check('l1: the banner does not take the focus from the control in use', (await active(page)) === before, { before, now: await active(page) });
    await page.keyboard.press('Tab'); await page.waitForTimeout(120); check('l1: …and its main action («Перекрыть воду»: the valve is open) is the next Tab stop', /Перекрыть воду/.test(await active(page)) && await page.evaluate(() => !!document.activeElement?.closest('.ah-banners .is-main')), await active(page));
    await ctx.close(); }
  { // nothing focused, keyboard user: the banner takes the focus
    const { ctx, page } = await open({ url: C('security', 'disarmed', '#lights') });
    await page.keyboard.press('Shift'); await page.evaluate(() => document.activeElement?.blur?.());
    await page.evaluate(() => window.atomPreview.setStates({ 'binary_sensor.bath_leak_water_leak': 'on' })); await page.waitForTimeout(400);
    check('l1: with nothing focused (keyboard), the takeover\'s main action takes the focus', await page.evaluate(() => !!document.activeElement?.closest('.ah-banners .is-main')), await active(page));
    // an input keeps the focus
    await ctx.close(); }
  // ---- f45: the valve question during a leak, from the room page and from the valve's sheet
  { const { ctx, page, go } = await open({ url: C('security', 'leak', '#systems?device=' + encodeURIComponent('e:valve.bath_water')) });
    await page.evaluate(() => window.atomPreview.setAccept(true));
    const openBtn = page.locator('.hm-sheet button', { hasText: /^Открыть$/ }).first(); const has = await openBtn.count();
    if (has) { await openBtn.click(); await page.waitForTimeout(300);
      const q = await page.evaluate(() => { const c = document.querySelector('.hm-confirm'); return c ? { text: c.querySelector('p').textContent, buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()), focus: document.activeElement?.textContent?.trim() } : null; });
      check('f45: from the valve\'s sheet, during a leak the question names the leak, first button «Оставить закрытым»', q && /Сейчас протечка/.test(q.text) && /Ванная/.test(q.text) && q.buttons[0] === 'Оставить закрытым' && q.buttons.length === 2, q);
      const n0 = await sent(page); await page.locator('.hm-confirm button').first().click(); await page.waitForTimeout(300); check('f45: «Оставить закрытым» sends nothing and closes the question', (await sent(page)) === n0 && await page.evaluate(() => !document.querySelector('.hm-confirm'))); }
    else check('f45: the valve\'s sheet has «Открыть»', false, await page.evaluate(() => [...document.querySelectorAll('.hm-sheet button')].map(b => b.textContent.trim()).slice(0, 12)));
    // the room page
    await go(C('security', 'leak', '#rooms')); const rooms = await page.locator('.hm-room-grid.is-page button').count(); let found = false;
    for (let i = 0; i < rooms && !found; i++) { await go(C('security', 'leak', '#rooms')); await page.locator('.hm-room-grid.is-page button').nth(i).click(); await page.waitForTimeout(400); found = (await page.locator('.rm-tile-act', { hasText: /Открыть воду/ }).count()) > 0; }
    if (found) { await page.evaluate(() => window.atomPreview.setAccept(true)); await page.locator('.rm-tile-act', { hasText: /Открыть воду/ }).first().click(); await page.waitForTimeout(300);
      const q = await page.evaluate(() => { const c = document.querySelector('.hm-confirm'); return c ? { text: c.querySelector('p').textContent, buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()) } : null; });
      check('f45: from the room page too', q && /Сейчас протечка/.test(q.text) && q.buttons[0] === 'Оставить закрытым', q);
      const n0 = await sent(page); await page.locator('.hm-confirm button').nth(1).click(); await page.waitForTimeout(400); check('f45: the second button opens the valve', (await cmds(page)).slice(n0).includes('valve.open_valve'), (await cmds(page)).slice(n0)); }
    else check('f45: a room with «Открыть воду»', false);
    await ctx.close(); }
  // ---- 14. questions, «Back», cold links, saves
  const valveUrl = C('security', 'disarmed', '#systems?device=' + encodeURIComponent('e:valve.bath_water'));
  // ---- l88: no question while the house is offline
  { const { ctx, page } = await open({ url: H('#home') });
    const chev = page.locator('.ah-thermo .ah-chev.is-up:not([disabled])').first();
    if (!(await chev.count())) check('l88: a thermostat tile on Home', false);
    else { await chev.click(); await page.waitForTimeout(300); const asked = (await state(page)).confirm; if (asked) { await page.locator('.hm-confirm button').first().click(); await page.waitForTimeout(250); }
      await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(250); const n0 = await sent(page);
      await chev.click({ force: true }); await page.waitForTimeout(350); const s = await state(page);
      check('l88: the step that asks «Включить нагрев…» online opens no question offline: «Нет связи с домом» at once, nothing sent', asked && !s.confirm && /Нет связи с домом/.test(s.toast ?? '') && (await sent(page)) === n0, { asked, s }); }
    await ctx.close(); }
  // ---- l33: «Выполнить» while another command of the same device is on its way
  { const { ctx, page } = await open({ url: C('security', 'leak', '#systems?device=' + encodeURIComponent('e:valve.bath_water')) });
    await page.evaluate(() => { window.atomPreview.setAccept(true); window.atomPreview.setDelay(1500); });
    const btn = page.locator('.hm-sheet button', { hasText: /^Открыть$/ }).first();
    await btn.click(); await page.waitForTimeout(250); await page.locator('.hm-confirm .at-confirm-yes').click(); await page.waitForTimeout(200); // the first command: on its way for 1.5 s
    await btn.click({ force: true }); await page.waitForTimeout(250); const asked = (await state(page)).confirm;
    if (!asked) check('l33: (the sheet holds its button while the command is on its way: a second question cannot be asked)', (await cmds(page)).length === 1, await cmds(page));
    else { await page.locator('.hm-confirm .at-confirm-yes').click(); await page.waitForTimeout(200);
      const mid = await page.evaluate(() => ({ confirm: !!document.querySelector('.hm-confirm'), busy: document.querySelector('.hm-confirm .at-confirm-yes')?.getAttribute('aria-busy') }));
      await page.locator('.hm-confirm .at-confirm-yes').click().catch(() => {}); // an impatient second press
      await page.waitForTimeout(3800); const s = await state(page), sentNow = await cmds(page);
      check('l33: the answer waits for the command before it (the button says so), is then carried out once, and the dialog is gone', mid.confirm && mid.busy === 'true' && !s.confirm && sentNow.length === 2, { asked, mid, s, sentNow }); }
    await ctx.close(); }
  // ---- l86: system «Back» with a question open
  { const { ctx, page } = await open({ url: H('#home') });
    await page.evaluate(() => { location.hash = '#systems'; }); await page.waitForTimeout(300);
    const valve = await page.evaluate(() => { const st = window.atomPreview.host.states(); return Object.keys(st).find(id => id.startsWith('valve.')) ?? null; });
    await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="e:${k}"] .ah-tile-more, .ah-tile[data-device-key="e:${k}"] .ah-tile-hit`)?.click(), valve); await page.waitForTimeout(400);
    let s0 = await state(page); if (!s0.sheet) { await page.evaluate(k => { location.hash = '#systems?device=' + encodeURIComponent('e:' + k); }, valve); await page.waitForTimeout(400); s0 = await state(page); }
    await page.locator('.hm-sheet button', { hasText: /^(Открыть|Закрыть)$/ }).first().click(); await page.waitForTimeout(250); const asked = (await state(page)).confirm;
    await page.goBack(); await page.waitForTimeout(500); const s1 = await state(page);
    check('l86: «Back» over a question on a sheet closes the question only: the sheet and its address stay', asked && !s1.confirm && s1.sheet && s1.hash === s0.hash, { s0, s1 });
    await page.goBack(); await page.waitForTimeout(500); const s2 = await state(page);
    check('l86: the next «Back» closes the sheet', !s2.sheet && s2.hash === '#systems', s2);
    await page.goBack(); await page.waitForTimeout(400); check('l86: and the one after leaves the page (#home)', (await state(page)).hash === '#home', await state(page));
    await ctx.close(); }
  // ---- l23: two closes in one tick are one step back
  { const { ctx, page } = await open({ url: H('#home') });
    await page.evaluate(() => { location.hash = '#lights'; }); await page.waitForTimeout(300);
    await page.locator('.ah-tile.kind-light .ah-tile-more, .ah-tile.kind-light .ah-tile-hit').first().focus();
    const key = await page.locator('.ah-tile.kind-light').first().getAttribute('data-device-key');
    await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="${k}"] .ah-tile-more`)?.click(), key); await page.waitForTimeout(400);
    let s = await state(page); if (!s.sheet) { check('l23: a light\'s sheet opened from its tile', false, s); }
    else { await page.evaluate(() => { const x = document.querySelector('.hm-sheet .hm-icon-btn'); x.click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); await page.waitForTimeout(600);
      s = await state(page); check('l23: «×» and two Escapes in one tick close the sheet and stay on «Свет»', !s.sheet && s.hash === '#lights', s); }
    await ctx.close(); }
  // ---- l28 / l96 / l27: cold links
  { const { ctx, page } = await open({ url: H('#nonsense') }); check('l96: a cold «#nonsense» is Home and the address says so at once', (await state(page)).hash === '#home', await state(page)); await ctx.close(); }
  { const { ctx, page } = await open({ url: H('#energy') });
    const key = await page.evaluate(() => document.querySelector('[data-device-key]')?.dataset.deviceKey ?? Object.keys(window.atomPreview.host.states()).filter(i => i.startsWith('light.')).map(i => 'e:' + i)[0]);
    await page.goto(H('#energy?filter=now&device=' + encodeURIComponent(key))); await page.reload(); await page.waitForSelector('.at-shell'); await page.waitForTimeout(600);
    const s0 = await state(page);
    if (s0.sheet) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); const s = await state(page); check('l28: closing a sheet opened by a cold link keeps the page\'s filter', !s.sheet && s.hash === '#energy?filter=now', { s0, s }); }
    else check('l28: the cold link opened a sheet', false, s0);
    await ctx.close(); }
  { const { ctx, page } = await open({ url: H('#home?device=kettle'), init: () => { window.__pendingFirst = true; } });
    // the settings «not read yet»: the address is kept; once they are read the sheet is there (or, if nothing answers to it, the address is repaired)
    await page.evaluate(() => { window.atomPreview.setConfigPending(true); location.hash = '#home?device=nothing-here'; }); await page.waitForTimeout(400);
    const a = await state(page); await page.evaluate(() => window.atomPreview.setConfigPending(false)); await page.waitForTimeout(400); const b = await state(page);
    check('l27: while the settings are not read an address is not repaired; when they are, it is', a.hash === '#home?device=nothing-here' && b.hash === '#home', { a, b });
    await ctx.close(); }
  // ---- l26: a refused save after a state arrived in between does not leave the panel on the unsaved value
  { const { ctx, page } = await open({ url: `${H('#home')}`.replace('/#home', '/?card=x#home').replace('?card=x', '') });
    const before = await page.evaluate(() => document.querySelector('.hm-shell').getAttribute('lang'));
    await page.locator('.at-lang .at-pill-btn').click(); await page.waitForTimeout(200);
    const r = await page.evaluate(async () => { const P = window.atomPreview; if (!P.store.failNext) return 'no memory store'; P.store.failNext('too_large'); [...document.querySelectorAll('.at-lang-menu button')].find(b => /English/.test(b.textContent)).click(); const st = P.host.states(), id = Object.keys(st).find(k => k.startsWith('sensor.')); P.setStates({ [id]: st[id].state }); await new Promise(r => setTimeout(r, 500)); P.redraw(); await new Promise(r => setTimeout(r, 200)); return { lang: document.querySelector('.hm-shell').getAttribute('lang'), cfg: P.config.home.language, toast: document.querySelector('.hm-toast')?.textContent ?? null }; });
    check('l26: the language the house refused to save is not left on the screen', typeof r === 'object' && r.lang === before && r.cfg === before && !!r.toast, { before, r });
    await ctx.close(); }
  // ---- f57: the re-read after the alarm flag takes the settings whole
  { const { ctx, page } = await open({ url: H('#home'), init: () => { window.__beforeDraw = h => { const at = new Date().toISOString(), S = h.states(); S['input_boolean.alarm_ringing'] = { state: 'off', attributes: {}, last_changed: at, last_updated: at }; }; } });
    const r = await page.evaluate(async () => { const P = window.atomPreview, flag = 'input_boolean.alarm_ringing'; if (!P.store.client) return { client: false };
      const other = P.store.client(), got = await other.load(), next = JSON.parse(JSON.stringify(got.config)); next.home.name = 'С другого экрана'; await other.save(next); // another screen saved (revision + 1)
      P.setStates({ [flag]: 'on' }); await new Promise(r => setTimeout(r, 500));
      const seen = P.config.home.name, title = document.querySelector('.hm-head h1')?.textContent; // what this panel now holds and shows
      // and its next save must not wipe the other screen's change
      let saved = 'ok'; try { await P.store.save({ ...P.config, home: { ...P.config.home, theme: P.config.home.theme === 'dark' ? 'light' : 'dark' } }); } catch (e) { saved = String(e.code ?? e); }
      return { seen, title, saved, name: (await other.load()).config.home.name }; });
    check('f57: after the alarm flag changed the panel holds (and shows) the settings another screen saved, whole; its next save keeps them', r.seen === 'С другого экрана' && r.title === 'С другого экрана' && r.saved === 'ok' && r.name === 'С другого экрана', r);
    await ctx.close(); }
  // ---- 15. the banner's buttons, several banners, the toast, the restart note, the header menus, the live regions
  // ---- f44: the alarm banner's buttons
  { const { ctx, page } = await open({ url: H('#lights'), init: ALARM });
    const b = await page.evaluate(() => { const x = document.querySelector('.at-house-banner:not(.is-alarm)'); return x ? [...x.querySelectorAll('button')].map(y => y.textContent.trim()) : null; });
    check('the alarm banner is up with «Стоп»', b && b.includes('Стоп'), b);
    await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(200); const n0 = (await allCmds(page)).length;
    await page.locator('.at-house-banner:not(.is-alarm) button', { hasText: 'Стоп' }).click(); await page.waitForTimeout(300);
    check('f44: offline, «Стоп» sends nothing and says «Нет связи с домом»', (await allCmds(page)).length === n0 && /Нет связи с домом/.test(await toast(page) ?? ''), { sent: (await allCmds(page)).slice(n0), toast: await toast(page) });
    await page.evaluate(() => { window.atomPreview.setOnline(true); window.atomPreview.setRefusal({ code: 'home_assistant_error', message: 'будильник занят' }); }); await page.waitForTimeout(300);
    check('l90: back on the line, the «Нет связи с домом» message is gone', !/Нет связи/.test(await toast(page) ?? ''), await toast(page));
    await page.locator('.at-house-banner:not(.is-alarm) button', { hasText: 'Стоп' }).click(); await page.waitForTimeout(500);
    check('f44: a refusal of «Стоп» is told (the banner stays)', /Дом отклонил команду|будильник занят|Команда не выполнена/.test(await toast(page) ?? '') && await page.evaluate(() => !!document.querySelector('.at-house-banner:not(.is-alarm)')), await toast(page));
    const extra = page.locator('.at-house-banner:not(.is-alarm) button').first(); if ((await extra.textContent())?.trim() !== 'Стоп') { await page.evaluate(() => document.querySelector('.hm-toast')?.click()); await extra.click(); await page.waitForTimeout(500); check('f44: a refusal of «Ещё 9 минут» is told too', !!(await toast(page)), await toast(page)); }
    // pending state and one command per press
    await page.evaluate(() => { window.atomPreview.setRefusal(null); window.atomPreview.setAccept(true); window.atomPreview.setDelay(900); document.querySelector('.hm-toast')?.click(); }); const n1 = (await allCmds(page)).length;
    const stop = page.locator('.at-house-banner:not(.is-alarm) button', { hasText: 'Стоп' }); await stop.click(); await page.waitForTimeout(150); const busy = await stop.getAttribute('aria-busy'); await stop.click({ force: true }); await page.waitForTimeout(1500);
    const sentStop = (await allCmds(page)).slice(n1); check('f44: «Стоп» waits (aria-busy) and a second press sends nothing more', busy === 'true' && sentStop.length >= 1 && new Set(sentStop).size === sentStop.length, { busy, sentStop });
    await ctx.close(); }
  // ---- several banners at once: the house's alarm first, each reachable
  { const { ctx, page } = await open({ url: C('security', 'leak', '#lights'), init: ALARM });
    const list = await page.evaluate(() => [...document.querySelectorAll('.hm-shell > .ah-banners > .ah-take')].map(b => { const r = b.getBoundingClientRect(), btn = b.querySelector('button'), br = btn.getBoundingClientRect(), hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2); return { alarm: b.classList.contains('is-alarm'), top: Math.round(r.top), bottom: Math.round(r.bottom), reachable: hit === btn || btn.contains(hit), text: b.textContent.slice(0, 30) }; }));
    check('alarm + module banner together: the alarm comes first, they do not cover each other, each button can be pressed', list.length === 2 && list[0].alarm && !list[1].alarm && list[1].top >= list[0].bottom - 2 && list.every(b => b.reachable), list);
    await page.screenshot({ path: resolve(out, 'banners-two-1070.png') });
    await ctx.close(); }
  // ---- the toast: l8 held by the keyboard's focus, long texts stay longer; l165 «нет связи» said once
  { const { ctx, page } = await open({ url: H('#lights') });
    await watchLive(page);
    await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(300);
    await page.locator('.ah-tile.kind-light .ah-tile-hit:not([disabled])').first().click({ force: true }); await page.waitForTimeout(300);
    const t = await page.evaluate(() => { const x = document.querySelector('.hm-toast'); return x ? { text: x.textContent, hidden: x.getAttribute('aria-hidden'), tab: x.tabIndex } : null; });
    const said = await page.evaluate(() => window.__said.filter(Boolean)), lines = await page.evaluate(() => [...document.querySelectorAll('.hm-shell > .hm-announce > span.at-vh')].map(s => s.textContent));
    check('l165: offline and a refused tap: the live region holds «Нет связи с домом» in one line, the visible message is not read a second time', t && /Нет связи/.test(t.text) && t.hidden === 'true' && lines.filter(s => /Нет связи/.test(s)).length === 1 && said.filter(s => /Нет связи/.test(s)).length === 2 /* the outage, then the tap's answer */, { t, said, lines });
    await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForTimeout(300);
    check('l90: the message «Нет связи с домом» leaves with the outage', (await toast(page)) === null, await toast(page));
    // a refusal: held while it has the focus
    await page.evaluate(() => window.atomPreview.setRefusal({ code: 'home_assistant_error', message: 'нет' })); await page.locator('.ah-tile.kind-light .ah-tile-hit:not([disabled])').first().focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    const before = await active(page); await page.locator('.hm-toast').focus(); await page.waitForTimeout(7200);
    check('l8: a message that has the keyboard\'s focus stays past its six seconds', !!(await toast(page)), await toast(page));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300); check('l8: Escape on it dismisses it (and closes nothing else)', (await toast(page)) === null && (await page.evaluate(() => location.hash)) === '#lights');
    await ctx.close(); }
  // ---- l31: «нужен перезапуск» stays findable
  { const { ctx, page } = await open({ url: H('#home') });
    await page.evaluate(() => window.atomPreview.setRestartNeeded(true)); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('.hm-toast')?.click()); await page.waitForTimeout(200);
    const badge = await page.evaluate(() => { const b = document.querySelector('.hm-head .at-restart-needed'); return b ? { text: b.textContent, title: b.title, over: document.querySelector('.hm-head').scrollWidth > document.querySelector('.hm-head').clientWidth + 1 } : null; });
    check('l31: after the toast is closed a badge in the header still says «Перезапустите Home Assistant»', badge && /Перезапустите Home Assistant/.test(badge.text) && /нужен перезапуск/.test(badge.title), badge);
    await page.evaluate(() => { location.hash = '#lights'; }); await page.waitForTimeout(300); check('l31: …on every page', await page.evaluate(() => !!document.querySelector('.hm-head .at-restart-needed')));
    await page.evaluate(() => window.atomPreview.setAdmin(false)); await page.waitForTimeout(200); check('l31: a household member does not see it', await page.evaluate(() => !document.querySelector('.at-restart-needed')));
    await ctx.close(); }
  // ---- l163: header menus opened from the keyboard take the focus; Escape gives it back
  { const { ctx, page } = await open({ w: 1440, h: 900, touch: false, url: `${C('header', 'allHome', '#home')}` });
    for (const [btn, menu, name] of [['.at-people-btn', '.at-people-menu', 'people'], ['.at-lang .at-pill-btn', '.at-lang-menu', 'language']]) {
      if (!(await page.locator(btn).count())) { check(`l163: ${name} button present`, false); continue; }
      await page.locator(btn).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const inMenu = await page.evaluate(m => !!document.activeElement?.closest(m), menu);
      check(`l163: Enter opens the ${name} menu and the focus is inside it`, inMenu, await active(page));
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      check(`l163: Escape closes it and the focus is back on its button`, await page.evaluate(([b, m]) => !document.querySelector(m) && document.activeElement === document.querySelector(b), [btn, menu]), await active(page));
      await page.locator(btn).click(); await page.waitForTimeout(200); check(`l163: opened by the mouse, the ${name} menu does not move the focus into itself`, await page.evaluate(m => !!document.querySelector(m) && !document.activeElement?.closest(m), menu)); await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    await ctx.close(); }
  // ---- l180: an empty live region is not rewritten on a redraw
  { const { ctx, page } = await open({ url: H('#home') });
    const n = await page.evaluate(async () => { let n = 0; const mo = new MutationObserver(l => { n += l.length; }); for (const el of [document.querySelector('.hm-shell > [role=status]'), document.querySelector('.hm-shell > .hm-announce')]) mo.observe(el, { childList: true, subtree: true, characterData: true }); for (let i = 0; i < 8; i++) { window.atomPreview.redraw(); await new Promise(r => setTimeout(r, 30)); } return n; });
    check('l180: eight redraws write nothing into the shell\'s two live regions', n === 0, n); await ctx.close(); }
  // ---- f1: the alarm editor opened from a room takes the focus and keeps it
  { const { ctx, page, go } = await open({ w: 1440, h: 900, touch: false, url: H('#rooms') });
    const rooms = await page.locator('.hm-room-grid.is-page button').count(); let card = null;
    for (let i = 0; i < rooms && !card; i++) { await go(H('#rooms')); await page.locator('.hm-room-grid.is-page button').nth(i).click(); await page.waitForTimeout(350); const c = page.locator('.hm-page button', { hasText: /Будильник/ }).first(); if (await c.count()) card = c; }
    if (!card) check('f1: a room with the alarms card', false);
    else { await card.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
      const f = await page.evaluate(() => ({ win: !!document.querySelector('.at-win'), inWin: !!document.activeElement?.closest('.at-win'), dialogs: document.querySelectorAll('[role=dialog]').length }));
      check('f1: the alarm editor opened from a room has the focus (not the clock sheet under it)', f.win && f.inWin, { f, active: await active(page) }); }
    await ctx.close(); }
  // ---- ENERGY-1: «Месяц» → «Сейчас» → «Обзор» keeps the period
  { const { ctx, page } = await open({ url: C('energy', Object.keys((await import(resolve(root, 'scripts/cards/energy.mjs'))).card.scenarios)[0], '#energy?filter=month') });
    await page.waitForTimeout(500); const tabs = page.locator('.rm-energy-tabs button');
    if ((await tabs.count()) === 2) { await tabs.nth(1).click(); await page.waitForTimeout(350); const mid = await page.evaluate(() => location.hash); await tabs.nth(0).click(); await page.waitForTimeout(450);
      const end = await page.evaluate(() => ({ hash: location.hash, period: document.querySelector('.at-ep')?.dataset.period ?? null }));
      check('«Месяц» → «Сейчас» → «Обзор» comes back to the month', mid === '#energy?filter=now' && end.hash === '#energy?filter=month' && (end.period === null || end.period === 'month'), { mid, end }); }
    else check('the «Обзор / Сейчас» strip is there', false);
    await ctx.close(); }
} catch (e) { report.errors.push('script stopped: ' + String(e?.stack ?? e).slice(0, 600)); }
finally { await browser.close(); house.s.kill(); cards.s.kill(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
for (const e of report.errors) console.log('✘ error: ' + e);
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.errors.length} errors`);
process.exit(report.checks.every(c => c.ok) && !report.errors.length ? 0 : 1);
