// Standing preview server for external audit tools (AccessLint, frontend-visual-qa): serves dist-preview with the Criuleni
// registry snapshot and the owner's config, and mounts the panel on load. Commands are logged and rejected by the preview host.
// usage: node scripts/preview-server.mjs [port]   → http://127.0.0.1:<port>/#home
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { SKELETON_CSS, skeletonHtml } from '../src/ui/skeleton.js';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist-preview'), port = Number(process.argv[2] ?? 4173);
const fixture = await readFile(resolve(root, '../private/fixtures/criuleni-registry.json'), 'utf8');
const config = await readFile(resolve(root, '../../clients/criuleni/atom-home-config-20261028.json'), 'utf8');
const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atom Home — preview</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{height:100%;position:relative}' + SKELETON_CSS + '.hm-page *,.hm-page{animation:none!important}</style></head><body><div id="root">' + skeletonHtml() + '</div><script type="module">import "/atom-preview.js"; const [fx, cfg] = await Promise.all([fetch("/fixture.json").then(r => r.json()), fetch("/config.json").then(r => r.json())]); await window.mountPreview(document.getElementById("root"), fx, cfg); window.ready = true;</script></body></html>';
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://l');
    if (u.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (u.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(fixture); return; }
    if (u.pathname === '/config.json') { res.setHeader('content-type', 'application/json'); res.end(config); return; }
    const p = resolve(dist, '.' + decodeURIComponent(u.pathname));
    res.setHeader('content-type', ({ '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(p)] ?? 'application/octet-stream');
    res.end(await readFile(p));
  } catch { res.statusCode = 404; res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`preview at http://127.0.0.1:${port}/#home`));
