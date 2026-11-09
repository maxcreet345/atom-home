// Screenshots of the Atom + Okapi climate mock at each scenario's own time: node scripts/oc-shots.mjs <outdir> <port> name|scenario|hash|WxH[|full|dark] ...
import { chromium } from '@playwright/test';
import { SCENARIOS } from './cards/okapi-climate.mjs';
import { AT as ENERGY_AT } from './cards/okapi-energy.mjs';
const CARD = process.env.CARD ?? 'okapi-climate', atOf = sc => CARD === 'okapi-energy' ? ENERGY_AT : SCENARIOS[sc].at;
const [out, port, ...jobs] = process.argv.slice(2);
const browser = await chromium.launch();
for (const job of jobs) {
  const [name, sc, hash, size, ...flags] = job.split('|'); const [wh, dpr = '2'] = size.split('@'); const [w, h] = wh.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(dpr), isMobile: flags.includes('mobile'), hasTouch: flags.includes('mobile') });
  page.on('pageerror', e => console.log('pageerror', name, e.message));
  await page.clock.setFixedTime(new Date(atOf(sc)));
  if (flags.includes('guest')) await page.addInitScript(() => { window.__beforeDraw = h => { try { Object.defineProperty(h, 'admin', { value: false }); } catch { h.admin = false; } }; });
  await page.goto(`http://127.0.0.1:${port}/?card=${CARD}&scenario=${sc}&theme=${flags.includes('dark') ? 'dark' : 'light'}&lang=ru${hash}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 }); await page.waitForTimeout(1200);
  if (flags.includes('full')) {
    const el = await page.evaluateHandle(() => [document.querySelector('.hm-main'), ...document.querySelectorAll('*')].filter(Boolean).find(e => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) ?? document.scrollingElement);
    const [sh, ch] = await el.evaluate(e => [e.scrollHeight, e.clientHeight]); let i = 0;
    for (let y = 0; ; y += Math.round(ch * 0.85)) { await el.evaluate((e, y) => { e.scrollTop = y; }, y); await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}-${i++}.png` }); if (y + ch >= sh) break; }
  } else await page.screenshot({ path: `${out}/${name}.png` });
  await page.close(); console.log('ok', name);
}
await browser.close();
