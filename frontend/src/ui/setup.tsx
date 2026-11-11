import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact';
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import { discover, NO_ROOM, type Home, type HomeDevice } from '../model/discover.ts';
import { SECTIONS, type Kind } from '../model/kinds.ts';
import { dayKey, normaliseConfig, normaliseTariffs, offeredSections, tariffDayProblem, tariffDeleteEffect, tariffPrice, withNewTariff, type HouseConfig, type CustomButton, type Tariff } from '../model/config.ts';
import { languages, type T, type Key } from '../i18n/index.ts';
import { checkImport, configCounts, exportConfig, type PhotoStore } from '../runtime/store.ts';
import { MODULES, claimedEntities } from '../modules/index.ts';
import { stockRoomArt } from './art.ts';
import { artOf } from './cards.tsx';
import { ProductPhoto } from './photo.tsx';
import { photoKey, takesPhoto } from '../model/photos.ts';
import { DeviceArt, DEVICE_ART_TYPES } from './device-art.tsx';
import { errorText, iconOfKind, locales, numFixed, stateText, type Lang } from './format.ts';
import { ANRE_TARIFFS, channels } from '../model/energy-load.ts';
import { houseDate } from '../runtime/zone.ts';
import { customAction } from '../runtime/actions.ts';

const TABS = ['devices', 'rooms', 'energy', 'sections', 'buttons', 'modules', 'home'] as const;
type Tab = typeof TABS[number];
const KINDS: Kind[] = ['light', 'switch', 'socket', 'climate', 'fan', 'cover', 'lock', 'vacuum', 'media', 'camera', 'weather', 'environment', 'energy', 'leak', 'opening', 'motion', 'alarm', 'valve', 'alarm_panel', 'person', 'measurement'];
const ICONS = ['light', 'power', 'socket', 'heating', 'fan', 'blinds', 'lock', 'vacuum', 'media', 'camera', 'air', 'thermo', 'energy', 'water', 'door', 'motion', 'warning', 'shield', 'person', 'systems', 'home', 'rooms', 'flame', 'more'];
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
/** Fields that hold identifiers, not prose: no capital first letter, no autocorrect, no spellcheck, nothing remembered by the browser. */
// (`autocorrect` is a boolean property where the browser has it: the string 'off' would switch it ON)
const CODE = { autocomplete: 'off', autocapitalize: 'none', autocorrect: false as unknown as string, spellcheck: false } as const;
export interface SetupProps { registry: Registry; config: HouseConfig; onChange: (next: HouseConfig) => Promise<void> | void; admin: boolean; t: T; lang: Lang; storeLabel: string; warnings: string[]; photos?: PhotoStore; /** the open tab, kept in the address (`#setup?filter=energy`) so a reload and «Back» return to it */ tab?: string | null; onTab?: (tab: string | null) => void;
  /** the house's settings have not been read yet (the shell's `configPending`): nothing typed here could be saved, so nothing can be typed */ pending?: boolean;
  /** the price of a kWh in Home Assistant's own Energy settings, when the house has one there (`prefTariff`): what the panel counts by until the first own tariff */ haPrice?: number | null;
  /** the sections this house has (the shell's `present`); not given: every section is offered in «Разделы» */ sections?: readonly string[] }
/** A question before something is deleted or replaced: what exactly, a cancel, and the answer's own word on the button. */
type Question = { text: string; yes: string; run: () => void };
type AskFn = (q: Question) => void;
type Patch = (fn: (c: HouseConfig) => void) => void;
/** The same edit, answering whether the house has it (release classic, step 4 — studio ST-03, CODEX-004): a form that sent something keeps it
 * until then, and a photo's file is asked to go only after. */
type Save = (fn: (c: HouseConfig) => void) => Promise<boolean>;
/** The focused element as the panel sees it: inside Home Assistant the panel lives in a shadow root, where `document.activeElement` is the
 * host element and never a control of the panel (audit 2026-11-09, round 2). */
