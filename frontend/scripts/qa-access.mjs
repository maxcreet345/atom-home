// Who sees which building (27.11.2026, docs/ACCESS.md) on the preview: three buildings and a yard (scripts/access-fixture.mjs), an
// administrator and three people — faur («Сотрудник» of «Бухгалтерия»), daniela («Планшет» of the main building, «Гость» of the office),
// vasile (nothing). Each sees only their buildings and rooms, «Свет» counts only theirs, «только просмотр» draws no switch and sends nothing,
// the person with nothing gets the calm screen, «Посмотреть глазами» shows the panel as theirs and «Выйти» comes back, and with the split
// switched off everybody sees everything again. Screenshots light and dark, 1070 and 360 wide.
// usage: npm run preview:build && node scripts/qa-access.mjs <outDir>
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { accessHouse, USERS, ACCESS, LIGHTS, config } from './access-fixture.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview');
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/access')); await mkdir(out, { recursive: true });
const served = JSON.stringify(accessHouse());
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(served); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); if (!p.startsWith(dist)) { res.statusCode = 403; res.end(); return; } res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const report = { checks: [], errors: [] };
const check = (name, ok, extra = '') => { report.checks.push({ name, ok, extra }); console.log(`${ok ? '✔' : '✖'} ${name}${extra && !ok ? ' — ' + String(extra).slice(0, 400) : ''}`); };
const lightNames = LIGHTS.map(l => l[1]);
/** A screen signed in as `user` (`admin` as Home Assistant says), on a fresh browser profile. */
async function open(user, { admin = false, theme = 'light', w = 1070, h = 764, access = ACCESS, building = null, hash = '#home' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
  page.on('pageerror', e => report.errors.push(`${user}: ${e.message}`));
  await page.goto(origin + '/' + hash); await page.waitForFunction(() => window.ready);
  await page.evaluate(async ([cfg, user, admin, users, building]) => { if (building) localStorage.setItem('atom-home:building', building); window.__userId = user; window.__authUsers = users; window.__beforeDraw = h => h.setAdmin(admin); window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, [config(theme, access), user, admin, USERS, building]);
  await page.waitForSelector('.at-shell'); await page.waitForTimeout(500);
  return { page, close: () => ctx.close() };
}
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(450); };
const text = page => page.evaluate(() => document.querySelector('.at-shell')?.innerText.replace(/[  ]/g, ' ') ?? '');
const roomsShown = async page => { await go(page, '#rooms'); return text(page); };
const lightsShown = async page => { await go(page, '#lights'); const t = await text(page); return lightNames.filter(n => t.includes(n)); };
/** the controls a page draws: switches, tiles that switch on a tap (aria-pressed), sliders */
const switches = page => page.evaluate(() => [...document.querySelectorAll('.hm-main [role=switch], .hm-main [aria-pressed], .hm-main input[type=range]')].filter(e => !e.closest('.hm-toolbar') && !e.hasAttribute('data-keep') /* a filter of the list («Внимание»), a tab: not a device */).length);
/** Opens every card of the page and presses every enabled button inside each sheet (not its «×»): on a screen that only looks, no press may
 * be refused with «только просмотр» — a refusal means a control was drawn that should not have been. */
const stats = { sheets: 0, pressed: 0 };
async function pressAll(page, label) {
  // the panel counts every press it refuses for the role (runtime/actions.ts noteRefused): a new one means a drawn control was refused
  let seen = await page.evaluate(() => window.__atomAccessRefused ?? 0);
  const said = async () => { const n = await page.evaluate(() => window.__atomAccessRefused ?? 0), was = seen; seen = n; return n > was; };
  for (const b of await page.$$('.hm-main .ah-tile-hit, .hm-main .rm-tile-open, .hm-main .at-light-row-hit, .hm-main .hm-light-hit, .hm-main .at-heat-open, .hm-main .at-vac-open')) {
    await b.click({ force: true }).catch(() => undefined); await page.waitForTimeout(200);
    if (await said()) { check(`${label}: a tile was a control`, false); }
    const inSheet = await page.$$('.hm-sheet button:not(.hm-sheet-close):not([aria-label*="Закрыть"]):not([disabled]), .hm-sheet [role=switch], .hm-sheet input[type=range]');
    if (inSheet.length || await page.$('.hm-sheet')) stats.sheets++;
    for (const x of inSheet) { if (!(await x.isVisible().catch(() => false))) continue; stats.pressed++; await x.click({ force: true, timeout: 1000 }).catch(() => undefined); await page.waitForTimeout(120); if (await said()) { check(`${label}: a sheet drew a control that is refused`, false, await x.evaluate(e => e.outerHTML.slice(0, 160))); break; } }
    await page.keyboard.press('Escape'); await page.waitForTimeout(80); await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  }
  // the page's own buttons too (a panel with its own controls)
  for (const x of await page.$$('.hm-main .hm-page button:not([disabled])')) { if (!(await x.isVisible().catch(() => false))) continue; stats.pressed++; await x.click({ force: true, timeout: 1000 }).catch(() => undefined); await page.waitForTimeout(100); if (await said()) { check(`${label}: the page drew a control that is refused`, false, await x.evaluate(e => e.outerHTML.slice(0, 160))); break; } await page.keyboard.press('Escape'); }
}
try {
  // 1. the administrator sees everything, has «Доступ» in the settings, and cannot be locked out
  for (const [theme, w, h] of [['light', 1070, 764], ['dark', 1070, 764], ['light', 360, 792], ['dark', 360, 792]]) {
    const { page, close } = await open('u_ararat', { admin: true, theme, w, h });
    if (theme === 'light' && w === 1070) {
      const r = await roomsShown(page); check('admin: every room of every building and the yard', ['Сервис', 'Шоурум', 'Кабинет бухгалтеров', 'Кабинет главбуха', 'Офис', 'Двор'].every(n => r.includes(n)), r.slice(0, 300));
      check('admin: «Свет» lists every light', (await lightsShown(page)).length === LIGHTS.length);
    }
    await go(page, '#setup?filter=access'); await page.waitForSelector('.at-setup-access');
    await page.waitForFunction(() => document.querySelectorAll('.at-access-person').length > 0, null, { timeout: 4000 }).catch(() => undefined);
    const tab = await page.evaluate(() => ({ honest: !!document.querySelector('.at-access-honest'), floors: [...document.querySelectorAll('.at-access-building')].map(x => x.dataset.floor), people: [...document.querySelectorAll('.at-access-person')].map(x => x.dataset.user), adminGrants: !!document.querySelector('.at-access-person[data-user="u_ararat"] .at-access-grants'), roles: document.querySelectorAll('.at-access-role').length, overflow: document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.at-setup-access *')].some(e => e.getBoundingClientRect().right > innerWidth + 1) }));
    if (theme === 'light' && w === 1070) {
      check('«Доступ»: the honest note is there', tab.honest);
      check('«Доступ»: the three buildings and «Без здания» for the yard', JSON.stringify(tab.floors) === JSON.stringify(['servis_i_shourum', 'contabilitate', 'office', '_none']), JSON.stringify(tab.floors));
      check('«Доступ»: the people of Home Assistant without the system user', JSON.stringify(tab.people) === JSON.stringify(['u_ararat', 'daniela', 'faur', 'vasile'].map(n => n.startsWith('u_') ? n : `u_${n}`)), JSON.stringify(tab.people));
      check('«Доступ»: an administrator gets no role to choose («Администратор — видит всё»)', !tab.adminGrants);
      check('«Доступ»: the five ready roles', tab.roles === 5, String(tab.roles));
    }
    check(`«Доступ» ${theme} ${w}: nothing wider than the screen`, !tab.overflow);
    await page.screenshot({ path: `${out}/admin-access-${theme}-${w}.png`, fullPage: false });
    await page.evaluate(() => document.querySelector('.at-access-person[data-user="u_faur"]')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/admin-access-people-${theme}-${w}.png` });
    await close();
  }
  // 2. faur: only «Бухгалтерия» — its rooms, its lights; no switcher (one building); «Сотрудник» presses its switches; no room-less socket
  for (const [theme, w, h] of [['light', 1070, 764], ['dark', 360, 792]]) {
    const { page, close } = await open('u_faur', { theme, w, h });
    const r = await roomsShown(page);
    if (theme === 'light') {
      check('faur: the accountants\' rooms only', r.includes('Кабинет бухгалтеров') && r.includes('Кабинет главбуха') && !/Шоурум|Сервис|Офис|Двор/.test(r), r.slice(0, 300));
      check('faur: «Свет» counts only the accountants\' lights', JSON.stringify(await lightsShown(page)) === JSON.stringify(['Свет бухгалтерии', 'Свет главбуха']));
      await go(page, '#lights'); check('faur: «Сотрудник» has switches', await switches(page) > 0);
      check('faur: one building, no switcher', !(await page.$('.at-access-switch')));
      await go(page, '#systems'); const s = await text(page); check('faur: «Устройства» without the room-less socket or other buildings', !s.includes('Розетка без комнаты') && !s.includes('Чайник офиса'), s.slice(0, 300));
      check('faur: no «Настройка»', !(await page.$('.at-setup-nav')));
    }
    await go(page, '#home'); await page.screenshot({ path: `${out}/faur-home-${theme}-${w}.png` });
    await close();
  }
  // 3. daniela: two buildings, a switcher; the main building as a tablet (lights only), the office as a guest (looks only, nothing is sent)
  for (const [theme, w, h] of [['light', 1070, 764], ['dark', 360, 792]]) {
    const { page, close } = await open('u_daniela', { theme, w, h });
    const opts = await page.evaluate(() => [...document.querySelectorAll('.at-access-switch option')].map(o => o.value));
    if (theme === 'light') {
      check('daniela: the switcher offers her two buildings and «Все здания»', JSON.stringify(opts) === JSON.stringify(['servis_i_shourum', 'office', '*']), JSON.stringify(opts));
      check('daniela: she lands in her first building', JSON.stringify(await lightsShown(page)) === JSON.stringify(['Свет сервиса', 'Свет шоурума']));
      await go(page, '#lights'); check('daniela (tablet): lights can be switched', await switches(page) > 0);
      await page.selectOption('.at-access-switch select', 'office'); await page.waitForTimeout(400);
      check('daniela: the office after the switch', JSON.stringify(await lightsShown(page)) === JSON.stringify(['Свет офиса']));
      await go(page, '#lights'); check('daniela (guest): no switch at all', await switches(page) === 0);
      await go(page, '#rooms?room=dmlink'); check('daniela (guest): the office room page draws no switch or slider', await switches(page) === 0, await page.evaluate(() => [...document.querySelectorAll('.hm-main [role=switch], .hm-main [aria-pressed], .hm-main input[type=range]')].map(e => e.outerHTML.slice(0, 200) + ' IN ' + (e.closest('[class]')?.parentElement?.className ?? '')).join(' | ')));
      await go(page, '#home'); check('daniela (guest): Home draws no switch', await switches(page) === 0, String(await switches(page)));
      // press everything the page shows: nothing may reach the house
      await page.evaluate(() => { window.atomPreview.host.log.length = 0; });
      for (const sel of ['.hm-main .ah-tile-hit', '.hm-main .hm-light-hit']) for (const b of await page.$$(sel)) { await b.click({ force: true }).catch(() => undefined); await page.waitForTimeout(150); await page.keyboard.press('Escape'); }
      await go(page, '#systems'); for (const b of await page.$$('.hm-main .ah-tile-hit')) { await b.click({ force: true }).catch(() => undefined); await page.waitForTimeout(150); const sheetSw = await page.evaluate(() => document.querySelectorAll('.hm-sheet [role=switch], .hm-sheet input[type=range]').length); if (sheetSw) check('daniela (guest): a sheet draws no control', false, String(sheetSw)); await page.keyboard.press('Escape'); }
      const sent = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws' || !/^(history|logbook|energy|recorder)|\/state$|\/get$|^config\/auth\/list$/.test(x.service)));
      check('daniela (guest): nothing was sent to the house', sent.length === 0, JSON.stringify(sent));
      await page.reload(); await page.waitForFunction(() => window.ready);
      await page.evaluate(async ([cfg, users]) => { window.__userId = 'u_daniela'; window.__authUsers = users; window.__beforeDraw = h => h.setAdmin(false); window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, [config('light'), USERS]);
      await page.waitForSelector('.at-shell'); await page.waitForTimeout(400);
      check('daniela: the last choice is remembered on this screen', await page.$eval('.at-access-switch select', s => s.value) === 'office');
      await page.selectOption('.at-access-switch select', '*'); await page.waitForTimeout(400);
      check('daniela: «Все здания» — both of hers, never the accountants\'', JSON.stringify(await lightsShown(page)) === JSON.stringify(['Свет сервиса', 'Свет шоурума', 'Свет офиса']));
      await page.selectOption('.at-access-switch select', 'servis_i_shourum'); await page.waitForTimeout(300);
    }
    await go(page, '#home'); await page.screenshot({ path: `${out}/daniela-home-${theme}-${w}.png` });
    await close();
  }
  // 3b. «только просмотр» where there is more than lamps: the accountants' rooms with the air conditioner, every page and sheet, nothing sent
  { const viewOnly = { ...ACCESS, roles: { ...ACCESS.roles, guest: { ...ACCESS.roles.guest, sections: ['lights', 'systems', 'climate'], modules: ['climate', 'clock'] } }, members: { u_faur: { buildings: { contabilitate: 'guest' } } } };
    const { page, close } = await open('u_faur', { access: viewOnly });
    await page.evaluate(() => { window.atomPreview.host.log.length = 0; });
    for (const hash of ['#home', '#lights', '#systems', '#climate', '#rooms?room=contabilitate', '#rooms?room=ceo']) {
      await go(page, hash); check(`guest in «Бухгалтерия»: ${hash} draws no control`, await switches(page) === 0, await page.evaluate(() => [...document.querySelectorAll('.hm-main [role=switch], .hm-main [aria-pressed], .hm-main input[type=range]')].map(e => e.outerHTML.slice(0, 160) + ' IN ' + e.parentElement?.className).join(' | ')));
      await pressAll(page, `guest in «Бухгалтерия» ${hash}`);
    }
    const sent = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws' || !/^(history|logbook|energy|recorder)|\/state$|\/get$|^config\/auth\/list$/.test(x.service)));
    check(`guest in «Бухгалтерия»: the walk really pressed things (${stats.sheets} sheets opened, ${stats.pressed} buttons pressed)`, stats.sheets >= 4 && stats.pressed >= 10, JSON.stringify(stats));
    check('guest in «Бухгалтерия»: nothing was sent to the house', sent.length === 0, JSON.stringify(sent));
    await go(page, '#rooms?room=contabilitate'); await page.screenshot({ path: `${out}/guest-room-light-1070.png` });
    await close(); }
  // 3c. the alarm panel (Alarmo, no room): «Сотрудник» does not see it at all; a role with «Охрана» but «только просмотр» sees it with no button
  { const { page, close } = await open('u_faur');
    await go(page, '#security'); const t = await text(page);
    check('faur («Сотрудник», no «Охрана»): no alarm panel, no «Безопасность»', !(await page.$('.at-sec-panel, .at-osec-wrap')) && !(await page.$('.at-sec-tile')), t.slice(0, 200));
    await close(); }
  { const watch = { ...ACCESS, roles: { ...ACCESS.roles, watch: { name: 'Наблюдатель', sections: ['security'], modules: ['security'], mode: 'view' } }, members: { u_faur: { buildings: { contabilitate: 'watch' } } } };
    const { page, close } = await open('u_faur', { access: watch });
    await page.evaluate(() => { window.atomPreview.host.log.length = 0; });
    await go(page, '#security');
    const panel = await page.evaluate(() => { const p = document.querySelector('.at-sec-panel, .at-osec-wrap'); return p ? { readonly: p.classList.contains('is-readonly'), shown: [...p.querySelectorAll('button, [role=switch], input, select')].filter(e => e.getClientRects().length && !/-open|-hit/.test(e.className) && !e.hasAttribute('data-keep')).length } : null; });
    check('a watcher (view + «Охрана»): the alarm panel is there, read-only, no button drawn', !!panel && panel.readonly && panel.shown === 0, JSON.stringify(panel));
    await pressAll(page, 'watcher #security');
    const sent = await page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws' || !/^(history|logbook|energy|recorder)|\/state$|\/get$|^config\/auth\/list$/.test(x.service)));
    check('a watcher: nothing was sent to the house', sent.length === 0, JSON.stringify(sent));
    await page.click('.at-sec-tabs button').catch(() => undefined); await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/watcher-security-light-1070.png` });
    await close(); }
  // 3d. a bound tablet: vasile has nothing of his own, but on «Планшет бухгалтерия» he sees that building with the tablet's role
  { const bound = { ...ACCESS, profiles: { 'planshet-buh': { building: 'contabilitate', role: 'tablet' } } };
    const ctx = await browser.newContext({ viewport: { width: 1070, height: 764 } }), page = await ctx.newPage();
    page.on('pageerror', e => report.errors.push(`tablet: ${e.message}`));
    await page.goto(origin + '/#home'); await page.waitForFunction(() => window.ready);
    await page.evaluate(async ([cfg, users]) => { localStorage.setItem('atom-home:layout-device', 'planshet-buh'); localStorage.setItem('atom-home:preview-layouts', JSON.stringify({ profiles: { 'planshet-buh': { name: 'Планшет бухгалтерия', scopes: {}, rev: 1, updated: 0 } } })); window.__userId = 'u_vasile'; window.__authUsers = users; window.__beforeDraw = h => h.setAdmin(false); window.fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), window.fx, cfg); }, [config('light', bound), USERS]);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(500);
    check('bound tablet: vasile sees «Бухгалтерия» there, by the tablet\'s role', JSON.stringify(await lightsShown(page)) === JSON.stringify(['Свет бухгалтерии', 'Свет главбуха']));
    await go(page, '#lights'); check('bound tablet («Планшет»): its lights can be switched', await switches(page) > 0);
    await go(page, '#climate'); await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/tablet-bound-light-1070.png` });
    await ctx.close(); }
  // 4. vasile: nothing assigned — the calm screen, nothing of the house
  for (const [theme, w, h] of [['light', 1070, 764], ['dark', 360, 792], ['light', 360, 792], ['dark', 1070, 764]]) {
    const { page, close } = await open('u_vasile', { theme, w, h });
    const t = await text(page);
    if (theme === 'light' && w === 1070) check('vasile: «Доступ ещё не назначен — обратитесь к администратору», no panel', /Доступ ещё не назначен/.test(t) && /администратор/.test(t) && !(await page.$('.hm-main')) && !lightNames.some(n => t.includes(n)), t.slice(0, 200));
    await page.screenshot({ path: `${out}/vasile-calm-${theme}-${w}.png` });
    await close();
  }
  // 5. «Посмотреть глазами»: the administrator sees faur's panel with the bar, «Выйти» brings the settings back
  for (const [theme, w, h] of [['light', 1070, 764], ['dark', 360, 792]]) {
    const { page, close } = await open('u_ararat', { admin: true, theme, w, h, hash: '#setup?filter=access' });
    await page.waitForSelector('.at-access-person[data-user="u_faur"] [data-action="view-as"]');
    await page.click('.at-access-person[data-user="u_faur"] [data-action="view-as"]'); await page.waitForTimeout(500);
    const bar = await page.evaluate(() => document.querySelector('.at-access-as')?.innerText ?? '');
    if (theme === 'light') check('view as faur: the bar «Вы смотрите как faur · Выйти»', /Вы смотрите как faur/.test(bar) && /Выйти/.test(bar), bar);
    await page.screenshot({ path: `${out}/viewas-faur-${theme}-${w}.png` });
    if (theme === 'light') {
      check('view as faur: only his lights', JSON.stringify(await lightsShown(page)) === JSON.stringify(['Свет бухгалтерии', 'Свет главбуха']));
      check('view as faur: no «Настройка»', !(await page.$('.at-setup-nav')));
      await page.click('[data-action="access-exit"]'); await page.waitForTimeout(600);
      check('«Выйти»: back to «Доступ», every light again', !!(await page.$('.at-setup-access')) && (await lightsShown(page)).length === LIGHTS.length);
      // view as vasile: the calm screen with the bar, and the way back
      await go(page, '#setup?filter=access'); await page.waitForSelector('.at-access-person[data-user="u_vasile"] [data-action="view-as"]');
      await page.click('.at-access-person[data-user="u_vasile"] [data-action="view-as"]'); await page.waitForTimeout(400);
      check('view as vasile: the calm screen with the bar', /Доступ ещё не назначен/.test(await text(page)) && !!(await page.$('[data-action="access-exit"]')));
      await page.click('[data-action="access-exit"]'); await page.waitForTimeout(500);
      check('«Выйти» from the calm screen', !!(await page.$('.at-setup-access')));
    }
    await close();
  }
  // 6. the split switched off: everyone sees everything, as before
  { const { page, close } = await open('u_vasile', { access: { ...ACCESS, enabled: false } });
    check('split off: vasile sees every light, as before', (await lightsShown(page)).length === LIGHTS.length);
    await close(); }
  { const { page, close } = await open('u_faur', { access: null });
    check('no access settings at all: faur sees every light, as before', (await lightsShown(page)).length === LIGHTS.length);
    await close(); }
  // 7. switching it on from «Доступ»: the starting point gives everybody «Сотрудник» everywhere — nobody loses the panel
  { const { page, close } = await open('u_ararat', { admin: true, access: null, hash: '#setup?filter=access' });
    await page.waitForSelector('.at-access-person'); await page.click('[data-access="enabled"] [role=switch]'); await page.waitForSelector('.at-setup-ask'); await page.click('.at-setup-ask [data-answer="yes"]'); await page.waitForTimeout(500);
    const saved = await page.evaluate(async () => (await window.atomPreview.store.load()).config.access);
    check('switch-on: enabled, every non-administrator «Сотрудник» in every building, the administrator not named', saved?.enabled === true && ['u_faur', 'u_daniela', 'u_vasile'].every(u => saved.members[u]?.all === true && saved.members[u]?.role === 'staff') && !saved.members.u_ararat && !saved.members.u_super, JSON.stringify(saved?.members));
    await page.screenshot({ path: `${out}/admin-switched-on-light-1070.png` });
    await close(); }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
const bad = report.checks.filter(c => !c.ok);
console.log(`\n${report.checks.length - bad.length}/${report.checks.length} passed, ${report.errors.length} page errors`); report.errors.slice(0, 10).forEach(e => console.log('✖ ' + e));
process.exit(bad.length || report.errors.length ? 1 : 0);
