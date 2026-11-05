import { render } from 'preact';
import { AtomApp } from './ui/app.tsx';
import { liveHost, type Hass } from './runtime/host.ts';
import { haStore } from './runtime/ha-store.ts';
import type { ConfigStore } from './runtime/store.ts';
import { normaliseConfig, type HouseConfig } from './model/config.ts';
import type { Registry } from './model/registry.ts';
import base from './styles/base.css?inline';
import home from './styles/apple.css?inline';
import atom from './styles/atom.css?inline';
import { SKELETON_CSS, skeletonHtml, readSkeletonTheme, rememberSkeletonTheme } from './ui/skeleton.js';

const REGISTRY_REFRESH_MS = 5 * 60 * 1000;
/** Custom sidebar panel for Home Assistant: receives the authenticated `hass` object, never stores tokens. */
export class AtomHomePanel extends HTMLElement {
  private _hass: Hass | null = null;
  private mount: HTMLDivElement | null = null;
  private registry: Registry | null = null;
  private config: HouseConfig | null = null;
  private warnings: string[] = [];
  private loading = false;
  private loadedAt = 0;
  private observer: ResizeObserver | null = null;
  private viewport = { width: 320, height: 480 };
  private epoch = 0;
  /** One store for the panel's life: it carries the config revision between saves. */
  private store: ConfigStore | null = null;
  private configStore() { return this.store ??= haStore(() => this._hass!); }
  /** One host for the panel's life, for the same reason: `hass` is a new object on every state change. */
  private host = liveHost(() => this._hass!);
  narrow = false;
  panel: { config?: Record<string, unknown> } | null = null;

  set hass(value: Hass) {
    const first = !this._hass;
    this._hass = value;
    if (first || Date.now() - this.loadedAt > REGISTRY_REFRESH_MS) void this.load();
    else this.draw();
  }
  get hass() { return this._hass!; }

  connectedCallback() {
    // The loader defines this element after Home Assistant may already have created it and assigned `hass`; such a value sits as an own
    // property that shadows the setter, so re-apply it through the setter (the standard custom-element upgrade dance).
    for (const key of ['hass', 'narrow', 'panel'] as const) if (Object.prototype.hasOwnProperty.call(this, key)) { const value = (this as unknown as Record<string, unknown>)[key]; delete (this as unknown as Record<string, unknown>)[key]; (this as unknown as Record<string, unknown>)[key] = value; }
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = base + home + atom + ':host{display:block;position:relative;width:100%;height:100vh;height:calc(100dvh - env(safe-area-inset-top,0px));min-height:0;overflow:hidden}';
    this.mount = document.createElement('div'); this.mount.style.height = '100%';
    root.append(style, this.mount);
    this.observer = new ResizeObserver(() => this.measure()); this.observer.observe(this);
    this.measure();
    if (this._hass) void this.load();
  }
  disconnectedCallback() { this.epoch++; this.observer?.disconnect(); this.observer = null; if (this.mount) render(null, this.mount); this.mount = null; }

  private measure() { const r = this.getBoundingClientRect(); this.viewport = { width: Math.max(320, Math.floor(r.width)), height: Math.max(320, Math.floor(r.height || innerHeight)) }; this.draw(); }

  private async load() {
    if (this.loading || !this._hass) return;
    this.loading = true; const epoch = ++this.epoch;
    try {
      const host = this.host, store = this.configStore();
      const [reg, cfg] = await Promise.all([host.registry(), store.load().catch(e => ({ config: normaliseConfig(null).config, warnings: [`store: ${e instanceof Error ? e.message : String(e)}`] }))]);
      if (epoch !== this.epoch) return;
      this.registry = { ...reg, states: this._hass.states }; this.config = cfg.config; this.warnings = cfg.warnings; this.loadedAt = Date.now();
    } catch (e) { this.warnings = [`registry: ${e instanceof Error ? e.message : String(e)}`]; }
    finally { this.loading = false; this.draw(); }
  }
  private draw() {
    if (!this.mount || !this._hass) return;
    // ST-1 of the audit: a skeleton with the home grid's geometry instead of a black screen while the registry and the config load
    if (!this.registry || !this.config) { render(this.warnings.length ? <div className="hm-shell daily-shell at-shell is-wide" data-theme="light"><div className="hm-main"><p className="hm-muted" style="padding:24px">{this.warnings.join('; ')}</p></div></div> : <><style>{SKELETON_CSS}</style><div dangerouslySetInnerHTML={{ __html: skeletonHtml(undefined, readSkeletonTheme()) }} /></>, this.mount); return; }
    rememberSkeletonTheme(this.config.home.theme);
    const registry: Registry = { ...this.registry, states: this._hass.states };
    render(<AtomApp registry={registry} config={this.config} host={this.host} viewport={this.viewport} store={this.configStore()} configWarnings={this.warnings} onConfigChange={next => { this.config = next; rememberSkeletonTheme(next.home.theme); }} />, this.mount);
  }
}
if (!customElements.get('atom-home-panel')) customElements.define('atom-home-panel', AtomHomePanel);
