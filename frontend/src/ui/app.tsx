import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { discover, roomClimate, NO_ROOM, type Home, type HomeDevice, type Room, type EntityRef } from '../model/discover.ts';
import { SECTIONS, type Section, type Kind } from '../model/kinds.ts';
import type { Host, AutomationRow } from '../runtime/host.ts';
import { actionsFor, serviceCall, customAction, type Action } from '../runtime/actions.ts';
import { translator, type Key } from '../i18n/index.ts';
import { RoomTile, AccessoryTile, ThermostatTile, ClockTile as PlainClockTile, SceneTile, ValueTile, Pill, Section as Block, artOf } from './cards.tsx';
import { ClockTile, ClockSheet, beep, armBeep } from '../modules/clock.tsx';
import { FeederSheet } from '../modules/pet-feeder.tsx';
import { AirSheet } from '../modules/air.tsx';
import type { Alarm } from '../model/config.ts';
import { DeviceSheet, heatOn, type Runner } from './sheet.tsx';
import { stateText, isOn, num, co2Level, withRoom } from './format.ts';
import { metricLabel } from './cards.tsx';
import { Setup } from './setup.tsx';
import { activeModules, claimedEntities, type ActiveModule, type TileState, type AutoClose } from '../modules/index.ts';
import type { JSX } from 'preact';
import { SaveError, type ConfigStore } from '../runtime/store.ts';
import { Cascade } from './motion.tsx';
import { LightRows } from './light-rows.tsx';
import { boilerDeviceIds, isElectric } from '../model/energy.ts';
import { EnergyTile } from './energy-tile.tsx';
import { EnergyPanel } from './energy-page.tsx';
import { gridIds, type EnergyPrefs } from '../model/energy-load.ts';
import { HeadTools } from './head-tools.tsx';
import { meterName } from '../model/energy-load.ts';
import { CamerasTile, CamerasPanel, type CamView } from './cameras.tsx';
import { HeatingTile, HeatingPanel } from './heating.tsx';
import { readHeating } from '../model/heating.ts';
import { readSecurity } from '../model/security.ts';
import { SecurityTile, SecurityPanel } from './security.tsx';
import { readOfficeSecurity } from '../model/office-security.ts';
import { OfficeSecurityTile, OfficeSecurityPanel } from './office-security.tsx';
import { VacuumTile, VacuumPanel, VacuumSettings } from './vacuum.tsx';
import { readVacuum } from '../model/vacuum.ts';
import { RoomView, type RoomLayout } from './room.tsx';
import { OfficeClimateTile, OfficeClimatePanel } from './office-climate.tsx';
import { readOfficeClimate } from '../model/office-climate.ts';
import { currentEvents, focusCamera, holdEnded, sensorsOf, type CamEvent } from '../model/cameras.ts';

