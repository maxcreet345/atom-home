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
import { SlotSizeCtx, sizeClass } from './slot-size.ts';
import { arrange, keep, moveBy, moveTo, normaliseProfiles, profileIdFor, resize, spanOf, blockCols, blockFor, blockWidth, BLOCK_FULL, MAX_SPAN, type LayoutProfile, type Placed, type Span } from '../model/tile-layout.ts';

const lk = (t: T, k: string, p?: Record<string, string | number>) => t(`lay.${k}` as Key, p);
const POINTER_KEY = 'atom-home:layout-device';
const readPointer = () => { try { return localStorage.getItem(POINTER_KEY); } catch { return null; } };
const writePointer = (id: string | null) => { try { if (id) localStorage.setItem(POINTER_KEY, id); else localStorage.removeItem(POINTER_KEY); } catch { /* private mode: asked again next time */ } };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface LayItem { key: string; node: ComponentChildren; label?: string; /** the card is drawn in a list of rows without a layout (a room's plain devices): it starts as one cell */ unit?: boolean; min?: Span; /** the size it takes when it first appears on an arranged screen (a camera, the heating: two by two) */ span?: Span;
  /** a page's own block (the chart of «Энергия», the guard of «Безопасность»): as tall as it is, its width in eighths of the row (model/tile-layout.ts) */ block?: boolean }
interface Draft { scope: string; list: Placed[] | null; natural: Record<string, Span> }
interface Ctx {
  available: boolean; t: T; admin: boolean;
  device: { id: string; name: string } | null; profile: LayoutProfile | null; profiles: Record<string, LayoutProfile>;
  draft: Draft | null; setList: (list: Placed[]) => void;
  begin: (scope: string) => void; say: (text: string) => void;
}
const LayoutCtx = createContext<Ctx | null>(null);
const own = <V,>(o: Record<string, V>, k: string | null | undefined): V | undefined => k && Object.hasOwn(o, k) ? o[k] : undefined;
/** The panel lives in a shadow root inside Home Assistant (live-main.tsx): every lookup goes through the node's own root, never `document`. */
export const rootOf = (el: Node | null | undefined): Document | ShadowRoot => (el?.getRootNode() as Document | ShadowRoot | undefined) ?? document;
export const useLayout = () => useContext(LayoutCtx);

/** A hidden mark before each card (no box, not a grid item): the arrangement starts from the element that follows it — what the screen shows. */
const MARK = 'data-lay-mark', BLOCK = 'data-lay-block';
function marked(root: ParentNode): Map<string, Element> {
  const out = new Map<string, Element>();
  for (const m of root.querySelectorAll(`[${MARK}]`)) { const el = m.nextElementSibling; if (el && !el.hasAttribute(MARK)) out.set(m.getAttribute(MARK)!, el); }
  return out;
}

