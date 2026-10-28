import { render } from 'preact';
import { AtomApp } from './ui/app.tsx';
import { liveHost, type Hass } from './runtime/host.ts';
import { haStore } from './runtime/ha-store.ts';
import { normaliseConfig, type HouseConfig } from './model/config.ts';
import type { Registry } from './model/registry.ts';
import base from './styles/base.css?inline';
import home from './styles/home.css?inline';
import light from './styles/theme-light.css?inline';
import atom from './styles/atom.css?inline';

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
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = base + home + light + atom + ':host{display:block;position:relative;width:100%;height:calc(100vh - var(--header-height,0px));min-height:0;overflow:hidden}';
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
      const host = liveHost(this._hass), store = haStore(() => this._hass!);
      const [reg, cfg] = await Promise.all([host.registry(), store.load().catch(e => ({ config: normaliseConfig(null).config, warnings: [`store: ${e instanceof Error ? e.message : String(e)}`] }))]);
      if (epoch !== this.epoch) return;
      this.registry = { ...reg, states: this._hass.states }; this.config = cfg.config; this.warnings = cfg.warnings; this.loadedAt = Date.now();
    } catch (e) { this.warnings = [`registry: ${e instanceof Error ? e.message : String(e)}`]; }
    finally { this.loading = false; this.draw(); }
  }
  private draw() {
    if (!this.mount || !this._hass) return;
    if (!this.registry || !this.config) { render(<div className="hm-shell daily-shell at-shell is-wide" data-theme="light"><div className="hm-main"><p className="hm-muted" style="padding:24px">{this.warnings.length ? this.warnings.join('; ') : 'Atom Home…'}</p></div></div>, this.mount); return; }
    const registry: Registry = { ...this.registry, states: this._hass.states };
    render(<AtomApp registry={registry} config={this.config} host={liveHost(this._hass)} viewport={this.viewport} store={haStore(() => this._hass!)} configWarnings={this.warnings} onConfigChange={next => { this.config = next; }} />, this.mount);
  }
}
if (!customElements.get('atom-home-panel')) customElements.define('atom-home-panel', AtomHomePanel);
