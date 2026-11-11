// The kettle card and sheet in one run, in the shared card preview (its host records every command and reaches nothing): layout on every
// device and orientation in both themes, accessibility (axe), console errors, touch targets, every scenario, the commands each control sends
// (and only on a tap), the admin settings, three languages.
// usage: node scripts/qa-kettle.mjs [outDir]   exit code 1 on any failure; screenshots in outDir
process.env.TZ = 'Europe/Chisinau';
import { chromium } from '../node_modules/playwright/index.mjs';
import { freePort } from './free-port.mjs';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layout } from './card-checks.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, process.argv[2] ?? 'evidence/kettle'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const axe = await readFile(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8'), port = await freePort();
const server = spawn(process.execPath, [resolve(root, 'scripts/card-preview.mjs'), String(port)], { stdio: 'pipe' }); await new Promise(r => server.stdout.once('data', r));
const origin = `http://127.0.0.1:${port}`, browser = await chromium.launch(), fails = []; let passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else fails.push(`${name}${info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 260)}`); };
const stop = code => { console.log(`${passed} passed, ${fails.length} failed`); for (const f of fails) console.log('✘ ' + f); server.kill(); process.exit(code); };
process.on('uncaughtException', e => { fails.push('script stopped: ' + e.message.slice(0, 300)); stop(1); }); process.on('unhandledRejection', e => { fails.push('script stopped: ' + String(e?.message ?? e).slice(0, 300)); stop(1); });
const DEVICES = [[360, 792, '13R'], [792, 360, '13R-land'], [402, 874, 'phone'], [874, 402, 'phone-land'], [764, 1070, 'pad-port'], [1070, 764, 'pad'], [1024, 768, 'open-land'], [1440, 900, 'mac'], [1920, 1080, 'hd']];
// the camera previews ask for frames the preview does not serve: those 404s are the preview's, not the card's
const noise = t => /Failed to load resource: the server responded with a status of 404/.test(t);
async function open({ w = 1070, h = 764, theme = 'light', lang = 'ru', scenario = 'idle', hash = '#home?device=kettle' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, timezoneId: 'Europe/Chisinau' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !noise(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/?card=kettle&scenario=${scenario}&theme=${theme}&lang=${lang}${hash}`); await page.waitForFunction(() => window.ready);
  await page.waitForSelector(hash.startsWith('#rooms') ? '[data-module-card="kettle"]' : hash === '#home' ? '.ah-face' : '.at-kt-sheet'); await page.waitForTimeout(250);
  return { page, ctx, errors };
}
const runAxe = async (page, scope) => { await page.addScriptTag({ content: axe }); return page.evaluate(async sc => { const r = await window.axe.run(document.querySelector(sc), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }); return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`); }, scope); };
const small = page => page.evaluate(() => [...document.querySelectorAll('.at-kt-sheet button, .at-kt-sheet input')].filter(b => b.offsetWidth && (b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)).map(b => `${(b.getAttribute('aria-label') || b.textContent || b.type).trim().slice(0, 24)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`));
const log = page => page.evaluate(() => window.atomPreview.host.log.map(x => `${x.domain}.${x.service}`));

