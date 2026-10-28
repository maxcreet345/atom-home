import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { discover, roomClimate, NO_ROOM, type Home, type HomeDevice } from '../model/discover.ts';
import { SECTIONS, type Section, type Kind } from '../model/kinds.ts';
import type { Host } from '../runtime/host.ts';
import { actionsFor, serviceCall, customAction, type Action } from '../runtime/actions.ts';
import { translator, type Key } from '../i18n/index.ts';
import { StatusCard, Switch, RoomTile, LightTile, DeviceRow, Section as Block, metricLabel } from './cards.tsx';
import { DeviceSheet, type Runner } from './sheet.tsx';
import { stateText, isOn, num, co2Level, iconOfKind } from './format.ts';
import { Setup } from './setup.tsx';
import type { ConfigStore } from '../runtime/store.ts';

type View = { section: Section | 'setup'; room: string | null; device: string | null };
const NAV: Array<{ id: Section; icon: string }> = [{ id: 'home', icon: 'home' }, { id: 'rooms', icon: 'rooms' }, { id: 'lights', icon: 'light' }, { id: 'climate', icon: 'heating' }, { id: 'cleaning', icon: 'vacuum' }, { id: 'energy', icon: 'energy' }, { id: 'systems', icon: 'systems' }];
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
  useEffect(() => setConfig(initialConfig), [initialConfig]);
  const applyConfig = (next: HouseConfig) => { setConfig(next); onConfigChange?.(next); void store?.save(next).catch(() => undefined); };
  const lang = config.home.language, t = useMemo(() => translator(lang), [lang]);
  const home = useMemo(() => discover(registry, config), [registry, config]);
  const [view, setView] = useState<View>(() => decode(navigationWindow.location.hash));
  useEffect(() => { const pop = () => setView(decode(navigationWindow.location.hash)); navigationWindow.addEventListener('popstate', pop); navigationWindow.addEventListener('hashchange', pop); return () => { navigationWindow.removeEventListener('popstate', pop); navigationWindow.removeEventListener('hashchange', pop); }; }, [navigationWindow]);
  const go = (next: Partial<View>) => { const v = { section: view.section, room: null, device: null, ...next } as View; navigationWindow.history.pushState(null, '', encode(v)); setView(v); };
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set()), [toast, setToast] = useState(''), [more, setMore] = useState(false), [confirm, setConfirm] = useState<{ device: HomeDevice; action: Action; value?: unknown } | null>(null);
  const runner: Runner = {
    busy,
    async run(device, action, value) {
      if (action.confirm && !(confirm && confirm.device === device && confirm.action === action)) { setConfirm({ device, action, value }); return; }
      setConfirm(null); setBusy(s => new Set(s).add(device.key));
      try { const c = serviceCall(action, value); await host.call(c.domain, c.service, c.data); }
      catch (e) { setToast(e instanceof Error ? e.message : String(e)); setTimeout(() => setToast(''), 4000); }
      finally { setBusy(s => { const n = new Set(s); n.delete(device.key); return n; }); }
    },
  };
  const toggle = (d: HomeDevice) => { const a = actionsFor(d).find(x => x.id === 'toggle'); if (a) void runner.run(d, a, !a.current); };
  const wide = viewport.width >= 600, landscape = viewport.width > viewport.height, short = viewport.height <= 700;
  const now = useClock();
  const time = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const enabled = home.devices.filter(d => d.enabled);
  const hasPower = (d: HomeDevice) => d.metrics.some(m => m.deviceClass === 'power' || m.deviceClass === 'energy');
  const energyDevices = enabled.filter(d => d.kind === 'energy' || hasPower(d));
  const present = (s: Section) => s === 'home' || s === 'rooms' || s === 'systems' || (s === 'energy' ? energyDevices.length > 0 : enabled.some(d => d.section === s));
  const nav = NAV.filter(n => present(n.id) && !config.sections[n.id]?.hidden);
  const sideNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width, viewport.height]);
  const tabNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width]);
  const device = view.device ? enabled.find(d => d.key === view.device) : undefined;
  const roomName = (id: string) => home.rooms.find(r => r.id === id)?.name || t('room.none');
  const title = view.section === 'setup' ? t('setup.title') : view.section === 'rooms' && view.room ? roomName(view.room) : view.section === 'home' ? home.name : t(`section.${view.section}` as Key);
  const subtitle = view.section === 'home' ? `${greeting(now, t)} · ${date}` : view.section === 'rooms' && !view.room ? t('rooms.count', { n: home.rooms.filter(r => !r.hidden).length }) : view.section === 'lights' ? `${enabled.filter(d => d.kind === 'light' && isOn(d.primary)).length} / ${enabled.filter(d => d.kind === 'light').length}` : '';
  const pageKey = `${view.section}/${view.room ?? ''}`;
  const modal = !!device || !!confirm || more;
  return <div className={`hm-shell daily-shell at-shell ${wide && !short ? 'daily-fit-screen' : ''} ${wide ? 'is-wide' : 'is-narrow'} ${wide && viewport.width < 760 ? 'is-compact' : ''} ${landscape ? 'is-landscape' : 'is-portrait'} ${short ? 'is-short' : ''} hm-route-${view.section}`} lang={lang} data-theme={config.home.theme} style={`--hm-height:${viewport.height}px`}>
    {wide && <aside className="hm-sidebar" inert={modal || undefined}>
      <div className="hm-clock"><strong>{time}</strong><small>{date.split(',')[0]}</small></div>
      <nav aria-label={t('section.more')} ref={sideNav}><i className="hm-nav-ind" aria-hidden="true" />{nav.map(n => <button type="button" className={view.section === n.id ? 'is-active' : ''} aria-current={view.section === n.id ? 'page' : undefined} onClick={() => go({ section: n.id })}><Icon name={n.icon} size={24} /><span>{t(`section.${n.id}` as Key)}</span></button>)}{host.admin && <button type="button" className={`at-setup-nav ${view.section === 'setup' ? 'is-active' : ''}`} aria-current={view.section === 'setup' ? 'page' : undefined} onClick={() => go({ section: 'setup' })}><Icon name="settings" size={24} /><span>{t('section.settings')}</span></button>}</nav>
      <button type="button" className={`hm-conn ${host.online ? '' : 'is-off'}`} aria-label={host.online ? t('ui.online') : t('ui.offline')}><i />{host.online ? t('ui.online') : t('ui.offline')}</button>
    </aside>}
    <main className="hm-main" inert={modal || undefined}>
      <header className="hm-head">
        {view.section === 'rooms' && view.room ? <button type="button" className="hm-back" onClick={() => go({ section: 'rooms' })}><Icon name="back" size={20} />{t('section.rooms')}</button> : null}
        <div className="hm-head-title" key={pageKey}><h1>{title}</h1><p>{subtitle}</p></div>
        {!wide && <span className="hm-head-time">{time}</span>}
        {!host.online && <span className="hm-badge tone-danger">{t('ui.offline')}</span>}
      </header>
      <div className="hm-page" key={pageKey}>
        {view.section === 'home' && <Overview home={home} registry={registry} config={config} runner={runner} toggle={toggle} go={go} t={t} lang={lang} landscape={landscape} />}
        {view.section === 'rooms' && !view.room && <div className="hm-room-grid is-page">{home.rooms.filter(r => !r.hidden).map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div>}
        {view.section === 'rooms' && view.room && <RoomPage home={home} registry={registry} roomId={view.room} runner={runner} toggle={toggle} go={go} t={t} lang={lang} />}
        {view.section === 'lights' && <LightsPage devices={enabled.filter(d => d.kind === 'light')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} />}
        {view.section === 'climate' && <ClimatePage devices={enabled.filter(d => d.section === 'climate')} runner={runner} go={go} t={t} lang={lang} />}
        {view.section === 'cleaning' && <KindList devices={enabled.filter(d => d.section === 'cleaning')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} />}
        {view.section === 'energy' && <EnergyPage devices={energyDevices} go={go} t={t} lang={lang} roomName={roomName} />}
        {view.section === 'setup' && <Setup registry={registry} config={config} onChange={applyConfig} admin={host.admin} t={t} lang={lang} storeLabel={store?.label ?? 'memory'} warnings={configWarnings} />}
        {view.section === 'systems' && <SystemsPage devices={enabled.filter(d => d.section === 'systems' || d.section === 'camera' || d.section === 'weather')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} />}
      </div>
    </main>
    {!wide && <nav className="hm-tabbar" aria-label={t('section.more')} inert={modal || undefined} ref={tabNav}><i className="hm-nav-ind" aria-hidden="true" />{[...nav.slice(0, 4), ...(nav.length > 4 || host.admin ? [{ id: 'more' as const, icon: 'more' }] : [])].map(n => <button type="button" className={(n.id === 'more' ? view.section === 'setup' || nav.slice(4).some(x => x.id === view.section) : view.section === n.id) ? 'is-active' : ''} onClick={() => n.id === 'more' ? setMore(true) : go({ section: n.id })}><Icon name={n.icon} size={24} /><span>{t(`section.${n.id}` as Key)}</span></button>)}</nav>}
    {more && <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) setMore(false); }}><section className="hm-sheet is-small" role="dialog" aria-modal="true" aria-label={t('section.more')}><div className="hm-sheet-body"><div className="hm-sheet-head"><div><h2>{t('section.more')}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={() => setMore(false)}>×</button></div><div className="hm-more">{nav.slice(4).map(n => <button type="button" onClick={() => { setMore(false); go({ section: n.id }); }}><Icon name={n.icon} size={26} /><span>{t(`section.${n.id}` as Key)}</span></button>)}{host.admin && <button type="button" onClick={() => { setMore(false); go({ section: 'setup' }); }}><Icon name="settings" size={26} /><span>{t('section.settings')}</span></button>}</div></div></section></div>}
    {device && <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) go({ section: view.section, room: view.room }); }}><section className="hm-sheet" role="dialog" aria-modal="true" aria-label={device.name}><DeviceSheet device={device} runner={runner} onClose={() => go({ section: view.section, room: view.room })} t={t} lang={lang} /></section></div>}
    {confirm && <div className="hm-scrim is-top" onClick={e => { if (e.target === e.currentTarget) setConfirm(null); }}><div className="hm-confirm" role="alertdialog" aria-modal="true" aria-label={t('confirm.title')}><h2>{t('confirm.title')}</h2><p>{t('confirm.text', { action: t(confirm.action.label as Key) === confirm.action.label ? confirm.action.label : t(confirm.action.label as Key), device: confirm.device.name })}</p><div><button type="button" className="hm-pill" onClick={() => setConfirm(null)}>{t('confirm.no')}</button><button type="button" className="hm-pill is-primary" onClick={() => void runner.run(confirm.device, confirm.action, confirm.value)}>{t('confirm.yes')}</button></div></div></div>}
    {toast && <div className="hm-toast" role="alert" onClick={() => setToast('')}><Icon name="warning" size={18} /><span>{toast}</span></div>}
  </div>;
}
function useClock() { const [now, setNow] = useState(() => new Date()); useEffect(() => { const i = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(i); }, []); return now; }
const greeting = (now: Date, t: ReturnType<typeof translator>) => { const h = now.getHours(); return t(h < 6 ? 'overview.greeting.night' : h < 12 ? 'overview.greeting.morning' : h < 18 ? 'overview.greeting.day' : 'overview.greeting.evening'); };
type Nav = (next: Partial<View>) => void;
type Common = { runner: Runner; go: Nav; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en' };

function Overview({ home, registry, config, runner, toggle, go, t, lang, landscape }: Common & { home: Home; registry: Registry; config: HouseConfig; toggle: (d: HomeDevice) => void; landscape: boolean }) {
  const d = home.devices.filter(x => x.enabled);
  const lights = d.filter(x => x.kind === 'light'), lightsOn = lights.filter(x => isOn(x.primary));
  const leaks = d.filter(x => x.kind === 'leak'), wet = leaks.filter(x => x.primary.state === 'on'), dryAll = leaks.length > 0 && leaks.every(x => x.primary.available && x.primary.state === 'off');
  const co2 = d.flatMap(x => x.metrics).find(m => m.deviceClass === 'carbon_dioxide' && m.available && Number.isFinite(Number(m.state)));
  const co2v = co2 ? Number(co2.state) : null, air = co2Level(co2v, t);
  const power = d.flatMap(x => x.metrics).filter(m => m.deviceClass === 'power' && m.available && Number.isFinite(Number(m.state)));
  const watts = power.length ? power.reduce((a, m) => a + (m.unit === 'kW' ? Number(m.state) * 1000 : Number(m.state)), 0) : null;
  const climate = d.find(x => x.kind === 'climate'), cameras = d.filter(x => x.kind === 'camera'), camera = cameras.find(x => x.primary.available && typeof x.primary.attributes.entity_picture === 'string') ?? cameras.find(x => x.primary.available) ?? cameras[0], weather = d.find(x => x.kind === 'weather');
  const rooms = home.rooms.filter(r => !r.hidden).slice(0, 8);
  const buttons = config.buttons;
  return <div className={`hm-home ${landscape ? 'is-landscape' : ''} ${buttons.length ? '' : 'at-no-quick'} ${camera || weather ? '' : 'at-no-media'}`}>
    {(camera || weather) && <div className={`hm-home-media ${camera && weather ? '' : 'at-single'}`}>
      {camera && <CameraTile device={camera} onOpen={() => go({ section: 'home', device: camera.key })} t={t} lang={lang} />}
      {weather && <div className="hm-weather-slot"><WeatherCard device={weather} t={t} lang={lang} /></div>}
    </div>}
    <div className="hm-home-status">
      {climate && <ClimateInline device={climate} runner={runner} go={go} t={t} lang={lang} />}
      <StatusCard icon="light" title={t('overview.lights')} value={lightsOn.length ? t('overview.lights.on', { n: lightsOn.length }) : t('overview.lights.off')} hint={`${lights.length}`} tone={lightsOn.length ? 'active' : 'muted'} onClick={() => go({ section: 'lights' })} />
      <StatusCard icon="water" title={t('overview.leaks')} value={wet.length ? t('state.wet') : dryAll ? t('overview.leaks.dry') : leaks.length ? t('state.unknown') : t('overview.leaks.none')} hint={wet.length ? wet.map(x => x.name).join(', ') : leaks.map(x => x.name).join(', ')} tone={wet.length ? 'danger' : dryAll ? 'calm' : 'muted'} onClick={() => go({ section: 'systems' })} />
      <StatusCard icon="air" title={t('overview.air')} value={co2v === null ? '—' : `${num(co2v, lang, 0)} ppm`} hint={air.label} tone={air.tone} onClick={() => co2 && go({ section: 'systems' })} />
      <StatusCard icon="energy" title={t('overview.energy')} value={watts === null ? '—' : watts >= 1000 ? `${num(watts / 1000, lang, 2)} kW` : `${num(watts, lang, 0)} W`} hint={t('overview.energy.now')} tone="muted" onClick={() => go({ section: 'energy' })} />
    </div>
    {buttons.length > 0 && <section className="hm-quick" aria-label={t('action.custom')}>{buttons.slice(0, 5).map(b => { const a = customAction(b); return <div className="hm-card hm-scene hm-scene-custom"><button type="button" className="hm-scene-hit" onClick={() => void runner.run({ key: `button:${b.id}`, name: b.label, primary: { available: true } } as HomeDevice, a)}><span className="hm-scene-icon"><Icon name={b.icon ?? 'more'} size={24} /></span><strong>{b.label}</strong></button></div>; })}</section>}
    <Block title={t('section.rooms')} className="hm-home-rooms" action={<button type="button" className="hm-text-btn" onClick={() => go({ section: 'rooms' })}>{t('ui.all')}<Icon name="next" size={16} /></button>}>
      <div className="hm-room-grid">{rooms.map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div>
    </Block>
  </div>;
}
function ClimateInline({ device, runner, go, t, lang }: Common & { device: HomeDevice }) {
  const e = device.primary, acts = actionsFor(device), temp = acts.find(a => a.id === 'temperature'), mode = acts.find(a => a.id === 'hvac_mode'), on = e.state !== 'off' && e.available;
  const target = typeof e.attributes.temperature === 'number' ? e.attributes.temperature : null;
  const step = (dir: 1 | -1) => temp && target !== null && void runner.run(device, temp, Math.round((target + dir * (temp.step ?? 0.5)) * 10) / 10);
  return <section className={`hm-card hm-thermo ${on ? 'is-on' : ''}`}>
    <button type="button" className="hm-thermo-head" onClick={() => go({ section: 'climate', device: device.key })}><Icon name="heating" size={22} /><span><strong>{device.name}</strong><small>{stateText(e, t, lang)}</small></span></button>
    {temp && <div className="hm-stepper"><button type="button" className="hm-round" aria-label="−" disabled={!e.available} onClick={() => step(-1)}>−</button><div className="hm-stepper-value"><strong>{target === null ? '—' : num(target, lang)}<span>°</span></strong></div><button type="button" className="hm-round" aria-label="+" disabled={!e.available} onClick={() => step(1)}>+</button></div>}
    {mode && <Switch on={on} large label={device.name} disabled={!e.available} onToggle={() => void runner.run(device, mode, on ? 'off' : (mode.options ?? []).find(o => o !== 'off') ?? 'heat')} />}
  </section>;
}
function CameraTile({ device, onOpen, t, lang }: { device: HomeDevice; onOpen: () => void; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en' }) {
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
  return <div className="hm-card hm-camera-tile" role="button" tabIndex={0} onClick={onOpen}>
    <div className="hm-camera-frame">{pic ? <img className="at-camera-img" src={pic} alt="" /> : <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{stateText(device.primary, t, lang)}</span></div>}<span className={`hm-live ${device.primary.available ? 'is-live' : ''}`}><i />{device.primary.available ? t('state.idle') : t('state.unavailable')}</span></div>
    <div className="hm-camera-caption"><strong>{device.name}</strong><small>{device.model ?? ''}</small><Icon name="next" size={18} /></div>
  </div>;
}
function WeatherCard({ device, t, lang }: { device: HomeDevice; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en' }) {
  const a = device.primary.attributes, temp = typeof a.temperature === 'number' ? a.temperature : null;
  const rows: Array<[string, string]> = [[t('metric.humidity'), typeof a.humidity === 'number' ? `${num(a.humidity, lang, 0)} %` : '—'], ['Wind', typeof a.wind_speed === 'number' ? `${num(a.wind_speed, lang)} ${String(a.wind_speed_unit ?? '')}` : '—'], [t('metric.pressure'), typeof a.pressure === 'number' ? `${num(a.pressure, lang)} ${String(a.pressure_unit ?? '')}` : '—']];
  return <div className="daily-card daily-weather-card weather-overview hm-card at-weather"><div className="weather-heading"><span>{device.name}</span></div><div className="weather-current"><div className="weather-main"><div className="weather-temperature">{temp === null ? '—' : num(temp, lang)}<span>°C</span></div><div className="weather-condition">{t(`state.${device.primary.state}` as Key) === `state.${device.primary.state}` ? device.primary.state : t(`state.${device.primary.state}` as Key)}</div></div><Icon name="air" size={64} /></div><div className="weather-readings">{rows.map(([k, v]) => <span><small>{k}</small><strong>{v}</strong></span>)}</div></div>;
}
function RoomPage({ home, registry, roomId, runner, toggle, go, t, lang }: Common & { home: Home; registry: Registry; roomId: string; toggle: (d: HomeDevice) => void }) {
  const c = roomClimate(home, registry, roomId), inRoom = home.devices.filter(d => d.enabled && d.roomId === roomId);
  const groups: Array<[Kind[], string]> = [[['light'], t('section.lights')], [['climate'], t('section.climate')], [['environment', 'leak', 'opening', 'motion', 'alarm', 'measurement'], t('kind.environment')], [['switch', 'socket', 'fan', 'cover', 'lock', 'valve', 'vacuum', 'media', 'camera', 'alarm_panel', 'energy', 'weather', 'person'], t('section.systems')]];
  return <div className="hm-room-page">
    <section className="hm-card hm-room-hero at-room-hero"><div className="hm-room-hero-body"><div><b>{c.temperature === null ? '—' : num(c.temperature, lang)}<i>°</i></b><small>{c.humidity === null ? '' : `${t('metric.humidity')} ${num(c.humidity, lang, 0)}%`}</small></div><dl>{c.co2 !== null && <div><dt>CO₂</dt><dd>{num(c.co2, lang, 0)} ppm</dd></div>}<div><dt>{t('section.lights')}</dt><dd>{c.lights.length ? `${c.lights.filter(l => isOn(l.primary)).length} / ${c.lights.length}` : '—'}</dd></div></dl></div></section>
    <div className="hm-room-columns">{groups.map(([kinds, title]) => { const list = inRoom.filter(d => kinds.includes(d.kind)); return list.length ? <Block title={title}><div className="hm-rows">{list.map(d => <DeviceRow device={d} pending={runner.busy.has(d.key)} onToggle={actionsFor(d).some(a => a.id === 'toggle') ? () => toggle(d) : undefined} onOpen={() => go({ section: 'rooms', room: roomId, device: d.key })} t={t} lang={lang} />)}</div></Block> : null; })}</div>
  </div>;
}
function LightsPage({ devices, runner, toggle, go, t, lang }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void }) {
  const on = devices.filter(d => isOn(d.primary));
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="hm-light-page"><div className="hm-toolbar"><span>{on.length ? t('overview.lights.on', { n: on.length }) : t('overview.lights.off')}</span>{on.length > 0 && <button type="button" className="hm-pill" onClick={() => on.forEach(toggle)}>{t('ui.lightsOff')}</button>}</div>
    <div className="hm-light-grid">{devices.map(d => <LightTile device={d} pending={runner.busy.has(d.key)} onToggle={() => toggle(d)} onOpen={() => go({ section: 'lights', device: d.key })} t={t} lang={lang} />)}</div></div>;
}
function ClimatePage({ devices, runner, go, t, lang }: Common & { devices: HomeDevice[] }) {
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="at-climate-grid">{devices.map(d => { const e = d.primary, acts = actionsFor(d), temp = acts.find(a => a.id === 'temperature'), mode = acts.find(a => a.id === 'hvac_mode'), on = e.state !== 'off' && e.available, target = typeof e.attributes.temperature === 'number' ? e.attributes.temperature : null, cur = typeof e.attributes.current_temperature === 'number' ? e.attributes.current_temperature : null;
    return <section className={`hm-card at-climate ${on ? 'is-on' : ''} ${e.available ? '' : 'is-off'}`} data-device-key={d.key}>
      <button type="button" className="hm-thermo-head" onClick={() => go({ section: 'climate', device: d.key })}><Icon name="heating" size={22} /><span><strong>{d.name}</strong><small>{stateText(e, t, lang)}</small></span></button>
      <div className="at-climate-body"><div className="at-climate-now"><b>{cur === null ? '—' : num(cur, lang)}<i>°</i></b><small>{t('ui.now')}</small></div>
        {temp && <div className="hm-stepper"><button type="button" className="hm-round" aria-label="−" disabled={!e.available || target === null} onClick={() => target !== null && void runner.run(d, temp, Math.round((target - (temp.step ?? 0.5)) * 10) / 10)}>−</button><div className="hm-stepper-value"><strong>{target === null ? '—' : num(target, lang)}<span>°</span></strong><small>{t('ui.target')}</small></div><button type="button" className="hm-round" aria-label="+" disabled={!e.available || target === null} onClick={() => target !== null && void runner.run(d, temp, Math.round((target + (temp.step ?? 0.5)) * 10) / 10)}>+</button></div>}</div>
      {mode && <div className="hm-chips">{(mode.options ?? []).map(o => <button type="button" className={e.state === o ? 'is-active' : ''} disabled={!e.available} onClick={() => void runner.run(d, mode, o)}>{t(`state.${o}` as Key) === `state.${o}` ? o : t(`state.${o}` as Key)}</button>)}</div>}
    </section>; })}</div>;
}
function KindList({ devices, runner, toggle, go, t, lang, roomName }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="hm-rows at-list">{devices.map(d => <div className="hm-card at-device" data-device-key={d.key}><DeviceRow device={d} name={`${d.name} · ${roomName(d.roomId)}`} pending={runner.busy.has(d.key)} onToggle={actionsFor(d).some(a => a.id === 'toggle') ? () => toggle(d) : undefined} onOpen={() => go({ section: 'cleaning', device: d.key })} t={t} lang={lang} />
    <div className="hm-chips">{actionsFor(d).filter(a => a.kind === 'button').map(a => <button type="button" disabled={runner.busy.has(d.key) || !d.primary.available} onClick={() => void runner.run(d, a)}>{t(a.label as Key)}</button>)}</div></div>)}</div>;
}
function EnergyPage({ devices, go, t, lang, roomName }: { devices: HomeDevice[]; go: Nav; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; roomName: (id: string) => string }) {
  if (!devices.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  const pw = (d: HomeDevice) => { const m = d.metrics.find(x => x.deviceClass === 'power' && x.available); return m ? Number(m.state) * (m.unit === 'kW' ? 1000 : 1) : null; };
  const max = Math.max(1, ...devices.map(d => pw(d) ?? 0));
  return <div className="hm-energy"><div className="hm-energy-lines">{devices.map(d => { const w = pw(d); const en = d.metrics.find(x => x.deviceClass === 'energy'); return <button type="button" className="hm-card hm-line" data-device-key={d.key} onClick={() => go({ section: 'energy', device: d.key })}>
    <span className="hm-line-head"><strong>{d.name}</strong><span className="hm-badge">{roomName(d.roomId)}</span></span>
    <b>{w === null ? '—' : w >= 1000 ? `${num(w / 1000, lang, 2)} kW` : `${num(w, lang, 0)} W`}</b><span className="hm-meter"><i style={`width:${Math.round(100 * (w ?? 0) / max)}%`} /></span>
    <span className="hm-line-facts">{d.metrics.filter(m => m.deviceClass !== 'power').slice(0, 3).map(m => <span>{metricLabel(m, t)} {stateText(m, t, lang)}</span>)}{en && <span>{metricLabel(en, t)}: {stateText(en, t, lang)}</span>}</span>
  </button>; })}</div></div>;
}
function SystemsPage({ devices, runner, toggle, go, t, lang, roomName }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  const groups: Array<[Kind[], string]> = [[['leak', 'alarm', 'valve', 'lock', 'alarm_panel', 'opening', 'motion'], t('overview.leaks') + ' · ' + t('kind.alarm_panel')], [['environment', 'measurement'], t('overview.air')], [['socket', 'switch', 'fan', 'cover'], t('section.systems')], [['media', 'camera'], t('kind.media')], [['weather', 'person'], t('section.weather')]];
  const rendered = groups.filter(([kinds]) => devices.some(d => kinds.includes(d.kind)));
  if (!rendered.length) return <p className="hm-muted">{t('ui.nodevices')}</p>;
  return <div className="hm-systems">{rendered.map(([kinds, title]) => <Block title={title}><div className="hm-rows">{devices.filter(d => kinds.includes(d.kind)).map(d => <DeviceRow device={d} name={`${d.name} · ${roomName(d.roomId)}`} pending={runner.busy.has(d.key)} onToggle={actionsFor(d).some(a => a.id === 'toggle') ? () => toggle(d) : undefined} onOpen={() => go({ section: 'systems', device: d.key })} t={t} lang={lang} />)}</div></Block>)}</div>;
}
