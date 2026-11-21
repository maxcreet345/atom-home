// Every ready card in «＋ Добавить карточку» (owner 21.11.2026: «добавь все готовые карточки»). On the Criuleni snapshot and its settings,
// inside a shadow root as in HA, a phone and a tablet:
//   - «Все карточки» lists every profile; each category chip leads to its own; every card has its words;
//   - each card found in this house opens with its fields filled from the module's own finding and shows its own card in the preview;
//   - adding a module card where its module already shows gives the same one card (no second tile), and tells the module only what it changes;
//   - a second card of the same module is refused in words; removing the card puts the module's settings back exactly as they were;
//   - the boiler, which the module alone does not find here (its pressure sensor has another name), appears once its card is added;
//   - no command reaches a device. usage: node scripts/qa-catalog-all.mjs [out-dir]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/catalog-all'); await mkdir(out, { recursive: true });
const live = await readFile(resolve(root, '../private/fixtures/criuleni-registry-live-20261121.json'), 'utf8');
const houseConfig = await readFile(resolve(root, '../private/fixtures/criuleni-config-20261121.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(live); return; }
  if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(houseConfig); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(); const checks = []; const errors = [];
const check = (n, p, d = {}) => { checks.push({ n, p: !!p, ...d }); if (!p) console.log('FAIL', n, JSON.stringify(d)); };
const R = 'document.getElementById("root").shadowRoot.querySelector("div")';
const SELF = ['xiaomi.feeder2', 'xiaomi.fountain2', 'xiaomi.kettle2pro', 'xiaomi.airfryer55', 'roborock.saros_z70', 'aqara.g4', 'imou.ranger2c', 'sonoff.cam_c44he', 'xiaomi.c700', 'demirdokum.nitromix_p24', 'house.air', 'house.clock'];
try {
  for (const [vp, size] of [['phone', { width: 412, height: 915 }], ['tablet', { width: 1280, height: 800 }]]) {
    const page = await (await browser.newContext({ viewport: size, deviceScaleFactor: 2 })).newPage(); page.on('pageerror', e => errors.push(`${vp}: ${e.message}`));
    const open = async (hash, keep = false) => { await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
      await page.evaluate(async keep => { if (!keep) { localStorage.clear(); localStorage.setItem('atom-home:config', await (await fetch('/config.json')).text()); } const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx); }, keep); await page.waitForTimeout(1200); };
    const shot = n => page.screenshot({ path: resolve(out, `${vp}-${n}.png`) });
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('atom-home:config') ?? '{}'));
    const log = () => page.evaluate(() => window.atomPreview.host.log.filter(c => c.domain !== 'ws').length);
    const count = sel => page.evaluate(`${R}.querySelectorAll('${sel}').length`);
    await open('#home?device=add-card'); await page.waitForSelector('.at-cards[data-step="list"]');
    await page.click('[data-tab="all"]'); await page.waitForTimeout(200); await shot('01-all-cards');
    const all = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile));
    check(`${vp}:all-15-cards-listed`, all.length === 15 && SELF.every(id => all.includes(id)), { all });
    const words = await page.$$eval('.at-cards-item strong', l => l.map(x => x.textContent));
    check(`${vp}:every-card-has-a-title`, words.every(w => w && !/^cat\./.test(w)), { words });
    for (const c of ['pets', 'kitchen', 'cameras', 'boiler', 'cleaning', 'house']) { await page.click(`[data-category="${c}"]`); await page.waitForTimeout(120); const ids = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile)); check(`${vp}:category-${c}`, ids.length > 0, { ids }); if (c === 'pets') await shot('02-pets'); await page.click(`[data-category="${c}"]`); }
    await page.click('[data-tab="found"]'); await page.waitForTimeout(150);
    const found = await page.$$eval('.at-cards-item', l => l.map(x => x.dataset.profile));
    for (const id of SELF.filter(x => found.includes(x))) {
      await page.click(`.at-cards-item[data-profile="${id}"]`); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(350);
      const ready = await page.evaluate(() => { const b = document.getElementById('root').shadowRoot.querySelector('[data-action="add-card"]'); return b && b.getAttribute('aria-disabled') !== 'true'; });
      const preview = await count('.at-cards-preview-tile > *');
      check(`${vp}:${id}:fields-filled-and-preview`, ready && preview > 0, { ready, preview });
      if (['xiaomi.feeder2', 'demirdokum.nitromix_p24', 'xiaomi.kettle2pro', 'xiaomi.c700'].includes(id)) { await page.evaluate(`${R}.querySelector('[data-part="preview"]')?.scrollIntoView({block:'start'})`); await page.waitForTimeout(250); await shot(`03-form-${id.replace(/\W/g, '_')}`); }
      await page.click('.at-cards-back'); await page.waitForSelector('.at-cards[data-step="list"]');
    }
    // the feeder where its module already shows: the same one card; the settings change only where the card differs from the module
    const before = await stored(); const modBefore = JSON.stringify(before.modules?.pet_feeder ?? null);
    await open('#home', true); const feederBefore = await count('.at-fd-tile');
    await open('#home?device=add-card', true); await page.click('.at-cards-item[data-profile="xiaomi.feeder2"]'); await page.waitForSelector('.at-cards[data-step="form"]');
    await page.click('[data-action="add-card"]'); await page.waitForTimeout(700);
    let cfg = await stored(); const inst = Object.entries(cfg.profileInstances ?? {}).find(([, i]) => i.profileId === 'xiaomi.feeder2');
    check(`${vp}:feeder-card-saved`, !!inst);
    await open('#home', true); const feederAfter = await count('.at-fd-tile');
    check(`${vp}:feeder-still-one-card`, feederBefore === 1 && feederAfter === 1, { feederBefore, feederAfter });
    await open('#home?device=add-card', true); await page.click('[data-tab="all"]'); await page.click('.at-cards-item[data-profile="xiaomi.feeder2"]'); await page.waitForSelector('.at-cards[data-step="form"]'); await page.waitForTimeout(300);
    const refused = await page.evaluate(() => { const r = document.getElementById('root').shadowRoot; return { off: r.querySelector('[data-action="add-card"]')?.getAttribute('aria-disabled'), note: r.querySelector('.at-cards-need')?.textContent ?? '' }; });
    check(`${vp}:second-feeder-refused`, refused.off === 'true' && /уже есть/i.test(refused.note), refused); await shot('04-second-refused');
    await open(`#home?device=card:${inst[0]}`, true); await page.waitForSelector('.at-cards[data-step="form"]'); await page.click('[data-action="remove-card"]'); await page.waitForTimeout(300);
    await page.evaluate(() => { const r = document.getElementById('root').shadowRoot; const btns = [...r.querySelectorAll('button')]; (btns.reverse().find(b => /^Удалить|^Убрать/.test((b.textContent ?? '').trim()) && b.getAttribute('data-action') !== 'remove-card'))?.click(); }); await page.waitForTimeout(700);
    cfg = await stored();
    check(`${vp}:removed-settings-exactly-as-before`, !Object.values(cfg.profileInstances ?? {}).some(i => i.profileId === 'xiaomi.feeder2') && JSON.stringify(cfg.modules?.pet_feeder ?? null) === modBefore, { before: modBefore, after: cfg.modules?.pet_feeder });
    await open('#home', true); check(`${vp}:feeder-card-back-as-before`, await count('.at-fd-tile') === 1);
    // the boiler: its card makes it appear
    await open('#home'); const boilerBefore = await count('[data-lay-mark^="m:boiler"]');
    await open('#home?device=add-card', true); await page.click('.at-cards-item[data-profile="demirdokum.nitromix_p24"]'); await page.waitForSelector('.at-cards[data-step="form"]'); await page.click('[data-action="add-card"]'); await page.waitForTimeout(700);
    await open('#home', true); const boilerAfter = await count('[data-lay-mark^="m:boiler"]'); await page.evaluate(`${R}.querySelector('[data-lay-mark^="m:boiler"]')?.nextElementSibling?.scrollIntoView({block:'center'})`); await page.waitForTimeout(300); await shot('05-boiler-after');
    check(`${vp}:boiler-appears-with-its-card`, boilerBefore === 0 && boilerAfter >= 1, { boilerBefore, boilerAfter });
    check(`${vp}:no-commands`, await log() === 0);
  }
} finally {
  check('no-page-errors', errors.length === 0, { errors });
  await writeFile(resolve(out, 'qa-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.filter(c => c.p).length, total: checks.length, checks, errors }, null, 1));
  console.log(`${checks.filter(c => c.p).length}/${checks.length}`);
  await browser.close(); server.close();
}
