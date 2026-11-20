// Every card of «Главная» and of the rooms at every size «Расставить» lets it take (owner 21.11.2026: «карточки оптимизируются под разные
// стандарты?» — «делай все карточки»). One arrangement per size puts every card of the screen at that size; each card is then shot on
// its own. Checks per card and size:
//   natural — at the span it has without an arrangement the card looks the same as without one (entering «Расставить» never jumps);
//   cut     — text that runs past the card's box; clipped — text cut by its own ellipsis or line clamp; tiny — text under 11 px;
//   empty   — a big card that leaves most of itself blank (points sampled over the card, as a finger would land);
//   target  — a control under 44 px on its short side.
// Houses: QA_HOUSE=criuleni (default) | extra (Criuleni with a scene button, a favourite lamp, Security hidden: leaks and openings) | okapi
// (the office: its climate and security tiles, a thermostat). Views QA_VIEWS=phone,tablet,land; themes QA_THEMES=dark,light; QA_LANG=ru|ro|en.
// QA_DIST: another preview build. Inside a shadow root as in HA; no command reaches a device.
// usage: node scripts/qa-sizes.mjs [out-dir] [only: regex over card keys]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, process.env.QA_DIST ?? 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/card-sizes'); await mkdir(out, { recursive: true });
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const HOUSE = process.env.QA_HOUSE ?? 'criuleni', LANG = process.env.QA_LANG ?? 'ru';
const fixtureFile = HOUSE === 'okapi' ? '../private/fixtures/okapi-climate-20261109.json' : '../private/fixtures/criuleni-registry-live-20261118.json';
const live = await readFile(resolve(root, fixtureFile), 'utf8');
const cfg = HOUSE === 'okapi' ? { schemaVersion: 1, home: { name: 'Atom + Okapi' }, devices: {} } : JSON.parse(await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261118.json'), 'utf8'));
if (HOUSE === 'extra') {
  cfg.sections = { ...(cfg.sections ?? {}), security: { ...(cfg.sections?.security ?? {}), hidden: true } };
  cfg.buttons = [{ id: 'qa-night', label: 'Ночь', icon: 'moon', service: 'scene.turn_on', target: 'scene.night' }, ...(cfg.buttons ?? [])];
  const lamp = JSON.parse(live).entities.find(e => e.entity_id.startsWith('light.') && e.device_id)?.device_id;
  if (lamp) cfg.devices = { ...(cfg.devices ?? {}), [lamp]: { ...(cfg.devices?.[lamp] ?? {}), favorite: true } };
}
cfg.home = { ...(cfg.home ?? {}), language: LANG };
const houseConfig = JSON.stringify(cfg);
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(live); return; }
  if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(houseConfig); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const SIZES = (process.env.QA_SIZES ?? '1x1,2x1,3x1,1x2,2x2,3x2,4x3').split(',').map(s => s.split('x').map(Number));
const SCREENS = HOUSE === 'okapi' ? [['home', '#home']] : [['home', '#home'], ['room:kukhnia', '#rooms?room=kukhnia'], ['room:gostinaia', '#rooms?room=gostinaia']];
const VIEWS = (process.env.QA_VIEWS ?? 'phone,tablet').split(',').map(v => ({ phone: ['phone', { width: 412, height: 915 }], tablet: ['tablet', { width: 1280, height: 800 }], land: ['land', { width: 915, height: 412 }] })[v]);
const THEMES = (process.env.QA_THEMES ?? 'dark').split(',');
const browser = await chromium.launch(); const findings = []; const errors = [];
const R = 'document.getElementById("root").shadowRoot.querySelector("div")';
async function open(page, hash, layouts, theme) {
  await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
  await page.evaluate(async ({ layouts, theme }) => { const cfg = JSON.parse(await (await fetch('/config.json')).text()); cfg.home = { ...cfg.home, theme }; localStorage.setItem('atom-home:config', JSON.stringify(cfg)); if (layouts) { localStorage.setItem('atom-home:preview-layouts', JSON.stringify(layouts)); localStorage.setItem('atom-home:layout-device', 'qa'); } else { localStorage.removeItem('atom-home:preview-layouts'); localStorage.removeItem('atom-home:layout-device'); } const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx); }, { layouts, theme });
  await page.waitForTimeout(1300);
}
const profile = scopes => ({ profiles: { qa: { name: 'QA', scopes, rev: 1, updated: 1 } } });
/** what a card shows and how big it is: text, size, and its span in its grid's cells */
const readCard = `el => { const r = el.getBoundingClientRect(), g = getComputedStyle(el.parentElement), cols = g.gridTemplateColumns.split(' ').filter(Boolean), cell = parseFloat(cols[0]) || 150, gap = parseFloat(g.columnGap) || 12;
  const n = px => Math.max(1, Math.round((px + gap) / (cell + gap)));
  return { text: (el.innerText || '').replace(/\\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height), span: [Math.min(cols.length, n(r.width)), Math.min(8, n(r.height))], unit: el.parentElement.classList.contains('rm-tile-grid') }; }`;
