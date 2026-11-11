import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from './primitives.tsx';
import { countdown } from '../model/security.ts';
/** What stands at the top of the panel over every page and every sheet (release «classic», 11.11.2026, ported from design 2026 phase 2):
 *  the house's alarm, a ring at the door, a module's notice (a timer, the alarm clock). One real column, in that order (it replaced three
 *  pills that were stacked by margins); it does not lie over the page — the page, the rail and an open sheet start under it (`--ah-banners-h`, set by the shell from
 *  this column's height), so the title and the clock are never covered and nothing is cut to «Будил…». What a takeover says is announced once
 *  by the shell's live region; a countdown is a `timer` outside it. Escape and «Назад» close sheets and questions, never an alarm. */
export function Banners({ children, onHeight }: { children: ComponentChildren; /** the column's height in the shell's own pixels (0 when empty) */ onHeight: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null), said = useRef(-1);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; const tell = () => { const h = el.childElementCount ? Math.ceil(el.offsetHeight) : 0; if (h !== said.current) { said.current = h; onHeight(h); } }; tell();
    if (typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(tell); ro.observe(el); return () => ro.disconnect(); });
  useEffect(() => () => onHeight(0), []);
  return <div className="ah-banners" ref={ref}>{children}</div>;
}
export interface TakeAct { label: string; onClick: () => void; /** its command is on its way: marked, a second press is ignored by the caller */ busy?: boolean; icon?: string }
/** A takeover: the alarm (danger) or the doorbell (info) as a card across the whole width, in the classic themes' colours (atom.css) — the glyph or the camera's frame, one sentence, ONE
 *  main action of 56 px and at most one quiet one. `left` is the entry delay's seconds (model/security.ts: delayClock). */
export function Takeover({ tone, kind, glyph, eyebrow, title, sub, left, frame, main, second, className = '' }: { tone: 'danger' | 'info'; kind: 'alarm' | 'ring'; glyph: string; eyebrow?: string; title: string; sub?: string; left?: (() => number | null) | null; frame?: ComponentChildren; main: TakeAct; second?: TakeAct; className?: string }) {
  const [, tick] = useState(0), counting = !!left;
  useEffect(() => { if (!counting) return; const i = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(i); }, [counting]);
  const now = left ? left() : null;
  return <section className={`ah-take tone-${tone} is-${kind} ${frame ? 'has-frame' : ''} ${className}`} role="group" aria-label={[eyebrow, title].filter(Boolean).join(': ')} data-take={kind}>
    {frame ? <div className="ah-take-frame" aria-hidden="true"><span className="hm-camera-frame">{frame}</span></div> : <div className="ah-take-glyph" aria-hidden="true"><Icon name={glyph} size={32} /></div>}
    <div className="ah-take-text">
      {eyebrow && <p className="ah-take-eyebrow">{eyebrow}</p>}
      <p className="ah-take-title">{title}{now !== null && <b role="timer" aria-live="off"> {countdown(now)}</b>}</p>
      {sub && <p className="ah-take-sub">{sub}</p>}
    </div>
    <div className="ah-take-acts">
      <button type="button" className="hm-pill ah-take-main is-main" aria-busy={main.busy || undefined} aria-disabled={main.busy || undefined} onClick={() => { if (!main.busy) main.onClick(); }}>{main.icon && <Icon name={main.icon} size={22} />}<span>{main.label}</span></button>
      {second && <button type="button" className="hm-pill ah-take-second" aria-busy={second.busy || undefined} aria-disabled={second.busy || undefined} onClick={() => { if (!second.busy) second.onClick(); }}>{second.icon && <Icon name={second.icon} size={20} />}<span>{second.label}</span></button>}
    </div>
  </section>;
}
/** A module's notice (a timer that ended, the alarm clock ringing): the whole width, its words whole on two lines if they need them, its
 *  buttons beside them or under them on a phone. Accent, not danger: nothing is wrong. Keeps the classes other checks find it by. */
export function NoticeBar({ icon, text, sub, acts }: { icon: string; text: string; sub?: string; acts: ComponentChildren }) {
  return <section className="ah-take is-notice at-door-ring at-house-banner" role="group" aria-label={text}>
    <div className="ah-take-glyph" aria-hidden="true"><Icon name={icon} size={24} /></div>
    <div className="ah-take-text"><p className="ah-take-title">{text}</p>{sub && <p className="ah-take-sub">{sub}</p>}</div>
    <div className="ah-take-acts">{acts}</div>
  </section>;
}
