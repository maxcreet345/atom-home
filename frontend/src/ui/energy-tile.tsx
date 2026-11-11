import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { HomeDevice } from '../model/discover.ts';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import { DASH, energyText, feedPower, feedToday, feedTotalIds, powerText } from '../model/energy.ts';
import { channels, feedNow, prefChannels } from '../model/energy-load.ts';
import { locales, numFixed, type Lang } from './format.ts';
import { dateFormat, houseDay, zoneOption } from '../runtime/zone.ts';
/** The owner's tile (08.11.2026): the house now, then today, then this month, rolling over every few seconds and round again.
 * Silent feed: «нет связи» and nothing rolls. A pointer or keyboard focus on it holds the figure still; with reduced motion it never rolls. */
const EVERY = 4000, MONTH_EVERY = 10 * 60000;
export function EnergyTile({ devices, boilers, host, t, lang, onClick, grid }: { devices: HomeDevice[]; boilers: Set<string>; host: Host; t: T; lang: Lang; onClick?: () => void; /** HA's grid connections (isMains) */ grid?: ReadonlySet<string> }) {
  // «сейчас» is the panel's figure, by the same function over the same channels (visual QA 09.11.2026: the two were counted apart): the feed's
  // channels that HA's Energy settings name, the car's charger with them. A feed without counters has no panel: its power readings as before
  const chs = prefChannels(channels(devices, boilers, grid), grid?.size ? { energy_sources: [...grid].map(id => ({ type: 'grid', stat_energy_from: id })) } : null);
  const feed = chs.length ? feedNow(chs) : feedPower(devices, boilers, grid), today = feedToday(devices, grid), totals = feedTotalIds(devices, grid), key = totals.join(' ');
  const [month, setMonth] = useState<number | null>(null), [at, setAt] = useState(0), held = useRef(false);
  // the month every 10 minutes while shown; a screen that comes back (no read while hidden) reads at once when that is older or from another day
  // of the HOUSE (its month turns at its own midnight, wherever this browser is)
  useEffect(() => { let alive = true, at = 0; const load = () => { at = Date.now(); void host.energyMonth?.(totals).then(v => { if (alive) setMonth(v); }); }; load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, MONTH_EVERY);
    const back = () => { const n = Date.now(); if (!document.hidden && (n - at >= MONTH_EVERY || houseDay(at) !== houseDay(n))) load(); };
    document.addEventListener('visibilitychange', back); window.addEventListener('pageshow', back);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', back); window.removeEventListener('pageshow', back); }; }, [host, key]);
  const fmt = (v: number, digits: number) => Number.isFinite(v) ? numFixed(v, lang, digits) : DASH, offline = !feed || feed.watts === null, said = <X extends { unit: string }>(x: X): X => ({ ...x, unit: t(`ep.unit.${x.unit.toLowerCase()}` as Key) });
  const slides = offline ? [{ value: '—', unit: undefined as string | undefined, sub: t('overview.energy.offline') }] : [
    { ...said(powerText(feed.watts!, fmt)), sub: t('overview.energy.now') },
    ...(today !== null ? [{ ...said(energyText(today, fmt)), sub: t('overview.energy.today') }] : []),
    ...(month !== null ? [{ ...said(energyText(month, fmt)), sub: t('overview.energy.month', { m: dateFormat(locales[lang], { month: 'long', ...zoneOption() }).format(Date.now()) }) }] : []),
  ];
  // reduced motion: no rolling, the «сейчас» slide stands; the button's label still carries all three figures
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => { if (slides.length < 2 || still) return; const timer = setInterval(() => { if (!held.current && !document.hidden) setAt(n => n + 1); }, EVERY); return () => clearInterval(timer); }, [slides.length, still]);
  if (!feed) return null;
  const i = still ? 0 : at % slides.length, s = slides[i], label = slides.map(x => `${x.value}${x.unit ? ` ${x.unit}` : ''} ${x.sub}`).join(', ');
  const hold = (v: boolean) => () => { held.current = v; };
  return <div className={`ah-tile ah-value hm-card hm-status tone-muted at-energy-tile${offline ? ' is-offline' : ''}`} style={`--tile:${offline ? '#8e8e93' : '#30d158'}`} data-slide={i}>
    <button type="button" className="ah-tile-hit" onClick={onClick} disabled={!onClick} aria-label={`${t('overview.energy')}: ${label}`} onPointerEnter={hold(true)} onPointerLeave={hold(false)} onFocus={hold(true)} onBlur={hold(false)}>
      <span className="at-energy-head"><span className="ah-value-head"><Icon name="energy" size={18} /></span>{slides.length > 1 && !still && <span className="at-energy-dots" aria-hidden="true">{slides.map((_, n) => <i className={n === i ? 'is-on' : ''} />)}</span>}</span>
      <span className="at-energy-roll" key={at} aria-hidden="true"><span className="ah-value-num"><b>{s.value}</b>{s.unit && <i>{s.unit}</i>}</span><span className="ah-tile-text"><strong>{t('overview.energy')}</strong><small>{s.sub}</small></span></span>
    </button>
  </div>;
}
