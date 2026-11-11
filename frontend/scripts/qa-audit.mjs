// Behaviour audit of the panel on the Criuleni snapshot with the owner's config (preview host, commands rejected).
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/audit-behaviour'); await mkdir(out, { recursive: true });
const fixture = await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const has = (page, sel) => page.evaluate(sel => !!document.querySelector(sel), sel);
const browser = await chromium.launch(); const checks = []; const check = (n, p, d = {}) => checks.push({ n, p, ...d }); const errors = [];
// Behaviour audit on the Criuleni snapshot + the owner's config (preview host: every command is logged and rejected).
const ownerConfig = await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8');
try {
  for (const [w, h] of [[1070, 764], [402, 874]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); const consoleErrors = []; page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { localStorage.clear(); const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx, JSON.parse(cfg)); }, ownerConfig);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(800);
    const tag = `${w}x${h}`, shot = name => page.screenshot({ path: resolve(out, `${tag}-${name}.png`) });
    const go = async id => { await page.evaluate(id => { location.hash = '#' + id; }, id); await page.waitForTimeout(400); };
    const log = () => page.evaluate(() => window.atomPreview.host.log);
    const last = async () => { const l = (await log()).filter(c => c.domain !== 'ws'); return l[l.length - 1]; }; // ws calls (go2rtc add-on info) are not service calls
    const text = sel => page.evaluate(sel => document.querySelector(sel)?.innerText ?? '', sel);
    const has = sel => page.evaluate(sel => !!document.querySelector(sel), sel);
    /* «Настройка» shows an administrator the entity id as a line of its own (.at-setup-id, audit 2026-11-09): that is an id, not a missing translation */ const rawKeys = () => page.evaluate(() => [...document.querySelectorAll('.at-shell *')].filter(e => e.children.length === 0 && !e.classList.contains('at-setup-id') && /^[a-z]+\.[a-zA-Z0-9_.]+$/.test(e.textContent.trim())).map(e => e.textContent.trim()).slice(0, 10));
    // 1. light tile toggle → light.turn_on, toast with the rejection
    await go('lights'); const lightKey = await page.evaluate(() => document.querySelector('.ah-tile.kind-light:not(.is-off)')?.dataset.deviceKey);
    await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="${k}"] .ah-tile-hit`).click(), lightKey); await page.waitForTimeout(500);
    let c = await last(); check(`${tag}/light-tile-toggles-the-light`, !!c && c.domain === 'light' && /^(toggle|turn_on)$/.test(c.service) && c.data.entity_id === lightKey.slice(2), { c, lightKey });
    check(`${tag}/rejected-command-shows-toast`, await has('.hm-toast'));
    await go('home');
    // 2. thermostat chevrons → climate.set_temperature ±0.5 around the target
    const target = await page.evaluate(() => { const v = document.querySelector('.ah-thermo .ah-thermo-value'); const m = /(\d+(?:[.,]\d+)?)°/.exec(v.querySelector('small')?.innerText ?? ''); return Number((m && /цель|target|țint/i.test(v.querySelector('small').innerText) ? m[1] : v.querySelector('b').innerText).replace(',', '.')); });
    // audit C1: a switched-off thermostat asks before heating starts; the confirmed call carries hvac_mode heat
    const thermoOff = await page.evaluate(() => /Выкл|Off|Oprit/i.test(document.querySelector('.ah-thermo .ah-thermo-value small')?.innerText ?? ''));
    const confirmIfAsked = async () => { const dlg = await page.$('.hm-confirm'); if (dlg) { await page.click('.hm-confirm .is-primary'); await page.waitForTimeout(300); return true; } return false; };
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-chev.is-up').click()); await page.waitForTimeout(400); const askedUp = await confirmIfAsked(); c = await last();
    check(`${tag}/thermostat-up-sets-target-plus-step`, c.domain === 'climate' && c.service === 'set_temperature' && (Math.abs(c.data.temperature - (target + 0.5)) < 1e-6 || Math.abs(c.data.temperature - (target + 1)) < 1e-6) && (!thermoOff || (askedUp && c.data.hvac_mode === 'heat')), { c, target, thermoOff, askedUp });
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-chev.is-down').click()); await page.waitForTimeout(400); const askedDown = await confirmIfAsked(); c = await last();
    check(`${tag}/thermostat-down-sets-target-minus-step`, c.domain === 'climate' && (Math.abs(c.data.temperature - (target - 0.5)) < 1e-6 || Math.abs(c.data.temperature - (target - 1)) < 1e-6) && (!thermoOff || askedDown), { c });
    // 3. scene button «Свет выкл.» (homeassistant.turn_off, 9 lights): «switch everything off» asks first whatever the button's own flag says
    //    (audit 2026-11-09); nothing leaves before the answer, the answer sends the nine targets
    const sceneN0 = (await log()).filter(x => x.domain !== 'ws').length;
    await page.evaluate(() => [...document.querySelectorAll('.ah-scene strong')].find(s => /Свет выкл/.test(s.innerText)).closest('button').click()); await page.waitForTimeout(400);
    const sceneAsked = await has('.hm-confirm'), sceneEarly = (await log()).filter(x => x.domain !== 'ws').length - sceneN0;
    if (sceneAsked) { await page.click('.hm-confirm .is-primary'); await page.waitForTimeout(400); } c = await last();
    check(`${tag}/scene-all-off-asks-then-calls-service-with-targets`, sceneAsked && sceneEarly === 0 && c.domain === 'homeassistant' && c.service === 'turn_off' && Array.isArray(c.data.entity_id) && c.data.entity_id.length === 9 && !(await has('.hm-confirm')), { c, sceneAsked, sceneEarly });
    // 4. thermostat tile opens the sheet; Escape closes it; scrim click closes it
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-tile-hit').click()); await page.waitForTimeout(400);
    check(`${tag}/thermostat-sheet-opens`, /Отопление дома/.test(await text('.hm-sheet h2')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300); const escClosed = !(await has('.hm-sheet'));
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-tile-hit').click()); await page.waitForTimeout(400);
    await page.mouse.click(w - 4, 4); await page.waitForTimeout(300); const scrimClosed = !(await has('.hm-sheet'));
    check(`${tag}/sheet-closes-on-escape-and-scrim`, escClosed && scrimClosed, { escClosed, scrimClosed });
    await go('lights');
    // 5. sheet controls: brightness slider → light.turn_on with brightness_pct; switch → turn_on
    await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="${k}"] .ah-tile-more`).click(), lightKey); await page.waitForTimeout(400);
    const hadRange = await has('.hm-sheet input[type=range]');
    if (hadRange) { await page.evaluate(() => { const r = document.querySelector('.hm-sheet input[type=range]'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(400); c = await last(); }
    check(`${tag}/sheet-brightness-slider-calls-light`, !hadRange || (c.domain === 'light' && c.data.brightness_pct === 40), { hadRange, c });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await go('lights');
    // 6. unavailable device: toggle disabled, tile faded
    const offKey = await page.evaluate(() => document.querySelector('.ah-tile.is-off')?.dataset.deviceKey);
    check(`${tag}/unavailable-tile-cannot-toggle`, !!offKey && await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="${k}"] .ah-tile-hit`).disabled, offKey), { offKey });
    // 7. navigation: every section renders, back from room returns to rooms, history back works
    const sections = ['rooms', 'lights', 'climate', 'cleaning', 'energy', 'systems', 'setup', 'home'];
    const rendered = {}; for (const s of sections) { await go(s); rendered[s] = await page.evaluate(() => !!document.querySelector('.hm-page')?.children.length); }
    check(`${tag}/all-sections-render`, Object.values(rendered).every(Boolean), rendered);
    await go('rooms'); await page.evaluate(() => document.querySelector('.at-room').click()); await page.waitForTimeout(400);
    const inRoom = await has('.rm-page'); await page.evaluate(() => history.back()); await page.waitForTimeout(400);
    check(`${tag}/room-opens-and-history-back-returns`, inRoom && await has('.hm-room-grid.is-page'));
    await page.evaluate(() => document.querySelector('.at-room').click()); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('.hm-back').click()); await page.waitForTimeout(300);
    check(`${tag}/back-button-returns-to-rooms`, await has('.hm-room-grid.is-page'));
    // 8. segments hide a section hidden in the config
    await go('systems'); const segs = await page.evaluate(() => [...document.querySelectorAll('.ah-segments button')].map(b => b.innerText));
    await page.evaluate(() => { const cfg = window.atomPreview.config; cfg.sections = { ...cfg.sections, cleaning: { hidden: true } }; window.atomPreview.redraw?.(); }); await page.waitForTimeout(300);
    check(`${tag}/segments-list-sections`, segs.length === 4, { segs }); // «Свет» is its own nav entry since 1.10.0
    // 9. languages: switch to ro and en, no raw keys anywhere on home/systems/setup
    const langResults = {};
    for (const lang of ['ro', 'en', 'ru']) {
      await go('setup'); await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].at(-1).click()); await page.waitForTimeout(200);
      await page.evaluate(l => { const s = [...document.querySelectorAll('.at-setup-home select')].find(x => [...x.options].some(o => o.value === l)); s.value = l; s.dispatchEvent(new Event('change', { bubbles: true })); }, lang); await page.waitForTimeout(400);
      const raws = []; for (const s of ['home', 'systems', 'climate', 'rooms', 'setup']) { await go(s); raws.push(...await rawKeys()); }
      await go('home'); await page.evaluate(() => document.querySelector('.ah-thermo .ah-tile-hit').click()); await page.waitForTimeout(300); raws.push(...await rawKeys()); await page.keyboard.press('Escape');
      langResults[lang] = { raws, title: await text('.hm-head h1'), nav: await page.evaluate(() => [...document.querySelectorAll('.hm-sidebar nav button, .hm-tabbar button')].map(b => b.innerText.trim())) };
      if (lang === 'en') await shot('home-en');
    }
    check(`${tag}/no-raw-translation-keys-in-ro-en`, Object.values(langResults).every(r => r.raws.length === 0), langResults);
    // 10. theme switch
    await go('setup'); await page.evaluate(() => [...document.querySelectorAll('.at-setup-tabs button')].at(-1).click()); await page.waitForTimeout(200);
    await page.evaluate(() => { const s = [...document.querySelectorAll('.at-setup-home select')].find(x => [...x.options].some(o => o.value === 'dark')); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(300);
    check(`${tag}/theme-switch-applies`, await page.evaluate(() => document.querySelector('.at-shell').dataset.theme === 'dark'));
    await go('home'); await shot('home-dark');
    // 11. confirm flow for a button with confirm:true
    await page.evaluate(() => { const cfg = window.atomPreview.config; cfg.buttons = [...cfg.buttons, { id: 'qa_confirm', label: 'QA confirm', service: 'script.turn_on', target: { entity_id: 'script.x' }, confirm: true }]; window.atomPreview.redraw?.(); }); await page.waitForTimeout(300);
    const n0 = (await log()).length; await page.evaluate(() => [...document.querySelectorAll('.ah-scene strong')].find(s => s.innerText === 'QA confirm')?.closest('button').click()); await page.waitForTimeout(300);
    const confirmShown = await has('.hm-confirm'); await page.evaluate(() => document.querySelector('.hm-confirm .is-primary')?.click()); await page.waitForTimeout(300);
    check(`${tag}/confirm-button-asks-then-calls`, confirmShown && (await log()).length === n0 + 1 && (await last()).domain === 'script', { confirmShown, n: (await log()).length - n0 });
    check(`${tag}/no-console-errors`, consoleErrors.length === 0, { consoleErrors: consoleErrors.slice(0, 5) });
    await page.close();
  }
  // ===== The shell (audit 2026-11-09, round 1 fixes): navigation, history, focus, the one command runner, announcements, sheets =====
  for (const [w, h, touch] of [[1070, 764, false], [402, 874, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true } : {}) }); const page = await ctx.newPage(); const tag = `shell-${w}x${h}`; const pageErrors = [];
    page.on('pageerror', e => { errors.push(`${tag}: ${e.message}`); pageErrors.push(e.message); }); page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async cfg => { localStorage.clear(); const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx, JSON.parse(cfg)); }, ownerConfig);
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(600);
    const hash = () => page.evaluate(() => location.hash), len = () => page.evaluate(() => history.length), top = () => page.evaluate(() => Math.round(document.querySelector('.hm-main').scrollTop));
    const to = async id => { await page.evaluate(id => { location.hash = '#' + id; }, id); await page.waitForTimeout(350); };
    const sent = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws'));
    const active = () => page.evaluate(() => { const a = document.activeElement; return a ? { tag: a.tagName, cls: String(a.className).slice(0, 60), text: (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 50) } : null; });
    const toast = () => page.evaluate(() => document.querySelector('.hm-toast')?.innerText.trim() ?? null);
    const nav = async label => { await page.evaluate(label => [...document.querySelectorAll('.hm-sidebar nav button, .hm-tabbar button')].find(b => b.innerText.trim() === label)?.click(), label); await page.waitForTimeout(350); };
    // --- a new section opens at its top; Back restores the place it left
    await to('home'); await page.evaluate(() => { document.querySelector('.hm-main').scrollTop = 500; }); const left = await top();
    await nav('Комнаты'); const fresh = await top(); await page.goBack(); await page.waitForTimeout(350); const again = await top();
    check(`${tag}/new-section-opens-at-top-and-back-restores-the-place`, left > 100 && fresh === 0 && Math.abs(again - left) <= 2, { left, fresh, again });
    // --- closing goes back in history: three cycles add nothing, Back does not reopen
    await to('lights'); const l0 = await len();
    for (let i = 0; i < 3; i++) { await page.evaluate(() => document.querySelector('.ah-tile.kind-light .ah-tile-more').click()); await page.waitForSelector('.hm-sheet'); await page.evaluate(() => document.querySelector('.hm-sheet .hm-icon-btn').click()); await page.waitForTimeout(350); }
    const l1 = await len(), afterClose = await hash(); await page.goBack(); await page.waitForTimeout(350);
    check(`${tag}/three-open-close-cycles-add-no-history-and-back-does-not-reopen`, l1 <= l0 + 1 && afterClose === '#lights' && !(await has(page, '.hm-sheet')), { l0, l1, afterClose, now: await hash() });
    // scrim and Escape close the same way
    await to('lights'); await page.evaluate(() => document.querySelector('.ah-tile.kind-light .ah-tile-more').click()); await page.waitForSelector('.hm-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(350); const escHash = await hash();
    await page.goBack(); await page.waitForTimeout(300); check(`${tag}/escape-closes-by-going-back`, escHash === '#lights' && !(await has(page, '.hm-sheet')), { escHash, now: await hash() });
    // Home → a room → «‹ Комнаты»: Back leads Home, not into the room again
    await to('home'); await page.evaluate(() => document.querySelector('.ah-rooms-strip .at-room').click()); await page.waitForTimeout(350); const inRoom = await hash();
    await page.evaluate(() => document.querySelector('.hm-back').click()); await page.waitForTimeout(350); const onRooms = await hash(); await page.goBack(); await page.waitForTimeout(350);
    check(`${tag}/back-after-the-rooms-button-never-reopens-the-room`, /^#rooms\?room=/.test(inRoom) && onRooms === '#rooms' && await hash() === '#home', { inRoom, onRooms, now: await hash() });
    // --- an address that names nothing falls back
    const fall = {}; for (const [bad, good] of [['weather', '#home'], ['rooms?room=nope', '#rooms'], ['home?device=ghost', '#home'], ['nonsense', '#home']]) { await to(bad); fall[bad] = await hash() === good && await has(page, '.hm-page > *'); }
    check(`${tag}/stale-addresses-fall-back-to-a-real-page`, Object.values(fall).every(Boolean), fall);
    // --- the confirmation closes on Back and on navigation and never fires over another page
    const valve = 'valve.vannaia_kran_vody_vannoi', openValve = async () => { await to('systems?device=e%3A' + valve); await page.waitForSelector('.hm-sheet'); await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .at-actions .hm-pill')].find(b => /Открыть/.test(b.innerText)).click()); await page.waitForSelector('.hm-confirm'); };
    await openValve(); const n0 = (await sent()).length;
    const trap = await page.evaluate(() => ({ sheetInert: document.querySelector('.hm-scrim:not(.is-top)')?.hasAttribute('inert'), skipInert: document.querySelector('.at-skip')?.hasAttribute('inert'), mainInert: document.querySelector('.hm-main')?.hasAttribute('inert'), describedBy: !!document.getElementById(document.querySelector('.hm-confirm')?.getAttribute('aria-describedby'))?.textContent, labelledBy: !!document.getElementById(document.querySelector('.hm-confirm')?.getAttribute('aria-labelledby'))?.textContent }));
    const stops = []; for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); stops.push(await page.evaluate(() => !!document.activeElement?.closest('.hm-confirm') || document.activeElement === document.body)); } // past the last button the focus leaves the page for the browser's own controls, never for what lies under the question
    check(`${tag}/confirmation-over-a-sheet-traps-focus-and-is-described`, trap.sheetInert && trap.skipInert && trap.mainInert && trap.describedBy && trap.labelledBy && stops.every(Boolean), { trap, stops });
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    const afterEsc = await page.evaluate(() => ({ confirm: !!document.querySelector('.hm-confirm'), sheet: !!document.querySelector('.hm-sheet'), hash: location.hash, pills: [...document.querySelectorAll('.hm-sheet .at-actions .hm-pill')].map(b => b.innerText) }));
    check(`${tag}/escape-closes-only-the-top-layer`, !afterEsc.confirm && afterEsc.sheet, afterEsc);
    if (!afterEsc.sheet) await openValve(); else { await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .at-actions .hm-pill')].find(b => /Открыть/.test(b.innerText)).click()); await page.waitForSelector('.hm-confirm'); }
    await page.goBack(); await page.waitForTimeout(350);
    check(`${tag}/confirmation-closes-on-back-and-sends-nothing`, !(await has(page, '.hm-confirm')) && (await sent()).length === n0, { now: await hash(), sent: (await sent()).length - n0 });
    await openValve(); await page.evaluate(() => { location.hash = '#setup'; }); await page.waitForTimeout(350);
    check(`${tag}/confirmation-closes-on-navigation`, !(await has(page, '.hm-confirm')) && (await sent()).length === n0);
    // a device that went silent while it was being asked about: the question is withdrawn
    await openValve(); await page.evaluate(id => window.atomPreview.setStates({ [id]: 'unavailable' }), valve); await page.waitForTimeout(350);
    check(`${tag}/confirmation-about-a-device-gone-silent-is-withdrawn`, !(await has(page, '.hm-confirm')) && /нет связи/i.test(await toast() ?? '') && (await sent()).length === n0, { toast: await toast() });
    await page.evaluate(id => window.atomPreview.setStates({ [id]: 'closed' }), valve); await page.waitForTimeout(200);
    // --- offline: the confirmed risky action says «нет связи» (the toast survives the click that closes the question) and sends nothing
    await openValve(); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('.hm-confirm .is-primary').click()); await page.waitForTimeout(500);
    check(`${tag}/offline-confirmed-action-says-no-connection-and-sends-nothing`, !(await has(page, '.hm-confirm')) && await toast() === 'Нет связи с домом' && (await sent()).length === n0, { toast: await toast(), sent: (await sent()).length - n0 });
    // --- announcements: one calm and one urgent region; the loss is in the urgent one once, the return in the calm one
    const live = await page.evaluate(() => ({ polite: document.querySelectorAll('.at-shell > [aria-live="polite"]').length, assertive: document.querySelectorAll('.at-shell > [aria-live="assertive"]').length, lost: [...document.querySelectorAll('.at-shell [aria-live="assertive"] .at-vh')].filter(x => x.textContent === 'Нет связи с домом').length, alerts: [...document.querySelectorAll('.at-shell > [role="alert"], .at-shell > .hm-main [role="alert"]')].filter(x => /Нет связи с домом/.test(x.textContent)).length, badge: document.querySelectorAll('.hm-head .hm-badge.tone-danger').length, railIsButton: document.querySelector('.hm-conn')?.tagName === 'BUTTON' }));
    await page.evaluate(() => window.atomPreview.setOnline(true)); await page.waitForTimeout(250);
    const calm = await page.evaluate(() => ({ said: document.querySelector('.at-shell > [aria-live="polite"]')?.textContent, lost: document.querySelectorAll('.at-shell [aria-live="assertive"] .at-vh').length, badge: document.querySelectorAll('.hm-head .hm-badge.tone-danger').length }));
    check(`${tag}/connection-lost-and-back-are-each-announced-once`, live.polite === 1 && live.assertive === 1 && live.lost === 1 && live.alerts === 0 && live.badge === 1 && !live.railIsButton && calm.said === 'Связь с домом восстановлена' && calm.lost === 0 && calm.badge === 0, { live, calm });
    await page.keyboard.press('Escape'); await to('home');
    // --- a refusal the way Home Assistant sends it ({ code, message }) is a sentence; two in a row: the second stays
    await to('lights'); await page.evaluate(() => window.atomPreview.setRefusal({ code: 'service_validation_error', message: 'Устройство занято' }));
    const hits = await page.$$('.ah-tile.kind-light:not(.is-unavailable) .ah-tile-hit:not([disabled])');
    await hits[0].evaluate(b => b.click()); await page.waitForTimeout(400); const first = await toast();
    await page.evaluate(() => window.atomPreview.setRefusal({ code: 'invalid_format', message: "expected float for dictionary value @ data['x']" })); await page.waitForTimeout(3300);
    await hits[1].evaluate(b => b.click()); await page.waitForTimeout(1600); const second = await toast();
    check(`${tag}/refusal-is-a-sentence-and-the-second-toast-stays`, first === 'Дом отклонил команду: Устройство занято' && second === 'Команда не выполнена. Проверьте связь и повторите', { first, second });
    const twoSent = (await sent()).slice(-2); check(`${tag}/a-switch-is-told-on-or-off-never-toggle`, twoSent.length === 2 && twoSent.every(c => /^turn_(on|off)$/.test(c.service)), twoSent);
    await page.evaluate(() => { window.atomPreview.setRefusal(null); document.querySelector('.hm-toast')?.click(); });
    // --- accepted, state not here yet: the tile stays pending, a second tap sends nothing; the state arrives: free again
    await page.evaluate(() => window.atomPreview.setAccept(true)); const key = await hits[2].evaluate(b => b.closest('[data-device-key]').dataset.deviceKey), eid = key.slice(2), was = await page.evaluate(id => window.fxState?.(id) ?? null, eid);
    const m0 = (await sent()).length; await hits[2].evaluate(b => b.click()); await page.waitForTimeout(300);
    const held = await page.evaluate(k => document.querySelector(`[data-device-key="${k}"]`).classList.contains('is-pending'), key); await page.evaluate(k => document.querySelector(`[data-device-key="${k}"] .ah-tile-hit`).click(), key); await page.waitForTimeout(200);
    const m1 = (await sent()).length; const went = (await sent())[m1 - 1];
    await page.evaluate(([id, s]) => window.atomPreview.setStates({ [id]: s }), [eid, went.service === 'turn_on' ? 'on' : 'off']); await page.waitForTimeout(400);
    const freed = await page.evaluate(k => !document.querySelector(`[data-device-key="${k}"]`).classList.contains('is-pending'), key);
    check(`${tag}/a-switch-is-pending-until-its-state-arrives-and-a-second-tap-sends-nothing`, held && m1 === m0 + 1 && freed, { held, sent: m1 - m0, freed, was });
    // --- after «Выполнить» the focus comes back to what asked (it was disabled while the command was on its way)
    if (!touch) {
      await page.evaluate(() => { const c = window.atomPreview.config; if (!c.buttons.some(b => b.id === 'qa_focus')) c.buttons = [{ id: 'qa_focus', label: 'QA focus', service: 'script.turn_on', target: { entity_id: 'script.qa' }, confirm: true }, ...c.buttons.slice(0, 5)]; window.atomPreview.setDelay(300); window.atomPreview.redraw(); }); await to('home');
      await page.evaluate(() => [...document.querySelectorAll('.ah-scene strong')].find(s => s.innerText === 'QA focus').closest('button').focus()); await page.keyboard.press('Enter'); await page.waitForSelector('.hm-confirm'); await page.waitForTimeout(150);
      const onCancel = await active(); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(900); const afterYes = await active();
      check(`${tag}/focus-returns-to-the-opener-after-the-confirmed-action`, /Отмена/.test(onCancel?.text ?? '') && /QA focus/.test(afterYes?.text ?? ''), { onCancel, afterYes });
      await page.evaluate(() => window.atomPreview.setDelay(0));
      // a page reached from the content: the heading takes the focus; Back gives it to the tile that led there
      await to('rooms'); await page.focus('.hm-room-grid .at-room:nth-of-type(2)'); const tile = await active(); await page.keyboard.press('Enter'); await page.waitForTimeout(350); const onHeading = await active();
      await page.goBack(); await page.waitForTimeout(350); const backOn = await active();
      check(`${tag}/a-new-page-focuses-its-heading-and-back-returns-to-the-tile`, onHeading?.tag === 'H1' && backOn?.text === tile?.text && /at-room/.test(backOn?.cls ?? ''), { tile, onHeading, backOn });
      await page.focus('.hm-room-grid .at-room'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); await page.focus('.hm-back'); await page.keyboard.press('Enter'); await page.waitForTimeout(350); const afterBackBtn = await active();
      check(`${tag}/the-rooms-button-returns-focus-to-the-room-tile`, /at-room/.test(afterBackBtn?.cls ?? ''), { afterBackBtn });
      // the lang menu is the top layer: Escape closes it and nothing else
      await to('home'); await page.click('.at-lang .at-pill-btn'); await page.waitForSelector('.at-lang-menu'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      check(`${tag}/escape-closes-the-menu-only`, !(await has(page, '.at-lang-menu')) && await hash() === '#home');
    }
    await page.evaluate(() => window.atomPreview.setAccept(false));
    // --- device settings in a sheet: an administrator's, and behind a question
    const socket = await page.evaluate(() => { const fx = window.atomPreview.host.states(); return Object.keys(fx).find(id => id.startsWith('switch.') && /detach|power_on_behavior|turbo/.test(id)); });
    const settingsOf = async () => { await to('systems'); const key = await page.evaluate(() => [...document.querySelectorAll('.hm-systems [data-device-key]')].map(x => x.dataset.deviceKey).find(k => /^e:switch\./.test(k))); await to('systems?device=' + encodeURIComponent(key)); await page.waitForSelector('.hm-sheet'); return page.evaluate(() => { const f = [...document.querySelectorAll('.hm-sheet details')].find(d => d.querySelector('.hm-setting .hm-switch, .hm-setting select, .hm-setting input')); if (f) f.open = true; return { fold: !!f, controls: document.querySelectorAll('.hm-sheet details .hm-setting .hm-switch, .hm-sheet details .hm-setting select, .hm-sheet details .hm-setting input[type=range]').length, close: document.querySelector('.hm-sheet-head .hm-icon-btn')?.getAttribute('aria-label') }; }); };
    const asAdmin = await settingsOf(); let asks = null;
    if (asAdmin.controls) { const s0 = (await sent()).length; await page.evaluate(() => document.querySelector('.hm-sheet details .hm-setting .hm-switch')?.click()); await page.waitForTimeout(300); asks = { asked: await has(page, '.hm-confirm'), sent: (await sent()).length - s0 }; await page.keyboard.press('Escape'); }
    await page.keyboard.press('Escape'); await page.evaluate(() => window.atomPreview.setAdmin(false)); const asGuest = await settingsOf(); await page.evaluate(() => window.atomPreview.setAdmin(true)); await page.keyboard.press('Escape');
    check(`${tag}/device-settings-are-for-the-administrator-and-ask-first`, asAdmin.controls > 0 && (!asks || (asks.asked && asks.sent === 0)) && asGuest.controls === 0 && asAdmin.close === 'Закрыть окно', { asAdmin, asks, asGuest, socket });
    // --- a speaker's sources: names, never entity ids
    await to('systems?device=e%3Amedia_player.yandex_station_l00a9j000dxvjr'); await page.waitForTimeout(300);
    const sources = await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .ah-mode-label')].map(x => x.innerText.trim()));
    check(`${tag}/speaker-sources-carry-names-not-entity-ids`, sources.length >= 2 && sources.every(s => !/^[a-z_]+\.[a-z0-9_]+$/.test(s)), { sources }); await page.keyboard.press('Escape');
    // --- the search of «Системы» finds a device of another section and opens its sheet
    await to('systems'); await page.fill('.at-search', 'пылесос'); await page.waitForTimeout(250); const found = await page.evaluate(() => [...document.querySelectorAll('.hm-systems [data-device-key]')].map(x => x.dataset.deviceKey));
    check(`${tag}/the-search-finds-devices-of-every-section`, found.some(k => /vacuum\./.test(k)), { found: found.slice(0, 5) }); await page.fill('.at-search', '');
    // --- a room photo that does not load: the stock picture or the plain tile, never a broken image
    await page.evaluate(() => { const c = window.atomPreview.config, id = Object.keys(c.rooms)[0] ?? document.querySelector('.at-room')?.dataset.roomId; window.__brokenRoom = id; c.rooms = { ...c.rooms, [id]: { ...(c.rooms[id] ?? {}), photo: '/atom_home_photos/gone-for-good.jpg' } }; window.atomPreview.redraw(); }); await to('rooms'); await page.waitForTimeout(900);
    const broken = await page.evaluate(() => [...document.querySelectorAll('.hm-room-grid img.hm-photo')].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')));
    check(`${tag}/a-room-photo-that-fails-falls-back-instead-of-a-broken-image`, broken.length === 0, { broken });
    // --- the nav landmarks and the systems strip say what they are
    await to('climate'); const marks = await page.evaluate(() => ({ nav: [...document.querySelectorAll('.hm-sidebar nav, nav.hm-tabbar')].map(n => n.getAttribute('aria-label')), current: [...document.querySelectorAll('.hm-sidebar nav [aria-current="page"], nav.hm-tabbar [aria-current="page"]')].map(b => b.innerText.trim()), strip: document.querySelector('.ah-segments.is-sys')?.getAttribute('role'), stripCurrent: [...document.querySelectorAll('.ah-segments.is-sys [aria-current="page"]')].map(b => b.innerText.trim()), tabs: document.querySelectorAll('.hm-main > [role="tablist"], .ah-segments.is-sys [role="tab"]').length, last: [...document.querySelectorAll('.ah-segments.is-sys button')].pop()?.innerText.trim() }));
    check(`${tag}/navigation-landmarks-are-named-and-mark-the-current-page`, marks.nav.every(n => n === 'Разделы') && marks.current.join() === 'Системы' && marks.strip === 'navigation' && marks.stripCurrent.join() === 'Климат' && marks.tabs === 0 && marks.last === 'Устройства', marks);
    // --- «Системы» opens its first tab, never a hidden one; a hidden section is no page
    await page.evaluate(() => { const c = window.atomPreview.config; c.sections = { ...c.sections, climate: { ...(c.sections.climate ?? {}), hidden: true } }; window.atomPreview.redraw(); }); await page.waitForTimeout(300); const hiddenNow = await hash();
    await to('home'); const heatTile = await has(page, '.at-heat-tile'); await nav('Системы'); const sysFirst = await hash(), firstTab = await page.evaluate(() => document.querySelector('.ah-segments.is-sys button')?.classList.contains('is-active'));
    await page.evaluate(() => { const c = window.atomPreview.config; c.sections = { ...c.sections, climate: { ...(c.sections.climate ?? {}), hidden: false } }; window.atomPreview.redraw(); });
    check(`${tag}/a-hidden-section-is-neither-opened-nor-linked`, hiddenNow !== '#climate' && !heatTile && sysFirst !== '#climate' && firstTab === true, { hiddenNow, heatTile, sysFirst, firstTab });
    // --- a sheet is swiped down by its head on a touch screen; a state update in the middle of the gesture does not drop it
    if (touch) {
      const cdp = await ctx.newCDPSession(page);
      const swipe = async (dy, mid) => { const box = await page.evaluate(() => { const r = document.querySelector('.hm-sheet .hm-sheet-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
        for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y + dy * i / 8 }] }); if (mid && i === 4) await page.evaluate(() => { const id = Object.keys(window.atomPreview.host.states()).find(k => k.startsWith('sensor.') && /^\d/.test(window.atomPreview.host.states()[k].state)); window.atomPreview.setStates({ [id]: '1' }); }); await page.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(500); };
      const openLamp = async () => { await to('lights'); await page.evaluate(() => document.querySelector('.ah-tile.kind-light .ah-tile-more').click()); await page.waitForSelector('.hm-sheet'); await page.waitForTimeout(450); };
      await openLamp(); const headTouch = await page.evaluate(() => getComputedStyle(document.querySelector('.hm-sheet .hm-sheet-head')).touchAction);
      await swipe(40); const stays = await has(page, '.hm-sheet') && (await page.evaluate(() => document.querySelector('.hm-sheet').style.transform)) === '';
      await swipe(220); const closed = !(await has(page, '.hm-sheet')) && await hash() === '#lights';
      await openLamp(); await swipe(220, true); const closedMid = !(await has(page, '.hm-sheet')) && await hash() === '#lights';
      check(`${tag}/a-sheet-is-swiped-down-by-its-head-also-through-a-state-update`, headTouch === 'none' && stays && closed && closedMid, { headTouch, stays, closed, closedMid });
      // opened by touch, the sheet itself has the focus: no ring around «×»
      await openLamp(); await page.evaluate(() => document.querySelector('.hm-sheet .hm-icon-btn').click()); await page.waitForTimeout(350); await page.tap('.ah-tile.kind-light .ah-tile-more'); await page.waitForSelector('.hm-sheet'); await page.waitForTimeout(300);
      check(`${tag}/a-sheet-opened-by-touch-takes-the-focus-itself`, await page.evaluate(() => document.activeElement?.classList.contains('hm-sheet') === true), await active());
    }
    check(`${tag}/no-console-errors`, pageErrors.filter(e => !/gone-for-good|Failed to load resource/.test(e)).length === 0, { pageErrors: pageErrors.slice(0, 5) });
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
const report = { pass: checks.every(c => c.p) && !errors.length, checks, errors }; await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1));
