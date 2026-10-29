import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { discover, roomClimate, type Home, type HomeDevice } from '../model/discover.ts';
import { SECTIONS, type Section, type Kind } from '../model/kinds.ts';
import type { Host } from '../runtime/host.ts';
import { actionsFor, serviceCall, customAction, type Action } from '../runtime/actions.ts';
import { translator, type Key } from '../i18n/index.ts';
import { RoomTile, AccessoryTile, ThermostatTile, ClockTile, SceneTile, ValueTile, Pill, Section as Block } from './cards.tsx';
import { DeviceSheet, type Runner } from './sheet.tsx';
import { stateText, isOn, num, co2Level, withRoom } from './format.ts';
import { Setup } from './setup.tsx';
import { activeModules, type ActiveModule } from '../modules/index.ts';
import type { JSX } from 'preact';
import { SaveError, type ConfigStore } from '../runtime/store.ts';
import { Cascade } from './motion.tsx';

type View = { section: Section | 'setup'; room: string | null; device: string | null };
/** Apple Home-style navigation: Home · Rooms · Systems (+ Settings for admins). The former per-kind screens live under Systems as segments. */
const NAV: Array<{ id: Section; icon: string }> = [{ id: 'home', icon: 'home' }, { id: 'rooms', icon: 'rooms' }, { id: 'systems', icon: 'systems' }];
const SYSTEM_TABS: Section[] = ['climate', 'lights', 'cleaning', 'energy', 'systems'];
const decode = (hash: string): View => { const [s, q = ''] = hash.replace(/^#/, '').split('?'); const p = new URLSearchParams(q); return { section: s === 'setup' ? 'setup' : (SECTIONS as readonly string[]).includes(s) ? s as Section : 'home', room: p.get('room'), device: p.get('device') }; };
const encode = (v: View) => { const p = new URLSearchParams(); if (v.room) p.set('room', v.room); if (v.device) p.set('device', v.device); return `#${v.section}${p.size ? '?' + p : ''}`; };
function useNavIndicator<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => { const nav = ref.current; if (!nav) return; const a = nav.querySelector<HTMLElement>('button.is-active'); nav.style.setProperty('--hm-ind-on', a ? '1' : '0'); if (!a) return; nav.style.setProperty('--hm-ind-x', `${a.offsetLeft}px`); nav.style.setProperty('--hm-ind-y', `${a.offsetTop}px`); nav.style.setProperty('--hm-ind-w', `${a.offsetWidth}px`); nav.style.setProperty('--hm-ind-h', `${a.offsetHeight}px`); }, deps);
  return ref;
}
export interface AppProps { registry: Registry; config: HouseConfig; host: Host; viewport: { width: number; height: number }; navigationWindow?: Window; store?: ConfigStore; configWarnings?: string[]; onConfigChange?: (next: HouseConfig) => void }
/** The whole panel: pure function of (registry + states, config). Commands go through the host and are confirmed by state changes. */
export function AtomApp({ registry, config: initialConfig, host, viewport, navigationWindow = window, store, configWarnings = [], onConfigChange }: AppProps) {
  const [config, setConfig] = useState(initialConfig);
  const confirmed = useRef(initialConfig);
  useEffect(() => { setConfig(initialConfig); confirmed.current = initialConfig; }, [initialConfig]);
  /** Shown at once, kept only once the store confirms. A refused save returns to the last confirmed config (after a conflict: the fresh one) and rejects, so the caller does not report success. */
  const applyConfig = async (next: HouseConfig) => {
    setConfig(next); onConfigChange?.(next);
    if (!store) return;
    try { await store.save(next); confirmed.current = next; }
    catch (e) {
      const code = e instanceof SaveError ? e.code : 'failed';
      if (code === 'conflict') { try { confirmed.current = (await store.load()).config; } catch { /* keep the last confirmed copy */ } }
      setConfig(confirmed.current); onConfigChange?.(confirmed.current);
      notify(translator(confirmed.current.home.language)(`save.error.${code}` as Key), 6000);
      throw e;
    }
  };
  const lang = config.home.language, t = useMemo(() => translator(lang), [lang]);
  const home = useMemo(() => discover(registry, config), [registry, config]);
  const modules = useMemo(() => activeModules(registry, config), [registry, config]);
  const [view, setView] = useState<View>(() => decode(navigationWindow.location.hash));
  const player = (dev: HomeDevice, mode: 'tile' | 'stage') => { if (mode === 'tile' && view.device) return null; /* one stream at a time: the sheet's stage replaces the tile player */ const m = modules.find(x => x.def.Player && x.entities.camera === dev.primary.id); const P = m?.def.Player; return m && P ? <P key={`${m.def.id}:${dev.key}:${mode}`} entities={m.entities} options={m.options} host={host} t={t} lang={lang} mode={mode} /> : null; };
  useEffect(() => { const pop = () => setView(decode(navigationWindow.location.hash)); navigationWindow.addEventListener('popstate', pop); navigationWindow.addEventListener('hashchange', pop); return () => { navigationWindow.removeEventListener('popstate', pop); navigationWindow.removeEventListener('hashchange', pop); }; }, [navigationWindow]);
  const go = (next: Partial<View>) => { const v = { section: view.section, room: null, device: null, ...next } as View; navigationWindow.history.pushState(null, '', encode(v)); setView(v); };
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set()), [toast, setToast] = useState(''), [confirm, setConfirm] = useState<{ device: HomeDevice; action: Action; value?: unknown } | null>(null);
  const notify = (text: string, ms = 4000) => { setToast(text); setTimeout(() => setToast(cur => cur === text ? '' : cur), ms); };
  const runner: Runner = {
    busy,
    async run(device, action, value) {
      if (action.confirm && !(confirm && confirm.device === device && confirm.action === action)) { setConfirm({ device, action, value }); return; }
      setConfirm(null); setBusy(s => new Set(s).add(device.key));
      try { const c = serviceCall(action, value); await host.call(c.domain, c.service, c.data); }
      catch (e) { notify(e instanceof Error ? e.message : String(e)); }
      finally { setBusy(s => { const n = new Set(s); n.delete(device.key); return n; }); }
    },
  };
  const toggle = (d: HomeDevice) => { const a = actionsFor(d).find(x => x.id === 'toggle'); if (a) void runner.run(d, a, !a.current); };
  useEffect(() => { const key = (ev: KeyboardEvent) => { if (ev.key !== 'Escape') return; if (confirm) setConfirm(null); else if (view.device) go({ section: view.section, room: view.room }); }; navigationWindow.addEventListener('keydown', key); return () => navigationWindow.removeEventListener('keydown', key); });
  const wide = viewport.width >= 600, landscape = viewport.width > viewport.height, short = viewport.height <= 700;
  const now = useClock();
  const time = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const enabled = home.devices.filter(d => d.enabled);
  const hasPower = (d: HomeDevice) => d.metrics.some(m => m.deviceClass === 'power' || m.deviceClass === 'energy');
  const energyDevices = enabled.filter(d => d.kind === 'energy' || hasPower(d));
  const present = (s: Section) => s === 'home' || s === 'rooms' || s === 'systems' || (s === 'energy' ? energyDevices.length > 0 : enabled.some(d => d.section === s));
  const systemTabs = SYSTEM_TABS.filter(s => present(s) && !config.sections[s]?.hidden);
  const inSystems = (SYSTEM_TABS as string[]).includes(view.section);
  const navActive = (id: Section | 'setup') => id === 'systems' ? inSystems : view.section === id;
  const lastSystems = useRef<Section>('climate'); if (inSystems) lastSystems.current = view.section as Section;
  const navTarget = (id: Section | 'setup') => id === 'systems' ? lastSystems.current : id;
  const sideNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width, viewport.height]);
  const tabNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width]);
  const device = view.device ? enabled.find(d => d.key === view.device) : undefined;
  const rooms = home.rooms.filter(r => !r.hidden);
  const roomName = (id: string) => home.rooms.find(r => r.id === id)?.name || t('room.none');
  const title = view.section === 'setup' ? t('setup.title') : view.section === 'rooms' && view.room ? roomName(view.room) : view.section === 'home' ? home.name : inSystems ? t('section.systems') : t(`section.${view.section}` as Key);
  const subtitle = view.section === 'home' ? `${greeting(now, t)} · ${date}` : view.section === 'rooms' && !view.room ? t('rooms.count', { n: rooms.length }) : '';
  const pageKey = `${view.section}/${view.room ?? ''}`;
  const modal = !!device || !!confirm;
  const navItems = [...NAV, ...(host.admin ? [{ id: 'setup' as const, icon: 'gear' }] : [])];
  const navLabel = (id: Section | 'setup') => id === 'setup' ? t('section.settings') : t(`section.${id}` as Key);
  return <div className={`hm-shell daily-shell at-shell ah-shell ${wide && !short ? 'daily-fit-screen' : ''} ${wide ? 'is-wide' : 'is-narrow'} ${wide && viewport.width < 760 ? 'is-compact' : ''} ${landscape ? 'is-landscape' : 'is-portrait'} ${short ? 'is-short' : ''} hm-route-${view.section}`} lang={lang} data-theme={config.home.theme} style={`--hm-height:${viewport.height}px`}>
    <div className="ah-wallpaper" aria-hidden="true" />
    {wide && <aside className="hm-sidebar" inert={modal || undefined}>
      <div className="hm-clock"><strong>{time}</strong><small>{date.split(',')[0]}</small></div>
      <nav aria-label={t('section.more')} ref={sideNav}><i className="hm-nav-ind" aria-hidden="true" />{navItems.map(n => <button type="button" className={`${navActive(n.id) ? 'is-active' : ''} ${n.id === 'setup' ? 'at-setup-nav' : ''}`} aria-current={navActive(n.id) ? 'page' : undefined} onClick={() => go({ section: navTarget(n.id) })}><Icon name={n.icon} size={22} /><span>{navLabel(n.id)}</span></button>)}</nav>
      <div className="ah-side-rooms"><small>{t('section.rooms')}</small>{rooms.map(r => <button type="button" className={view.section === 'rooms' && view.room === r.id ? 'is-active' : ''} onClick={() => go({ section: 'rooms', room: r.id })}>{r.name || t('room.none')}</button>)}</div>
      <button type="button" className={`hm-conn ${host.online ? '' : 'is-off'}`} aria-label={host.online ? t('ui.online') : t('ui.offline')}><i />{host.online ? t('ui.online') : t('ui.offline')}</button>
    </aside>}
    <main className="hm-main" inert={modal || undefined}>
      <header className="hm-head">
        {view.section === 'rooms' && view.room ? <button type="button" className="hm-back" onClick={() => go({ section: 'rooms' })}><Icon name="back" size={20} />{t('section.rooms')}</button> : null}
        <div className="hm-head-title" key={pageKey}><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        {!wide && <span className="hm-head-time">{time}</span>}
        {!host.online && <span className="hm-badge tone-danger">{t('ui.offline')}</span>}
        {view.section === 'home' && host.admin && <button type="button" className="hm-icon-btn ah-head-btn" aria-label={t('section.settings')} onClick={() => go({ section: 'setup' })}><Icon name="gear" size={20} /></button>}
      </header>
      {inSystems && systemTabs.length > 1 && <div className="ah-segments hm-range-tabs" role="tablist">{systemTabs.map(s => <button type="button" role="tab" aria-selected={view.section === s} className={view.section === s ? 'is-active' : ''} onClick={() => go({ section: s })}>{t(`section.${s}` as Key)}</button>)}</div>}
      <div className="hm-page" key={pageKey}>
        {view.section === 'home' && <Overview home={home} registry={registry} config={config} modules={modules} player={player} host={host} runner={runner} toggle={toggle} go={go} t={t} lang={lang} now={now} />}
        {view.section === 'rooms' && !view.room && <div className="hm-room-grid is-page">{rooms.map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div>}
        {view.section === 'rooms' && view.room && <RoomPage home={home} registry={registry} roomId={view.room} runner={runner} toggle={toggle} go={go} t={t} lang={lang} />}
        {view.section === 'lights' && <LightsPage devices={enabled.filter(d => d.kind === 'light')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} />}
        {view.section === 'climate' && <>{modules.filter(m => m.def.placement.includes('climate')).map(m => <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} />)}<ClimatePage devices={enabled.filter(d => d.section === 'climate')} runner={runner} go={go} t={t} lang={lang} roomName={roomName} /></>}
        {view.section === 'cleaning' && <KindList devices={enabled.filter(d => d.section === 'cleaning')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} />}
        {view.section === 'energy' && <EnergyPage devices={energyDevices} go={go} t={t} lang={lang} roomName={roomName} />}
        {view.section === 'setup' && <Setup registry={registry} config={config} onChange={applyConfig} admin={host.admin} t={t} lang={lang} storeLabel={store?.label ?? 'memory'} warnings={configWarnings} photos={store?.photos} />}
        {view.section === 'systems' && <>{modules.filter(m => m.def.placement.includes('systems')).map(m => <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} />)}</>}
        {view.section === 'systems' && <SystemsPage devices={enabled.filter(d => d.section === 'systems' || d.section === 'camera' || d.section === 'weather')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} />}
      </div>
    </main>
    {!wide && <nav className="hm-tabbar" aria-label={t('section.more')} inert={modal || undefined} ref={tabNav}><i className="hm-nav-ind" aria-hidden="true" />{navItems.map(n => <button type="button" className={navActive(n.id) ? 'is-active' : ''} onClick={() => go({ section: navTarget(n.id) })}><Icon name={n.icon} size={24} /><span>{navLabel(n.id)}</span></button>)}</nav>}
    {device && <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) go({ section: view.section, room: view.room }); }}><section className="hm-sheet" role="dialog" aria-modal="true" aria-label={device.name} {...swipeToClose(() => go({ section: view.section, room: view.room }))}><DeviceSheet device={device} runner={runner} onClose={() => go({ section: view.section, room: view.room })} t={t} lang={lang} stage={device.kind === 'camera' ? player(device, 'stage') : undefined} host={host} room={home.rooms.find(r => r.id === device.roomId)?.name} /></section></div>}
    {confirm && <div className="hm-scrim is-top" onClick={e => { if (e.target === e.currentTarget) setConfirm(null); }}><div className="hm-confirm" role="alertdialog" aria-modal="true" aria-label={t('confirm.title')}><h2>{t('confirm.title')}</h2><p>{(() => { const a = t(confirm.action.label as Key) === confirm.action.label ? confirm.action.label : t(confirm.action.label as Key); return a === confirm.device.name ? t('confirm.text.one', { action: a }) : t('confirm.text', { action: a, device: confirm.device.name }); })()}</p><div><button type="button" className="hm-pill" onClick={() => setConfirm(null)}>{t('confirm.no')}</button><button type="button" className="hm-pill is-primary" onClick={() => void runner.run(confirm.device, confirm.action, confirm.value)}>{t('confirm.yes')}</button></div></div></div>}
    {toast && <div className="hm-toast" role="alert" onClick={() => setToast('')}><Icon name="warning" size={18} /><span>{toast}</span></div>}
  </div>;
}
function useClock() { const [now, setNow] = useState(() => new Date()); useEffect(() => { const i = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(i); }, []); return now; }
const greeting = (now: Date, t: ReturnType<typeof translator>) => { const h = now.getHours(); return t(h < 6 ? 'overview.greeting.night' : h < 12 ? 'overview.greeting.morning' : h < 18 ? 'overview.greeting.day' : 'overview.greeting.evening'); };
type Nav = (next: Partial<View>) => void;
/** Phone sheets close with a downward swipe that starts on the sheet (when it is scrolled to the top): the sheet follows the finger, then springs back or leaves. */
function swipeToClose(onClose: () => void) {
  let y0 = 0, dy = 0, active = false, el: HTMLElement | null = null;
  return {
    onPointerDown: (e: PointerEvent) => { el = e.currentTarget as HTMLElement; if (el.scrollTop > 0 || (e.pointerType === 'mouse')) return; y0 = e.clientY; dy = 0; active = true; el.style.transition = 'none'; },
    onPointerMove: (e: PointerEvent) => { if (!active || !el) return; dy = Math.max(0, e.clientY - y0); if (dy > 8) { el.style.transform = `translateY(${dy}px)`; el.style.animation = 'none'; } },
    onPointerUp: () => { if (!active || !el) return; active = false; el.style.transition = 'transform .3s cubic-bezier(.34,1.4,.64,1)'; if (dy > 90) { el.style.transform = 'translateY(110%)'; setTimeout(onClose, 180); } else el.style.transform = ''; },
    onPointerCancel: () => { if (el) { el.style.transform = ''; } active = false; },
  };
}
type Common = { runner: Runner; go: Nav; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en' };
const canToggle = (d: HomeDevice) => actionsFor(d).some(a => a.id === 'toggle');
/** Inside a room the owner's «Свет · Кухня» reads as «Свет». */
const inRoomName = (d: HomeDevice, room: string) => { const n = d.name.trim(), r = room.trim(); return r && n.toLowerCase().endsWith(' · ' + r.toLowerCase()) ? n.slice(0, -(r.length + 3)) : n; };
/** Tile grid for a list of devices; the toggle goes straight to the host, «…» opens the sheet in the given section. */
function Tiles({ devices, section, room, runner, toggle, go, t, lang, nameOf, roomOf }: Common & { devices: HomeDevice[]; section: Section; room?: string | null; toggle: (d: HomeDevice) => void; nameOf?: (d: HomeDevice) => string; roomOf?: (d: HomeDevice) => string }) {
  return <Cascade className="ah-grid hm-light-grid">{devices.map(d => <AccessoryTile device={d} name={nameOf?.(d)} room={roomOf?.(d)} pending={runner.busy.has(d.key)} onToggle={canToggle(d) ? () => toggle(d) : undefined} onOpen={() => go({ section, room: room ?? null, device: d.key })} t={t} lang={lang} />)}</Cascade>;
}
function Overview({ home, registry, config, modules, player, host, runner, toggle, go, t, lang, now }: Common & { home: Home; registry: Registry; config: HouseConfig; modules: ActiveModule[]; player: (dev: HomeDevice, mode: 'tile' | 'stage') => JSX.Element | null; host: Host; toggle: (d: HomeDevice) => void; now: Date }) {
  const d = home.devices.filter(x => x.enabled);
  const roomOf = (x: HomeDevice) => home.rooms.find(r => r.id === x.roomId)?.name || t('room.none');
  const leaks = d.filter(x => x.kind === 'leak'), wet = leaks.filter(x => x.primary.state === 'on'), leaksMute = leaks.length > 0 && leaks.every(x => !x.primary.available || x.primary.state === 'unknown');
  const co2 = d.flatMap(x => x.metrics).find(m => m.deviceClass === 'carbon_dioxide' && m.available && Number.isFinite(Number(m.state)));
  const co2v = co2 ? Number(co2.state) : null, air = co2Level(co2v, t);
  const power = d.flatMap(x => x.metrics).filter(m => m.deviceClass === 'power' && m.available && Number.isFinite(Number(m.state)));
  const watts = power.length ? power.reduce((a, m) => a + (m.unit === 'kW' ? Number(m.state) * 1000 : Number(m.state)), 0) : null;
  const hasPlayer = (x: HomeDevice) => modules.some(m => m.def.Player && m.entities.camera === x.primary.id);
  const climate = d.find(x => x.kind === 'climate'), cameras = d.filter(x => x.kind === 'camera' && (x.primary.available || hasPlayer(x))).sort((a, b) => Number(hasPlayer(b)) - Number(hasPlayer(a)) || Number(typeof b.primary.attributes.entity_picture === 'string') - Number(typeof a.primary.attributes.entity_picture === 'string')), weather = d.find(x => x.kind === 'weather');
  const wtemp = weather && typeof weather.primary.attributes.temperature === 'number' ? weather.primary.attributes.temperature : null;
  // Home face = favourites + one summary module per group (Xiaomi Home «Освещение · всё выключено»), rooms underneath; everything else lives in Rooms and Systems.
  const favourites = d.filter(x => x.favorite && x !== climate && x.kind !== 'camera' && x.kind !== 'weather');
  const rooms = home.rooms.filter(r => !r.hidden);
  const groupDefs: Array<{ id: string; section: Section; icon: string; color: string; kinds: Kind[]; on?: (x: HomeDevice) => boolean }> = [
    { id: 'lights', section: 'lights', icon: 'light', color: '#8e8e93', kinds: ['light'], on: x => isOn(x.primary) },
    { id: 'climate', section: 'climate', icon: 'heating', color: '#ff9f0a', kinds: ['climate'], on: x => x.primary.available && x.primary.state !== 'off' },
    { id: 'cleaning', section: 'cleaning', icon: 'vacuum', color: '#5e5ce6', kinds: ['vacuum'] },
    { id: 'systems', section: 'systems', icon: 'systems', color: '#30d158', kinds: ['switch', 'socket', 'fan', 'cover', 'lock', 'valve', 'media', 'alarm_panel', 'environment', 'measurement', 'leak', 'opening', 'motion', 'alarm'] },
  ];
  const groups = groupDefs.map(g => { const list = d.filter(x => g.kinds.includes(x.kind) && !x.favorite && x !== climate); return { ...g, count: list.length, on: g.on ? list.filter(g.on).length : undefined, label: t(`section.${g.section}` as Key) }; }).filter(g => g.count > 0 && !config.sections[g.section]?.hidden);
  const temp = climate ? (typeof climate.primary.attributes.temperature === 'number' ? climate.primary.attributes.temperature : null) : null, cur = climate ? (typeof climate.primary.attributes.current_temperature === 'number' ? climate.primary.attributes.current_temperature : null) : null;
  const tempAction = climate ? actionsFor(climate).find(a => a.id === 'temperature') : undefined;
  const step = (dir: 1 | -1) => { if (climate && tempAction && temp !== null) void runner.run(climate, tempAction, Math.round((temp + dir * (tempAction.step ?? 0.5)) * 10) / 10); };
  const tile = (x: HomeDevice, section: Section = 'home') => <AccessoryTile device={x} name={canToggle(x) ? inRoomName(x, roomOf(x)) : x.name} room={canToggle(x) ? roomOf(x) : undefined} pending={runner.busy.has(x.key)} onToggle={canToggle(x) ? () => toggle(x) : undefined} onOpen={() => go({ section, device: x.key })} t={t} lang={lang} />;
  return <Cascade className="hm-home ah-home ah-grid ah-face" data-face="home-modular">
    <ClockTile now={now} lang={lang} />
    {climate && <ThermostatTile device={climate} sub={roomOf(climate)} target={temp} current={cur} onStep={tempAction ? step : undefined} onOpen={() => go({ section: 'home', device: climate.key })} t={t} lang={lang} disabled={runner.busy.has(climate.key)} />}
    {cameras.slice(0, 1).map(c => <CameraTile device={c} player={player(c, 'tile')} onOpen={() => go({ section: 'home', device: c.key })} t={t} lang={lang} large />)}
    {modules.filter(m => m.def.placement.includes('overview')).map(m => <div className="ah-tile ah-module" role="link" tabIndex={0} onClick={e => { if ((e.target as HTMLElement).closest('button, a, input, select, label')) return; go({ section: (m.def.placement.find(p => p !== 'overview') ?? 'systems') as Section }); }} onKeyDown={e => { if (e.key === 'Enter') go({ section: (m.def.placement.find(p => p !== 'overview') ?? 'systems') as Section }); }}><m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact /></div>)}
    {config.buttons.slice(0, 6).map(b => { const a = customAction(b); return <SceneTile icon={b.icon ?? 'more'} label={b.label} t={t} onClick={() => void runner.run({ key: `button:${b.id}`, name: b.label, primary: { available: true } } as HomeDevice, a)} />; })}
    {weather && <ValueTile icon="air" value={wtemp === null ? '—' : num(wtemp, lang, 0)} unit={wtemp === null ? undefined : '°'} label={weather.name} sub={stateText(weather.primary, t, lang)} color="#32ade6" onClick={() => go({ section: 'systems', device: weather.key })} className="at-weather" />}
    {co2 && <ValueTile icon="air" value={num(co2v!, lang, 0)} unit="ppm" label={t('overview.air')} sub={air.label} color={air.tone === 'danger' ? '#ff3b30' : air.tone === 'warning' ? '#ff9f0a' : '#30d158'} onClick={() => go({ section: 'systems' })} className={`hm-status tone-${air.tone}`} />}
    {watts !== null && <ValueTile icon="energy" value={watts >= 1000 ? num(watts / 1000, lang, 2) : num(watts, lang, 0)} unit={watts >= 1000 ? 'kW' : 'W'} label={t('overview.energy')} sub={t('overview.energy.now')} color="#30d158" onClick={() => go({ section: 'energy' })} className="hm-status tone-muted" />}
    {leaks.length > 0 && <ValueTile icon="water" value={wet.length ? t('state.wet') : leaksMute ? t('state.unknown') : t('overview.leaks.dry')} label={t('overview.leaks')} sub={wet.length ? wet.map(x => x.name).join(', ') : t('rooms.count', { n: leaks.length }).replace(/^\d+ /, `${leaks.length} `)} color={wet.length ? '#ff3b30' : leaksMute ? '#8e8e93' : '#32ade6'} onClick={() => go({ section: 'systems' })} className={`hm-status ${wet.length ? 'tone-danger' : leaksMute ? 'tone-muted' : 'tone-calm'}`} />}
    {cameras.slice(1).map(c => <CameraTile device={c} player={player(c, 'tile')} onOpen={() => go({ section: 'home', device: c.key })} t={t} lang={lang} />)}
    {groups.map(g => <ValueTile icon={g.icon} value={g.on !== undefined ? String(g.on) : g.id === 'cleaning' && g.count === 1 ? stateText(d.find(x => x.kind === 'vacuum')!.primary, t, lang).split(' · ')[0] : String(g.count)} unit={g.on !== undefined ? `/ ${g.count}` : undefined} label={g.label} sub={g.on !== undefined ? t('overview.on', { n: g.on }) : t('overview.devices', { n: g.count })} color={g.on ? '#ffcc00' : g.color} onClick={() => go({ section: g.section })} className={`ah-group-tile kind-${g.id}`} />)}
    {favourites.map(x => tile(x, x.kind === 'climate' ? 'climate' : 'home'))}
    {rooms.length > 0 && <div className="ah-rooms-strip"><div className="hm-section-head"><h2>{t('section.rooms')}</h2><button type="button" className="hm-text-btn" onClick={() => go({ section: 'rooms' })}>{t('ui.all')}<Icon name="next" size={18} /></button></div>
      <div className="hm-room-grid">{rooms.slice(0, 8).map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div></div>}
  </Cascade>;
}
function CameraTile({ device, player, onOpen, t, lang, large }: { device: HomeDevice; player?: JSX.Element | null; onOpen: () => void; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; large?: boolean }) {
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
  return <div className={`hm-card hm-camera-tile ah-camera ah-tile ${large ? 'is-large' : ''}`} role="button" tabIndex={0} onClick={onOpen}>
    <div className="hm-camera-frame">{player ? player : pic ? <img className="at-camera-img" src={pic} alt="" /> : <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{stateText(device.primary, t, lang)}</span></div>}{!player && <span className="hm-live"><i />{device.primary.available ? t('state.idle') : t('state.unavailable')}</span>}
      <div className="hm-camera-caption"><strong>{device.name}</strong><small>{device.model ?? ''}</small><Icon name="next" size={18} /></div></div>
  </div>;
}
function RoomPage({ home, registry, roomId, runner, toggle, go, t, lang }: Common & { home: Home; registry: Registry; roomId: string; toggle: (d: HomeDevice) => void }) {
  const c = roomClimate(home, registry, roomId), inRoom = home.devices.filter(d => d.enabled && d.roomId === roomId);
  const groups: Array<[Kind[], string]> = [[['light'], t('section.lights')], [['climate'], t('section.climate')], [['environment', 'leak', 'opening', 'motion', 'alarm', 'measurement'], t('group.sensors')], [['switch', 'socket', 'fan', 'cover', 'lock', 'valve', 'vacuum', 'media', 'camera', 'alarm_panel', 'energy', 'weather', 'person'], t('section.systems')]];
  return <div className="hm-room-page">
    <div className="ah-pills ah-room-pills">
      {c.temperature !== null && <Pill icon="thermo" color="#ff9f0a" label={t('metric.temperature')} value={`${num(c.temperature, lang)}°`} />}
      {c.humidity !== null && <Pill icon="water" color="#32ade6" label={t('metric.humidity')} value={`${num(c.humidity, lang, 0)} %`} />}
      {c.co2 !== null && <Pill icon="air" color="#30d158" label="CO₂" value={`${num(c.co2, lang, 0)} ppm`} />}
      {c.lights.length > 0 && <Pill icon="light" color={c.lights.some(l => isOn(l.primary)) ? '#ffcc00' : '#8e8e93'} label={t('section.lights')} value={`${c.lights.filter(l => isOn(l.primary)).length} / ${c.lights.length}`} />}
    </div>
    <div className="hm-room-columns">{groups.map(([kinds, title]) => { const list = inRoom.filter(d => kinds.includes(d.kind)); return list.length ? <Block title={title}><Tiles devices={list} section="rooms" room={roomId} runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={x => inRoomName(x, home.rooms.find(rm => rm.id === roomId)?.name ?? '')} /></Block> : null; })}</div>
  </div>;
}
function LightsPage({ devices, runner, toggle, go, t, lang, roomName }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  const on = devices.filter(d => isOn(d.primary));
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="hm-light-page"><div className="hm-toolbar"><span>{on.length ? t('overview.lights.on', { n: on.length }) : t('overview.lights.off')}</span>{on.length > 0 && <button type="button" className="hm-pill" onClick={() => on.forEach(toggle)}>{t('ui.lightsOff')}</button>}</div>
    <Tiles devices={devices} section="lights" runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={d => canToggle(d) ? inRoomName(d, roomName(d.roomId)) : d.name} roomOf={d => canToggle(d) ? roomName(d.roomId) : undefined as unknown as string} /></div>;
}
function ClimatePage({ devices, runner, go, t, lang, roomName }: Common & { devices: HomeDevice[]; roomName: (id: string) => string }) {
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="ah-grid ah-climate-grid">{devices.map(d => { const e = d.primary, acts = actionsFor(d), temp = acts.find(a => a.id === 'temperature'), target = typeof e.attributes.temperature === 'number' ? e.attributes.temperature : null, cur = typeof e.attributes.current_temperature === 'number' ? e.attributes.current_temperature : null;
    return <ThermostatTile device={d} sub={roomName(d.roomId)} target={target} current={cur} onStep={temp ? dir => target !== null && void runner.run(d, temp, Math.round((target + dir * (temp.step ?? 0.5)) * 10) / 10) : undefined} onOpen={() => go({ section: 'climate', device: d.key })} t={t} lang={lang} disabled={runner.busy.has(d.key)} />; })}</div>;
}
function KindList({ devices, runner, toggle, go, t, lang, roomName }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="ah-grid at-list">{devices.map(d => <div className="ah-tile-stack at-device" data-device-key={d.key}><AccessoryTile device={d} name={withRoom(d.name, roomName(d.roomId))} pending={runner.busy.has(d.key)} onToggle={canToggle(d) ? () => toggle(d) : undefined} onOpen={() => go({ section: 'cleaning', device: d.key })} t={t} lang={lang} wide />
    <div className="hm-chips">{actionsFor(d).filter(a => a.kind === 'button').map(a => <button type="button" disabled={runner.busy.has(d.key) || !d.primary.available} onClick={() => void runner.run(d, a)}>{t(a.label as Key)}</button>)}</div></div>)}</div>;
}
function EnergyPage({ devices, go, t, lang, roomName }: { devices: HomeDevice[]; go: Nav; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; roomName: (id: string) => string }) {
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  const pw = (d: HomeDevice) => { const m = d.metrics.find(x => x.deviceClass === 'power' && x.available); return m ? Number(m.state) * (m.unit === 'kW' ? 1000 : 1) : null; };
  const max = Math.max(1, ...devices.map(d => pw(d) ?? 0));
  return <div className="hm-energy"><div className="hm-energy-lines">{devices.map(d => { const w = pw(d); return <button type="button" className="hm-card hm-line" data-device-key={d.key} onClick={() => go({ section: 'energy', device: d.key })}>
    <span className="hm-line-head"><span className="ah-glyph is-small" style="--tile:#30d158"><Icon name="energy" size={16} /></span><strong>{d.name}</strong><span className="hm-badge">{roomName(d.roomId)}</span></span>
    <b>{w === null ? '—' : w >= 1000 ? `${num(w / 1000, lang, 2)} kW` : `${num(w, lang, 0)} W`}</b><span className="hm-meter"><i style={`width:${Math.round(100 * (w ?? 0) / max)}%`} /></span>
    <span className="hm-line-facts">{d.metrics.filter(m => m.deviceClass !== 'power').slice(0, 4).map(m => <span><small>{m.name}</small> {stateText(m, t, lang)}</span>)}</span>
  </button>; })}</div></div>;
}
function SystemsPage({ devices, runner, toggle, go, t, lang, roomName }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  const groups: Array<[Kind[], string]> = [[['leak', 'alarm', 'valve', 'lock', 'alarm_panel', 'opening', 'motion'], t('overview.leaks') + ' · ' + t('kind.alarm_panel')], [['environment', 'measurement'], t('overview.air')], [['socket', 'switch', 'fan', 'cover'], t('section.systems')], [['media', 'camera'], t('kind.media')], [['weather', 'person'], t('section.weather')]];
  const rendered = groups.filter(([kinds]) => devices.some(d => kinds.includes(d.kind)));
  if (!rendered.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="hm-systems">{rendered.map(([kinds, title]) => <Block title={title}><Tiles devices={devices.filter(d => kinds.includes(d.kind))} section="systems" runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={d => canToggle(d) ? inRoomName(d, roomName(d.roomId)) : d.name} roomOf={d => canToggle(d) ? roomName(d.roomId) : undefined as unknown as string} /></Block>)}</div>;
}
