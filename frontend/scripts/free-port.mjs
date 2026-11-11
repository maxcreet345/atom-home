// A port nobody holds, for the preview server a qa script starts for itself. The scripts used to draw a random port from a fixed range:
// a draw that hit a standing preview or another run's server left the child dead on EADDRINUSE and the script waiting for its «ready» line for ever.
import { createServer } from 'node:net';
export const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
