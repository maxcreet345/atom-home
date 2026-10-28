// QA of the pet feeder module on the Traian registry snapshot (preview host, commands rejected).
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/stage6-feeder'); await mkdir(out, { recursive: true });
const fixture = await readFile(resolve(root, '../private/fixtures/traian-registry.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l'); if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; } if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; } const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const check = (n, p, d = {}) => checks.push({ n, p, ...d }); const errors = [];
// Scenario QA of the pet feeder module on the Traian snapshot (preview host: every command is rejected, nothing reaches a device).
try {
  for (const [w, h] of [[1070, 764], [402, 874]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    await page.goto(origin); await page.waitForFunction(() => window.ready);
    await page.evaluate(async () => { localStorage.clear(); const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx); });
    await page.waitForSelector('.at-shell'); await page.waitForTimeout(800);
    const tag = `${w}x${h}`, shot = name => page.screenshot({ path: resolve(out, `${tag}-${name}.png`) });
    const text = sel => page.evaluate(sel => document.querySelector(sel)?.innerText ?? '', sel);
    check(`${tag}/compact-card-on-overview`, /Кормушка/.test(await text('[data-module-card="pet_feeder"].hm-status')) && /\d+ g/.test(await text('[data-module-card="pet_feeder"].hm-status')), { text: await text('[data-module-card="pet_feeder"].hm-status') });
    await shot('home');
    const go = label => page.evaluate(label => { let b = [...document.querySelectorAll('.hm-sidebar nav button, .hm-tabbar button')].find(e => e.innerText.trim() === label); if (!b) { document.querySelector('.hm-tabbar button:last-child')?.click(); return 'more'; } b.click(); return 'ok'; }, label);
    if (await go('Системы') === 'more') { await page.waitForTimeout(300); await page.evaluate(() => [...document.querySelectorAll('.hm-more button')].find(e => e.innerText.trim() === 'Системы')?.click()); }
    await page.waitForTimeout(600); await shot('systems');
    const card = await text('.at-feeder');
    check(`${tag}/full-card-plan-and-next`, /08:00 · 2, 12:00 · 1, 18:00 · 2/.test(card) && /Следующее \d\d:\d\d/.test(card), { card: card.slice(0, 300) });
    check(`${tag}/desiccant-warning`, /Пора заменить осушитель/.test(card));
    await page.evaluate(() => [...document.querySelectorAll('.at-feeder .hm-round')].find(b => b.getAttribute('aria-label') === '+').click()); await page.waitForTimeout(150);
    check(`${tag}/stepper-to-2`, /2 порции/.test(await text('.at-feeder-dose')) && /≈ 20 г/.test(await text('.at-feeder-dose')), { dose: await text('.at-feeder-dose') });
    await page.evaluate(() => document.querySelector('.at-feeder-go').click()); await page.waitForTimeout(200);
    check(`${tag}/confirm-shows-dose`, /Выдать 2 порции \(≈ 20 г\)\?/.test(await text('.at-feeder-confirm')), { confirm: await text('.at-feeder-confirm') });
    await shot('confirm');
    await page.evaluate(() => document.querySelector('.at-feeder-yes').click()); await page.waitForTimeout(500);
    const log = await page.evaluate(() => window.atomPreview?.host?.log ?? null);
    check(`${tag}/feed-sent-as-dosed-miot-action-and-rejected-by-preview`, Array.isArray(log) && log.length === 1 && log[0].domain === 'xiaomi_miot' && log[0].service === 'call_action' && log[0].data.siid === 2 && log[0].data.aiid === 1 && log[0].data.params[0].piid === 8 && log[0].data.params[0].value === 2 && /не приняла команду/.test(await text('.at-feeder-note')), { log, note: await text('.at-feeder-note') });
    check(`${tag}/confirm-closed-after-send`, !(await page.evaluate(() => !!document.querySelector('.at-feeder-confirm'))));
    await page.evaluate(() => document.querySelector('.at-feeder .hm-switch').click()); await page.waitForTimeout(200);
    check(`${tag}/plan-toggle-asks-first`, /план кормления/.test(await text('.at-feeder-confirm')) && (await page.evaluate(() => window.atomPreview.host.log.length)) === 1);
    await page.evaluate(() => document.querySelector('.at-feeder-plan-yes').click()); await page.waitForTimeout(400);
    check(`${tag}/plan-toggle-calls-switch-off`, await page.evaluate(() => { const l = window.atomPreview.host.log; return l.length === 2 && l[1].domain === 'switch' && l[1].service === 'turn_off' && l[1].data.entity_id === 'switch.xiaomi_iv2001_318f_schedule_state'; }));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
const report = { pass: checks.every(c => c.p) && !errors.length, checks, errors }; await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1));