const activeIn = (node: Node | null | undefined): HTMLElement | null => ((node?.getRootNode() ?? document) as Document | ShadowRoot).activeElement as HTMLElement | null;
/** In-panel configurator: every control edits a copy of HouseConfig and hands it back; the caller saves and re-discovers. */
export function Setup({ registry, config, onChange, admin, t, lang, warnings, photos, tab: placed, onTab, pending, haPrice, sections }: SetupProps) {
  const [own, setOwn] = useState<Tab>('devices');
  const tab: Tab = onTab ? ((TABS as readonly string[]).includes(placed ?? '') ? placed as Tab : 'devices') : own;
  const setTab = (id: Tab) => { if (onTab) onTab(id === 'devices' ? null : id); else setOwn(id); };
  const [note, setNote] = useState(''), [question, ask] = useState<Question | null>(null);
  const home = useMemo(() => discover(registry, config, claimedEntities(registry, config)), [registry, config]);
  /** «Saved» appears only after the store confirms; a refused save is reported by the panel and clears the note. */
  // Every edit is made on the settings as they are NOW, not on the copy of the render that drew the control: a question may stay open for
  // minutes while another screen saves something, and «Удалить» then wrote that old copy over it. `given` is the last config the shell
  // handed in, `live` the same plus what has just been sent (two edits in one tick build on each other); a refused save returns to `given`.
  const given = useRef(config), live = useRef(config); if (given.current !== config) { given.current = config; live.current = config; }
  // A save answers whether the house has it (ST-03): «Добавить кнопку» and «Импорт» keep what they sent until then and after a refusal; a photo's
  // file is asked to go only after (CODEX-004). The shell has already said why a save was refused; nothing more here.
  const commit = async (next: HouseConfig, done: string): Promise<boolean> => { live.current = next; setNote(t('setup.saving')); try { await onChange(next); setNote(done); return true; } catch { live.current = given.current; setNote(''); return false; } };
  const save: Save = fn => { const next = structuredClone(live.current); fn(next); return commit(normaliseConfig(next).config, t('setup.saved')); };
  const patch: Patch = fn => { void save(fn); };
  // a question belongs to the tab it was asked on: «Назад» or a tap on another tab takes it away with the page under it
  useEffect(() => { ask(null); }, [tab]);
  const friendly = (id: string) => { const n = registry.states[id]?.attributes?.friendly_name; return typeof n === 'string' && n.trim() && !ENTITY_ID.test(n) ? n.trim() : undefined; };
  const lock = pending || undefined;
  if (!admin) return <div className="hm-card at-placeholder"><Icon name="lock" size={40} /><p className="hm-muted">{t('setup.adminOnly')}</p></div>;
  const tabs: Array<[Tab, Key]> = [['devices', 'setup.devices'], ['rooms', 'setup.rooms'], ['energy', 'setup.energy'], ['sections', 'setup.sections'], ['buttons', 'setup.buttons'], ['modules', 'setup.modules'], ['home', 'setup.home']];
  return <div className="at-setup" data-tab={tab} data-told={[pending !== undefined && 'pending', haPrice !== undefined && 'price', sections && 'sections'].filter(Boolean).join(' ') || undefined} onInput={() => { if (note) setNote(''); /* a stale «Сохранено» goes as soon as something new is typed; on the way UP, after the field has kept its text (in the capture phase this redraw reset the field and ate the first keystroke) */ }}>
    <div className="hm-range-tabs at-setup-tabs" role="group" aria-label={t('setup.title')}>{tabs.map(([id, key]) => <button type="button" key={id} aria-pressed={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{t(key)}</button>)}</div>
    {warnings.length > 0 && <details className="hm-fold"><summary><span>{t('setup.warnings')} ({warnings.length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{warnings.map(w => <p className="hm-muted">{w}</p>)}</div></details>}
    {tab === 'devices' && <DevicesTab home={home} config={config} patch={patch} save={save} ask={ask} t={t} lang={lang} photos={photos} friendly={friendly} lock={lock} />}
    {tab === 'rooms' && <RoomsTab home={home} config={config} patch={patch} save={save} ask={ask} t={t} photos={photos} lock={lock} />}
    {tab === 'energy' && <EnergyTab config={config} patch={patch} ask={ask} t={t} lang={lang} haPrice={haPrice} lock={lock} />}
    {tab === 'modules' && <ModulesTab registry={registry} config={config} patch={patch} save={save} ask={ask} photos={photos} t={t} lock={lock} />}
    {/* «Погода» is no page of the panel (its tile lives on the main screen), so it is not offered as a section; nor is a section this house
        has nothing for (no cameras, no alarm) — unless it is hidden now, when its switch is the way back */}
    {tab === 'sections' && <div className="hm-rows" inert={lock}>{offeredSections(SECTIONS.filter(s => s !== 'home' && s !== 'rooms' && s !== 'weather'), sections, config.sections).map(s => <div className="hm-setting at-setting-row" data-section={s} key={s}><span>{t(`section.${s}` as Key)}</span><Toggle on={!config.sections[s]?.hidden} label={`${t('setup.show')}: ${t(`section.${s}` as Key)}`} onToggle={() => patch(c => { c.sections[s] = { hidden: !c.sections[s]?.hidden }; })} /></div>)}</div>}
    {tab === 'buttons' && <ButtonsTab config={config} patch={patch} save={save} ask={ask} t={t} registry={registry} lock={lock} />}
    {tab === 'home' && <HomeTab config={config} fresh={() => live.current} patch={patch} ask={ask} onImport={cfg => commit(cfg, t('setup.imported'))} t={t} lock={lock} />}
    {note && <div className="hm-badge tone-calm at-note" role="status">{note}</div>}
    {question && <Ask q={question} t={t} onClose={() => ask(null)} />}
  </div>;
}
/** The question itself, in the panel's own confirmation window (the look of `.hm-confirm`): focus goes to «Отмена», Tab stays inside,
 * Escape and a tap outside cancel, and the focus returns to the control that asked. The focused element is read from the window's own root
 * (`activeIn`): in the house the panel is inside a shadow root, and by `document.activeElement` Tab never left «Отмена». */
function Ask({ q, t, onClose }: { q: Question; t: T; onClose: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null), box = useRef<HTMLDivElement>(null), [host, setHost] = useState<Element | null>(null);
  useEffect(() => { setHost(anchor.current?.closest('.hm-shell') ?? document.body); }, []);
  useEffect(() => { if (!host) return; const back = activeIn(anchor.current); box.current?.querySelector<HTMLElement>('button')?.focus(); return () => { if (back?.isConnected) back.focus({ preventScroll: true }); }; }, [host]);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return; const b = [...(box.current?.querySelectorAll<HTMLElement>('button') ?? [])], i = b.indexOf(activeIn(box.current) as HTMLElement);
    e.preventDefault(); b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length]?.focus();
  };
  const node = <div className="hm-scrim is-top at-setup-ask" onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={key}><div className="hm-confirm risk-custom" role="alertdialog" aria-modal="true" aria-labelledby="at-setup-ask-h" aria-describedby="at-setup-ask-p" ref={box}><h2 id="at-setup-ask-h">{t('confirm.title')}</h2><p id="at-setup-ask-p">{q.text}</p><div><button type="button" className="hm-pill" data-answer="no" onClick={onClose}>{t('confirm.no')}</button><button type="button" className="hm-pill is-primary risk-custom" data-answer="yes" onClick={() => { onClose(); q.run(); }}>{q.yes}</button></div></div></div>;
  return <><span ref={anchor} hidden />{host && createPortal(node, host)}</>;
}
type InputRest = { type: 'text' | 'number' | 'date' | 'url'; placeholder?: string; maxLength?: number; inputMode?: 'numeric' | 'decimal' | 'url'; step?: string; min?: string; max?: string; required?: boolean; autocomplete?: string; autocapitalize?: string; autocorrect?: string; spellcheck?: boolean };
/** A field that keeps what is being typed. The panel is redrawn on every state the house sends (many a minute on the live house), and a
 * field bound straight to the configuration was reset under the fingers: here the text is a local draft while the field has focus and
 * reaches the configuration on blur or Enter (Escape gives the stored value back). `onCommit` may answer with an error text: nothing is
 * saved then, the stored value returns and the text is shown under the field. */
function DraftInput({ value, onCommit, label, seen, ...rest }: { value: string; onCommit: (v: string) => string | void; /** the accessible name when the caption beside the field does not say whose it is («Название: Кухня») */ label?: string; /** what the error was said about (the row as stored): once that changes, the error is about the past and goes */ seen?: string } & InputRest) {
  const [draft, setDraft] = useState<string | null>(null), [err, setErr] = useState(''), errId = useId();
  const seenAt = useRef(seen); if (seenAt.current !== seen) { seenAt.current = seen; if (err) setErr(''); }
  const live = useRef<{ draft: string | null; value: string; onCommit: (v: string) => string | void }>({ draft, value, onCommit }); live.current = { draft, value, onCommit };
  const field = useRef<HTMLInputElement>(null);
  const commit = () => { const now = live.current; if (now.draft === null) return; live.current = { ...now, draft: null }; setDraft(null); const bad = now.draft !== now.value ? now.onCommit(now.draft) || '' : ''; setErr(bad); if (bad && field.current) field.current.value = now.value; /* a refused text never stays in the field as if it were stored */ };
  // a field taken off the screen with a draft in it (another tab, the row folded) is a field that was left: what was typed is not thrown away
  useEffect(() => () => { const now = live.current; if (now.draft !== null && now.draft !== now.value) now.onCommit(now.draft); }, []);
  return <><input ref={field} {...(rest as Record<string, unknown>)} value={draft ?? value} aria-label={label} aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined} onInput={e => { const v = (e.target as HTMLInputElement).value; live.current = { ...live.current, draft: v }; setDraft(v); if (err) setErr(''); }} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape' && draft !== null) { e.stopPropagation(); live.current = { ...live.current, draft: null }; setDraft(null); if (field.current) field.current.value = value; } }} />{err && <small className="at-field-err" role="alert" id={errId}>{err}</small>}</>;
}
/** `held`: the switch shows what the house does and cannot be changed here (CODEX-001) — `aria-disabled`, not `disabled`: it stays in the Tab order,
 * so the keyboard and a screen reader reach it and hear why (`describedBy`). */
