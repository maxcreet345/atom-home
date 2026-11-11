// Standing preview server for external audit tools (AccessLint, frontend-visual-qa): serves dist-preview with the Criuleni
// registry snapshot and the owner's config, and mounts the panel on load. Commands are logged and rejected by the preview host.
// usage: node scripts/preview-server.mjs [port]   → http://127.0.0.1:<port>/#home   (…/?theme=dark#home for the dark theme)
//   …/?photos=1#home — the owner's product photos in the devices' photo slots and the robot's renders (photo-fixture.mjs); without it, no photos (as today)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { SKELETON_CSS, skeletonHtml } from '../src/ui/skeleton.js';
import { addFeeder, feederLog } from './feeder-fixture.mjs';
import { withPhotos, servePhoto, vacuumFrames, wantsPhotos } from './photo-fixture.mjs';
const root = resolve(import.meta.dirname, '..'), dist = process.env.QA_DIST ? resolve(process.env.QA_DIST) : resolve(root, 'dist-preview'), port = Number(process.argv[2] ?? 4173); // QA_DIST: another build of the preview
const house = addFeeder(JSON.parse(await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8'))), fixture = JSON.stringify(house);
const config = await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8');
const photoConfig = JSON.stringify(withPhotos(house, JSON.parse(config))), frames = JSON.stringify(vacuumFrames()); // ?photos=1
const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Atom Home — preview</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%;position:relative}' + SKELETON_CSS + '.hm-page *,.hm-page{animation:none!important}</style></head><body><div id="root">' + skeletonHtml() + '</div><script type="module">import "/atom-preview.js"; const q = new URLSearchParams(location.search), [fx, cfg] = await Promise.all([fetch("/fixture.json").then(r => r.json()), fetch("/config.json" + (q.get("photos") === "1" ? "?photos=1" : "")).then(r => r.json())]); const theme = q.get("theme"); if (theme) cfg.home.theme = theme; if (q.get("photos") === "1") window.__frames = ' + frames + '; window.__feederLog = await fetch("/feeder-log.json").then(r => r.json()); await window.mountPreview(document.getElementById("root"), fx, cfg); window.ready = true;</script></body></html>';
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://l');
    if (u.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; }
    if (u.pathname === '/feeder-log.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(feederLog())); return; }
    if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(wantsPhotos(u.searchParams) ? photoConfig : config); return; }
    if (await servePhoto(u, res)) return; // /local/device-photos/… and /frames/… (asked for only with ?photos=1)
    const p = resolve(dist, '.' + decodeURIComponent(u.pathname));
    res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream');
    res.end(await readFile(p));
  } catch { res.statusCode = 404; res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`preview at http://127.0.0.1:${port}/#home`));
