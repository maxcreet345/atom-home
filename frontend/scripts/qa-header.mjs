// The home page's header tools in one run, in the shared card preview (its host records every command and reaches nothing): who is home,
// the language, the settings — layout on every device and orientation in both themes and three languages, accessibility (axe), console
// errors, every state of the people, every control by pointer and keyboard, and no command sent anywhere.
// usage: node scripts/qa-header.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/header'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = (p => p === 5060 || p === 5061 ? 5062 : p)(4800 + Math.floor(Math.random() * 400)); // Chrome refuses 5060/5061 (SIP)
const server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 260)}`); };
const stop = code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 200) + ' @ ' + String(e?.stack ?? '').split('\n').filter(l => l.includes('qa-header')).slice(0, 2).join(' ')); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [768, 1024, 'open'], [1024, 768, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd'], [1280, 720, 'tv'], [320, 640, 'small']];
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'mixed' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=header&scenario=${scenario}&theme=${theme}&lang=${lang}#home`); await page.waitForFunction(() => window.ready); await page.waitForSelector('.hm-head');
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))); await page.waitForTimeout(150);
  return { page, ctx, errors };
}
const runAxe = async (page, scope) => { await page.addScriptTag({ content: axe }); return page.evaluate(async sc => { const r = await window.axe.run(document.querySelector(sc), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'], rules: { region: { enabled: false } } }); return r.violations.filter(v => ['critical', 'serious'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ').slice(0, 120)}`); }, scope); };
const small = page => page.evaluate(() => [...document.querySelectorAll('.at-head-tools button')].filter(b => b.offsetWidth && (b.offsetHeight < 44 || b.offsetWidth < 44)).map(b => `${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 18)} ${b.offsetWidth}x${b.offsetHeight}`));
const commands = page => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').length);
const edges = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(), w = document.documentElement.clientWidth; return r.left >= 11.5 && r.right <= w - 11.5; }, sel);
const inView = (page, sel) => page.evaluate(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }, sel);
// 1. every device × both themes, the header closed and each menu open
for (const theme of ['light', 'dark']) for (const [w, h, dev] of DEVICES) {
  const { page, ctx, errors } = await open({ w, h, theme }), tag = `${dev}/${theme}`;
  const l = await layout(page, '.hm-head'); check(`layout ${tag}`, !l.length, l);
  const s = await small(page); check(`targets ${tag}`, !s.length, s);
  const head = await page.evaluate(() => { const h = document.querySelector('.hm-head').getBoundingClientRect(), t = document.querySelector('.at-head-tools').getBoundingClientRect(), title = document.querySelector('.hm-head-title').getBoundingClientRect(); return { overlap: t.top < title.bottom - 1 && t.left < title.right - 1 && t.right > title.left && t.bottom > title.top, h: h.height }; });
  check(`tools never over the title ${tag}`, !head.overlap, head);
  const geo = await page.evaluate(() => { const q = s => document.querySelector(s).getBoundingClientRect(), h1 = document.querySelector('.hm-head h1'), cs = getComputedStyle(h1), t = q('.hm-head-title'), p = document.querySelector('.hm-head p'), btn = q('.at-people-btn'), pill = q('.at-head-pill');
    return { title: Math.round(t.width), h1: Math.round(q('.hm-head h1').height), wrap: cs.textWrapMode ?? cs.whiteSpace, p: p ? Math.round(p.getBoundingClientRect().height) : 0, row: Math.abs((btn.top + btn.bottom) / 2 - (pill.top + pill.bottom) / 2) < 4, toolsH: Math.round(q('.at-head-tools').height) }; });
  check(`the title keeps its room ${tag}`, geo.title >= 200 && geo.h1 < 40 && /nowrap/.test(geo.wrap) && geo.p <= 44, geo);
  check(`the tools on one row ${tag}`, geo.row && geo.toolsH <= 56, geo);
  await page.click('.at-people-btn'); await page.waitForSelector('.at-people-menu'); await page.waitForTimeout(250);
  check(`people list on screen ${tag}`, await inView(page, '.at-people-menu')); check(`people list 12 px from the edges ${tag}`, await edges(page, '.at-people-menu'), await page.evaluate(() => document.querySelector('.at-people-menu').getBoundingClientRect().left)); const lp = await layout(page, '.at-people-menu'); check(`people list layout ${tag}`, !lp.length, lp);
  check(`people list above the tiles ${tag}`, await page.evaluate(() => { const r = document.querySelector('.at-people-menu').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height - 4, 60); return !!document.elementFromPoint(x, y)?.closest('.at-people-menu'); }));
  if (['13R', 'pad', 'phone-land'].includes(dev)) { const a = await runAxe(page, '.hm-head'); check(`axe people open ${tag}`, !a.length, a); }
  if (['13R', 'pad'].includes(dev)) await page.screenshot({ path: `${out}/${dev}-${theme}-people.png` });
  await page.keyboard.press('Escape'); await page.click('.at-lang .at-pill-btn'); await page.waitForSelector('.at-lang-menu'); await page.waitForTimeout(250);
  check(`language menu on screen ${tag}`, await inView(page, '.at-lang-menu')); check(`language menu 12 px from the edges ${tag}`, await edges(page, '.at-lang-menu'), await page.evaluate(() => document.querySelector('.at-lang-menu').getBoundingClientRect().left));
  check(`language menu above the tiles ${tag}`, await page.evaluate(() => { const r = document.querySelector('.at-lang-menu').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.at-lang-menu'); }));
  if (['13R', 'pad'].includes(dev)) { const a = await runAxe(page, '.hm-head'); check(`axe language open ${tag}`, !a.length, a); await page.screenshot({ path: `${out}/${dev}-${theme}-lang.png` }); }
  check(`errors ${tag}`, !errors.length, errors); check(`no command ${tag}`, (await commands(page)) === 0); await ctx.close();
}
// 2. every state of the people, three languages, on the kiosk and the smallest phone
const SUM = { allHome: /все дома|everyone home|toți acasă/, nobody: /никого нет|nobody home|nimeni acasă/, mixed: /1 дома|1 home|1 acasă/, allUnknown: /^(нет данных|unknown|fără date)$/ };
for (const scenario of ['allHome', 'mixed', 'nobody', 'unknown', 'allUnknown', 'long', 'single', 'none']) for (const lang of ['ru', 'en', 'ro']) for (const [w, h, dev] of [[1070, 764, 'pad'], [360, 792, '13R']]) {
  const { page, ctx, errors } = await open({ w, h, lang, scenario }), tag = `${scenario}/${lang}/${dev}`;
  const l = await layout(page, '.hm-head'); check(`layout ${tag}`, !l.length, l); check(`errors ${tag}`, !errors.length, errors);
  const count = await page.locator('.at-people-btn').count();
  if (scenario === 'none') check(`no people, no button ${tag}`, count === 0);
  else {
    check(`people button ${tag}`, count === 1);
    if (dev === '13R' && SUM[scenario]) check(`summary ${tag}`, SUM[scenario].test(await page.locator('.at-people-sum').textContent()), await page.locator('.at-people-sum').textContent());
    const name = await page.locator('.at-people-btn').getAttribute('aria-label'); check(`the button names everyone and where ${tag}`, /Ararat/.test(name) && (scenario === 'single' || /Gayane|Gayane-Anahit/.test(name)), name);
    const norm = x => x.replace(/,/g, ' ').replace(/\s+/g, ' ').trim(), shown = sel => page.evaluate(q => { const walk = n => n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !n.matches('[aria-hidden="true"]') ? [...n.childNodes].map(walk).join(' ') : ''; return walk(document.querySelector(q)); }, sel), seen = norm(await shown('.at-people-btn')); // the decorative initials are not part of the label
    check(`the button's name starts with what it shows ${tag}`, norm(name).startsWith(seen), { seen, name });
    if (await page.locator('.at-lang .at-pill-btn').count()) { const ln = await page.locator('.at-lang .at-pill-btn').getAttribute('aria-label'), lv = norm(await shown('.at-lang .at-pill-btn')); check(`the language button's name starts with what it shows ${tag}`, norm(ln).startsWith(lv), { lv, ln }); }
    const tap = async () => { try { await page.click('.at-people-btn', { timeout: 8000 }); return true; } catch (e) { check(`people button takes a tap ${tag}`, false, String(e.message).split('\n').slice(0, 4).join(' ')); return false; } };
    if (scenario === 'mixed' && await tap()) { const txt = await page.locator('.at-people-menu').innerText(); check(`zone and away named ${tag}`, /Traian/.test(txt) && /(не дома|away|plecat)/.test(txt), txt); }
    if (scenario === 'unknown' && await tap()) { const txt = await page.locator('.at-people-menu').innerText(); check(`unknown said so, no time ${tag}`, /(нет данных|unknown|fără date)/.test(txt), txt); }
  }
  await page.screenshot({ path: `${out}/state-${tag.replace(/\//g, '-')}.png` }); await ctx.close();
}
// 3. the controls
{ const { page, ctx } = await open();
  await page.click('.at-people-btn'); check('people: aria-expanded true', await page.locator('.at-people-btn').getAttribute('aria-expanded') === 'true');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150); check('Esc closes the people list', await page.locator('.at-people-menu').count() === 0);
  check('Esc gives focus back to the button', await page.evaluate(() => document.activeElement?.classList.contains('at-people-btn')));
  await page.click('.at-people-btn'); { const r = await page.locator('.hm-head-title h1').boundingBox(); await page.mouse.click(r.x + 10, r.y + r.height / 2); } check('a tap outside closes the people list', await page.locator('.at-people-menu').count() === 0);
  await page.click('.at-people-btn'); await page.click('.at-lang .at-pill-btn'); check('opening the language menu closes the people list', await page.locator('.at-people-menu').count() === 0 && await page.locator('.at-lang-menu').count() === 1);
  check('the current language is checked', await page.locator('.at-lang-menu [aria-pressed="true"]').innerText().then(t => /Русский/.test(t)));
  await page.click('.at-lang-menu button:has-text("English")'); await page.waitForTimeout(400);
  check('English: the page speaks English', /Good (morning|afternoon|evening|night)|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/.test(await page.locator('.hm-head p').innerText()), await page.locator('.hm-head p').innerText());
  check('English: saved in the house config', await page.evaluate(async () => (await window.atomPreview.store.load()).config.home.language === 'en'));
  check('English: the pill shows EN', /EN/.test(await page.locator('.at-lang .at-pill-btn').innerText()));
  await page.click('.at-lang .at-pill-btn'); await page.click('.at-lang-menu button:has-text("Română")'); await page.waitForTimeout(400);
  check('Română: the page speaks Romanian', /Bună|luni|marți|miercuri|joi|vineri|sâmbătă|duminică/i.test(await page.locator('.hm-head p').innerText()), await page.locator('.hm-head p').innerText());
  await page.click('.at-lang .at-pill-btn'); await page.click('.at-lang-menu button:has-text("Русский")'); await page.waitForTimeout(400);
  await page.click('.at-pill-btn.is-icon'); await page.waitForTimeout(400); check('settings: opens Настройка', /setup/.test(page.url()), page.url());
  check('no command after every control', (await commands(page)) === 0); await ctx.close(); }
{ const { page, ctx } = await open(); // keyboard only
  await page.focus('.at-people-btn'); await page.keyboard.press('Enter'); check('keyboard: Enter opens the people list', await page.locator('.at-people-menu').count() === 1); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); check('keyboard: Tab reaches the language', await page.evaluate(() => document.activeElement?.closest('.at-lang') !== null));
  await page.keyboard.press('Enter'); check('keyboard: Enter opens the language menu', await page.locator('.at-lang-menu').count() === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150); check('keyboard: Esc closes the language menu', await page.locator('.at-lang-menu').count() === 0); check('keyboard: focus back on the language button', await page.evaluate(() => document.activeElement?.closest('.at-lang') !== null), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle); check('keyboard: focus ring drawn', ring !== 'none', ring); await ctx.close(); }
{ const { page, ctx } = await open({ w: 1070, h: 764 }); // the rest of the home face did not move
  const tiles = await page.evaluate(() => document.querySelector('.hm-page')?.getBoundingClientRect().top); check('the tiles start below the header', tiles > 60, tiles); await ctx.close(); }