function Toggle({ on, label, onToggle, held, describedBy }: { on: boolean; label: string; onToggle: () => void; held?: boolean; describedBy?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} aria-disabled={held || undefined} aria-describedby={describedBy} className={`hm-switch ${on ? 'is-on' : ''}`} onClick={() => { if (!held) onToggle(); }}><span className="hm-switch-knob" /></button>;
}
/** A device HA gave no name to is called by its kind here («Показание»), never by its entity id: the id is the second line, for the administrator. */
/** One photo slot per appliance (model/photos.ts): the HA device's own (`d:<id>`) — the one «Модули» and every card of the appliance read — else the card's key. */
const slotOf = (d: HomeDevice) => d.haDeviceId ? `d:${d.haDeviceId}` : d.key;
const shownName = (d: HomeDevice, t: T) => ENTITY_ID.test(d.name) ? t(`kind.${d.kind}` as Key) : d.name;
function DevicesTab({ home, config, patch, save, ask, t, lang, photos, friendly, lock }: { home: Home; config: HouseConfig; patch: Patch; save: Save; ask: AskFn; t: T; lang: Lang; photos?: PhotoStore; friendly: (id: string) => string | undefined; lock?: boolean }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState<string | null>(null);
  const roomName = (id: string) => home.rooms.find(r => r.id === id)?.name || t('room.none');
  const own = home.devices.filter(d => !config.devices[d.key]?.mergeInto), find = q.trim();
  const list = own.filter(d => !find || `${shownName(d, t)} ${d.primary.id} ${roomName(d.roomId)}`.toLowerCase().includes(find.toLowerCase()));
  const byRoom = new Map<string, HomeDevice[]>(); for (const d of list) (byRoom.get(d.roomId) ?? byRoom.set(d.roomId, []).get(d.roomId)!).push(d);
  const rooms = [...home.rooms.map(r => r.id), NO_ROOM].filter((id, i, a) => a.indexOf(id) === i && byRoom.has(id));
  const enabled = home.devices.filter(d => d.enabled).length;
  // a hidden entity is in no device any more: its human name is the one Home Assistant gives it, then the one typed here; the id only when there is neither
  const hiddenName = (id: string) => { const typed = config.entities[id]?.name; return friendly(id) ?? (typed && !ENTITY_ID.test(typed) ? typed : undefined); };
  return <div className="at-setup-devices" inert={lock}>
    {/* while something is searched the counter speaks about the search («найдено 3 из 71»), and a search that finds nothing says so */}
    <div className="hm-toolbar"><label className="at-search-wrap"><span className="at-vh">{t('setup.search.label')}</span><input type="search" className="at-search" aria-label={t('setup.search.label')} placeholder={t('setup.search')} enterkeyhint="search" {...CODE} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /></label><span role="status" data-count={find ? 'found' : 'shown'}>{find ? t('setup.foundCount', { n: list.length, total: own.length }) : t('setup.enabledCount', { n: enabled, total: home.devices.length })}</span></div>
    {find && list.length === 0 && <div className="hm-card at-placeholder" data-empty="search"><Icon name="search" size={40} /><p className="hm-muted">{t('setup.notFound', { q: find })}</p></div>}
    {rooms.map(rid => <section className="hm-section" key={rid}><div className="hm-section-head"><h2>{roomName(rid)}</h2></div><div className="hm-rows">
      {byRoom.get(rid)!.map(d => { const o = config.devices[d.key] ?? {}; const isOpen = open === d.key; const name = shownName(d, t); return <div className={`hm-row at-setup-row ${d.enabled ? '' : 'is-off'}`} data-device-key={d.key} key={d.key}>
        <div className="at-setup-main">
          <Toggle on={d.enabled} label={`${t('setup.show')}: ${name}`} onToggle={() => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), enabled: !d.enabled }; })} />
          <button type="button" className="hm-row-open" onClick={() => setOpen(isOpen ? null : d.key)} aria-expanded={isOpen}><span className="hm-thumb"><ProductPhoto src={takesPhoto(d) ? d.photo ?? config.devices[slotOf(d)]?.photo ?? null : null}>{artOf(d) ? <DeviceArt type={artOf(d)!} fill /> : <Icon name={d.icon ?? iconOfKind[d.kind] ?? 'generic'} size={22} />}</ProductPhoto></span><span className="hm-row-text"><strong>{name}</strong><small>{t(`kind.${d.kind}` as Key)} · {stateText(d.primary, t, lang)}</small><small className="at-setup-id">{d.primary.id}</small></span><Icon name={isOpen ? 'back' : 'next'} size={18} /></button>
        </div>
        {isOpen && <div className="at-setup-form">
          <label className="at-field"><span>{t('setup.name')}</span><DraftInput type="text" value={o.name ?? ''} placeholder={name} maxLength={80} autocomplete="off" onCommit={v => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), name: v.trim() || undefined }; })} /></label>
          <label className="at-field"><span>{t('setup.room')}</span><select value={o.roomId ?? d.roomId} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), roomId: (e.target as HTMLSelectElement).value }; })}>{[...home.rooms, ...(home.rooms.some(r => r.id === NO_ROOM) ? [] : [{ id: NO_ROOM, name: t('room.none') }])].map(r => <option value={r.id}>{r.name || t('room.none')}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.kind')}</span><select value={o.kind ?? d.kind} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), kind: (e.target as HTMLSelectElement).value as Kind }; })}>{KINDS.map(k => <option value={k}>{t(`kind.${k}` as Key)}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.icon')}</span><select value={o.icon ?? ''} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), icon: (e.target as HTMLSelectElement).value || undefined }; })}><option value="">—</option>{ICONS.map(i => <option value={i}>{t(`setup.icon.${i}` as Key)}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.favorite')}</span><Toggle on={!!o.favorite} label={t('setup.favorite')} onToggle={() => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), favorite: !o.favorite || undefined }; })} /></label>
          <label className="at-field at-art-field"><span>{t('setup.art')}</span><select value={o.art ?? ''} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), art: (e.target as HTMLSelectElement).value || undefined }; })}><option value="">{t('setup.art.auto')}</option><option value="none">{t('setup.art.none')}</option>{DEVICE_ART_TYPES.map(a => <option value={a}>{t(`art.${a}` as Key)}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.mergeInto')}</span><select value={o.mergeInto ?? ''} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), mergeInto: (e.target as HTMLSelectElement).value || undefined }; })}><option value="">{t('setup.noMerge')}</option>{home.devices.filter(x => x.key !== d.key && x.roomId === d.roomId && !config.devices[x.key]?.mergeInto).map(x => <option value={x.key}>{shownName(x, t)} · {t(`kind.${x.kind}` as Key)}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.order')}</span><DraftInput type="number" inputMode="numeric" step="1" autocomplete="off" value={String(o.order ?? 0)} onCommit={v => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), order: Math.round(Number(v)) || 0 }; })} /></label>
          {/* an appliance's photo; a sensor, a relay, a plug keeps its pictogram (owner, 11.11.2026) — a photo set on one before can still be removed */}{(takesPhoto(d) || !!o.photo || !!config.devices[slotOf(d)]?.photo) && <PhotoField label={t('setup.photo')} subject={name} value={o.photo ?? config.devices[slotOf(d)]?.photo ?? null} photos={photos} t={t} ask={ask} cutout onChange={url => save(c => { const slot = slotOf(d); if (slot !== d.key && c.devices[d.key]?.photo) c.devices[d.key] = { ...c.devices[d.key], photo: null }; c.devices[slot] = { ...(c.devices[slot] ?? {}), photo: url }; })} />}
          {(d.metrics.length + d.controls.length) > 1 && <details className="hm-fold"><summary><span>{t('setup.entities')} ({d.controls.length + d.metrics.length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{[...d.controls, ...d.metrics].map(e => { const shown = ENTITY_ID.test(e.name) ? t(`kind.${e.kind ?? d.kind}` as Key) : e.name; return <div className="hm-setting" key={e.id}><span>{shown}<small className="at-setup-id">{e.id}</small></span><button type="button" className="hm-pill" aria-label={`${t('setup.hideEntity')}: ${shown}`} onClick={() => patch(c => { c.entities[e.id] = { ...(c.entities[e.id] ?? {}), hidden: true }; })}>{t('setup.hideEntity')}</button></div>; })}</div></details>}
        </div>}
      </div>; })}
    </div></section>)}
    {Object.keys(config.entities).filter(id => config.entities[id].hidden).length > 0 && <details className="hm-fold"><summary><span>{t('setup.hidden')}: {t('setup.entities')} ({Object.keys(config.entities).filter(id => config.entities[id].hidden).length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{Object.keys(config.entities).filter(id => config.entities[id].hidden).map(id => { const name = hiddenName(id); return <div className="hm-setting" data-hidden-entity={id} key={id}><span>{name ?? t('setup.entity')}<small className="at-setup-id">{id}</small></span><button type="button" className="hm-pill" aria-label={`${t('setup.show')}: ${name ?? id}`} onClick={() => patch(c => { delete c.entities[id]; })}>{t('setup.show')}</button></div>; })}</div></details>}
  </div>;
}
function RoomsTab({ home, config, patch, save, ask, t, photos, lock }: { home: Home; config: HouseConfig; patch: Patch; save: Save; ask: AskFn; t: T; photos?: PhotoStore; lock?: boolean }) {
  const rooms = [...home.rooms, ...(home.rooms.some(r => r.id === NO_ROOM) ? [] : [{ id: NO_ROOM, name: '', hidden: false, photo: null, order: 999, areaTemperature: null, areaHumidity: null }])];
  // the house feed each room hangs on (an SPM channel, the charger aside): the Energy panel splits the rooms by apartment with it
  const all = useMemo(() => channels(home.devices, new Set()), [home.devices]), feeds = all.filter(c => !c.charger), charger = all.find(c => c.charger), chargerOf = config.modules.energy?.options?.chargerOf ?? '';
  // owner, 09.11.2026: the car charges from apartment 8's input and Premier Energy bills them together; the wiring is nowhere in HA, so it is said here
  const chargerRow = charger && feeds.length > 0 && <div className="hm-row at-setup-row" data-setting="charger-of"><div className="at-setup-form"><label className="at-field"><span>{t('setup.chargerOf', { name: charger.name })}</span><select value={chargerOf} onChange={e => patch(c => { const v = (e.target as HTMLSelectElement).value, m = c.modules.energy ?? {}; const options = { ...(m.options ?? {}) }; if (v) options.chargerOf = v; else delete options.chargerOf; c.modules.energy = { ...m, options }; })}><option value="">{t('setup.chargerOf.none')}</option>{feeds.map(f => <option value={f.key}>{f.name}</option>)}</select></label></div></div>;
  // eight rows of the same four fields: each field is named with its room («Название: Кухня»), or a screen reader hears «Название» eight times
  return <div className="hm-rows" inert={lock}>{chargerRow}{rooms.map(r => { const o = config.rooms[r.id] ?? {}, rn = r.name || t('room.none'); const count = home.devices.filter(d => d.enabled && d.roomId === r.id).length; return <div className="hm-row at-setup-row" data-room-id={r.id} key={r.id}>
    <div className="at-setup-main"><Toggle on={!r.hidden} label={`${t('setup.show')}: ${r.name || t('room.none')}`} onToggle={() => patch(c => { c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), hidden: !r.hidden }; })} /><span className="hm-row-text"><strong>{r.name || t('room.none')}</strong><small>{t('setup.roomDevices', { n: count })}</small>{r.id !== NO_ROOM && <small className="at-setup-id">{r.id}</small>}</span></div>
    <div className="at-setup-form"><label className="at-field"><span>{t('setup.name')}</span><DraftInput type="text" label={`${t('setup.name')}: ${rn}`} value={o.name ?? ''} placeholder={r.name || t('room.none')} maxLength={80} autocomplete="off" onCommit={v => patch(c => { c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), name: v.trim() || undefined }; })} /></label>
      <label className="at-field"><span>{t('setup.order')}</span><DraftInput type="number" label={`${t('setup.order')}: ${rn}`} inputMode="numeric" step="1" autocomplete="off" value={String(o.order ?? r.order)} onCommit={v => patch(c => { c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), order: Math.round(Number(v)) || 0 }; })} /></label>
      {(feeds.length > 0 || o.feed) && <label className="at-field"><span>{t('setup.feed')}</span><select aria-label={`${t('setup.feed')}: ${rn}`} value={o.feed ?? ''} onChange={e => patch(c => { const v = (e.target as HTMLSelectElement).value; c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), feed: v || undefined }; })}><option value="">{t('setup.feed.none')}</option>{feeds.map(f => <option value={f.key}>{f.name}</option>)}{o.feed && !feeds.some(f => f.key === o.feed) && <option value={o.feed}>{o.feed}</option>}</select></label>}
      <PhotoField label={t('setup.photo')} subject={rn} value={o.photo ?? null} fallback={stockRoomArt(r.name)} photos={photos} t={t} ask={ask} onChange={url => save(c => { c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), photo: url }; })} /></div>
  </div>; })}</div>;
}
/** The electricity tariff (owner, 09.11.2026): a price per kWh from a day on, kept as a history, so a past period is billed at the price of its
 * own time. Until the owner writes one, the Energy panel counts by ANRE's figures for Premier Energy, and this page says so and offers them. */