const audit = `slot => {
  const rootNode = slot.getRootNode(), r = slot.getBoundingClientRect(), bad = [];
  const visible = el => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  for (const el of slot.querySelectorAll('*')) {
    if (!visible(el) || el.closest('[hidden],.at-slot-size,.at-slot-grip,.at-slot-veil')) continue;
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      const label = (el.textContent || '').trim().slice(0, 30), cs = getComputedStyle(el);
      if (b.right > r.right + 1 || b.bottom > r.bottom + 1 || b.left < r.left - 1 || b.top < r.top - 1) bad.push(['cut', label]);
      if (parseFloat(cs.fontSize) < 11 && !el.closest('svg')) bad.push(['tiny', label, cs.fontSize]);
      if ((el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4) && /hidden|clip/.test(cs.overflow + cs.textOverflow)) bad.push(['clipped', label]);
    }
    if (el.matches('button,[role=button],a[href],input,select') && !el.closest('.at-slot-tools') && el.getAttribute('tabindex') !== '-1') {
      const big = el.classList.contains('ah-tile-hit') || (b.width >= r.width - 2 && b.height >= r.height - 2);
      if (!big && Math.min(b.width, b.height) < 43.5 && b.right <= r.right + 1 && b.bottom <= r.bottom + 1) bad.push(['target', (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24), Math.round(b.width) + 'x' + Math.round(b.height)]);
    }
  }
  // points over the card, as a finger would land: how many fall on something the card shows (text, a picture, a control, a dial)
  let hit = 0, total = 0;
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
    const x = r.left + r.width * i / 8, y = r.top + r.height * j / 8; total++;
    const e = rootNode.elementFromPoint(x, y); if (!e || !slot.contains(e)) continue;
    const t = e.closest('svg,img,canvas,video,button,[role=button],input') || ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) ? e : null);
    if (t && !t.classList.contains('ah-tile-hit') && !t.classList.contains('at-slot-veil')) hit++;
    else { const bg = getComputedStyle(e).backgroundImage; if (bg && bg !== 'none' && !e.classList.contains('ah-tile')) hit++; }
  }
  const fill = Math.round(hit / total * 100);
  if (r.width * r.height > 300 * 300 && fill < 22) bad.push(['empty', fill + '% of the card shows something']);
  return { bad, fill };
}`;
try {
  for (const [vp, size] of VIEWS) for (const theme of THEMES) {
    const page = await (await browser.newContext({ viewport: size, deviceScaleFactor: 2 })).newPage(); page.on('pageerror', e => errors.push(`${vp}: ${e.message}`));
    for (const [scope, hash] of SCREENS) {
      // the screen as it is without an arrangement: each card's text, box and span (its natural size)
      await open(page, hash, null, theme);
      const natural = await page.evaluate(`(() => { const out = {}; for (const m of ${R}.querySelectorAll('[data-lay-mark]')) { const el = m.nextElementSibling; if (!el || el.hasAttribute('data-lay-mark') || !m.closest('[data-lay-scope="${scope}"]')) continue; out[m.getAttribute('data-lay-mark')] = (${readCard})(el); } return out; })()`);
      const keys = Object.keys(natural).filter(k => !only || only.test(k));
      // the same cards arranged at their natural spans: they must look the same
      await open(page, hash, profile({ [scope]: keys.map(k => [k, natural[k].unit ? 1 : natural[k].span[0], natural[k].unit ? 1 : natural[k].span[1]]) }), theme);
      for (const key of keys) {
        if (natural[key].unit) continue; // a room's plain devices are rows of a list without an arrangement, cells with one
        const now = await page.evaluate(`(() => { const s = ${R}.querySelector('.at-lay[data-scope="${scope}"] > .at-slot[data-lay="${key}"]'); const el = s && [...s.children].find(c => !c.matches('.at-slot-size,.at-slot-grip,.at-slot-veil')); return el ? (${readCard})(el) : null; })()`);
        const was = natural[key], same = now && now.text === was.text && Math.abs(now.w - was.w) <= 4; // the height snaps to whole cells
        if (!same) findings.push({ vp, theme, scope, key, w: was.span[0], h: was.span[1], shot: null, bad: [['natural', now ? `${was.w}x${was.h} → ${now.w}x${now.h}${now.text !== was.text ? ', text differs' : ''}` : 'missing']], fill: null });
      }
      for (const [w, h] of SIZES) {
        await open(page, hash, profile({ [scope]: keys.map(k => [k, w, h]) }), theme);
        for (const key of keys) {
          const sel = `.at-lay[data-scope="${scope}"] > .at-slot[data-lay="${key.replace(/"/g, '\\"')}"]`;
          const box = page.locator(sel); if (!await box.count()) continue;
          await box.scrollIntoViewIfNeeded().catch(() => {});
          const real = await box.evaluate(s => ({ w: +s.dataset.w, h: +s.dataset.h }));
          const name = `${HOUSE}-${LANG}-${vp}-${theme}-${scope.replace(':', '_')}-${key.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}-${real.w}x${real.h}`;
          if (findings.some(f => f.shot === name)) continue; // clamped by the columns: shot once
          await box.screenshot({ path: resolve(out, name + '.png') }).catch(() => {});
          const f = await box.evaluate(new Function('return ' + audit)());
          findings.push({ vp, theme, scope, key, w: real.w, h: real.h, shot: name, ...f });
        }
      }
      console.log(vp, theme, scope, keys.length, 'cards');
    }
  }
} finally {
  await writeFile(resolve(out, `sizes-report-${HOUSE}-${LANG}.json`), JSON.stringify({ at: new Date().toISOString(), house: HOUSE, lang: LANG, errors, findings }, null, 1));
  const bad = findings.filter(f => f.bad.length);
  const kinds = {}; for (const f of bad) for (const b of f.bad) kinds[b[0]] = (kinds[b[0]] ?? 0) + 1;
  console.log(`${findings.length} checks, ${bad.length} with findings ${JSON.stringify(kinds)}, ${errors.length} page errors`);
  await browser.close(); server.close();
}