// 1. every device x both themes: the kettle sheet, its settings (the gear), the home tile
for (const theme of ['light', 'dark']) for (const [w, h, dev] of DEVICES) for (const scenario of ['idle', 'heating', 'keep']) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario }), tag = `${dev}/${theme}/${scenario}`;
  const l = await layout(page, '.at-kt-sheet'); check(`layout ${tag}`, !l.length, l);
  const s = await small(page); check(`targets ${tag}`, !s.length, s);
  if (['13R', 'pad', 'mac'].includes(dev)) { const a = await runAxe(page, '.at-kt-sheet'); check(`axe ${tag}`, !a.length, a); }
  await page.locator('.at-kt-mode-hit').first().click(); await page.waitForTimeout(250);
  const lo = await layout(page, '.at-kt-sheet'); check(`layout open mode ${tag}`, !lo.length, lo);
  await page.locator('.at-kt-gear').click(); await page.waitForTimeout(250);
  check(`gear opens settings ${tag}`, await page.locator('.at-kt-sheet.is-settings').count() === 1);
  const ls = await layout(page, '.at-kt-sheet'); check(`layout settings ${tag}`, !ls.length, ls);
  const ss = await small(page); check(`targets settings ${tag}`, !ss.length, ss);
  if (['13R', 'pad'].includes(dev)) { const a = await runAxe(page, '.at-kt-sheet'); check(`axe settings ${tag}`, !a.length, a); }
  await page.locator('.at-kt-back').click(); await page.waitForTimeout(200);
  check(`back returns ${tag}`, await page.locator('.at-kt-sheet:not(.is-settings)').count() === 1);
  check(`errors ${tag}`, !errors.length, errors); check(`no command ${tag}`, !(await log(page)).some(x => !x.startsWith('ws.')), await log(page)); await ctx.close();
}
for (const theme of ['light', 'dark']) for (const [w, h, dev] of [[360, 792, '13R'], [1070, 764, 'pad'], [1920, 1080, 'hd']]) for (const scenario of ['idle', 'heating', 'offline']) {
  const { page, ctx, errors } = await open({ w, h, theme, scenario, hash: '#rooms?room=kukhnia' }), tag = `kitchen ${dev}/${theme}/${scenario}`;
  const l = await layout(page, '[data-module-card="kettle"]'); check(`layout ${tag}`, !l.length, l);
  const a = await runAxe(page, '[data-module-card="kettle"]'); check(`axe ${tag}`, !a.length, a);
  check(`no «function …» tiles ${tag}`, !(await page.locator('.ah-tile', { hasText: 'function' }).count()));
  check(`errors ${tag}`, !errors.length, errors); await ctx.close();
}
// the owner: on the Kitchen's page, never on the home screen
for (const [w, h, dev] of [[402, 874, 'phone'], [1070, 764, 'pad']]) { const { page, ctx } = await open({ w, h, scenario: 'heating', hash: '#home' }); check(`not on the home screen ${dev}`, await page.locator('[data-module-card="kettle"]').count() === 0); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'idle', hash: '#rooms?room=kukhnia' }); await page.locator('[data-module-card="kettle"] .ah-tile-hit').click(); await page.waitForTimeout(400); check('the Kitchen tile opens the kettle', await page.locator('.at-kt-sheet').count() === 1); await ctx.close(); }
// 2. the commands, only on a tap (MIOT: number + switch); the scenarios in three languages
const calls = page => page.evaluate(() => window.atomPreview.host.log.filter(x => x.domain !== 'ws').map(x => `${x.domain}.${x.service} ${String(x.data.entity_id).replace(/^.*kitchen_kettle_?/, '')}${x.data.value === undefined ? '' : '=' + x.data.value}`));
const sends = async (scenario, steps, label, want) => { const { page, ctx } = await open({ scenario }); await page.evaluate(() => window.atomPreview.host.setAccept(true));
  for (const st of steps) { await page.locator(st).first().click(); await page.waitForTimeout(250); }
  const l = await calls(page); check(`${label}`, JSON.stringify(l) === JSON.stringify(want), l); await ctx.close(); };