function EnergyTab({ config, patch, ask, t, lang, haPrice, lock }: { config: HouseConfig; patch: Patch; ask: AskFn; t: T; lang: Lang; haPrice?: number | null; lock?: boolean }) {
  const list = config.energy?.tariffs ?? [], loc = locales[lang], price = (v: number) => numFixed(v, lang, 2);
  // a tariff day is a calendar day, not a moment: it is printed as written (no zone can move it), and «today» is the HOUSE's day — a browser
  // in another zone used to allow tomorrow's date, or refuse today's, for some hours around midnight
  const day = (from: string) => { const [y, m, d] = from.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, ''); };
  const todayKey = dayKey(houseDate());
  const current = list.filter(x => x.from <= todayKey).at(-1) ?? list[0];
  // what the panel counts by while there is no own record: Home Assistant's own energy price when the house has one there, else ANRE's figures
  const ha = typeof haPrice === 'number' && Number.isFinite(haPrice) && haPrice > 0 ? haPrice : null;
  const set = (fn: (tariffs: Tariff[]) => Tariff[]) => patch(c => { c.energy = { tariffs: fn([...(c.energy?.tariffs ?? [])]) }; });
  const item = (x: Tariff) => t('setup.tariff.item', { v: price(x.lei), d: day(x.from) });
  // A row is known by a name of its own, not by its date: a typed date re-sorts the list, and a row keyed by the date was thrown away and
  // built anew under the cursor (the focus fell to the page, the keyboard user started from the top).
  const root = useRef<HTMLDivElement>(null), ids = useRef(new Map<string, string>()), seq = useRef(0);
  for (const k of [...ids.current.keys()]) if (!list.some(x => x.from === k)) ids.current.delete(k);
  const idOf = (from: string) => ids.current.get(from) ?? (ids.current.set(from, `r${++seq.current}`), ids.current.get(from)!);
  // Where the keyboard stands after the list has changed: the field it was in (a moved row loses the focus in the browser), the new row's
  // price after «Добавить» and «Взять данные ANRE» (their button goes away or is switched off), the neighbour's «Удалить» after a deletion.
  const sig = list.map(x => `${x.from}:${x.lei}`).join(' '), want = useRef<{ sel: string; sig: string; at: number } | null>(null);
  const focusAfter = (sel: string) => { want.current = { sel, sig, at: Date.now() }; };
  useEffect(() => { const w = want.current; if (!w || w.sig === sig) return; want.current = null; if (Date.now() - w.at > 5000) return; const el = root.current?.querySelector<HTMLElement>(w.sel); if (el && activeIn(root.current) !== el) el.focus(); }, [sig]);
  const rowSel = (id: string, part: 'from' | 'price' | 'delete') => part === 'delete' ? `[data-tariff-row="${id}"] [data-action="delete-tariff"]` : `[data-tariff-row="${id}"] [data-field="${part}"] input`;
  const keepFocus = () => { const a = activeIn(root.current), row = a?.closest<HTMLElement>('[data-tariff-row]'), id = row?.dataset.tariffRow; if (!a || !id || !root.current?.contains(a)) return; const field = a.closest<HTMLElement>('[data-field]')?.dataset.field; focusAfter(a.matches('[data-action="delete-tariff"]') ? rowSel(id, 'delete') : rowSel(id, field === 'price' ? 'price' : 'from')); };
  // A date or a price that cannot be stored is not stored at all: the row keeps its value and says why. (It used to go to the config on
  // every keystroke: «0002-11-09» on the way to 2026, or 1001 lei, failed the store's check and the whole row disappeared as «Saved».)
  const setDay = (i: number, v: string) => {
    const was = list[i]?.from; if (was === undefined) return;
    const bad = tariffDayProblem(v, todayKey, list.filter((_, k) => k !== i).map(y => y.from)); if (bad) return t(`setup.tariff.err.${bad}` as Key);
    const id = idOf(was); ids.current.delete(was); ids.current.set(v, id); keepFocus();
    set(l => l.map(y => y.from === was ? { ...y, from: v } : y));
  };
  const setPrice = (i: number, v: string) => { const was = list[i]?.from, lei = tariffPrice(v); if (lei === null) return t('setup.tariff.err.price'); set(l => l.map(y => y.from === was ? { ...y, lei } : y)); };
  // the first own record must not re-price the past: the history starts from what the panel was counting by (withNewTariff), then today's change
  const add = () => { focusAfter(rowSel(idOf(todayKey), 'price')); set(l => withNewTariff(l, todayKey, ANRE_TARIFFS, ha)); };
  const useAnre = () => { focusAfter(rowSel(idOf(ANRE_TARIFFS.at(-1)!.from), 'price')); set(() => ANRE_TARIFFS.map(x => ({ ...x }))); };
  // The question says what the deletion really does to the money already counted (tariffDeleteEffect): the earliest row has no «previous
  // price» — its time goes to the NEXT one; the only row — the panel returns to what it counted by before
  const remove = (x: Tariff) => {
    const e = tariffDeleteEffect(list, x.from), v = price(x.lei), d = day(x.from);
    const text = e?.kind === 'only' ? (ha !== null ? t('setup.tariff.deleteAsk.onlyHa', { v, d, p: price(ha) }) : t('setup.tariff.deleteAsk.only', { v, d }))
      : e?.kind === 'first' ? t('setup.tariff.deleteAsk.first', { v, d, nv: price(e.next.lei), nd: day(e.next.from) }) : t('setup.tariff.deleteAsk', { v, d });
    // the row is taken out of the list as it is at the moment of the answer, and the focus goes to the row that takes its place
    ask({ text, yes: t('setup.delete'), run: () => set(l => { const k = l.findIndex(y => y.from === x.from), n = k < 0 ? undefined : l[k + 1] ?? l[k - 1]; focusAfter(n ? rowSel(idOf(n.from), 'delete') : '[data-action="add-tariff"]'); return l.filter(y => y.from !== x.from); }) });
  };
  return <div className="at-setup-energy" data-setting="tariff" ref={root} inert={lock}>
    <section className="hm-card at-setup-new at-setup-tariff"><h2>{t('setup.tariff')}</h2>
      <p className="hm-muted">{t('setup.tariff.hint')}</p>
      {current ? <p className="at-tariff-now" role="status">{t('setup.tariff.now', { v: price(current.lei), d: day(current.from) })}</p>
        : <><p className="at-tariff-now" role="status" data-source={ha !== null ? 'ha' : 'anre'}>{ha !== null ? t('setup.tariff.ha', { v: price(ha) }) : t('setup.tariff.none', { list: ANRE_TARIFFS.map(item).join(', ') })}</p><button type="button" className="hm-pill" data-action="use-anre" onClick={useAnre}>{t('setup.tariff.useAnre')}</button></>}
      <div className="hm-rows">{list.map((x, i) => { const id = idOf(x.from); return <div className="hm-row at-setup-row" data-tariff-from={x.from} data-tariff-row={id} key={id}><div className="at-setup-form">
        <label className="at-field" data-field="from"><span>{t('setup.tariff.from')}</span><DraftInput type="date" value={x.from} seen={sig} min="2000-01-01" max={todayKey} required autocomplete="off" onCommit={v => setDay(i, v)} /></label>
        <label className="at-field" data-field="price"><span>{t('setup.tariff.price')}</span><DraftInput type="text" inputMode="decimal" autocomplete="off" seen={sig} value={String(x.lei).replace('.', lang === 'en' ? '.' : ',')} onCommit={v => setPrice(i, v)} /></label>
        <div className="at-field"><span>&nbsp;</span><button type="button" className="hm-pill" data-action="delete-tariff" aria-label={`${t('setup.delete')}: ${item(x)}`} onClick={() => remove(x)}>{t('setup.delete')}</button></div>
      </div></div>; })}</div>
      <button type="button" className="hm-pill is-primary" data-action="add-tariff" disabled={list.some(x => x.from === todayKey)} onClick={add}>{t('setup.tariff.add')}</button>
    </section>
  </div>;
}
// ---- plain logic of «Кнопки → Добавить кнопку» and of a photo taken away (release classic, step 4: studio ST-03, ST-04; CODEX-001, CODEX-004) ----
// No JSX from here to the «end» line: tests/classic-setup.test.ts runs this part under Node, as it is written here.
/** The form as it is typed: six parts, all kept until the house has the button (a refused save gives nothing back to type again, ST-03). */
export interface ButtonDraft { label: string; service: string; entity: string; data: string; confirm: boolean; icon: string }
export const EMPTY_BUTTON: Readonly<ButtonDraft> = Object.freeze({ label: '', service: '', entity: '', data: '', confirm: true, icon: 'more' });
/** The four typed fields, in the order they stand in the form (the order the mistakes are looked for in). */
export const BUTTON_FIELDS = ['label', 'service', 'entity', 'data'] as const;
export type ButtonField = typeof BUTTON_FIELDS[number];
/** The form's checks, field by field in the form's order: the first field that is wrong and the words for it (ST-04 takes the focus there), or
 * the button the form makes, without its id. The rules are the ones the form always had: a label; `domain.action`; entity ids (or `all`); data
 * that is a JSON object. The service and the ids are written in lower case, the label kept to 60 characters. */
