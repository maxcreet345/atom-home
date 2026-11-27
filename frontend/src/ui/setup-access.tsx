/** «Настройка → Доступ» («Acces», 27.11.2026, docs/ACCESS.md): who sees which building. The buildings and their rooms are Home Assistant's
 * floors and areas, read only; the roles, the people (Home Assistant's users) and the named screens are the owner's. Everything is written
 * into `config.access` through the same save as the rest of the settings (config/set, administrators only). */
import { useEffect, useState } from 'preact/hooks';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { dayKey } from '../model/config.ts';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import { houseDate } from '../runtime/zone.ts';
import { normaliseProfiles } from '../model/tile-layout.ts';
import { ACCESS_SECTIONS, ACCESS_MODULES, ACCESS_MODES, NO_BUILDING, buildingsOf, accessUsers, starterAccess, copyRole, withoutRole, defaultAccess, DEFAULT_ROLES, type AccessConfig, type AccessUser, type AccessRole, type AccessMode } from '../model/access.ts';
import { Icon } from './primitives.tsx';

type Save = (fn: (c: HouseConfig) => void) => Promise<boolean>;
type Ask = (q: { text: string; yes: string; run: () => void }) => void;
/** A role's name: the owner's, else the ready role's own word, else its id. */
export function roleName(id: string, role: Pick<AccessRole, 'name'> | undefined, t: T): string {
  if (role?.name) return role.name;
  const k = `access.role.${id}` as Key, w = t(k); return w !== k ? w : id;
}
const Switch = ({ on, label, onToggle, held }: { on: boolean; label: string; onToggle: () => void; held?: boolean }) => <button type="button" role="switch" aria-checked={on} aria-label={label} aria-disabled={held || undefined} className={`hm-switch ${on ? 'is-on' : ''}`} onClick={() => { if (!held) onToggle(); }}><span className="hm-switch-knob" /></button>;
/** A text field that writes on leaving it (the panel redraws on every state of the house: a bound field would lose what is typed). */
function Field({ value, onCommit, label, type = 'text', maxLength }: { value: string; onCommit: (v: string) => void; label: string; type?: 'text' | 'date'; maxLength?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); };
  return <input type={type as 'text'} aria-label={label} maxLength={maxLength} autocomplete="off" value={draft ?? value} onInput={e => setDraft((e.target as HTMLInputElement).value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setDraft(null); }} />;
}

