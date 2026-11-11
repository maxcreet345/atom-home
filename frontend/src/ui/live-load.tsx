/* Who draws the power right now (owner, 09.11.2026: «как в HA Энергия → Сейчас, список бегает по потреблению»):
 * one row per consumer, the bar against the biggest, the watts; when the watts change the rows travel to their new place (FLIP). */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { T } from '../i18n/index.ts';
import type { Lang } from './format.ts';
import { rk, fmt, watts } from './room-words.ts';

export interface LoadRow { key: string; name: string; /** the room, on the house's list */ sub?: string; watts: number; icon?: string; tint?: string }
const COLORS = ['#ff9f0a', '#ff6b35', '#30d158', '#0a84ff', '#bf5af2', '#32ade6', '#ffcc00', '#5e5ce6', '#64d2ff', '#8e8e93'];

export function LiveLoad({ rows, t, lang, title, today, limit = 99, className = '', level = 3 }: { rows: LoadRow[]; t: T; lang: Lang; title: string; today?: number | null; limit?: number; className?: string; /** the heading's level: 2 where the list stands right under the page's title */ level?: 2 | 3 }) {
  const list = [...rows].filter(r => Number.isFinite(r.watts)).sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name, 'ru'));
  const live = list.filter(r => r.watts >= 0.5), idle = list.filter(r => r.watts < 0.5), shown = live.slice(0, limit), more = live.length - shown.length;
  const total = list.reduce((s, r) => s + Math.max(0, r.watts), 0), max = Math.max(1, ...shown.map(r => r.watts));
  // a stable colour per consumer, whatever its place: the eye follows the colour when the row moves
  const color = (key: string) => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const box = useRef<HTMLOListElement>(null), last = useRef(new Map<string, number>()), lastW = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const ol = box.current; if (!ol) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, next = new Map<string, number>();
    for (const li of Array.from(ol.children) as HTMLElement[]) {
      const k = li.dataset.key!, top = li.offsetTop; next.set(k, top);
      const was = last.current.get(k);
      if (!still && was !== undefined && was !== top) { li.style.transition = 'none'; li.style.transform = `translateY(${was - top}px)`; void li.offsetHeight; li.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)'; li.style.transform = ''; }
      const w = Number(li.dataset.w), pw = lastW.current.get(k);
      if (!still && pw !== undefined && Math.abs(pw - w) >= 1) { li.classList.remove('is-up', 'is-down'); void li.offsetWidth; li.classList.add(w > pw ? 'is-up' : 'is-down'); }
      lastW.current.set(k, w);
    }
    last.current = next;
  });
  return <section className={`rm-card rm-live ${className}`} aria-label={title}>
    <div className="rm-live-head">{level === 2 ? <h2 className="rm-live-title">{title}</h2> : <h3 className="rm-live-title">{title}</h3>}<span className="rm-live-dot" aria-hidden="true" /><small>{rk(t, 'liveNow')}</small></div>
    <div className="rm-pw-head"><span><b>{watts(total, t, lang)}</b> {rk(t, 'now')}</span>{today != null && today > 0 && <small>{rk(t, 'today', { v: fmt(today, lang, today < 10 ? 2 : 1) })}</small>}</div>
    <ol ref={box} className="rm-live-list">{shown.map(r => <li key={r.key} data-key={r.key} data-w={r.watts} style={`--c:${r.tint ?? color(r.key)}`}>
      <span className="rm-live-ic">{r.icon ? <Icon name={r.icon} size={15} /> : <i />}</span>
      <span className="rm-live-name"><strong>{r.name}</strong>{r.sub && <small>{r.sub}</small>}</span>
      <span className="rm-live-bar"><i style={`width:${Math.max(2, r.watts / max * 100)}%`} /></span>
      <b className="rm-live-w">{watts(r.watts, t, lang)}</b>
    </li>)}</ol>
    {(more > 0 || idle.length > 0) && <p className="rm-live-rest">{[more > 0 ? rk(t, 'liveMore', { n: more }) : '', idle.length ? rk(t, 'liveIdle', { n: idle.length }) : ''].filter(Boolean).join(' · ')}</p>}
  </section>;
}
