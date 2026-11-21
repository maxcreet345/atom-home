/* The dashcam's sheet (dashcam.profiles.ts), after the 70mai app's car page, in the panel's quiet style: where the car is, its battery, the last
 * alarm, then the camera's link and parking surveillance as the integration reports them. Read-only: the integration has no command the card
 * could send (the monitor-upload switch is changed in the 70mai app, says its README). No map: the panel has none, a link opens one. */
import type { ApplianceSheetProps, ApplianceUi } from './types.ts';
import { readDashcam, alarmText, placeText, voltsText, type DashcamRead } from './dashcam.profiles.ts';
import { whenText } from './scale.profiles.ts';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import { Icon } from '../ui/primitives.tsx';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';

const dk = (t: T, k: string, p?: Record<string, string | number>) => t(`dashcam.${k}` as Key, p);
const coord = (v: number) => v.toFixed(5);
const yesNo = (v: boolean | null, t: T, yes: string, no: string) => v === null ? t('state.unknown') : dk(t, v ? yes : no);
/** a row of the «Связь» card: what it is, then the value */
const Row = ({ label, value, hint, k }: { label: string; value: string; hint?: string; k: string }) => <div className="ah-row hm-setting at-kt-row at-dc-row" data-row={k}><span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span><b className="at-dc-val">{value}</b></div>;

function Where({ d, t, lang }: { d: DashcamRead; t: T; lang: Lang }) {
  const p = d.place;
  return <section className="at-dc-hero" aria-label={dk(t, 'where')}>
    <small>{dk(t, 'where')}</small>
    {p ? <>
      <p className="at-dc-place"><Icon name={p.kind === 'home' ? 'home' : 'car'} size={22} /><b>{placeText(p, t)}</b></p>
      {p.lat !== null && p.lon !== null && <p className="at-dc-coords">{coord(p.lat)}, {coord(p.lon)}{p.accuracy ? ` · ${dk(t, 'accuracy', { m: num(p.accuracy, lang, 0) })}` : ''}</p>}
      {p.at !== null && <p className="at-dc-sub">{dk(t, 'seen', { when: whenText(p.at, t, lang) })}</p>}
      {p.lat !== null && p.lon !== null && <a className="hm-pill at-dc-map" href={`https://www.openstreetmap.org/?mlat=${coord(p.lat)}&mlon=${coord(p.lon)}#map=17/${coord(p.lat)}/${coord(p.lon)}`} target="_blank" rel="noopener noreferrer">{dk(t, 'openMap')}</a>}
    </> : <p className="at-dc-place"><b>{d.available ? t('state.unknown') : dk(t, 'noLink')}</b></p>}
  </section>;
}
export function DashcamSheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const b = view.instance.bindings, d = readDashcam(registry, b), photo = usePhoto(b.tracker);
  const offline = host.online === false;
  const parkingPic = b.parkingPhoto ? host.previewFrame?.(b.parkingPhoto) ?? d.parkingPhoto : null;
  const battery = b.voltage ? <section className={`at-kt-card at-dc-card at-dc-battery ${d.battery === 'low' ? 'is-warn' : ''}`} data-part="battery"><h3>{dk(t, 'battery')}</h3>
    <div className="at-dc-pad"><p className="at-dc-big"><b>{d.volts === null ? '—' : num(d.volts, lang, 1)}</b><i>{dk(t, 'v')}</i></p>
      <p className="at-dc-sub">{d.battery ? dk(t, `bat.${d.battery}`) : t('state.unavailable')}</p></div></section> : null;
  const alarm = b.alarm ? <section className={`at-kt-card at-dc-card at-dc-alarm ${d.alarm?.fresh && /collision|suspicious|alarm/.test(d.alarm.kind) ? 'is-alert' : ''}`} data-part="alarm"><h3>{dk(t, 'lastAlarm')}</h3>
    <div className="at-dc-pad">{d.alarm ? <><p className="at-dc-ev"><Icon name={d.alarm.kind === 'battery_protection' ? 'battery' : 'warning'} size={22} /><b>{alarmText(d.alarm.kind, t)}</b></p><p className="at-dc-sub">{whenText(d.alarm.at, t, lang)}</p>
      {d.alarm.picture && <img className="at-dc-pic" src={d.alarm.picture} alt={alarmText(d.alarm.kind, t)} loading="lazy" />}</> : <p className="at-dc-sub">{dk(t, 'noAlarms')}</p>}</div></section> : null;
  const link = <section className="at-kt-card at-dc-card" data-part="link"><h3>{dk(t, 'link')}</h3>
    {b.lastReport && <Row k="report" label={dk(t, 'lastReport')} value={d.lastReport === null ? '—' : whenText(d.lastReport, t, lang)} />}
    {b.network && <Row k="network" label={dk(t, 'network')} value={d.network === null ? '—' : dk(t, 'level', { n: num(d.network, lang, 0) })} />}
    {b.upload && <Row k="upload" label={dk(t, 'upload')} hint={dk(t, 'uploadHint')} value={yesNo(d.upload, t, 'on', 'off')} />}
    {b.simPower && <Row k="simPower" label={dk(t, 'simPower')} hint={dk(t, 'simPowerHint')} value={yesNo(d.simPower, t, 'yes', 'no')} />}
    {b.firmware && <Row k="firmware" label={dk(t, 'firmware')} value={d.firmware ?? '—'} />}
    <p className="at-dc-note">{dk(t, 'notExposed')}</p></section>;
  const park = parkingPic ? <section className="at-kt-card at-dc-card" data-part="parking"><h3>{dk(t, 'parkingPhoto')}</h3><div className="at-dc-pad"><img className="at-dc-pic" src={parkingPic} alt={dk(t, 'parkingPhoto')} loading="lazy" /></div></section> : null;
  return <div className={`at-kt-sheet at-dc-sheet ${wide ? 'is-wide' : ''}`} data-appliance="dashcam">
    <div className="hm-sheet-head at-kt-head"><span className="at-kt-face at-dc-face" aria-hidden="true"><ProductPhoto src={photo} eager><Icon name="car" size={26} /></ProductPhoto></span>
      <div>{room && <small>{room}</small>}<h2>{view.device.name}</h2></div>
      <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}><Icon name="close" size={20} /></button></div>
    {(offline || !d.available) && <p className="at-dc-warn" role="status">{offline ? t('ui.offline') : dk(t, 'noLink')}</p>}
    <div className="at-kt-cols"><div className="at-kt-col"><Where d={d} t={t} lang={lang} />{battery}</div><div className="at-kt-col">{alarm}{park}{link}</div></div>
  </div>;
}
export const ui: ApplianceUi = { id: 'dashcam', Sheet: DashcamSheet };
