/* «Расставить» (owner, 20.11.2026): every device of the house arranges the cards of «Главная» and of each room for itself — drag a card
 * to another place, pull its corner for its size in whole cells, or tap it for buttons (a remote, a keyboard, a hand that does not drag).
 * The device names itself once («Планшет кухня»); the arrangement is kept in HA under that name (model/tile-layout.ts,
 * custom_components/atom_home/layouts.py), so a replaced phone picks the name and gets it back. Nothing is arranged until someone does:
 * a screen without an arrangement is drawn exactly as before (`fallback`). */
import { createContext } from 'preact';
import { createPortal } from 'preact/compat';
import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import { Icon } from './primitives.tsx';
import { arrange, keep, moveBy, moveTo, normaliseProfiles, profileIdFor, resize, spanOf, MAX_SPAN, type LayoutProfile, type Placed, type Span } from '../model/tile-layout.ts';

const lk = (t: T, k: string, p?: Record<string, string | number>) => t(`lay.${k}` as Key, p);
const POINTER_KEY = 'atom-home:layout-device';
const readPointer = () => { try { return localStorage.getItem(POINTER_KEY); } catch { return null; } };
const writePointer = (id: string | null) => { try { if (id) localStorage.setItem(POINTER_KEY, id); else localStorage.removeItem(POINTER_KEY); } catch { /* private mode: asked again next time */ } };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface LayItem { key: string; node: ComponentChildren; label?: string; /** the card is drawn in a list of rows without a layout (a room's plain devices): it starts as one cell */ unit?: boolean; min?: Span }
interface Draft { scope: string; list: Placed[] | null; natural: Record<string, Span> }
interface Ctx {
  available: boolean; t: T; admin: boolean;
  device: { id: string; name: string } | null; profile: LayoutProfile | null; profiles: Record<string, LayoutProfile>;
  draft: Draft | null; setList: (list: Placed[]) => void;
  begin: (scope: string) => void;
}
const LayoutCtx = createContext<Ctx | null>(null);
export const useLayout = () => useContext(LayoutCtx);

/** A hidden mark before each card (no box, not a grid item): the arrangement starts from the element that follows it — what the screen shows. */
const MARK = 'data-lay-mark';
function marked(root: ParentNode): Map<string, Element> {
  const out = new Map<string, Element>();
  for (const m of root.querySelectorAll(`[${MARK}]`)) { const el = m.nextElementSibling; if (el && !el.hasAttribute(MARK)) out.set(m.getAttribute(MARK)!, el); }
  return out;
}

function gridMetrics(grid: Element): { cols: number; cell: number; gap: number } {
  const cs = getComputedStyle(grid), cols = cs.gridTemplateColumns.split(' ').filter(Boolean);
  const cell = parseFloat(cols[0]) || 150, gap = parseFloat(cs.columnGap) || 12;
  return { cols: Math.max(1, cols.length), cell, gap };
}