export function checkButtonDraft(d: ButtonDraft): { ok: false; field: ButtonField; key: `setup.err.${ButtonField}` } | { ok: true; button: Omit<CustomButton, 'id'> } {
  const service = d.service.trim().toLowerCase(), entity = d.entity.trim().toLowerCase();
  if (!d.label.trim()) return { ok: false, field: 'label', key: 'setup.err.label' };
  if (!/^[a-z_]+\.[a-z_]+$/.test(service)) return { ok: false, field: 'service', key: 'setup.err.service' };
  if (entity && entity !== 'all' && !entity.split(/\s*,\s*/).every(id => ENTITY_ID.test(id))) return { ok: false, field: 'entity', key: 'setup.err.entity' };
  let data: Record<string, unknown> | undefined;
  if (d.data.trim()) { try { const v = JSON.parse(d.data); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('object'); data = v; } catch { return { ok: false, field: 'data', key: 'setup.err.data' }; } }
  const ids = entity.split(/\s*,\s*/).filter(Boolean);
  return { ok: true, button: { label: d.label.trim().slice(0, 60), icon: d.icon || undefined, service, target: ids.length ? { entity_id: ids.length === 1 ? ids[0] : ids } : undefined, data, confirm: d.confirm } };
}
/** Whether the house asks before this button's action whatever its «Спрашивать подтверждение» says — exactly what the button will do on «Дом»
 * (`customAction`, CODEX-001): water that would start to flow, a lock, the alarm system, «switch everything off». The form shows its switch on
 * and held, with why; what is stored is still the owner's own flag. */