function gridMetrics(grid: Element): { cols: number; cell: number; gap: number } {
  // only the grid's own columns: a card drawn wider than the grid for a moment makes an empty implicit one, which is not a column of the screen
  const cs = getComputedStyle(grid), cols = cs.gridTemplateColumns.split(' ').filter(c => parseFloat(c) > 0);
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
  const anchor = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const load = useCallback(async () => {
    if (!host.layouts) { setAvailable(false); return null; }
    try { const p = normaliseProfiles(await host.layouts.get()); setProfiles(p); setAvailable(true); return p; } catch { setAvailable(false); return null; }
  }, [host]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 3600); return () => clearTimeout(id); }, [note]);
  const mine = own(profiles, pointer);
  const device = pointer && mine ? { id: pointer, name: mine.name } : null;
  const profile = mine ?? null;
  const start = useCallback((scope: string) => {
    // the size every card has right now, in cells of its own grid: the arrangement starts as the screen is
    const natural: Record<string, Span> = {};
    // an arranged screen starts from its arrangement (no marks there); a screen drawn as before, from what it shows
    const root = rootOf(anchor.current).querySelector(`[data-lay-scope="${CSS.escape(scope)}"]`);
    for (const [key, el] of root ? marked(root) : []) {
      let parent = el.parentElement; if (!parent || !el.isConnected) continue;
      if (el.previousElementSibling?.hasAttribute(BLOCK)) { // a block: the share of its row it takes now
        while (parent.parentElement && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
        const pw = parent.clientWidth || parent.getBoundingClientRect().width, w = el.getBoundingClientRect().width; natural[key] = { w: pw > 0 && w > 0 ? blockWidth(w / pw) : BLOCK_FULL, h: 1 }; continue;
      }
      if (parent.classList.contains('rm-tile-grid')) { natural[key] = { w: 1, h: 1 }; continue; }
      const g = gridMetrics(parent), r = el.getBoundingClientRect(); natural[key] = spanOf(r, g.cell, g.gap, g.cols);
    }
    listRef.current = null; setDraft({ scope, list: null, natural });
  }, []);
  const begin = useCallback((scope: string) => {
    void load().then(p => { if (!p) { setNote(lk(t, 'unavailable')); return; } if (own(p, pointer)) start(scope); else setNaming({ scope }); });
  }, [load, pointer, start, t]);
  const setList = useCallback((list: Placed[]) => { listRef.current = list; setDraft(d => d ? { ...d, list } : d); }, []);
  const saveScopes = async (scopes: LayoutProfile['scopes'], name = device!.name, id = device!.id) => {
    const old = own(profiles, id);
    try { const { rev } = await host.layouts!.set(id, name, scopes, old ? old.rev : 0); setProfiles(p => ({ ...p, [id]: { name, scopes, rev, updated: Date.now() / 1000 } })); return true; }
    catch (e) { const code = (e as { code?: string })?.code; setNote(code === 'conflict' ? lk(t, 'conflict', { name }) : code === 'not_owner' ? lk(t, 'notOwner', { name }) : lk(t, 'saveFailed')); void load(); return false; }
  };
  // one save at a time: a second tap on «Готово» would send the old revision and be told the arrangement «changed elsewhere»
  const once = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const done = () => once(async () => {
    if (!draft || !device) { setDraft(null); return; }
    const list = listRef.current; if (!list) { setDraft(null); return; }
    const rows = keep(list, profile?.scopes[draft.scope]);
    if (await saveScopes({ ...(profile?.scopes ?? {}), [draft.scope]: rows })) { setNote(lk(t, 'saved', { name: device.name })); setDraft(null); }
  });
  const reset = () => once(async () => {
    setAsking(null); if (!draft || !device) return;
    const scopes = { ...(profile?.scopes ?? {}) }; delete scopes[draft.scope];
    if (await saveScopes(scopes)) setDraft(null);
  });
  const named = async (choice: { id: string; name: string; existing: boolean }) => {
    if (!choice.existing) { const ok = await saveScopes(own(profiles, choice.id)?.scopes ?? {}, choice.name, choice.id); if (!ok) return; }
    writePointer(choice.id); setPointer(choice.id);
    const scope = naming?.scope ?? null; setNaming(null);
    if (scope) start(scope);
  };
  const forget = async (id: string) => { try { await host.layouts!.remove(id); } catch { setNote(lk(t, 'saveFailed')); } if (id === pointer) { writePointer(null); setPointer(null); } await load(); };
  const say = useCallback((text: string) => setSaid(text), []);
  // leaving the arranging mode (saved, cancelled, put back): the keyboard returns to «Расставить», not to nowhere
  useEffect(() => { if (!draft) return; const id = requestAnimationFrame(() => { const q = CSS.escape(draft.scope); if (!rootOf(anchor.current).querySelector(`[data-lay-scope="${q}"],.at-lay[data-scope="${q}"]`)) setDraft(null); }); return () => cancelAnimationFrame(id); });
  const was = useRef(false);
  useEffect(() => { const on = !!draft; if (was.current && !on) requestAnimationFrame(() => { const root = rootOf(anchor.current), a = root.activeElement; if (!a || a === (root as Document).body || !(a as HTMLElement).isConnected) root.querySelector<HTMLElement>('[data-action="arrange"]')?.focus({ preventScroll: true }); }); was.current = on; }, [draft]);
  const ctx: Ctx = { available, t, admin: host.admin, device, profile, profiles, draft, setList, begin, say };
  return <LayoutCtx.Provider value={ctx}>
    <i hidden ref={anchor} />
    {children}
    <span className="at-vh" aria-live="polite">{said}</span>
    {draft && device && !naming && !asking /* its own windows stand alone: on a phone the bar covered the name field and the question */ && <div className="at-lay-bar" role="toolbar" aria-label={lk(t, 'bar')}>
      <button type="button" className="at-lay-who" onClick={() => setNaming({ scope: null })} aria-label={`${lk(t, 'bar')}: ${device.name}. ${lk(t, 'deviceRename')}`}><Icon name="grid" size={18} /><span><b>{lk(t, 'bar')}</b><small>{device.name}</small></span></button>
      <span className="at-lay-help">{lk(t, matchMedia?.('(pointer: coarse)').matches ? 'helpTouch' : 'help')}</span>
      <span className="at-lay-tools-host" />
      <span className="at-lay-acts">
        {profile?.scopes[draft.scope] && <button type="button" className="hm-pill" disabled={busy} onClick={() => setAsking('reset')}>{lk(t, 'reset')}</button>}
        <button type="button" className="hm-pill" disabled={busy} onClick={() => setDraft(null)}>{lk(t, 'cancel')}</button>
        <button type="button" className="hm-pill is-primary at-lay-done" disabled={busy} aria-busy={busy || undefined} onClick={() => void done()}>{lk(t, 'done')}</button>
      </span>
    </div>}
    {asking === 'reset' && device && <Ask t={t} text={lk(t, 'resetAsk', { name: device.name })} yes={lk(t, 'resetYes')} busy={busy} onNo={() => setAsking(null)} onYes={() => void reset()} />}
    {naming && <DeviceName t={t} profiles={profiles} current={device} admin={host.admin} onClose={() => setNaming(null)} onPick={named} onForget={forget} />}
    {note && <div className="at-lay-toast" role="status">{note}</div>}
  </LayoutCtx.Provider>;
}

