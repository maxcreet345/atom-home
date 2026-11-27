/** How a report reaches the house (27.11.2026): the integration's own log first (`atom_home/log/write`: kept across restarts, any signed-in user,
 *  with this device named); an integration that does not know it yet (not restarted after the update) gets it in Home Assistant's log as before. */
type Ws = <T = unknown>(message: Record<string, unknown>) => Promise<T>;
/** The device in a few words, for the log only: the app or browser, the system and the size of the panel. */
export function deviceLabel(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', w = typeof innerWidth === 'number' ? innerWidth : 0, h = typeof innerHeight === 'number' ? innerHeight : 0): string {
  const app = /Fully/i.test(ua) ? 'Fully Kiosk' : /Home ?Assistant/i.test(ua) ? 'HA app' : /YaBrowser/.test(ua) ? 'Yandex' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return [app, os, w && h ? `${w}×${h}` : ''].filter(Boolean).join(' · ');
}
export function panelLogSend(ws: () => Ws, version: string | null, level: 'error' | 'warning') {
  let own = true;
  return async (message: string, where: string, text: string) => {
    if (own) {
      try { return await ws()({ type: 'atom_home/log/write', where, text, ...(version ? { version } : {}), device: deviceLabel() }); }
      // an integration not restarted since the update does not know the command: asked once, then straight to the system log; any other failure
      // (the entry being reloaded, a refusal) sends this one report there instead of losing it
      catch (e) { if ((e as { code?: unknown } | null)?.code === 'unknown_command') own = false; }
    }
    return ws()({ type: 'call_service', domain: 'system_log', service: 'write', service_data: { message, level, logger: 'custom_components.atom_home.panel' } });
  };
}