// 4. a tap outside a menu only closes it: the tile underneath is not pressed (the «Свет выкл.» scene sends homeassistant.turn_off)
const sceneAt = page => page.evaluate(() => { const b = [...document.querySelectorAll('.ah-scene strong')].find(s => /Свет выкл/.test(s.innerText))?.closest('button'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(), m = document.querySelector('.at-menu')?.getBoundingClientRect();
  for (const [fx, fy] of [[.5, .5], [.15, .8], [.85, .8], [.15, .2], [.85, .2]]) { const x = r.left + r.width * fx, y = r.top + r.height * fy; if (!m || x < m.left || x > m.right || y < m.top || y > m.bottom) return { x, y }; } return null; });
for (const [w, h, dev] of [[1070, 764, 'pad'], [360, 792, '13R'], [1440, 900, 'mac']]) for (const [btn, menu] of [['.at-people-btn', '.at-people-menu'], ['.at-lang .at-pill-btn', '.at-lang-menu']]) {
  const { page, ctx, errors } = await open({ w, h }), tag = `${dev} ${menu}`;
  await page.evaluate(() => [...document.querySelectorAll('.ah-scene strong')].find(s => /Свет выкл/.test(s.innerText))?.closest('button').scrollIntoView({ block: 'center' })); await page.waitForTimeout(100);
  await page.click(btn); await page.waitForSelector(menu); await page.waitForTimeout(250); const at = await sceneAt(page);
  check(`the scene tile is on screen beside the open menu ${tag}`, !!at, at);
  if (at) { if (w < 1100) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y); await page.waitForTimeout(400); }
  check(`a tap outside closes the menu ${tag}`, await page.locator(menu).count() === 0);
  check(`a tap outside presses nothing underneath ${tag}`, (await commands(page)) === 0 && await page.locator('.hm-confirm, .hm-sheet').count() === 0, await page.evaluate(() => window.atomPreview.host.log.slice(-2)));
  if (at) { if (w < 1100) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y); await page.waitForTimeout(400); check(`with the menu closed the same tap presses the scene ${tag}`, (await commands(page)) === 1); }
  check(`errors ${tag}`, !errors.length, errors); await ctx.close();
}
// 5. keyboard: one menu at a time, Tab out closes, a sheet over the page takes Escape, focus after a pick
{ const { page, ctx } = await open();
  await page.focus('.at-people-btn'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  check('keyboard: the language menu closes the people list', await page.locator('.at-people-menu').count() === 0 && await page.locator('.at-lang-menu').count() === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150); check('keyboard: Esc closes the language menu, nothing stays open', await page.locator('.at-menu').count() === 0 && await page.evaluate(() => document.activeElement?.closest('.at-lang') !== null));
  await page.focus('.at-people-btn'); await page.keyboard.press('Enter'); for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  check('keyboard: Tab past the people list closes it', await page.locator('.at-people-menu').count() === 0);
  await page.focus('.at-lang .at-pill-btn'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  check('keyboard: Tab moves through the language items', await page.evaluate(() => document.activeElement?.closest('.at-lang-menu') !== null));
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  check('keyboard: after a pick focus is back on the language button', await page.evaluate(() => document.activeElement?.matches('.at-lang .at-pill-btn')), await page.evaluate(() => document.activeElement?.tagName));
  check('the header uses no menu or dialog roles it does not implement', await page.evaluate(() => !document.querySelector('.at-head-tools [role="menu"], .at-head-tools [role="menuitemradio"], .at-head-tools [role="dialog"], .at-head-tools [aria-haspopup]')));
  await page.click('.at-people-btn'); check('the people button controls its list', await page.evaluate(() => { const id = document.querySelector('.at-people-btn').getAttribute('aria-controls'); return !!id && !!document.getElementById(id)?.classList.contains('at-people-menu'); }));
  await page.evaluate(() => { location.hash = '#home?device=air'; }); await page.waitForSelector('.hm-sheet'); await page.waitForTimeout(300);
  check('a sheet over the page closes the people list', await page.locator('.at-people-menu').count() === 0);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); check('Esc then closes the sheet on top', await page.locator('.hm-sheet').count() === 0);
  await page.click('.at-lang .at-pill-btn'); check('the language names carry their own language', await page.locator('.at-lang-menu span[lang="ro"]').count() === 1 && await page.locator('.at-lang-menu span[lang="en"]').count() === 1);
  await ctx.close(); }
// 6. a language save that fails: the toast, the pill back on RU, no unhandled rejection; two quick picks end where the house config is.
// The saves are chained like ha-store's (`queue.then(run, run)`): the older one always settles first, as on the real panel.
{ const { page, ctx, errors } = await open();
  await page.evaluate(() => window.atomPreview.store.failNext('failed')); await page.click('.at-lang .at-pill-btn'); await page.click('.at-lang-menu button:has-text("English")'); await page.waitForTimeout(600);
  check('failed save: the pill is back on RU', /RU/.test(await page.locator('.at-lang .at-pill-btn').innerText()));
  check('failed save: the panel says so', await page.locator('.hm-toast').count() > 0);
  check('failed save: no unhandled rejection', !errors.length, errors);
  await ctx.close(); }
const serialSaves = (page, failing) => page.evaluate(f => { const st = window.atomPreview.store, save = st.save.bind(st); let n = 0, q = Promise.resolve();
  st.save = c => { const i = n++; const job = async () => { await new Promise(r => setTimeout(r, i === 0 ? 800 : 200)); if (i === f) st.failNext('failed'); return save(c); }; const p = q.then(job, job); q = p.catch(() => {}); return p; }; }, failing);
const twoPicks = async page => { await page.click('.at-lang .at-pill-btn'); await page.click('.at-lang-menu button:has-text("English")'); await page.waitForTimeout(150);
  await page.click('.at-lang .at-pill-btn'); await page.click('.at-lang-menu button:has-text("Română")'); await page.waitForTimeout(1800);
  return page.evaluate(async () => ({ pill: document.querySelector('.at-lang .at-pill-btn').innerText.trim(), stored: (await window.atomPreview.store.load()).config.home.language, toasts: document.querySelectorAll('.hm-toast').length })); };
{ const { page, ctx, errors } = await open(); await serialSaves(page, 0); const end = await twoPicks(page); // the first fails, the queued second succeeds
  check('two quick picks, the first fails: the panel shows what the house config holds', end.stored === 'ro' && end.pill.toLowerCase().includes(end.stored), end);
  check('two quick picks, the first fails: no message, the newer pick won', end.toasts === 0, end); check('two quick picks, the first fails: no error', !errors.length, errors); await ctx.close(); }
{ const { page, ctx, errors } = await open(); await serialSaves(page, 1); const end = await twoPicks(page); // the first succeeds, the second fails
  check('two quick picks, the second fails: the pill goes back to the first pick', end.stored === 'en' && end.pill.toLowerCase().includes('en'), end);
  check('two quick picks, the second fails: exactly one message', end.toasts === 1, end); check('two quick picks, the second fails: no error', !errors.length, errors); await ctx.close(); }
// 7. a photo that failed stays with its person when the order changes
{ const { page, ctx } = await open();
  const chips = () => page.evaluate(() => [...document.querySelectorAll('.at-person-chip')].map(c => `${c.querySelector('b:not(.at-person-ava b)')?.innerText ?? c.innerText.split('\n')[0]}:${c.querySelector('img') ? 'photo' : 'initials'}`));
  await page.evaluate(() => { const img = [...document.querySelectorAll('.at-person-chip')].find(c => /Ararat/.test(c.innerText)).querySelector('img'); img.dispatchEvent(new Event('error')); }); await page.waitForTimeout(150);
  await page.evaluate(() => window.atomPreview.setStates({ 'person.ararat': 'not_home', 'person.daniela': 'home' })); await page.waitForTimeout(300);
  const c = await chips(); check('after a reorder Daniela keeps her photo and Ararat his initials', c.some(x => /Daniela:photo/.test(x)) && c.some(x => /Ararat:initials/.test(x)), c);
  await ctx.close(); }
// 8. the look: no sticky hover on touch, readable initials, no stray dots in the stack, no dark band round the photos
{ const { page, ctx } = await open({ w: 360, h: 792, scenario: 'allHome' });
  const hover = await page.evaluate(() => { const bad = []; const walk = (rules, inHover) => { for (const r of rules) { if (r.media) walk(r.cssRules, inHover || /hover:\s*hover/.test(r.media.mediaText)); else if (r.selectorText && /\.(at-people|at-person|at-pill|at-lang|at-head|at-menu)[\w-]*[^,]*:hover/.test(r.selectorText) && !inHover) bad.push(r.selectorText.slice(0, 80)); } }; for (const sh of document.styleSheets) { try { walk(sh.cssRules, false); } catch { /* cross-origin */ } } return bad; });
  check('header hover styles only where there is a mouse', !hover.length, hover);
  const look = await page.evaluate(() => { const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
    const avas = [...document.querySelectorAll('.at-person-ava')].filter(a => a.querySelector('b'));
    const worst = Math.min(...avas.map(a => Math.min(...[...getComputedStyle(a).backgroundImage.matchAll(/rgba?\((\d+), (\d+), (\d+)/g)].map(m => 1.05 / (lum([+m[1], +m[2], +m[3]]) + .05)))));
    const size = Math.min(...avas.map(a => parseFloat(getComputedStyle(a.querySelector('b')).fontSize)));
    const stack = [...document.querySelectorAll('.at-people-stack .at-person-ava')], dots = stack.map(a => getComputedStyle(a.querySelector('i')).display !== 'none');
    const ava = getComputedStyle(stack[0]); return { worst: Math.round(worst * 100) / 100, size, n: avas.length, dots, shadow: ava.boxShadow, outline: ava.outlineStyle, gap: parseFloat(getComputedStyle(document.querySelector('.at-people-stack')).marginRight) }; });
  check('initials: white on the avatar at least 4.5:1, at least 12 px', look.n === 0 || (look.worst >= 4.5 && look.size >= 12), look);
  check('stack: only the last avatar shows its dot, a gap before the summary', look.dots.slice(0, -1).every(d => !d) && look.dots.at(-1) && look.gap >= 4, look);
  check('avatar ring with a clear gap, no band in the sheet colour', look.shadow === 'none' && look.outline === 'solid', look);
  await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'nobody' }); // away, without a photo: the disc itself is dimmed
  const bg = await page.evaluate(() => [...document.querySelectorAll('.at-person-ava.is-away, .at-person-ava.is-zone')].filter(a => a.querySelector('b')).map(a => `${a.className}|${getComputedStyle(a).backgroundImage}`));
  check('an away person without a photo is grey, not purple', bg.length > 0 && bg.filter(x => /is-away/.test(x)).every(x => !/125, 119, 232/.test(x)), bg); await ctx.close(); }
