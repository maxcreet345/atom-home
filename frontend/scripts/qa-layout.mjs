// Layout over the device envelope (evidence/audit-2026-11-09/DEVICES-2026.md): the whole panel on the Criuleni snapshot and single cards in a chosen state, walked through
// a representative set of sizes. Fails on: text cut off inside a module, sideways overflow, overlapping modules, controls outside their card, an unreachable rail entry,
// hidden tabs without a cue, a header that is not on the content's column, touch targets under 44 px, a focus ring cut by `overflow:hidden`, a root font size the panel
// ignores, a television left at desktop sizes, and text under the contrast bar on the key dark-theme elements.
// usage: node scripts/qa-layout.mjs <outDir> [only: regex over size ids]      (QA_DIST=<dir> checks another preview build)
import { chromium } from '../node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { addFeeder, feederLog } from './feeder-fixture.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview'); // QA_DIST: another build of the preview (to see the checks fail on an older one)
const out = resolve(process.argv[2] ?? resolve(root, 'evidence/layout')); await mkdir(out, { recursive: true });
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;

// ---- own server: «/» the whole panel (owner's config), «/card?card=&scenario=» one card in a state (scripts/cards/*.mjs) -----------------------------------
const fixture = JSON.stringify(addFeeder(JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8'))));
const cardBase = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-registry-live-20261028.json'), 'utf8'));
const configText = await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8');
const HEAD = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%;position:relative}</style><div id="root"></div><script type="module">import "/atom-preview.js"; const q = new URLSearchParams(location.search);';
const PANEL = HEAD + 'const [fx, cfg] = await Promise.all([fetch("/fixture.json").then(r => r.json()), fetch("/config.json").then(r => r.json())]); cfg.home.theme = q.get("theme") ?? "light"; window.__feederLog = await fetch("/feeder-log.json").then(r => r.json()); await window.mountPreview(document.getElementById("root"), fx, cfg); window.ready = true;</script>';
const CARD = HEAD + 'const d = await (await fetch("/__state" + location.search)).json(); localStorage.clear(); d.config.home.theme = q.get("theme") ?? "light"; d.config.home.language = q.get("lang") ?? "ru"; window.__feederLog = d.feederLog; window.__airTasks = d.airTasks; window.__energyMonth = d.energyMonth; window.__energyStats = d.energyStats; window.__energyPrefs = d.energyPrefs; window.__logbook = d.logbook; window.__frames = d.frames; window.__camHistory = d.camHistory; await window.mountPreview(document.getElementById("root"), d.snapshot, d.config); window.ready = true;</script>';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = createServer(async (req, res) => { const u = new URL(req.url, 'http://l'); try {
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PANEL); return; }
  if (u.pathname === '/card') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(CARD); return; }
  if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; }
  if (u.pathname === '/feeder-log.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(feederLog())); return; }
  if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(configText); return; }
  if (u.pathname === '/__state') { const name = u.searchParams.get('card'); if (!/^[a-z0-9-]+$/.test(name)) throw new Error('bad card'); const { card } = await import(`./cards/${name}.mjs`), s = card.scenarios[u.searchParams.get('scenario')]; if (!s) throw new Error('no scenario'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ...card.build(cardBase, s, new Date('2026-11-10T12:00:00')), config: card.config(configText, s) })); return; }
  if (u.pathname.startsWith('/api/camera_proxy/')) { res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#1b2433"/></svg>'); return; }
  if (u.pathname.startsWith('/frames/')) { const f = resolve(root, '../private/camera-frames', decodeURIComponent(u.pathname.slice(8))); if (!f.startsWith(resolve(root, '../private/camera-frames'))) throw new Error('outside'); res.setHeader('content-type', 'image/jpeg'); res.end(await readFile(f)); return; }
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); if (!p.startsWith(dist)) throw new Error('outside'); res.setHeader('content-type', TYPES[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p));
} catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;

