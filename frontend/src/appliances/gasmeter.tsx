/* The gas meter's sheet (gasmeter.profiles.ts): the camera's still of the meter, the reading big with when it was last read, a plain warning
 * when the camera no longer reads it or the last answer was refused, then today and this month from HA's statistics (the gas card's own hook, the
 * same numbers «Энергия» shows). Read-only. */
import { useState } from 'preact/hooks';
import type { ApplianceSheetProps, ApplianceUi } from './types.ts';
import { readGasMeter, m3, type GasMeterRead } from './gasmeter.profiles.ts';
import { whenText } from './scale.profiles.ts';
import { useGasUse } from '../ui/gas-card.tsx';
import { Icon } from '../ui/primitives.tsx';
import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';
import type { Registry } from '../model/registry.ts';

const gk = (t: T, k: string, p?: Record<string, string | number>) => t(`gasmeter.${k}` as Key, p);
/** The camera's still: the preview's frame, else HA's own picture of the camera, asked anew every 5 minutes (the camera reads that often). */
function Still({ g, registry, host, t }: { g: GasMeterRead; registry: Registry; host: Host; t: T }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!g.camera) return null;
  const pic = registry.states[g.camera]?.attributes.entity_picture, slot = Math.floor(Date.now() / 300_000);
  const src = host.previewFrame?.(g.camera) ?? (g.cameraOnline && typeof pic === 'string' ? `${pic}${pic.includes('?') ? '&' : '?'}_=${slot}` : null);
  return <figure className="at-gm-still" data-part="still">
    {src && broken !== src ? <img src={src} alt={gk(t, 'stillAlt')} decoding="async" onError={() => setBroken(src)} />
      : <span className="at-gm-still-none"><Icon name="camera" size={30} /><span>{g.cameraOnline ? gk(t, 'noStill') : gk(t, 'cameraOff')}</span></span>}
  </figure>;
}
function Problem({ g, t, lang }: { g: GasMeterRead; t: T; lang: Lang }) {
  if (!g.problem) return null;
  const said = g.answer ? g.answer.replace(/^\?\s*/, '') : '';
  const head = g.problem === 'stale' ? (g.lastRead !== null ? gk(t, 'staleSince', { when: whenText(g.lastRead, t, lang) }) : gk(t, 'stale'))
    : g.problem === 'rejected' ? gk(t, 'rejected', { v: m3(g.answerValue, lang, t) }) : gk(t, 'unread');
  const why = g.unread && said ? gk(t, 'aiSaid', { s: said }) : g.problem === 'rejected' ? gk(t, 'rejectedWhy') : null;
  return <div className={`at-gm-problem is-${g.problem}`} role={g.problem === 'stale' ? 'alert' : 'status'} data-problem={g.problem}>
    <Icon name="warning" size={20} /><div><b>{head}</b>{why && <small>{why}</small>}{g.problem !== 'unread' && <small>{gk(t, 'checkHint')}</small>}</div></div>;
}
export function GasMeterSheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const b = view.instance.bindings, g = readGasMeter(registry, b), now = Date.now();
  const use = useGasUse(host, b.meter ?? '', g.value, now);
  const amount = (v: number | null | undefined) => use === null ? '…' : v === null || v === undefined ? '—' : num(v, lang, 2);
  const offline = host.online === false;
  const reading = <section className={`at-gm-hero ${g.available ? '' : 'is-off'}`} aria-label={t('gas.reading' as Key)}>
    <small>{t('gas.reading' as Key)}</small>
    <p className="at-gm-big"><b>{g.value === null ? '—' : num(g.value, lang, 3)}</b><i>{t('gas.m3' as Key)}</i></p>
    <p className="at-gm-sub">{!g.available ? t('gas.offline' as Key) : g.lastRead !== null ? gk(t, 'readAt', { when: whenText(g.lastRead, t, lang) }) : gk(t, 'readUnknown')}</p>
    <Problem g={g} t={t} lang={lang} />
  </section>;
  const figs = <section className="at-kt-card at-gm-card" data-part="use"><h3>{gk(t, 'use')}</h3><div className="at-gm-figs">
    <div className="at-gm-fig"><small>{t('gas.today' as Key)}</small><b>{amount(use?.day)}<i>{t('gas.m3' as Key)}</i></b></div>
    <div className="at-gm-fig"><small>{t('gas.month' as Key)}</small><b>{amount(use?.month)}<i>{t('gas.m3' as Key)}</i></b></div></div>
    <p className="at-gm-note">{gk(t, b.camera ? 'how' : 'howNoCamera')}</p></section>;
  return <div className={`at-kt-sheet at-gm-sheet ${wide ? 'is-wide' : ''}`} data-appliance="gasmeter">
    <div className="hm-sheet-head at-kt-head"><span className="at-kt-face at-gm-face" aria-hidden="true"><Icon name="flame" size={24} /></span>
      <div>{room && <small>{room}</small>}<h2>{view.instance.name ?? (view.profile.kindKey ? t(view.profile.kindKey as Key) : view.device.name)}</h2></div>
      <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}><Icon name="close" size={20} /></button></div>
    {offline && <p className="at-gm-warn" role="status">{t('ui.offline')}</p>}
    <div className="at-kt-cols"><div className="at-kt-col"><Still g={g} registry={registry} host={host} t={t} /></div><div className="at-kt-col">{reading}{figs}</div></div>
  </div>;
}
export const ui: ApplianceUi = { id: 'gasmeter', Sheet: GasMeterSheet };
