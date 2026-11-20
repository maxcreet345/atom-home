// Scenario QA of «Расставить» (owner 20.11.2026): each device arranges the cards of «Главная» and of a room for itself, kept in HA under
// the device's name. One HA = one shared store of named devices: the preview keeps it in localStorage, so it is copied between browser
// contexts the way every device of a house reads the same integration. Local preview on the Criuleni snapshot of 18.11 and its settings,
// emulated screens; commands to the devices are recorded and must stay zero. usage: node scripts/qa-arrange.mjs [out-dir]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/tile-layout'); await mkdir(out, { recursive: true });
const live = await readFile(resolve(root, '../private/fixtures/criuleni-registry-live-20261118.json'), 'utf8');
const houseConfig = await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261118.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(live); return; }
  if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(houseConfig); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const errors = [];
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); console.log(p ? 'ok  ' : 'FAIL', n, p ? '' : JSON.stringify(d)); };
let ha = '{"profiles":{}}'; // the integration's store, shared by every device of the house
async function device(name, size, { touch = false, admin = true } = {}) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.open = async (hash = '#home') => {
    await page.goto(origin + '/' + hash); await page.waitForFunction(() => window.ready);
    await page.evaluate(async ({ ha, admin }) => { if (!localStorage.getItem('atom-home:config')) localStorage.setItem('atom-home:config', await (await fetch('/config.json')).text()); localStorage.setItem('atom-home:preview-layouts', ha); const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx); window.atomPreview.host.setAdmin(admin); window.atomPreview.redraw?.(); }, { ha, admin });
    await page.waitForSelector('.hm-shell'); await page.waitForTimeout(900);
  };
  page.sync = async () => { ha = await page.evaluate(() => localStorage.getItem('atom-home:preview-layouts')); };
  page.shot = (n, full = false) => page.screenshot({ path: resolve(out, `${name}-${n}.png`), fullPage: full });
  page.log = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').length);
  return page;
}
const homeKeys = page => page.evaluate(() => [...document.querySelectorAll('.ah-home .at-slot')].map(s => `${s.dataset.lay}:${s.dataset.w}x${s.dataset.h}`));
const slotBox = (page, key) => page.locator(`.at-slot[data-lay="${key}"]`).boundingBox();
async function dragTo(page, from, to) { const a = await slotBox(page, from), b = await slotBox(page, to); await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 6, { steps: 3 }); await page.mouse.move(b.x + b.width / 3, b.y + b.height / 3, { steps: 14 }); await page.waitForTimeout(250); await page.mouse.move(b.x + b.width / 3 + 2, b.y + b.height / 3 + 2, { steps: 2 }); await page.mouse.up(); await page.waitForTimeout(350); }
async function pullCorner(page, key, dx, dy) { const g = await page.locator(`.at-slot[data-lay="${key}"] .at-slot-grip`).boundingBox(); await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(300); }
try {
  // ---- 1. the phone: nothing arranged = the screen as before ----
  const phone = await device('phone', { width: 412, height: 915 });
  await phone.open(); await phone.shot('01-home-before');
  check('phone:no-arrangement-draws-as-before', await phone.locator('.at-lay').count() === 0 && await phone.locator('.ah-home[data-face="home-modular"]').count() === 1);
  check('phone:arrange-button', await phone.locator('[data-action="arrange"]').count() === 1);
  const natural = await phone.evaluate(() => [...document.querySelector('.ah-home').children].filter(c => !c.hidden).slice(0, 6).map(c => Math.round(c.getBoundingClientRect().width)));
  // ---- 2. «Расставить» asks the device's name first ----
  await phone.locator('[data-action="arrange"]').scrollIntoViewIfNeeded(); await phone.click('[data-action="arrange"]'); await phone.waitForSelector('.at-lay-name'); await phone.waitForTimeout(400); await phone.shot('02-device-name');
  await phone.fill('.at-lay-name input', 'Телефон Арарата'); await phone.click('.at-lay-name button[type="submit"]'); await phone.waitForSelector('.at-lay.is-arranging'); await phone.waitForTimeout(400);
  const start = await homeKeys(phone); await phone.evaluate(() => document.querySelector('.hm-main, main')?.scrollTo?.(0, 0)); await phone.shot('03-arranging');
  check('phone:arranging-starts-as-the-screen-was', start.length >= 6 && start.some(k => /x2$/.test(k)), { start });
  const widthsNow = await phone.evaluate(() => [...document.querySelectorAll('.ah-home .at-slot')].slice(0, 6).map(c => Math.round(c.getBoundingClientRect().width)));
  check('phone:same-widths-when-arranging-begins', widthsNow.every((w, i) => Math.abs(w - natural[i]) <= 2), { natural, widthsNow });
  // drag «Энергия» to the first place, pull the clock's corner one cell wider, tap a card for its buttons
  const keys0 = start.map(k => k.split(':').slice(0, -1).join(':'));
  const ei = keys0.indexOf('tile:energy'); await phone.locator('.at-slot[data-lay="tile:energy"]').scrollIntoViewIfNeeded(); await dragTo(phone, 'tile:energy', keys0[ei - 1]);
  const afterDrag = (await homeKeys(phone)).map(k => k.split(':').slice(0, -1).join(':'));
  check('phone:drag-moves-the-card', afterDrag.indexOf('tile:energy') < keys0.indexOf('tile:energy'), { before: keys0.indexOf('tile:energy'), after: afterDrag.indexOf('tile:energy') });
  const clockBefore = await phone.locator('.at-slot[data-lay="tile:clock"]').getAttribute('data-w');
  await phone.locator('.at-slot[data-lay="tile:clock"]').scrollIntoViewIfNeeded(); await pullCorner(phone, 'tile:clock', -400, 0); // narrower to one cell
  const clockW = await phone.locator('.at-slot[data-lay="tile:clock"]').getAttribute('data-w');
  check('phone:corner-resizes-in-cells', Number(clockW) < Number(clockBefore) || clockW === '1', { clockBefore, clockW });
  await phone.locator('.at-slot[data-lay="tile:energy"]').scrollIntoViewIfNeeded(); await pullCorner(phone, 'tile:energy', 0, 160);
  check('phone:corner-makes-it-taller', Number(await phone.locator('.at-slot[data-lay="tile:energy"]').getAttribute('data-h')) >= 2);
  await phone.locator('.at-slot[data-lay="tile:energy"] .at-slot-veil').click({ position: { x: 20, y: 30 } }); await phone.waitForTimeout(250);
  check('phone:tap-opens-buttons', await phone.locator('.at-slot.is-picked').count() === 1 && await phone.locator('.at-lay-bar .at-slot-tools').count() === 1);
  await phone.shot('04-arranging-edited');
  await phone.click('.at-slot-tools [aria-label="Шире"]'); await phone.waitForTimeout(200);
  check('phone:wider-button', (await phone.locator('.at-slot[data-lay="tile:energy"]').getAttribute('data-w')) === '2');
  check('phone:no-commands-while-arranging', await phone.log() === 0);
  const edited = await homeKeys(phone);
  await phone.click('.at-lay-done'); await phone.waitForSelector('.at-lay-toast'); await phone.waitForTimeout(500); await phone.shot('05-saved');
  check('phone:saved-and-left-arranging', await phone.locator('.at-lay.is-arranging').count() === 0 && JSON.stringify(await homeKeys(phone)) === JSON.stringify(edited), { edited });
  await phone.sync();
  // taps work again after «Готово»: the arranged card opens its own screen
  await phone.reload(); await phone.open(); const afterReload = await homeKeys(phone);
  check('phone:kept-after-reload', JSON.stringify(afterReload) === JSON.stringify(edited), { afterReload, edited });
  await phone.shot('06-after-reload', true);
  // ---- 3. the same phone on its side: two more columns, every card still there ----
  await phone.setViewportSize({ width: 915, height: 412 }); await phone.waitForTimeout(700); await phone.shot('07-landscape');
  check('phone:landscape-all-cards', (await homeKeys(phone)).length === edited.length);
  await phone.setViewportSize({ width: 412, height: 915 }); await phone.waitForTimeout(400);
  // ---- 4. the room: one grid of its cards, arranged on its own ----
  await phone.evaluate(() => { location.hash = '#rooms?room=kukhnia'; }); await phone.waitForTimeout(700); await phone.shot('08-room-before', true);
  await phone.locator('.rm-b-main [data-action="arrange"]').scrollIntoViewIfNeeded(); await phone.click('.rm-b-main [data-action="arrange"]'); await phone.waitForSelector('.rm-b-main .at-lay.is-arranging');
  const roomStart = await phone.evaluate(() => [...document.querySelectorAll('.rm-b-main .at-slot')].map(s => s.dataset.lay));
  check('phone:room-arranging-has-its-cards', roomStart.length >= 2, { roomStart });
  await phone.locator(`.at-slot[data-lay="${roomStart[1]}"]`).scrollIntoViewIfNeeded(); await dragTo(phone, roomStart[1], roomStart[0]);
  await phone.locator('.rm-b-main .at-slot').first().scrollIntoViewIfNeeded(); await phone.shot('09-room-arranging');
  await phone.click('.at-lay-done'); await phone.waitForTimeout(600); await phone.shot('10-room-saved', true);
  await phone.sync();
  const roomOrder = await phone.evaluate(() => [...document.querySelectorAll('.rm-b-main .at-slot')].map(s => s.dataset.lay));
  check('phone:room-order-saved', roomOrder[0] === roomStart[1] && roomOrder[1] === roomStart[0], { roomOrder, roomStart });
  // ---- 5. the kitchen tablet: its own arrangement, the phone's untouched ----
  const tablet = await device('tablet', { width: 1280, height: 800 }, { touch: true });
  await tablet.open(); await tablet.shot('11-home-before');
  check('tablet:no-arrangement-yet', await tablet.locator('.at-lay').count() === 0);
  await tablet.locator('[data-action="arrange"]').scrollIntoViewIfNeeded(); await tablet.click('[data-action="arrange"]'); await tablet.waitForSelector('.at-lay-name'); await tablet.waitForTimeout(300); await tablet.shot('12-device-name-with-existing');
  check('tablet:lists-the-phone', (await tablet.locator('.at-lay-name-row').allInnerTexts()).some(x => x.includes('Телефон Арарата')));
  await tablet.fill('.at-lay-name input', 'Телефон Арарата'); await tablet.waitForTimeout(150);
  check('tablet:a-taken-name-is-refused', await tablet.locator('.at-lay-name button[type="submit"]').isDisabled());
  await tablet.fill('.at-lay-name input', 'Планшет кухня'); await tablet.click('.at-lay-name button[type="submit"]'); await tablet.waitForSelector('.at-lay.is-arranging');
  const tk = (await homeKeys(tablet)).map(k => k.split(':').slice(0, -1).join(':'));
  await tablet.click(`.at-slot[data-lay="${tk[1]}"] .at-slot-veil`); await tablet.waitForTimeout(200);
  await tablet.click('.at-slot-tools [aria-label="Раньше"]'); await tablet.waitForTimeout(200); await tablet.click('.at-slot-tools [aria-label="Выше"]'); await tablet.waitForTimeout(250);
  await tablet.shot('13-tablet-arranging');
  await tablet.click('.at-lay-done'); await tablet.waitForTimeout(600); await tablet.sync(); await tablet.shot('14-tablet-saved');
  const store = JSON.parse(ha);
  check('two-devices-two-arrangements', Object.keys(store.profiles).length === 2 && JSON.stringify(store.profiles['telefon-ararata'].scopes.home) !== JSON.stringify(store.profiles['planshet-kukhnia'].scopes.home), { ids: Object.keys(store.profiles) });
  await phone.open(); check('phone:untouched-by-the-tablet', JSON.stringify(await homeKeys(phone)) === JSON.stringify(edited));
  // ---- 6. a new phone replaces the old one: it picks the name and gets the arrangement back (and a resident who is not an administrator may) ----
  const fresh = await device('new-phone', { width: 412, height: 915 }, { touch: true, admin: false });
  await fresh.open();
  check('new-phone:resident-sees-arrange', await fresh.locator('[data-action="arrange"]').count() === 1 && await fresh.locator('[data-action="open-catalog"]').count() === 0);
  await fresh.locator('[data-action="arrange"]').scrollIntoViewIfNeeded(); await fresh.click('[data-action="arrange"]'); await fresh.waitForSelector('.at-lay-name'); await fresh.waitForTimeout(300); await fresh.shot('15-pick-replaced');
  check('new-phone:resident-cannot-forget-devices', await fresh.locator('.at-lay-name-row button', { hasText: 'Забыть' }).count() === 0);
  await fresh.locator('.at-lay-name-row', { hasText: 'Телефон Арарата' }).locator('button', { hasText: 'Это оно' }).click(); await fresh.waitForSelector('.at-lay.is-arranging'); await fresh.click('.at-lay-acts .hm-pill:has-text("Отменить")'); await fresh.waitForTimeout(500);
  const freshKeys = await homeKeys(fresh); check('new-phone:gets-the-arrangement-back', JSON.stringify(freshKeys) === JSON.stringify(edited), { freshKeys, edited });
  await fresh.shot('16-replaced-phone');
  // ---- 7. «Как было»: this screen back to the usual, on this device only ----
  await fresh.locator('[data-action="arrange"]').scrollIntoViewIfNeeded(); await fresh.click('[data-action="arrange"]'); await fresh.waitForTimeout(800); await fresh.shot('16b-second-arrange');
  await fresh.waitForSelector('.at-lay.is-arranging');
  await fresh.click('.at-lay-acts .hm-pill:has-text("Как было")'); await fresh.waitForSelector('.at-lay-ask'); await fresh.shot('17-reset-ask'); await fresh.click('.at-lay-ask .is-primary'); await fresh.waitForTimeout(600);
  check('new-phone:reset-draws-as-before', await fresh.locator('.ah-home.at-lay').count() === 0 && await fresh.locator('.ah-home[data-face="home-modular"]').count() === 1);
  await fresh.sync(); check('reset-kept-the-room-and-the-tablet', !!JSON.parse(ha).profiles['telefon-ararata'].scopes['room:kukhnia'] && !!JSON.parse(ha).profiles['planshet-kukhnia'].scopes.home && !JSON.parse(ha).profiles['telefon-ararata'].scopes.home);
  // ---- 8. an integration without arrangements: no button ----
  const old = await device('old-backend', { width: 412, height: 915 });
  await old.addInitScript(() => { globalThis.__noLayouts = true; }); await old.open();
  check('old-backend:no-arrange-button', await old.locator('[data-action="arrange"]').count() === 0);
  for (const p of [phone, tablet, fresh]) check(`${(await p.title()) || 'page'}:no-commands`, await p.log() === 0);
} finally {
  check('no-page-errors', errors.length === 0, { errors });
  await writeFile(resolve(out, 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks, errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
}
