// Element shots of the vacuum mock: node scripts/vac-shots.mjs <outdir> <port> name=url|WxH|selector ...
import { chromium } from '@playwright/test';
const [out, port, ...jobs] = process.argv.slice(2), browser = await chromium.launch();
for (const job of jobs) { const [name, path, size, sel] = job.split('|'), [w, h] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }); page.on('pageerror', e => console.log('pageerror', name, e.message));
  await page.goto(`http://127.0.0.1:${port}${path}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 }); await page.waitForTimeout(1000);
  const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await el.screenshot({ path: `${out}/${name}.png` }); await page.close(); console.log('ok', name); }
await browser.close();
