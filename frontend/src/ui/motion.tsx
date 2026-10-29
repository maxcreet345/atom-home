import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
/** A value that «ticks»: when the text changes, the old one slides up and the new one slides in from below (260 ms, transform/opacity only). */
export function Tick({ value, className = '' }: { value: string; className?: string }) {
  const [shown, setShown] = useState(value), [prev, setPrev] = useState<string | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (value === shown) return; setPrev(shown); setShown(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setPrev(null), 280); return () => { if (timer.current) clearTimeout(timer.current); }; }, [value]);
  return <span className={`ah-tick ${className}`}>{prev !== null && <span className="ah-tick-out" aria-hidden="true">{prev}</span>}<span className={prev !== null ? 'ah-tick-in' : ''}>{shown}</span></span>;
}
/** Staggered entry: children get --i for the cascade delay (capped so a long list never waits). */
export function Cascade({ children, className = '', cap = 12, ...rest }: { children: ComponentChildren; className?: string; cap?: number; [k: string]: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; [...el.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(Math.min(i, cap)))); });
  return <div ref={ref} className={`ah-cascade ${className}`} {...rest}>{children}</div>;
}