// «Вскипятить» and «Нагреть» send the target and the kettle's switch and leave its permanent keep-warm settings alone (audit 2026-11-09: they used to
// switch «keep warm after boiling» off, or rewrite its temperature to «one degree lower»)
await sends('idle', ['.at-kt-mode-hit >> nth=1', '.at-kt-go'], 'boil: the target and the switch, the keep-warm settings untouched', ['number.set_value target_temperature=99', 'switch.turn_on power']);
await sends('boil', ['.at-kt-mode-hit >> nth=1', '.at-kt-go'], 'boil with keep-warm on: its setting is not rewritten', ['number.set_value target_temperature=99', 'switch.turn_on power']);
await sends('boil', ['.at-kt-mode-hit >> nth=0', '.at-kt-chips button >> nth=0', '.at-kt-go'], 'heat to 45 with keep-warm at 60: only the target and the switch', ['number.set_value target_temperature=45', 'switch.turn_on power']);
// a mode with its own keep-warm writes exactly what its row promises, and says that the kettle's setting changes
await sends('idle', ['.at-kt-mode-hit >> nth=2', '.at-kt-go'], 'warm water: target 45, keep 45 (not 44), 24 h, keep-warm on, power on', ['number.set_value target_temperature=45', 'number.set_value keep_warm_temperature=45', 'number.set_value keep_warm_time=1440', 'switch.turn_on auto_keep_warm', 'switch.turn_on power']);
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.locator('.at-kt-mode-hit').nth(2).click(); await page.waitForTimeout(200); const note = await page.locator('.at-kt-note').innerText(); check('warm water: the row says the keep-warm setting will change', /45 °C[\s\S]*45 °C[\s\S]*Настройка поддержания/.test(note), note); await ctx.close(); }
await sends('heating', ['.at-kt-stop'], 'stop presses the kettle\'s stop', ['button.press stop']);
await sends('idle', ['.at-kt-gear', '.at-kt-set .at-kt-sw >> nth=0'], 'settings switch', ['switch.turn_on auto_keep_warm']);
// one tap, one command: three taps in one frame start the mode once, and the sheet is free again afterwards
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); await page.locator('.at-kt-mode-hit').nth(1).click(); await page.waitForTimeout(200);
  await page.evaluate(() => { const b = document.querySelector('.at-kt-go'); b.click(); b.click(); b.click(); }); await page.waitForTimeout(400); const l = await calls(page);
  check('boil: a triple tap starts it once', l.length === 2, l);
  // round 2, l91: the house accepted, the kettle has not answered yet — the button waits (it read «Включить» over «Ожидание», and a tap 0.7 s later sent both commands again)
  const held = await page.evaluate(() => { const b = document.querySelector('.at-kt-go'); return { disabled: b.disabled, busy: b.getAttribute('aria-busy'), text: b.textContent }; });
  await page.waitForTimeout(700); await page.evaluate(() => document.querySelector('.at-kt-go').click()); await page.waitForTimeout(300); const l2 = await calls(page);
  check('l91 kettle: after an accepted start the button waits («Включаю…», busy, disabled) and a tap 0.7 s later sends nothing', held.disabled && held.busy === 'true' && /Включаю/.test(held.text) && l2.length === 2, { held, l2 });
  // the kettle answers: the wait ends at once
  await page.evaluate(() => window.atomPreview.setStates({ 'sensor.kitchen_kettle_status': 'heating', 'switch.kitchen_kettle_power': 'on' })); await page.waitForTimeout(250);
  const seen = await page.evaluate(() => ({ stop: !!document.querySelector('.at-kt-stop') && !document.querySelector('.at-kt-stop').disabled, status: document.querySelector('.at-kt-status')?.textContent ?? '', go: document.querySelector('.at-kt-go')?.disabled ?? null }));
  check('l91 kettle: when the kettle\'s state arrives the wait ends («Стоп» is live)', seen.stop && seen.go !== true, seen); await ctx.close(); }
// …and with no answer at all the busy mark still clears by itself (six seconds)
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); await page.locator('.at-kt-mode-hit').nth(1).click(); await page.waitForTimeout(200); await page.locator('.at-kt-go').click(); await page.waitForTimeout(3000);
  const mid = await page.locator('.at-kt-go').isDisabled(); await page.waitForTimeout(3600); check('the busy mark clears after the command (a kettle that never answers: after 6 s)', mid && await page.locator('.at-kt-go').isEnabled()); await ctx.close(); }
