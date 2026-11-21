/* «＋ Добавить карточку» (book/06-dashboards/platform-2026/PROMPT-CARD-CATALOG.md): the installer finds a card by its name or by «category → make»,
 * picks the house's own device and the entities of the card's fields, sees the tile and the sheet on the house's data, names it, puts it in a room,
 * on Home or both, and adds it. Opening, the preview and saving send no command: the preview is drawn inert, on a host that refuses every call. */
import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import type { Room } from '../model/discover.ts';
import { NO_ROOM } from '../model/discover.ts';
import type { T, Key } from '../i18n/index.ts';
import type { Lang } from './format.ts';
import type { Host } from '../runtime/host.ts';
import { AccessoryTile, ThermostatTile, ClockTile as PlainClockTile } from './cards.tsx';
import { DeviceSheet, type Runner } from './sheet.tsx';
import { HeatingTile, HeatingPanel } from './heating.tsx';
import { Ask, type Question } from './setup.tsx';
import { readHeating } from '../model/heating.ts';
import { heatLayoutOf } from '../model/heating-layout.ts';
import { MODULES } from '../modules/index.ts';
import { readVacuum } from '../model/vacuum.ts';
import { VacuumTile } from './vacuum.tsx';
import { CameraTile } from './camera-tile.tsx';
import { familyOf } from '../appliances/profiles.ts';
import { applianceUi } from '../appliances/index.ts';
import {
  CATEGORIES, PROFILES, tellModule, untellModule, type ModuleUndo, brandsOf, candidates, candidateValue, defaultPlacement, devicesFor, foundHere, instanceView, moduleDevice, moduleMatch, newInstanceId, ofDevice, profileById, searchProfiles, selfDrawn, suggestBindings, suggestRoom,
  type Category, type Place, type Profile, type ProfileInstance, type RoleSpec, type InstanceRoom,
} from '../model/card-catalog.ts';

export interface CatalogProps { registry: Registry; config: HouseConfig; rooms: Room[]; t: T; lang: Lang; host: Host;
  /** opened from a room: its devices come first, the card goes to that room */ roomId?: string | null;
  /** an instance to edit (replace a binding, move, remove) */ editId?: string | null;
  /** saves the edit on the settings as they are at that moment; answers whether the house has it */ save: (fn: (c: HouseConfig) => void) => Promise<boolean>;
  onClose: () => void; profiles?: Profile[] }
type Tab = 'found' | 'all';
/** A host the preview draws on: it reads the house, and refuses every command (the form is never a remote control). */
const previewHostOf = (host: Host): Host => ({ ...host, call: () => Promise.reject(new Error('preview')), airStart: undefined, airStop: undefined, admin: false } as Host);
const noRunner: Runner = { run: async () => false, busy: new Set() };
const ck = (t: T, k: string, p?: Record<string, string | number>) => t(`cat.${k}` as Key, p);

