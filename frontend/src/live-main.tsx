import { render } from 'preact';
import { AtomApp } from './ui/app.tsx';
import { liveHost, type Hass } from './runtime/host.ts';
import { haStore } from './runtime/ha-store.ts';
import { restartNeeded, type ConfigStore } from './runtime/store.ts';
import { normaliseConfig, type HouseConfig } from './model/config.ts';
import type { Registry } from './model/registry.ts';
import { createLoader } from './runtime/loader.ts';
import { nextViewport } from './ui/panel-size.ts';
import base from './styles/base.css?inline';
import home from './styles/apple.css?inline';
import atom from './styles/atom.css?inline';
import room from './styles/room.css?inline';
import { SKELETON_CSS, SKELETON_TEXT, skeletonHtml, readSkeletonTheme, rememberSkeletonTheme, readSkeletonLang, rememberSkeletonLang } from './ui/skeleton.js';

/** The registry comes again when Home Assistant says it changed; this is only the safety net (it was the whole registry every 5 minutes). */
const REGISTRY_FALLBACK_MS = 60 * 60 * 1000;
/** Without the events (an HA or a user that will not give them) the registry is polled as before. */
const REGISTRY_POLL_MS = 5 * 60 * 1000;
/** Another screen's settings arrive within five minutes: one small read. */
const CONFIG_REFRESH_MS = 5 * 60 * 1000;
const REGISTRY_EVENTS = ['entity_registry_updated', 'device_registry_updated', 'area_registry_updated', 'floor_registry_updated'];
/** The integration's version this bundle was built for (vite.live.config.ts reads manifest.json); the element carries it as `data-atom-version`. */
declare const __ATOM_VERSION__: string | undefined;
export const PANEL_VERSION: string | null = typeof __ATOM_VERSION__ === 'string' ? __ATOM_VERSION__ : null;
type Base = Pick<Registry, 'areas' | 'devices' | 'entities' | 'floors'>;
/** Custom sidebar panel for Home Assistant: receives the authenticated `hass` object, never stores tokens. */
export class AtomHomePanel extends HTMLElement {
  private _hass: Hass | null = null;
  private mount: HTMLDivElement | null = null;
  private base: Base | null = null;
  /** What the app gets: the same object until the states or the registry change, so nothing downstream recomputes for a redraw that changed neither. */
  private view: Registry | null = null;
  private config: HouseConfig | null = null;
  /** True once `atom_home/config/get` has answered. Until then `config` is the factory set, shown so that the house is usable, never saved. */
  private configReal = false;
  private warnings: string[] = [];
  /** The panel is newer (or older) than the integration that answers: Home Assistant has not been restarted since the update. */
  private restart = false;
  private registryFailed = false;
  private observer: ResizeObserver | null = null;
  private viewport = { width: 320, height: 480 };
  private sized = false;
  private started = false;
  private wasConnected = true;
  /** What the last draw showed of `hass`: a new `hass` that changes none of it (HA hands one over for many reasons) is not drawn. */
  private seen: { states: Hass['states']; connected: boolean; user: string | null; admin: boolean; language: string | undefined } | null = null;
  private frame = 0;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private stop: Array<() => void> = [];
  /** One store for the panel's life: it carries the config revision between saves. */
  private store: ConfigStore | null = null;
  private configStore() { return this.store ??= haStore(() => this._hass!); }
  /** One host for the panel's life, for the same reason: `hass` is a new object on every state change. */
  private host = liveHost(() => this._hass!);
  private registryLoad = createLoader(async () => { const reg = await this.host.registry(); this.base = reg; this.view = null; this.registryFailed = false; }, { failed: () => { this.registryFailed = true; }, settled: () => this.draw() });
  private configLoad = createLoader(async () => {
    const cfg = await this.configStore().load();
    // a refresh that brought the same settings must not look like a change (the app would drop what is being edited)
    if (!this.configReal || JSON.stringify(cfg.config) !== JSON.stringify(this.config)) this.config = cfg.config;
    this.warnings = cfg.warnings; this.configReal = true; this.restart = restartNeeded(PANEL_VERSION, cfg.serverVersion);
  }, { failed: () => { this.config ??= normaliseConfig(null).config; }, settled: () => this.draw() });
  narrow = false;
  panel: { config?: Record<string, unknown> } | null = null;

  set hass(value: Hass) {
    const first = !this._hass, back = !this.wasConnected && value.connected !== false;
    this._hass = value; this.wasConnected = value.connected !== false;
    if (first) { this.start(); return; }
    // back after a lost connection or a restart of Home Assistant: what was read before may be stale, read it again
    if (back && this.started) { void this.registryLoad.run(); void this.configLoad.run(); }
    const s = this.seen;
    if (s && s.states === value.states && s.connected === (value.connected !== false) && s.user === (value.user?.id ?? null) && s.admin === (value.user?.is_admin === true) && s.language === value.language) return;
    this.schedule();
  }
  get hass() { return this._hass!; }