// round 2, l43: with no connection to the house the socket's last figures are not «Сейчас 1 812 Вт»
{ const { page, ctx } = await open({ scenario: 'heating' }); const on = await page.evaluate(() => document.querySelector('.at-kt-energy')?.textContent ?? ''); await page.evaluate(() => window.atomPreview.setOnline(false)); await page.waitForTimeout(200);
  const off = await page.evaluate(() => ({ energy: document.querySelector('.at-kt-energy')?.textContent ?? '', status: document.querySelector('.at-kt-status')?.textContent ?? '', hero: document.querySelector('.at-kt-hero')?.innerText ?? '' }));
  check('l43 kettle: online the hero says the power; offline it says «Нет связи с чайником» and no watts or kWh under it', /1[\s\u00a0]?812/.test(on) && off.status === 'Нет связи с чайником' && off.energy === '' && !/Вт|кВт/.test(off.hero), { on, off }); await ctx.close(); }
// round 2, l44: a switch whose own entity says nothing is not «выкл»; the knob's choice is not «свободно» when the knob is unknown
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.locator('.at-kt-gear').click(); await page.waitForTimeout(200);
  const before = await page.evaluate(() => !!document.querySelector('[data-kettle-switch="dnd"] [role=switch]'));
  await page.evaluate(() => window.atomPreview.setStates({ 'switch.kitchen_kettle_no_disturb': 'unavailable', 'switch.kitchen_kettle_boiling_reminder': 'unknown', 'switch.kitchen_kettle_custom_knob_temp': 'unknown' })); await page.waitForTimeout(200);
  const rows = await page.evaluate(() => { const r = k => { const e = document.querySelector(`[data-kettle-switch="${k}"]`); return { sw: !!e?.querySelector('[role=switch]'), text: e?.innerText ?? '' }; }; return { dnd: r('dnd'), boil: r('boilRemind'), lift: r('liftRemember'), knob: [...document.querySelectorAll('.at-kt-seg [role=radio]')].map(b => `${b.getAttribute('aria-checked')}:${b.disabled}`), knobText: document.querySelector('.at-kt-seg')?.closest('.ah-row')?.innerText ?? '' }; });
  check('l44 kettle: «Не беспокоить» unavailable and a reminder unknown show words, not a switch that reads «выкл»; the others keep their switch', before && !rows.dnd.sw && /Нет связи/.test(rows.dnd.text) && !rows.boil.sw && /Нет данных/.test(rows.boil.text) && rows.lift.sw, rows);
  check('l44 kettle: an unknown knob setting checks neither choice and says «Нет данных»', rows.knob.join(',') === 'false:true,false:true' && /Нет данных/.test(rows.knobText), rows); await ctx.close(); }
// a refusal: in words, never «[object Object]» and never the house's raw English; the sheet is usable again
for (const [name, thrown] of [['an object with a code', { code: 'home_assistant_error', message: 'Kettle is busy' }], ['a bare object', { foo: 1 }], ['an Error', 'error']]) {
  const { page, ctx } = await open({ scenario: 'idle' }); await page.evaluate(th => { window.atomPreview.host.call = async () => { throw th === 'error' ? new Error('invalid_format: expected dict') : th; }; }, thrown);
  await page.locator('.at-kt-mode-hit').nth(1).click(); await page.waitForTimeout(200); await page.locator('.at-kt-go').click(); await page.waitForTimeout(300);
  const text = await page.locator('.at-kt-err').innerText().catch(() => ''); check(`refused (${name}): told in words`, /[а-яё]{4}/i.test(text) && !/\[object|invalid_format|undefined|null/.test(text), text);
  check(`refused (${name}): the button is free again`, await page.locator('.at-kt-go').isEnabled()); await ctx.close(); }
// the house is offline: nothing is sent, and it is said
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.locator('.at-kt-mode-hit').nth(1).click(); await page.waitForTimeout(200); await page.evaluate(() => { const h = window.atomPreview.host; h.setOnline(false); document.querySelector('.at-kt-go').click(); h.setOnline(true); }); await page.waitForTimeout(300);
  const l = await calls(page); check('house offline at the tap: nothing is sent', l.length === 0, l); await ctx.close(); }
