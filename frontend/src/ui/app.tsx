import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { rememberDiscover, roomClimate, NO_ROOM, type Home, type HomeDevice, type Room, type EntityRef } from '../model/discover.ts';
import { SECTIONS, type Section, type Kind } from '../model/kinds.ts';
import type { Host, AutomationRow } from '../runtime/host.ts';
import { actionsFor, serviceCall, customAction, type Action } from '../runtime/actions.ts';
import { translator, type Key } from '../i18n/index.ts';
import { RoomTile, AccessoryTile, ThermostatTile, ClockTile as PlainClockTile, SceneTile, ValueTile, Section as Block, artOf } from './cards.tsx';
import { ClockTile, ClockSheet, beep } from '../modules/clock.tsx';
import { FeederSheet } from '../modules/pet-feeder.tsx';
import { KettleSheet } from '../modules/kettle.tsx';
import { AirSheet } from '../modules/air.tsx';
import type { Alarm } from '../model/config.ts';
import { DeviceSheet, heatOn, stepTarget, type Runner } from './sheet.tsx';
import { stateText, isOn, num, co2Level, withRoom, errorText } from './format.ts';
import { createCommands, guardHost } from '../runtime/commands.ts';
import { metricLabel, modelText, held } from './cards.tsx';
import { Setup } from './setup.tsx';
import { rememberModules, claimedEntities, type ActiveModule, type TileState, type AutoClose } from '../modules/index.ts';
import type { JSX } from 'preact';
import { SaveError, rebaseAlarms, type ConfigStore } from '../runtime/store.ts';
import { Cascade } from './motion.tsx';
import { boilerDeviceIds, isElectric } from '../model/energy.ts';
import { EnergyTile } from './energy-tile.tsx';
import { EnergyPanel } from './energy-page.tsx';
import { gridIds, prefTariff, type EnergyPrefs } from '../model/energy-load.ts';
import { HeadTools } from './head-tools.tsx';
import { panelLayout, panelInput, peopleChips } from './panel-size.ts';
import { setHouseZone, houseDate, dateFormat } from '../runtime/zone.ts';
import { meterName } from '../model/energy-load.ts';
import { CamerasTile, CamerasPanel, type CamView } from './cameras.tsx';
import { HeatingTile, HeatingPanel } from './heating.tsx';
import { readHeating } from '../model/heating.ts';
import { readSecurity, delayClock } from '../model/security.ts';
import { SecurityTile, SecurityPanel } from './security.tsx';
import { readOfficeSecurity } from '../model/office-security.ts';
import { OfficeSecurityTile, OfficeSecurityPanel } from './office-security.tsx';
import { VacuumTile, VacuumPanel, VacuumSettings } from './vacuum.tsx';
import { readVacuum } from '../model/vacuum.ts';
import { PhotoOf } from './photo.tsx';
import { photoIndex } from '../model/photos.ts';
import { RoomView, GLYPH } from './room.tsx';
import { LiveLoad } from './live-load.tsx';
import { readRoom } from '../model/room.ts';
import { channels, feedNow, prefChannels } from '../model/energy-load.ts';
import { feedPower } from '../model/energy.ts';
import type { Thing } from '../model/room.ts';
import { OfficeClimateTile, OfficeClimatePanel } from './office-climate.tsx';
import { readOfficeClimate } from '../model/office-climate.ts';
import { currentEvents, focusCamera, holdEnded, houseNow, houseTime, ringOpensOnce, sensorsOf, type CamEvent } from '../model/cameras.ts';

import { decode, encode, pageOf, pushView, replaceView, leaveTo, landed, stayOn, repair, markOf, findMark, type View, type FocusMark } from '../runtime/route.ts';
import { keepFocus, type FocusKeep } from './focus-keep.ts';
import { arrowNav } from './spatial-nav.ts';
import { headWords } from './head-words.ts';
import { toastLife, confirmWords, swipeDelta, rectsMeet } from './shell-logic.ts';
import { Banners, Takeover, NoticeBar, type TakeAct } from './shell-banner.tsx';
import { shellAlarm, announcement, sk } from '../model/security-words.ts';
import { houseStatus, type HouseStatus } from '../model/house-status.ts';
import { HouseStatusStrip } from './house-status.tsx';
import { people } from '../model/people.ts';
/** Apple Home-style navigation: Home · Rooms · Systems (+ Settings for admins). The former per-kind screens live under Systems as segments. */
const NAV: Array<{ id: Section; icon: string }> = [{ id: 'home', icon: 'home' }, { id: 'rooms', icon: 'rooms' }, { id: 'lights', icon: 'light' }, { id: 'systems', icon: 'systems' }]; // «Свет» is its own entry under Rooms (owner's wish, 04.11.2026)
const SYSTEM_TABS: Section[] = ['security', 'climate', 'cleaning', 'energy', 'camera', 'systems']; // «Безопасность» first (owner, 09.11.2026) // «Камеры» is the panel of every camera (owner, 09.11.2026)
function useNavIndicator<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  // F15 of the audit: read the geometry in the next frame, after layout, so the commit never forces a synchronous reflow
  useEffect(() => { const nav = ref.current; if (!nav) return; const raf = requestAnimationFrame(() => { const a = nav.querySelector<HTMLElement>('button.is-active'); nav.style.setProperty('--hm-ind-on', a ? '1' : '0'); if (!a) return; nav.style.setProperty('--hm-ind-x', `${a.offsetLeft}px`); nav.style.setProperty('--hm-ind-y', `${a.offsetTop}px`); nav.style.setProperty('--hm-ind-w', `${a.offsetWidth}px`); nav.style.setProperty('--hm-ind-h', `${a.offsetHeight}px`); }); return () => cancelAnimationFrame(raf); }, deps);
  return ref;
}
export interface AppProps { registry: Registry; config: HouseConfig; host: Host; viewport: { width: number; height: number }; navigationWindow?: Window; store?: ConfigStore; configWarnings?: string[]; onConfigChange?: (next: HouseConfig) => void;
  /** The house's settings could not be read yet and `config` is only the factory set: the panel says so and saves nothing until the real ones arrive. */
  configPending?: boolean;
  /** The panel and the integration's Python differ in version (an update without a restart): the administrator is told once. */
  restartNeeded?: boolean }
