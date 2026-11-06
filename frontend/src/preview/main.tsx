import { render } from 'preact';
import { AtomApp } from '../ui/app.tsx';
import { previewHost } from '../runtime/host.ts';
import { localStore, memoryStore } from '../runtime/store.ts';
import type { Registry } from '../model/registry.ts';
import base from '../styles/base.css?inline';
import home from '../styles/apple.css?inline';
import atom from '../styles/atom.css?inline';
/** Isolated preview: a frozen registry + states snapshot, commands rejected and recorded. Used by QA and screenshots. */
export async function mountPreview(root: HTMLElement, snapshot: Registry, config: unknown, viewport?: { width: number; height: number }) {
  const style = document.createElement('style'); style.textContent = base + home + atom; document.head.append(style);
  const host = previewHost(snapshot);
  host.setAirTasks((window as unknown as { __airTasks?: never }).__airTasks ?? []);
  host.setFeederLog((window as unknown as { __feederLog?: never }).__feederLog ?? null); // QA and the preview server set it before the first draw
  (window as unknown as { __beforeDraw?: (h: typeof host) => void }).__beforeDraw?.(host); // QA: how the host answers from its very first read
  const store = config === undefined ? localStore() : memoryStore(config);
  const loaded = await store.load(); let cfg = loaded.config; const warnings = loaded.warnings;
  const size = () => viewport ?? { width: root.clientWidth || innerWidth, height: root.clientHeight || innerHeight };
  let registry = snapshot;
  const draw = () => render(<AtomApp registry={registry} config={cfg} host={host} viewport={size()} store={store} configWarnings={warnings} onConfigChange={next => { cfg = next; }} />, root);
  draw(); addEventListener('resize', draw);
  (window as unknown as { atomPreview: unknown }).atomPreview = { host, warnings, redraw: draw, store, setOnline(v: boolean) { host.setOnline(v); draw(); }, /** A reading changes while the panel is open, as HA would send it. */ setStates(over: Record<string, string>) { registry = { ...registry, states: { ...registry.states, ...Object.fromEntries(Object.entries(over).map(([id, state]) => [id, { ...registry.states[id], state }])) } }; draw(); }, setFeederLog(log: never) { host.setFeederLog(log); draw(); }, setAccept(v: boolean) { host.setAccept(v); }, setDelay(ms: number) { host.setDelay(ms); }, setAutomations(rows: Parameters<typeof host.setAutomations>[0]) { host.setAutomations(rows); draw(); }, get config() { return cfg; } };
  return { host, warnings };
}
(window as unknown as { mountPreview: typeof mountPreview }).mountPreview = mountPreview;