export const alwaysAsks = (b: Pick<CustomButton, 'service' | 'target' | 'data'>): boolean => customAction({ id: '', label: '', service: b.service, target: b.target, data: b.data, confirm: false }).confirm;
/** The same for the form while it is typed: what the button would be so far (data that is not JSON yet does not count). */
export function draftAlwaysAsks(d: ButtonDraft): boolean {
  const service = d.service.trim().toLowerCase(); if (!/^[a-z_]+\.[a-z_]+$/.test(service)) return false;
  const ids = d.entity.trim().toLowerCase().split(/\s*,\s*/).filter(Boolean);
  let data: Record<string, unknown> | undefined;
  try { const v: unknown = d.data.trim() ? JSON.parse(d.data) : undefined; if (v && typeof v === 'object' && !Array.isArray(v)) data = v as Record<string, unknown>; } catch { /* not JSON yet */ }
  return alwaysAsks({ service, target: ids.length ? { entity_id: ids.length === 1 ? ids[0] : ids } : undefined, data });
}
/** A room's, a device's or a module's photo is taken away in this order: first the settings are saved without it (with the store's revision
 * check), and only once the house has them is its file asked to go. A refused or conflicting save leaves the photo in the settings and its
 * file on the disk (it used to delete the file first: a refused save then pointed at a file that was gone). The house keeps a file another
 * room still shows (it answers `removed: false`) — not a mistake for the person, so nothing is said. Answers whether the settings were saved. */
export async function removePhoto(url: string | null, save: () => Promise<boolean>, photos?: { remove(url: string): Promise<void> }): Promise<boolean> {
  const saved = await save();
  if (saved && url && photos) await photos.remove(url).catch(() => undefined);
  return saved;
}
// ---- end of the plain logic ----