/** The whole panel: pure function of (registry + states, config). Commands go through the host and are confirmed by state changes. */
export function AtomApp({ registry, config: initialConfig, host: bareHost, viewport: outer, navigationWindow = window, store, configWarnings = [], onConfigChange, configPending = false, restartNeeded = false }: AppProps) {
  setHouseZone(bareHost.timeZone); // the clock, the sun, «next alarm» and the energy month are the house's, whatever zone this browser is in (runtime/zone.ts)
  // The one command runner of the panel (runtime/commands.ts): the cards get a host whose `call` goes through it, the tiles and sheets get `runner`.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set()), say = useRef<(text: string) => void>(() => undefined), words = useRef(translator(initialConfig.home.language)), hostNow = useRef(bareHost); hostNow.current = bareHost;
  const commands = useMemo(() => createCommands({ host: () => hostNow.current, text: e => errorText(e, words.current), notify: text => say.current(text), changed: setBusy }), []);
  const host = useMemo(() => guardHost(bareHost, commands), [bareHost, commands]);
  const [config, setConfig] = useState(initialConfig);
  const confirmed = useRef(initialConfig);
  // What the parent hands in is the house's truth — except the echo of a value this panel is still saving (`onConfigChange` gave it to the parent,
  // the next state change brought it back as a prop): taken for confirmed, a save the house then refused left the panel on the unsaved value.
  const unsaved = useRef(new WeakSet<HouseConfig>());
  useEffect(() => { if (unsaved.current.has(initialConfig)) return; setConfig(initialConfig); confirmed.current = initialConfig; }, [initialConfig]);
  /** Shown at once, kept only once the store confirms. A refused save returns to the last confirmed config (after a conflict: the fresh one) and rejects, so the caller does not report success. */
  /** Saves can overlap (two quick language picks): only the newest one decides what the panel shows, unless it has already failed, so the panel never stays on a value the house does not hold. */
  const saveSeq = useRef(0), failedSeq = useRef(0);
  const applyConfig = async (next: HouseConfig) => {
    // the house's settings have not been read yet (`configPending`): what the panel shows is the factory set, and saving it would wipe the real one
    if (configPending) { const e = new SaveError('not_loaded'); notify(errorText(e, translator(config.home.language))); throw e; }
    const seq = ++saveSeq.current;
    if (store) unsaved.current.add(next);
    setConfig(next); onConfigChange?.(next);
    if (!store) return;
    // the store may have carried over the alarms an alarms write confirmed after this snapshot was built (CODEX-003): the house holds those, so does the panel
    try { const r = await store.save(next), held = r.alarms ? { ...next, alarms: r.alarms } : next; unsaved.current.delete(next); confirmed.current = held; if (seq === saveSeq.current || failedSeq.current === saveSeq.current) { setConfig(held); onConfigChange?.(held); } }
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
    if (configPending) throw new SaveError('not_loaded'); // said inside the «Время» window (ClockSheet), not once more as a toast
    let base = config, r: { alarms: Alarm[] };
    try { r = await store.saveAlarms(alarms); }
    catch (e) {
      // Another screen saved something since this one read the settings. Alarms are one key the house keeps apart from the rest: read the
      // fresh settings, carry this change over to their list and send it once more, instead of «changed elsewhere, repeat» for up to five minutes.
      if (!(e instanceof SaveError && e.code === 'conflict')) throw e;
      try { base = (await store.load()).config; confirmed.current = base; r = await store.saveAlarms(rebaseAlarms(config.alarms, alarms, base.alarms)); }
      catch (again) { setConfig(confirmed.current); onConfigChange?.(confirmed.current); throw again; }
    }
    const next = { ...base, alarms: r.alarms }; setConfig(next); confirmed.current = next; onConfigChange?.(next);
  };
  const lang = config.home.language, t = useMemo(() => translator(lang), [lang]); words.current = t;
  // PERF-1 of the audit: a state change of Home Assistant does not rebuild the house. The modules found are the same list until one of them
  // changes; the house model (model/discover.ts) answers from memory unless a state changed its shape, renewing only the cards a value touched.
  const findModules = useMemo(() => rememberModules(), []), modules = findModules(registry, config); // the same array until the modules themselves change (modules/index.ts)
  const claimed = useMemo(() => claimedEntities(registry, config, modules), [config, modules]);
  const discoverHome = useMemo(() => rememberDiscover(), []);
  const home = useMemo(() => discoverHome(registry, config, claimed), [registry, config, claimed]);
  const [view, setView] = useState<View>(() => decode(navigationWindow.location.hash));
  /** The module that plays a camera: its own `camera`, or one of its `cameras` (a two-lens camera). */
  const camerasOf = (m: ActiveModule) => m.def.cameras?.(m.entities) ?? (m.entities.camera ? [m.entities.camera] : []);
  const modFor = (dev: HomeDevice) => modules.find(m => (m.def.Player || m.def.Sheet || m.def.tileState) && camerasOf(m).includes(dev.primary.id));
  const player = (dev: HomeDevice, mode: 'tile' | 'stage') => { const behind = mode === 'tile' && !!view.device; if (behind && home.devices.find(d => d.key === view.device)?.kind === 'camera') return null; /* one stream at a time: a camera sheet's stage replaces the tile players; behind any other sheet they only pause, so closing it does not reconnect every stream */ const m = modFor(dev); const P = m?.def.Player; const poster = typeof dev.primary.attributes.entity_picture === 'string' ? dev.primary.attributes.entity_picture : null; return m && P ? <P key={`${m.def.id}:${dev.key}:${mode}`} entities={m.entities} options={m.options} host={host} t={t} lang={lang} mode={mode} poster={poster} camera={dev.primary.id} paused={behind} /> : null; };
  /** What the camera's module says about it for the tile (closed lens, second line). */
  const tileState = (dev: HomeDevice): TileState | null => { const m = modFor(dev); return m?.def.tileState ? m.def.tileState(registry, m.entities, t, lang) : null; };
  const [toast, setToast] = useState<{ id: number; text: string; /** it says «Нет связи с домом» */ offline: boolean } | null>(null), [confirm, setConfirm] = useState<{ device: HomeDevice; action: Action; value?: unknown } | null>(null);
  // Navigation (runtime/route.ts). A new page opens at its top; «Back» brings the place and the control it was left from. Whatever leaves a page also closes the question asked over it.
  const viewNow = useRef(view); viewNow.current = view;
  const arrival = useRef<'new' | 'back' | null>(null), places = useRef(new Map<string, { top: number; mark: FocusMark | null }>());
  const leavePage = () => { const m = mainRef.current; if (m) places.current.set(pageOf(viewNow.current), { top: m.scrollTop, mark: markOf(m.querySelector('.hm-page'), lastInMain.current) }); };
  useEffect(() => { const pop = () => { landed(navigationWindow);
      // «Back» with a question open closes the question only: the entry the browser has just left is opened again (runtime/route.ts: stayOn)
      if (confirmNow.current) { confirmNow.current = null; setConfirm(null); if (stayOn(navigationWindow, viewNow.current)) return; }
      leavePage(); arrival.current = 'back'; setConfirm(null); const hash = navigationWindow.location.hash, v = decode(hash); if (hash.length > 1 && encode(v) !== hash) replaceView(navigationWindow, v); /* «#nonsense» is Home and says so */ setView(v); }; navigationWindow.addEventListener('popstate', pop); navigationWindow.addEventListener('hashchange', pop); return () => { navigationWindow.removeEventListener('popstate', pop); navigationWindow.removeEventListener('hashchange', pop); }; }, [navigationWindow]);
  useEffect(() => { const hash = navigationWindow.location.hash; if (hash.length > 1 && encode(decode(hash)) !== hash) replaceView(navigationWindow, decode(hash)); /* a cold «#nonsense» is Home and says so at once, not after the first tap */ }, [navigationWindow]);
  const full = (next: Partial<View>) => ({ section: viewNow.current.section, room: null, device: null, filter: null, ...next }) as View;
  const show = (v: View) => { leavePage(); arrival.current = 'new'; setConfirm(null); setView(v); };
  /** Opens a page or a sheet: a new history entry. */
  const go = (next: Partial<View>) => { const v = full(next); if (pushView(navigationWindow, v)) show(v); };
  /** A page's own switch (a tab of «Энергия», the «Внимание» filter): the same entry. */
  const swap = (next: Partial<View>) => { const v = full(next); replaceView(navigationWindow, v); setConfirm(null); setView(v); };
  /** Leaves what was opened: back in history when that is where it leads, else this entry becomes `next`. */
  const leave = (next: Partial<View>, fits?: (previous: View) => boolean) => { const v = full(next); if (leaveTo(navigationWindow, v, fits) === 'replace') show(v); };
  const closeSheet = () => { const { section, room, filter } = viewNow.current; leave({ section, room, filter }, p => p.section === section && p.room === room && !p.device); };
  // One message at a time; each has its own timer (a second refusal with the same words is not cut short by the first one's), and waits while the pointer rests on it.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null), toastSeq = useRef(0), toastMs = useRef(6000);
  const holdToast = (ms: number | null) => { if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = ms === null ? null : setTimeout(() => setToast(null), ms); };
  const offlineSaid = useRef(0); // the last message that said «Нет связи с домом»: the live region reads the connection line again for it instead of reading two lines
  // the control a person pressed last (or holds the focus): a message never lies over it — it is said at the top instead (`rectsMeet`, 1.26.1)
  const lastPress = useRef<{ el: Element; at: number } | null>(null), toastNear = useRef<Element | null>(null), toastEl = useRef<HTMLDivElement>(null), [toastTop, setToastTop] = useState(false);
  const notify = (text: string, ms = 6000) => { const life = toastLife(text, ms), offline = text === words.current('ui.offline'); toastMs.current = life; const id = ++toastSeq.current; if (offline) offlineSaid.current = id;
    const root = shellRef.current?.getRootNode() as Document | ShadowRoot | undefined, active = root?.activeElement ?? null, pressed = lastPress.current && Date.now() - lastPress.current.at < 10000 ? lastPress.current.el : null;
    toastNear.current = pressed ?? (active && shellRef.current?.contains(active) ? active : null); setToast({ id, text, offline }); holdToast(life); };
  const dropToast = () => { holdToast(null); setToast(null); };
  useLayoutEffect(() => { const el = toastEl.current, near = toastNear.current; if (!toast || !el || !near?.isConnected) { setToastTop(false); return; }
    const c = near.closest('button,a,input,select,textarea,[role=button],[role=switch]') ?? near; setToastTop(rectsMeet(el.getBoundingClientRect(), c.getBoundingClientRect())); }, [toast?.id]);
  say.current = notify;
  // an update without a restart: said once to the administrator (who can restart), in the calm region and as a toast that stays a while
  const restartTold = useRef(false);
  useEffect(() => { if (!restartNeeded || !bareHost.admin || restartTold.current) return; restartTold.current = true; notify(translator(config.home.language)('ui.restartNeeded'), 15000); }, [restartNeeded, bareHost.admin]);
  useEffect(() => () => holdToast(null), []);
  const uid = useId(), swipe = useSwipeClose(), energyPlace = useRef<string | null>(null); // the period of «Энергия» behind the «Сейчас» tab
  // the house lost and found, each said once: the urgent region reads «нет связи» when it appears, the calm one says the house is back
  const [calm, setCalm] = useState(''), wasOnline = useRef(host.online);
  useEffect(() => { if (host.online === wasOnline.current) return; wasOnline.current = host.online; if (!host.online) { setCalm(''); return; } setToast(x => x?.offline ? null : x); /* «Нет связи с домом» does not outlive the outage */ setCalm(t('ui.onlineAgain')); const i = setTimeout(() => setCalm(''), 6000); return () => clearTimeout(i); }, [host.online]);
  // AUTO-2 of the audit: which HA automations touch a card (read-only); loaded once, refreshed when the host changes
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  useEffect(() => { if (!view.device) return; /* PERF-8: read when a sheet opens, not at start and not again when it closes */ let alive = true; void host.automations?.().then(rows => { if (alive) setAutomations(rows); }, () => undefined); return () => { alive = false; }; }, [host, view.device]); // refreshed whenever a sheet opens, so «last ran» is current
  const automationsFor = (dev: HomeDevice) => { const ids = new Set([dev.primary, ...dev.controls, ...dev.metrics, ...dev.parameters].map(x => x.id)); return automations.filter(a => a.entities.some(id => ids.has(id)) || (dev.haDeviceId !== null && a.devices.includes(dev.haDeviceId))).map(a => ({ ...a, byRoom: false })).concat(automations.filter(a => !a.entities.some(id => ids.has(id)) && !(dev.haDeviceId !== null && a.devices.includes(dev.haDeviceId)) && a.areas.includes(dev.roomId) && ['light', 'climate', 'switch', 'socket', 'cover', 'fan'].includes(dev.kind)).map(a => ({ ...a, byRoom: true }))); };
  const statesNow = useRef(registry.states); statesNow.current = registry.states;
  const [done, setDone] = useState<string | null>(null), doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(doneTimer.current), []);
  const runner: Runner = {
    busy,
    async run(device, action, value) {
      if (action.confirm && !(confirm && confirm.device === device && confirm.action === action)) { if (!hostNow.current.online) { notify(t('ui.offline')); return false; } /* nothing to ask about: the answer could not be carried out */ confirmOpener.current = activeIn(mainRef.current); /* now: once the question is drawn everything under it is inert and has lost the focus */ setConfirm({ device, action, value }); return false; }
      if (action.kind !== 'number' && commands.pending(device.key)) { // ST-3: a double tap sends one command; sliders keep streaming
        // «Выполнить» in the question is not a double tap: another command of the same device is still on its way (the key is the device's),
        // so the answer waits for it — once — and says so if that one never ends; it never leaves a dead dialog
        if (!confirm || answering.current) return false;
        answering.current = true; setAsking(true); const t0 = Date.now();
        while (commands.pending(device.key) && Date.now() - t0 < 6000) await new Promise(r => setTimeout(r, 100));
        answering.current = false; setAsking(false);
        if (confirmNow.current?.action !== action) return false; // the question was withdrawn meanwhile
        if (commands.pending(device.key)) { setConfirm(null); notify(t('ui.stillBusy')); return false; }
      }
      setConfirm(null);
      const c = serviceCall(action, value), was = statesNow.current[action.entityId]?.state;
      // a switch stays pending until its new state arrives (at most 3 s), so a second tap cannot land between the answer and the state
      const ok = await commands.run(device.key, () => host.call(c.domain, c.service, c.data), { stream: action.kind === 'number', until: action.kind === 'toggle' && action.id === 'toggle' ? () => statesNow.current[action.entityId]?.state !== was : undefined, untilMs: 3000 });
      // a scene has no state of its own to change: its tile says «Готово» for two seconds, whether it was sent at once or after the question
      if (ok && device.key.startsWith('button:')) { setDone(device.key); clearTimeout(doneTimer.current); doneTimer.current = setTimeout(() => setDone(null), 2000); }
      return ok;
    },
  };
  const toggle = (d: HomeDevice) => { const a = actionsFor(d).find(x => x.id === 'toggle'); if (a) void runner.run(d, a, !a.current); };
  const confirmNow = useRef(confirm); confirmNow.current = confirm;
  const answering = useRef(false), [asking, setAsking] = useState(false);
  useEffect(() => { const key = (ev: KeyboardEvent) => { if (ev.key !== 'Escape' || ev.defaultPrevented) return; /* only the top layer: a card's own question or menu stops the key before it gets here */ if (confirmNow.current) setConfirm(null); else if (viewNow.current.device) closeSheet(); }; navigationWindow.addEventListener('keydown', key); return () => navigationWindow.removeEventListener('keydown', key); }, [navigationWindow]);
  // every layout decision is taken from the panel's own size (ui/panel-size.ts): a television and a 4K monitor are laid out smaller and drawn enlarged
  const panel = panelLayout(outer, useMemo(() => panelInput(navigationWindow), [navigationWindow])), viewport = { width: panel.width, height: panel.height };
  const { wide, landscape, short } = panel;
  const now = useClock();
  const locale = lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB';
  const head = headWords(now, locale), time = head.time, date = head.date; // the house's clock, not the browser's (CODEX-014: ui/head-words.ts)
  const enabled = home.devices.filter(d => d.enabled);
  const seenCamEvents = useRef(new Map<string, CamEvent>()); // detections this screen saw on (see holdEnded)
  // Every camera of the house in the modules' order (the main one first: C700, then the doorbell, then the rest), with what it reports now.
  const camViews: CamView[] = (() => { const rank = (d: HomeDevice) => { const m = modFor(d); return m ? modules.indexOf(m) * 10 + camerasOf(m).indexOf(d.primary.id) : 1e6; };
    const list = enabled.filter(d => d.kind === 'camera' && (d.primary.available || !!modFor(d)?.def.Player)).sort((a, b) => rank(a) - rank(b)).map(d => { const m = modFor(d), sensors = sensorsOf(registry, m?.def.sensors?.(m.entities, d.primary.id) ?? []), room = home.rooms.find(r => r.id === d.roomId)?.name ?? ''; const own = inRoomName(d, room); return { device: d, name: /^(камера|camera|cameră)$/i.test(own) && room ? room : own /* «Компьютерная · Камера» is the office's camera */, state: tileState(d), sensors, events: currentEvents(registry.states, d.key, sensors), online: d.primary.available || tileState(d)?.closed === true /* a closed lens is not a lost camera: its stream goes away on purpose */ }; });
    const held = holdEnded(seenCamEvents.current, list.flatMap(v => v.events), Date.now());
    return list.map(v => ({ ...v, events: held.filter(e => e.camera === v.device.key) })); })();
  // A ring opens the doorbell sheet on every device and closes it again after the module's seconds; any touch of the sheet keeps it. With another sheet open, a banner offers to switch instead.
  const alarms = modules.map(m => ({ m, a: m.def.alarm?.(m.entities, m.options) ?? null })).filter(x => x.a && x.a.seconds > 0) as Array<{ m: ActiveModule; a: { entityId: string; seconds: number } }>;
  const alarmStates = alarms.map(x => registry.states[x.a.entityId]?.state ?? '').join('|');
  const seenAlarms = useRef<string | null>(null);
  const [autoClose, setAutoClose] = useState<{ key: string; until: number } | null>(null), [ringBanner, setRingBanner] = useState<{ key: string; seconds: number } | null>(null);
  const openAlarm = (key: string, seconds: number) => { setRingBanner(null); if (view.device !== key) go({ section: view.section, room: view.room, filter: view.filter, device: key }); setAutoClose({ key, until: Date.now() + seconds * 1000 }); };
  useEffect(() => {
    const prev = seenAlarms.current; seenAlarms.current = alarmStates;
    if (prev === null || prev === alarmStates) return;
    const before = prev.split('|'), after = alarmStates.split('|');
    alarms.forEach((x, i) => {
      if (!ringOpensOnce(x.a.entityId, before[i], after[i], houseNow(registry.states))) return; // a real ring only: not the entity coming back from «unavailable», an HA restart or a reconnect with an old ring
      const dev = enabled.find(d => d.primary.id === x.m.entities.camera); if (!dev) return;
      if (view.device && view.device !== dev.key) { setRingBanner({ key: dev.key, seconds: x.a.seconds }); setTimeout(() => setRingBanner(b => b?.key === dev.key ? null : b), x.a.seconds * 1000); return; }
      openAlarm(dev.key, x.a.seconds);
    });
  }, [alarmStates]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!autoClose) return;
    const i = setInterval(() => { if (Date.now() >= autoClose.until) { setAutoClose(null); if (view.device === autoClose.key) closeSheet(); } else setTick(x => x + 1); }, 1000);
    return () => clearInterval(i);
  }, [autoClose, view.device]);
  const autoCloseFor = (key: string): AutoClose | null => autoClose && autoClose.key === key ? { left: Math.ceil((autoClose.until - Date.now()) / 1000), keep: () => setAutoClose(null) } : null;
  // House-wide notices from modules (a timer that ended): shown on every device, with one beep here if this device allows it.
  const banner = modules.map(m => m.def.banner?.(registry, m.entities, t, host) ?? null).find(Boolean) ?? null;
  const bannerSeen = useRef<string | null>(null);
  useEffect(() => { const key = banner ? `${banner.id}:${banner.text}:${banner.sub ?? ''}` : null; if (key && key !== bannerSeen.current && banner?.sound) { try { if (JSON.parse(localStorage.getItem('atom-home:clock') ?? '{}').beep !== false) beep(); } catch { beep(); } } bannerSeen.current = key; }, [banner?.id, banner?.text, banner?.sub]);
  // PERF-2 of the audit: nothing is prepared on the first touch — `beep()` builds its audio context when a sound is really due (modules/clock.tsx)
  const clockMod = modules.find(m => m.def.id === 'clock');
  // An alarm «один раз» switches itself off in the house after it has rung, and the list of alarms lives in the settings: read them again
  // when the ringing flag goes up or down, so the alarm is not shown «включён» (and saved back so) until the next periodic read.
  const ringing = clockMod?.entities.alarmFlag ? registry.states[clockMod.entities.alarmFlag]?.state : undefined, ringSeen = useRef(ringing);
  useEffect(() => { const was = ringSeen.current; ringSeen.current = ringing; if (was === ringing || was === undefined || ringing === undefined || !store || configPending) return; let alive = true; void store.load().then(r => { if (!alive || JSON.stringify(r.config) === JSON.stringify(confirmed.current)) return; /* whole, as after a conflict: the store now holds this read's revision, and old settings saved under it would wipe what another screen changed */ confirmed.current = r.config; setConfig(r.config); onConfigChange?.(r.config); }, () => undefined); return () => { alive = false; }; }, [ringing]);
  const setModuleOption = (id: string) => host.admin ? (key: string, value: string | undefined) => { const cur = config.modules[id] ?? {}; const options = { ...(cur.options ?? {}) }; if (value === undefined) delete options[key]; else options[key] = value; void applyConfig({ ...config, modules: { ...config.modules, [id]: { ...cur, options } } }).catch(() => undefined); } : undefined;
  const vacuum = useMemo(() => config.sections.cleaning?.hidden ? null : readVacuum(registry), [registry, config.sections.cleaning?.hidden]); // the robot vacuum (VACUUM.md): its own tile and the «Уборка» panel
  // the product photo of any appliance, by one of its entities: the `photo` slot of its device in the config (model/photos.ts)
  const photoOf = useMemo(() => photoIndex(registry, config), [registry.entities, config.devices]);
  // the Roborock renders of this house's robot (Atom Home photos, set once per house); the preview hands its own
  const vacPics = useMemo(() => { const o = config.modules.vacuum?.options ?? {}, dev = vacuum ? home.devices.find(d => d.primary.id === vacuum.entity) : undefined, url = (n?: string) => n ? `/atom_home_photos/${n}` : null;
    return { robot: host.previewFrame?.('vacuum:robot') ?? url(o.robot) ?? dev?.photo ?? photoOf(vacuum?.entity) ?? null, dock: host.previewFrame?.('vacuum:dock') ?? url(o.dock) }; }, [config, vacuum?.entity, home, photoOf]);
  const heating = useMemo(() => readHeating(registry, now.getTime()), [registry, Math.floor(now.getTime() / 60000)]); // the house's heating (HEATING.md): its own tile and the «Климат» panel
  // a working building heated by air conditioners (atom-okapi/HEATING.md): its own tile and the «Климат» panel, unless the section is hidden
  const office = useMemo(() => config.sections.climate?.hidden ? null : readOfficeClimate(registry, now.getTime()), [registry, config, Math.floor(now.getTime() / 60000)]);
  // HA's grid connections make a device a feed for the Energy tile (a building on Tasmota POW inputs, 09.11.2026); read once, empty until then
  const [grid, setGrid] = useState<ReadonlySet<string>>(() => new Set()), [haPrice, setHaPrice] = useState<number | null | undefined>(undefined);
  useEffect(() => { let alive = true; host.ws?.<EnergyPrefs>({ type: 'energy/get_prefs' }).then(p => { if (alive) { setGrid(gridIds(p)); setHaPrice(prefTariff(p, id => host.states()[id]?.state)); } }, () => undefined); return () => { alive = false; }; }, [host]);
  const boilers = useMemo(() => boilerDeviceIds(modules, registry), [modules, registry]); // the boiler's thermal kW is not electricity
  const hasPower = (d: HomeDevice) => d.metrics.some(m => isElectric(m, d, boilers) || m.deviceClass === 'energy');
  const energyDevices = enabled.filter(d => d.kind === 'energy' || hasPower(d));
  // an office building (several Alarmo areas under the master, Atom + Okapi 09.11.2026) has its own card; the house keeps the house's
  const officeSec = useMemo(() => readOfficeSecurity(registry, config, { id: host.userId ?? null, admin: host.admin }), [registry, config, host.admin]);
  const security = useMemo(() => officeSec ? null : readSecurity(registry, config), [registry, config, officeSec]);
  // An alarm, gas or smoke, water, the entry delay (and a tamper, in words only) are the whole panel's business, not one tile's: the shell
  // announces them once and shows a banner over every page and sheet, in the Security tile's own words (model/security-words.ts).
  const secLeft = useMemo(() => delayClock(), []);
  const secWords = useMemo(() => { if (!security || !announcement(security, t, 0, false)) return null; const home = people(registry, config).filter(p => p.state === 'home').length, guests = !!security.guests?.on; return { say: announcement(security, t, home, guests), banner: shellAlarm(security, t, home, guests) }; }, [security, t, registry, config]);
  const secSay = secWords?.say ?? '', alarmBanner = secWords?.banner ?? null;
  const present = (s: Section) => (s === 'security' && !!(security || officeSec)) || (s === 'climate' && !!(heating || office)) || s === 'home' || s === 'rooms' || s === 'systems' || (s === 'energy' ? energyDevices.length > 0 : s === 'camera' ? camViews.length > 1 : enabled.some(d => d.section === s));
  const systemTabs = SYSTEM_TABS.filter(s => present(s) && !config.sections[s]?.hidden);
  const inSystems = (SYSTEM_TABS as string[]).includes(view.section);
  const navActive = (id: Section | 'setup') => id === 'systems' ? inSystems : view.section === id;
  const lastSystems = useRef<Section | null>(null); if (inSystems) lastSystems.current = view.section as Section;
  // «Системы» opens the tab last looked at, the first one before that — never a tab that is hidden or has nothing to show
  const navTarget = (id: Section | 'setup') => id !== 'systems' ? id : lastSystems.current && systemTabs.includes(lastSystems.current) ? lastSystems.current : systemTabs[0] ?? 'home';
  const sideNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width, viewport.height]);
  const tabNav = useNavIndicator<HTMLElement>([view.section, wide, viewport.width]);
  const device = view.device ? enabled.find(d => d.key === view.device) : undefined;
  const clockOpen = view.device === 'clock' && !!clockMod;
  const feederMod = modules.find(m => m.def.sheetKey === 'feeder'), feederOpen = view.device === 'feeder' && !!feederMod;
  const airMod = modules.find(m => m.def.sheetKey === 'air'), airOpen = view.device === 'air' && !!airMod;
  const kettleMod = modules.find(m => m.def.sheetKey === 'kettle'), kettleOpen = view.device === 'kettle' && !!kettleMod;
  // H9 of the audit: a room is shown when it has a photo or something to look at or switch; «no room» only for the admin
  const LIVING: Kind[] = ['light', 'climate', 'media', 'vacuum', 'camera', 'environment', 'switch', 'socket', 'fan', 'cover', 'lock', 'opening', 'leak', 'motion'];
  const rooms = home.rooms.filter(r => !r.hidden && (r.id === NO_ROOM ? host.admin : (!!r.photo || enabled.some(d => d.roomId === r.id && LIVING.includes(d.kind)))));
  const roomName = (id: string) => home.rooms.find(r => r.id === id)?.name || t('room.none');
  // «Всё ли в порядке?» — the house status strip above Home's cards (model/house-status.ts; release «classic», from design 2026 phase 2)
  const boilerMod = modules.find(m => m.def.id === 'boiler_ebus'), boilerP = boilerMod?.entities.pressure ? Number(registry.states[boilerMod.entities.pressure]?.state) : NaN;
  const status: HouseStatus = houseStatus({ online: host.online, security, heating, vacuum, boiler: boilerMod ? { pressure: Number.isFinite(boilerP) ? boilerP : null } : null, devices: enabled, roomName, nameOf: d => inRoomName(d, roomName(d.roomId)), pages: new Set(systemTabs) }, t);
  const title = view.section === 'setup' ? t('setup.title') : view.section === 'rooms' && view.room ? roomName(view.room) : view.section === 'home' ? home.name : inSystems ? t('section.systems') : t(`section.${view.section}` as Key);
  const subtitle = view.section === 'home' ? `${t(head.greeting)} · ${date}` : view.section === 'rooms' && !view.room ? t('rooms.count', { n: rooms.length }) : '';
  const pageKey = pageOf(view);
  const modal =!!device || clockOpen || feederOpen || airOpen || kettleOpen || !!confirm;
  const navItems = [...NAV.filter(n => n.id !== 'lights' || (present('lights') && !config.sections.lights?.hidden)), ...(host.admin ? [{ id: 'setup' as const, icon: 'gear' }] : [])];
  const navLabel = (id: Section | 'setup') => id === 'setup' ? t('section.settings') : t(`section.${id}` as Key);
  // F8 of the audit (WCAG 2.4.3): focus moves into an opened sheet or confirmation and comes back to the opener when it closes
  const mainRef = useRef<HTMLElement>(null), sheetRef = useRef<HTMLElement>(null), confirmRef = useRef<HTMLDivElement>(null), sheetOpener = useRef<HTMLElement | null>(null), confirmOpener = useRef<HTMLElement | null>(null);
  const activeIn = (el: HTMLElement | null) => ((el?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement as HTMLElement | null) ?? null;
  const focusFirst = (el: HTMLElement | null) => (el?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? el?.querySelector<HTMLElement>('[tabindex]:not([tabindex="-1"])'))?.focus({ preventScroll: true });
  const sheetOpen = !!device || clockOpen || feederOpen || airOpen || kettleOpen;
  const lastInMain = useRef<HTMLElement | null>(null); // `main` is already inert when the effect runs, so the opener is remembered as focus moves, not read afterwards
  // a sheet opened by touch or mouse takes the focus itself (no ring around its «×»); opened from the keyboard, its first control does
  const byKeys = useRef(false);
  useEffect(() => { const mark = (keys: boolean) => { byKeys.current = keys; const shell = mainRef.current?.parentElement; if (shell) shell.dataset.input = keys ? 'keys' : 'pointer'; /* the heading that takes the focus on a new page shows a ring only to somebody who walks the page with the keyboard */ };
    const down = () => mark(false), key = (e: KeyboardEvent) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) mark(true); }; navigationWindow.addEventListener('pointerdown', down, true); navigationWindow.addEventListener('keydown', key, true); return () => { navigationWindow.removeEventListener('pointerdown', down, true); navigationWindow.removeEventListener('keydown', key, true); }; }, [navigationWindow]);
  // The keyboard's place is kept by one net over the whole shell (ui/focus-keep.ts): any control — a tile, a sheet's row, a card's own button —
  // that is disabled while its command is on its way gets the focus back when it is free again; what opened a sheet or a question is handed to
  // the same net. The arrows of a remote walk the top layer (ui/spatial-nav.ts).
  const shellRef = useRef<HTMLDivElement>(null), keep = useRef<FocusKeep | null>(null), tvNow = useRef(false); tvNow.current = panel.tv;
  useEffect(() => { const el = shellRef.current; if (!el) return; const k = keepFocus(el); keep.current = k; const nav = arrowNav(navigationWindow, () => shellRef.current, { tv: () => tvNow.current, last: () => k.last() }); return () => { nav.stop(); k.stop(); keep.current = null; }; }, [navigationWindow]);
  // Escape while a video of THIS panel is full screen leaves the full screen only (studio ST-08): the browser exits it itself, so the key is not
  // prevented, it just never reaches a question's or the sheet's own Escape. The shadow root's own fullscreenElement first (the document's would be
  // the retargeted host); another app's full screen is not ours. The next Escape, with no full screen, goes the usual way.
  useEffect(() => { const guard = (ev: KeyboardEvent) => { if (ev.key !== 'Escape') return; const shell = shellRef.current; if (!shell) return;
    const root = shell.getRootNode() as Document | ShadowRoot, full = root.fullscreenElement ?? shell.ownerDocument.fullscreenElement;
    if (full && shell.contains(full)) ev.stopPropagation(); };
    navigationWindow.addEventListener('keydown', guard, true); return () => navigationWindow.removeEventListener('keydown', guard, true); }, [navigationWindow]);
  const focusLost = () => keep.current ? keep.current.lost() : true;
  const giveBack = (el: HTMLElement | null) => keep.current?.give(el);
  const toastFrom = useRef<HTMLElement | null>(null); // where the keyboard was before it went to the message
  // f43: the house's alarm stands over every page and sheet, except on «Безопасность» itself with nothing over it (the page says it)
  const alarmShown = alarmBanner && !(view.section === 'security' && !sheetOpen && !confirm) ? alarmBanner : null;
  // The alarm takes over the screen (release «classic», from design 2026 phase 2): ONE main action by its reason — the alarm or the entry delay:
  // «Снять с охраны» (it asks, as decided); water: «Перекрыть воду» while there is a valve to close (closing is one tap, decided); gas or smoke:
  // «Показать». The other action, when there is one, is «Показать» (the «Безопасность» page). Nothing is sent without the house (the runner's guard).
  const [bannersH, setBannersH] = useState(0);
  const alarmTake = alarmShown && security ? (() => {
    const wet = security.hazards.filter(h => h.alarm), fire = wet.some(h => h.what !== 'leak'), leak = wet.length > 0 && !fire, st = security.alarm.state, valve = security.valve;
    const placeSec = systemTabs.includes('security') ? { section: 'security' as const } : { section: 'systems' as const, filter: 'attention' };
    const show: TakeAct = { label: t('take.show'), icon: 'shield', onClick: () => go(placeSec) };
    const at = wet.length ? wet[0].since : st === 'pending' ? null /* the countdown says it */ : security.alarm.since, since = at ? t('take.since', { t: dateFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at) }) : '';
    let main = show, second: TakeAct | undefined;
    if (leak && valve && valve.state !== 'closed' && valve.state !== 'offline') { const dev = enabled.find(d => d.primary.id === valve.id) ?? ({ key: `e:${valve.id}`, name: valve.name, primary: { id: valve.id, available: true, state: valve.state, attributes: {} } } as unknown as HomeDevice);
      main = { label: t('take.closeWater'), icon: 'water', busy: runner.busy.has(dev.key), onClick: () => void runner.run(dev, { id: 'close', label: 'action.close', kind: 'button', domain: 'valve', service: 'close_valve', entityId: valve.id, confirm: false, risk: 'water' }) }; second = show; }
    else if (!wet.length && (st === 'triggered' || st === 'pending')) { const dev = { key: 'sec:disarm', name: sk(t, 'title'), primary: { id: security.alarm.id, available: true, state: st, attributes: {} } } as unknown as HomeDevice;
      main = { label: t('take.disarm'), icon: 'unlock', busy: runner.busy.has(dev.key), onClick: () => void runner.run(dev, { id: 'disarm', label: 'action.disarm', kind: 'button', domain: 'alarm_control_panel', service: 'alarm_disarm', entityId: security.alarm.id, confirm: true, risk: 'security' }) }; second = show; }
    return <Takeover key="alarm" tone="danger" kind="alarm" glyph="danger" title={alarmShown.text} sub={[alarmShown.sub, since].filter(Boolean).join(' · ')} left={alarmShown.counting ? () => secLeft(security.alarm, statesNow.current) : null} main={main} second={second} className="is-alarm" />;
  })() : null;
  // l1: a banner that appears is where the keyboard goes next — it takes the focus when nothing has it (keyboard or remote), else the next Tab leads to it; a field being typed in keeps the focus
  const bannersKey = [alarmShown ? `a:${alarmShown.id}` : '', banner ? `b:${banner.id}` : '', ringBanner ? `r:${ringBanner.key}` : ''].filter(Boolean).join('|'), bannersSeen = useRef(''), bannerNext = useRef(false);
  useEffect(() => { const was = bannersSeen.current.split('|'); bannersSeen.current = bannersKey; if (!bannersKey) bannerNext.current = false; if (!bannersKey.split('|').some(k => k && !was.includes(k))) return;
    const first = shellRef.current?.querySelector<HTMLElement>('.ah-banners .is-main'); if (!first) return; if (focusLost() && (byKeys.current || tvNow.current)) first.focus({ preventScroll: true }); else bannerNext.current = true; }, [bannersKey]);
  useEffect(() => { const tab = (e: KeyboardEvent) => { if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || !bannerNext.current) return; bannerNext.current = false; const first = shellRef.current?.querySelector<HTMLElement>('.ah-banners .is-main'), a = activeIn(shellRef.current); if (!first || a?.closest('.ah-banners')) return; e.preventDefault(); first.focus({ preventScroll: true }); }; navigationWindow.addEventListener('keydown', tab, true); return () => navigationWindow.removeEventListener('keydown', tab, true); }, [navigationWindow]);
  useEffect(() => { if (sheetOpen) { sheetOpener.current ??= lastInMain.current; const raf = requestAnimationFrame(() => { const sheet = sheetRef.current, a = activeIn(sheet); if (sheet && a && a !== sheet && (sheet.contains(a) || a.closest('.at-win'))) return; /* the card's own window over the sheet (the alarm editor opened from a room) already has the focus */ if (byKeys.current) focusFirst(sheet); else sheet?.focus({ preventScroll: true }); }); return () => cancelAnimationFrame(raf); } const back = sheetOpener.current; sheetOpener.current = null; giveBack(back); }, [sheetOpen, view.device]);
  useEffect(() => { if (confirm) { confirmOpener.current ??= activeIn(mainRef.current); const raf = requestAnimationFrame(() => focusFirst(confirmRef.current)); return () => cancelAnimationFrame(raf); } const back = confirmOpener.current; confirmOpener.current = null; giveBack(back); }, [!!confirm]);
  // A new page starts at its top and its heading takes the focus when the control that led here is gone; «Back» returns the place and the control.
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    const m = mainRef.current, how = arrival.current; arrival.current = null; if (!m) return;
    const place = how === 'back' ? places.current.get(pageKey) : undefined;
    m.scrollTop = place?.top ?? 0;
    if (sheetOpen || !focusLost()) return;
    (findMark(m.querySelector('.hm-page'), place?.mark ?? null) ?? m.querySelector<HTMLElement>('.hm-head h1'))?.focus({ preventScroll: true });
  }, [pageKey]);
  // An address that names nothing (an old bookmark, a hidden section, a room or a device that is gone) becomes the nearest real one.
  const repaired = configPending ? null /* a cold link to a module's sheet or a section the real settings will bring is kept until they are read */ : repair(view, { sections: ['home', 'rooms', 'setup', ...(present('lights') && !config.sections.lights?.hidden ? ['lights'] : []), ...systemTabs], systems: systemTabs, allSystems: SYSTEM_TABS, rooms: home.rooms.map(r => r.id), sheet: sheetOpen });
  useEffect(() => { if (repaired) { replaceView(navigationWindow, repaired); setConfirm(null); setView(repaired); } });
  // A question about a device that has gone silent meanwhile is withdrawn: its answer could not be carried out.
  const asked = confirm ? enabled.find(d => d.key === confirm.device.key) : undefined;
  useEffect(() => { if (confirm && asked && !asked.primary.available) { setConfirm(null); notify(`${asked.name}: ${t('state.unavailable').toLowerCase()}`); } });
  return <PhotoOf.Provider value={photoOf}><div className={`hm-shell daily-shell at-shell ah-shell ${bannersH ? 'has-banners' : ''} ${host.online ? '' : 'is-offline'} ${wide && !short ? 'daily-fit-screen' : ''} ${panel.classes} hm-route-${view.section}`} ref={shellRef} onPointerDownCapture={e => { lastPress.current = { el: e.target as Element, at: Date.now() }; }} lang={lang} data-theme={config.home.theme} style={`--hm-height:${viewport.height}px;--hm-width:${viewport.width}px;--ah-banners-h:${bannersH}px${panel.scale !== 1 ? `;zoom:${panel.scale}` : ''}`}>
    <div className="ah-wallpaper" aria-hidden="true" />
    <button type="button" className="at-skip" inert={modal || undefined} onClick={() => mainRef.current?.focus()}>{t('ui.skip')}</button>
    {wide && <aside className="hm-sidebar" inert={modal || undefined}>
      <div className="hm-clock"><strong>{time}</strong><small>{date.split(',')[0]}</small></div>
      <nav aria-label={t('nav.main')} ref={sideNav}><i className="hm-nav-ind" aria-hidden="true" />{navItems.map(n => <button type="button" className={`${navActive(n.id) ? 'is-active' : ''} ${n.id === 'setup' ? 'at-setup-nav' : ''}`} aria-current={navActive(n.id) ? 'page' : undefined} onClick={() => go({ section: navTarget(n.id) })}><Icon name={n.icon} size={22} /><span>{navLabel(n.id)}</span></button>)}</nav>
      <div className="ah-side-rooms"><small>{t('section.rooms')}</small>{rooms.map(r => <button type="button" className={view.section === 'rooms' && view.room === r.id ? 'is-active' : ''} onClick={() => go({ section: 'rooms', room: r.id })}>{r.name || t('room.none')}</button>)}</div>
      <span className={`hm-conn ${host.online ? '' : 'is-off'}`}><i />{host.online ? t('ui.online') : t('ui.offline')}</span>
    </aside>}
    <main className="hm-main" ref={mainRef} tabIndex={-1} inert={modal || undefined} onFocusIn={e => { lastInMain.current = e.target as HTMLElement; }} onPointerDownCapture={e => { const hit = (e.target as Element).closest?.<HTMLElement>('button, a[href], input, select, [tabindex]'); if (hit) lastInMain.current = hit; /* a browser that does not focus a tapped button still tells where the way back leads */ }}>
      <header className="hm-head">
        {view.section === 'rooms' && view.room ? <button type="button" className="hm-back" onClick={() => leave({ section: 'rooms' })}><Icon name="back" size={20} />{t('section.rooms')}</button> : null}
        <div className="hm-head-title" key={pageKey}><h1 tabIndex={-1}>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        {!wide && <span className="hm-head-time">{time}</span>}
        {!host.online && <span className="hm-badge tone-danger">{t('ui.offline')}</span>}
        {configPending && <span className="hm-badge tone-warning at-config-pending">{t('ui.configPending')}</span>}
        {restartNeeded && host.admin && <span className="hm-badge tone-warning at-restart-needed" title={t('ui.restartNeeded')}>{t('ui.restartShort')}</span>}
        {view.section === 'home' && <HeadTools registry={registry} config={config} t={t} lang={lang} now={now.getTime()} admin={!!host.admin} wide={wide} chipsFit={peopleChips(panel, 4)} blocked={modal} onLanguage={l => { void applyConfig({ ...config, home: { ...config.home, language: l } }).catch(() => undefined); }} onSettings={() => go({ section: 'setup' })} />}
      </header>
      {inSystems && systemTabs.length > 1 && <div className="ah-segments hm-range-tabs is-sys" role="navigation" aria-label={t('section.systems')} ref={el => { const a = el?.querySelector<HTMLElement>('.is-active'); if (el && a && (a.offsetLeft < el.scrollLeft || a.offsetLeft + a.offsetWidth > el.scrollLeft + el.clientWidth)) el.scrollLeft = a.offsetLeft - 8; }}>{systemTabs.map(s => <button type="button" aria-current={view.section === s ? 'page' : undefined} className={view.section === s ? 'is-active' : ''} onClick={() => go({ section: s })}>{t(s === 'systems' ? 'section.devices' : `section.${s}` as Key)}</button>)}</div>}
      <div className="hm-page" key={pageKey}>
        {view.section === 'home' && <HouseStatusStrip status={status} go={go} t={t} />}
        {view.section === 'home' && <Overview sceneDone={done} shownRooms={rooms} vacPics={vacPics} vacuum={vacuum} security={security} officeSec={officeSec} heating={heating} office={office} grid={grid} home={home} registry={registry} config={config} modules={modules} player={player} tileState={tileState} host={host} runner={runner} toggle={toggle} go={go} t={t} lang={lang} now={now} camViews={camViews} />}
        {view.section === 'rooms' && !view.room && rooms.length === 0 && <p className="hm-muted at-empty">{t('ui.firstRun')}</p>}
        {view.section === 'rooms' && !view.room && <div className="hm-room-grid is-page">{rooms.map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div>}
        {view.section === 'rooms' && view.room && <RoomPage commands={commands} camViews={camViews} player={player} tileState={tileState} vacPics={vacPics} modules={modules} heating={heating} vacuum={vacuum} host={host} now={now.getTime()} home={home} registry={registry} roomId={view.room} runner={runner} toggle={toggle} go={go} t={t} lang={lang} alarms={clockMod && registry.entities.some(e => e.entity_id.startsWith('media_player.') && e.platform === 'yandex_station' && !e.disabled_by && (e.area_id ?? registry.devices.find(d => d.id === e.device_id)?.area_id) === view.room) ? config.alarms.filter(a => a.room === view.room) : null} />}
        {view.section === 'lights' && <LightsPage devices={enabled.filter(d => d.kind === 'light')} rooms={home.rooms} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} />}
        {view.section === 'security' && officeSec && <OfficeSecurityPanel s={officeSec} host={host} t={t} lang={lang} now={now.getTime()} admin={!!host.admin} title={config.home.name} />}
        {view.section === 'security' && security && <SecurityPanel s={security} registry={registry} config={config} host={host} commands={commands} t={t} lang={lang} now={now.getTime()} admin={!!host.admin} />}
        {view.section === 'climate' && heating && <HeatingPanel h={heating} host={host} t={t} lang={lang} now={now.getTime()} />}
        {view.section === 'climate' && !heating && office && <OfficeClimatePanel c={office} host={host} t={t} lang={lang} now={now.getTime()} />}
        {view.section === 'climate' && !heating && !office && <>{modules.filter(m => m.def.placement.includes('climate')).map(m => <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} />)}<ClimatePage devices={enabled.filter(d => d.section === 'climate')} runner={runner} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} /></>}
        {view.section === 'cleaning' && vacuum && view.filter === 'settings' && <VacuumSettings v={vacuum} host={host} t={t} lang={lang} onBack={() => leave({ section: 'cleaning' })} />}
        {view.section === 'cleaning' && vacuum && view.filter !== 'settings' && <><VacuumPanel pics={vacPics} v={vacuum} host={host} t={t} lang={lang} onSettings={() => go({ section: 'cleaning', filter: 'settings' })} />{enabled.some(d => d.section === 'cleaning' && d.primary.id !== vacuum.entity) && <KindList devices={enabled.filter(d => d.section === 'cleaning' && d.primary.id !== vacuum.entity)} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} />}</>}
        {view.section === 'cleaning' && !vacuum && <KindList devices={enabled.filter(d => d.section === 'cleaning')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} />}
        {/* «Энергия» in two tabs (owner, 09.11.2026): «Обзор» is the panel as it was, «Сейчас» who draws the power now */}
        {view.section === 'energy' && <div className="ah-segments hm-range-tabs rm-energy-tabs" role="group" aria-label={t('section.energy' as Key)}>{(['overview', 'now'] as const).map(k => { const on = (view.filter === 'now') === (k === 'now'); return <button type="button" aria-pressed={on} className={on ? 'is-active' : ''} onClick={() => { if (k === 'now') { if (view.filter !== 'now') energyPlace.current = view.filter; swap({ section: 'energy', filter: 'now' }); } else swap({ section: 'energy', filter: view.filter === 'now' ? energyPlace.current : view.filter }); }}>{t(`room.energyTab.${k}` as Key)}</button>; })}</div>}
        {view.section === 'energy' && view.filter === 'now' && <HouseLoad all={enabled} home={home} registry={registry} heating={heating} vacuum={vacuum} energyDevices={energyDevices} boilers={boilers} grid={grid} t={t} lang={lang} />}
        {view.section === 'energy' && view.filter !== 'now' && <EnergyPanel chargerOf={config.modules.energy?.options?.chargerOf ?? null} tariffs={config.energy.tariffs} host={host} devices={energyDevices} boilers={boilers} floors={registry.floors ?? []} floorOfArea={id => registry.areas.find(a => a.area_id === id)?.floor_id ?? null} feedOfRoom={id => config.rooms[id]?.feed ?? null} roomFeeds={Object.values(config.rooms).map(r => r.feed).filter((f): f is string => !!f)} roomName={roomName} nameOf={d => meterName(d.name)} onDevice={key => go({ section: 'energy', device: key, filter: view.filter })} place={view.filter} onPlace={place => swap({ section: 'energy', filter: place })} onTariff={host.admin ? () => go({ section: 'setup', filter: 'energy' }) : undefined} t={t} lang={lang} fallback={<EnergyPage devices={energyDevices} go={go} t={t} lang={lang} roomName={roomName} admin={host.admin} boilers={boilers} />} />}
        {view.section === 'camera' && <CamerasPanel views={camViews} player={player} host={host} now={now.getTime()} t={t} lang={lang} wide={wide} onCamera={key => go({ section: 'camera', device: key })} filter={view.filter} onFilter={f => swap({ section: 'camera', filter: f })} />}
        {view.section === 'setup' && <Setup registry={registry} config={config} onChange={applyConfig} admin={host.admin} t={t} lang={lang} storeLabel={store?.label ?? 'memory'} warnings={configWarnings} photos={store?.photos} tab={view.filter} onTab={tab => swap({ section: 'setup', filter: tab })} pending={configPending} sections={SECTIONS.filter(present)} haPrice={haPrice} />}
        {view.section === 'systems' && <SystemsPage before={<>{modules.filter(m => m.def.placement.includes('systems')).map(m => m.def.sheetKey ? <div className="ah-grid at-module-row"><m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact onOpen={() => go({ section: 'systems', device: m.def.sheetKey })} /></div> : <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} />)}</>} all={enabled} devices={enabled.filter(d => d.section === 'systems' || (d.section === 'camera' && camViews.length < 2) || d.section === 'weather')} runner={runner} toggle={toggle} go={go} t={t} lang={lang} roomName={roomName} rooms={home.rooms} admin={host.admin} filter={view.filter} onFilter={f => swap({ section: 'systems', filter: f })} />}
      </div>
    </main>
    {!wide && <nav className="hm-tabbar" aria-label={t('nav.main')} inert={modal || undefined} ref={tabNav}><i className="hm-nav-ind" aria-hidden="true" />{navItems.map(n => <button type="button" className={navActive(n.id) ? 'is-active' : ''} aria-current={navActive(n.id) ? 'page' : undefined} onClick={() => go({ section: navTarget(n.id) })}><Icon name={n.icon} size={24} /><span>{navLabel(n.id)}</span></button>)}</nav>}
    {clockOpen && clockMod && (() => { const close = closeSheet; const sheetWide = wide && landscape && viewport.width >= 800;
      return <div className="hm-scrim" key="sheet" inert={!!confirm || undefined} onClick={e => { if (e.target === e.currentTarget) close(); }}><section className={`hm-sheet ${sheetWide ? 'is-split' : ''}`} role="dialog" aria-modal="true" aria-label={t('clock.title')} ref={sheetRef} tabIndex={-1} {...swipe(close)}>
        <ClockSheet registry={registry} entities={clockMod.entities} host={host} t={t} lang={lang} runner={runner} onClose={close} wide={sheetWide} rooms={home.rooms.filter(r => !r.hidden).map(r => ({ id: r.id, name: r.name || t('room.none') }))} room={view.room} alarms={config.alarms} onAlarms={applyAlarms} config={config} /></section></div>; })()}
    {airOpen && (() => { const close = closeSheet, airWide = landscape && viewport.width >= 700;
      return <div className="hm-scrim" key="sheet" inert={!!confirm || undefined} onClick={e => { if (e.target === e.currentTarget) close(); }}><section className="hm-sheet" role="dialog" aria-modal="true" aria-label={t('module.air.title' as Key)} ref={sheetRef} tabIndex={-1} {...swipe(close)}>
        <AirSheet registry={registry} rooms={home.rooms} host={host} t={t} lang={lang} onClose={close} wide={airWide} /></section></div>; })()}
    {kettleOpen && kettleMod && (() => { const close = closeSheet, devRoom = registry.devices.find(d => d.id === kettleMod.entities.device)?.area_id, kettleWide = landscape && viewport.width >= 700;
      return <div className="hm-scrim" key="sheet" inert={!!confirm || undefined} onClick={e => { if (e.target === e.currentTarget) close(); }}><section className={`hm-sheet ${kettleWide ? 'is-split' : ''}`} role="dialog" aria-modal="true" aria-label={t('module.kettle.title' as Key)} ref={sheetRef} tabIndex={-1} {...swipe(close)}>
        <KettleSheet registry={registry} entities={kettleMod.entities} options={kettleMod.options} host={host} t={t} lang={lang} room={home.rooms.find(r => r.id === devRoom)?.name} wide={kettleWide} onClose={close} /></section></div>; })()}
    {feederOpen && feederMod && (() => { const close = closeSheet, dev = feederMod.entities.device ?? '', devRoom = registry.devices.find(d => d.id === dev)?.area_id, roomLabel = home.rooms.find(r => r.id === devRoom)?.name, feederWide = landscape && viewport.width >= 700;
      return <div className="hm-scrim" key="sheet" inert={!!confirm || undefined} onClick={e => { if (e.target === e.currentTarget) close(); }}><section className={`hm-sheet ${feederWide ? 'is-split' : ''}`} role="dialog" aria-modal="true" aria-label={t('module.pet_feeder')} ref={sheetRef} tabIndex={-1} {...swipe(close)}>
        <FeederSheet registry={registry} entities={feederMod.entities} options={feederMod.options} host={host} t={t} lang={lang} room={roomLabel} wide={feederWide} onClose={close} automations={automations.filter(a => a.devices.includes(dev) || a.entities.some(id => Object.values(feederMod.entities).includes(id))).map(a => ({ ...a, byRoom: false }))} /></section></div>; })()}
    {device && (() => {
      const close = closeSheet, roomName_ = home.rooms.find(r => r.id === device.roomId)?.name;
      const mod = device.kind === 'camera' ? (m => m?.def.Sheet ? m : undefined)(modFor(device)) : undefined, st = device.kind === 'camera' ? tileState(device) : null;
      const stage = device.kind === 'camera' ? (st?.closed ? <div className="at-cam-stage-closed"><Icon name="camera" size={32} /><span>{t('module.camera.closed')}</span></div> : player(device, 'stage')) : undefined;
      const roomy = device.kind === 'light' && wide && landscape && viewport.width >= 800; // a dimmable lamp's sheet: slider left, temperature and ambient light right
      const sheetWide = !!mod && wide && landscape && viewport.width >= 800; // a phone on its side (874×402) splits too: video left, controls right, instead of a video that fills the whole height
      return <div className="hm-scrim" key="sheet" inert={!!confirm || undefined} onClick={e => { if (e.target === e.currentTarget) close(); }}><section className={`hm-sheet ${sheetWide ? 'is-split' : ''} ${roomy ? 'is-roomy' : ''} ${autoClose?.key === device.key ? 'is-alarm' : ''}`} role="dialog" aria-modal="true" aria-label={device.name} ref={sheetRef} tabIndex={-1} {...swipe(close)} onPointerDownCapture={() => { if (autoClose?.key === device.key) setAutoClose(null); }} onKeyDownCapture={() => { if (autoClose?.key === device.key) setAutoClose(null); }}>
        {mod?.def.Sheet ? <mod.def.Sheet device={device} registry={registry} entities={mod.entities} options={mod.options} host={host} t={t} lang={lang} runner={runner} onClose={close} room={roomName_} stage={stage} wide={sheetWide} setOption={setModuleOption(mod.def.id)} autoClose={autoCloseFor(device.key)} /> : <DeviceSheet device={device} runner={runner} onClose={close} t={t} lang={lang} stage={stage} host={host} room={roomName_} automations={automationsFor(device)} title={inRoomName(device, roomName_ ?? '')} />}
      </section></div>;
    })()}
    {confirm && (() => { // AUTO-1 of the audit: the question names the consequence («Вода пойдёт сразу»), the button carries the verb and the risk colour
      const a = confirm.action, ask = confirmWords(a, confirm.device.name, t, security), text = ask.text; // ui/shell-logic.ts: with a leak sensor wet, opening the water names the leak and offers «Оставить закрытым» first
      return <div className="hm-scrim is-top" key="confirm" onClick={e => { if (e.target === e.currentTarget) setConfirm(null); }}><div className={`hm-confirm risk-${a.risk}`} role="alertdialog" aria-modal="true" aria-labelledby={`${uid}-ask`} aria-describedby={`${uid}-what`} ref={confirmRef}><h2 id={`${uid}-ask`}>{t('confirm.title')}</h2><p id={`${uid}-what`}>{text}</p><div><button type="button" className={`hm-pill at-confirm-no ${ask.leak ? 'is-primary' : ''}`} onClick={() => setConfirm(null)}>{ask.no}</button><button type="button" className={ask.leak ? 'hm-pill at-confirm-yes' : `hm-pill at-confirm-yes is-primary risk-${a.risk}`} aria-busy={asking || undefined} onClick={() => void runner.run(confirm.device, a, confirm.value)}>{ask.yes}</button></div></div></div>; })()}
    <Banners key="banners" onHeight={setBannersH}>
      {alarmTake}
      {ringBanner && (() => { const dev = enabled.find(d => d.key === ringBanner.key), poster = dev && typeof dev.primary.attributes.entity_picture === 'string' ? dev.primary.attributes.entity_picture : null;
        // the door's own picture: its LIVE frame (the tile players behind a sheet are paused, this one is not); while a camera's sheet holds the
        // one stream, Home Assistant's still of the doorbell (its entity_picture) instead
        const camOpen = home.devices.find(d => d.key === view.device)?.kind === 'camera', m = dev ? modFor(dev) : undefined, P = m?.def.Player;
        const frame = dev && m && P && !camOpen ? <P key={`${m.def.id}:${dev.key}:take`} entities={m.entities} options={m.options} host={host} t={t} lang={lang} mode="tile" poster={poster} camera={dev.primary.id} paused={false} /> : poster ? <img src={poster} alt="" /> : null;
        return <Takeover key="ring" tone="info" kind="ring" glyph="bell" className="at-door-ring" eyebrow={t('module.doorbell.ringing')} title={t('take.ring')} frame={frame ?? undefined} main={{ label: t('take.video'), icon: 'video', onClick: () => openAlarm(ringBanner.key, ringBanner.seconds) }} second={{ label: t('take.later'), onClick: () => setRingBanner(null) }} />; })()}
      {banner && <NoticeBar key="notice" icon={banner.icon ?? 'clock'} text={banner.text} sub={banner.sub} acts={<>{banner.extra && <button type="button" className="hm-pill" aria-busy={commands.pending('banner:snooze') || undefined} aria-disabled={commands.pending('banner:snooze') || undefined} onClick={() => void commands.run('banner:snooze', () => banner.extra!.run())}>{banner.extra.label}</button>}<button type="button" className="hm-pill is-primary is-main" aria-busy={commands.pending('banner:stop') || undefined} aria-disabled={commands.pending('banner:stop') || undefined} onClick={() => void commands.run('banner:stop', () => banner.stop())}>{t('clock.stop')}</button></>} />}
    </Banners>
    {/* The shell's two live regions, always in the page so that what appears in them is read out once: the calm one (the house is back),
        and the urgent one — the house is lost, a module's alarm, a ring, a refused command (the toast is its visible part). */}
    <div className="at-vh" key="polite" role="status" aria-live="polite" aria-atomic="true">{calm || null}</div>
    <div className="hm-announce" key="live" aria-live="assertive" aria-atomic="false" aria-relevant="additions text">
      {secSay ? <span className="at-vh" key={`sec:${secSay}`}>{secSay}</span> : null /* never «» itself: an empty text would be written again on every redraw */}
      {!host.online && <span className="at-vh" key={`offline:${offlineSaid.current}`}>{t('ui.offline')}</span>}
      {banner && <span className="at-vh" key={`banner:${banner.id}:${banner.text}`}>{banner.text}</span>}
      {ringBanner && <span className="at-vh" key="ring">{t('module.doorbell.ringing')}</span>}
      {toast && <div className={`hm-toast ${toastTop ? 'is-top' : ''}`} ref={toastEl} key={toast.id} tabIndex={toast.offline && !host.online ? -1 : 0} aria-hidden={toast.offline && !host.online ? 'true' : undefined /* the connection line above says it, read again for this message; what is hidden from a reader is not a Tab stop either */} onClick={dropToast} onPointerEnter={() => holdToast(null)} onPointerLeave={() => holdToast(Math.min(3000, toastMs.current))} onFocus={e => { toastFrom.current = e.relatedTarget as HTMLElement | null; holdToast(null); }} onBlur={() => holdToast(Math.min(3000, toastMs.current))} onKeyDown={e => { if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); dropToast(); giveBack(toastFrom.current); }}><Icon name="warning" size={18} /><span>{toast.text}</span></div>}
    </div>
  </div></PhotoOf.Provider>;
}
function useClock() { const [now, setNow] = useState(() => new Date()); useEffect(() => { const i = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(i); }, []); return now; }
type Nav = (next: Partial<View>) => void;
/** A sheet closes with a downward swipe that starts on its head (`.hm-sheet-head`, which the browser leaves to us: `touch-action: none`, so the
 * gesture is not taken away for scrolling). The sheet follows the finger, then springs back or leaves. The gesture lives in a ref for the
 * shell's whole life: the panel re-renders several times a second and must not drop a finger that is already down. */