// 9. the narrow phones in every language: the tools on one row, the open people list never covers the pill
for (const lang of ['ru', 'en', 'ro']) for (const scenario of ['allHome', 'mixed', 'long', 'allUnknown']) for (const [w, h] of [[320, 640], [360, 792], [375, 812]]) {
  const { page, ctx } = await open({ w, h, lang, scenario }), tag = `${scenario}/${lang}/${w}`;
  const g = await page.evaluate(() => { const b = document.querySelector('.at-people-btn').getBoundingClientRect(), p = document.querySelector('.at-head-pill').getBoundingClientRect(); return { row: Math.abs(b.top - p.top) < 4, right: Math.round(p.right), w: innerWidth, h: Math.round(document.querySelector('.at-head-tools').getBoundingClientRect().height) }; });
  check(`one row of tools ${tag}`, g.row && g.h <= 56 && g.right <= g.w - 12, g);
  await page.click('.at-people-btn'); await page.waitForTimeout(250);
  check(`the open people list leaves the pill free ${tag}`, await page.evaluate(() => { const r = document.querySelector('.at-head-pill').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.at-head-pill'); }));
  await ctx.close();
}
// 10. a tap on plain text inside the open list (a name, a status, the title) keeps it open: focus going to the page is not leaving it
for (const [w, h, dev] of [[1070, 764, 'pad'], [360, 792, '13R']]) {
  const { page, ctx, errors } = await open({ w, h }), tag = `${dev}`, tapOn = async sel => { const r = await page.locator(sel).first().boundingBox(); await page.touchscreen.tap(r.x + Math.min(r.width / 2, 20), r.y + r.height / 2); await page.waitForTimeout(250); };
  await page.locator('.at-people-btn').tap(); await page.waitForSelector('.at-people-menu');
  for (const [sel, what] of [['.at-person-row b', 'a name'], ['.at-person-row small', 'a status'], ['.at-menu-title', 'the title'], ['.at-person-row .at-person-ava', 'a photo']]) { await tapOn(sel); const kept = await page.locator('.at-people-menu').count() === 1; check(`a tap on ${what} keeps the people list open ${tag}`, kept, await page.evaluate(() => document.activeElement?.className)); if (!kept) { await page.locator('.at-people-btn').tap(); await page.waitForSelector('.at-people-menu'); } }
  check(`taps inside the list send nothing ${tag}`, (await commands(page)) === 0 && !errors.length, errors); await ctx.close();
}
// 11. with a menu open a tap on the tab bar or the sidebar only closes the menu; the next tap there switches the page
for (const [w, h, dev, bar] of [[390, 844, 'phone', '.hm-tabbar button'], [1070, 764, 'pad', '.hm-sidebar nav button']]) for (const [btn, menu] of [['.at-people-btn', '.at-people-menu'], ['.at-lang .at-pill-btn', '.at-lang-menu']]) {
  const { page, ctx, errors } = await open({ w, h }), tag = `${dev} ${menu}`, tapBar = async () => { const r = await page.locator(bar).nth(1).boundingBox(); await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await page.waitForTimeout(400); };
  await page.locator(btn).tap(); await page.waitForSelector(menu); await page.waitForTimeout(250); await tapBar();
  check(`a tap on the ${dev === 'phone' ? 'tab bar' : 'sidebar'} with the menu open only closes it ${tag}`, await page.locator(menu).count() === 0 && await page.evaluate(() => location.hash) === '#home', await page.evaluate(() => location.hash));
  await tapBar(); check(`with the menu closed the same tap switches the page ${tag}`, await page.evaluate(() => location.hash) !== '#home', await page.evaluate(() => location.hash));
  check(`no command, no error ${tag}`, (await commands(page)) === 0 && !errors.length, errors); await ctx.close();
}
// 12. little room below the header (the 13r's Chrome on its side): the menus end 12 px above the bottom and scroll inside to the last item
for (const [w, h] of [[792, 264], [791, 360], [792, 360]]) for (const [btn, menu, last] of [['.at-people-btn', '.at-people-menu', '.at-person-row'], ['.at-lang .at-pill-btn', '.at-lang-menu', '.at-lang-menu button']]) {
  const { page, ctx, errors } = await open({ w, h }), tag = `${w}x${h} ${menu}`;
  await page.locator(btn).tap(); await page.waitForSelector(menu); await page.waitForTimeout(300);
  const m = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; }, menu);
  check(`the menu ends 12 px above the bottom ${tag}`, m.bottom <= m.vh - 12 + 0.5, m);
  const r = await page.locator(menu).boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.wheel(0, 600); await page.waitForTimeout(300);
  const end = await page.evaluate(([s, l]) => { const mr = document.querySelector(s).getBoundingClientRect(), lr = [...document.querySelectorAll(l)].at(-1).getBoundingClientRect(); return { last: [Math.round(lr.top), Math.round(lr.bottom)], menu: [Math.round(mr.top), Math.round(mr.bottom)], page: document.querySelector('.hm-main').scrollTop }; }, [menu, last]);
  check(`the last item is reached by scrolling inside the menu ${tag}`, end.last[1] <= end.menu[1] + 1 && end.last[0] >= end.menu[0] - 1, end);
  check(`errors ${tag}`, !errors.length, errors); await ctx.close();
}
await browser.close(); stop(fails.length ? 1 : 0);