// ---- the sizes: extremes of every class; t = touch, tv = a remote (no hover, no pointer), ha = Home Assistant's sidebar beside the panel -------------------
const S = (id, w, h, o = {}) => ({ id, w, h, touch: false, tv: false, ha: 0, ...o });
const SIZES = [
  S('phone-smallest-320x568', 320, 568, { touch: true }), S('fold-cover-344x882', 344, 882, { touch: true }), S('oneplus-13r-360x792', 360, 792, { touch: true }),
  S('phone-land-568x320', 568, 320, { touch: true }), S('oneplus-13r-land-792x360', 792, 360, { touch: true }), S('fold-open-690x829', 690, 829, { touch: true }),
  S('oppo-pad-port-764x1070', 764, 1070, { touch: true }), S('oppo-pad-1070x764', 1070, 764, { touch: true }), S('ipad-11-in-ha-1180x820', 1180, 820, { touch: true, ha: 256 }),
  S('laptop-13-1280x600', 1280, 600), S('fhd-1920x1080', 1920, 1080), S('ultrawide-2560x1080', 2560, 1080), S('super-ultrawide-5120x1440', 5120, 1440), S('4k-3840x2160', 3840, 2160),
  S('tv-960x540', 960, 540, { tv: true }), S('tv-1920x1080', 1920, 1080, { tv: true }),
].filter(s => !only || only.test(s.id));
const PANELS = [['home', '#home'], ['lights', '#lights'], ['systems', '#systems'], ['climate', '#climate'], ['room', '#rooms?room=prikhozhaia'], ['setup', '#setup']];
const CARDS = [['heating', 'heating', 'normal', '#climate'], ['cameras-home', 'cameras', 'person', '#home'], ['kettle-sheet', 'kettle', 'heating', '#home?device=kettle'], ['security', 'security', 'triggered', '#security'], ['vacuum-room', 'rooms', 'evening', '#rooms?room=prikhozhaia']];

