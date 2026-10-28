import { useMemo, useState } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import { discover, NO_ROOM, type Home, type HomeDevice } from '../model/discover.ts';
import { SECTIONS, type Kind } from '../model/kinds.ts';
import { normaliseConfig, type HouseConfig, type CustomButton } from '../model/config.ts';
import { languages, type T, type Key } from '../i18n/index.ts';
import { exportConfig, importConfig, type PhotoStore } from '../runtime/store.ts';
import { MODULES } from '../modules/index.ts';
import { stockRoomArt } from './art.ts';
import { artOf } from './cards.tsx';
import { DeviceArt, DEVICE_ART_TYPES } from './device-art.tsx';
import { iconOfKind, stateText, type Lang } from './format.ts';

type Tab = 'devices' | 'rooms' | 'sections' | 'buttons' | 'modules' | 'home';
const KINDS: Kind[] = ['light', 'switch', 'socket', 'climate', 'fan', 'cover', 'lock', 'vacuum', 'media', 'camera', 'weather', 'environment', 'energy', 'leak', 'opening', 'motion', 'alarm', 'valve', 'alarm_panel', 'person', 'measurement'];
const ICONS = ['light', 'power', 'socket', 'heating', 'fan', 'blinds', 'lock', 'vacuum', 'media', 'camera', 'air', 'thermo', 'energy', 'water', 'door', 'motion', 'warning', 'shield', 'person', 'systems', 'home', 'rooms', 'flame', 'more'];
export interface SetupProps { registry: Registry; config: HouseConfig; onChange: (next: HouseConfig) => void; admin: boolean; t: T; lang: Lang; storeLabel: string; warnings: string[]; photos?: PhotoStore }
/** In-panel configurator: every control edits a copy of HouseConfig and hands it back; the caller saves and re-discovers. */
export function Setup({ registry, config, onChange, admin, t, lang, storeLabel, warnings, photos }: SetupProps) {
  const [tab, setTab] = useState<Tab>('devices');
  const [note, setNote] = useState('');
  const home = useMemo(() => discover(registry, config), [registry, config]);
  const patch = (fn: (c: HouseConfig) => void) => { const next = structuredClone(config); fn(next); onChange(normaliseConfig(next).config); setNote(t('setup.saved')); };
  if (!admin) return <div className="hm-card at-placeholder"><Icon name="lock" size={40} /><p className="hm-muted">{t('setup.adminOnly')}</p></div>;
  const tabs: Array<[Tab, Key]> = [['devices', 'setup.devices'], ['rooms', 'setup.rooms'], ['sections', 'setup.sections'], ['buttons', 'setup.buttons'], ['modules', 'setup.modules'], ['home', 'setup.home']];
  return <div className="at-setup">
    <div className="hm-range-tabs at-setup-tabs" role="tablist">{tabs.map(([id, key]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{t(key)}</button>)}</div>
    {warnings.length > 0 && <details className="hm-fold"><summary><span>{t('setup.warnings')} ({warnings.length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{warnings.map(w => <p className="hm-muted">{w}</p>)}</div></details>}
    {tab === 'devices' && <DevicesTab home={home} config={config} patch={patch} t={t} lang={lang} photos={photos} />}
    {tab === 'rooms' && <RoomsTab home={home} config={config} patch={patch} t={t} photos={photos} />}
    {tab === 'modules' && <ModulesTab registry={registry} config={config} patch={patch} t={t} />}
    {tab === 'sections' && <div className="hm-rows">{SECTIONS.filter(s => s !== 'home' && s !== 'rooms').map(s => <div className="hm-setting at-setting-row"><span>{t(`section.${s}` as Key)}</span><Toggle on={!config.sections[s]?.hidden} label={t('setup.show')} onToggle={() => patch(c => { c.sections[s] = { hidden: !c.sections[s]?.hidden }; })} /></div>)}</div>}
    {tab === 'buttons' && <ButtonsTab config={config} patch={patch} t={t} registry={registry} />}
    {tab === 'home' && <HomeTab config={config} patch={patch} onImport={(cfg, w) => { onChange(cfg); setNote(w.length ? w.join('; ') : t('setup.imported')); }} t={t} storeLabel={storeLabel} />}
    {note && <div className="hm-badge tone-calm at-note" role="status">{note}</div>}
  </div>;
}
function Toggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`hm-switch ${on ? 'is-on' : ''}`} onClick={onToggle}><span className="hm-switch-knob" /></button>;
}
function DevicesTab({ home, config, patch, t, lang, photos }: { home: Home; config: HouseConfig; patch: (fn: (c: HouseConfig) => void) => void; t: T; lang: Lang; photos?: PhotoStore }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState<string | null>(null);
  const roomName = (id: string) => home.rooms.find(r => r.id === id)?.name || t('room.none');
  const list = home.devices.filter(d => !config.devices[d.key]?.mergeInto).filter(d => !q || `${d.name} ${d.primary.id} ${roomName(d.roomId)}`.toLowerCase().includes(q.toLowerCase()));
  const byRoom = new Map<string, HomeDevice[]>(); for (const d of list) (byRoom.get(d.roomId) ?? byRoom.set(d.roomId, []).get(d.roomId)!).push(d);
  const rooms = [...home.rooms.map(r => r.id), NO_ROOM].filter((id, i, a) => a.indexOf(id) === i && byRoom.has(id));
  const enabled = home.devices.filter(d => d.enabled).length;
  return <div className="at-setup-devices">
    <div className="hm-toolbar"><input type="search" className="at-search" placeholder={t('setup.search')} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} aria-label={t('setup.search')} /><span>{t('setup.enabledCount', { n: enabled, total: home.devices.length })}</span></div>
    {rooms.map(rid => <section className="hm-section"><div className="hm-section-head"><h2>{roomName(rid)}</h2></div><div className="hm-rows">
      {byRoom.get(rid)!.map(d => { const o = config.devices[d.key] ?? {}; const isOpen = open === d.key; return <div className={`hm-row at-setup-row ${d.enabled ? '' : 'is-off'}`} data-device-key={d.key}>
        <div className="at-setup-main">
          <Toggle on={d.enabled} label={`${t('setup.show')}: ${d.name}`} onToggle={() => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), enabled: !d.enabled }; })} />
          <button type="button" className="hm-row-open" onClick={() => setOpen(isOpen ? null : d.key)} aria-expanded={isOpen}><span className="hm-thumb">{d.photo ? <img src={d.photo} alt="" /> : artOf(d) ? <DeviceArt type={artOf(d)!} fill /> : <Icon name={d.icon ?? iconOfKind[d.kind] ?? 'generic'} size={22} />}</span><span className="hm-row-text"><strong>{d.name}</strong><small>{t(`kind.${d.kind}` as Key)} · {d.primary.id} · {stateText(d.primary, t, lang)}</small></span><Icon name={isOpen ? 'back' : 'next'} size={18} /></button>
        </div>
        {isOpen && <div className="at-setup-form">
          <label className="at-field"><span>{t('setup.name')}</span><input type="text" value={o.name ?? ''} placeholder={d.name} maxLength={80} onChange={e => patch(c => { const v = (e.target as HTMLInputElement).value.trim(); c.devices[d.key] = { ...(c.devices[d.key] ?? {}), name: v || undefined }; })} /></label>
          <label className="at-field"><span>{t('setup.room')}</span><select value={o.roomId ?? d.roomId} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), roomId: (e.target as HTMLSelectElement).value }; })}>{[...home.rooms, ...(home.rooms.some(r => r.id === NO_ROOM) ? [] : [{ id: NO_ROOM, name: t('room.none') }])].map(r => <option value={r.id}>{r.name || t('room.none')}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.kind')}</span><select value={o.kind ?? d.kind} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), kind: (e.target as HTMLSelectElement).value as Kind }; })}>{KINDS.map(k => <option value={k}>{t(`kind.${k}` as Key)}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.icon')}</span><select value={o.icon ?? ''} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), icon: (e.target as HTMLSelectElement).value || undefined }; })}><option value="">—</option>{ICONS.map(i => <option value={i}>{i}</option>)}</select></label>
          <label className="at-field at-art-field"><span>{t('setup.art')}</span><select value={o.art ?? ''} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), art: (e.target as HTMLSelectElement).value || undefined }; })}><option value="">{t('setup.art.auto')}</option><option value="none">{t('setup.art.none')}</option>{DEVICE_ART_TYPES.map(a => <option value={a}>{t(`art.${a}` as Key)}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.mergeInto')}</span><select value={o.mergeInto ?? ''} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), mergeInto: (e.target as HTMLSelectElement).value || undefined }; })}><option value="">{t('setup.noMerge')}</option>{home.devices.filter(x => x.key !== d.key && x.roomId === d.roomId && !config.devices[x.key]?.mergeInto).map(x => <option value={x.key}>{x.name} · {t(`kind.${x.kind}` as Key)}</option>)}</select></label>
          <label className="at-field"><span>{t('setup.order')}</span><input type="number" value={o.order ?? 0} onChange={e => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), order: Number((e.target as HTMLInputElement).value) || 0 }; })} /></label>
          <PhotoField label={t('setup.photo')} value={o.photo ?? null} photos={photos} t={t} onChange={url => patch(c => { c.devices[d.key] = { ...(c.devices[d.key] ?? {}), photo: url }; })} />
          {(d.metrics.length + d.controls.length) > 1 && <details className="hm-fold"><summary><span>{t('setup.entities')} ({d.controls.length + d.metrics.length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{[...d.controls, ...d.metrics].map(e => <div className="hm-setting"><span>{e.name}<small>{e.id}</small></span><button type="button" className="hm-pill" onClick={() => patch(c => { c.entities[e.id] = { ...(c.entities[e.id] ?? {}), hidden: true }; })}>{t('setup.hideEntity')}</button></div>)}</div></details>}
        </div>}
      </div>; })}
    </div></section>)}
    {Object.keys(config.entities).filter(id => config.entities[id].hidden).length > 0 && <details className="hm-fold"><summary><span>{t('setup.hidden')}: {t('setup.entities')} ({Object.keys(config.entities).filter(id => config.entities[id].hidden).length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{Object.keys(config.entities).filter(id => config.entities[id].hidden).map(id => <div className="hm-setting"><span>{id}</span><button type="button" className="hm-pill" onClick={() => patch(c => { delete c.entities[id]; })}>{t('setup.show')}</button></div>)}</div></details>}
  </div>;
}
function RoomsTab({ home, config, patch, t, photos }: { home: Home; config: HouseConfig; patch: (fn: (c: HouseConfig) => void) => void; t: T; photos?: PhotoStore }) {
  const rooms = [...home.rooms, ...(home.rooms.some(r => r.id === NO_ROOM) ? [] : [{ id: NO_ROOM, name: '', hidden: false, photo: null, order: 999, areaTemperature: null, areaHumidity: null }])];
  return <div className="hm-rows">{rooms.map(r => { const o = config.rooms[r.id] ?? {}; const count = home.devices.filter(d => d.enabled && d.roomId === r.id).length; return <div className="hm-row at-setup-row" data-room-id={r.id}>
    <div className="at-setup-main"><Toggle on={!r.hidden} label={`${t('setup.show')}: ${r.name || t('room.none')}`} onToggle={() => patch(c => { c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), hidden: !r.hidden }; })} /><span className="hm-row-text"><strong>{r.name || t('room.none')}</strong><small>{r.id} · {count}</small></span></div>
    <div className="at-setup-form"><label className="at-field"><span>{t('setup.name')}</span><input type="text" value={o.name ?? ''} placeholder={r.name || t('room.none')} maxLength={80} onChange={e => patch(c => { const v = (e.target as HTMLInputElement).value.trim(); c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), name: v || undefined }; })} /></label>
      <label className="at-field"><span>{t('setup.order')}</span><input type="number" value={o.order ?? r.order} onChange={e => patch(c => { c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), order: Number((e.target as HTMLInputElement).value) || 0 }; })} /></label>
      <PhotoField label={t('setup.photo')} value={o.photo ?? null} fallback={stockRoomArt(r.name)} photos={photos} t={t} onChange={url => patch(c => { c.rooms[r.id] = { ...(c.rooms[r.id] ?? {}), photo: url }; })} /></div>
  </div>; })}</div>;
}
function ButtonsTab({ config, patch, t, registry }: { config: HouseConfig; patch: (fn: (c: HouseConfig) => void) => void; t: T; registry: Registry }) {
  const [draft, setDraft] = useState<{ label: string; service: string; entity: string; data: string; confirm: boolean; icon: string }>({ label: '', service: '', entity: '', data: '', confirm: true, icon: 'more' });
  const [err, setErr] = useState('');
  const services = Object.entries(registry.services ?? {}).flatMap(([d, list]) => list.map(s => `${d}.${s}`)).sort();
  const add = () => {
    if (!draft.label.trim() || !/^[a-z_]+\.[a-z_]+$/.test(draft.service)) { setErr(t('setup.service')); return; }
    let data: Record<string, unknown> | undefined;
    if (draft.data.trim()) { try { const v = JSON.parse(draft.data); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('object'); data = v; } catch { setErr(t('setup.data')); return; } }
    const b: CustomButton = { id: `b${Date.now().toString(36)}`, label: draft.label.trim().slice(0, 60), icon: draft.icon || undefined, service: draft.service, target: draft.entity.trim() ? { entity_id: draft.entity.trim() } : undefined, data, confirm: draft.confirm };
    patch(c => { c.buttons.push(b); }); setDraft({ label: '', service: '', entity: '', data: '', confirm: true, icon: 'more' }); setErr('');
  };
  return <div className="at-setup-buttons">
    <div className="hm-rows">{config.buttons.map(b => <div className="hm-row at-setup-row"><div className="at-setup-main"><span className="hm-thumb"><Icon name={b.icon ?? 'more'} size={22} /></span><span className="hm-row-text"><strong>{b.label}</strong><small>{b.service}{b.target?.entity_id ? ` → ${String(b.target.entity_id)}` : ''}{b.confirm ? ` · ${t('setup.confirm')}` : ''}</small></span><button type="button" className="hm-pill" onClick={() => patch(c => { c.buttons = c.buttons.filter(x => x.id !== b.id); })}>{t('setup.delete')}</button></div></div>)}</div>
    <section className="hm-card at-setup-new"><h3>{t('setup.addButton')}</h3>
      <label className="at-field"><span>{t('setup.buttonLabel')}</span><input type="text" value={draft.label} maxLength={60} onInput={e => { const v = (e.target as HTMLInputElement).value; setDraft(d => ({ ...d, label: v })); }} /></label>
      <label className="at-field"><span>{t('setup.service')}</span><input type="text" list="at-services" value={draft.service} placeholder="light.turn_off" onInput={e => { const v = (e.target as HTMLInputElement).value.trim(); setDraft(d => ({ ...d, service: v })); }} /><datalist id="at-services">{services.map(s => <option value={s} />)}</datalist></label>
      <label className="at-field"><span>{t('setup.target')}</span><input type="text" value={draft.entity} placeholder="light.kitchen" onInput={e => { const v = (e.target as HTMLInputElement).value; setDraft(d => ({ ...d, entity: v })); }} /></label>
      <label className="at-field"><span>{t('setup.data')}</span><input type="text" value={draft.data} placeholder='{"brightness_pct": 30}' onInput={e => { const v = (e.target as HTMLInputElement).value; setDraft(d => ({ ...d, data: v })); }} /></label>
      <label className="at-field"><span>{t('setup.icon')}</span><select value={draft.icon} onChange={e => { const v = (e.target as HTMLSelectElement).value; setDraft(d => ({ ...d, icon: v })); }}>{ICONS.map(i => <option value={i}>{i}</option>)}</select></label>
      <div className="hm-setting"><span>{t('setup.confirm')}</span><Toggle on={draft.confirm} label={t('setup.confirm')} onToggle={() => setDraft(d => ({ ...d, confirm: !d.confirm }))} /></div>
      {err && <p className="hm-badge tone-danger">{err}</p>}
      <button type="button" className="hm-pill is-primary" onClick={add}>{t('setup.addButton')}</button>
    </section>
  </div>;
}
function HomeTab({ config, patch, onImport, t, storeLabel }: { config: HouseConfig; patch: (fn: (c: HouseConfig) => void) => void; onImport: (cfg: HouseConfig, warnings: string[]) => void; t: T; storeLabel: string }) {
  const [text, setText] = useState('');
  return <div className="at-setup-home">
    <label className="at-field"><span>{t('setup.homeName')}</span><input type="text" value={config.home.name} maxLength={60} onChange={e => patch(c => { c.home.name = (e.target as HTMLInputElement).value.trim() || c.home.name; })} /></label>
    <label className="at-field"><span>{t('setup.language')}</span><select value={config.home.language} onChange={e => patch(c => { c.home.language = (e.target as HTMLSelectElement).value as HouseConfig['home']['language']; })}>{languages.map(l => <option value={l}>{({ ru: 'Русский', ro: 'Română', en: 'English' })[l]}</option>)}</select></label>
    <label className="at-field"><span>{t('setup.theme')}</span><select value={config.home.theme} onChange={e => patch(c => { c.home.theme = (e.target as HTMLSelectElement).value as 'light' | 'dark'; })}><option value="light">{t('setup.theme.light')}</option><option value="dark">{t('setup.theme.dark')}</option></select></label>
    <label className="at-field"><span>{t('setup.logo')}</span><input type="url" value={config.home.logo ?? ''} placeholder="/local/logo.png" onChange={e => patch(c => { c.home.logo = (e.target as HTMLInputElement).value.trim() || null; })} /></label>
    <div className="hm-chips"><button type="button" onClick={() => setText(exportConfig(config))}>{t('setup.export')}</button><button type="button" onClick={() => { const r = importConfig(text); onImport(r.config, r.warnings); }} disabled={!text.trim()}>{t('setup.import')}</button><button type="button" onClick={() => { if (confirm(t('setup.reset') + '?')) onImport(normaliseConfig({ schemaVersion: 1, home: config.home }).config, []); }}>{t('setup.reset')}</button></div>
    <textarea className="at-json" rows={12} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} aria-label="JSON" spellcheck={false} />
    <p className="hm-muted">{storeLabel}</p>
  </div>;
}

