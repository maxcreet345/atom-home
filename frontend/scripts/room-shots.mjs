// Full-page shots of the room page mock: node scripts/room-shots.mjs <outdir> <port> name=url|WxH ...  (the panel's scroller is drawn whole)
import { chromium } from '@playwright/test';
const [out, port, ...jobs] = process.argv.slice(2), browser = await chromium.launch();
for (const job of jobs) { const [name, path, size] = job.split('|'), [w, h] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }); page.on('pageerror', e => console.log('pageerror', name, e.message));
  await page.goto(`http://127.0.0.1:${port}${path}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 }); await page.waitForTimeout(900);
  // the panel scrolls inside itself: grow the page to the content so one shot holds the whole room
  const full = await page.evaluate(() => { const s = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden').sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; return s ? s.scrollHeight - s.clientHeight : 0; });
  if (full > 0) { await page.setViewportSize({ width: w, height: h + full }); await page.waitForTimeout(500); }
  await page.screenshot({ path: `${out}/${name}.png` }); await page.close(); console.log('ok', name, h + full); }
await browser.close();