// no link to the kettle: no «current» temperature, the modes cannot be opened, the settings show «—» and send nothing
for (const scenario of ['offline', 'offlineBare']) {
  const { page, ctx, errors } = await open({ scenario }); const hero = await page.locator('.at-kt-temp').innerText();
  check(`${scenario}: the last temperature is not shown as current`, hero.trim() === '—', hero);
  check(`${scenario}: every mode row is disabled`, await page.evaluate(() => { const rows = [...document.querySelectorAll('.at-kt-mode-hit')]; return rows.length > 0 && rows.every(b => b.disabled); }));
  check(`${scenario}: no mode is open`, await page.locator('.at-kt-go').count() === 0);
  await page.locator('.at-kt-gear').click(); await page.waitForTimeout(250);
  const st = await page.evaluate(() => ({ value: document.querySelector('.at-kt-set .at-kt-stepper b').textContent, steps: [...document.querySelectorAll('.at-kt-set .at-kt-stepper button')].map(b => b.disabled), chips: document.querySelectorAll('.at-kt-set .at-kt-chips .is-on, .at-kt-set .at-kt-seg .is-on').length }));
  check(`${scenario}: keep-warm temperature is «—», its buttons are disabled, no duration and no knob mode is marked`, st.value === '—' && st.steps.every(Boolean) && st.chips === 0, st);
  await page.evaluate(() => document.querySelectorAll('.at-kt-set button:not(.at-kt-back)').forEach(b => b.click())); await page.waitForTimeout(900);
  const l = await calls(page); check(`${scenario}: nothing is sent`, l.length === 0, l); check(`${scenario}: errors`, !errors.length, errors);
  const all = await page.locator('.at-kt-sheet').innerText(); check(`${scenario}: no invented numbers in the settings`, !/\b0\s*°C|NaN|undefined|null/.test(all), all.slice(0, 200)); await ctx.close();
}
// the kettle is there but has reported nothing yet: an empty value is «—», never 0
{ const { page, ctx, errors } = await open({ scenario: 'bare' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); const text = await page.locator('.at-kt-sheet').innerText();
  check('bare: the water temperature is «—», not 0', (await page.locator('.at-kt-temp').innerText()).trim() === '—'); check('bare: «heat to» falls back to 70, not 0', /до 70 °C/.test(text) && !/до 0 °C/.test(text), text.slice(0, 300));
  await page.locator('.at-kt-mode-hit').nth(1).click(); await page.waitForTimeout(200); await page.locator('.at-kt-go').click(); await page.waitForTimeout(300);
  const l = await calls(page); check('bare: boiling asks for 99, never 0', l[0] === 'number.set_value target_temperature=99', l); check('bare: errors', !errors.length, errors); await ctx.close();
  const tile = await open({ scenario: 'bare', hash: '#rooms?room=kukhnia' }); const tt = await tile.page.locator('[data-module-card="kettle"]').innerText(); check('bare: the tile shows no «0°»', !/\b0°/.test(tt), tt); await tile.ctx.close(); }
// «heat to» is the kettle's own value until the person picks another
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); await page.locator('.at-kt-mode-hit').first().click(); await page.waitForTimeout(200);
  check('heat to: the kettle\'s own 70', (await page.locator('.at-kt-mode-body .at-kt-stepper b').innerText()).replace(/\s/g, '') === '70°C');
  await page.locator('.at-kt-mode-body .at-kt-stepper button').last().click(); await page.waitForTimeout(150); check('heat to: the stepper sends nothing by itself', (await calls(page)).length === 0);
  await page.locator('.at-kt-go').click(); await page.waitForTimeout(300); const l = await calls(page); check('heat to: the chosen 75 goes out', l[0] === 'number.set_value target_temperature=75', l); await ctx.close(); }