export function CardCatalog(props: CatalogProps) {
  const { config, editId } = props, list = props.profiles ?? PROFILES;
  const editing = editId ? config.profileInstances?.[editId] : undefined;
  const [picked, setPicked] = useState<Profile | null>(() => editing ? profileById(editing.profileId, list) : null);
  if (picked) return <CardForm {...props} profile={picked} instanceId={editing ? editId! : null} onBack={editing ? props.onClose : () => setPicked(null)} />;
  return <CatalogList {...props} list={list} onPick={setPicked} />;
}
function CatalogList({ registry, rooms, t, roomId, onClose, list, onPick }: CatalogProps & { list: Profile[]; onPick: (p: Profile) => void }) {
  const [tab, setTab] = useState<Tab>('found'), [q, setQ] = useState(''), [cat, setCat] = useState<Category | null>(null), [brand, setBrand] = useState<string | null>(null);
  const title = (p: Profile) => t(p.titleKey as Key);
  const found = useMemo(() => new Map(list.map(p => [p.id, foundHere(registry, p)])), [registry, list]);
  const hits = searchProfiles(q, title, { category: cat, brand }, list).filter(p => tab === 'all' || q.trim() || found.get(p.id));
  // from a room: what stands in it first
  const inRoom = (p: Profile) => !!roomId && devicesFor(registry, p).some(d => d.areaId === roomId);
  const sorted = [...hits].sort((a, b) => Number(inRoom(b)) - Number(inRoom(a)) || Number(found.get(b.id)) - Number(found.get(a.id)));
  const roomName = roomId ? rooms.find(r => r.id === roomId)?.name : null;
  return <div className="hm-sheet-body at-cards" data-step="list">
    <div className="hm-sheet-head"><span className="hm-sheet-photo"><Icon name="more" size={26} /></span><div><small>{roomName ? ck(t, 'forRoom', { room: roomName }) : ck(t, 'forHome')}</small><h2>{ck(t, 'title')}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>
    <label className="at-search-wrap at-cards-search"><span className="at-vh">{ck(t, 'search')}</span><input type="search" className="at-search" aria-label={ck(t, 'search')} placeholder={ck(t, 'searchHint')} enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck={false} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /></label>
    <div className="hm-range-tabs at-cards-tabs" role="group" aria-label={ck(t, 'title')}>{(['found', 'all'] as Tab[]).map(id => <button type="button" aria-pressed={tab === id} className={tab === id ? 'is-active' : ''} data-tab={id} onClick={() => setTab(id)}>{ck(t, `tab.${id}`)}</button>)}</div>
    <div className="hm-chips at-cards-cats" role="group" aria-label={ck(t, 'category')}>{CATEGORIES.map(c => <button type="button" data-category={c} aria-pressed={cat === c} className={cat === c ? 'is-active' : ''} onClick={() => { setCat(cat === c ? null : c); setBrand(null); }}>{ck(t, `cat.${c}`)}</button>)}</div>
    {cat && brandsOf(cat, list).length > 0 && <div className="hm-chips at-cards-brands" role="group" aria-label={ck(t, 'brand')}><button type="button" aria-pressed={!brand} className={!brand ? 'is-active' : ''} onClick={() => setBrand(null)}>{ck(t, 'brand.all')}</button>{brandsOf(cat, list).map(b => <button type="button" data-brand={b} aria-pressed={brand === b} className={brand === b ? 'is-active' : ''} onClick={() => setBrand(b)}>{b}</button>)}</div>}
    <div className="hm-rows at-cards-list">{sorted.map(p => { const n = devicesFor(registry, p).length, here = found.get(p.id);
      return <button type="button" className="hm-row at-cards-item" data-profile={p.id} data-found={here ? 'yes' : 'no'} onClick={() => onPick(p)}>
        <span className="hm-thumb"><Icon name={p.icon ?? (p.category === 'heating' ? 'heating' : 'air')} size={22} /></span>
        <span className="hm-row-text"><strong>{title(p)}</strong><small>{[ck(t, `cat.${p.category}`), p.brand].filter(Boolean).join(' · ')}{p.models.length ? ` · ${p.models.join(', ')}` : ''}</small>
          <small className={here ? 'at-cards-ok' : 'at-cards-miss'}>{inRoom(p) ? ck(t, 'inThisRoom') : here ? (n ? ck(t, 'foundN', { n }) : ck(t, 'foundScheme')) : p.integration ? ck(t, 'needIntegration', { name: p.integration.name }) : ck(t, 'notFound')}</small></span>
        <Icon name="next" size={18} /></button>; })}
      {sorted.length === 0 && <p className="hm-muted at-cards-empty" role="status">{q.trim() ? ck(t, 'nothing', { q: q.trim() }) : ck(t, 'nothingHere')}</p>}</div>
  </div>;
}
// ---- the form of one card ----
function CardForm({ registry, config, rooms, t, lang, host, roomId, save, onClose, onBack, profile, instanceId, profiles }: CatalogProps & { profile: Profile; instanceId: string | null; onBack: () => void }) {
  const list = profiles ?? PROFILES, editing = instanceId ? config.profileInstances?.[instanceId] : undefined;
  const devices = useMemo(() => devicesFor(registry, profile), [registry, profile]);
  // a device that already has a card is not offered first: one appliance, one card
  const takenBy = (id: string) => Object.entries(config.profileInstances ?? {}).some(([k, i]) => k !== instanceId && i.deviceId === id);
  const free = devices.filter(d => !takenBy(d.id));
  const modDev = useMemo(() => moduleDevice(registry, profile), [registry, profile]);
  const firstDevice = editing?.deviceId ?? (modDev && !takenBy(modDev) ? modDev : undefined) ?? (free.length === 1 && devices.length === 1 ? free[0].id : free.find(d => roomId && d.areaId === roomId)?.id ?? (free.length === 1 ? free[0].id : undefined));
  const [deviceId, setDeviceId] = useState<string | undefined>(firstDevice);
  // what the house already told the module (its settings): the card starts from it, and an edit sees a change made there since (never undoes it)
  const told = (dev?: string): Record<string, string> => { const ents = profile.module ? config.modules[profile.module]?.entities ?? {} : {}; return Object.fromEntries(profile.roles.map(r => [r.id, ents[r.id]]).filter((x): x is [string, string] => !!x[1] && !!registry.states[x[1]] && ofDevice(registry, profile, x[1], dev))); };
  const [bindings, setBindings] = useState<Record<string, string>>(() => editing ? { ...editing.bindings, ...told(editing.deviceId) } : { ...suggestBindings(registry, profile, firstDevice), ...told(firstDevice) });
  const [roomsDraft, setRooms] = useState<InstanceRoom[]>(() => editing?.rooms ? editing.rooms.map(r => ({ ...r, bindings: { ...r.bindings } })) : []);
  const dev = deviceId ? registry.devices.find(d => d.id === deviceId) : undefined;
  const [name, setName] = useState(editing?.name ?? ''), [room, setRoom] = useState<string>(editing?.roomId ?? roomId ?? dev?.area_id ?? '');
  // where it goes follows the card's room — the chosen device's, the room page it was opened from — until the installer presses a place himself;
  // the room follows the chosen device until he picks one himself. An edit starts from what was saved
  const [placed, setPlaced] = useState<Place[] | null>(editing ? editing.placement : null), [roomTouched, setRoomTouched] = useState(false);
  const placement = placed ?? defaultPlacement(profile, room || dev?.area_id);
  const [busy, setBusy] = useState(false), [question, ask] = useState<Question | null>(null), [note, setNote] = useState('');
  const chooseDevice = (id: string) => { setDeviceId(id); setBindings({ ...suggestBindings(registry, profile, id), ...told(id) }); const d = registry.devices.find(x => x.id === id); if (!editing && !roomId && !roomTouched) setRoom(d?.area_id ?? ''); };
  const needDevice = profile.models.length > 0;
  const self = selfDrawn(profile);
  // a module draws one card per house: a second card of the same module would take the first one's place, so it is refused in words
  const sameModule = profile.module ? Object.entries(config.profileInstances ?? {}).find(([k, i]) => k !== instanceId && profileById(i.profileId, list)?.module === profile.module) : undefined;
  // a module's own settings (a camera's go2rtc add-on and streams, the feeder's grams per portion): asked here, kept in the module's settings
  const optionFields = profile.module ? MODULES.find(m => m.id === profile.module)?.options ?? [] : [];
  const found = useMemo(() => moduleMatch(registry, profile), [registry, profile]);
  const [opts, setOpts] = useState<Record<string, string>>(() => { const o: Record<string, unknown> = { ...(found?.options ?? {}), ...(profile.module ? config.modules[profile.module]?.options ?? {} : {}) }; return Object.fromEntries(Object.entries(o).filter((x): x is [string, string] => typeof x[1] === 'string' && !!x[1])); });
  const optsMissing = optionFields.filter(f => f.required && !opts[f.key]?.trim());
  // what the house's settings can keep (letters, digits, _ . -): anything else would vanish on saving
  const optOk = (v: string | undefined) => !v?.trim() || /^[\w.\-]{1,64}$/.test(v.trim()), optsBad = optionFields.filter(f => !optOk(opts[f.key]));
  // the module drives the appliance it found: a card for another one of the same model is refused in words
  const otherDevice = !!(modDev && deviceId && deviceId !== modDev);
  const areaName = (a: string) => rooms.find(r => r.id === a)?.name ?? null;
  const draft: ProfileInstance = { profileId: profile.id, profileVersion: profile.version, bindings, placement, ...(deviceId ? { deviceId } : {}), ...(name.trim() ? { name: name.trim() } : {}), ...(room ? { roomId: room } : {}), ...(profile.roomRoles ? { rooms: roomsDraft } : {}) };
  const view = (!needDevice || deviceId) ? instanceView(registry, instanceId ?? 'draft', draft, areaName, list, k => t(k as Key)) : null;
  const missing = view ? view.incomplete : profile.roles.filter(r => r.required).map(r => r.id);
  const ready = !sameModule && !otherDevice && optsMissing.length === 0 && optsBad.length === 0 && (!needDevice || (!!deviceId && !takenBy(deviceId))) && missing.length === 0 && (self || placement.length > 0) && (!profile.roomRoles || roomsDraft.length > 0);
  const add = async () => {
    if (!ready || busy) return; setBusy(true);
    const id = instanceId ?? newInstanceId(config.profileInstances ?? {});
    const legacy = profile.renderer === 'device' && bindings[profile.anchor ?? ''] ? `e:${bindings[profile.anchor!]}` : undefined;
    try {
      const ok = await save(c => {
        const all = { ...(c.profileInstances ?? {}) };
        // the auto-made card of the same appliance gives its name once (the installer's own name wins), so the house keeps calling it what it did
        const carried = legacy && !editing ? c.devices[legacy]?.name ?? (deviceId ? c.devices[`d:${deviceId}`]?.name : undefined) : undefined;
        const undo = profile.module ? tellModule(c, profile.module, profile.roles.map(r => r.id), bindings, optionFields.map(f => f.key), opts, found, (editing as { moduleUndo?: ModuleUndo } | undefined)?.moduleUndo) : undefined;
        all[id] = { ...draft, ...(legacy ? { legacyKey: legacy } : {}), ...(carried && !draft.name ? { name: carried } : {}), ...(undo ? { moduleUndo: undo } : {}) } as ProfileInstance;
        c.profileInstances = all;
      });
      if (ok) { setNote(ck(t, editing ? 'savedEdit' : 'saved')); onClose(); }
    } finally { setBusy(false); }
  };
  const remove = () => ask({ text: ck(t, 'removeAsk', { name: view?.device.name ?? t(profile.titleKey as Key) }), yes: ck(t, 'remove'), run: () => void save(c => { const all = { ...(c.profileInstances ?? {}) }; delete all[instanceId!]; c.profileInstances = all; if (!Object.keys(all).length) delete c.profileInstances; if (profile.module && editing) untellModule(c, profile.module, editing as ProfileInstance & { moduleUndo?: ModuleUndo }); }).then(ok => { if (ok) onClose(); }) });
  const setRole = (role: string, v: string) => setBindings(b => { const n = { ...b }; if (v) n[role] = v; else delete n[role]; return n; });
  const roomList = [...rooms.filter(r => r.id !== NO_ROOM)];
  return <div className="hm-sheet-body at-cards" data-step="form" data-profile={profile.id}>
    <div className="hm-sheet-head"><button type="button" className="hm-icon-btn at-cards-back" aria-label={ck(t, 'back')} onClick={onBack}><Icon name="back" size={20} /></button><div><small>{[ck(t, `cat.${profile.category}`), profile.brand].filter(Boolean).join(' · ')}</small><h2>{t(profile.titleKey as Key)}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>
    <p className="hm-muted at-cards-desc">{t(profile.descKey as Key)}</p>
    {needDevice && <section className="at-cards-sec" data-part="device"><h3>{ck(t, 'step.device')}</h3>
      {devices.length === 0 ? <p className="at-cards-miss" role="status">{profile.integration ? ck(t, 'needIntegration', { name: profile.integration.name }) : ck(t, 'notFound')}</p>
        : <div className="hm-rows" role="radiogroup" aria-label={ck(t, 'step.device')}>{devices.map(d => { const taken = Object.entries(config.profileInstances ?? {}).find(([k, i]) => k !== instanceId && i.deviceId === d.id);
          return <button type="button" role="radio" aria-checked={deviceId === d.id} className={`hm-row at-cards-device ${deviceId === d.id ? 'is-active' : ''}`} data-device={d.id} onClick={() => chooseDevice(d.id)}><span className="hm-row-text"><strong>{d.name}</strong><small>{[d.areaId ? areaName(d.areaId) : t('room.none'), d.model].filter(Boolean).join(' · ')}</small>{taken && <small className="at-cards-miss">{ck(t, 'deviceTaken')}</small>}</span><span className="at-cards-radio" aria-hidden="true" /></button>; })}</div>}
    </section>}
    {(!needDevice || deviceId) && <section className="at-cards-sec" data-part="fields"><h3>{ck(t, 'step.fields')}</h3>
      {profile.roles.map(r => <Field role={r} value={bindings[r.id] ?? ''} registry={registry} deviceId={deviceId} areaId={room || dev?.area_id || null} areaName={areaName} t={t} lost={view?.lost.includes(r.id) ?? false} onChange={v => setRole(r.id, v)} />)}
    </section>}
    {(!needDevice || deviceId) && optionFields.length > 0 && <section className="at-cards-sec" data-part="options"><h3>{ck(t, 'step.options')}</h3>
      {optionFields.map(f => <label className="at-field" data-option={f.key}><span>{t(f.labelKey as Key)}{f.required ? '' : ` · ${ck(t, 'optional')}`}</span><input type="text" autocomplete="off" spellcheck={false} required={f.required} aria-required={f.required || undefined} aria-invalid={!optOk(opts[f.key]) || undefined} value={opts[f.key] ?? ''} placeholder={f.placeholder ?? ''} onInput={e => { const v = (e.target as HTMLInputElement).value; setOpts(o => ({ ...o, [f.key]: v })); }} /></label>)}
    </section>}
    {profile.roomRoles && <section className="at-cards-sec" data-part="rooms"><h3>{ck(t, 'step.rooms')}</h3>
      {roomsDraft.map((rm, i) => <div className="hm-card at-cards-room" data-room-row={rm.id}>
        <label className="at-field"><span>{ck(t, 'room')}</span><select value={rm.areaId} onChange={e => { const a = (e.target as HTMLSelectElement).value; setRooms(l => l.map((x, k) => k === i ? { ...x, areaId: a, bindings: suggestRoom(registry, profile, a) } : x)); }}>{roomList.map(r => <option value={r.id}>{r.name}</option>)}</select></label>
        {profile.roomRoles!.map(r => <Field role={r} value={rm.bindings[r.id] ?? ''} registry={registry} areaId={rm.areaId} areaName={areaName} t={t} lost={view?.lost.includes(`${rm.id}.${r.id}`) ?? false} onChange={v => setRooms(l => l.map((x, k) => { if (k !== i) return x; const b = { ...x.bindings }; if (v) b[r.id] = v; else delete b[r.id]; return { ...x, bindings: b }; }))} />)}
        <button type="button" className="hm-pill" data-action="remove-room" onClick={() => setRooms(l => l.filter((_, k) => k !== i))}>{ck(t, 'removeRoom')}</button>
      </div>)}
      <button type="button" className="hm-pill" data-action="add-room" disabled={!roomList.length} onClick={() => { const used = new Set(roomsDraft.map(x => x.areaId)), next = roomList.find(r => !used.has(r.id)) ?? roomList[0]; setRooms(l => [...l, { id: `r${l.length + 1}${Date.now().toString(36).slice(-3)}`, areaId: next.id, bindings: suggestRoom(registry, profile, next.id) }]); }}>＋ {ck(t, 'addRoom')}</button>
    </section>}
    {view && missing.length === 0 && <section className="at-cards-sec" data-part="preview"><h3>{ck(t, 'step.preview')}</h3><p className="hm-muted">{ck(t, 'previewHint')}</p>
      <Preview view={view} registry={registry} host={host} t={t} lang={lang} roomName={room ? areaName(room) ?? undefined : undefined} /></section>}
    <section className="at-cards-sec" data-part="place"><h3>{ck(t, 'step.place')}</h3>
      {self && <p className="hm-muted at-cards-self">{ck(t, 'selfPlaced')}</p>}
      {!self && <label className="at-field"><span>{ck(t, 'name')}</span><input type="text" maxLength={80} autocomplete="off" value={name} placeholder={view?.device.name ?? ''} onInput={e => setName((e.target as HTMLInputElement).value)} /></label>}
      {profile.renderer !== 'heatingRooms' && !self && <label className="at-field"><span>{ck(t, 'room')}</span><select value={room} onChange={e => { setRoomTouched(true); setRoom((e.target as HTMLSelectElement).value); }}><option value="">{t('room.none')}</option>{roomList.map(r => <option value={r.id}>{r.name}</option>)}</select></label>}
      {profile.places.length > 0 && <div className="hm-chips at-cards-place" role="group" aria-label={ck(t, 'place')}>{profile.places.map(p => <button type="button" role="checkbox" aria-checked={placement.includes(p)} className={placement.includes(p) ? 'is-active' : ''} data-place={p} onClick={() => setPlaced(placement.includes(p) ? placement.filter(x => x !== p) : [...placement, p])}>{ck(t, `place.${p}`)}</button>)}</div>}
    </section>
    {!ready && <p className="hm-muted at-cards-need" role="status">{sameModule ? ck(t, 'moduleTaken') : otherDevice ? ck(t, 'moduleOtherDevice') : optsBad.length ? ck(t, 'optBad', { list: optsBad.map(f => t(f.labelKey as Key)).join(', ') }) : deviceId && needDevice && takenBy(deviceId) ? ck(t, 'deviceTaken') : !self && !placement.length ? ck(t, 'needPlace') : needDevice && !deviceId ? ck(t, 'needDevice') : optsMissing.length ? ck(t, 'needFields', { list: optsMissing.map(f => t(f.labelKey as Key)).join(', ') }) : profile.roomRoles && !roomsDraft.length ? ck(t, 'needRoom') : ck(t, 'needFields', { list: missing.map(m => { const [a, b] = m.includes('.') ? m.split('.') : [null, m]; const r = (a ? profile.roomRoles : profile.roles)?.find(x => x.id === b); return r ? t(r.labelKey as Key) : m; }).join(', ') })}</p>}
    <div className="at-cards-actions">{editing && <button type="button" className="hm-pill" data-action="remove-card" onClick={remove}>{ck(t, 'remove')}</button>}<button type="button" className="hm-pill is-primary" data-action="add-card" aria-disabled={!ready || busy || undefined} aria-busy={busy || undefined} onClick={() => void add()}>{editing ? ck(t, 'saveEdit') : ck(t, 'addToScreen')}</button></div>
    {note && <div className="hm-badge tone-calm at-note" role="status">{note}</div>}
    {question && <Ask q={question} t={t} onClose={() => ask(null)} />}
  </div>;
}
/** One field: what it is for, whether it is needed, the source found and its value now. The list is the field's candidates, its own device first;
 * another device's entity may be chosen on purpose (an external sensor) and says so. */
