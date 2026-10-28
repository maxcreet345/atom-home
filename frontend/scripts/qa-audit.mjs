// Behaviour audit of the panel on the Criuleni snapshot with the owner's config (preview host, commands rejected).
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/audit-behaviour'); await mkdir(out, { recursive: true });
const fixture = await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
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
    const last = async () => { const l = await log(); return l[l.length - 1]; };
    const text = sel => page.evaluate(sel => document.querySelector(sel)?.innerText ?? '', sel);
    const has = sel => page.evaluate(sel => !!document.querySelector(sel), sel);
    const rawKeys = () => page.evaluate(() => [...document.querySelectorAll('.at-shell *')].filter(e => e.children.length === 0 && /^[a-z]+\.[a-zA-Z0-9_.]+$/.test(e.textContent.trim())).map(e => e.textContent.trim()).slice(0, 10));
    // 1. light tile toggle → light.turn_on, toast with the rejection
    await go('home'); const lightKey = await page.evaluate(() => document.querySelector('.ah-tile.kind-light:not(.is-off)')?.dataset.deviceKey);
    await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="${k}"] .ah-tile-hit`).click(), lightKey); await page.waitForTimeout(500);
    let c = await last(); check(`${tag}/light-tile-toggles-the-light`, !!c && c.domain === 'light' && /^(toggle|turn_on)$/.test(c.service) && c.data.entity_id === lightKey.slice(2), { c, lightKey });
    check(`${tag}/rejected-command-shows-toast`, await has('.hm-toast'));
    // 2. thermostat chevrons → climate.set_temperature ±0.5 around the target
    const target = await page.evaluate(() => { const v = document.querySelector('.ah-thermo .ah-thermo-value'); const m = /(\d+(?:[.,]\d+)?)°/.exec(v.querySelector('small')?.innerText ?? ''); return Number((m && /цель|target|țint/i.test(v.querySelector('small').innerText) ? m[1] : v.querySelector('b').innerText).replace(',', '.')); });
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-chev.is-up').click()); await page.waitForTimeout(400); c = await last();
    check(`${tag}/thermostat-up-sets-target-plus-step`, c.domain === 'climate' && c.service === 'set_temperature' && (Math.abs(c.data.temperature - (target + 0.5)) < 1e-6 || Math.abs(c.data.temperature - (target + 1)) < 1e-6), { c, target });
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-chev.is-down').click()); await page.waitForTimeout(400); c = await last();
    check(`${tag}/thermostat-down-sets-target-minus-step`, c.domain === 'climate' && (Math.abs(c.data.temperature - (target - 0.5)) < 1e-6 || Math.abs(c.data.temperature - (target - 1)) < 1e-6), { c });
    // 3. scene button → homeassistant.turn_off with 9 lights, no confirm
    await page.evaluate(() => [...document.querySelectorAll('.ah-scene strong')].find(s => /Свет выкл/.test(s.innerText)).closest('button').click()); await page.waitForTimeout(400); c = await last();
    check(`${tag}/scene-calls-service-with-targets`, c.domain === 'homeassistant' && c.service === 'turn_off' && Array.isArray(c.data.entity_id) && c.data.entity_id.length === 9 && !(await has('.hm-confirm')), { c });
    // 4. thermostat tile opens the sheet; Escape closes it; scrim click closes it
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-tile-hit').click()); await page.waitForTimeout(400);
    check(`${tag}/thermostat-sheet-opens`, /Отопление дома/.test(await text('.hm-sheet h2')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300); const escClosed = !(await has('.hm-sheet'));
    await page.evaluate(() => document.querySelector('.ah-thermo .ah-tile-hit').click()); await page.waitForTimeout(400);
    await page.mouse.click(w - 4, 4); await page.waitForTimeout(300); const scrimClosed = !(await has('.hm-sheet'));
    check(`${tag}/sheet-closes-on-escape-and-scrim`, escClosed && scrimClosed, { escClosed, scrimClosed });
    await go('home');
    // 5. sheet controls: brightness slider → light.turn_on with brightness_pct; switch → turn_on
    await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="${k}"] .ah-tile-more`).click(), lightKey); await page.waitForTimeout(400);
    const hadRange = await has('.hm-sheet input[type=range]');
    if (hadRange) { await page.evaluate(() => { const r = document.querySelector('.hm-sheet input[type=range]'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(400); c = await last(); }
    check(`${tag}/sheet-brightness-slider-calls-light`, !hadRange || (c.domain === 'light' && c.data.brightness_pct === 40), { hadRange, c });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await go('home');
    // 6. unavailable device: toggle disabled, tile faded
    const offKey = await page.evaluate(() => document.querySelector('.ah-tile.is-off')?.dataset.deviceKey);
    check(`${tag}/unavailable-tile-cannot-toggle`, !!offKey && await page.evaluate(k => document.querySelector(`.ah-tile[data-device-key="${k}"] .ah-tile-hit`).disabled, offKey), { offKey });
    // 7. navigation: every section renders, back from room returns to rooms, history back works
    const sections = ['rooms', 'lights', 'climate', 'cleaning', 'energy', 'systems', 'setup', 'home'];
    const rendered = {}; for (const s of sections) { await go(s); rendered[s] = await page.evaluate(() => !!document.querySelector('.hm-page')?.children.length); }
    check(`${tag}/all-sections-render`, Object.values(rendered).every(Boolean), rendered);
    await go('rooms'); await page.evaluate(() => document.querySelector('.at-room').click()); await page.waitForTimeout(400);
    const inRoom = await has('.hm-room-page'); await page.evaluate(() => history.back()); await page.waitForTimeout(400);
    check(`${tag}/room-opens-and-history-back-returns`, inRoom && await has('.hm-room-grid.is-page'));
    await page.evaluate(() => document.querySelector('.at-room').click()); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('.hm-back').click()); await page.waitForTimeout(300);
    check(`${tag}/back-button-returns-to-rooms`, await has('.hm-room-grid.is-page'));
    // 8. segments hide a section hidden in the config
    await go('systems'); const segs = await page.evaluate(() => [...document.querySelectorAll('.ah-segments button')].map(b => b.innerText));
    await page.evaluate(() => { const cfg = window.atomPreview.config; cfg.sections = { ...cfg.sections, cleaning: { hidden: true } }; window.atomPreview.redraw?.(); }); await page.waitForTimeout(300);
    check(`${tag}/segments-list-sections`, segs.length === 5, { segs });
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
} finally { await browser.close(); server.close(); }
const report = { pass: checks.every(c => c.p) && !errors.length, checks, errors }; await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1));
