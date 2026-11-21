/* The scale's sheet (scale.profiles.ts), after Zepp Life's body composition screen, in the panel's quiet style: the last weighing first (who and
 * when; the weight itself behind «Показать»), then the family — each person folded to a name and a date until tapped: weight with its trend,
 * the ideal weight, BMI on its scale, and Bodymiscale's other figures. Nothing here sends a command: a scale has none. */
import { useState } from 'preact/hooks';
import type { ApplianceSheetProps, ApplianceUi } from './types.ts';
import { readScale, whenText, dayText, kgText, bmiBand, type Person } from './scale.profiles.ts';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import { Icon } from '../ui/primitives.tsx';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';

const sk = (t: T, k: string, p?: Record<string, string | number>) => t(`scale.${k}` as Key, p);
const signed = (v: number, lang: Lang) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v), lang, 1)}`;

/** The person's weighings as a quiet line (Zepp Life's trend), with the first and last figure. Two weighings at least. */
function Trend({ p, t, lang }: { p: Person; t: T; lang: Lang }) {
  const h = p.history.slice(-30); if (h.length < 2) return null;
  const min = Math.min(...h.map(x => x.kg)), max = Math.max(...h.map(x => x.kg)), span = Math.max(0.5, max - min), x0 = h[0].at, xs = Math.max(1, h[h.length - 1].at - x0);
  const pts = h.map(x => `${(4 + ((x.at - x0) / xs) * 192).toFixed(1)},${(6 + (1 - (x.kg - min) / span) * 40).toFixed(1)}`).join(' ');
  const diff = h[h.length - 1].kg - h[0].kg;
  return <figure className="at-sc-trend" aria-label={sk(t, 'trendAria', { n: h.length, d: signed(diff, lang) })}>
    <svg viewBox="0 0 200 52" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} /></svg>
    <figcaption><span>{dayText(h[0].at, t, lang)} · {kgText(h[0].kg, lang, t)}</span><span>{sk(t, 'change', { d: signed(diff, lang) })}</span></figcaption>
  </figure>;
}
/** BMI on its four bands; the marker is the only strong mark, the bands stay quiet («Тихий дом»). */
function Bmi({ v, t, lang }: { v: number; t: T; lang: Lang }) {
  const pos = Math.max(0, Math.min(1, (v - 15) / 20)), band = bmiBand(v);
  return <div className="at-sc-bmi"><div className="at-sc-fact-row"><small>{sk(t, 'bmi')}</small><b>{num(v, lang, 1)}</b><span className={`at-sc-band is-${band}`}>{sk(t, `band.${band}`)}</span></div>
    <span className="at-sc-bmi-bar" aria-hidden="true"><i className="is-under" /><i className="is-normal" /><i className="is-over" /><i className="is-obese" /><b style={{ left: `${(pos * 100).toFixed(1)}%` }} /></span>
    <span className="at-sc-bmi-marks" aria-hidden="true"><span>18,5</span><span>25</span><span>30</span></span></div>;
}
function PersonRow({ p, open, onToggle, t, lang }: { p: Person; open: boolean; onToggle: () => void; t: T; lang: Lang }) {
  const prev = p.history.length >= 2 ? p.history[p.history.length - 2].kg : null;
  return <div className={`at-sc-person ${open ? 'is-open' : ''}`} data-person={p.id}>
    <button type="button" className="at-sc-person-hit" aria-expanded={open} onClick={onToggle}>
      <span className="at-sc-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
      <span className="at-sc-person-text"><b>{p.name}</b><small>{p.at === null ? sk(t, 'never') : sk(t, 'lastShort', { when: dayText(p.at, t, lang) })}</small></span>
      <span className="at-sc-chev" aria-hidden="true">›</span></button>
    {open && <div className="at-sc-person-body">
      {p.weight === null ? <p className="at-sc-note">{sk(t, 'noData')}</p> : <>
        <div className="at-sc-weight"><b>{num(p.weight, lang, 1)}</b><i>{t('ep.unit.kg' as Key)}</i>{prev !== null && p.weight !== null && <small>{sk(t, 'sincePrev', { d: signed(p.weight - prev, lang) })}</small>}</div>
        {p.at !== null && <small className="at-sc-when">{whenText(p.at, t, lang)}</small>}
        <Trend p={p} t={t} lang={lang} />
        {p.ideal !== null && <div className="at-sc-fact-row"><small>{sk(t, 'ideal')}</small><b>{kgText(p.ideal, lang, t)}</b></div>}
        {p.bmi !== null && <Bmi v={p.bmi} t={t} lang={lang} />}
        {p.facts.length > 0 && <div className="at-sc-facts">{p.facts.map(f => <div className="at-sc-fact" data-fact={f.key}><small>{sk(t, `fact.${f.key}`)}</small><b>{typeof f.value === 'number' ? num(f.value, lang, f.key === 'basal' ? 0 : 1) : f.value}{f.unit && <i>{f.unit === 'kcal' ? sk(t, 'kcal') : f.unit}</i>}</b></div>)}</div>}
      </>}
    </div>}
  </div>;
}
function ScaleGlyph() { return <svg viewBox="0 0 40 40" className="at-sc-glyph" aria-hidden="true"><rect x="4" y="4" width="32" height="32" rx="9" /><rect x="14" y="10" width="12" height="5" rx="2.5" className="is-screen" /></svg>; }

export function ScaleSheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const s = readScale(registry, view.instance.bindings), photo = usePhoto(view.instance.bindings.weight);
  const [open, setOpen] = useState<string | null>(null), [shown, setShown] = useState(false); // folded every time the sheet opens
  const offline = host.online === false, last = s.last;
  const hero = <section className="at-sc-hero" aria-label={sk(t, 'last')}>
    <small>{sk(t, 'last')}</small>
    {last ? <>
      <p className="at-sc-who"><b>{last.name}</b><span>{whenText(last.at!, t, lang)}</span></p>
      {shown ? <p className="at-sc-big" data-weight="shown"><b>{num(last.weight, lang, 1)}</b><i>{t('ep.unit.kg' as Key)}</i></p>
        : <button type="button" className="hm-pill at-sc-reveal" data-action="reveal" onClick={() => setShown(true)}>{sk(t, 'reveal')}</button>}
    </> : <p className="at-sc-empty">{sk(t, 'nobody')}</p>}
    {(!s.available || offline) && <p className="at-sc-note" role="status">{offline ? t('ui.offline') : sk(t, 'offline')}</p>}
  </section>;
  const people = <section className="at-kt-card at-sc-card" aria-label={sk(t, 'people')}><h3>{sk(t, 'people')}</h3>
    {s.persons.length ? s.persons.map(p => <PersonRow p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} t={t} lang={lang} />) : <p className="at-sc-note at-sc-pad">{sk(t, 'noPeople')}</p>}
    {s.persons.length > 0 && <p className="at-sc-note at-sc-pad">{sk(t, 'private')}</p>}
  </section>;
  return <div className={`at-kt-sheet at-sc-sheet ${wide ? 'is-wide' : ''}`} data-appliance="scale">
    <div className="hm-sheet-head at-kt-head at-sc-head"><span className="at-kt-face at-sc-face" aria-hidden="true"><ProductPhoto src={photo} eager><ScaleGlyph /></ProductPhoto></span>
      <div>{room && <small>{room}</small>}<h2>{view.device.name}</h2></div>
      <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}><Icon name="close" size={20} /></button></div>
    <div className="at-kt-cols"><div className="at-kt-col">{hero}</div><div className="at-kt-col">{people}</div></div>
  </div>;
}
export const ui: ApplianceUi = { id: 'scale', Sheet: ScaleSheet };