  connectedCallback() {
    // The loader defines this element after Home Assistant may already have created it and assigned `hass`; such a value sits as an own
    // property that shadows the setter, so re-apply it through the setter (the standard custom-element upgrade dance).
    for (const key of ['hass', 'narrow', 'panel'] as const) if (Object.prototype.hasOwnProperty.call(this, key)) { const value = (this as unknown as Record<string, unknown>)[key]; delete (this as unknown as Record<string, unknown>)[key]; (this as unknown as Record<string, unknown>)[key] = value; }
    this.setAttribute('data-atom-version', PANEL_VERSION ?? 'dev');
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = base + home + atom + room + ':host{display:block;position:relative;width:100%;height:100vh;height:calc(100dvh - env(safe-area-inset-top,0px));min-height:0;overflow:hidden}';
    this.mount = document.createElement('div'); this.mount.style.height = '100%';
    root.append(style, this.mount);
    this.observer = new ResizeObserver(() => this.measure()); this.observer.observe(this);
    this.measure();
    this.start();
  }
  disconnectedCallback() {
    this.started = false; this.registryLoad.stop(); this.configLoad.stop(); for (const f of this.stop.splice(0)) f();
    if (this.frame) cancelAnimationFrame(this.frame); if (this.frameTimer) clearTimeout(this.frameTimer); this.frame = 0; this.frameTimer = null;
    this.observer?.disconnect(); this.observer = null; if (this.mount) render(null, this.mount); this.mount = null; this.seen = null;
  }

  /** A resize that leaves the rounded size as it was (a sub-pixel change, the observer's first call) draws nothing. */
  private measure() { const r = this.getBoundingClientRect(), next = nextViewport(this.viewport, r.width, r.height || innerHeight); if (next === this.viewport && this.sized) return; this.sized = true; this.viewport = next; this.draw(); }

  /** Both reads start once the element is in the page and has a `hass`; each one that fails is tried again on its own (2 s, 5 s, 15 s, then every 30 s). */
  private start() {
    if (this.started || !this.mount || !this._hass) return;
    this.started = true; this.draw();
    void this.registryLoad.run(); void this.configLoad.run();
    const config = setInterval(() => void this.configLoad.run(), CONFIG_REFRESH_MS);
    let registry = setInterval(() => void this.registryLoad.run(), REGISTRY_POLL_MS);
    this.stop.push(() => clearInterval(config), () => clearInterval(registry));
    // PERF-7 of the audit: Home Assistant tells when a registry changed; a burst of events (a device with twenty entities) is one read
    const conn = this._hass.connection; let soon: ReturnType<typeof setTimeout> | null = null;
    const changed = () => { if (soon) clearTimeout(soon); soon = setTimeout(() => { soon = null; void this.registryLoad.run(); }, 1000); };
    this.stop.push(() => { if (soon) clearTimeout(soon); });
    if (conn?.subscribeEvents) void Promise.all(REGISTRY_EVENTS.map(type => conn.subscribeEvents!(changed, type))).then(offs => {
      if (!this.started) { for (const off of offs) void off(); return; }
      clearInterval(registry); registry = setInterval(() => void this.registryLoad.run(), REGISTRY_FALLBACK_MS);
      this.stop.push(...offs.map(off => () => { void Promise.resolve(off()).catch(() => undefined); }));
    }, () => undefined);
  }
  /** PERF-1 of the audit: a burst of state changes is one render, at the next frame (or within a quarter of a second where frames do not run). */
  private schedule() {
    if (this.frame || this.frameTimer) return;
    const flush = () => { if (this.frame) cancelAnimationFrame(this.frame); if (this.frameTimer) clearTimeout(this.frameTimer); this.frame = 0; this.frameTimer = null; this.draw(); };
    this.frame = requestAnimationFrame(flush); this.frameTimer = setTimeout(flush, 250);
  }
  private draw() {
    if (!this.mount || !this._hass) return;
    const hass = this._hass;
    // ST-1 of the audit: a skeleton with the home grid's geometry instead of a black screen while the registry and the config load;
    // a load that failed keeps the skeleton and says, in the panel's language, that it is being tried again
    if (!this.base || !this.config) { const words = SKELETON_TEXT[readSkeletonLang(hass.language)]; render(<><style>{SKELETON_CSS}</style><div dangerouslySetInnerHTML={{ __html: skeletonHtml(this.registryFailed ? words.fail : words.wait, readSkeletonTheme()) }} /></>, this.mount); return; }
    rememberSkeletonTheme(this.config.home.theme); rememberSkeletonLang(this.config.home.language);
    if (!this.view || this.view.states !== hass.states) this.view = { ...this.base, states: hass.states };
    this.seen = { states: hass.states, connected: hass.connected !== false, user: hass.user?.id ?? null, admin: hass.user?.is_admin === true, language: hass.language };
    render(<AtomApp registry={this.view} config={this.config} host={this.host} viewport={this.viewport} store={this.configStore()} configWarnings={this.warnings} configPending={!this.configReal} restartNeeded={this.restart}
      onConfigChange={next => { this.config = next; rememberSkeletonTheme(next.home.theme); rememberSkeletonLang(next.home.language); }} />, this.mount);
  }
}
if (!customElements.get('atom-home-panel')) customElements.define('atom-home-panel', AtomHomePanel);