function useSwipeClose() {
  const g = useRef({ y0: 0, dy: 0, id: -1, zoom: 1, el: null as HTMLElement | null, close: () => { /* set when a sheet is drawn */ } });
  return useMemo(() => {
    const end = (leave: boolean) => { const s = g.current, el = s.el; s.id = -1; s.el = null; if (!el) return; el.style.transition = 'transform .3s cubic-bezier(.34,1.4,.64,1)'; if (leave && s.dy > 90) { el.style.transform = 'translateY(110%)'; setTimeout(() => s.close(), 180); } else el.style.transform = ''; };
    const handlers = {
      onPointerDown: (e: PointerEvent) => { const el = e.currentTarget as HTMLElement, head = (e.target as Element).closest?.('.hm-sheet-head'); if (e.pointerType === 'mouse' || !head || !el.contains(head) || g.current.id !== -1) return; Object.assign(g.current, { y0: e.clientY, dy: 0, id: e.pointerId, el, zoom: el.offsetHeight > 0 ? el.getBoundingClientRect().height / el.offsetHeight : 1 /* measured in screen pixels, written in the shell's own (a zoomed shell) */ }); },
      onPointerMove: (e: PointerEvent) => { const s = g.current; if (s.id !== e.pointerId || !s.el) return; s.dy = swipeDelta(e.clientY, s.y0, s.zoom); if (s.dy > 8) { s.el.style.transition = 'none'; s.el.style.animation = 'none'; s.el.style.transform = `translateY(${s.dy}px)`; } },
      onPointerUp: (e: PointerEvent) => { if (g.current.id === e.pointerId) end(true); },
      onPointerCancel: (e: PointerEvent) => { if (g.current.id === e.pointerId) end(false); },
    };
    return (close: () => void) => { g.current.close = close; return handlers; };
  }, []);
}
type Common = { runner: Runner; go: Nav; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; admin?: boolean };
const canToggle = (d: HomeDevice) => actionsFor(d).some(a => a.id === 'toggle');
/** − / + of a plain thermostat tile (Home and «Климат» alike): `send` is the target itself, and a thermostat that is off gets `ask` — the tap
 * becomes the confirmed «Включить нагрев до N°», never a silent new target for a heating that stays off. */