/** The question before «Как было»: focus on «Отменить», Tab stays inside, Escape is «Отменить», focus goes back where it was. */
function Ask({ t, text, yes, busy, onNo, onYes }: { t: T; text: string; yes: string; busy: boolean; onNo: () => void; onYes: () => void }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => { const back = rootOf(box.current).activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('button')?.focus(); return () => back?.focus?.(); }, []);
  return <div className="hm-scrim at-lay-ask" onClick={e => { if (e.target === e.currentTarget) onNo(); }} onKeyDown={e => trap(e, box.current, onNo)}><section ref={box} className="hm-sheet is-small" role="alertdialog" aria-modal="true" aria-describedby="at-lay-ask-tx">
    <p id="at-lay-ask-tx">{text}</p>
    <div className="at-lay-ask-acts"><button type="button" className="hm-pill" onClick={onNo}>{lk(t, 'cancel')}</button><button type="button" className="hm-pill is-primary" disabled={busy} onClick={onYes}>{yes}</button></div>
  </section></div>;
}
/** Tab and Shift+Tab go round the dialog's own controls; Escape closes it. */
function trap(e: KeyboardEvent, box: HTMLElement | null, close: () => void) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
  if (e.key !== 'Tab' || !box) return;
  const f = [...box.querySelectorAll<HTMLElement>('button:not([disabled]),input,[tabindex="0"]')]; if (!f.length) return;
  const at = rootOf(box).activeElement, first = f[0], last = f[f.length - 1];
  if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
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
  const input = useRef<HTMLInputElement>(null), box = useRef<HTMLElement>(null);
  useEffect(() => { const back = rootOf(input.current).activeElement as HTMLElement | null; input.current?.focus(); input.current?.select(); return () => back?.focus?.(); }, []);
  const clean = name.split(/\s+/).filter(Boolean).join(' ');
  const others = Object.entries(profiles).filter(([id]) => id !== current?.id).sort((a, b) => b[1].updated - a[1].updated);
  const taken = others.find(([, p]) => p.name.toLowerCase() === clean.toLowerCase());
  const submit = async () => { if (!clean || clean.length > 40 || taken || busy) return; setBusy(true); await onPick(current ? { id: current.id, name: clean, existing: false } : { id: profileIdFor(clean, Object.keys(profiles)), name: clean, existing: false }); setBusy(false); };
  return <div className="hm-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => trap(e, box.current, onClose)}>
    <section ref={box} className="hm-sheet at-lay-name" role="dialog" aria-modal="true" aria-labelledby="at-lay-name-h">
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
export function LayoutGrid({ scope, items, className, fallback, tail, frame }: { scope: string; items: LayItem[]; className: string; fallback: (mark: (item: LayItem) => JSX.Element) => ComponentChildren; tail?: ComponentChildren; /** what stands around the arranged grid (a page's own head and container) */ frame?: (grid: JSX.Element) => JSX.Element }) {
  const c = useLayout();
  const mark = (it: LayItem) => c?.available ? <><i hidden {...{ [MARK]: it.key, ...(it.block ? { [BLOCK]: '' } : {}) }} />{it.node}</> : <>{it.node}</>;
  const saved = c?.profile?.scopes[scope];
  const editing = c?.draft?.scope === scope;
  if (!c || (!saved && !editing)) return <div className="at-lay-scope" data-lay-scope={scope}>{fallback(mark)}</div>;
  const grid = <Arranged c={c} scope={scope} items={items} className={className} saved={saved} editing={editing} tail={tail} />;
  return frame ? frame(grid) : grid;
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
  const isBlock = (key: string) => !!byKey.get(key)?.block;
  const cols = m?.cols ?? 4, natural = (key: string): Span => c.draft?.natural[key] ?? byKey.get(key)?.span ?? (isBlock(key) ? { w: BLOCK_FULL, h: 1 } : { w: 1, h: 1 });
  const keys = items.map(i => i.key);
  // the widths as saved (up to MAX_SPAN): a phone on its side draws them narrower, never saves them narrower
  const shown = arrange(keys, saved, natural, MAX_SPAN);
  const draft = editing ? c.draft!.list : null;
  useEffect(() => { if (editing && !draft) c.setList(shown); }, [editing, !!draft]);
  // a card that left the screen while arranging (a sensor went away) leaves the draft too; a new one joins it at its place
  const list = editing && draft ? arrange(keys, draft.map(x => [x.key, x.w, x.h] as [string, number, number]), natural, MAX_SPAN) : shown;
  // drawn within the columns and never below the card's own minimum (a layout saved before the card had one keeps what is saved; only the drawing grows)
  const minOf0 = (key: string) => byKey.get(key)?.min ?? { w: 1, h: 1 };
  // a block is never narrower than a report can be read at (about 280 px): on a phone that is the whole row
  const blockMin = m ? Math.min(cols, Math.max(1, Math.ceil((280 + m.gap) / (m.cell + m.gap)))) : 1;
  const wOf = (p: Placed) => isBlock(p.key) ? Math.max(blockMin, blockCols(p.w, cols)) : Math.min(cols, Math.max(p.w, minOf0(p.key).w));
  const hOf = (p: Placed) => isBlock(p.key) ? 1 : Math.max(p.h, minOf0(p.key).h);
  // a block's width is kept in eighths of the row: the size asked for in columns becomes the eighths that draw it
  const sized = (p: Placed, s: Span) => isBlock(p.key) ? resize(list, p.key, { w: blockFor(Math.max(blockMin, s.w), cols), h: 1 }, BLOCK_FULL) : resize(list, p.key, s, cols, minOf(p.key));
  const sizeWord = (p: Placed) => isBlock(p.key) ? lk(t, 'sizeBlock', { w: wOf(p), n: cols }) : lk(t, 'size', { w: wOf(p), h: hOf(p) });
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
  const update = (next: Placed[], key?: string) => {
    if (next === list) return; snapshot(); c.setList(next);
    if (key) { const i = next.findIndex(x => x.key === key), x = next[i]; if (x) c.say(`${labelOf(key, i)}: ${i + 1} / ${next.length}, ${sizeWord(x)}`); }
  };
  const minOf = (key: string) => byKey.get(key)?.min ?? { w: 1, h: 1 };
  // ---- drag to move (a mouse at once; a finger after holding still, so the page still scrolls under a passing thumb) ----
  const drag = useRef<{ key: string; id: number; x: number; y: number; ox: number; oy: number; armed: boolean; timer: ReturnType<typeof setTimeout> | null; moved: boolean; last: number; el: HTMLElement } | null>(null);
  const place = (d: NonNullable<typeof drag.current>, x: number, y: number) => {
    const el = d.el; el.style.transform = ''; const r = el.getBoundingClientRect();
    el.style.transform = `translate(${x - d.ox - r.left}px,${y - d.oy - r.top}px) scale(1.03)`;
  };
  useLayoutEffect(() => { const d = drag.current; if (d?.armed) { const s = grid.current?.querySelector<HTMLElement>(`.at-slot[data-lay="${CSS.escape(d.key)}"]`); if (s) { d.el = s; s.classList.add('is-dragging'); } } });
  useEffect(() => () => { const d = drag.current; if (d?.timer) clearTimeout(d.timer); drag.current = null; }, []);
  useEffect(() => {
    // while a card is held the page must not scroll under it: a touchmove that is not passive is the one way to say so on a phone
    const stop = (e: TouchEvent) => { if (drag.current?.armed) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false }); return () => document.removeEventListener('touchmove', stop);
  }, []);
  const arm = (d: NonNullable<typeof drag.current>) => { d.armed = true; d.el.classList.add('is-dragging'); setPicked(null); try { navigator.vibrate?.(12); } catch { /* not a phone */ } };
  const down = (key: string) => (e: PointerEvent) => {
    if (e.button !== 0 || drag.current) return; /* a second finger does not take the card from the first */ const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('.at-slot')!; const r = el.getBoundingClientRect();
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
    d.el.style.pointerEvents = 'none'; const over = rootOf(grid.current).elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.at-slot'); d.el.style.pointerEvents = '';
    const target = over?.dataset.lay; if (target && target !== d.key && grid.current?.contains(over!)) { d.last = now; update(moveTo(list, d.key, target)); }
  };
  const up = (key: string) => (e: PointerEvent) => {
    const d = drag.current; if (!d || e.pointerId !== d.id) return; if (d.timer) clearTimeout(d.timer); drag.current = null;
    if (d.armed) { d.el.classList.remove('is-dragging'); const from = d.el.getBoundingClientRect(); d.el.style.transform = ''; const to = d.el.getBoundingClientRect(); if (!reduced()) d.el.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
    else if (!d.moved && e.type === 'pointerup') setPicked(p => p === key ? null : key);
  };
  // ---- the corner: pull for the size, in whole cells ----
  const rs = useRef<{ key: string; id: number; x: number; y: number; w: number; h: number } | null>(null);
  const rsDown = (p: Placed) => (e: PointerEvent) => { e.stopPropagation(); if (e.button !== 0) return; rs.current = { key: p.key, id: e.pointerId, x: e.clientX, y: e.clientY, w: wOf(p), h: hOf(p) }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const rsMove = (e: PointerEvent) => { const r = rs.current; if (!r || r.id !== e.pointerId || !m) return; e.preventDefault(); const step = m.cell + m.gap, p = list.find(x => x.key === r.key); if (p) update(sized(p, { w: r.w + (e.clientX - r.x) / step, h: r.h + (e.clientY - r.y) / step })); };
  const rsUp = (e: PointerEvent) => { if (rs.current?.id === e.pointerId) rs.current = null; };
  // ---- keys: arrows move, Shift + arrows size; Escape lets go of the card ----
  const keyOf = (p: Placed) => (e: KeyboardEvent) => {
    const block = isBlock(p.key), step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: block ? -1 : -cols, ArrowDown: block ? 1 : cols }[e.key];
    if (e.key === 'Escape') { setPicked(null); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(x => x === p.key ? null : p.key); return; }
    if (step === undefined) return; e.preventDefault();
    if (e.shiftKey) update(sized(p, { w: wOf(p) + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0), h: hOf(p) + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0) }), p.key);
    else update(moveBy(list, p.key, step), p.key);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`.at-slot[data-lay="${CSS.escape(p.key)}"] .at-slot-veil`)?.focus());
  };
  const labelOf = (key: string, i: number) => byKey.get(key)?.label || grid.current?.querySelector(`.at-slot[data-lay="${CSS.escape(key)}"] :is(strong,h2,h3)`)?.textContent?.trim() || lk(t, 'card', { n: i + 1 });
  const style = m ? `--lay-cell:${m.cell}px` : undefined;
  const host = editing ? rootOf(grid.current).querySelector<HTMLElement>('.at-lay-bar .at-lay-tools-host') : null;
  return <div ref={grid} className={`ah-cascade ${className} at-lay ${editing ? 'is-arranging' : ''}`} style={style} data-scope={scope}>
    {list.map((p, i) => { const it = byKey.get(p.key)!; const sel = picked === p.key; const min = minOf(p.key), block = !!it.block;
      return <div key={p.key} className={`at-slot ${block ? 'is-block' : ''} ${sel ? 'is-picked' : ''}`} data-lay={p.key} data-w={wOf(p)} data-h={block ? undefined : hOf(p)} data-size={block ? undefined : sizeClass(wOf(p), hOf(p))} style={block ? (wOf(p) >= cols ? 'grid-column:1/-1' : `grid-column:span ${wOf(p)}`) : `grid-column:span ${wOf(p)};grid-row:span ${hOf(p)};--h:${hOf(p)}`}>
        {block ? (editing ? <div className="at-slot-body" inert>{it.node}</div> : it.node) : <SlotSizeCtx.Provider value={{ w: wOf(p), h: hOf(p), size: sizeClass(wOf(p), hOf(p)) }}>{editing ? <div className="at-slot-body" inert>{it.node}</div> : it.node}</SlotSizeCtx.Provider>}
        {editing && <>
          <div className="at-slot-veil" role="button" tabIndex={0} aria-roledescription={lk(t, 'bar')} aria-pressed={sel} aria-label={block ? `${labelOf(p.key, i)}, ${sizeWord(p)}` : lk(t, 'cardLabel', { name: labelOf(p.key, i), w: wOf(p), h: hOf(p) })}
            onPointerDown={down(p.key)} onPointerMove={move} onPointerUp={up(p.key)} onPointerCancel={up(p.key)} onKeyDown={keyOf(p)} onContextMenu={e => e.preventDefault()} />
          <span className="at-slot-size" aria-hidden="true">{block ? labelOf(p.key, i) : lk(t, 'size', { w: wOf(p), h: hOf(p) })}</span>
          <button type="button" className="at-slot-grip" aria-label={lk(t, 'grip')} tabIndex={-1} onPointerDown={rsDown(p)} onPointerMove={rsMove} onPointerUp={rsUp} onPointerCancel={rsUp}><i /></button>
          {sel && host && createPortal(<div className="at-slot-tools" role="group" aria-label={labelOf(p.key, i)}>
            <button type="button" aria-label={lk(t, 'moveBack')} disabled={i === 0} onClick={() => update(moveBy(list, p.key, -1), p.key)}><Icon name="back" size={18} /></button>
            <button type="button" aria-label={lk(t, 'moveFwd')} disabled={i === list.length - 1} onClick={() => update(moveBy(list, p.key, 1), p.key)}><Icon name="next" size={18} /></button>
            <span className="at-slot-tools-sep" />
            <button type="button" aria-label={lk(t, 'narrower')} disabled={wOf(p) <= (block ? blockMin : min.w)} onClick={() => update(sized(p, { w: wOf(p) - 1, h: hOf(p) }), p.key)}>↔−</button>
            <button type="button" aria-label={lk(t, 'wider')} disabled={wOf(p) >= (block ? cols : Math.min(cols, MAX_SPAN))} onClick={() => update(sized(p, { w: wOf(p) + 1, h: hOf(p) }), p.key)}>↔+</button>
            {!block && <><button type="button" aria-label={lk(t, 'lower')} disabled={hOf(p) <= min.h} onClick={() => update(resize(list, p.key, { w: wOf(p), h: hOf(p) - 1 }, cols, min), p.key)}>↕−</button>
            <button type="button" aria-label={lk(t, 'taller')} disabled={hOf(p) >= MAX_SPAN} onClick={() => update(resize(list, p.key, { w: wOf(p), h: hOf(p) + 1 }, cols, min), p.key)}>↕+</button></>}
          <span className="at-slot-tools-name">{labelOf(p.key, i)} · {sizeWord(p)}</span></div>, host)}
        </>}
      </div>; })}
    {tail}
  </div>;
}
function scroller(el: Element | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; }
  return document.scrollingElement as HTMLElement | null;
}