type View = { section: Section | 'setup'; room: string | null; device: string | null; filter: string | null };
/** Apple Home-style navigation: Home · Rooms · Systems (+ Settings for admins). The former per-kind screens live under Systems as segments. */
const NAV: Array<{ id: Section; icon: string }> = [{ id: 'home', icon: 'home' }, { id: 'rooms', icon: 'rooms' }, { id: 'lights', icon: 'light' }, { id: 'systems', icon: 'systems' }]; // «Свет» is its own entry under Rooms (owner's wish, 04.11.2026)
const SYSTEM_TABS: Section[] = ['security', 'climate', 'cleaning', 'energy', 'camera', 'systems']; // «Безопасность» first (owner, 09.11.2026) // «Камеры» is the panel of every camera (owner, 09.11.2026)
const decode = (hash: string): View => { const [s, q = ''] = hash.replace(/^#/, '').split('?'); const p = new URLSearchParams(q); return { section: s === 'setup' ? 'setup' : (SECTIONS as readonly string[]).includes(s) ? s as Section : 'home', room: p.get('room'), device: p.get('device'), filter: p.get('filter') }; };
const encode = (v: View) => { const p = new URLSearchParams(); if (v.room) p.set('room', v.room); if (v.device) p.set('device', v.device); if (v.filter) p.set('filter', v.filter); return `#${v.section}${p.size ? '?' + p : ''}`; };
function useNavIndicator<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  // F15 of the audit: read the geometry in the next frame, after layout, so the commit never forces a synchronous reflow
  useEffect(() => { const nav = ref.current; if (!nav) return; const raf = requestAnimationFrame(() => { const a = nav.querySelector<HTMLElement>('button.is-active'); nav.style.setProperty('--hm-ind-on', a ? '1' : '0'); if (!a) return; nav.style.setProperty('--hm-ind-x', `${a.offsetLeft}px`); nav.style.setProperty('--hm-ind-y', `${a.offsetTop}px`); nav.style.setProperty('--hm-ind-w', `${a.offsetWidth}px`); nav.style.setProperty('--hm-ind-h', `${a.offsetHeight}px`); }); return () => cancelAnimationFrame(raf); }, deps);
  return ref;
}
export interface AppProps { registry: Registry; config: HouseConfig; host: Host; viewport: { width: number; height: number }; navigationWindow?: Window; store?: ConfigStore; configWarnings?: string[]; onConfigChange?: (next: HouseConfig) => void }
/** The whole panel: pure function of (registry + states, config). Commands go through the host and are confirmed by state changes. */
export function AtomApp({ registry, config: initialConfig, host, viewport, navigationWindow = window, store, configWarnings = [], onConfigChange }: AppProps) {
  const [config, setConfig] = useState(initialConfig);
  const confirmed = useRef(initialConfig);
  useEffect(() => { setConfig(initialConfig); confirmed.current = initialConfig; }, [initialConfig]);
  /** Shown at once, kept only once the store confirms. A refused save returns to the last confirmed config (after a conflict: the fresh one) and rejects, so the caller does not report success. */
  /** Saves can overlap (two quick language picks): only the newest one decides what the panel shows, unless it has already failed, so the panel never stays on a value the house does not hold. */
  const saveSeq = useRef(0), failedSeq = useRef(0);
  const applyConfig = async (next: HouseConfig) => {
    const seq = ++saveSeq.current;
    setConfig(next); onConfigChange?.(next);
    if (!store) return;
    try { await store.save(next); confirmed.current = next; if (seq === saveSeq.current || failedSeq.current === saveSeq.current) { setConfig(next); onConfigChange?.(next); } }
    catch (e) {
      const code = e instanceof SaveError ? e.code : 'failed';
      if (code === 'conflict') { try { confirmed.current = (await store.load()).config; } catch { /* keep the last confirmed copy */ } }
      if (seq !== saveSeq.current) throw e; // a newer save is on its way and will settle the panel
      failedSeq.current = seq;
      setConfig(confirmed.current); onConfigChange?.(confirmed.current);
      notify(translator(confirmed.current.home.language)(`save.error.${code}` as Key), 6000);
      throw e;
    }
  };
  /** Alarms go through the store's own command (any user); the local config follows the backend's answer. */
  const applyAlarms = async (alarms: Alarm[]) => {
    if (!store?.saveAlarms) { const next = { ...config, alarms }; await applyConfig(next); return; }
    const r = await store.saveAlarms(alarms).catch((e: unknown) => { notify(e instanceof Error ? e.message : String(e)); throw e; });
    const next = { ...config, alarms: r.alarms }; setConfig(next); confirmed.current = next; onConfigChange?.(next);
  };
  const lang = config.home.language, t = useMemo(() => translator(lang), [lang]);
  const modules = useMemo(() => activeModules(registry, config), [registry, config]);
  const claimed = useMemo(() => claimedEntities(registry, config, modules), [registry, config, modules]);
  const home = useMemo(() => discover(registry, config, claimed), [registry, config, claimed]);
  const [view, setView] = useState<View>(() => decode(navigationWindow.location.hash));
  /** The module that plays a camera: its own `camera`, or one of its `cameras` (a two-lens camera). */
  const camerasOf = (m: ActiveModule) => m.def.cameras?.(m.entities) ?? (m.entities.camera ? [m.entities.camera] : []);
  const modFor = (dev: HomeDevice) => modules.find(m => (m.def.Player || m.def.Sheet || m.def.tileState) && camerasOf(m).includes(dev.primary.id));
  const player = (dev: HomeDevice, mode: 'tile' | 'stage') => { if (mode === 'tile' && view.device) return null; /* one stream at a time: the sheet's stage replaces the tile player */ const m = modFor(dev); const P = m?.def.Player; const poster = typeof dev.primary.attributes.entity_picture === 'string' ? dev.primary.attributes.entity_picture : null; return m && P ? <P key={`${m.def.id}:${dev.key}:${mode}`} entities={m.entities} options={m.options} host={host} t={t} lang={lang} mode={mode} poster={poster} camera={dev.primary.id} /> : null; };
  /** What the camera's module says about it for the tile (closed lens, second line). */
  const tileState = (dev: HomeDevice): TileState | null => { const m = modFor(dev); return m?.def.tileState ? m.def.tileState(registry, m.entities, t, lang) : null; };
  useEffect(() => { const pop = () => setView(decode(navigationWindow.location.hash)); navigationWindow.addEventListener('popstate', pop); navigationWindow.addEventListener('hashchange', pop); return () => { navigationWindow.removeEventListener('popstate', pop); navigationWindow.removeEventListener('hashchange', pop); }; }, [navigationWindow]);
  const go = (next: Partial<View>) => { const v = { section: view.section, room: null, device: null, filter: null, ...next } as View; navigationWindow.history.pushState(null, '', encode(v)); setView(v); };
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set()), [toast, setToast] = useState(''), [confirm, setConfirm] = useState<{ device: HomeDevice; action: Action; value?: unknown } | null>(null);
  const notify = (text: string, ms = 4000) => { setToast(text); setTimeout(() => setToast(cur => cur === text ? '' : cur), ms); };
  // AUTO-2 of the audit: which HA automations touch a card (read-only); loaded once, refreshed when the host changes
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  useEffect(() => { let alive = true; void host.automations?.().then(rows => { if (alive) setAutomations(rows); }); return () => { alive = false; }; }, [host, view.device]); // refreshed whenever a sheet opens, so «last ran» is current
  const automationsFor = (dev: HomeDevice) => { const ids = new Set([dev.primary, ...dev.controls, ...dev.metrics, ...dev.parameters].map(x => x.id)); return automations.filter(a => a.entities.some(id => ids.has(id)) || (dev.haDeviceId !== null && a.devices.includes(dev.haDeviceId))).map(a => ({ ...a, byRoom: false })).concat(automations.filter(a => !a.entities.some(id => ids.has(id)) && !(dev.haDeviceId !== null && a.devices.includes(dev.haDeviceId)) && a.areas.includes(dev.roomId) && ['light', 'climate', 'switch', 'socket', 'cover', 'fan'].includes(dev.kind)).map(a => ({ ...a, byRoom: true }))); };
  const busyRef = useRef<Set<string>>(new Set()); // ST-3 of the audit: synchronous, so a second tap before the first render is dropped
  const runner: Runner = {
    busy,
    async run(device, action, value) {
      if (action.confirm && !(confirm && confirm.device === device && confirm.action === action)) { setConfirm({ device, action, value }); return; }
      if (action.kind !== 'number' && busyRef.current.has(device.key)) return; // a double tap sends one command; sliders keep streaming
      if (!host.online) { setConfirm(null); notify(t('ui.offline')); return; } // ST-4: nothing is queued while the home is unreachable
      setConfirm(null); busyRef.current.add(device.key); setBusy(s => new Set(s).add(device.key));
      try { const c = serviceCall(action, value); await host.call(c.domain, c.service, c.data); }
      catch (e) { notify(e instanceof Error ? e.message : String(e)); }
      finally { busyRef.current.delete(device.key); setBusy(s => { const n = new Set(s); n.delete(device.key); return n; }); }
    },
  };
  const toggle = (d: HomeDevice) => { const a = actionsFor(d).find(x => x.id === 'toggle'); if (a) void runner.run(d, a, !a.current); };
  useEffect(() => { const key = (ev: KeyboardEvent) => { if (ev.key !== 'Escape') return; if (confirm) setConfirm(null); else if (view.device) go({ section: view.section, room: view.room }); }; navigationWindow.addEventListener('keydown', key); return () => navigationWindow.removeEventListener('keydown', key); });
  const wide = viewport.width >= 600, landscape = viewport.width > viewport.height, short = viewport.height <= 700;
  const now = useClock();
  const time = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const enabled = home.devices.filter(d => d.enabled);
  const seenCamEvents = useRef(new Map<string, CamEvent>()); // detections this screen saw on (see holdEnded)
  // Every camera of the house in the modules' order (the main one first: C700, then the doorbell, then the rest), with what it reports now.
  const camViews: CamView[] = (() => { const rank = (d: HomeDevice) => { const m = modFor(d); return m ? modules.indexOf(m) * 10 + camerasOf(m).indexOf(d.primary.id) : 1e6; };
    const list = enabled.filter(d => d.kind === 'camera' && (d.primary.available || !!modFor(d)?.def.Player)).sort((a, b) => rank(a) - rank(b)).map(d => { const m = modFor(d), sensors = sensorsOf(registry, m?.def.sensors?.(m.entities, d.primary.id) ?? []), room = home.rooms.find(r => r.id === d.roomId)?.name ?? ''; const own = inRoomName(d, room); return { device: d, name: /^(камера|camera|cameră)$/i.test(own) && room ? room : own /* «Компьютерная · Камера» is the office's camera */, state: tileState(d), sensors, events: currentEvents(registry.states, d.key, sensors), online: d.primary.available }; });
    const held = holdEnded(seenCamEvents.current, list.flatMap(v => v.events), Date.now());
    return list.map(v => ({ ...v, events: held.filter(e => e.camera === v.device.key) })); })();
  // A ring opens the doorbell sheet on every device and closes it again after the module's seconds; any touch of the sheet keeps it. With another sheet open, a banner offers to switch instead.
  const alarms = modules.map(m => ({ m, a: m.def.alarm?.(m.entities, m.options) ?? null })).filter(x => x.a && x.a.seconds > 0) as Array<{ m: ActiveModule; a: { entityId: string; seconds: number } }>;
  const alarmStates = alarms.map(x => registry.states[x.a.entityId]?.state ?? '').join('|');
  const seenAlarms = useRef<string | null>(null);
  const [autoClose, setAutoClose] = useState<{ key: string; until: number } | null>(null), [ringBanner, setRingBanner] = useState<{ key: string; seconds: number } | null>(null);
  const openAlarm = (key: string, seconds: number) => { setRingBanner(null); if (view.device !== key) go({ section: view.section, room: view.room, device: key }); setAutoClose({ key, until: Date.now() + seconds * 1000 }); };
  useEffect(() => {
    const prev = seenAlarms.current; seenAlarms.current = alarmStates;
    if (prev === null || prev === alarmStates) return;
    const before = prev.split('|'), after = alarmStates.split('|');
    alarms.forEach((x, i) => {
      if (before[i] === after[i] || !after[i] || after[i] === 'unavailable' || after[i] === 'unknown') return;
      const dev = enabled.find(d => d.primary.id === x.m.entities.camera); if (!dev) return;
      if (view.device && view.device !== dev.key) { setRingBanner({ key: dev.key, seconds: x.a.seconds }); setTimeout(() => setRingBanner(b => b?.key === dev.key ? null : b), x.a.seconds * 1000); return; }
      openAlarm(dev.key, x.a.seconds);
    });
  }, [alarmStates]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!autoClose) return;
    const i = setInterval(() => { if (Date.now() >= autoClose.until) { setAutoClose(null); if (view.device === autoClose.key) go({ section: view.section, room: view.room }); } else setTick(x => x + 1); }, 1000);
    return () => clearInterval(i);
  }, [autoClose, view.device]);
  const autoCloseFor = (key: string): AutoClose | null => autoClose && autoClose.key === key ? { left: Math.ceil((autoClose.until - Date.now()) / 1000), keep: () => setAutoClose(null) } : null;
  // House-wide notices from modules (a timer that ended): shown on every device, with one beep here if this device allows it.
  const banner = modules.map(m => m.def.banner?.(registry, m.entities, t, host) ?? null).find(Boolean) ?? null;
  const bannerSeen = useRef<string | null>(null);
  useEffect(() => { const key = banner ? `${banner.id}:${banner.text}:${banner.sub ?? ''}` : null; if (key && key !== bannerSeen.current && banner?.sound) { try { if (JSON.parse(localStorage.getItem('atom-home:clock') ?? '{}').beep !== false) beep(); } catch { beep(); } } bannerSeen.current = key; }, [banner?.id, banner?.text, banner?.sub]);
  useEffect(() => { const arm = () => armBeep(); navigationWindow.addEventListener('pointerdown', arm, { once: true, passive: true }); return () => navigationWindow.removeEventListener('pointerdown', arm); }, [navigationWindow]);
  const clockMod = modules.find(m => m.def.id === 'clock');
  const setModuleOption = (id: string) => host.admin ? (key: string, value: string | undefined) => { const cur = config.modules[id] ?? {}; const options = { ...(cur.options ?? {}) }; if (value === undefined) delete options[key]; else options[key] = value; void applyConfig({ ...config, modules: { ...config.modules, [id]: { ...cur, options } } }).catch(() => undefined); } : undefined;
  const vacuum = useMemo(() => config.sections.cleaning?.hidden ? null : readVacuum(registry), [registry, config.sections.cleaning?.hidden]); // the robot vacuum (VACUUM.md): its own tile and the «Уборка» panel
  // the Roborock renders of this house's robot (Atom Home photos, set once per house); the preview hands its own
  const vacPics = useMemo(() => { const o = config.modules.vacuum?.options ?? {}, dev = vacuum ? home.devices.find(d => d.primary.id === vacuum.entity) : undefined, url = (n?: string) => n ? `/atom_home_photos/${n}` : null;
    return { robot: host.previewFrame?.('vacuum:robot') ?? url(o.robot) ?? dev?.photo ?? null, dock: host.previewFrame?.('vacuum:dock') ?? url(o.dock) }; }, [config, vacuum?.entity, home]);
  const heating = useMemo(() => readHeating(registry, now.getTime()), [registry, Math.floor(now.getTime() / 60000)]); // the house's heating (HEATING.md): its own tile and the «Климат» panel
  // a working building heated by air conditioners (atom-okapi/HEATING.md): its own tile and the «Климат» panel, unless the section is hidden
  const office = useMemo(() => config.sections.climate?.hidden ? null : readOfficeClimate(registry, now.getTime()), [registry, config, Math.floor(now.getTime() / 60000)]);
  // HA's grid connections make a device a feed for the Energy tile (a building on Tasmota POW inputs, 09.11.2026); read once, empty until then
  const [grid, setGrid] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { let alive = true; host.ws?.<EnergyPrefs>({ type: 'energy/get_prefs' }).then(p => { if (alive) setGrid(gridIds(p)); }, () => undefined); return () => { alive = false; }; }, [host]);
  const boilers = useMemo(() => boilerDeviceIds(modules, registry), [modules, registry]); // the boiler's thermal kW is not electricity
  const hasPower = (d: HomeDevice) => d.metrics.some(m => isElectric(m, d, boilers) || m.deviceClass === 'energy');
  const energyDevices = enabled.filter(d => d.kind === 'energy' || hasPower(d));
  // an office building (several Alarmo areas under the master, Atom + Okapi 09.11.2026) has its own card; the house keeps the house's
  const officeSec = useMemo(() => readOfficeSecurity(registry, config, { id: host.userId ?? null, admin: host.admin }), [registry, config, host.admin]);
  const security = useMemo(() => officeSec ? null : readSecurity(registry, config), [registry, config, officeSec]);
  const present = (s: Section) => (s === 'security' && !!(security || officeSec)) || (s === 'climate' && !!(heating || office)) || s === 'home' || s === 'rooms' || s === 'systems' || (s === 'energy' ? energyDevices.length > 0 : s === 'camera' ? camViews.length > 1 : enabled.some(d => d.section === s));
  const systemTabs = SYSTEM_TABS.filter(s => present(s) && !config.sections[s]?.hidden);
  const inSystems = (SYSTEM_TABS as string[]).includes(view.section);
  const navActive = (id: Section | 'setup') => id === 'systems' ? inSystems : view.section === id;
  const lastSystems = useRef<Section>('climate'); if (inSystems) lastSystems.current = view.section as Section;
  const navTarget = (id: Section | 'setup') => id === 'systems' ? lastSystems.current : id;
  const sideNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width, viewport.height]);
  const tabNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width]);
  const device = view.device ? enabled.find(d => d.key === view.device) : undefined;
  const clockOpen = view.device === 'clock' && !!clockMod;
  const feederMod = modules.find(m => m.def.sheetKey === 'feeder'), feederOpen = view.device === 'feeder' && !!feederMod;
  const airMod = modules.find(m => m.def.sheetKey === 'air'), airOpen = view.device === 'air' && !!airMod;
  // H9 of the audit: a room is shown when it has a photo or something to look at or switch; «no room» only for the admin
  const LIVING: Kind[] = ['light', 'climate', 'media', 'vacuum', 'camera', 'environment', 'switch', 'socket', 'fan', 'cover', 'lock', 'opening', 'leak', 'motion'];
  const rooms = home.rooms.filter(r => !r.hidden && (r.id === NO_ROOM ? host.admin : (!!r.photo || enabled.some(d => d.roomId === r.id && LIVING.includes(d.kind)))));
  const roomName = (id: string) => home.rooms.find(r => r.id === id)?.name || t('room.none');
  const title = view.section === 'setup' ? t('setup.title') : view.section === 'rooms' && view.room ? roomName(view.room) : view.section === 'home' ? home.name : inSystems ? t('section.systems') : t(`section.${view.section}` as Key);
  const subtitle = view.section === 'home' ? `${greeting(now, t)} · ${date}` : view.section === 'rooms' && !view.room ? t('rooms.count', { n: rooms.length }) : '';
  const pageKey = `${view.section}/${view.room ?? ''}`;
  const modal = !!device || clockOpen || feederOpen || airOpen || !!confirm;
  const navItems = [...NAV.filter(n => n.id !== 'lights' || (present('lights') && !config.sections.lights?.hidden)), ...(host.admin ? [{ id: 'setup' as const, icon: 'gear' }] : [])];
  const navLabel = (id: Section | 'setup') => id === 'setup' ? t('section.settings') : t(`section.${id}` as Key);
  // F8 of the audit (WCAG 2.4.3): focus moves into an opened sheet or confirmation and comes back to the opener when it closes
  const mainRef = useRef<HTMLElement>(null), sheetRef = useRef<HTMLElement>(null), confirmRef = useRef<HTMLDivElement>(null), sheetOpener = useRef<HTMLElement | null>(null), confirmOpener = useRef<HTMLElement | null>(null);
  const activeIn = (el: HTMLElement | null) => ((el?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement as HTMLElement | null) ?? null;
  const focusFirst = (el: HTMLElement | null) => el?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus({ preventScroll: true });
  const sheetOpen = !!device || clockOpen || feederOpen || airOpen;
  const lastInMain = useRef<HTMLElement | null>(null); // `main` is already inert when the effect runs, so the opener is remembered as focus moves, not read afterwards
  useEffect(() => { if (sheetOpen) { sheetOpener.current ??= lastInMain.current; const raf = requestAnimationFrame(() => focusFirst(sheetRef.current)); return () => cancelAnimationFrame(raf); } const back = sheetOpener.current; sheetOpener.current = null; if (back?.isConnected) back.focus({ preventScroll: true }); }, [sheetOpen, view.device]);
  useEffect(() => { if (confirm) { confirmOpener.current ??= activeIn(mainRef.current); const raf = requestAnimationFrame(() => focusFirst(confirmRef.current)); return () => cancelAnimationFrame(raf); } const back = confirmOpener.current; confirmOpener.current = null; back?.focus?.({ preventScroll: true }); }, [!!confirm]);
  return <div className={`hm-shell daily-shell at-shell ah-shell ${host.online ? '' : 'is-offline'} ${wide && !short ? 'daily-fit-screen' : ''} ${wide ? 'is-wide' : 'is-narrow'} ${wide && viewport.width < 760 ? 'is-compact' : ''} ${landscape ? 'is-landscape' : 'is-portrait'} ${short ? 'is-short' : ''} hm-route-${view.section}`} lang={lang} data-theme={config.home.theme} style={`--hm-height:${viewport.height}px`}>
    <div className="ah-wallpaper" aria-hidden="true" />
    <button type="button" className="at-skip" onClick={() => mainRef.current?.focus()}>{t('ui.skip')}</button>
    {wide && <aside className="hm-sidebar" inert={modal || undefined}>
      <div className="hm-clock"><strong>{time}</strong><small>{date.split(',')[0]}</small></div>
      <nav aria-label={t('section.more')} ref={sideNav}><i className="hm-nav-ind" aria-hidden="true" />{navItems.map(n => <button type="button" className={`${navActive(n.id) ? 'is-active' : ''} ${n.id === 'setup' ? 'at-setup-nav' : ''}`} aria-current={navActive(n.id) ? 'page' : undefined} onClick={() => go({ section: navTarget(n.id) })}><Icon name={n.icon} size={22} /><span>{navLabel(n.id)}</span></button>)}</nav>
      <div className="ah-side-rooms"><small>{t('section.rooms')}</small>{rooms.map(r => <button type="button" className={view.section === 'rooms' && view.room === r.id ? 'is-active' : ''} onClick={() => go({ section: 'rooms', room: r.id })}>{r.name || t('room.none')}</button>)}</div>
      <button type="button" className={`hm-conn ${host.online ? '' : 'is-off'}`} aria-label={host.online ? t('ui.online') : t('ui.offline')}><i />{host.online ? t('ui.online') : t('ui.offline')}</button>
    </aside>}
    <main className="hm-main" ref={mainRef} tabIndex={-1} inert={modal || undefined} onFocusIn={e => { lastInMain.current = e.target as HTMLElement; }}>
      <header className="hm-head">
        {view.section === 'rooms' && view.room ? <button type="button" className="hm-back" onClick={() => go({ section: 'rooms' })}><Icon name="back" size={20} />{t('section.rooms')}</button> : null}
        <div className="hm-head-title" key={pageKey}><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        {!wide && <span className="hm-head-time">{time}</span>}
        {!host.online && <span className="hm-badge tone-danger">{t('ui.offline')}</span>}
        {view.section === 'home' && <HeadTools registry={registry} config={config} t={t} lang={lang} now={now.getTime()} admin={!!host.admin} wide={wide} blocked={modal} onLanguage={l => { void applyConfig({ ...config, home: { ...config.home, language: l } }).catch(() => undefined); }} onSettings={() => go({ section: 'setup' })} />}
      </header>
      {inSystems && systemTabs.length > 1 && <div className="ah-segments hm-range-tabs is-sys" role="tablist" ref={el => { const a = el?.querySelector<HTMLElement>('.is-active'); if (el && a && (a.offsetLeft < el.scrollLeft || a.offsetLeft + a.offsetWidth > el.scrollLeft + el.clientWidth)) el.scrollLeft = a.offsetLeft - 8; }}>{systemTabs.map(s => <button type="button" role="tab" aria-selected={view.section === s} className={view.section === s ? 'is-active' : ''} onClick={() => go({ section: s })}>{t(`section.${s}` as Key)}</button>)}</div>}
      <div className="hm-page" key={pageKey}>
        {view.section === 'home' && <Overview vacPics={vacPics} vacuum={vacuum} security={security} officeSec={officeSec} heating={heating} office={office} grid={grid} home={home} registry={registry} config={config} modules={modules} player={player} tileState={tileState} host={host} runner={runner} toggle={toggle} go={go} t={t} lang={lang} now={now} camViews={camViews} />}
        {view.section === 'rooms' && !view.room && <div className="hm-room-grid is-page">{rooms.map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div>}
        {view.section === 'rooms' && view.room && <RoomPage heating={heating} vacuum={vacuum} host={host} now={now.getTime()} wide={viewport.width >= 760} home={home} registry={registry} roomId={view.room} runner={runner} toggle={toggle} go={go} t={t} lang={lang} alarms={clockMod && registry.entities.some(e => e.entity_id.startsWith('media_player.') && e.platform === 'yandex_station' && !e.disabled_by && (e.area_id ?? registry.devices.find(d => d.id === e.device_id)?.area_id) === view.room) ? config.alarms.filter(a => a.room === view.room) : null} />}
        {view.section === 'lights' && <LightsPage devices={enabled.filter(d => d.kind === 'light')} rooms={home.rooms} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} />}
        {view.section === 'security' && officeSec && <OfficeSecurityPanel s={officeSec} host={host} t={t} lang={lang} now={now.getTime()} admin={!!host.admin} title={config.home.name} />}
        {view.section === 'security' && security && <SecurityPanel s={security} registry={registry} config={config} host={host} t={t} lang={lang} now={now.getTime()} admin={!!host.admin} />}
        {view.section === 'climate' && heating && <HeatingPanel h={heating} host={host} t={t} lang={lang} now={now.getTime()} />}
        {view.section === 'climate' && !heating && office && <OfficeClimatePanel c={office} host={host} t={t} lang={lang} now={now.getTime()} />}
        {view.section === 'climate' && !heating && !office && <>{modules.filter(m => m.def.placement.includes('climate')).map(m => <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} />)}<ClimatePage devices={enabled.filter(d => d.section === 'climate')} runner={runner} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} /></>}
        {view.section === 'cleaning' && vacuum && view.filter === 'settings' && <VacuumSettings v={vacuum} host={host} t={t} lang={lang} onBack={() => go({ section: 'cleaning' })} />}
        {view.section === 'cleaning' && vacuum && view.filter !== 'settings' && <><VacuumPanel pics={vacPics} v={vacuum} host={host} t={t} lang={lang} onSettings={() => go({ section: 'cleaning', filter: 'settings' })} />{enabled.some(d => d.section === 'cleaning' && d.primary.id !== vacuum.entity) && <KindList devices={enabled.filter(d => d.section === 'cleaning' && d.primary.id !== vacuum.entity)} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} />}</>}
        {view.section === 'cleaning' && !vacuum && <KindList devices={enabled.filter(d => d.section === 'cleaning')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} />}
        {view.section === 'energy' && <EnergyPanel chargerOf={config.modules.energy?.options?.chargerOf ?? null} host={host} devices={energyDevices} boilers={boilers} floors={registry.floors ?? []} floorOfArea={id => registry.areas.find(a => a.area_id === id)?.floor_id ?? null} feedOfRoom={id => config.rooms[id]?.feed ?? null} roomFeeds={Object.values(config.rooms).map(r => r.feed).filter((f): f is string => !!f)} roomName={roomName} nameOf={d => meterName(d.name)} onDevice={key => go({ section: 'energy', device: key })} t={t} lang={lang} fallback={<EnergyPage devices={energyDevices} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} boilers={boilers} />} />}
        {view.section === 'camera' && <CamerasPanel views={camViews} player={player} host={host} now={now.getTime()} t={t} lang={lang} wide={wide} onCamera={key => go({ section: 'camera', device: key })} />}
        {view.section === 'setup' && <Setup registry={registry} config={config} onChange={applyConfig} admin={host.admin} t={t} lang={lang} storeLabel={store?.label ?? 'memory'} warnings={configWarnings} photos={store?.photos} />}
        {view.section === 'systems' && <>{modules.filter(m => m.def.placement.includes('systems')).map(m => m.def.sheetKey ? <div className="ah-grid at-module-row"><m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact onOpen={() => go({ section: 'systems', device: m.def.sheetKey })} /></div> : <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} />)}</>}
        {view.section === 'systems' && <SystemsPage devices={enabled.filter(d => d.section === 'systems' || (d.section === 'camera' && camViews.length < 2) || d.section === 'weather')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} rooms={home.rooms} admin={host.admin} filter={view.filter} onFilter={f => go({ section: 'systems', filter: f })} />}
      </div>
    </main>
    {!wide && <nav className="hm-tabbar" aria-label={t('section.more')} inert={modal || undefined} ref={tabNav}><i className="hm-nav-ind" aria-hidden="true" />{navItems.map(n => <button type="button" className={navActive(n.id) ? 'is-active' : ''} onClick={() => go({ section: navTarget(n.id) })}><Icon name={n.icon} size={24} /><span>{navLabel(n.id)}</span></button>)}</nav>}
    {clockOpen && clockMod && (() => { const close = () => go({ section: view.section, room: view.room }); const sheetWide = wide && landscape && viewport.width >= 800;
      return <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) close(); }}><section className={`hm-sheet ${sheetWide ? 'is-split' : ''}`} role="dialog" aria-modal="true" aria-label={t('clock.title')} ref={sheetRef} {...swipeToClose(close)}>
        <ClockSheet registry={registry} entities={clockMod.entities} host={host} t={t} lang={lang} runner={runner} onClose={close} wide={sheetWide} rooms={home.rooms.filter(r => !r.hidden).map(r => ({ id: r.id, name: r.name || t('room.none') }))} room={view.room} alarms={config.alarms} onAlarms={applyAlarms} /></section></div>; })()}
    {airOpen && (() => { const close = () => go({ section: view.section, room: view.room }), airWide = landscape && viewport.width >= 700;
      return <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) close(); }}><section className="hm-sheet" role="dialog" aria-modal="true" aria-label={t('module.air.title' as Key)} ref={sheetRef} {...swipeToClose(close)}>
        <AirSheet registry={registry} rooms={home.rooms} host={host} t={t} lang={lang} onClose={close} wide={airWide} /></section></div>; })()}
    {feederOpen && feederMod && (() => { const close = () => go({ section: view.section, room: view.room }), dev = feederMod.entities.device ?? '', devRoom = registry.devices.find(d => d.id === dev)?.area_id, roomLabel = home.rooms.find(r => r.id === devRoom)?.name, feederWide = landscape && viewport.width >= 700;
      return <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) close(); }}><section className={`hm-sheet ${feederWide ? 'is-split' : ''}`} role="dialog" aria-modal="true" aria-label={t('module.pet_feeder')} ref={sheetRef} {...swipeToClose(close)}>
        <FeederSheet registry={registry} entities={feederMod.entities} options={feederMod.options} host={host} t={t} lang={lang} room={roomLabel} wide={feederWide} onClose={close} automations={automations.filter(a => a.devices.includes(dev) || a.entities.some(id => Object.values(feederMod.entities).includes(id))).map(a => ({ ...a, byRoom: false }))} /></section></div>; })()}
    {device && (() => {
      const close = () => go({ section: view.section, room: view.room }), roomName_ = home.rooms.find(r => r.id === device.roomId)?.name;
      const mod = device.kind === 'camera' ? (m => m?.def.Sheet ? m : undefined)(modFor(device)) : undefined, st = device.kind === 'camera' ? tileState(device) : null;
      const stage = device.kind === 'camera' ? (st?.closed ? <div className="at-cam-stage-closed"><Icon name="camera" size={32} /><span>{t('module.camera.closed')}</span></div> : player(device, 'stage')) : undefined;
      const roomy = device.kind === 'light' && wide && landscape && viewport.width >= 800; // a dimmable lamp's sheet: slider left, temperature and ambient light right
      const sheetWide = !!mod && wide && landscape && viewport.width >= 800; // a phone on its side (874×402) splits too: video left, controls right, instead of a video that fills the whole height
      return <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) close(); }}><section className={`hm-sheet ${sheetWide ? 'is-split' : ''} ${roomy ? 'is-roomy' : ''} ${autoClose?.key === device.key ? 'is-alarm' : ''}`} role="dialog" aria-modal="true" aria-label={device.name} ref={sheetRef} {...swipeToClose(close)} onPointerDownCapture={() => { if (autoClose?.key === device.key) setAutoClose(null); }} onKeyDownCapture={() => { if (autoClose?.key === device.key) setAutoClose(null); }}>
        {mod?.def.Sheet ? <mod.def.Sheet device={device} registry={registry} entities={mod.entities} options={mod.options} host={host} t={t} lang={lang} runner={runner} onClose={close} room={roomName_} stage={stage} wide={sheetWide} setOption={setModuleOption(mod.def.id)} autoClose={autoCloseFor(device.key)} /> : <DeviceSheet device={device} runner={runner} onClose={close} t={t} lang={lang} stage={stage} host={host} room={roomName_} automations={automationsFor(device)} title={inRoomName(device, roomName_ ?? '')} />}
      </section></div>;
    })()}
    {confirm && (() => { // AUTO-1 of the audit: the question names the consequence («Вода пойдёт сразу»), the button carries the verb and the risk colour
      const a = confirm.action, special = `confirm.${a.domain === 'alarm_control_panel' ? 'alarm' : a.domain}.${a.id}` as Key, hasSpecial = t(special) !== special;
      const label = t(a.label as Key) === a.label ? a.label : t(a.label as Key);
      const text = a.id === 'all_off' ? t('confirm.lightsOff', { n: a.entityId.split(',').length }) : hasSpecial ? t(special, { device: confirm.device.name }) : label === confirm.device.name ? t('confirm.text.one', { action: label }) : t('confirm.text', { action: label, device: confirm.device.name });
      return <div className="hm-scrim is-top" onClick={e => { if (e.target === e.currentTarget) setConfirm(null); }}><div className={`hm-confirm risk-${a.risk}`} role="alertdialog" aria-modal="true" aria-label={t('confirm.title')} ref={confirmRef}><h2>{t('confirm.title')}</h2><p>{text}</p><div><button type="button" className="hm-pill" onClick={() => setConfirm(null)}>{t('confirm.no')}</button><button type="button" className={`hm-pill is-primary risk-${a.risk}`} onClick={() => void runner.run(confirm.device, a, confirm.value)}>{hasSpecial ? label : t('confirm.yes')}</button></div></div></div>; })()}
    {banner && <div className="at-door-ring at-house-banner" role="alert"><Icon name={banner.icon ?? 'clock'} size={20} /><span>{banner.text}{banner.sub ? <small> · {banner.sub}</small> : null}</span>{banner.extra && <button type="button" className="hm-pill" onClick={() => void banner.extra!.run().catch(() => undefined)}>{banner.extra.label}</button>}<button type="button" className="hm-pill is-primary" onClick={() => void banner.stop().catch(() => undefined)}>{t('clock.stop')}</button></div>}
    {ringBanner && <div className="at-door-ring" role="alert"><Icon name="bell" size={20} /><span>{t('module.doorbell.ringing')}</span><button type="button" className="hm-pill is-primary" onClick={() => openAlarm(ringBanner.key, ringBanner.seconds)}>{t('ui.open')}</button><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={() => setRingBanner(null)}>×</button></div>}
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
type Common = { runner: Runner; go: Nav; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; admin?: boolean };
const canToggle = (d: HomeDevice) => actionsFor(d).some(a => a.id === 'toggle');
/** Inside a room the owner's «Свет · Кухня» reads as «Свет». */
const inRoomName = (d: HomeDevice, room: string) => { const n = shortLabel(d.name), r = room.trim().toLowerCase(); if (!r) return n; const l = n.toLowerCase(); return l.endsWith(' · ' + r) ? n.slice(0, -(r.length + 3)) : l.startsWith(r + ' · ') ? n.slice(r.length + 3) : n; };
/** H5 of the audit: the model in brackets («Датчик окна (SNZB-04PR2)») belongs to the sheet, not to a 150 px tile. */
const shortLabel = (name: string) => { const s = name.replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim(); return s.length >= 3 ? s : name.trim(); };
/** Tile grid for a list of devices; the toggle goes straight to the host, «…» opens the sheet in the given section. */
function Tiles({ devices, section, room, runner, toggle, go, t, lang, nameOf, roomOf }: Common & { devices: HomeDevice[]; section: Section; room?: string | null; toggle: (d: HomeDevice) => void; nameOf?: (d: HomeDevice) => string; roomOf?: (d: HomeDevice) => string }) {
  return <Cascade className="ah-grid hm-light-grid">{devices.map(d => <AccessoryTile device={d} name={nameOf?.(d)} room={roomOf?.(d)} pending={runner.busy.has(d.key)} onToggle={canToggle(d) ? () => toggle(d) : undefined} onOpen={() => go({ section, room: room ?? null, device: d.key })} t={t} lang={lang} />)}</Cascade>;
}
function Overview({ home, registry, config, modules, player, tileState, host, runner, toggle, go, t, lang, now, camViews, heating, office, grid, security, officeSec, vacuum, vacPics }: Common & { vacuum: ReturnType<typeof readVacuum>; vacPics: { robot: string | null; dock: string | null }; security: ReturnType<typeof readSecurity>; officeSec: ReturnType<typeof readOfficeSecurity>; heating: ReturnType<typeof readHeating>; office: ReturnType<typeof readOfficeClimate>; grid: ReadonlySet<string>; home: Home; registry: Registry; config: HouseConfig; modules: ActiveModule[]; player: (dev: HomeDevice, mode: 'tile' | 'stage') => JSX.Element | null; tileState: (dev: HomeDevice) => TileState | null; host: Host; toggle: (d: HomeDevice) => void; now: Date; camViews: CamView[] }) {
  const d = home.devices.filter(x => x.enabled);
  const secTile = !!(security || officeSec) && !config.sections.security?.hidden; // the Security tile, when shown, tells leaks and doors-and-windows itself
  const roomOf = (x: HomeDevice) => home.rooms.find(r => r.id === x.roomId)?.name || t('room.none');
  const leaks = d.filter(x => x.kind === 'leak'), wet = leaks.filter(x => x.primary.state === 'on'), leaksMute = leaks.length > 0 && leaks.every(x => !x.primary.available || x.primary.state === 'unknown');
  const co2 = d.flatMap(x => x.metrics).find(m => m.deviceClass === 'carbon_dioxide' && m.available && Number.isFinite(Number(m.state)));
  const co2v = co2 ? Number(co2.state) : null, air = co2Level(co2v, t), co2Dev = co2 ? d.find(x => x.metrics.includes(co2)) : undefined;
  const boilers = boilerDeviceIds(modules, registry);
  // Two cameras or more are one card (owner, 09.11.2026): the main one live, the others as frames, the panel behind it. One camera keeps its own tile.
  const camFocus = camViews.length > 1 ? camViews.find(v => v.device.key === focusCamera(camViews[0].device.key, camViews.flatMap(x => x.events), now.getTime())) ?? camViews[0] : null;
  // the owner's wish (04.11.2026): the home face shows the house thermostat (the boiler's), never a room's radiator head
  const isTrv = (x: HomeDevice) => artOf(x) === 'radiator';
  const climate = d.filter(x => x.kind === 'climate').sort((a, b) => Number(isTrv(a)) - Number(isTrv(b)))[0], cameras = camFocus ? [] : camViews.map(v => v.device), weather = d.find(x => x.kind === 'weather');
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
  const groups = groupDefs.filter(g => !((heating || office) && g.id === 'climate') && !(vacuum && g.id === 'cleaning')).map(g => { const list = d.filter(x => g.kinds.includes(x.kind) && !x.favorite && x !== climate); return { ...g, count: list.length, on: g.on ? list.filter(g.on).length : undefined, label: t(`section.${g.section}` as Key) }; }).filter(g => g.count > 0 && !config.sections[g.section]?.hidden);
  const openings = d.filter(x => x.kind === 'opening' && x.primary.available), opened = openings.filter(x => x.primary.state === 'on').length; // H4: windows and doors instead of «104 devices»
  const temp = climate ? (typeof climate.primary.attributes.temperature === 'number' ? climate.primary.attributes.temperature : null) : null, cur = climate ? (typeof climate.primary.attributes.current_temperature === 'number' ? climate.primary.attributes.current_temperature : null) : null;
  const tempAction = climate ? actionsFor(climate).find(a => a.id === 'temperature') : undefined;
  const step = (dir: 1 | -1) => { if (!climate || !tempAction || temp === null) return; const v = Math.round((temp + dir * (tempAction.step ?? 0.5)) * 10) / 10; void runner.run(climate, climate.primary.state === 'off' ? heatOn(tempAction, v, t) : tempAction, v); };
  const tile = (x: HomeDevice, section: Section = 'home') => <AccessoryTile device={x} name={canToggle(x) ? inRoomName(x, roomOf(x)) : x.name} room={canToggle(x) ? roomOf(x) : undefined} pending={runner.busy.has(x.key)} onToggle={canToggle(x) ? () => toggle(x) : undefined} onOpen={() => go({ section, device: x.key })} t={t} lang={lang} />;
  return <Cascade className="hm-home ah-home ah-grid ah-face" data-face="home-modular">
    {modules.some(m => m.def.id === 'clock') ? <ClockTile now={now} lang={lang} t={t} registry={registry} entities={modules.find(m => m.def.id === 'clock')!.entities} onOpen={() => go({ section: 'home', device: 'clock' })} /> : <PlainClockTile now={now} lang={lang} />}
    {secTile && officeSec && <OfficeSecurityTile s={officeSec} t={t} onOpen={() => go({ section: 'security' })} />}
    {secTile && security && <SecurityTile s={security} registry={registry} config={config} t={t} lang={lang} onOpen={() => go({ section: 'security' })} />}
    {heating && <HeatingTile h={heating} host={host} t={t} lang={lang} now={now.getTime()} onOpen={() => go({ section: 'climate' })} />}
    {office && !heating && <OfficeClimateTile c={office} host={host} t={t} lang={lang} now={now.getTime()} onOpen={() => go({ section: 'climate' })} />}
    {climate && !heating && !office && <ThermostatTile device={climate} name={inRoomName(climate, roomOf(climate))} sub={roomOf(climate)} target={temp} current={cur} onStep={tempAction ? step : undefined} onOpen={() => go({ section: 'home', device: climate.key })} t={t} lang={lang} disabled={runner.busy.has(climate.key)} />}
    {camFocus && <CamerasTile views={camViews} focus={camFocus} player={player} host={host} now={now.getTime()} t={t} lang={lang} onPanel={() => go({ section: 'camera' })} onCamera={key => go({ section: 'home', device: key })} />}
    {vacuum && <VacuumTile pics={vacPics} v={vacuum} host={host} t={t} lang={lang} onOpen={() => go({ section: 'cleaning' })} />}
    {cameras.slice(0, 1).map(c => { const st = tileState(c); return <CameraTile device={c} state={st} player={st?.closed ? null : player(c, 'tile')} onOpen={() => go({ section: 'home', device: c.key })} t={t} lang={lang} large />; })}
    {modules.filter(m => m.def.placement.includes('overview')).map(m => { if (m.def.sheetKey) return <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact rooms={home.rooms} onOpen={() => go({ section: 'home', device: m.def.sheetKey })} />; const target = (m.def.placement.find(p => p !== 'overview') ?? 'systems') as Section, name = t(`module.${m.def.id}` as Key); return <div className="ah-tile ah-module"><button type="button" className="ah-tile-hit at-module-hit" aria-label={`${t('ui.open')}: ${name === `module.${m.def.id}` ? t(`section.${target}` as Key) : name}`} onClick={() => go({ section: target })} /><div className="at-module-body"><m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact /></div></div>; })}
    {config.buttons.slice(0, 6).map(b => { const a = customAction(b); return <SceneTile icon={b.icon ?? 'more'} label={b.label} t={t} onClick={() => void runner.run({ key: `button:${b.id}`, name: b.label, primary: { available: true } } as HomeDevice, a)} />; })}
    {weather && <ValueTile icon="air" value={wtemp === null ? '—' : num(wtemp, lang, 0)} unit={wtemp === null ? undefined : '°'} label={weather.name} sub={stateText(weather.primary, t, lang)} color="#32ade6" onClick={() => go({ section: 'systems', device: weather.key })} className="at-weather" />}
    {co2 && !modules.some(m => m.def.sheetKey === 'air') && <ValueTile icon="air" value={num(co2v!, lang, 0)} unit="ppm" label={t('overview.air')} sub={air.label} color={air.tone === 'danger' ? '#ff3b30' : air.tone === 'warning' ? '#ff9f0a' : '#30d158'} onClick={() => go({ section: 'systems', device: co2Dev?.key ?? null })} className={`hm-status tone-${air.tone}`} />}
    <EnergyTile devices={d} boilers={boilers} grid={grid} host={host} t={t} lang={lang} onClick={() => go({ section: 'energy' })} />
    {/* «Безопасность» already tells leaks, doors and windows: no second tile for them */}
    {!secTile && leaks.length > 0 && <ValueTile icon="water" value={wet.length ? t('state.wet') : leaksMute ? '—' : t('overview.leaks.dry')} label={t('overview.leaks')} sub={wet.length ? wet.map(x => x.name).join(', ') : leaksMute ? `${t('state.unknown').toLowerCase()} · ${t('rooms.count', { n: leaks.length }).replace(/^\d+ /, `${leaks.length} `)}` : t('rooms.count', { n: leaks.length }).replace(/^\d+ /, `${leaks.length} `)} color={wet.length ? '#ff3b30' : leaksMute ? '#8e8e93' : '#32ade6'} onClick={() => go({ section: 'systems', filter: wet.length ? 'attention' : null })} className={`hm-status ${wet.length ? 'tone-danger' : leaksMute ? 'tone-muted' : 'tone-calm'}`} />}
    {cameras.slice(1).map(c => { const st = tileState(c); return <CameraTile device={c} state={st} player={st?.closed ? null : player(c, 'tile')} onOpen={() => go({ section: 'home', device: c.key })} t={t} lang={lang} />; })}
    {groups.map(g => g.id === 'systems' && openings.length && !secTile ? <ValueTile icon="door" value={opened ? String(opened) : t('overview.allClosed')} unit={opened ? `/ ${openings.length}` : undefined} label={t('overview.openings')} sub={opened ? t('overview.opened', { n: opened }) : t('overview.doorsWindows', { n: openings.length })} color={opened ? '#ff9f0a' : '#30d158'} onClick={() => go({ section: 'systems', filter: opened ? 'attention' : null })} className={`ah-group-tile kind-${g.id}`} /> : <ValueTile icon={g.icon} value={g.on !== undefined ? String(g.on) : g.id === 'cleaning' && g.count === 1 ? stateText(d.find(x => x.kind === 'vacuum')!.primary, t, lang).split(' · ')[0] : String(g.count)} unit={g.on !== undefined ? `/ ${g.count}` : undefined} label={g.label} sub={g.on !== undefined ? t('overview.on', { n: g.on }) : t('overview.devices', { n: g.count })} color={g.on ? '#ffcc00' : g.color} onClick={() => go({ section: g.section })} className={`ah-group-tile kind-${g.id}`} />)}
    {favourites.map(x => tile(x, x.kind === 'climate' ? 'climate' : 'home'))}
    {rooms.length > 0 && <div className="ah-rooms-strip"><div className="hm-section-head"><h2>{t('section.rooms')}</h2><button type="button" className="hm-text-btn" onClick={() => go({ section: 'rooms' })}>{t('ui.all')}<Icon name="next" size={18} /></button></div>
      <div className="hm-room-grid">{rooms.slice(0, 8).map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div></div>}
  </Cascade>;
}
function CameraTile({ device, player, state, onOpen, t, lang, large }: { device: HomeDevice; player?: JSX.Element | null; state?: TileState | null; onOpen: () => void; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; large?: boolean }) {
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
  const closed = state?.closed === true;
  return <div className={`hm-card hm-camera-tile ah-camera ah-tile ${large ? 'is-large' : ''} ${closed ? 'is-closed' : ''} ${state?.tone ? `is-${state.tone}` : ''}`} role="button" tabIndex={0} onClick={onOpen}>
    <div className="hm-camera-frame">{closed ? <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{t('module.camera.closed')}</span></div> : player ? player : pic ? <img className="at-camera-img" src={pic} alt="" /> : <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{stateText(device.primary, t, lang)}</span></div>}{(!player || closed) && <span className="hm-live"><i />{closed ? t('state.off') : device.primary.available ? t('state.idle') : t('state.unavailable')}</span>}
      {state?.icon && !closed && <span className={`at-cam-badge ${state.tone === 'danger' ? 'is-ring' : ''}`} title={state.line ?? ''}><Icon name={state.icon} size={16} />{state.tone === 'danger' && <span>{state.line}</span>}</span>}
      <div className="hm-camera-caption"><strong>{device.name}</strong><small>{state?.line ?? device.model ?? ''}</small><Icon name="next" size={18} /></div></div>
  </div>;
}
function RoomPage({ home, registry, roomId, runner, toggle, go, t, lang, alarms, heating, vacuum, host, now, wide }: Common & { home: Home; registry: Registry; roomId: string; toggle: (d: HomeDevice) => void; alarms: Alarm[] | null; heating: ReturnType<typeof readHeating>; vacuum: ReturnType<typeof readVacuum>; host: Host; now: number; wide: boolean }) {
  // the room page mock (09.11.2026): ?layout=a|b|c draws one of the three proposals instead of today's page
  const layout = new URLSearchParams(location.search).get('layout') as RoomLayout | null;
  if (layout === 'a' || layout === 'b' || layout === 'c') { const byMain = (id: string) => home.devices.find(d => d.enabled && d.primary.id === id);
    return <RoomView layout={layout} reg={registry} roomId={roomId} roomName={home.rooms.find(r => r.id === roomId)?.name ?? ''} heating={heating} vacuum={vacuum} host={host} t={t} lang={lang} now={now} wide={wide}
      deviceOf={byMain} toggle={toggle} open={d => go({ section: 'rooms', room: roomId, device: d.key })} busy={d => runner.busy.has(d.key)} onHeating={() => go({ section: 'climate' })} onVacuum={() => go({ section: 'cleaning' })} />; }
  const c = roomClimate(home, registry, roomId), inRoom = home.devices.filter(d => d.enabled && d.roomId === roomId);
  const groups: Array<[Kind[], string]> = [[['light'], t('section.lights')], [['climate'], t('section.climate')], [['environment', 'leak', 'opening', 'motion', 'alarm', 'measurement'], t('group.sensors')], [['switch', 'socket', 'fan', 'cover', 'lock', 'valve', 'vacuum', 'media', 'camera', 'alarm_panel', 'energy', 'weather', 'person'], t('section.systems')]];
  return <div className="hm-room-page">
    <div className="ah-pills ah-room-pills">
      {c.temperature !== null && <Pill icon="thermo" color="#ff9f0a" label={t('metric.temperature')} value={`${num(c.temperature, lang)}°`} />}
      {c.humidity !== null && <Pill icon="water" color="#32ade6" label={t('metric.humidity')} value={`${num(c.humidity, lang, 0)} %`} />}
      {c.co2 !== null && <Pill icon="air" color="#30d158" label="CO₂" value={`${num(c.co2, lang, 0)} ppm`} />}
      {c.lights.length > 0 && <Pill icon="light" color={c.lights.some(l => isOn(l.primary)) ? '#ffcc00' : '#8e8e93'} label={t('section.lights')} value={`${c.lights.filter(l => isOn(l.primary)).length} / ${c.lights.length}`} />}
    </div>
    {alarms && <button type="button" className="hm-card at-room-alarms" onClick={() => go({ section: 'rooms', room: roomId, device: 'clock' })}><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{t('alarm.title')}</strong><small>{alarms.length ? alarms.map(a => `${a.time}${a.enabled ? '' : ' (' + t('state.off').toLowerCase() + ')'}`).join(' · ') : t('alarm.addHere')}</small></span><Icon name="next" size={18} /></button>}
    <div className="hm-room-columns">{groups.map(([kinds, title]) => { const list = inRoom.filter(d => kinds.includes(d.kind)); if (list.length && kinds[0] === 'light') return <LightRows devices={list} room={home.rooms.find(rm => rm.id === roomId)?.name ?? ''} runner={runner} toggle={toggle} open={d => go({ section: 'rooms', room: roomId, device: d.key })} t={t} lang={lang} />; return list.length ? <Block title={title}><Tiles devices={list} section="rooms" room={roomId} runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={x => inRoomName(x, home.rooms.find(rm => rm.id === roomId)?.name ?? '')} /></Block> : null; })}</div>
  </div>;
}
/** The Lights section: lamps grouped by room (room title, tiles named without the room), «N on» and «all off» on top. */
function LightsPage({ devices, rooms, runner, toggle, go, t, lang, roomName, admin }: Common & { devices: HomeDevice[]; rooms: Room[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  const on = devices.filter(d => isOn(d.primary));
  if (!devices.length) return <Empty go={go} t={t} admin={admin} />;
  const order = [...rooms.map(r => r.id), NO_ROOM], groups = [...new Set(devices.map(d => d.roomId))].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  return <div className="hm-light-page"><div className="hm-toolbar at-lights-bar"><span>{on.length ? t('overview.lights.on', { n: on.length }) : t('overview.lights.off')}</span>{on.length > 0 && <button type="button" className="hm-pill" onClick={() => void runner.run(on[0], { id: 'all_off', label: t('ui.lightsOff'), kind: 'button', domain: 'homeassistant', service: 'turn_off', entityId: on.map(d => d.primary.id).join(','), confirm: true, risk: 'normal' })}>{t('ui.lightsOff')}</button>}</div>
    <div className="at-lights-grid">{groups.map(roomId => { const list = devices.filter(d => d.roomId === roomId), lit = list.filter(d => isOn(d.primary)).length, room = roomName(roomId), span = Math.min(list.length, 3); return <Block title={room} className={`at-lights-room span-${span}`} action={<small className="hm-muted">{list.length > 1 && lit ? `${lit} / ${list.length}` : ''}</small>}><Tiles devices={list} section="lights" runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={d => canToggle(d) ? inRoomName(d, room) : d.name} /></Block>; })}</div></div>;
}
function ClimatePage({ devices, runner, go, t, lang, roomName, admin }: Common & { devices: HomeDevice[]; roomName: (id: string) => string }) {
  if (!devices.length) return <Empty go={go} t={t} admin={admin} />;
  return <div className="ah-grid ah-climate-grid">{[...devices].sort((a, b) => Number(artOf(a) === 'radiator') - Number(artOf(b) === 'radiator')).map(d => { const e = d.primary, acts = actionsFor(d), temp = acts.find(a => a.id === 'temperature'), target = typeof e.attributes.temperature === 'number' ? e.attributes.temperature : null, cur = typeof e.attributes.current_temperature === 'number' ? e.attributes.current_temperature : null;
    return <ThermostatTile device={d} name={inRoomName(d, roomName(d.roomId))} sub={roomName(d.roomId)} target={target} current={cur} onStep={temp ? dir => target !== null && void runner.run(d, temp, Math.round((target + dir * (temp.step ?? 0.5)) * 10) / 10) : undefined} onOpen={() => go({ section: 'climate', device: d.key })} t={t} lang={lang} disabled={runner.busy.has(d.key)} />; })}</div>;
}
function KindList({ devices, runner, toggle, go, t, lang, roomName, admin }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  if (!devices.length) return <Empty go={go} t={t} admin={admin} />;
  return <div className="ah-grid at-list">{devices.map(d => <div className="ah-tile-stack at-device" data-device-key={d.key}><AccessoryTile device={d} name={withRoom(d.name, roomName(d.roomId))} pending={runner.busy.has(d.key)} onToggle={canToggle(d) ? () => toggle(d) : undefined} onOpen={() => go({ section: 'cleaning', device: d.key })} t={t} lang={lang} wide />
    <div className="hm-chips">{actionsFor(d).filter(a => a.kind === 'button').map(a => <button type="button" disabled={runner.busy.has(d.key) || !d.primary.available} onClick={() => void runner.run(d, a)}>{t(a.label as Key)}</button>)}</div></div>)}</div>;
}
function EnergyPage({ devices, go, t, lang, roomName, admin, boilers }: { devices: HomeDevice[]; go: Nav; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; roomName: (id: string) => string; admin?: boolean; boilers: Set<string> }) {
  if (!devices.length) return <Empty go={go} t={t} admin={admin} />;
  // H8 of the audit: «Гостиная · Розетка Xiaomi (очиститель) Energy Today» → «сегодня»
  const caption = (m: EntityRef, d: HomeDevice) => {
    let n = m.name.trim();
    const room = roomName(d.roomId);
    for (const base of [d.primary.name, d.name, room ? `${room} · ${d.name}` : '']) { if (base && n.toLowerCase().startsWith(base.toLowerCase())) { n = n.slice(base.length); break; } }
    if (room && n.toLowerCase().startsWith(room.toLowerCase() + ' · ')) n = n.slice(room.length + 3);
    n = n.replace(/\s*\([^)]*\)/g, '').replace(/^[\s·—:-]+/, '').replace(/\s{2,}/g, ' ').trim();
    // the leading product words («Розетка Xiaomi», «Розетка увлажнителя реле Tuya с измерением») are the device, not the reading
    n = n.replace(/^(розетка|розетки|socket|plug)\s[^·]*?(?=(energy|энергия|ток|напряжение|current|voltage|power|мощность)(\s|$))/i, '').trim(); // no \b: JS \b is ASCII-only, Cyrillic words have none
    const key = n.toLowerCase().replace(/[\s_]+/g, ' ');
    const map: Record<string, Key> = { 'energy today': 'energy.today', 'energy month': 'energy.month', 'energy yesterday': 'energy.yesterday', 'energy total': 'energy.total', 'энергия сегодня': 'energy.today', 'энергия вчера': 'energy.yesterday', 'энергия всего': 'energy.total', 'энергия': 'energy.total', 'ток': 'metric.current', 'напряжение': 'metric.voltage', 'current': 'metric.current', 'voltage': 'metric.voltage', 'power': 'metric.power', 'мощность': 'metric.power' };
    return map[key] ? t(map[key]) : (n || metricLabel(m, t));
  };
  const pw = (d: HomeDevice) => { const m = d.metrics.find(x => isElectric(x, d, boilers) && x.available); return m ? Number(m.state) * (m.unit === 'kW' ? 1000 : 1) : null; };
  const max = Math.max(1, ...devices.map(d => pw(d) ?? 0));
  return <div className="hm-energy"><div className="hm-energy-lines">{devices.map(d => { const w = pw(d); return <button type="button" className="hm-card hm-line" data-device-key={d.key} onClick={() => go({ section: 'energy', device: d.key })}>
    <span className="hm-line-head"><span className="ah-glyph is-small" style="--tile:#30d158"><Icon name="energy" size={16} /></span><strong>{inRoomName(d, roomName(d.roomId))}</strong><span className="hm-badge">{roomName(d.roomId)}</span></span>
    <b>{w === null ? '—' : w >= 1000 ? `${num(w / 1000, lang, 2)} kW` : `${num(w, lang, 0)} W`}</b><span className="hm-meter"><i style={`width:${Math.round(100 * (w ?? 0) / max)}%`} /></span>
    <span className="hm-line-facts">{d.metrics.filter(m => m.deviceClass !== 'power').slice(0, 4).map(m => <span><small>{caption(m, d)}</small> {stateText(m, t, lang)}</span>)}</span>
  </button>; })}</div></div>;
}
function SystemsPage({ devices, runner, toggle, go, t, lang, roomName, rooms, admin, filter, onFilter }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string; rooms: Room[]; filter: string | null; onFilter: (f: string | null) => void }) {
  // IA-1 / F12 of the audit: 100+ devices need an entrance «what is wrong now» and a search box
  const [q, setQ] = useState('');
  const attention = (x: HomeDevice) => !x.primary.available || (['opening', 'leak', 'motion', 'alarm'].includes(x.kind) && x.primary.state === 'on') || (x.kind === 'alarm_panel' && x.primary.state === 'triggered');
  const needs = devices.filter(attention), query = q.trim().toLowerCase();
  const shown = devices.filter(x => (filter !== 'attention' || attention(x)) && (!query || `${x.name} ${roomName(x.roomId)}`.toLowerCase().includes(query)));
  const groups: Array<[Kind[], string]> = [[['leak', 'alarm', 'valve', 'lock', 'alarm_panel', 'opening', 'motion'], t('overview.leaks') + ' · ' + t('kind.alarm_panel')], [['environment', 'measurement'], t('overview.air')], [['socket', 'switch', 'fan', 'cover'], t('section.systems')], [['media', 'camera'], t('kind.media')], [['weather', 'person'], t('section.weather')]];
  const rendered = groups.filter(([kinds]) => shown.some(d => kinds.includes(d.kind)));
  if (!devices.length) return <Empty go={go} t={t} admin={admin} />;
  const bar = <div className="hm-toolbar at-sys-bar"><label className="at-search-wrap"><span className="at-vh">{t('systems.search')}</span><input type="search" className="at-search" placeholder={t('systems.search')} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /></label><button type="button" className={`hm-pill at-sys-attn ${filter === 'attention' ? 'is-active' : ''} ${needs.length ? 'is-warn' : ''}`} aria-pressed={filter === 'attention'} onClick={() => onFilter(filter === 'attention' ? null : 'attention')}>{t('systems.attention')}{needs.length ? ` · ${needs.length}` : ''}</button></div>;
  if (!rendered.length) return <div className="hm-systems">{bar}<p className="hm-muted at-empty">{filter === 'attention' && !query ? t('systems.allFine') : t('systems.nothing')}</p></div>;
  // H3 of the audit: inside a group the tiles go room by room, named without the room and the model
  const order = [...rooms.map(r => r.id), NO_ROOM], byRoom = (list: HomeDevice[]) => [...new Set(list.map(d => d.roomId))].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)).map(roomId => ({ roomId, room: roomName(roomId), list: list.filter(d => d.roomId === roomId) }));
  return <div className="hm-systems">{bar}{rendered.map(([kinds, title]) => { const list = shown.filter(d => kinds.includes(d.kind)); const parts = byRoom(list); return <Block title={title}>{parts.length > 1 ? <div className="at-sys-rooms">{parts.map(p => <div className="at-sys-room"><h3>{p.room}</h3><Tiles devices={p.list} section="systems" runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={d => inRoomName(d, p.room)} /></div>)}</div> : <Tiles devices={list} section="systems" runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={d => inRoomName(d, roomName(d.roomId))} roomOf={d => canToggle(d) ? roomName(d.roomId) : undefined as unknown as string} />}</Block>; })}</div>;
}
/** N5 of the audit: an empty section tells the admin where to add devices. */
function Empty({ go, t, admin }: { go: Nav; t: ReturnType<typeof translator>; admin?: boolean }) {
  return <p className="hm-muted at-empty">{t('ui.nodevices')}{admin && <button type="button" className="hm-pill" onClick={() => go({ section: 'setup' })}>{t('setup.title')}</button>}</p>;
}
