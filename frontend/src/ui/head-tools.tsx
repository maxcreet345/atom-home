import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Registry } from '../model/registry.ts';
import { people, summaryOf, type Person } from '../model/people.ts';
import type { HouseConfig, Language } from '../model/config.ts';
import type { Key, T } from '../i18n/index.ts';
import { locales } from './format.ts';
import { Icon } from './primitives.tsx';
/** The home page's header tools (owner, 09.11.2026): who is home, the dashboard's language, the settings. */
const where = (p: Person, t: T) => p.state === 'home' ? t('people.home') : p.state === 'away' ? t('people.away') : p.state === 'zone' ? p.zone! : t('people.unknown');
function since(p: Person, t: T, lang: Language, now: number): string {
  if (p.since === null || p.state === 'unknown') return '';
  const d = new Date(p.since), today = new Date(now); today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString(locales[lang], { hour: '2-digit', minute: '2-digit' });
  if (p.since >= today.getTime()) return t('people.since', { t: time });
  if (p.since >= today.getTime() - 86400000) return t('people.sinceYesterday', { t: time });
  return t('people.since', { t: d.toLocaleDateString(locales[lang], { day: 'numeric', month: 'long' }) });
}
/** Keyed by person and picture where it is used: a photo that failed stays with its person, and a new picture gets a new try. */
function Avatar({ p, size = 36 }: { p: Person; size?: number }) {
  const [broken, setBroken] = useState(false);
  return <span className={`at-person-ava is-${p.state}`} style={`--s:${size}px`} aria-hidden="true">{p.picture && !broken ? <img src={p.picture} alt="" onError={() => setBroken(true)} /> : <b>{p.initials}</b>}<i /></span>;
}
type MenuId = 'people' | 'lang';
/** Swallows the click that ends the current tap; the next tap cancels it, so a tap that turned into a drag never eats a later click. */
function swallowClick() {
  const eat = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); done(); }, done = () => { document.removeEventListener('click', eat, true); document.removeEventListener('pointerdown', done, true); };
  document.addEventListener('click', eat, true); document.addEventListener('pointerdown', done, true);
}
/** One of the two menus: only one is open at a time. It closes on a tap outside, on Escape, when focus leaves it and when a sheet takes the screen; Escape gives focus back to its button. */
function useMenu(id: MenuId, current: MenuId | null, set: (f: (c: MenuId | null) => MenuId | null) => void) {
  const open = current === id, box = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  const setOpen = (v: boolean) => set(c => v ? id : c === id ? null : c);
  // registered with the menu itself (layout effect): an Escape pressed the moment it shows still closes it. On `document` with the event's path,
  // so a tap on HA's own toolbar or sidebar (outside the panel's shadow root) closes it too; a tap on the catcher is the catcher's own (its click closes).
  // The panel's tab bar and sidebar sit above the catcher (it lives inside the page's layer): a tap there only closes the menu, its click is swallowed.
  useLayoutEffect(() => { if (!open) return; const down = (e: PointerEvent) => { const path = e.composedPath(); if (box.current && !path.includes(box.current) && !path.some(n => (n as Element).classList?.contains('at-menu-scrim'))) { if (path.some(n => (n as Element).classList?.contains('hm-tabbar') || (n as Element).classList?.contains('hm-sidebar'))) swallowClick(); setOpen(false); } };
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || box.current?.closest('[inert]')) return; e.stopImmediatePropagation(); e.preventDefault(); setOpen(false); btn.current?.focus(); };
    document.addEventListener('pointerdown', down, true); addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); }; }, [open]);
  // a menu stays on the screen: on a narrow phone the pill sits at the left edge and a right-aligned menu would start off it. Measured before the
  // first paint and without the opening animation, whose scale would shift the box by a few pixels.
  // Below the header there may be little room (a phone on its side): the menu then ends 12 px above the bottom and scrolls inside itself.
  useLayoutEffect(() => { if (!open) return; const menu = box.current?.querySelector<HTMLElement>('.at-menu'); if (!menu) return; menu.style.setProperty('--dx', '0px'); menu.style.animation = 'none'; menu.style.maxHeight = '';
    const r = menu.getBoundingClientRect(), w = document.documentElement.clientWidth, dx = r.left < 12 ? 12 - r.left : r.right > w - 12 ? w - 12 - r.right : 0; menu.style.animation = ''; menu.style.setProperty('--dx', `${dx}px`);
    if (r.bottom > innerHeight - 12) menu.style.maxHeight = `${Math.max(96, innerHeight - r.top - 12)}px`; }, [open]);
  /** Focus moving to something outside closes it (Tab past the list); focus going nowhere, or to a box that holds the menu (a tap on plain text in the list hands it to the page), does not. */
  const onFocusOut = (e: FocusEvent) => { const to = e.relatedTarget as Node | null; if (to && box.current && !box.current.contains(to) && !to.contains(box.current)) setOpen(false); };
  return { open, setOpen, box, btn, onFocusOut };
}
export function HeadTools({ registry, config, t, lang, now, admin, wide, blocked, onLanguage, onSettings }: { registry: Pick<Registry, 'states' | 'entities'>; config: HouseConfig; t: T; lang: Language; now: number; admin: boolean; wide: boolean; blocked: boolean; onLanguage: (l: Language) => void; onSettings: () => void }) {
  const [menu, setMenu] = useState<MenuId | null>(null), who = useMenu('people', menu, setMenu), langs = useMenu('lang', menu, setMenu), uid = useId();
  useEffect(() => { if (blocked) setMenu(null); }, [blocked]); // a sheet or a confirmation opened over the page: its Escape, not ours
  const list = people(registry, config), sum = summaryOf(list), chips = wide && list.length <= 4;
  const summary = sum ? (sum.key === 'count' ? t('people.count', { n: sum.n }) : t(`people.${sum.key}` as Key)) : '';
  // the accessible name starts with what the button shows (WCAG 2.5.3), then says where everyone is
  const shown = chips ? list.map(p => `${p.first} ${where(p, t)}`).join(', ') : summary, label = list.map(p => `${p.name}: ${where(p, t)}`).join(', ');
  return <div className="at-head-tools">
    {menu && <div className="at-menu-scrim" aria-hidden="true" onClick={() => setMenu(null)} />}
    {list.length > 0 && <div className="at-people" ref={who.box} onFocusOut={who.onFocusOut}>
      <button type="button" ref={who.btn} className="at-people-btn" aria-expanded={who.open} aria-controls={who.open ? `${uid}-people` : undefined} aria-label={`${shown}. ${t('people.title')}: ${label}`} onClick={() => who.setOpen(!who.open)}>
        {chips ? list.map(p => <span className="at-person-chip" key={p.id}><Avatar key={`${p.id}|${p.picture}`} p={p} size={32} /><span><b>{p.first}</b><small>{where(p, t)}</small></span></span>)
          : <><span className="at-people-stack">{list.slice(0, 4).map(p => <Avatar key={`${p.id}|${p.picture}`} p={p} size={30} />)}</span><span className="at-people-sum">{summary}</span></>}
      </button>
      {who.open && <div className="at-menu at-people-menu" id={`${uid}-people`}>
        <strong className="at-menu-title">{t('people.title')}</strong>
        {list.map(p => <div className="at-person-row" key={p.id}><Avatar key={`${p.id}|${p.picture}`} p={p} size={40} /><span><b>{p.name}</b><small>{where(p, t)}{since(p, t, lang, now) ? ` · ${since(p, t, lang, now)}` : ''}</small></span></div>)}
      </div>}
    </div>}
    {admin && <div className="at-head-pill">
      <div className="at-lang" ref={langs.box} onFocusOut={langs.onFocusOut}>
        <button type="button" ref={langs.btn} className="at-pill-btn" aria-expanded={langs.open} aria-controls={langs.open ? `${uid}-lang` : undefined} aria-label={`${lang.toUpperCase()}, ${t('setup.language')}: ${LANGS[lang]}`} onClick={() => langs.setOpen(!langs.open)}><Icon name="globe" size={18} /><b>{lang.toUpperCase()}</b><Icon name="chevronDown" size={14} /></button>
        {langs.open && <div className="at-menu at-lang-menu" id={`${uid}-lang`}>{(Object.keys(LANGS) as Language[]).map(l => <button type="button" key={l} aria-pressed={l === lang} className={l === lang ? 'is-active' : ''} onClick={() => { langs.setOpen(false); langs.btn.current?.focus(); if (l !== lang) onLanguage(l); }}><b>{l.toUpperCase()}</b><span lang={l}>{LANGS[l]}</span>{l === lang && <Icon name="check" size={16} />}</button>)}</div>}
      </div>
      <span className="at-pill-sep" aria-hidden="true" />
      <button type="button" className="at-pill-btn is-icon" aria-label={t('section.settings')} onClick={onSettings}><Icon name="gear" size={20} /></button>
    </div>}
  </div>;
}
/** Each language under its own name, so it is found whatever the panel speaks now. */
const LANGS: Record<Language, string> = { ru: 'Русский', ro: 'Română', en: 'English' };