function ButtonsTab({ config, patch, save, ask, t, registry, lock }: { config: HouseConfig; patch: Patch; save: Save; ask: AskFn; t: T; registry: Registry; lock?: boolean }) {
  // ST-03: the six parts of the draft stay until the house has the button — a refused save leaves all of them to send again. `version` counts
  // every edit, so a success clears only the draft that was sent, never what was typed while it was on its way.
  const [draft, setDraft] = useState<ButtonDraft>(EMPTY_BUTTON), version = useRef(0);
  const edit = (part: Partial<ButtonDraft>) => { version.current++; setDraft(d => ({ ...d, ...part })); };
  // one button per «Добавить кнопку», however fast it is pressed twice; while it is on its way the button waits (aria-disabled + aria-busy, never
  // `disabled`: the focus stays on it), and the note at the foot says «Сохранение…» as for every save here
  const [sending, setSending] = useState(false), busy = useRef(false);
  // the mistake is said under its own field and tied to it (aria-invalid + aria-describedby); ST-04: the focus goes into that field at every try
  // (`at` counts the tries: the same mistake twice moves it again), and the field comes into sight with what is said under it
  const [bad, setBad] = useState<{ field: ButtonField; text: string; at: number } | null>(null), tries = useRef(0), errId = useId(), hintId = useId();
  const fields: Record<ButtonField, { current: HTMLInputElement | null }> = { label: useRef<HTMLInputElement>(null), service: useRef<HTMLInputElement>(null), entity: useRef<HTMLInputElement>(null), data: useRef<HTMLInputElement>(null) };
  const wrong = (field: ButtonField) => bad?.field === field ? { 'aria-invalid': true, 'aria-describedby': errId } : {};
  const said = (field: ButtonField) => bad?.field === field ? <small className="at-field-err" role="alert" id={errId}>{bad.text}</small> : null;
  useLayoutEffect(() => {
    const el = bad ? fields[bad.field].current : null; if (!el) return;
    el.focus({ preventScroll: true });
    // inside the panel's page, the least scroll that shows the caption, the field and its words; again while the field keeps the focus and the
    // window shrinks (a keyboard coming up, a phone turned) — never on a keystroke, and nothing is watched once the focus leaves
    const box = el.closest<HTMLElement>('.at-field') ?? el, main = el.closest('.hm-main'), view = el.ownerDocument.defaultView?.visualViewport;
    let frame = 0;
    const show = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (activeIn(el) !== el) return; box.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); /* a field taller than what is left of the window: the input itself first */ }); };
    const watch = main && typeof ResizeObserver === 'function' ? new ResizeObserver(show) : null;
    const stop = () => { cancelAnimationFrame(frame); watch?.disconnect(); view?.removeEventListener('resize', show); el.removeEventListener('blur', stop); };
    show(); if (main) watch?.observe(main); view?.addEventListener('resize', show); el.addEventListener('blur', stop);
    return stop;
  }, [bad?.at]);
  const services = Object.entries(registry.services ?? {}).flatMap(([d, list]) => list.map(s => `${d}.${s}`)).sort();
  // CODEX-001: an action the house always asks about (water, a lock, the alarm system, «switch everything off») — the switch says so and holds;
  // the owner's own flag is what is stored
  const always = draftAlwaysAsks(draft);
  const add = async () => {
    if (busy.current) return;
    // each mistake is named (it used to be the field's own caption, «Действие (домен.действие)», for every one of them)
    const r = checkButtonDraft(draft);
    if (!r.ok) { setBad({ field: r.field, text: t(r.key), at: ++tries.current }); return; }
    setBad(null);
    const sent = version.current; busy.current = true; setSending(true);
    try { if (await save(c => { c.buttons.push({ id: `b${Date.now().toString(36)}`, ...r.button }); }) && version.current === sent) setDraft(EMPTY_BUTTON); }
    finally { busy.current = false; setSending(false); }
  };
  return <div className="at-setup-buttons" inert={lock}>
    <div className="hm-rows">{config.buttons.map(b => <div className="hm-row at-setup-row" data-button-id={b.id} key={b.id}><div className="at-setup-main"><span className="hm-thumb"><Icon name={b.icon ?? 'more'} size={22} /></span><span className="hm-row-text"><strong>{b.label}</strong>{(b.confirm || alwaysAsks(b)) && <small>{t('setup.confirm')}</small>}<small className="at-setup-id">{b.service}{b.target?.entity_id ? ` → ${[b.target.entity_id].flat().join(', ')}` : ''}</small></span><button type="button" className="hm-pill" data-action="delete-button" aria-label={`${t('setup.delete')}: ${b.label}`} onClick={() => ask({ text: t('setup.button.deleteAsk', { name: b.label }), yes: t('setup.delete'), run: () => patch(c => { c.buttons = c.buttons.filter(x => x.id !== b.id); }) })}>{t('setup.delete')}</button></div></div>)}</div>
    {/* each field is named by its caption alone (aria-label): the words under it are its description, not part of its name */}
    <section className="hm-card at-setup-new"><h2>{t('setup.addButton')}</h2>
      <label className="at-field" data-field="label"><span>{t('setup.buttonLabel')}</span><input ref={fields.label} type="text" aria-label={t('setup.buttonLabel')} value={draft.label} maxLength={60} autocomplete="off" {...wrong('label')} onInput={e => edit({ label: (e.target as HTMLInputElement).value })} />{said('label')}</label>
      <label className="at-field" data-field="service"><span>{t('setup.service')}</span><input ref={fields.service} type="text" aria-label={t('setup.service')} list="at-services" {...CODE} {...wrong('service')} value={draft.service} placeholder="light.turn_off…" onInput={e => edit({ service: (e.target as HTMLInputElement).value.trim() })} /><datalist id="at-services">{services.map(s => <option value={s} />)}</datalist>{said('service')}</label>
      <label className="at-field" data-field="entity"><span>{t('setup.target')}</span><input ref={fields.entity} type="text" aria-label={t('setup.target')} {...CODE} {...wrong('entity')} value={draft.entity} placeholder="light.kitchen…" onInput={e => edit({ entity: (e.target as HTMLInputElement).value })} />{said('entity')}</label>
      <label className="at-field" data-field="data"><span>{t('setup.data')}</span><input ref={fields.data} type="text" aria-label={t('setup.data')} {...CODE} {...wrong('data')} value={draft.data} placeholder='{"brightness_pct": 30}…' onInput={e => edit({ data: (e.target as HTMLInputElement).value })} />{said('data')}</label>
      <label className="at-field"><span>{t('setup.icon')}</span><select value={draft.icon} onChange={e => edit({ icon: (e.target as HTMLSelectElement).value })}>{ICONS.map(i => <option value={i}>{t(`setup.icon.${i}` as Key)}</option>)}</select></label>
      <div className="hm-setting" data-setting="confirm"><span>{t('setup.confirm')}{always && <small id={hintId}>{t('setup.alwaysAsks')}</small>}</span><Toggle on={draft.confirm || always} held={always} describedBy={always ? hintId : undefined} label={t('setup.confirm')} onToggle={() => edit({ confirm: !draft.confirm })} /></div>
      <button type="button" className="hm-pill is-primary" data-action="add-button" aria-disabled={sending || undefined} aria-busy={sending || undefined} onClick={() => void add()}>{t('setup.addButton')}</button>
    </section>
  </div>;
}
function HomeTab({ config, fresh, patch, ask, onImport, t, lock }: { config: HouseConfig; /** the settings as they are at the moment of the answer */ fresh: () => HouseConfig; patch: Patch; ask: AskFn; /** saves the whole settings and answers whether the house has them */ onImport: (cfg: HouseConfig) => Promise<boolean>; t: T; lock?: boolean }) {
  const [text, setText] = useState(''), [err, setErr] = useState(''), errId = useId();
  // ST-03: the pasted text stays until the house has it — a refused import leaves it, byte for byte, to send again; a success clears only the
  // text that was sent (`version` counts every edit). While it is on its way «Экспорт», «Импорт» and «Сбросить» wait (aria-disabled, the focus
  // stays); the field stays open, and nothing else of the house waits for it.
  const version = useRef(0), busy = useRef(false), [sending, setSending] = useState(false), json = useRef<HTMLTextAreaElement>(null), importer = useRef<HTMLButtonElement>(null);
  // the text cleared, «Импорт» has nothing to do (`disabled`): the keyboard that stood on it goes on into the empty JSON field, not to the page
  // (checked after the redraw: the question that asked may only now be closing, and its «back to the opener» lands on a button that is disabled)
  const cleared = () => { setText(''); requestAnimationFrame(() => { const box = json.current; if (!box) return; const a = activeIn(box), doc = box.ownerDocument, lost = !a || a === doc.body ? !doc.activeElement || doc.activeElement === doc.body : false; if (lost || a === importer.current) box.focus({ preventScroll: true }); }); };
  const send = (cfg: HouseConfig, sent?: number) => { if (busy.current) return; busy.current = true; setSending(true); void onImport(cfg).then(ok => { if (ok && sent !== undefined && version.current === sent) cleared(); }).finally(() => { busy.current = false; setSending(false); }); };
  // «Импорт JSON» is checked before anything is saved (a truncated paste used to store the factory configuration over the house's own);
  // a text that is a configuration is shown as «было → станет» and replaces the settings only after a «yes»
  const doImport = () => {
    if (busy.current) return;
    const r = checkImport(text); if (!r.ok) { setErr(t(`setup.import.err.${r.problem}` as Key)); return; }
    // a price dated after the house's today is what the tariff editor itself refuses: a pasted text does not bring it in either, and it is counted among the skipped
    const kept = normaliseTariffs(r.config.energy.tariffs, dayKey(houseDate())), future = r.config.energy.tariffs.length - kept.length, next = future ? { ...r.config, energy: { tariffs: kept } } : r.config, dropped = r.warnings.length + future;
    setErr(''); const was = configCounts(config), will = configCounts(next), sent = version.current;
    ask({ text: `${t('setup.import.ask', { r0: was.rooms, r1: will.rooms, d0: was.devices, d1: will.devices, b0: was.buttons, b1: will.buttons, a0: was.alarms, a1: will.alarms, t0: was.tariffs, t1: will.tariffs })}${dropped ? ' ' + t('setup.import.dropped', { n: dropped }) : ''}`, yes: t('setup.import.yes'), run: () => send(next, sent) });
  };
  const logo = (v: string) => { const url = v.trim(); if (url && !/^(data:image\/(png|jpeg|webp);base64,|\/local\/|https?:\/\/)/.test(url)) return t('setup.err.logo'); patch(c => { c.home.logo = url || null; }); };
  return <div className="at-setup-home" inert={lock}>
    <label className="at-field"><span>{t('setup.homeName')}</span><DraftInput type="text" value={config.home.name} maxLength={60} autocomplete="off" onCommit={v => { if (!v.trim()) return t('setup.err.homeName'); patch(c => { c.home.name = v.trim(); }); }} /></label>
    <label className="at-field"><span>{t('setup.language')}</span><select value={config.home.language} onChange={e => patch(c => { c.home.language = (e.target as HTMLSelectElement).value as HouseConfig['home']['language']; })}>{languages.map(l => <option value={l}>{({ ru: 'Русский', ro: 'Română', en: 'English' })[l]}</option>)}</select></label>
    <label className="at-field"><span>{t('setup.theme')}</span><select value={config.home.theme} onChange={e => patch(c => { c.home.theme = (e.target as HTMLSelectElement).value as 'light' | 'dark'; })}><option value="light">{t('setup.theme.light')}</option><option value="dark">{t('setup.theme.dark')}</option></select></label>
    <label className="at-field"><span>{t('setup.logo')}</span><DraftInput type="url" inputMode="url" {...CODE} value={config.home.logo ?? ''} placeholder="/local/logo.png" onCommit={logo} /></label>
    <div className="hm-chips"><button type="button" data-action="export" aria-disabled={sending || undefined} onClick={() => { if (busy.current) return; version.current++; setText(exportConfig(config)); setErr(''); }}>{t('setup.export')}</button><button type="button" data-action="import" ref={importer} onClick={doImport} disabled={!text.trim()} aria-disabled={sending || undefined} aria-busy={sending || undefined}>{t('setup.import')}</button><button type="button" data-action="reset" aria-disabled={sending || undefined} onClick={() => { if (!busy.current) ask({ text: t('setup.reset.ask'), yes: t('setup.reset.yes'), run: () => send(normaliseConfig({ schemaVersion: 1, home: fresh().home }).config) }); }}>{t('setup.reset')}</button></div>
    {err && <p className="hm-badge tone-danger at-setup-err" role="alert" id={errId}>{err}</p>}
    <label className="at-field"><span>{t('setup.json')}</span><textarea ref={json} className="at-json" rows={12} value={text} onInput={e => { version.current++; setText((e.target as HTMLTextAreaElement).value); if (err) setErr(''); }} aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined} {...CODE} /></label>
  </div>;
}