/** Downsizes an image in the browser (max 1280 px, JPEG 0.82) before it goes to the store, then writes its URL into the config. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error('image')); i.src = url; });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((ok, err) => canvas.toBlob(b => b ? ok(b) : err(new Error('encode')), 'image/jpeg', 0.82));
  } finally { URL.revokeObjectURL(url); }
}
function PhotoField({ label, value, fallback, photos, t, onChange }: { label: string; value: string | null; fallback?: string | null; photos?: PhotoStore; t: T; onChange: (url: string | null) => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const pick = async (file: File | undefined) => { if (!file || !photos) return; setBusy(true); setErr(''); try { const blob = await shrink(file); const url = await photos.upload(blob, 'image/jpeg'); onChange(url); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const remove = async () => { if (value && photos) await photos.remove(value).catch(() => undefined); onChange(null); };
  const shown = value ?? fallback ?? null;
  return <div className="at-field at-photo-field"><span>{label}{!value && fallback ? ` · ${t('setup.photo.stock')}` : ''}</span>
    <div className="at-photo-row">{shown ? <img className="at-photo-thumb" src={shown} alt="" /> : <span className="at-photo-thumb is-empty"><Icon name="rooms" size={22} /></span>}
      <label className="hm-pill at-upload"><input type="file" accept="image/*" disabled={busy || !photos} onChange={e => void pick((e.target as HTMLInputElement).files?.[0])} />{busy ? '…' : t('setup.photo.upload')}</label>
      {value && <button type="button" className="hm-pill" onClick={() => void remove()}>{t('setup.photo.remove')}</button>}
    </div>{err && <small className="tone-danger">{err}</small>}</div>;
}
function ModulesTab({ registry, config, patch, t }: { registry: Registry; config: HouseConfig; patch: (fn: (c: HouseConfig) => void) => void; t: T }) {
  return <div className="hm-rows">{MODULES.map(def => { const match = def.detect(registry); const o = config.modules[def.id] ?? {}; const enabled = o.enabled !== false; return <div className="hm-row at-setup-row" data-module-id={def.id}>
    <div className="at-setup-main"><Toggle on={enabled} label={`${t('setup.show')}: ${t(def.titleKey as Key)}`} onToggle={() => patch(c => { c.modules[def.id] = { ...(c.modules[def.id] ?? {}), enabled: !enabled }; })} /><span className="hm-row-text"><strong>{t(def.titleKey as Key)}</strong><small>{match ? `${t('module.detected')} · ${match.label}` : t('module.notDetected')}</small></span></div>
    <div className="at-setup-form">{def.roles.map(r => <label className="at-field"><span>{t(r.labelKey as Key)}{r.required ? ' *' : ''}</span><input type="text" value={o.entities?.[r.role] ?? ''} placeholder={match?.entities[r.role] ?? 'sensor.…'} onChange={e => patch(c => { const v = (e.target as HTMLInputElement).value.trim(); const ents = { ...(c.modules[def.id]?.entities ?? {}) }; if (v) ents[r.role] = v; else delete ents[r.role]; c.modules[def.id] = { ...(c.modules[def.id] ?? {}), entities: ents }; })} /></label>)}{(def.options ?? []).map(f => <label className="at-field"><span>{t(f.labelKey as Key)}{f.required ? ' *' : ''}</span><input type="text" value={o.options?.[f.key] ?? ''} placeholder={match?.options?.[f.key] ?? f.placeholder ?? ''} onChange={e => patch(c => { const v = (e.target as HTMLInputElement).value.trim(); const opts = { ...(c.modules[def.id]?.options ?? {}) }; if (v) opts[f.key] = v; else delete opts[f.key]; c.modules[def.id] = { ...(c.modules[def.id] ?? {}), options: opts }; })} /></label>)}</div>
  </div>; })}</div>;
}
