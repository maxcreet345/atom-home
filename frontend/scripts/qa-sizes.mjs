// Every card of «Главная» and of the rooms at every size «Расставить» lets it take (owner 21.11.2026: «карточки оптимизируются под разные
// стандарты?» — «делай все карточки»). One arrangement per size puts every card of the screen at that size; each card is then shot on
// its own, on a phone and a tablet, in light and dark. Checks per card: nothing runs past its box (text cut mid-letter, controls outside),
// no text under 11 px, no empty half (a big card that only fills a corner). Local preview inside a shadow root as in HA, Criuleni snapshot
// of 18.11 and its settings; no command reaches a device. usage: node scripts/qa-sizes.mjs [out-dir] [only: regex over card keys]
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, process.env.QA_DIST ?? 'dist-preview'), out = resolve(root, process.argv[2] ?? 'evidence/card-sizes'); await mkdir(out, { recursive: true });
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const live = await readFile(resolve(root, '../private/fixtures/criuleni-registry-live-20261118.json'), 'utf8');
const houseConfig = await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261118.json'), 'utf8');
const server = createServer(async (req, res) => { try { const u = new URL(req.url, 'http://l');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%}</style><div id="root"></div><script type="module">import "/atom-preview.js";window.ready=true</script>'); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(live); return; }
  if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(houseConfig); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const SIZES = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [4, 3]];
const SCREENS = [['home', '#home'], ['room:kukhnia', '#rooms?room=kukhnia'], ['room:gostinaia', '#rooms?room=gostinaia']];
const VIEWS = (process.env.QA_VIEWS ?? 'phone,tablet').split(',').map(v => ({ phone: ['phone', { width: 412, height: 915 }], tablet: ['tablet', { width: 1280, height: 800 }], land: ['land', { width: 915, height: 412 }] })[v]);
const THEMES = (process.env.QA_THEMES ?? 'dark').split(',');
const browser = await chromium.launch(); const findings = []; const errors = [];
const R = 'document.getElementById("root").shadowRoot.querySelector("div")';
async function open(page, hash, layouts, theme) {
  await page.goto('about:blank'); await page.goto(origin + '/?shadow=1' + hash); await page.waitForFunction(() => window.ready);
  await page.evaluate(async ({ layouts, theme }) => { const cfg = JSON.parse(await (await fetch('/config.json')).text()); cfg.home = { ...cfg.home, theme }; localStorage.setItem('atom-home:config', JSON.stringify(cfg)); localStorage.setItem('atom-home:preview-layouts', JSON.stringify(layouts)); localStorage.setItem('atom-home:layout-device', 'qa'); const fx = await (await fetch('/fixture.json')).json(); await window.mountPreview(document.getElementById('root'), fx); }, { layouts, theme });
  await page.waitForTimeout(1300);
}
const profile = scopes => ({ profiles: { qa: { name: 'QA', scopes, rev: 1, updated: 1 } } });
try {
  for (const [vp, size] of VIEWS) for (const theme of THEMES) {
    const page = await (await browser.newContext({ viewport: size, deviceScaleFactor: 2 })).newPage(); page.on('pageerror', e => errors.push(`${vp}: ${e.message}`));
    for (const [scope, hash] of SCREENS) {
      // the screen's cards: an empty arrangement lists them all
      await open(page, hash, profile({ [scope]: [] }), theme);
      const keys = (await page.evaluate(`[...${R}.querySelectorAll('.at-lay[data-scope="${scope}"] > .at-slot')].map(s => s.dataset.lay)`)).filter(k => !only || only.test(k));
      for (const [w, h] of SIZES) {
        await open(page, hash, profile({ [scope]: keys.map(k => [k, w, h]) }), theme);
        for (const key of keys) {
          const sel = `.at-lay[data-scope="${scope}"] > .at-slot[data-lay="${key.replace(/"/g, '\\"')}"]`;
          const box = page.locator(sel); if (!await box.count()) continue;
          await box.scrollIntoViewIfNeeded().catch(() => {});
          const real = await box.evaluate(s => ({ w: s.dataset.w, h: s.dataset.h }));
          const name = `${vp}-${theme}-${scope.replace(':', '_')}-${key.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}-${real.w}x${real.h}`;
          if (real.w !== String(w) && w > 1) { /* clamped by the columns: shot once at the widest */ if (findings.some(f => f.shot === name)) continue; }
          await box.screenshot({ path: resolve(out, name + '.png') }).catch(() => {});
          const f = await box.evaluate(slot => {
            const r = slot.getBoundingClientRect(), bad = [];
            const visible = el => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
            let used = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
            for (const el of slot.querySelectorAll('*')) {
              if (!visible(el) || el.closest('[hidden],.at-slot-size,.at-slot-grip')) continue;
              const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
              const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
              if (own || ['IMG', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'BUTTON'].includes(el.tagName)) {
                used = { l: Math.min(used.l, b.left), t: Math.min(used.t, b.top), r: Math.max(used.r, b.right), b: Math.max(used.b, b.bottom) };
                // inside the card's box, or cut by it
                const out = b.right > r.right + 1 || b.bottom > r.bottom + 1 || b.left < r.left - 1 || b.top < r.top - 1;
                if (out && own) bad.push(['cut', (el.textContent || '').trim().slice(0, 30)]);
                if (own && parseFloat(getComputedStyle(el).fontSize) < 11) bad.push(['tiny', (el.textContent || '').trim().slice(0, 30), getComputedStyle(el).fontSize]);
                // text clipped by its own ellipsis or line clamp
                if (own && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4) && /hidden|clip/.test(getComputedStyle(el).overflow)) bad.push(['clipped', (el.textContent || '').trim().slice(0, 30)]);
              }
            }
            const fill = used.r > used.l ? ((used.r - used.l) * (used.b - used.t)) / (r.width * r.height) : 0;
            if (r.width * r.height > 90000 && fill < 0.45) bad.push(['empty', `${Math.round(fill * 100)}% used`]);
            return { bad, fill: Math.round(fill * 100) };
          });
          findings.push({ vp, theme, scope, key, w: +real.w, h: +real.h, shot: name, ...f });
        }
      }
      console.log(vp, theme, scope, keys.length, 'cards');
    }
  }
} finally {
  const byCard = {}; for (const f of findings) { const k = `${f.scope} ${f.key}`; (byCard[k] ??= []).push(`${f.vp} ${f.w}x${f.h}${f.bad.length ? ': ' + f.bad.map(b => b.join(' ')).join('; ') : ''}`); }
  await writeFile(resolve(out, 'sizes-report.json'), JSON.stringify({ at: new Date().toISOString(), errors, findings }, null, 1));
  const bad = findings.filter(f => f.bad.length); console.log(`${findings.length} shots, ${bad.length} with findings, ${errors.length} page errors`);
  await browser.close(); server.close();
}
