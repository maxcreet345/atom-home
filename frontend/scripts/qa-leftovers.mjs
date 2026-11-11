// 1.26.1 — the five small things found while building 1.26.0, each on the previews and each failing on 1.26.0:
//  1. the vacuum's «Не беспокоить» times in a 12-hour browser: «10:00 PM» whole in every field (the one row used to keep a 112 px field that cut it);
//  2. the vacuum's consumables on a 320 px phone at 200 % text: names, numbers and bars stay inside their card (they ran past its right edge);
//  3. a sheet's title at 200 % on a phone: a long word is hyphenated by the panel's language («Термо-метр»), not cut anywhere («Термоме / тр»);
//  4. a refused «Добавить кнопку» on a phone: the message is said where it does not cover the button, so the retry is one tap;
//  5. the C700's sheet: the room is said once — «Камера» over «Компьютерная · Камера (C700)», never «Камера · Компьютерная» over it.
// usage: node scripts/qa-leftovers.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/leftovers'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const fails = []; let passed = 0, browser = null; const servers = [];
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 400)}`); };
const stop = async code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); for (const s of servers) s.kill(); await browser?.close().catch(() => undefined); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); void stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); void stop(1); });
const serve = async script => { const port = await freePort(), p = spawn(process.execPath, [resolve(root, 'scripts', script), String(port)], { stdio: 'pipe' }); servers.push(p); await new Promise(r => p.stdout.once('data', r)); return `http://127.0.0.1:${port}`; };
const panel = await serve('preview-server.mjs'), cards = await serve('card-preview.mjs');
browser = await chromium.launch();
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
async function open(url, { w, h, locale = 'ru-RU', font = '100%' }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, locale, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });
  await page.goto(url); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 }); await page.evaluate(f => { document.documentElement.style.fontSize = f; }, font); await page.waitForTimeout(600);
  return { ctx, page, errors };
}

