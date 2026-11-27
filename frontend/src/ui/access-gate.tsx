/** The access split on the screen (docs/ACCESS.md; the rules are model/access.ts). Everything the panel draws goes through here: with the split
 * off, or for an administrator, the panel gets exactly what it got before. Otherwise it gets the registry of the buildings it may see, the
 * settings with the pages and cards of its roles, a host whose commands the roles allow, and a store that saves only alarms (merged back with
 * the alarms of the other buildings, never saving the narrowed settings over the house's). «Посмотреть глазами» is the same, for another user,
 * with a bar on top to leave it. A person with no building gets a calm screen instead of the panel. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, ComponentType, JSX } from 'preact';
import type { HouseConfig, Alarm } from '../model/config.ts';
import { dayKey } from '../model/config.ts';
import type { Host } from '../runtime/host.ts';
import { SaveError, type ConfigStore } from '../runtime/store.ts';
import { setHouseZone, houseDate } from '../runtime/zone.ts';
import { setControlPolicy } from '../runtime/actions.ts';
import { translator, type Key } from '../i18n/index.ts';
import { activeModules, MODULES } from '../modules/index.ts';
import type { HomeDevice } from '../model/discover.ts';
import { resolveAccess, switchChoices, pickBuilding, scopeOf, rememberScope, controlPolicy, scopeConfig, hiddenModules, deviceShown, areaIndex, mergeAlarms, callTargets, scopeMode, modeAllows, buildingsOf, roomRole, ALL_BUILDINGS, NO_BUILDING, type AccessUser, type Scope } from '../model/access.ts';
import { readLayoutPointer, LAYOUT_POINTER_EVENT } from './layout-grid.tsx';
import { Icon } from './primitives.tsx';
import type { AppProps } from './app.tsx';

/** What the panel itself takes besides the app's props: the cards it may draw, the bar over its header, the «view as» of «Acces». */
export interface PanelExtras { deviceFilter?: (d: Pick<HomeDevice, 'key' | 'roomId' | 'kind' | 'haDeviceId'>) => boolean; accessBar?: ComponentChildren; onViewAs?: (u: AccessUser) => void }
const BUILDING_KEY = 'atom-home:building';
/** A screen that was narrowed once remembers it: while the house's settings are still being read (or could not be), it waits instead of
 * showing every building for a moment (the factory settings know no split). */
const NARROWED_KEY = 'atom-home:access-narrowed';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
/** This screen's named device, kept current. */
function useProfile(): string | null {
  const [p, setP] = useState(readLayoutPointer);
  useEffect(() => { const on = () => setP(readLayoutPointer()); addEventListener(LAYOUT_POINTER_EVENT, on); addEventListener('storage', on); return () => { removeEventListener(LAYOUT_POINTER_EVENT, on); removeEventListener('storage', on); }; }, []);
  return p;
}
const denied = () => Object.assign(new Error('access_view_only'), { code: 'access_view_only' });