export function LayoutProvider({ host, t, children }: { host: Host; t: T; children: ComponentChildren }) {
  const [profiles, setProfiles] = useState<Record<string, LayoutProfile>>({});
  const [available, setAvailable] = useState(false);
  const [pointer, setPointer] = useState<string | null>(() => readPointer());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [naming, setNaming] = useState<{ scope: string | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState<null | 'reset'>(null);
  const listRef = useRef<Placed[] | null>(null);
  const load = useCallback(async () => {
    if (!host.layouts) { setAvailable(false); return null; }
    try { const p = normaliseProfiles(await host.layouts.get()); setProfiles(p); setAvailable(true); return p; } catch { setAvailable(false); return null; }
  }, [host]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 3600); return () => clearTimeout(id); }, [note]);
  const device = pointer && profiles[pointer] ? { id: pointer, name: profiles[pointer].name } : null;
  const profile = device ? profiles[device.id] : null;
  const start = useCallback((scope: string) => {
    // the size every card has right now, in cells of its own grid: the arrangement starts as the screen is
    const natural: Record<string, Span> = {};
    // an arranged screen starts from its arrangement (no marks there); a screen drawn as before, from what it shows
    const root = document.querySelector(`[data-lay-scope="${CSS.escape(scope)}"]`);
    for (const [key, el] of root ? marked(root) : []) {
      const parent = el.parentElement; if (!parent || !el.isConnected) continue;
      if (parent.classList.contains('rm-tile-grid')) { natural[key] = { w: 1, h: 1 }; continue; }
      const g = gridMetrics(parent), r = el.getBoundingClientRect(); natural[key] = spanOf(r, g.cell, g.gap, g.cols);
    }
    listRef.current = null; setDraft({ scope, list: null, natural });
  }, []);
  const begin = useCallback((scope: string) => {
    void load().then(p => { if (!p) { setNote(lk(t, 'unavailable')); return; } if (pointer && p[pointer]) start(scope); else setNaming({ scope }); });
  }, [load, pointer, start, t]);
  const setList = useCallback((list: Placed[]) => { listRef.current = list; setDraft(d => d ? { ...d, list } : d); }, []);
  const saveScopes = async (scopes: LayoutProfile['scopes'], name = device!.name, id = device!.id) => {
    const old = profiles[id];
    try { const { rev } = await host.layouts!.set(id, name, scopes, old ? old.rev : 0); setProfiles(p => ({ ...p, [id]: { name, scopes, rev, updated: Date.now() / 1000 } })); return true; }
    catch (e) { const code = (e as { code?: string })?.code; setNote(code === 'conflict' ? lk(t, 'conflict', { name }) : lk(t, 'saveFailed')); void load(); return false; }
  };
  const done = async () => {
    if (!draft || !device) { setDraft(null); return; }
    const list = listRef.current; if (!list) { setDraft(null); return; }
    const rows = keep(list, profile?.scopes[draft.scope]);
    if (await saveScopes({ ...(profile?.scopes ?? {}), [draft.scope]: rows })) { setNote(lk(t, 'saved', { name: device.name })); setDraft(null); }
  };
  const reset = async () => {
    setAsking(null); if (!draft || !device) return;
    const scopes = { ...(profile?.scopes ?? {}) }; delete scopes[draft.scope];
    if (await saveScopes(scopes)) setDraft(null);
  };
  const named = async (choice: { id: string; name: string; existing: boolean }) => {
    if (!choice.existing) { const ok = await saveScopes(profiles[choice.id]?.scopes ?? {}, choice.name, choice.id); if (!ok) return; }
    writePointer(choice.id); setPointer(choice.id);
    const scope = naming?.scope ?? null; setNaming(null);
    if (scope) start(scope);
  };
  const forget = async (id: string) => { try { await host.layouts!.remove(id); } catch { setNote(lk(t, 'saveFailed')); } if (id === pointer) { writePointer(null); setPointer(null); } await load(); };
  const ctx: Ctx = { available, t, admin: host.admin, device, profile, profiles, draft, setList, begin };
  return <LayoutCtx.Provider value={ctx}>
    {children}
    {draft && device && <div className="at-lay-bar" role="toolbar" aria-label={lk(t, 'bar')}>
      <button type="button" className="at-lay-who" onClick={() => setNaming({ scope: null })} aria-label={`${lk(t, 'bar')}: ${device.name}. ${lk(t, 'deviceRename')}`}><Icon name="grid" size={18} /><span><b>{lk(t, 'bar')}</b><small>{device.name}</small></span></button>
      <span className="at-lay-help">{lk(t, matchMedia?.('(pointer: coarse)').matches ? 'helpTouch' : 'help')}</span>
      <span className="at-lay-tools-host" />
      <span className="at-lay-acts">
        {profile?.scopes[draft.scope] && <button type="button" className="hm-pill" onClick={() => setAsking('reset')}>{lk(t, 'reset')}</button>}
        <button type="button" className="hm-pill" onClick={() => setDraft(null)}>{lk(t, 'cancel')}</button>
        <button type="button" className="hm-pill is-primary at-lay-done" onClick={() => void done()}>{lk(t, 'done')}</button>
      </span>
    </div>}
    {asking === 'reset' && device && <div className="hm-scrim at-lay-ask" onClick={e => { if (e.target === e.currentTarget) setAsking(null); }}><section className="hm-sheet is-small" role="alertdialog" aria-modal="true" aria-label={lk(t, 'reset')}>
      <p>{lk(t, 'resetAsk', { name: device.name })}</p>
      <div className="at-lay-ask-acts"><button type="button" className="hm-pill" onClick={() => setAsking(null)}>{lk(t, 'cancel')}</button><button type="button" className="hm-pill is-primary" onClick={() => void reset()}>{lk(t, 'resetYes')}</button></div>
    </section></div>}
    {naming && <DeviceName t={t} profiles={profiles} current={device} admin={host.admin} onClose={() => setNaming(null)} onPick={named} onForget={forget} />}
    {note && <div className="at-lay-toast" role="status">{note}</div>}
  </LayoutCtx.Provider>;
}