// 1. «10:00 PM» whole: every time field is at least as wide as its own text and picker, and stays inside its card
for (const [w, h, theme] of [[1070, 764, 'light'], [764, 1070, 'dark'], [402, 874, 'light'], [1920, 1080, 'dark']]) {
  const tag = `${w}x${h} en-US ${theme}`, { ctx, page, errors } = await open(`${cards}/?card=vacuum&scenario=docked&theme=${theme}&lang=en#cleaning?filter=settings`, { w, h, locale: 'en-US' });
  await page.evaluate(() => document.querySelector('.at-vac-times')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
  const m = await page.evaluate(() => [...document.querySelectorAll('.at-vac-times input')].map(i => { const r = i.getBoundingClientRect(), card = i.closest('.at-vac-card').getBoundingClientRect(), was = i.style.cssText; i.style.width = 'max-content'; i.style.minWidth = '0'; const need = i.getBoundingClientRect().width; i.style.cssText = was;
    return { has: Math.round(r.width), need: Math.round(need), inside: r.left >= card.left - 1 && r.right <= card.right + 1, tall: r.height >= 44 }; }));
  check(`1 ${tag}: every time field shows its whole 12-hour time (at least as wide as «10:00 PM» and its picker), ≥ 44 px tall, inside its card`, m.length >= 2 && m.every(x => x.has + 1 >= x.need && x.inside && x.tall), m);
  if (w === 1070) await page.locator('.at-vac-times').first().screenshot({ path: resolve(out, `1-times-${w}.png`) });
  check(`1 errors ${tag}`, !errors.length, errors); await ctx.close();
}
{ // the owner's own 24-hour Russian panel keeps its one row of «с [22:00] — до [08:00]» on a tablet, as in 1.25.7
  const { ctx, page } = await open(`${cards}/?card=vacuum&scenario=docked&theme=light&lang=ru#cleaning?filter=settings`, { w: 1070, h: 764 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.at-vac-times')].map(t => { const i = [...t.querySelectorAll('input')].map(x => x.getBoundingClientRect()); return i.length === 2 && Math.abs(i[0].top - i[1].top) < 2 && Math.round(i[0].width) === 112; }));
  check('1 1070 ru-RU: the 24-hour row stays one row with the classic 112 px fields', rows.length >= 1 && rows.every(Boolean), rows); await ctx.close();
}

// 2. the consumables stay inside their card on a narrow phone at a large text size
for (const [w, h, font] of [[320, 568, '200%'], [360, 792, '200%'], [320, 568, '150%'], [320, 568, '100%'], [1070, 764, '100%']]) {
  const tag = `${w}x${h} ${font}`, { ctx, page, errors } = await open(`${cards}/?card=vacuum&scenario=docked&theme=light&lang=ru#cleaning?filter=settings`, { w, h, font });
  await page.evaluate(() => document.querySelector('.at-vac-parts')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
  const m = await page.evaluate(() => { const p = document.querySelector('.at-vac-parts'); if (!p) return null; const sec = (p.closest('.at-vac-sec') ?? p.parentElement).getBoundingClientRect();
    const out = [...p.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > sec.right + 1 || r.left < sec.left - 1); }).slice(0, 4).map(e => `${e.tagName.toLowerCase()}.${e.className} «${(e.textContent || '').trim().slice(0, 20)}»`);
    return { out, grid: [p.scrollWidth, p.clientWidth], page: [document.scrollingElement.scrollWidth, innerWidth], parts: p.children.length }; });
  check(`2 ${tag}: every name, number and bar of the consumables is inside its card; the page does not pan sideways`, !!m && m.parts > 0 && m.out.length === 0 && m.grid[0] <= m.grid[1] + 1 && m.page[0] <= m.page[1] + 1, m);
  if (w === 320 && font === '200%') await page.locator('.at-vac-parts').first().screenshot({ path: resolve(out, '2-parts-320-200.png') });
  check(`2 errors ${tag}`, !errors.length, errors); await ctx.close();
}

// 3. a sheet's title at 200 %: hyphenated by the panel's language, never cut at any letter; it stays inside its head
for (const [w, h, theme] of [[360, 792, 'light'], [320, 568, 'dark']]) {
  const tag = `${w}x${h} ${theme}`, { ctx, page, errors } = await open(`${panel}/?theme=${theme}#systems?filter=devices`, { w, h, font: '200%' });
  const more = page.locator('.ah-tile-more'), n = await more.count(), seen = [];
  for (let i = 0; i < Math.min(n, 6); i++) {
    await more.nth(i).scrollIntoViewIfNeeded(); await more.nth(i).click(); await page.waitForTimeout(400);
    seen.push(await page.evaluate(() => { const h2 = document.querySelector('.hm-sheet .hm-sheet-head h2'); if (!h2) return null; const cs = getComputedStyle(h2), lang = h2.closest('[lang]')?.getAttribute('lang') ?? '';
      return { text: h2.textContent.trim().slice(0, 30), hyphens: cs.hyphens || cs.webkitHyphens, wrap: cs.overflowWrap, lang, inside: h2.scrollWidth <= h2.clientWidth + 1 }; }));
    if (i === 0) await page.locator('.hm-sheet .hm-sheet-head').first().screenshot({ path: resolve(out, `3-head-${w}-${theme}.png`) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  const heads = seen.filter(Boolean);
  check(`3 ${tag}: every sheet title is hyphenated by the panel's language (hyphens: auto under lang="ru", overflow-wrap: break-word — not «anywhere») and fits its head`, heads.length >= 3 && heads.every(x => x.hyphens === 'auto' && x.wrap === 'break-word' && x.lang === 'ru' && x.inside), heads);
  check(`3 errors ${tag}`, !errors.length, errors); await ctx.close();
}

// 4. a refused «Добавить кнопку» on a phone: the message does not cover the button; the retry is one tap on the button itself
{ const { ctx, page, errors } = await open(`${panel}/?theme=light#setup?filter=buttons`, { w: 360, h: 792 });
  const cfg = () => page.evaluate(async () => (await window.atomPreview.store.load()).config?.buttons?.length ?? 0);
  await page.evaluate(() => { const i = document.querySelectorAll('.at-setup-new input[type=text]'), set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; set(i[0], 'Ночник'); set(i[1], 'light.turn_on'); set(i[2], 'light.kitchen'); }); await page.waitForTimeout(150);
  const add = page.locator('.at-setup-new > button.hm-pill.is-primary'), n0 = await cfg();
  // the button where a phone's toast stands: its middle 110 px above the foot of the screen (the toast sits 84 px above it, over the tab bar)
  await add.evaluate(b => { const sc = (() => { let e = b.parentElement; while (e && !(e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e ?? document.scrollingElement; })(); const r = b.getBoundingClientRect(); sc.scrollTop += r.top + r.height / 2 - (innerHeight - 110); }); await page.waitForTimeout(250);
  await page.evaluate(() => { const st = window.atomPreview.store, orig = st.save; st.save = async () => { st.save = orig; throw new Error('preview: refused once'); }; });
  await add.click(); await page.waitForTimeout(700);
  const m = await page.evaluate(() => { const t = document.querySelector('.hm-toast'), b = document.querySelector('.at-setup-new > button.hm-pill.is-primary'); if (!t || !b) return { toast: !!t };
    const a = t.getBoundingClientRect(), c = b.getBoundingClientRect(); return { toast: true, top: t.classList.contains('is-top'), meets: a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom, t: [Math.round(a.top), Math.round(a.bottom)], b: [Math.round(c.top), Math.round(c.bottom)] }; });
  await page.screenshot({ path: resolve(out, '4-refused-add-360.png') });
  check('4 360x792: the refusal is said (a toast) and it does not lie over «Добавить кнопку» — it stands at the top instead', m.toast && m.meets === false && m.top === true, m);
  await add.click(); await page.waitForTimeout(700); const n1 = await cfg();
  check('4 360x792: the retry is one tap on the button itself (nothing to tap away first) — exactly one button is added', n1 === n0 + 1, { n0, n1 });
  check(`4 errors`, !errors.length, errors); await ctx.close();
}

// 5. the C700's sheet: the room is said once
{ const { ctx, page, errors } = await open(`${cards}/?card=cameras&scenario=quiet&theme=dark&lang=ru#home`, { w: 1070, h: 764 });
  const hits = page.locator('.at-cams-hit'), n = await hits.count(), heads = [];
  for (let i = 0; i < n; i++) { await hits.nth(i).click(); await page.waitForTimeout(500);
    heads.push(...await page.evaluate(() => [...document.querySelectorAll('.hm-sheet .hm-sheet-head')].map(h => ({ small: h.querySelector('small')?.textContent?.trim() ?? '', title: h.querySelector('h2')?.textContent?.trim() ?? '' }))));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300); if (!/#home$/.test(page.url())) { await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(300); } }
  const twice = heads.filter(x => { const room = x.small.split(' · ')[1]?.toLowerCase(); const t = x.title.toLowerCase(); return !!room && (t.startsWith(room) || t.endsWith(room)); });
  const c700 = heads.find(x => /C700/.test(x.title));
  check('5 every camera sheet says its room once: never «Камера · <комната>» over a name that starts or ends with that room', heads.length >= 1 && twice.length === 0, { twice, heads: heads.slice(0, 6) });
  check('5 the C700 («Компьютерная · Камера (C700)») is opened and its head says «Камера» alone above it', !!c700 && c700.small === 'Камера', c700 ?? heads.slice(0, 6));
  check('5 errors', !errors.length, errors); await ctx.close();
}
await stop(fails.length ? 1 : 0);