// ---- what is measured on a screen (runs in the page) ----------------------------------------------------------------------------------------------------
const measure = opts => {
  const issues = [], vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const shell = document.querySelector('.hm-shell'), main = document.querySelector('.hm-main'), sheet = [...document.querySelectorAll('.hm-sheet')].pop() ?? null, scope = sheet ?? main;
  const k = Number(shell.style.zoom || 1), W = innerWidth, H = innerHeight;
  const label = e => `${e.tagName.toLowerCase()}.${String(e.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}${e.textContent.trim() ? ' «' + e.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) + '»' : ''}`;
  const textBox = e => { const range = document.createRange(); range.selectNodeContents(e); return range.getBoundingClientRect(); };
  const inView = e => { const r = e.getBoundingClientRect(), m = scope.getBoundingClientRect(); return r.bottom > m.top && r.top < m.bottom && r.right > m.left && r.left < m.right; };
  // 1. nothing pans sideways
  if (document.documentElement.scrollWidth > W + 1) issues.push(`overflow: the page is ${document.documentElement.scrollWidth} px wide in a ${W} px window`);
  for (const e of [main, sheet].filter(Boolean)) if (e.scrollWidth > e.clientWidth + 1) { const worst = [...e.querySelectorAll('*')].filter(vis).filter(x => !x.closest('.hm-room-grid,.ah-segments,.hm-range-tabs,.hm-chips,.ah-room-pills,.at-vac-times,svg')).map(x => [x.getBoundingClientRect().right, x]).sort((a, b) => b[0] - a[0])[0]; issues.push(`overflow: ${label(e)} scrolls sideways by ${e.scrollWidth - e.clientWidth} px (${worst ? label(worst[1]) : '?'})`); }
  // 2. a module's words are inside the module, whole lines only; every lamp shows its name and its state
  const tiles = [...scope.querySelectorAll('.ah-tile, .rm-tile, .rm-q')].filter(vis);
  for (const t of tiles) { const tr = t.getBoundingClientRect();
    for (const e of t.querySelectorAll('strong, small, b, span, p')) { if (!vis(e) || e.closest('svg, .at-vh') || !e.textContent.trim() || [...e.children].some(c => c.textContent.trim())) continue; const cs = getComputedStyle(e); if (cs.clipPath !== 'none' || cs.position === 'absolute' && cs.width === '1px') continue;
      const b = textBox(e); if (!b.height) continue;
      let clip = tr; for (let p = e; p && p !== t.parentElement; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.overflowY !== 'visible' || ps.overflowX !== 'visible') { const pr = p.getBoundingClientRect(); clip = { top: Math.max(clip.top, pr.top), bottom: Math.min(clip.bottom, pr.bottom), left: Math.max(clip.left, pr.left), right: Math.min(clip.right, pr.right) }; } }
      const lineClamp = cs.webkitLineClamp !== 'none' || cs.textOverflow === 'ellipsis'; // an ellipsis is an honest cut; a line sliced through is not
      const slack = Math.max(1.5, parseFloat(cs.fontSize) * k * 0.2); // a tight line box may shave the empty part of the font's box (big figures with line-height 1), never the letters
      if (b.bottom > clip.bottom + slack && !(lineClamp && e.getBoundingClientRect().bottom <= clip.bottom + 1.5)) issues.push(`clipped: ${label(e)} in ${label(t).slice(0, 40)} is cut by ${Math.round(b.bottom - clip.bottom)} px at the bottom`);
      if (b.top < clip.top - slack) issues.push(`clipped: ${label(e)} is cut at the top`);
      let honest = lineClamp; for (let p = e.parentElement; p && p !== t.parentElement && !honest; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.overflowX !== 'visible' && (ps.textOverflow === 'ellipsis' || ps.webkitLineClamp !== 'none')) honest = true; } // the words end in «…» inside their own line: an honest cut
      if (!honest && (b.right > clip.right + 1.5 || b.left < clip.left - 1.5)) issues.push(`clipped: ${label(e)} runs ${Math.round(Math.max(b.right - clip.right, clip.left - b.left))} px out of ${label(t).slice(0, 40)}`);
    }
    if (t.matches('.kind-light')) { const name = t.querySelector('.ah-tile-text strong'), state = t.querySelector('.ah-tile-text small'); if (!name || !state || !vis(name) || !vis(state) || state.getBoundingClientRect().bottom > tr.bottom + 1) issues.push(`lamp: ${label(t)} does not show its name and its state`); }
    // a name is never broken inside a word without a hyphen
    const name = t.querySelector('.ah-tile-text strong'); if (name && vis(name) && getComputedStyle(name).hyphens !== 'auto') { const node = [...name.childNodes].find(n => n.nodeType === 3); if (node) for (const m of node.data.matchAll(/\S+/g)) { const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length); if (new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1) issues.push(`broken word: «${m[0]}» in ${label(t).slice(0, 40)}`); } }
  }
  // 3. modules of one grid do not overlap; a card's own controls stay inside the card
  for (const g of scope.querySelectorAll('.ah-grid, .at-lights-grid, .hm-room-grid, .rm-tile-grid, .at-heat-rooms, .at-cams-strip')) { const kids = [...g.children].filter(vis).map(e => [e, e.getBoundingClientRect()]);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i][1], b = kids[j][1], ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 1.5 && oy > 1.5) issues.push(`overlap: ${label(kids[i][0]).slice(0, 36)} × ${label(kids[j][0]).slice(0, 36)} by ${Math.round(ox)}×${Math.round(oy)} px in ${label(g).slice(0, 30)}`); }
    const gr = g.getBoundingClientRect(); if (!g.matches('.hm-room-grid')) for (const [e, r] of kids) if (r.right > gr.right + 1.5) issues.push(`overlap: ${label(e).slice(0, 36)} leaves its grid by ${Math.round(r.right - gr.right)} px`); }
  for (const card of scope.querySelectorAll('.at-heat-room, .at-heat-tile, .at-vac-tile, .at-cams-tile, .hm-sheet-head, .at-kt-head')) { if (!vis(card)) continue; const cr = card.getBoundingClientRect(); for (const b of card.querySelectorAll('button, svg, img')) { if (!vis(b) || b.closest('.at-vac-open, .at-heat-open')) continue; const r = b.getBoundingClientRect(); if (r.right > cr.right + 1.5 || r.left < cr.left - 1.5 || (card.matches('.hm-sheet-head, .at-kt-head') && sheet && (r.left < sheet.getBoundingClientRect().left + 6 || r.right > sheet.getBoundingClientRect().right - 6))) issues.push(`outside: ${label(b).slice(0, 36)} sticks ${Math.round(Math.max(r.right - cr.right, cr.left - r.left, 0))} px out of ${label(card).slice(0, 30)}`); } }
  // 4. the rail: every entry and the link indicator can be reached without a scroll, down to 320 px of height
  const rail = document.querySelector('.hm-sidebar'); if (rail && vis(rail) && !sheet) { for (const b of [...rail.querySelectorAll('nav button'), rail.querySelector('.hm-conn')].filter(Boolean)) if (b.getBoundingClientRect().bottom > H + 1) issues.push(`rail: ${label(b)} ends ${Math.round(b.getBoundingClientRect().bottom - H)} px under the screen`); for (const s of rail.querySelectorAll('nav button span')) if (s.scrollWidth > s.clientWidth + 1) issues.push(`rail: the label «${s.textContent}» is cut`); }
  for (const sp of document.querySelectorAll('.hm-tabbar button span')) if (vis(sp) && sp.scrollWidth > sp.clientWidth + 1) issues.push(`rail: the tab bar label «${sp.textContent}» is cut`);
  // 5. tabs that do not fit either wrap or show that there are more
  for (const tabs of scope.querySelectorAll('.ah-segments, .hm-range-tabs')) { if (!vis(tabs) || tabs.scrollWidth <= tabs.clientWidth + 1) continue; const cs = getComputedStyle(tabs), more = tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 12 ? cs.getPropertyValue('--ah-fade-r') : cs.getPropertyValue('--ah-fade-l'); if (!(parseFloat(more) > 0)) issues.push(`tabs: ${label(tabs).slice(0, 40)} hides ${tabs.scrollWidth - tabs.clientWidth} px of tabs without a cue`); }
  // 6. wide screens: the header, the tabs and the page share one column; nothing is stretched or stranded
  const head = document.querySelector('.hm-head'), page = document.querySelector('.hm-page');
  if (head && page && vis(head) && vis(page) && !sheet && shell.classList.contains('is-wide')) { const a = head.getBoundingClientRect(), b = page.getBoundingClientRect(); if (Math.abs(a.left - b.left) > 1.5 || Math.abs(a.right - b.right) > 1.5) issues.push(`column: the header is at ${Math.round(a.left)}…${Math.round(a.right)}, the page at ${Math.round(b.left)}…${Math.round(b.right)}`);
    const seg = [...document.querySelectorAll('.hm-main > .ah-segments, .hm-main > .hm-range-tabs')].find(vis); if (seg) { const c = seg.getBoundingClientRect(); if (Math.abs(c.left - b.left) > 1.5) issues.push(`column: the tabs start at ${Math.round(c.left)}, the page at ${Math.round(b.left)}`); }
    if (b.width / k > 1921) issues.push(`column: the page is ${Math.round(b.width / k)} px wide`);
    const railR = rail?.getBoundingClientRect(); if (railR && b.left - railR.right > 0.2 * W) issues.push(`column: the rail is ${Math.round(b.left - railR.right)} px away from the content`);
    for (const t of tiles) { const r = t.getBoundingClientRect(); if (t.matches('.ah-grid > .ah-tile[class*="kind-"]:not(.ah-thermo), .ah-grid > .ah-value') && getComputedStyle(t).gridColumnEnd === 'auto' && r.width / k > 250) issues.push(`stretched: ${label(t).slice(0, 40)} is ${Math.round(r.width / k)} px wide`); } }
  // 7. touch: the shared controls are at least 44 px where the finger is the pointer (the hit area is probed, so invisible extensions count)
  if (opts.touch) { const hit = (e, x, y) => { const at = document.elementFromPoint(x, y); return !!at && (at === e || e.contains(at)); };
    for (const e of scope.querySelectorAll('.hm-back, .hm-text-btn, .ah-segments button, .hm-range-tabs button, .hm-pill, .rm-tile-act, .rm-q, .hm-tabbar button, .hm-sidebar nav button, .hm-icon-btn, .at-search input, .at-heat-pm, .hm-chips > button')) { if (!vis(e) || e.disabled || !inView(e) || (!sheet && e.closest('.hm-sheet'))) continue; const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; if (!hit(e, cx, cy)) continue; /* covered: not reachable here anyway */
      let h = 0; for (let d = 0; d <= 30; d++) { if (hit(e, cx, cy - d)) h++; else break; } for (let d = 1; d <= 30; d++) { if (hit(e, cx, cy + d)) h++; else break; }
      if (h < 43 && cy - 22 > scope.getBoundingClientRect().top && cy + 22 < Math.min(H, scope.getBoundingClientRect().bottom)) issues.push(`target: ${label(e).slice(0, 44)} is ${h} px tall for a finger`); } }
  // 8. the focus ring is not cut off: it is inside the element, or nothing clips it
  for (const e of scope.querySelectorAll('.ah-tile-hit, .at-module-hit, .ah-segments button, .hm-range-tabs button, .hm-room, .hm-fold > summary, .at-cams-hit, .at-cams-thumb, .at-osec-key, .at-osec-dev-hit, .rm-tile-open, .rm-q, .hm-sidebar nav button, .hm-tabbar button, .hm-pill, .hm-icon-btn, .hm-back')) { if (!vis(e) || e.disabled || e.tabIndex < 0 || !inView(e)) continue; e.focus({ focusVisible: true, preventScroll: true }); const cs = getComputedStyle(e), w = parseFloat(cs.outlineWidth) || 0, off = parseFloat(cs.outlineOffset) || 0; if (cs.outlineStyle === 'none' || w < 2) { issues.push(`focus: ${label(e).slice(0, 44)} has no ring`); continue; } if (off <= -w) continue;
    const r = e.getBoundingClientRect(), grow = off + w; for (let p = e.parentElement; p && p !== shell; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue; const pr = p.getBoundingClientRect(); const cut = Math.max(pr.left - (r.left - grow), (r.right + grow) - pr.right, ps.overflowY === 'visible' ? 0 : pr.top - (r.top - grow), ps.overflowY === 'visible' ? 0 : (r.bottom + grow) - pr.bottom); if (cut > 1.5 && p.scrollWidth <= p.clientWidth + 1 && (p.scrollHeight <= p.clientHeight + 1 || cut === Math.max(pr.left - (r.left - grow), (r.right + grow) - pr.right))) { issues.push(`focus: the ring of ${label(e).slice(0, 44)} is cut by ${label(p).slice(0, 30)}`); break; } } }
  document.activeElement?.blur?.();
  return { issues: [...new Set(issues)], zoom: k, classes: [...shell.classList].filter(c => /^(is-|pw-|ph-)/.test(c)).join(' '), cols: (() => { const g = scope.querySelector('.ah-grid'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; })(), minFont: Math.min(...[...scope.querySelectorAll('*')].filter(e => vis(e) && !e.closest('svg') && [...e.childNodes].some(n => n.nodeType === 3 && n.data.trim())).map(e => parseFloat(getComputedStyle(e).fontSize))) * k };
};