/** A first name for this device from what it is: a phone, a tablet, a computer, a television. */
function guessName(t: T): string {
  const w = Math.min(screen.width, screen.height), touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const ru = t('lay.arrange' as Key) === 'Расставить', ro = t('lay.arrange' as Key) === 'Aranjează';
  const words = ru ? ['Телефон', 'Планшет', 'Компьютер', 'Телевизор'] : ro ? ['Telefon', 'Tabletă', 'Calculator', 'Televizor'] : ['Phone', 'Tablet', 'Computer', 'TV'];
  return !touch ? (Math.max(screen.width, screen.height) >= 2400 ? words[3] : words[2]) : w < 600 ? words[0] : words[1];
}

function DeviceName({ t, profiles, current, admin, onClose, onPick, onForget }: { t: T; profiles: Record<string, LayoutProfile>; current: { id: string; name: string } | null; admin: boolean; onClose: () => void; onPick: (c: { id: string; name: string; existing: boolean }) => void; onForget: (id: string) => void }) {
  const [name, setName] = useState(current?.name ?? guessName(t));
  const [busy, setBusy] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const clean = name.split(/\s+/).filter(Boolean).join(' ');
  const others = Object.entries(profiles).filter(([id]) => id !== current?.id).sort((a, b) => b[1].updated - a[1].updated);
  const taken = others.find(([, p]) => p.name.toLowerCase() === clean.toLowerCase());
  const submit = async () => { if (!clean || clean.length > 40 || taken || busy) return; setBusy(true); await onPick(current ? { id: current.id, name: clean, existing: false } : { id: profileIdFor(clean, Object.keys(profiles)), name: clean, existing: false }); setBusy(false); };
  return <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <section className="hm-sheet at-lay-name" role="dialog" aria-modal="true" aria-labelledby="at-lay-name-h">
      <header className="at-lay-name-head"><h2 id="at-lay-name-h">{lk(t, 'deviceTitle')}</h2><button type="button" className="hm-icon-btn at-lay-x" aria-label={lk(t, 'cancel')} onClick={onClose}><Icon name="close" size={20} /></button></header>
      <p className="hm-muted">{lk(t, 'deviceWhy')}</p>
      <form onSubmit={e => { e.preventDefault(); void submit(); }} className="at-lay-name-form">
        <label><span>{lk(t, 'deviceName')}</span><input ref={input} value={name} maxLength={40} placeholder={lk(t, 'devicePlaceholder')} onInput={e => setName((e.target as HTMLInputElement).value)} aria-invalid={!!taken || undefined} aria-describedby={taken ? 'at-lay-taken' : undefined} /></label>
        {taken && <p id="at-lay-taken" className="at-lay-warn">{lk(t, 'deviceTaken')}</p>}
        <button type="submit" className="hm-pill is-primary" disabled={!clean || !!taken || busy}>{current ? lk(t, 'done') : lk(t, 'deviceStart')}</button>
      </form>
      {others.length > 0 && <div className="at-lay-name-list"><h3>{lk(t, 'deviceExisting')}</h3>
        {others.map(([id, p]) => <div className={`at-lay-name-row ${taken?.[0] === id ? 'is-match' : ''}`}>
          <Icon name="devices" size={20} /><span>{p.name}</span>
          {forgetting === id ? <><button type="button" className="hm-pill" onClick={() => setForgetting(null)}>{lk(t, 'cancel')}</button><button type="button" className="hm-pill is-danger" onClick={() => { setForgetting(null); onForget(id); }}>{lk(t, 'deviceForget')}</button></>
            : <>{admin && <button type="button" className="hm-text-btn" onClick={() => setForgetting(id)} aria-label={`${lk(t, 'deviceForget')}: ${p.name}`}>{lk(t, 'deviceForget')}</button>}<button type="button" className="hm-pill" onClick={() => onPick({ id, name: p.name, existing: true })}>{lk(t, 'deviceUse')}</button></>}
        </div>)}
        {forgetting && <p className="at-lay-warn" role="status">{lk(t, 'deviceForgetAsk', { name: profiles[forgetting]?.name ?? '' })}</p>}
      </div>}
    </section>
  </div>;
}