export function AccessGate({ Panel, ...p }: AppProps & { Panel: ComponentType<AppProps & PanelExtras> }) {
  const { registry, config: real, host: bare, store, onConfigChange, configPending = false } = p;
  setHouseZone(bare.timeZone);
  const [viewAs, setViewAs] = useState<AccessUser | null>(null);
  const profile = useProfile();
  const [chosen, setChosen] = useState<string | null>(() => read(BUILDING_KEY));
  const t = useMemo(() => translator(real.home.language), [real.home.language]);
  const floorIds = useMemo(() => buildingsOf(registry.floors).map(f => f.floor_id), [registry.floors]);
  const viewer = viewAs ? { id: viewAs.id, admin: viewAs.admin, profile } : { id: bare.userId ?? null, admin: bare.admin, profile };
  const access = resolveAccess(real.access, viewer, dayKey(houseDate()), floorIds);
  // only the signed-in person's own view is remembered, never a «view as»
  useEffect(() => { if (viewAs || configPending) return; write(NARROWED_KEY, access.kind === 'open' ? null : '1'); }, [access.kind, viewAs, configPending]);
  const choices = access.kind === 'some' ? switchChoices(access, registry.floors) : [];
  const shown = pickBuilding(choices, chosen);
  const scope: Scope | null = access.kind === 'some' && real.access ? scopeOf(real.access, access, shown) : null;
  const scopeKey = scope ? JSON.stringify(scope) : '';
  const idx = useMemo(() => areaIndex(registry.areas), [registry.areas]);
  const remember = useMemo(() => rememberScope(), []);
  // the entities a module hidden here draws inside its own card: without the module they would come back as tiles of their own
  const drop = useMemo(() => { if (!scope) return new Set<string>(); const all = activeModules(registry, real), hidden = new Set(hiddenModules(scope, MODULES.map(m => m.id))); return new Set(all.filter(m => hidden.has(m.def.id)).flatMap(m => m.def.claims?.(m.entities) ?? [])); }, [scopeKey, registry.entities, real.modules]);
  const scoped = scope ? remember(registry, scope, real.devices, drop) : registry;
  const may = useMemo(() => scope ? controlPolicy(registry, scope, real.devices) : null, [scopeKey, registry.entities, registry.devices, registry.areas, real.devices]);
  // set during the draw, before any card asks (runtime/actions.ts actionsFor): one policy for the whole panel, as the house's zone is
  setControlPolicy(may);
  useEffect(() => () => setControlPolicy(null), []);
  const listed = useMemo(() => scope ? (a: Alarm) => !!a.room && roomRole(scope, idx, a.room) !== undefined : () => true, [scopeKey, idx]);
  const config = useMemo(() => scope && may ? { ...scopeConfig(real, scope, idx, MODULES.map(m => m.id), may), setupTabs: real.setupTabs } : real, [real, scopeKey, idx, may]);
  // the newest of what the house holds, for the alarms of the other buildings and for a settings change that comes back from the panel
  const house = useRef(real); house.current = real;
  const idxNow = useRef(idx); idxNow.current = idx;
  const mayNow = useRef(may), scopeNow = useRef(scope), viewNow = useRef(viewAs); mayNow.current = may; scopeNow.current = scope; viewNow.current = viewAs;
  const host = useMemo<Host>(() => new Proxy(bare, { get(target, prop) {
    const v = viewNow.current;
    if (prop === 'admin') return v ? v.admin : target.admin;
    if (prop === 'userId') return v ? v.id : target.userId;
    if (prop === 'call') return async (domain: string, service: string, data: Record<string, unknown>) => {
      const m = mayNow.current, sc = scopeNow.current; if (m && sc) { const ids = callTargets(data); if (ids.length ? ids.some(id => !m(id)) : !modeAllows(scopeMode(sc), null)) throw denied(); }
      return target.call(domain, service, data);
    };
    if ((prop === 'airStart' || prop === 'airStop') && target[prop]) return async (x: unknown) => { const sc = scopeNow.current; if (sc && !modeAllows(scopeMode(sc), null)) throw denied(); return (target[prop] as (a: unknown) => Promise<void>)(x); };
    return Reflect.get(target, prop, target);
  } }) as Host, [bare]);
  const narrowStore = useMemo<ConfigStore | undefined>(() => store && {
    label: store.label, photos: store.photos,
    async load() { const r = await store.load(); house.current = r.config; const sc = scopeNow.current, m = mayNow.current; return sc && m ? { ...r, config: { ...scopeConfig(r.config, sc, idxNow.current, MODULES.map(x => x.id), m), setupTabs: r.config.setupTabs } } : r; },
    // the narrowed settings are never written over the house's: on this screen only alarms are saved
    async save() { throw new SaveError('unauthorized'); },
    async saveAlarms(visible) {
      const all = mergeAlarms(house.current.alarms, visible, listedNow.current);
      const r = store.saveAlarms ? await store.saveAlarms(all) : { ...(await store.save({ ...house.current, alarms: all })), alarms: all };
      const held = r.alarms ?? all; house.current = { ...house.current, alarms: held };
      return { ...r, alarms: held.filter(listedNow.current) };
    },
  }, [store]);
  const listedNow = useRef(listed); listedNow.current = listed;
  const onNarrowChange = useMemo(() => (next: HouseConfig) => { const h = house.current; onConfigChange?.({ ...h, alarms: mergeAlarms(h.alarms, next.alarms, listedNow.current) }); }, [onConfigChange]);
  const deviceFilter = useMemo(() => scope ? (d: Pick<HomeDevice, 'key' | 'roomId' | 'kind' | 'haDeviceId'>) => deviceShown(d, scope, idx, real.devices) : undefined, [scopeKey, idx, real.devices]);
  const exitTo = useRef<string | null>(null);
  const startViewAs = (u: AccessUser) => { exitTo.current = location.hash || '#setup?filter=access'; setViewAs(u); };
  const stopViewAs = () => { setViewAs(null); const back = exitTo.current; exitTo.current = null; if (back) location.hash = back; };
  const pick = (b: string) => { setChosen(b); if (!viewAs) write(BUILDING_KEY, b); };
  const nameOf = (b: string) => b === ALL_BUILDINGS ? t('access.allBuildings' as Key) : b === NO_BUILDING ? t('access.noBuilding' as Key) : registry.floors?.find(f => f.floor_id === b)?.name ?? b;
  const strip = viewAs ? <div className="at-access-as" role="status"><Icon name="person" size={18} /><span>{t('access.viewingAs' as Key, { name: viewAs.name })}</span><button type="button" className="hm-pill" data-action="access-exit" onClick={stopViewAs}>{t('access.exit' as Key)}</button></div> : null;
  const switcher = choices.length > 1 ? <label className="at-access-switch"><span className="at-vh">{t('access.building' as Key)}</span><Icon name="home" size={18} /><select aria-label={t('access.building' as Key)} value={shown} onChange={e => pick((e.target as HTMLSelectElement).value)}>{choices.map(b => <option value={b}>{nameOf(b)}</option>)}</select></label> : null;
  const bar = strip || switcher ? <>{strip}{switcher}</> : undefined;

  if (access.kind === 'open' && !(configPending && !bare.admin && !viewAs && read(NARROWED_KEY))) return <Panel {...p} onViewAs={startViewAs} accessBar={bar} />;
  if (access.kind !== 'some') { const pending = access.kind === 'open'; return <Calm theme={real.home.theme} title={pending ? t('access.pending' as Key) : access.why === 'expired' ? t('access.expired.title' as Key) : t('access.none.title' as Key)} text={pending ? '' : t('access.none.text' as Key)} bar={strip} />; }
  return <Panel {...p} registry={scoped} config={config} host={host} store={narrowStore} onConfigChange={onNarrowChange} deviceFilter={deviceFilter} accessBar={bar} />;
}
/** «Доступ ещё не назначен — обратитесь к администратору»: no panel, no list of the house, nothing to press. */
function Calm({ theme, title, text, bar }: { theme: 'light' | 'dark'; title: string; text: string; bar: JSX.Element | null }) {
  return <div className="hm-shell daily-shell at-shell ah-shell at-access-calm" data-theme={theme}><div className="ah-wallpaper" aria-hidden="true" />{bar}<main className="at-access-calm-main"><div className="hm-card at-access-calm-card" role="status"><Icon name="lock" size={40} /><h1>{title}</h1>{text && <p className="hm-muted">{text}</p>}</div></main></div>;
}
