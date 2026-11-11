// One preview of a card that every auditor and every real device can open: /?card=air&scenario=wet&theme=dark&lang=ru#home?device=air
// Commands go nowhere: the preview host records them. A real device reaches it over USB with `adb reverse tcp:4173 tcp:4173`.
// usage: node scripts/card-preview.mjs [port]   (…&photos=1: the owner's product photos in the devices' photo slots, photo-fixture.mjs; without it, none — as today)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { withPhotos, servePhoto, vacuumFrames, wantsPhotos } from './photo-fixture.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview'), port = Number(process.argv[2] ?? 4173); // QA_DIST: another build of the preview
const base = JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-registry-live-20261028.json'), 'utf8')), configText = await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8');
const TYPES = { '.jpg': 'image/jpeg', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PAGE = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Atom Home preview</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%;position:relative}</style><div id="root"></div><script type="module">
import "/atom-preview.js";
const q = new URLSearchParams(location.search), d = await (await fetch('/__state' + location.search)).json();
localStorage.clear(); d.config.home.theme = q.get('theme') ?? 'light'; d.config.home.language = q.get('lang') ?? 'ru'; window.__feederLog = d.feederLog; window.__airTasks = d.airTasks; window.__energyMonth = d.energyMonth; window.__energyStats = d.energyStats; window.__energyPrefs = d.energyPrefs; window.__logbook = d.logbook; window.__frames = d.frames; window.__camHistory = d.camHistory;
await window.mountPreview(document.getElementById('root'), d.snapshot, d.config); window.ready = true;
</script>`;
const server = createServer(async (req, res) => { const u = new URL(req.url, 'http://l'); try {
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(PAGE); return; }
  if (u.pathname === '/__state') { const name = u.searchParams.get('card') ?? 'air'; if (!/^[a-z0-9-]+$/.test(name)) throw new Error('bad card'); const { card } = await import(`./cards/${name}.mjs`), s = card.scenarios[u.searchParams.get('scenario') ?? Object.keys(card.scenarios)[0]]; if (!s) throw new Error('no such scenario'); res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); const built = card.build(base, s, new Date()), cfg = card.config(configText, s), photos = wantsPhotos(u.searchParams); res.end(JSON.stringify(photos ? { ...built, ...(name === 'vacuum' ? {} : { frames: { ...vacuumFrames(), ...(built.frames ?? {}) } }), config: withPhotos(built.snapshot, cfg) } : { ...built, config: cfg })); return; } // ?photos=1: the owner's product photos by model, and the robot's renders on every card (the vacuum card hands its own)
  // a camera's HA still (entity_picture) has no Home Assistant behind it here: a drawn stand-in instead of a 404 on every page that shows the camera (qa-heating counted 108 of them)
  if (u.pathname.startsWith('/api/camera_proxy/')) { res.setHeader('content-type', 'image/svg+xml'); res.setHeader('cache-control', 'max-age=3600'); res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#1b2433"/><g fill="none" stroke="#5d6b80" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><rect x="240" y="135" width="120" height="90" rx="14"/><path d="M360 165l44-24v78l-44-24"/></g></svg>'); return; }
  if (await servePhoto(u, res)) return; // /frames/… (recorded camera frames, the robot's renders, the map) and /local/device-photos/…
  const p = resolve(dist, '.' + decodeURIComponent(u.pathname)); if (!p.startsWith(dist)) throw new Error('outside'); res.setHeader('content-type', TYPES[extname(p)] ?? 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); res.end(await readFile(p));
} catch { res.statusCode = 404; res.end(); } });
server.listen(port, '127.0.0.1', () => console.log(`card preview ready on http://127.0.0.1:${port}`));