const thermoSteps = (d: HomeDevice, temp: Action, runner: Runner, t: ReturnType<typeof translator>, lang: 'ru' | 'ro' | 'en') => ({ range: temp, send: (v: number) => runner.run(d, temp, v), ask: d.primary.state === 'off' ? (v: number) => void runner.run(d, heatOn(temp, v, t, lang), v) : undefined });
/** Inside a room the owner's «Свет · Кухня» reads as «Свет». */
const inRoomName = (d: HomeDevice, room: string) => { const n = shortLabel(d.name), r = room.trim().toLowerCase(); if (!r) return n; const l = n.toLowerCase(); return l.endsWith(' · ' + r) ? n.slice(0, -(r.length + 3)) : l.startsWith(r + ' · ') ? n.slice(r.length + 3) : n; };
/** H5 of the audit: the model in brackets («Датчик окна (SNZB-04PR2)») belongs to the sheet, not to a 150 px tile. */
const shortLabel = (name: string) => { const s = name.replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim(); return s.length >= 3 ? s : name.trim(); };
/** Tile grid for a list of devices; the toggle goes straight to the host, «…» opens the sheet in the given section. */
function Tiles({ devices, section, room, runner, toggle, go, t, lang, nameOf, roomOf }: Common & { devices: HomeDevice[]; section: Section; room?: string | null; toggle: (d: HomeDevice) => void; nameOf?: (d: HomeDevice) => string; roomOf?: (d: HomeDevice) => string }) {
  // two tiles that would read the same («Датчик окна» twice: the contact and its case) say what each one measures
  const said = devices.map(d => nameOf?.(d) ?? d.name), twice = (i: number) => said.some((n, j) => j !== i && n === said[i]);
  const named = (d: HomeDevice, i: number) => { if (!twice(i)) return nameOf?.(d); const what = metricLabel(d.primary, t); return what && what !== d.primary.name && what !== said[i] ? `${said[i]} · ${what}` : said[i]; };
  return <Cascade className="ah-grid hm-light-grid">{devices.map((d, i) => <AccessoryTile device={d} name={named(d, i)} room={roomOf?.(d)} pending={runner.busy.has(d.key)} onToggle={canToggle(d) ? () => toggle(d) : undefined} onOpen={() => go({ section, room: room ?? null, device: d.key })} t={t} lang={lang} />)}</Cascade>;
}
function Overview({ home, registry, config, modules, player, tileState, host, runner, toggle, go, t, lang, now, camViews, heating, office, grid, security, officeSec, vacuum, vacPics, shownRooms, sceneDone }: Common & { /** the scene whose command the house has just accepted (`button:<id>`) */ sceneDone?: string | null; /** the rooms of the «Комнаты» page: the strip shows the same ones */ shownRooms: Room[]; vacuum: ReturnType<typeof readVacuum>; vacPics: { robot: string | null; dock: string | null }; security: ReturnType<typeof readSecurity>; officeSec: ReturnType<typeof readOfficeSecurity>; heating: ReturnType<typeof readHeating>; office: ReturnType<typeof readOfficeClimate>; grid: ReadonlySet<string>; home: Home; registry: Registry; config: HouseConfig; modules: ActiveModule[]; player: (dev: HomeDevice, mode: 'tile' | 'stage') => JSX.Element | null; tileState: (dev: HomeDevice) => TileState | null; host: Host; toggle: (d: HomeDevice) => void; now: Date; camViews: CamView[] }) {
  const d = home.devices.filter(x => x.enabled);
  const secTile = !!(security || officeSec) && !config.sections.security?.hidden; // the Security tile, when shown, tells leaks and doors-and-windows itself
  const roomOf = (x: HomeDevice) => home.rooms.find(r => r.id === x.roomId)?.name || t('room.none');
  const leaks = d.filter(x => x.kind === 'leak'), wet = leaks.filter(x => x.primary.state === 'on'), leaksMute = leaks.length > 0 && leaks.every(x => !x.primary.available || x.primary.state === 'unknown');
  const co2 = d.flatMap(x => x.metrics).find(m => m.deviceClass === 'carbon_dioxide' && m.available && Number.isFinite(Number(m.state)));
  const co2v = co2 ? Number(co2.state) : null, air = co2Level(co2v, t), co2Dev = co2 ? d.find(x => x.metrics.includes(co2)) : undefined;
  const boilers = boilerDeviceIds(modules, registry);
  // Two cameras or more are one card (owner, 09.11.2026): the main one live, the others as frames, the panel behind it. One camera keeps its own tile.
  const camFocus = camViews.length > 1 ? camViews.find(v => v.device.key === focusCamera(camViews[0].device.key, camViews.flatMap(x => x.events), now.getTime(), houseTime(registry.states, now.getTime()))) ?? camViews[0] : null;
  // the owner's wish (04.11.2026): the home face shows the house thermostat (the boiler's), never a room's radiator head
  const isTrv = (x: HomeDevice) => artOf(x) === 'radiator';
  const climate = d.filter(x => x.kind === 'climate').sort((a, b) => Number(isTrv(a)) - Number(isTrv(b)))[0], cameras = camFocus ? [] : camViews.map(v => v.device), weather = d.find(x => x.kind === 'weather');
  const wtemp = weather && typeof weather.primary.attributes.temperature === 'number' ? weather.primary.attributes.temperature : null;
  // Home face = favourites + one summary module per group (Xiaomi Home «Освещение · всё выключено»), rooms underneath; everything else lives in Rooms and Systems.
  const favourites = d.filter(x => x.favorite && x !== climate && x.kind !== 'camera' && x.kind !== 'weather');
  const rooms = shownRooms;
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
  // − / + of the house thermostat: quick taps add up into one command (the tile keeps the draft); a thermostat that is off asks before it heats
  const steps = climate && tempAction ? thermoSteps(climate, tempAction, runner, t, lang) : undefined;
  const tile = (x: HomeDevice, section: Section = 'home') => <AccessoryTile device={x} name={canToggle(x) ? inRoomName(x, roomOf(x)) : x.name} room={canToggle(x) ? roomOf(x) : undefined} pending={runner.busy.has(x.key)} onToggle={canToggle(x) ? () => toggle(x) : undefined} onOpen={() => go({ section, device: x.key })} t={t} lang={lang} />;
  return <Cascade className="hm-home ah-home ah-grid ah-face" data-face="home-modular">
    {modules.some(m => m.def.id === 'clock') ? <ClockTile now={now} lang={lang} t={t} registry={registry} entities={modules.find(m => m.def.id === 'clock')!.entities} onOpen={() => go({ section: 'home', device: 'clock' })} /> : <PlainClockTile now={houseDate(now.getTime())} lang={lang} />}
    {secTile && officeSec && <OfficeSecurityTile s={officeSec} t={t} onOpen={() => go({ section: 'security' })} />}
    {secTile && security && <SecurityTile s={security} registry={registry} config={config} t={t} lang={lang} onOpen={() => go({ section: 'security' })} />}
    {heating && !config.sections.climate?.hidden && <HeatingTile h={heating} host={host} t={t} lang={lang} now={now.getTime()} onOpen={() => go({ section: 'climate' })} />}
    {office && !heating && <OfficeClimateTile c={office} host={host} t={t} lang={lang} now={now.getTime()} onOpen={() => go({ section: 'climate' })} />}
    {climate && !heating && !office && <ThermostatTile device={climate} name={inRoomName(climate, roomOf(climate))} sub={roomOf(climate)} target={temp} current={cur} steps={steps} onOpen={() => go({ section: 'home', device: climate.key })} t={t} lang={lang} />}
    {camFocus && <CamerasTile views={camViews} focus={camFocus} player={player} host={host} now={now.getTime()} t={t} lang={lang} onPanel={() => go({ section: 'camera' })} onCamera={key => go({ section: 'home', device: key })} />}
    {vacuum && <VacuumTile pics={vacPics} v={vacuum} host={host} t={t} lang={lang} onOpen={() => go({ section: 'cleaning' })} />}
    {cameras.slice(0, 1).map(c => { const st = tileState(c); return <CameraTile device={c} state={st} player={st?.closed ? null : player(c, 'tile')} onOpen={() => go({ section: 'home', device: c.key })} t={t} lang={lang} large />; })}
    {modules.filter(m => m.def.placement.includes('overview')).map(m => { if (m.def.sheetKey) return <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact rooms={home.rooms} onOpen={() => go({ section: 'home', device: m.def.sheetKey })} />; const target = (m.def.placement.find(p => p !== 'overview') ?? 'systems') as Section, name = t(`module.${m.def.id}` as Key); return <div className="ah-tile ah-module"><button type="button" className="ah-tile-hit at-module-hit" aria-label={`${t('ui.open')}: ${name === `module.${m.def.id}` ? t(`section.${target}` as Key) : name}`} onClick={() => go({ section: target })} /><div className="at-module-body"><m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact /></div></div>; })}
    {config.buttons.slice(0, 6).map(b => { const a = customAction(b); return <SceneTile icon={b.icon ?? 'more'} label={b.label} t={t} busy={runner.busy.has(`button:${b.id}`)} done={sceneDone === `button:${b.id}`} onClick={() => void runner.run({ key: `button:${b.id}`, name: b.label, primary: { available: true } } as HomeDevice, a)} />; })}
    {weather && <ValueTile icon="air" value={wtemp === null ? '—' : num(wtemp, lang, 0)} unit={wtemp === null ? undefined : '°'} label={weather.name} sub={stateText(weather.primary, t, lang)} color="#32ade6" onClick={() => go({ section: 'systems', device: weather.key })} className="at-weather" />}
    {co2 && !modules.some(m => m.def.sheetKey === 'air') && <ValueTile icon="air" value={num(co2v!, lang, 0)} unit="ppm" label={t('overview.air')} sub={air.label} color={air.tone === 'danger' ? '#ff3b30' : air.tone === 'warning' ? '#ff9f0a' : '#30d158'} onClick={() => go({ section: 'systems', device: co2Dev?.key ?? null })} className={`hm-status tone-${air.tone}`} />}
    <EnergyTile devices={d} boilers={boilers} grid={grid} host={host} t={t} lang={lang} onClick={() => go({ section: 'energy' })} />
    {/* «Безопасность» already tells leaks, doors and windows: no second tile for them */}
    {!secTile && leaks.length > 0 && <ValueTile icon="water" value={wet.length ? t('state.wet') : leaksMute ? '—' : t('overview.leaks.dry')} label={t('overview.leaks')} sub={wet.length ? wet.map(x => x.name).join(', ') : leaksMute ? `${t('state.unknown').toLowerCase()} · ${t('rooms.count', { n: leaks.length }).replace(/^\d+ /, `${leaks.length} `)}` : t('rooms.count', { n: leaks.length }).replace(/^\d+ /, `${leaks.length} `)} color={wet.length ? '#ff3b30' : leaksMute ? '#8e8e93' : '#32ade6'} onClick={() => go({ section: 'systems', filter: wet.length ? 'attention' : null })} className={`hm-status ${wet.length ? 'tone-danger' : leaksMute ? 'tone-muted' : 'tone-calm'}`} />}
    {cameras.slice(1).map(c => { const st = tileState(c); return <CameraTile device={c} state={st} player={st?.closed ? null : player(c, 'tile')} onOpen={() => go({ section: 'home', device: c.key })} t={t} lang={lang} />; })}
    {groups.map(g => g.id === 'systems' && openings.length && !secTile ? <ValueTile icon="door" value={opened ? String(opened) : t('overview.allClosed')} unit={opened ? `/ ${openings.length}` : undefined} label={t('overview.openings')} sub={opened ? t('overview.opened', { n: opened }) : t('overview.doorsWindows', { n: openings.length })} color={opened ? '#ff9f0a' : '#30d158'} onClick={() => go({ section: 'systems', filter: opened ? 'attention' : null })} className={`ah-group-tile kind-${g.id}`} /> : <ValueTile icon={g.icon} value={g.on !== undefined ? String(g.on) : g.id === 'cleaning' && g.count === 1 ? stateText(d.find(x => x.kind === 'vacuum')!.primary, t, lang).split(' · ')[0] : String(g.count)} unit={g.on !== undefined ? `/ ${g.count}` : undefined} label={g.label} sub={g.on !== undefined ? t('overview.on', { n: g.on }) : t('overview.devices', { n: g.count })} color={g.on ? '#ffcc00' : g.color} onClick={() => go({ section: g.section })} className={`ah-group-tile kind-${g.id}`} />)}
    {favourites.map(x => tile(x, x.kind === 'climate' ? 'climate' : 'home'))}
    {d.length === 0 && rooms.length === 0 && <p className="hm-muted at-empty at-first-run">{t('ui.firstRun')}</p>}
    {rooms.length > 0 && <div className="ah-rooms-strip"><div className="hm-section-head"><h2>{t('section.rooms')}</h2><button type="button" className="hm-text-btn" onClick={() => go({ section: 'rooms' })}>{t('ui.all')}<Icon name="next" size={18} /></button></div>
      <div className="hm-room-grid">{rooms.slice(0, 8).map(r => { const c = roomClimate(home, registry, r.id); return <RoomTile room={r} temperature={c.temperature} humidity={c.humidity} co2={c.co2} lightsOn={c.lights.filter(l => isOn(l.primary)).length} onClick={() => go({ section: 'rooms', room: r.id })} t={t} lang={lang} label={r.name || t('room.none')} />; })}</div></div>}
  </Cascade>;
}
function CameraTile({ device, player, state, onOpen, t, lang, large }: { device: HomeDevice; player?: JSX.Element | null; state?: TileState | null; onOpen: () => void; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en'; large?: boolean }) {
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
  const closed = state?.closed === true;
  return <div className={`hm-card hm-camera-tile ah-camera ah-tile ${large ? 'is-large' : ''} ${closed ? 'is-closed' : ''} ${state?.tone ? `is-${state.tone}` : ''}`}>
    <button type="button" className="at-cams-hit" aria-label={`${t('ui.open')}: ${device.name}`} onClick={onOpen} />
    <div className="hm-camera-frame">{closed ? <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{t('module.camera.closed')}</span></div> : player ? player : pic ? <img className="at-camera-img" src={pic} alt="" /> : <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{stateText(device.primary, t, lang)}</span></div>}{(!player || closed) && <span className="hm-live"><i />{closed ? t('state.off') : device.primary.available ? t('state.idle') : t('state.unavailable')}</span>}
      {state?.icon && !closed && <span className={`at-cam-badge ${state.tone === 'danger' ? 'is-ring' : ''}`} title={state.line ?? ''}><Icon name={state.icon} size={16} />{state.tone === 'danger' && <span>{state.line}</span>}</span>}
      <div className="hm-camera-caption"><strong>{device.name}</strong><small>{state?.line ?? modelText(device.model) ?? ''}</small><Icon name="next" size={18} /></div></div>
  </div>;
}
function RoomPage({ home, registry, roomId, runner, toggle, go, t, lang, alarms, heating, vacuum, host, now, modules, player, tileState, vacPics, camViews, commands }: Common & { commands: import('../runtime/commands.ts').Commands; home: Home; registry: Registry; roomId: string; toggle: (d: HomeDevice) => void; alarms: Alarm[] | null; heating: ReturnType<typeof readHeating>; vacuum: ReturnType<typeof readVacuum>; host: Host; now: number; modules: ActiveModule[]; player: (dev: HomeDevice, mode: 'tile' | 'stage') => JSX.Element | null; tileState: (dev: HomeDevice) => TileState | null; vacPics: { robot: string | null; dock: string | null }; camViews: CamView[] }) {
  // a device a module draws (the kettle, the cat feeder): its room card opens the module's own sheet, wherever else the module shows
  const sheetOf = (deviceId: string) => modules.find(m => m.def.sheetKey && m.entities.device === deviceId)?.def.sheetKey;
  // the room page the owner chose on 09.11.2026 (docs/ROOM.md): readings on top, one card per device, the room's radiator and power
  const byMain = (id: string) => home.devices.find(d => d.enabled && d.primary.id === id);
  // a device that already has its own card is drawn by that very card, here as on Home and in its panel (owner, 09.11.2026): the kettle, the feeder, the robot, a camera
  const roomCams = camViews.filter(v => v.device.roomId === roomId);
  let things: Thing[] = [];
  const ownCard = (th: Thing, all: Thing[]) => { things = all;
    const m = modules.find(x => x.entities.device === th.key);
    if (m) return m.def.sheetKey ? <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} compact rooms={home.rooms} onOpen={() => go({ section: 'rooms', room: roomId, device: m.def.sheetKey })} /> : <m.def.Card registry={registry} entities={m.entities} options={m.options} host={host} t={t} lang={lang} />;
    if (th.kind === 'vacuum' && vacuum && th.ids.includes(vacuum.entity)) return <VacuumTile pics={vacPics} v={vacuum} host={host} t={t} lang={lang} onOpen={() => go({ section: 'cleaning' })} />;
    if (th.kind === 'camera') { // the room's cameras as Home draws them: two or more are one «Камеры» card, one camera its own tile; the card stands once, in the first camera's place
      const first = roomCams.length ? things.find(x => x.kind === 'camera') : undefined; if (th !== first) return roomCams.length ? false : null;
      if (roomCams.length > 1) return <CamerasTile views={roomCams} focus={roomCams.find(v => v.device.key === focusCamera(roomCams[0].device.key, roomCams.flatMap(x => x.events), now, houseTime(registry.states, now))) ?? roomCams[0] /* the camera with the event comes forward here as it does on Home */} player={player} host={host} now={now} t={t} lang={lang} onPanel={() => go({ section: 'camera' })} onCamera={key => go({ section: 'rooms', room: roomId, device: key })} />;
      const c = roomCams[0].device, st = tileState(c); return <CameraTile device={c} state={st} player={st?.closed ? null : player(c, 'tile')} onOpen={() => go({ section: 'rooms', room: roomId, device: c.key })} t={t} lang={lang} large />;
    }
    return null;
  };
  return <RoomView ownCard={ownCard} reg={registry} roomId={roomId} roomName={home.rooms.find(r => r.id === roomId)?.name ?? ''} heating={heating} vacuum={vacuum} host={host} t={t} lang={lang} now={now} alarms={alarms}
    deviceOf={byMain} toggle={toggle} commands={commands} act={(d, id) => { const a = actionsFor(d).find(x => x.id === id); if (a) void runner.run(d, a); }} hidden={th => { const ds = home.devices.filter(d => th.ids.includes(d.primary.id)); return ds.length > 0 && ds.every(d => !d.enabled); }} open={d => go({ section: 'rooms', room: roomId, device: d.key })} busy={d => runner.busy.has(d.key)} onHeating={() => go({ section: 'climate' })} onAlarms={() => go({ section: 'rooms', room: roomId, device: 'clock' })} sheetOf={sheetOf} openSheet={key => go({ section: 'rooms', room: roomId, device: key })} />;
}
/** The whole house's consumers now, room by room, plus the car's charger from the mains (HA's Energy → «Сейчас»): the busiest on top. */
function HouseLoad({ all, home, registry, heating, vacuum, energyDevices, boilers, grid, t, lang }: { all: HomeDevice[]; home: Home; registry: Registry; heating: ReturnType<typeof readHeating>; vacuum: ReturnType<typeof readVacuum>; energyDevices: HomeDevice[]; boilers: Set<string>; grid: ReadonlySet<string>; t: ReturnType<typeof translator>; lang: 'ru' | 'ro' | 'en' }) {
  const rows = home.rooms.filter(r => !r.hidden).flatMap(r => { const m = readRoom(registry, r.id, r.name, heating, vacuum), all = [...m.things, ...m.air]; return m.consumers.map(c => ({ key: c.key, name: c.name, sub: r.name, watts: c.power, icon: GLYPH[all.find(x => x.key === c.key)?.kind ?? 'other'] })); });
  for (const ch of channels(energyDevices, boilers, grid).filter(c => c.charger)) { const w = Number(ch.power.state); if (Number.isFinite(w)) rows.push({ key: ch.key, name: ch.name, sub: home.rooms.find(r => r.id === ch.areaId)?.name ?? '', watts: w, icon: 'car' }); }
  // One «сейчас» for the house (audit 2026-11-09: the tile and «Обзор» said 290 W, this list 168 W): what the mains feed draws beyond the
  // consumers that have a meter of their own is one more row, so the total here is the feed's — the figure of the tile.
  const chs = prefChannels(channels(all, boilers, grid), grid.size ? { energy_sources: [...grid].map(id => ({ type: 'grid', stat_energy_from: id })) } : null), feed = chs.length ? feedNow(chs) : feedPower(all, boilers, grid);
  const metered = rows.reduce((s, r) => s + Math.max(0, Number.isFinite(r.watts) ? r.watts : 0), 0), rest = feed && feed.watts !== null ? feed.watts - metered : 0;
  if (rest >= 1) rows.push({ key: 'unmetered', name: t('ui.unmetered'), sub: '', watts: rest, icon: 'more' });
  return rows.length ? <LiveLoad title={t('room.houseTitle' as Key)} rows={rows} t={t} lang={lang} className="rm-house-load" level={2} /> : null;
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
    return <ThermostatTile device={d} name={inRoomName(d, roomName(d.roomId))} sub={roomName(d.roomId)} target={target} current={cur} steps={temp ? thermoSteps(d, temp, runner, t, lang) : undefined} onOpen={() => go({ section: 'climate', device: d.key })} t={t} lang={lang} />; })}</div>;
}
function KindList({ devices, runner, toggle, go, t, lang, roomName, admin }: Common & { devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string }) {
  if (!devices.length) return <Empty go={go} t={t} admin={admin} />;
  return <div className="ah-grid at-list">{devices.map(d => <div className="ah-tile-stack at-device" data-device-key={d.key}><AccessoryTile device={d} name={withRoom(d.name, roomName(d.roomId))} pending={runner.busy.has(d.key)} onToggle={canToggle(d) ? () => toggle(d) : undefined} onOpen={() => go({ section: 'cleaning', device: d.key })} t={t} lang={lang} wide />
    <div className="hm-chips">{actionsFor(d).filter(a => a.kind === 'button').map(a => <button type="button" {...held(runner.busy.has(d.key))} disabled={!d.primary.available} onClick={() => { if (!runner.busy.has(d.key)) void runner.run(d, a); }}>{t(a.label as Key)}</button>)}</div></div>)}</div>;
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
    if (map[key]) return t(map[key]);
    // «Квартира 8 · энергия today» (a meter's channel): the channel's name stays, the reading after it is said in the panel's language
    const tail = /^(.*?)[\s·—:-]*(?:energy|энергия|energie)[\s_]+(today|month|yesterday|total|сегодня|вчера|всего)$/i.exec(n), word: Record<string, Key> = { today: 'energy.today', month: 'energy.month', yesterday: 'energy.yesterday', total: 'energy.total', 'сегодня': 'energy.today', 'вчера': 'energy.yesterday', 'всего': 'energy.total' };
    return tail ? [tail[1].trim(), t(word[tail[2].toLowerCase()])].filter(Boolean).join(' · ') : (n || metricLabel(m, t));
  };
  // a unit as the language writes it («Вт», «кВт·ч»: the Energy panel's own words), and a reading with it; a unit the panel has no word for stays
  const unit = (code: string) => { const k = `ep.unit.${code.toLowerCase()}` as Key, s = t(k); return s === k ? code : s; };
  const reading = (m: EntityRef) => { const s = stateText(m, t, lang); return m.unit && s.endsWith(` ${m.unit}`) ? s.slice(0, -m.unit.length) + unit(m.unit) : s; };
  // the device's power is all of its inputs together (a feed meter with four channels showed its first one, «2 W», beside «24 Вт» on «Сейчас»)
  const pw = (d: HomeDevice) => { const ms = d.metrics.filter(x => isElectric(x, d, boilers) && x.available && Number.isFinite(Number(x.state))); return ms.length ? ms.reduce((a, m) => a + Number(m.state) * (m.unit === 'kW' ? 1000 : 1), 0) : null; };
  const max = Math.max(1, ...devices.map(d => pw(d) ?? 0));
  return <div className="hm-energy"><div className="hm-energy-lines">{devices.map(d => { const w = pw(d); return <button type="button" className="hm-card hm-line" data-device-key={d.key} onClick={() => go({ section: 'energy', device: d.key })}>
    <span className="hm-line-head"><span className="ah-glyph is-small" style="--tile:#30d158"><Icon name="energy" size={16} /></span><strong>{inRoomName(d, roomName(d.roomId))}</strong><span className="hm-badge">{roomName(d.roomId)}</span></span>
    <b>{w === null ? '—' : w >= 1000 ? `${num(w / 1000, lang, 2)} ${unit('kW')}` : `${num(w, lang, 0)} ${unit('W')}`}</b><span className="hm-meter"><i style={`width:${Math.round(100 * (w ?? 0) / max)}%`} /></span>
    <span className="hm-line-facts">{d.metrics.filter(m => m.deviceClass !== 'power').slice(0, 4).map(m => <span><small>{caption(m, d)}</small> {reading(m)}</span>)}</span>
  </button>; })}</div></div>;
}
function SystemsPage({ all, devices, runner, toggle, go, t, lang, roomName, rooms, admin, filter, onFilter, before }: Common & { /** the module cards that stand above the list (the feeder): given here, they step aside while a search is typed, so that nothing stands above its results */ before?: JSX.Element | null; /** every device of the house: what the search looks through */ all: HomeDevice[]; devices: HomeDevice[]; toggle: (d: HomeDevice) => void; roomName: (id: string) => string; rooms: Room[]; filter: string | null; onFilter: (f: string | null) => void }) {
  // IA-1 / F12 of the audit: 100+ devices need an entrance «what is wrong now» and a search box
  const [q, setQ] = useState('');
  const attention = (x: HomeDevice) => !x.primary.available || (['opening', 'leak', 'motion', 'alarm'].includes(x.kind) && x.primary.state === 'on') || (x.kind === 'alarm_panel' && x.primary.state === 'triggered');
  const needs = devices.filter(attention), query = q.trim().toLowerCase();
  // «Найти устройство…» finds any device of the house — a lamp, the robot, a thermostat — not only what this tab lists; what it finds opens its own sheet
  const shown = (query ? all : devices).filter(x => (filter !== 'attention' || attention(x)) && (!query || `${x.name} ${roomName(x.roomId)} ${t(`kind.${x.kind}` as Key)}`.toLowerCase().includes(query)));
  const groups: Array<[Kind[], string]> = [[['leak', 'alarm', 'valve', 'lock', 'alarm_panel', 'opening', 'motion'], t('overview.leaks') + ' · ' + t('kind.alarm_panel')], [['environment', 'measurement'], t('overview.air')], [['socket', 'switch', 'fan', 'cover'], t('section.systems')], [['media', 'camera'], t('kind.media')], [['weather', 'person'], t('section.weather')], /* found by the search only: they live in other sections */ [['light'], t('section.lights')], [['climate'], t('section.climate')], [['vacuum'], t('section.cleaning')], [['energy'], t('section.energy')]];
  const rendered = groups.filter(([kinds]) => shown.some(d => kinds.includes(d.kind))), above = query ? null : before ?? null;
  if (!devices.length) return <>{before}<Empty go={go} t={t} admin={admin} /></>;
  const bar = <div className="hm-toolbar at-sys-bar"><label className="at-search-wrap"><span className="at-vh">{t('systems.search')}</span><input type="search" className="at-search" placeholder={t('systems.search')} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /></label><button type="button" className={`hm-pill at-sys-attn ${filter === 'attention' ? 'is-active' : ''} ${needs.length ? 'is-warn' : ''}`} aria-pressed={filter === 'attention'} onClick={() => onFilter(filter === 'attention' ? null : 'attention')}>{t('systems.attention')}{needs.length ? ` · ${needs.length}` : ''}</button></div>;
  if (!rendered.length) return <>{above}<div className="hm-systems">{bar}<p className="hm-muted at-empty">{filter === 'attention' && !query ? t('systems.allFine') : t('systems.nothing')}</p></div></>;
  // H3 of the audit: inside a group the tiles go room by room, named without the room and the model
  const order = [...rooms.map(r => r.id), NO_ROOM], byRoom = (list: HomeDevice[]) => [...new Set(list.map(d => d.roomId))].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)).map(roomId => ({ roomId, room: roomName(roomId), list: list.filter(d => d.roomId === roomId) }));
  return <>{above}<div className="hm-systems">{bar}{rendered.map(([kinds, title]) => { const list = shown.filter(d => kinds.includes(d.kind)); const parts = byRoom(list); return <Block title={title}>{parts.length > 1 ? /* the rooms of a group stand side by side like the rooms of «Свет» (the same grid), not one room per row with most of the row empty */ <div className="at-sys-rooms">{parts.map(p => <div className={`at-sys-room span-${Math.min(p.list.length, 3)}`}><h3>{p.room}</h3><Tiles devices={p.list} section="systems" runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={d => inRoomName(d, p.room)} /></div>)}</div> : <Tiles devices={list} section="systems" runner={runner} toggle={toggle} go={go} t={t} lang={lang} nameOf={d => inRoomName(d, roomName(d.roomId))} roomOf={d => canToggle(d) ? roomName(d.roomId) : undefined as unknown as string} />}</Block>; })}</div></>;
}
/** N5 of the audit: an empty section tells the admin where to add devices. */
function Empty({ go, t, admin }: { go: Nav; t: ReturnType<typeof translator>; admin?: boolean }) {
  return <p className="hm-muted at-empty">{t('ui.nodevices')}{admin && <button type="button" className="hm-pill" onClick={() => go({ section: 'setup' })}>{t('setup.title')}</button>}</p>;
}
