// Screenshots of the heating mock from the card preview: node scripts/heat-shots.mjs <outdir> <port> name=url|WxH[|full] ...
import { chromium } from '@playwright/test';
const [out, port, ...jobs] = process.argv.slice(2);
const browser = await chromium.launch();
for (const job of jobs) {
  const [name, path, size, full] = job.split('|'); const [w, h] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('pageerror', name, e.message));
  await page.goto(`http://127.0.0.1:${port}${path}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  if (full) { // scroll the page's own scroller step by step, a shot each, as on the devices
    const el = await page.evaluateHandle(() => [document.querySelector('.hm-main'), ...document.querySelectorAll('*')].filter(Boolean).find(e => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) ?? document.scrollingElement);
    const [sh, ch] = await el.evaluate(e => [e.scrollHeight, e.clientHeight]); let i = 0;
    for (let y = 0; ; y += Math.round(ch * 0.85)) { await el.evaluate((e, y) => { e.scrollTop = y; }, y); await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}-${i++}.png` }); if (y + ch >= sh) break; }
  } else await page.screenshot({ path: `${out}/${name}.png` });
  await page.close(); console.log('ok', name);
}
await browser.close();