// ---- contrast: the colour of the words against what is really painted behind them (glass, blur and gradients included) -------------------------------------
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
async function contrastOf(page, handle) {
  const info = await handle.evaluate(e => { e.scrollIntoView({ block: 'center', inline: 'nearest' }); const range = document.createRange(); range.selectNodeContents(e); const r = range.getBoundingClientRect(), cs = getComputedStyle(e); let op = 1; for (let p = e; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity); const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g2 = cv.getContext('2d', { willReadFrequently: true }); g2.fillStyle = cs.color; g2.fillRect(0, 0, 1, 1); const d = g2.getImageData(0, 0, 1, 1).data, m = d[3] ? [d[0] * 255 / d[3], d[1] * 255 / d[3], d[2] * 255 / d[3], d[3] / 255] : [0, 0, 0, 0]; /* any colour syntax (color-mix gives color(srgb …)), un-premultiplied */ return { x: r.left, y: r.top, w: r.width, h: r.height, color: m.slice(0, 3), alpha: (m[3] ?? 1) * op, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400, text: e.textContent.trim().slice(0, 30) }; });
  if (info.w < 2 || info.h < 2) return null;
  const clip = { x: Math.max(0, Math.floor(info.x)), y: Math.max(0, Math.floor(info.y)), width: Math.ceil(info.w), height: Math.ceil(info.h) };
  await handle.evaluate(e => { e.dataset.qaHide = '1'; }); await page.addStyleTag({ content: '[data-qa-hide]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}[data-qa-hide] *{visibility:hidden!important}' }).catch(() => undefined);
  const png = await page.screenshot({ clip }); await handle.evaluate(e => { delete e.dataset.qaHide; });
  const px = await page.evaluate(async src => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(0, 0, i.width, i.height).data, out = []; const step = Math.max(1, Math.floor(d.length / 4 / 600)); for (let p = 0; p < d.length / 4; p += step) out.push([d[p * 4], d[p * 4 + 1], d[p * 4 + 2]]); return out; }, 'data:image/png;base64,' + png.toString('base64'));
  const ratios = px.map(bg => { const fg = info.color.map((c, i) => c * info.alpha + bg[i] * (1 - info.alpha)), a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }).sort((a, b) => a - b);
  return { ...info, ratio: ratios[Math.floor(ratios.length * 0.1)] }; // the 10th percentile: the worse part of the background, not one stray pixel
}
// [name, where, selector, bar] — bar 4.5 for text, 3 for large text (≥ 24 px, or ≥ 18.66 px bold) and for a device shown as unavailable
const DARK = [
  ['module name on glass', ['panel', '#home'], '.ah-grid > .ah-tile:not(.is-on):not(.is-off) .ah-tile-text strong', 4.5], ['module second line on glass', ['panel', '#home'], '.ah-grid > .ah-tile:not(.is-on):not(.is-off) .ah-tile-text small', 4.5],
  ['greeting on the wallpaper', ['panel', '#home'], '.hm-head p', 4.5], ['lamp state', ['panel', '#lights'], '.kind-light:not(.is-off) .ah-tile-text small', 4.5], ['unavailable lamp name', ['panel', '#lights'], '.kind-light.is-off .ah-tile-text strong', 3], ['unavailable lamp state', ['panel', '#lights'], '.kind-light.is-off .ah-tile-text small', 3],
  ['section tab', ['panel', '#systems'], '.ah-segments button:not(.is-active)', 4.5], ['selected section tab', ['panel', '#systems'], '.ah-segments button.is-active', 4.5], ['setup tab', ['panel', '#setup'], '.hm-range-tabs button:not(.is-active)', 4.5],
  ['back link', ['panel', '#rooms?room=prikhozhaia'], '.hm-back', 4.5], ['hidden device row', ['panel', '#setup'], '.hm-row.is-off strong', 3],
  ['security word on the tile', ['card', 'security', 'triggered', '#home'], '.at-sec-tile-word', 4.5], ['security state «Тревога!»', ['card', 'security', 'triggered', '#security'], '.at-osec-state', 4.5],
  ['security state «Не дома»', ['card', 'security', 'away', '#security'], '.at-osec-state', 4.5], ['security word «Не дома»', ['card', 'security', 'away', '#home'], '.at-sec-tile-word', 4.5], ['security state «Утечка газа!»', ['card', 'security', 'gas', '#security'], '.at-osec-state', 4.5], ['security word «Снято»', ['card', 'security', 'disarmed', '#home'], '.at-sec-tile-word', 4.5], ['security state «Постановка»', ['card', 'security', 'arming', '#security'], '.at-osec-state', 4.5],
  ['kettle status', ['card', 'kettle', 'heating', '#home?device=kettle'], '.at-kt-status', 4.5], ['kettle temperature', ['card', 'kettle', 'heating', '#home?device=kettle'], '.at-kt-temp', 3], ['kettle off the base', ['card', 'kettle', 'lifted', '#home?device=kettle'], '.at-kt-status', 4.5], ['kettle offline', ['card', 'kettle', 'offline', '#home?device=kettle'], '.at-kt-status', 4.5],
  ['room: switched-on quick tile', ['card', 'rooms', 'evening', '#rooms?room=gostinaia'], '.rm-q.is-on strong', 4.5], ['room: switched-on tile name', ['card', 'rooms', 'evening', '#rooms?room=gostinaia'], '.rm-tile.is-on .rm-tile-name strong', 4.5], ['room: tile action', ['card', 'rooms', 'evening', '#rooms?room=gostinaia'], '.rm-tile:not(.is-on) .rm-tile-act', 4.5],
  ['cameras summary', ['card', 'cameras', 'ring', '#camera'], '.at-cams-summary .at-cams-state', 4.5], ['cameras summary (person)', ['card', 'cameras', 'person', '#camera'], '.at-cams-summary .at-cams-state', 4.5],
];
const LIGHT = [
  ['kettle status (light)', ['card', 'kettle', 'heating', '#home?device=kettle'], '.at-kt-status', 4.5], ['room: switched-on quick tile (light)', ['card', 'rooms', 'evening', '#rooms?room=gostinaia'], '.rm-q.is-on strong', 4.5], ['room: tile action (light)', ['card', 'rooms', 'evening', '#rooms?room=gostinaia'], '.rm-tile:not(.is-on) .rm-tile-act', 4.5],
  ['unavailable lamp name (light)', ['panel', '#lights'], '.kind-light.is-off .ah-tile-text strong', 3], ['module name (light)', ['panel', '#home'], '.ah-grid > .ah-tile:not(.is-on):not(.is-off) .ah-tile-text strong', 4.5], ['module second line (light)', ['panel', '#home'], '.ah-grid > .ah-tile:not(.is-on):not(.is-off) .ah-tile-text small', 4.5],
];