/** «Расставить»: for everyone who uses the screen (the owner: «любой житель»). Hidden while the integration does not keep arrangements yet. */
export function ArrangeButton({ scope }: { scope: string }) {
  const c = useLayout(); if (!c?.available || c.draft) return null;
  return <button type="button" className="hm-pill at-arrange" data-action="arrange" title={lk(c.t, 'arrangeHint')} onClick={() => c.begin(scope)}><Icon name="grid" size={16} />{lk(c.t, 'arrange')}</button>;
}

const FLIP_MS = 200;
/** A screen's cards in this device's arrangement. Without one (and not arranging) the screen's own `fallback` is drawn, as before. */
export function LayoutGrid({ scope, items, className, fallback, tail }: { scope: string; items: LayItem[]; className: string; fallback: (mark: (item: LayItem) => JSX.Element) => ComponentChildren; tail?: ComponentChildren }) {
  const c = useLayout();
  const mark = (it: LayItem) => c?.available ? <><i hidden {...{ [MARK]: it.key }} />{it.node}</> : <>{it.node}</>;
  const saved = c?.profile?.scopes[scope];
  const editing = c?.draft?.scope === scope;
  if (!c || (!saved && !editing)) return <div className="at-lay-scope" data-lay-scope={scope}>{fallback(mark)}</div>;
  return <Arranged c={c} scope={scope} items={items} className={className} saved={saved} editing={editing} tail={tail} />;
}