export function AccessTab({ registry, config, save, ask, t, host, onViewAs, lock }: { registry: Registry; config: HouseConfig; save: Save; ask: Ask; t: T; host?: Host; onViewAs?: (u: AccessUser) => void; lock?: boolean }) {
  const access: AccessConfig = config.access ?? defaultAccess();
  const floors = buildingsOf(registry.floors), free = registry.areas.filter(a => !a.floor_id);
  const [users, setUsers] = useState<AccessUser[] | null>(null), [usersFailed, setUsersFailed] = useState(false);
  const [screens, setScreens] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => { let alive = true; const ws = host?.ws;
    if (!ws) { setUsersFailed(true); return; }
    ws<unknown>({ type: 'config/auth/list' }).then(r => { if (alive) setUsers(accessUsers(r)); }, () => { if (alive) setUsersFailed(true); });
    host?.layouts?.get().then(r => { if (alive) setScreens(Object.entries(normaliseProfiles((r as { profiles?: unknown } | null)?.profiles)).map(([id, p]) => ({ id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))); }, () => { if (alive) setScreens([]); });
    return () => { alive = false; }; }, [host]);
  const edit = (fn: (a: AccessConfig) => AccessConfig | void) => save(c => { const a = c.access ? c.access : defaultAccess(); const r = fn(a); c.access = r ?? a; });
  const roles = Object.entries(access.roles), rn = (id: string) => roleName(id, access.roles[id], t);
  const floorName = (id: string) => id === NO_BUILDING ? t('access.noBuilding' as Key) : floors.find(f => f.floor_id === id)?.name ?? id;
  const today = dayKey(houseDate());
  const roleSelect = (value: string | undefined, onPick: (r: string | undefined) => void, label: string, none = true) => <select aria-label={label} value={value ?? ''} onChange={e => onPick((e.target as HTMLSelectElement).value || undefined)}>{none && <option value="">{t('access.noAccess' as Key)}</option>}{roles.map(([id]) => <option value={id}>{rn(id)}</option>)}</select>;
  const turn = () => {
    if (access.enabled) { ask({ text: t('access.disable.ask' as Key), yes: t('access.disable.yes' as Key), run: () => { void edit(a => ({ ...a, enabled: false })); } }); return; }
    if (!users) return;
    ask({ text: t('access.wizard.text' as Key), yes: t('access.wizard.yes' as Key), run: () => { void edit(a => starterAccess(config.access ? a : undefined, users)); } });
  };
  return <div className="at-setup-access" inert={lock}>
    <div className="hm-card at-access-honest" role="note"><Icon name="info" size={20} /><div><p>{t('access.honest' as Key)}</p><p className="hm-muted">{t('access.kiosk' as Key)}</p></div></div>
    <section className="hm-section"><div className="hm-rows">
      <div className="hm-setting at-setting-row" data-access="enabled"><span><strong>{t('access.enabled' as Key)}</strong><small className="hm-muted">{access.enabled ? t('access.enabled.on' as Key) : t('access.enabled.off' as Key)}</small></span><Switch on={access.enabled} held={!access.enabled && !users} label={t('access.enabled' as Key)} onToggle={turn} /></div>
      <div className="hm-setting at-setting-row" data-access="new-users"><span>{t('access.newUsers' as Key)}</span><select aria-label={t('access.newUsers' as Key)} value={access.newUsers} onChange={e => { const v = (e.target as HTMLSelectElement).value as AccessConfig['newUsers']; void edit(a => ({ ...a, newUsers: v })); }}><option value="none">{t('access.newUsers.none' as Key)}</option><option value="default">{t('access.newUsers.default' as Key)}</option></select></div>
      {access.newUsers === 'default' && <div className="hm-setting at-setting-row" data-access="default"><span>{t('access.defaultBuilding' as Key)}</span><span className="at-access-pair"><select aria-label={t('access.defaultBuilding' as Key)} value={access.defaultBuilding ?? ''} onChange={e => { const v = (e.target as HTMLSelectElement).value || undefined; void edit(a => ({ ...a, defaultBuilding: v })); }}><option value="">—</option>{floors.map(f => <option value={f.floor_id}>{f.name}</option>)}</select>{roleSelect(access.defaultRole, r => void edit(a => ({ ...a, defaultRole: r })), t('access.defaultRole' as Key))}</span></div>}
    </div></section>

    <section className="hm-section" data-access="buildings"><div className="hm-section-head"><h2>{t('access.buildings' as Key)}</h2></div>
      <p className="hm-muted at-access-hint">{floors.length ? t('access.buildings.hint' as Key) : t('access.noFloors' as Key)}</p>
      <div className="hm-rows">{floors.map(f => { const areas = registry.areas.filter(a => a.floor_id === f.floor_id); return <div className="hm-setting at-access-building" data-floor={f.floor_id}><span><strong>{f.name}</strong><small className="hm-muted">{areas.map(a => config.rooms[a.area_id]?.name ?? a.name).join(' · ') || t('access.areas' as Key, { n: 0 })}</small></span><span className="hm-badge">{t('access.areas' as Key, { n: areas.length })}</span></div>; })}
        {free.length > 0 && <div className="hm-setting at-access-building is-free" data-floor={NO_BUILDING}><span><strong>{t('access.noBuilding' as Key)}</strong><small className="hm-muted">{free.map(a => config.rooms[a.area_id]?.name ?? a.name).join(' · ')}</small><small className="at-access-warn">{t('access.unassigned.hint' as Key)}</small></span><span className="hm-badge tone-warning">{t('access.areas' as Key, { n: free.length })}</span></div>}
      </div></section>

    <section className="hm-section" data-access="roles"><div className="hm-section-head"><h2>{t('access.roles' as Key)}</h2></div><div className="at-access-roles">
      {roles.map(([id, r]) => <details className="hm-fold at-access-role" data-role={id}><summary><span><strong>{rn(id)}</strong> <small className="hm-muted">{t(`access.mode.${r.mode}` as Key)}</small></span><Icon name="next" size={18} /></summary><div className="at-access-role-body">
        <label className="at-field"><span>{t('access.role.name' as Key)}</span><Field value={r.name || rn(id)} maxLength={40} label={`${t('access.role.name' as Key)}: ${rn(id)}`} onCommit={v => void edit(a => { a.roles[id] = { ...a.roles[id], name: v.trim() === roleName(id, { name: '' }, t) ? '' : v.trim().slice(0, 40) }; })} /></label>
        <label className="at-field"><span>{t('access.role.mode' as Key)}</span><select value={r.mode} onChange={e => { const m = (e.target as HTMLSelectElement).value as AccessMode; void edit(a => { a.roles[id] = { ...a.roles[id], mode: m }; }); }}>{ACCESS_MODES.map(m => <option value={m}>{t(`access.mode.${m}` as Key)}</option>)}</select></label>
        <fieldset className="at-access-checks"><legend>{t('access.role.sections' as Key)}</legend>{ACCESS_SECTIONS.map(s => <label className="at-check"><input type="checkbox" checked={r.sections.includes(s)} onChange={() => void edit(a => { const cur = a.roles[id].sections; a.roles[id] = { ...a.roles[id], sections: cur.includes(s) ? cur.filter(x => x !== s) : ACCESS_SECTIONS.filter(x => x === s || cur.includes(x)) }; })} />{t(`section.${s}` as Key)}</label>)}</fieldset>
        <fieldset className="at-access-checks"><legend>{t('access.role.modules' as Key)}</legend>{ACCESS_MODULES.map(m => <label className="at-check"><input type="checkbox" checked={r.modules.includes(m)} onChange={() => void edit(a => { const cur = a.roles[id].modules; a.roles[id] = { ...a.roles[id], modules: cur.includes(m) ? cur.filter(x => x !== m) : ACCESS_MODULES.filter(x => x === m || cur.includes(x)) }; })} />{t(`access.module.${m}` as Key)}</label>)}</fieldset>
        <div className="hm-chips"><button type="button" className="hm-pill" data-action="role-copy" onClick={() => void edit(a => { const c = copyRole(a.roles, id, t('access.role.copyName' as Key, { name: rn(id) })); return { ...a, roles: c.roles }; })}>{t('access.role.copy' as Key)}</button>
          {roles.length > 1 && <button type="button" className="hm-pill" data-action="role-delete" onClick={() => ask({ text: t('access.role.deleteAsk' as Key, { name: rn(id) }), yes: t('access.role.delete' as Key), run: () => { void edit(a => withoutRole(a, id)); } })}>{t('access.role.delete' as Key)}</button>}</div>
      </div></details>)}
    </div></section>

    <section className="hm-section" data-access="people"><div className="hm-section-head"><h2>{t('access.people' as Key)}</h2></div>
      {!users && !usersFailed && <p className="hm-muted" role="status">{t('access.people.loading' as Key)}</p>}
      {usersFailed && <p className="at-field-err" role="alert">{t('access.people.fail' as Key)}</p>}
      {users && <div className="hm-rows">{users.map(u => { const m = access.members[u.id] ?? {}, expired = !!m.until && today > m.until;
        const setM = (fn: (m: NonNullable<AccessConfig['members'][string]>) => void) => void edit(a => { const cur = { ...(a.members[u.id] ?? {}) }; fn(cur); a.members = { ...a.members, [u.id]: cur }; });
        return <div className="hm-row at-access-person" data-user={u.id}>
          <div className="at-access-who"><span className="hm-row-text"><strong>{u.name}</strong><small className="hm-muted">{[u.admin && t('access.admin' as Key), u.localOnly && t('access.localOnly' as Key), !u.active && t('access.inactive' as Key), expired && t('access.expiredOn' as Key)].filter(Boolean).join(' · ')}</small></span>
            {onViewAs && <button type="button" className="hm-pill" data-action="view-as" onClick={() => onViewAs(u)}><Icon name="person" size={16} />{t('access.viewAs' as Key)}</button>}</div>
          {u.admin ? null : <div className="at-access-grants">
            <label className="at-check at-access-all"><Switch on={!!m.all} label={`${t('access.allBuildings' as Key)}: ${u.name}`} onToggle={() => setM(x => { if (x.all) { delete x.all; delete x.role; } else { x.all = true; x.role = x.role ?? Object.values(x.buildings ?? {})[0] ?? 'staff'; } })} /><span>{t('access.allBuildings' as Key)}</span></label>
            {m.all ? <label className="at-field"><span>{t('access.allBuildings' as Key)}</span>{roleSelect(m.role, r => setM(x => { if (r) x.role = r; else { delete x.role; delete x.all; } }), t('access.roleIn' as Key, { building: t('access.allBuildings' as Key), name: u.name }))}</label>
              : floors.map(f => <label className="at-field" data-floor={f.floor_id}><span>{f.name}</span>{roleSelect(m.buildings?.[f.floor_id], r => setM(x => { const b = { ...(x.buildings ?? {}) }; if (r) b[f.floor_id] = r; else delete b[f.floor_id]; if (Object.keys(b).length) x.buildings = b; else delete x.buildings; }), t('access.roleIn' as Key, { building: f.name, name: u.name }))}</label>)}
            <label className="at-field at-access-until"><span>{t('access.until' as Key)}</span><Field type="date" value={m.until ?? ''} label={`${t('access.until' as Key)}: ${u.name}`} onCommit={v => setM(x => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) x.until = v; else delete x.until; })} /></label>
          </div>}
        </div>; })}</div>}
    </section>

    <section className="hm-section" data-access="tablets"><div className="hm-section-head"><h2>{t('access.tablets' as Key)}</h2></div>
      <p className="hm-muted at-access-hint">{t('access.tablets.hint' as Key)}</p>
      {screens && !screens.length && <p className="hm-muted">{t('access.tablets.none' as Key)}</p>}
      {screens && screens.length > 0 && <div className="hm-rows">{screens.map(s => { const b = access.profiles[s.id];
        return <div className="hm-setting at-access-tablet" data-profile={s.id}><span><strong>{s.name}</strong></span><span className="at-access-pair">
          <select aria-label={`${t('access.building' as Key)}: ${s.name}`} value={b?.building ?? ''} onChange={e => { const v = (e.target as HTMLSelectElement).value; void edit(a => { const p = { ...a.profiles }; if (v) p[s.id] = { building: v, role: p[s.id]?.role ?? (a.roles.tablet ? 'tablet' : Object.keys(a.roles)[0]) }; else delete p[s.id]; a.profiles = p; }); }}><option value="">{t('access.tablet.free' as Key)}</option>{floors.map(f => <option value={f.floor_id}>{floorName(f.floor_id)}</option>)}</select>
          {b && roleSelect(b.role, r => void edit(a => { if (r) a.profiles = { ...a.profiles, [s.id]: { ...a.profiles[s.id], role: r } }; }), `${t('access.role.mode' as Key)}: ${s.name}`, false)}
        </span></div>; })}</div>}
    </section>
  </div>;
}
/** «Кому видно» of a device in «Устройства»: everyone who has its room, or only the roles ticked. */
export function WhoSees({ value, roles, t, onChange }: { value: string[] | undefined; roles: Record<string, AccessRole> | undefined; t: T; onChange: (v: string[] | undefined) => void }) {
  const all = roles ?? (DEFAULT_ROLES as Record<string, AccessRole>), list = Object.entries(all);
  return <div className="at-field at-access-whosees"><span>{t('access.who' as Key)}</span>
    <select aria-label={t('access.who' as Key)} value={value ? 'roles' : 'all'} onChange={e => onChange((e.target as HTMLSelectElement).value === 'roles' ? [] : undefined)}><option value="all">{t('access.who.all' as Key)}</option><option value="roles">{t('access.who.roles' as Key)}</option></select>
    {value && <fieldset className="at-access-checks"><legend className="at-vh">{t('access.who.roles' as Key)}</legend>{list.map(([id, r]) => <label className="at-check"><input type="checkbox" checked={value.includes(id)} onChange={() => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])} />{roleName(id, r, t)}</label>)}</fieldset>}
  </div>;
}