// the keep-warm temperature: a burst of taps is one intent and one command with the final value
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); await page.locator('.at-kt-gear').click(); await page.waitForTimeout(250);
  const plus = page.locator('.at-kt-set .at-kt-stepper button').last(); for (let i = 0; i < 4; i++) await plus.click();
  check('keep-warm stepper: the number follows the taps', (await page.locator('.at-kt-set .at-kt-stepper b').innerText()).replace(/\s/g, '') === '60°C', await page.locator('.at-kt-set .at-kt-stepper b').innerText());
  check('keep-warm stepper: nothing goes out while the taps continue', (await calls(page)).length === 0, await calls(page)); await page.waitForTimeout(1100);
  const l = await calls(page); check('keep-warm stepper: four taps, one command with the final value', JSON.stringify(l) === JSON.stringify(['number.set_value keep_warm_temperature=60']), l); await ctx.close(); }
{ const { page, ctx } = await open({ scenario: 'idle' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); await page.locator('.at-kt-gear').click(); await page.waitForTimeout(250);
  await page.locator('.at-kt-set .at-kt-stepper button').last().click(); await page.locator('.at-kt-sheet .hm-icon-btn').last().click(); await page.waitForTimeout(400);
  const l = await calls(page); check('keep-warm stepper: a sheet closed at once still sends the choice, once', JSON.stringify(l) === JSON.stringify(['number.set_value keep_warm_temperature=45']), l); await ctx.close(); }
// cooling: said on the sheet and on the tile, even with the kettle's switch on; «Остановить» is there and works
{ const { page, ctx, errors } = await open({ scenario: 'cooling' }); await page.evaluate(() => window.atomPreview.host.setAccept(true)); const status = await page.locator('.at-kt-status').innerText();
  check('cooling: the sheet says cooling, not boiling', /Остывает до 60 °C/.test(status), status); check('cooling: no heating progress bar', await page.locator('.at-kt-bar').count() === 0);
  await page.locator('.at-kt-stop').click(); await page.waitForTimeout(300); const l = await calls(page); check('cooling: «Остановить» presses the kettle\'s stop', JSON.stringify(l) === JSON.stringify(['button.press stop']), l); check('cooling: errors', !errors.length, errors); await ctx.close();
  const tile = await open({ scenario: 'cooling', hash: '#rooms?room=kukhnia' }); const tt = await tile.page.locator('[data-module-card="kettle"]').innerText(); check('cooling: the tile says cooling with the temperature', /Остывает · 88°/.test(tt) && !/Ожидание|Кипятит/.test(tt), tt); await tile.ctx.close(); }
{ const tile = await open({ scenario: 'offline', hash: '#rooms?room=kukhnia' }); const tt = await tile.page.locator('[data-module-card="kettle"]').innerText(); check('offline: the tile says no link and no temperature', /Нет связи/.test(tt) && !/\d°/.test(tt), tt); await tile.ctx.close(); }
for (const scenario of Object.keys({ idle: 1, heating: 1, boil: 1, keep: 1, lifted: 1, knob: 1, offline: 1, cooling: 1, bare: 1, offlineBare: 1 })) for (const lang of ['ru', 'en', 'ro']) {
  const { page, ctx, errors } = await open({ lang, scenario }), tag = `${scenario}/${lang}`;
  const l = await layout(page, '.at-kt-sheet'); check(`layout ${tag}`, !l.length, l); check(`errors ${tag}`, !errors.length, errors);
  check(`no raw keys ${tag}`, !/module\.kettle\./.test(await page.locator('.at-kt-sheet').innerText()));
  if (scenario === 'lifted') check(`start disabled ${tag}`, await page.locator('.at-kt-mode-hit').first().click().then(() => page.locator('.at-kt-go').isDisabled()));
  if (scenario === 'offline' || scenario === 'offlineBare') check(`modes cannot be opened or started ${tag}`, await page.locator('.at-kt-mode-hit').first().isDisabled() && await page.locator('.at-kt-go').count() === 0); // offline the rows themselves are disabled: there is no «Включить» to reach
  await ctx.close();
}
stop(fails.length ? 1 : 0);