function Arranged({ c, scope, items, className, saved, editing, tail }: { c: Ctx; scope: string; items: LayItem[]; className: string; saved: Array<[string, number, number]> | undefined; editing: boolean; tail?: ComponentChildren }) {
  const t = c.t, grid = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<{ cols: number; cell: number; gap: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(items.map(i => [i.key, i])), [items]);
  useLayoutEffect(() => {
    const el = grid.current; if (!el) return;
    const measure = () => { const g = gridMetrics(el); setM(o => o && o.cols === g.cols && Math.abs(o.cell - g.cell) < .5 && o.gap === g.gap ? o : g); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, []);
  const cols = m?.cols ?? 4, natural = (key: string): Span => c.draft?.natural[key] ?? (byKey.get(key)?.unit ? { w: 1, h: 1 } : { w: 1, h: 1 });
  const keys = items.map(i => i.key);
  const shown = arrange(keys, saved, natural, cols);
  const draft = editing ? c.draft!.list : null;
  useEffect(() => { if (editing && !draft) c.setList(shown); }, [editing, !!draft]);
  // a card that left the screen while arranging (a sensor went away) leaves the draft too; a new one joins it at its place
  const list = editing && draft ? arrange(keys, draft.map(x => [x.key, x.w, x.h] as [string, number, number]), natural, cols) : shown;
  useEffect(() => { if (!editing) setPicked(null); }, [editing]);
  // FLIP: the cards that make room glide to their new places instead of jumping (none when the device asks for less motion)
  const before = useRef<Map<string, DOMRect> | null>(null);
  const snapshot = () => { const el = grid.current; if (!el || reduced()) return; before.current = new Map([...el.querySelectorAll<HTMLElement>('.at-slot')].map(s => [s.dataset.lay!, s.getBoundingClientRect()])); };
  useLayoutEffect(() => {
    const prev = before.current; before.current = null; const el = grid.current; if (!prev || !el) return;
    for (const s of el.querySelectorAll<HTMLElement>('.at-slot')) {
      if (s.classList.contains('is-dragging')) continue;
      const a = prev.get(s.dataset.lay!), b = s.getBoundingClientRect(); if (!a) continue;
      const dx = a.left - b.left, dy = a.top - b.top; if (!dx && !dy) continue;
      s.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  });
  const update = (next: Placed[]) => { if (next === list) return; snapshot(); c.setList(next); };
  const minOf = (key: string) => byKey.get(key)?.min ?? { w: 1, h: 1 };
  // ---- drag to move (a mouse at once; a finger after holding still, so the page still scrolls under a passing thumb) ----
  const drag = useRef<{ key: string; id: number; x: number; y: number; ox: number; oy: number; armed: boolean; timer: ReturnType<typeof setTimeout> | null; moved: boolean; last: number; el: HTMLElement } | null>(null);
  const place = (d: NonNullable<typeof drag.current>, x: number, y: number) => {
    const el = d.el; el.style.transform = ''; const r = el.getBoundingClientRect();
    el.style.transform = `translate(${x - d.ox - r.left}px,${y - d.oy - r.top}px) scale(1.03)`;
  };
  useLayoutEffect(() => { const d = drag.current; if (d?.armed) { const s = grid.current?.querySelector<HTMLElement>(`.at-slot[data-lay="${CSS.escape(d.key)}"]`); if (s) { d.el = s; s.classList.add('is-dragging'); } } });
  useEffect(() => {
    // while a card is held the page must not scroll under it: a touchmove that is not passive is the one way to say so on a phone
    const stop = (e: TouchEvent) => { if (drag.current?.armed) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false }); return () => document.removeEventListener('touchmove', stop);
  }, []);
  const arm = (d: NonNullable<typeof drag.current>) => { d.armed = true; d.el.classList.add('is-dragging'); setPicked(null); try { navigator.vibrate?.(12); } catch { /* not a phone */ } };
  const down = (key: string) => (e: PointerEvent) => {
    if (e.button !== 0) return; const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('.at-slot')!; const r = el.getBoundingClientRect();
    const d = { key, id: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, armed: false, timer: null as ReturnType<typeof setTimeout> | null, moved: false, last: 0, el };
    drag.current = d; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (e.pointerType !== 'mouse') d.timer = setTimeout(() => { if (drag.current === d && !d.moved) arm(d); }, 260);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d || e.pointerId !== d.id) return;
    const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.armed) { if (far > (e.pointerType === 'mouse' ? 4 : 10)) { d.moved = true; if (e.pointerType === 'mouse') arm(d); else { if (d.timer) clearTimeout(d.timer); drag.current = null; } } if (!d.armed) return; }
    e.preventDefault(); place(d, e.clientX, e.clientY);
    // the edge of the screen scrolls the page, so a card can travel past what is visible
    const sc = scroller(grid.current); if (sc) { const b = sc.getBoundingClientRect(); if (e.clientY < b.top + 56) sc.scrollBy(0, -14); else if (e.clientY > b.bottom - 56) sc.scrollBy(0, 14); }
    const now = performance.now(); if (now - d.last < 120) return;
    d.el.style.pointerEvents = 'none'; const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.at-slot'); d.el.style.pointerEvents = '';
    const target = over?.dataset.lay; if (target && target !== d.key && grid.current?.contains(over!)) { d.last = now; update(moveTo(list, d.key, target)); }
  };
  const up = (key: string) => (e: PointerEvent) => {
    const d = drag.current; if (!d || e.pointerId !== d.id) return; if (d.timer) clearTimeout(d.timer); drag.current = null;
    if (d.armed) { d.el.classList.remove('is-dragging'); const from = d.el.getBoundingClientRect(); d.el.style.transform = ''; const to = d.el.getBoundingClientRect(); if (!reduced()) d.el.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
    else if (!d.moved && e.type === 'pointerup') setPicked(p => p === key ? null : key);
  };
  // ---- the corner: pull for the size, in whole cells ----
  const rs = useRef<{ key: string; id: number; x: number; y: number; w: number; h: number } | null>(null);
  const rsDown = (p: Placed) => (e: PointerEvent) => { e.stopPropagation(); if (e.button !== 0) return; rs.current = { key: p.key, id: e.pointerId, x: e.clientX, y: e.clientY, w: p.w, h: p.h }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const rsMove = (e: PointerEvent) => { const r = rs.current; if (!r || r.id !== e.pointerId || !m) return; e.preventDefault(); const step = m.cell + m.gap; update(resize(list, r.key, { w: r.w + (e.clientX - r.x) / step, h: r.h + (e.clientY - r.y) / step }, cols, minOf(r.key))); };
  const rsUp = (e: PointerEvent) => { if (rs.current?.id === e.pointerId) rs.current = null; };
  useEffect(() => { const s = drag.current; return () => { if (s?.timer) clearTimeout(s.timer); }; }, []);
  // ---- keys: arrows move, Shift + arrows size; Escape lets go of the card ----
  const keyOf = (p: Placed) => (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (e.key === 'Escape') { setPicked(null); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(x => x === p.key ? null : p.key); return; }
    if (step === undefined) return; e.preventDefault();
    if (e.shiftKey) update(resize(list, p.key, { w: p.w + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0), h: p.h + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0) }, cols, minOf(p.key)));
    else update(moveBy(list, p.key, step));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`.at-slot[data-lay="${CSS.escape(p.key)}"] .at-slot-veil`)?.focus());
  };
  const labelOf = (key: string, i: number) => byKey.get(key)?.label || grid.current?.querySelector(`.at-slot[data-lay="${CSS.escape(key)}"] :is(strong,h2,h3)`)?.textContent?.trim() || lk(t, 'card', { n: i + 1 });
  const style = m ? `--lay-cell:${m.cell}px` : undefined;
  const host = editing ? document.querySelector<HTMLElement>('.at-lay-bar .at-lay-tools-host') : null;
  return <div ref={grid} className={`ah-cascade ${className} at-lay ${editing ? 'is-arranging' : ''}`} style={style} data-scope={scope}>
    {list.map((p, i) => { const it = byKey.get(p.key)!; const sel = picked === p.key; const min = minOf(p.key);
      return <div key={p.key} className={`at-slot ${sel ? 'is-picked' : ''}`} data-lay={p.key} data-w={p.w} data-h={p.h} style={`grid-column:span ${p.w};grid-row:span ${p.h};--h:${p.h}`}>
        {editing ? <div className="at-slot-body" inert>{it.node}</div> : it.node}
        {editing && <>
          <div className="at-slot-veil" role="button" tabIndex={0} aria-roledescription={lk(t, 'bar')} aria-pressed={sel} aria-label={lk(t, 'cardLabel', { name: labelOf(p.key, i), w: p.w, h: p.h })}
            onPointerDown={down(p.key)} onPointerMove={move} onPointerUp={up(p.key)} onPointerCancel={up(p.key)} onKeyDown={keyOf(p)} onContextMenu={e => e.preventDefault()} />
          <span className="at-slot-size" aria-hidden="true">{lk(t, 'size', { w: p.w, h: p.h })}</span>
          <button type="button" className="at-slot-grip" aria-label={lk(t, 'grip')} tabIndex={-1} onPointerDown={rsDown(p)} onPointerMove={rsMove} onPointerUp={rsUp} onPointerCancel={rsUp}><i /></button>
          {sel && host && createPortal(<div className="at-slot-tools" role="group" aria-label={labelOf(p.key, i)}>
            <button type="button" aria-label={lk(t, 'moveBack')} disabled={i === 0} onClick={() => update(moveBy(list, p.key, -1))}><Icon name="back" size={18} /></button>
            <button type="button" aria-label={lk(t, 'moveFwd')} disabled={i === list.length - 1} onClick={() => update(moveBy(list, p.key, 1))}><Icon name="next" size={18} /></button>
            <span className="at-slot-tools-sep" />
            <button type="button" aria-label={lk(t, 'narrower')} disabled={p.w <= min.w} onClick={() => update(resize(list, p.key, { w: p.w - 1, h: p.h }, cols, min))}>↔−</button>
            <button type="button" aria-label={lk(t, 'wider')} disabled={p.w >= Math.min(cols, MAX_SPAN)} onClick={() => update(resize(list, p.key, { w: p.w + 1, h: p.h }, cols, min))}>↔+</button>
            <button type="button" aria-label={lk(t, 'lower')} disabled={p.h <= min.h} onClick={() => update(resize(list, p.key, { w: p.w, h: p.h - 1 }, cols, min))}>↕−</button>
            <button type="button" aria-label={lk(t, 'taller')} disabled={p.h >= MAX_SPAN} onClick={() => update(resize(list, p.key, { w: p.w, h: p.h + 1 }, cols, min))}>↕+</button>
          <span className="at-slot-tools-name">{labelOf(p.key, i)} · {lk(t, 'size', { w: p.w, h: p.h })}</span></div>, host)}
        </>}
      </div>; })}
    {tail}
  </div>;
}
function scroller(el: Element | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; }
  return document.scrollingElement as HTMLElement | null;
}