// ---- run ------------------------------------------------------------------------------------------------------------------------------------------------
const results = []; let pass = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (ok) pass++; results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await chromium.launch();
const open = async (s, theme = 'light', extra = {}) => { const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, hasTouch: s.touch, isMobile: s.touch, reducedMotion: 'reduce', colorScheme: theme, locale: 'ru-RU' });
  const css = (s.ha ? `#root{margin-left:${s.ha}px!important;width:calc(100% - ${s.ha}px)!important}` : '') + (extra.rootFont ? `html{font-size:${extra.rootFont * 100}%!important}` : '');
  if (css) await ctx.addInitScript(c => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = c; document.head.append(st); }); }, css);
  if (s.tv) await ctx.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = q => /any-hover:\s*none|any-pointer:\s*none/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q); }); // a television's browser: no hover, no pointer
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 160))); await page.clock.setFixedTime(new Date('2026-11-10T12:00:00')); return { ctx, page, errors }; };
const go = async (page, where, theme) => { if (where[0] === 'panel') { await page.goto(`${origin}/?theme=${theme}${where[1]}`); } else await page.goto(`${origin}/card?card=${where[1]}&scenario=${where[2]}&theme=${theme}&lang=ru${where[3]}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 }); await page.waitForTimeout(450); };
try {
  // A. layout on every size
  for (const s of SIZES) { const { ctx, page, errors } = await open(s); const found = []; let first = null;
    try {
      await go(page, ['panel', '#home'], 'light');
      for (const [name, hash] of PANELS) { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(350); const m = await page.evaluate(measure, { touch: s.touch }); first ??= m; found.push(...m.issues.map(i => `${name}: ${i}`)); await page.screenshot({ path: resolve(out, `${s.id}-${name}.png`) }); }
      for (const [name, card, sc, hash] of CARDS) { await go(page, ['card', card, sc, hash], 'light'); const m = await page.evaluate(measure, { touch: s.touch }); found.push(...m.issues.map(i => `${name}: ${i}`)); await page.screenshot({ path: resolve(out, `${s.id}-${name}.png`) }); }
    } catch (e) { found.push('did not run: ' + String(e.message).slice(0, 200)); }
    const kinds = ['overflow', 'clipped', 'lamp', 'broken word', 'overlap', 'outside', 'rail', 'tabs', 'column', 'stretched', 'target', 'focus', 'did not run'];
    const by = k => found.filter(i => i.split(': ')[1]?.startsWith(k) || i.startsWith(k));
    check(`${s.id}: no sideways overflow`, by('overflow').length + by('did not run').length === 0, by('overflow').concat(by('did not run')).slice(0, 3).join(' | '));
    check(`${s.id}: module text whole, lamps show name and state, no word broken`, by('clipped').length + by('lamp').length + by('broken word').length === 0, by('clipped').concat(by('lamp'), by('broken word')).slice(0, 4).join(' | '));
    check(`${s.id}: no overlapping modules, controls inside their cards`, by('overlap').length + by('outside').length === 0, by('overlap').concat(by('outside')).slice(0, 4).join(' | '));
    check(`${s.id}: rail reachable, tabs wrap or show a cue, one content column`, by('rail').length + by('tabs').length + by('column').length + by('stretched').length === 0, by('rail').concat(by('tabs'), by('column'), by('stretched')).slice(0, 4).join(' | '));
    if (s.touch) check(`${s.id}: touch targets ≥ 44 px`, by('target').length === 0, by('target').slice(0, 4).join(' | '));
    check(`${s.id}: focus ring not cut`, by('focus').length === 0, by('focus').slice(0, 4).join(' | '));
    check(`${s.id}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    if (s.tv) check(`${s.id}: a television is drawn enlarged, the smallest text is ≥ ${s.h >= 1080 ? 22 : 11} px on screen`, !!first && first.zoom === Math.min(s.w / 960, s.h / 540) && first.minFont >= (s.h >= 1080 ? 22 : 11), first ? `zoom ${first.zoom}, smallest ${first.minFont} px` : '');
    if (s.id.startsWith('4k')) check(`${s.id}: a 4K monitor at 100 % is drawn enlarged (smallest text ≥ 16 px on screen)`, !!first && first.zoom > 1 && first.minFont >= 16, first ? `zoom ${first.zoom}, smallest ${first.minFont} px` : '');
    if (s.ha) check(`${s.id}: breakpoints follow the panel, not the window`, !!first && !first.classes.includes('pw-1180') && first.classes.includes('pw-701'), first?.classes ?? '');
    await writeFile(resolve(out, `${s.id}.json`), JSON.stringify({ size: s, first, found }, null, 1)); await ctx.close(); }
  // B. the root font size scales the text and nothing breaks
  for (const s of SIZES.filter(s => /oneplus-13r-360|oppo-pad-1070/.test(s.id))) { const base = await open(s); await go(base.page, ['panel', '#home'], 'light'); const b = await base.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ah-tile-text strong')).fontSize)); await base.ctx.close();
    for (const f of [0.85, 1.3, 1.5]) { const { ctx, page, errors } = await open(s, 'light', { rootFont: f }); const found = []; let size = 0;
      try { await go(page, ['panel', '#home'], 'light'); size = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ah-tile-text strong')).fontSize));
        for (const [name, hash] of PANELS) { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(350); const m = await page.evaluate(measure, { touch: false }); found.push(...m.issues.filter(i => /^(overflow|clipped|lamp|overlap|outside|rail)/.test(i)).map(i => `${name}: ${i}`)); await page.screenshot({ path: resolve(out, `${s.id}-font${f}-${name}.png`) }); }
        await go(page, ['card', 'heating', 'normal', '#climate'], 'light'); found.push(...(await page.evaluate(measure, { touch: false })).issues.filter(i => /^(overflow|clipped|overlap|outside)/.test(i)).map(i => `heating: ${i}`)); await page.screenshot({ path: resolve(out, `${s.id}-font${f}-heating.png`) });
      } catch (e) { found.push('did not run: ' + String(e.message).slice(0, 200)); }
      check(`${s.id}: root font ${f * 100} % scales the text (${b} → ${size} px)`, Math.abs(size - b * f) < 0.6, '');
      check(`${s.id}: root font ${f * 100} % — nothing cut, overlapping or panning`, found.length === 0 && errors.length === 0, found.concat(errors).slice(0, 4).join(' | ')); await ctx.close(); } }
  // C. contrast of the key elements, dark theme (and the ones that failed in the light theme)
  for (const s of SIZES.filter(s => /oneplus-13r-360|oppo-pad-1070/.test(s.id))) for (const [theme, list] of [['dark', DARK], ['light', LIGHT]]) { const { ctx, page } = await open(s, theme); let at = '';
    for (const [name, where, sel, bar] of list) { try { const key = where.join(' '); if (key !== at) { await go(page, where, theme); at = key; }
        const els = (await page.$$(sel)).slice(0, 6); let worst = null; for (const h of els) { if (!(await h.isVisible())) continue; const c = await contrastOf(page, h); if (c && (!worst || c.ratio < worst.ratio)) worst = c; }
        if (!worst) { check(`${s.id} ${theme}: ${name}`, false, `nothing matches ${sel}`); continue; }
        const large = worst.size >= 24 || (worst.size >= 18.66 && worst.weight >= 700), need = large ? Math.min(bar, 3) : bar;
        check(`${s.id} ${theme}: ${name} ≥ ${need}:1`, worst.ratio >= need, `${worst.ratio.toFixed(2)}:1 «${worst.text}» ${worst.size}px`);
      } catch (e) { check(`${s.id} ${theme}: ${name}`, false, String(e.message).slice(0, 160)); } }
    await ctx.close(); }
} finally { await browser.close(); server.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(results, null, 1));
console.log(`\n${pass}/${total} checks`);
process.exit(pass === total ? 0 : 1);