function Field({ role, value, registry, deviceId, areaId, areaName, t, lost, onChange }: { role: RoleSpec; value: string; registry: Registry; deviceId?: string; areaId: string | null; areaName: (a: string) => string | null; t: T; lost: boolean; onChange: (v: string) => void }) {
  const list = useMemo(() => candidates(registry, role, { deviceId, areaId }), [registry, role, deviceId, areaId]);
  const chosen = list.find(c => c.id === value), label = t(role.labelKey as Key);
  const opt = (c: typeof list[number]) => [c.name, c.areaId ? areaName(c.areaId) : null, candidateValue(c)].filter(Boolean).join(' · ');
  return <div className={`at-field at-cards-field ${lost ? 'is-lost' : ''}`} data-role={role.id} data-required={role.required || undefined}>
    <span>{label} {role.required ? <em className="at-cards-req">{ck(t, 'required')}</em> : <em className="at-cards-opt">{ck(t, 'optional')}</em>}</span>
    {role.hintKey && <small className="hm-muted">{t(role.hintKey as Key)}</small>}
    <select aria-label={label} value={value} onChange={e => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">{list.length ? (role.required ? ck(t, 'choose') : ck(t, 'none')) : ck(t, 'noCandidates')}</option>
      {lost && value && !chosen && <option value={value}>{ck(t, 'lostOption', { id: value })}</option>}
      {list.map(c => <option value={c.id}>{opt(c)}</option>)}
    </select>
    {lost ? <small className="at-field-err" role="alert">{ck(t, 'lost')}</small> : chosen ? <small className="at-cards-src">{chosen.own ? ck(t, 'srcOwn') : deviceId ? ck(t, 'srcExternal') : ck(t, 'srcFound')} · <code>{chosen.id}</code>{candidateValue(chosen) ? ` · ${candidateValue(chosen)}` : ''}</small> : null}
  </div>;
}
/** The tile and the sheet on the house's own data, inert: nothing in them can be pressed, and the host they are drawn on refuses every command. */
function Preview({ view, registry, host, t, lang, roomName }: { view: NonNullable<ReturnType<typeof instanceView>>; registry: Registry; host: Host; t: T; lang: Lang; roomName?: string }) {
  const h0 = previewHostOf(host), d = view.device, now = Date.now();
  let tile: ComponentChildren, sheet: ComponentChildren;
  if (view.profile.renderer === 'module') {
    const def = MODULES.find(m => m.id === view.profile.module), found = moduleMatch(registry, view.profile);
    const entities = { ...(found?.entities ?? {}), ...view.instance.bindings };
    // cameras and the doorbell play in the Cameras card, the clock is the shell's: their preview is the frame or the face they will show
    const own = def ? <def.Card registry={registry} entities={entities} options={found?.options ?? {}} host={h0} t={t} lang={lang} compact onOpen={() => undefined} /> : null;
    const framed = def && !def.sheetKey ? <div className="ah-tile ah-module"><div className="at-module-body">{own}</div></div> : own;
    tile = view.profile.kind === 'camera' ? <CameraTile device={view.device} player={null} state={null} onOpen={() => undefined} t={t} lang={lang} large /> : view.profile.module === 'clock' ? <PlainClockTile now={new Date()} lang={lang} /> : framed; sheet = null;
  }
  else if (view.profile.renderer === 'native' && view.profile.kind === 'vacuum') { const v = readVacuum(registry); tile = v ? <VacuumTile v={v} host={h0} t={t} lang={lang} onOpen={() => undefined} pics={{ robot: null, dock: null }} /> : null; sheet = null; }
  else if (view.profile.renderer === 'heatingRooms') { const h = readHeating(registry, now, heatLayoutOf(view.instance)); tile = h ? <HeatingTile h={h} host={h0} t={t} lang={lang} now={now} onOpen={() => undefined} /> : null; sheet = h ? <HeatingPanel h={h} host={h0} t={t} lang={lang} now={now} /> : null; }
  else if (view.profile.renderer === 'thermostat') { const air = d.metrics.find(m => m.deviceClass === 'temperature'), cur = air && Number.isFinite(Number(air.state)) ? Number(air.state) : typeof d.primary.attributes.current_temperature === 'number' ? d.primary.attributes.current_temperature : null; tile = <ThermostatTile device={d} name={d.name} sub={roomName} target={typeof d.primary.attributes.temperature === 'number' ? d.primary.attributes.temperature : null} current={cur} onOpen={() => undefined} t={t} lang={lang} />; sheet = <DeviceSheet device={d} runner={noRunner} onClose={() => undefined} t={t} lang={lang} host={h0} room={roomName} />; }
  else if (view.profile.renderer === 'appliance') { const ui = applianceUi(view.profile.card), line = familyOf(view.profile.card)?.tileLine?.(registry, view.instance, t, lang) ?? null; tile = <AccessoryTile device={{ ...d, tileLine: line }} name={d.name} room={roomName} pending={false} onToggle={() => undefined} onOpen={() => undefined} t={t} lang={lang} />; sheet = ui ? <ui.Sheet view={view} registry={registry} host={h0} t={t} lang={lang} runner={noRunner} onClose={() => undefined} room={roomName} wide={false} /> : null; }
  else { tile = <AccessoryTile device={d} name={d.name} room={roomName} pending={false} onToggle={() => undefined} onOpen={() => undefined} t={t} lang={lang} />; sheet = <DeviceSheet device={d} runner={noRunner} onClose={() => undefined} t={t} lang={lang} host={h0} room={roomName} kindLabel={view.profile.kindKey ? t(view.profile.kindKey as Key) : undefined} />; }
  return <div className="at-cards-preview" inert aria-hidden="true"><div className="ah-grid ah-face at-cards-preview-tile">{tile}</div>{sheet && <div className="at-cards-preview-sheet">{sheet}</div>}</div>;
}
/** The note a card shows its residents when a field it was set up with is gone: what is missing, and for the administrator the way to replace it. */
export function LostNote({ lost, profile, t, onFix }: { lost: string[]; profile: Profile; t: T; onFix?: () => void }) {
  if (!lost.length) return null;
  const names = lost.map(m => { const [a, b] = m.includes('.') ? m.split('.') : [null, m]; const r = (a ? profile.roomRoles : profile.roles)?.find(x => x.id === b); return r ? t(r.labelKey as Key) : m; });
  return <div className="hm-card at-cards-lostnote" role="status" data-lost={lost.join(' ')}><Icon name="warning" size={18} /><span>{ck(t, 'lostNote', { list: names.join(', ') })}</span>{onFix && <button type="button" className="hm-pill" data-action="fix-card" onClick={onFix}>{ck(t, 'fix')}</button>}</div>;
}
export function AddCardButton({ t, onClick }: { t: T; onClick: () => void }) {
  return <button type="button" className="hm-pill at-add-card" data-action="open-catalog" onClick={onClick}><span aria-hidden="true">＋</span>{ck(t, 'add')}</button>;
}