/** Downsizes an image in the browser before it goes to the store, then writes its URL into the config: a room's photograph to 1280 px JPEG 0.82;
 * an appliance's picture (`cutout`) that can be transparent (PNG, WebP, GIF, AVIF) keeps its transparency — a product cut out of its background
 * stays a cut-out (1024 px WebP 0.9; PNG where the browser encodes no WebP), so the card can stand it whole on its plate. A photograph is JPEG as before. */
async function shrink(file: File, cutout = false): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error('image')); i.src = url; });
    const alpha = cutout && /^image\/(png|webp|gif|avif)$/i.test(file.type);
    const scale = Math.min(1, (alpha ? 1024 : 1280) / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const encode = (type: string, quality?: number) => new Promise<Blob>((ok, err) => canvas.toBlob(b => b ? ok(b) : err(new Error('encode')), type, quality));
    if (!alpha) return await encode('image/jpeg', 0.82);
    // a browser that cannot write WebP hands back a PNG for it (the canvas's default): that is kept as it is, transparency and all
    const webp = await encode('image/webp', 0.9);
    return webp.type === 'image/webp' || webp.type === 'image/png' ? webp : await encode('image/png');
  } finally { URL.revokeObjectURL(url); }
}
/** The type the store is told: the blob's own (a cut-out is WebP or PNG), JPEG for everything else. */
const mimeOf = (blob: Blob) => blob.type === 'image/webp' || blob.type === 'image/png' ? blob.type : 'image/jpeg';
function PhotoField({ label, subject, value, fallback, photos, t, ask, onChange, cutout }: { label: string; /** whose photo it is (the room, the device): part of the control's name */ subject?: string; value: string | null; fallback?: string | null; photos?: PhotoStore; t: T; ask: AskFn; /** saves the settings with this photo (null: none) and answers whether the house has them */ onChange: (url: string | null) => Promise<boolean>; /** an appliance's picture: a cut-out keeps its transparency */ cutout?: boolean }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), errId = useId(), whose = subject ? `${label}: ${subject}` : label;
  const pick = async (file: File | undefined) => { if (!file || !photos) return; setBusy(true); setErr(''); try { const blob = await shrink(file, cutout); const url = await photos.upload(blob, mimeOf(blob)); void onChange(url); } catch (e) { setErr(e instanceof Error && (e.message === 'image' || e.message === 'encode') ? t('setup.photo.err') : errorText(e, t)); } finally { setBusy(false); } };
  // CODEX-004: the settings without the photo first (the store checks the revision), its file only once the house has them (`removePhoto`)
  const remove = () => removePhoto(value, () => onChange(null), photos);
  const shown = value ?? fallback ?? null;
  return <div className="at-field at-photo-field"><span>{label}{!value && fallback ? ` · ${t('setup.photo.stock')}` : ''}</span>
    <div className="at-photo-row">{shown ? <img className="at-photo-thumb" src={shown} width={64} height={48} alt="" /> : <span className="at-photo-thumb is-empty"><Icon name="rooms" size={22} /></span>}
      <label className="hm-pill at-upload"><input type="file" accept="image/*" aria-label={`${whose} — ${t('setup.photo.upload')}`} aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined} disabled={busy || !photos} onChange={e => void pick((e.target as HTMLInputElement).files?.[0])} />{busy ? '…' : t('setup.photo.upload')}</label>
      {value && <button type="button" className="hm-pill" data-action="remove-photo" aria-label={subject ? `${t('setup.photo.remove')}: ${subject}` : undefined} onClick={() => ask({ text: t('setup.photo.removeAsk'), yes: t('setup.photo.remove'), run: () => void remove() })}>{t('setup.photo.remove')}</button>}
    </div>{err && <small className="at-field-err" role="alert" id={errId}>{err}</small>}</div>;
}
function ModulesTab({ registry, config, patch, save, t, lock, ask, photos }: { registry: Registry; config: HouseConfig; patch: Patch; save: Save; t: T; lock?: boolean; ask: AskFn; photos?: PhotoStore }) {
  // a module that draws one appliance (the kettle, the feeder, the boiler) offers that appliance's photo: the same `photo` slot of its device as «Устройства» fills
  const photoSlot = (def: typeof MODULES[number], own: Record<string, string | undefined> | undefined, match: ReturnType<typeof MODULES[number]['detect']>) => { const id = def.photoEntity?.({ ...(match?.entities ?? {}), ...(own ?? {}) }); return id ? photoKey(registry, id) : null; };
  // what the store would silently drop (an entity id with a capital or a space) is refused here, with the reason
  const role = (id: string, key: string, raw: string) => { const v = raw.trim().toLowerCase(); if (v && !ENTITY_ID.test(v)) return t('setup.err.entity'); patch(c => { const ents = { ...(c.modules[id]?.entities ?? {}) }; if (v) ents[key] = v; else delete ents[key]; c.modules[id] = { ...(c.modules[id] ?? {}), entities: ents }; }); };
  const option = (id: string, key: string, raw: string) => { const v = raw.trim(); if (v && !/^[\w.\-]{1,64}$/.test(v)) return t('setup.err.option'); patch(c => { const opts = { ...(c.modules[id]?.options ?? {}) }; if (v) opts[key] = v; else delete opts[key]; c.modules[id] = { ...(c.modules[id] ?? {}), options: opts }; }); };
  return <div className="hm-rows" inert={lock}>{MODULES.map(def => { const match = def.detect(registry); const o = config.modules[def.id] ?? {}; const enabled = o.enabled !== false, slot = photoSlot(def, o.entities, match), title = t(def.titleKey as Key); return <div className="hm-row at-setup-row" data-module-id={def.id} key={def.id}>
    <div className="at-setup-main"><Toggle on={enabled} label={`${t('setup.show')}: ${t(def.titleKey as Key)}`} onToggle={() => patch(c => { c.modules[def.id] = { ...(c.modules[def.id] ?? {}), enabled: !enabled }; })} /><span className="hm-row-text"><strong>{t(def.titleKey as Key)}</strong><small>{match ? `${t('module.detected')} · ${match.label}` : t('module.notDetected')}</small></span></div>
    <div className="at-setup-form">{def.roles.map(r => <label className="at-field" key={r.role}><span>{t(r.labelKey as Key)}{r.required ? ' *' : ''}</span><DraftInput type="text" {...CODE} value={o.entities?.[r.role] ?? ''} placeholder={match?.entities[r.role] ?? 'sensor.…'} onCommit={v => role(def.id, r.role, v)} /></label>)}{(def.options ?? []).map(f => <label className="at-field" key={f.key}><span>{t(f.labelKey as Key)}{f.required ? ' *' : ''}</span><DraftInput type="text" {...CODE} value={o.options?.[f.key] ?? ''} placeholder={match?.options?.[f.key] ?? f.placeholder ?? ''} onCommit={v => option(def.id, f.key, v)} /></label>)}{slot && <PhotoField label={t('setup.photo')} subject={title} value={config.devices[slot]?.photo ?? null} photos={photos} t={t} ask={ask} cutout onChange={url => save(c => { c.devices[slot] ={ ...(c.devices[slot] ?? {}), photo: url }; })} />}</div>
  </div>; })}</div>;
}
