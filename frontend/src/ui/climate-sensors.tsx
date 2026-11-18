import type { ClimateReading, ClimateSensors } from '../model/climate-sensors.ts';
import type { T } from '../i18n/index.ts';
import { num, type Lang } from './format.ts';

/** «Датчики температуры» under the heating on «Климат» (owner, 18.11.2026): the street, then every room — plain readings, no card of their own
 *  (sensors are auxiliary: atom-home-cards-vs-sensors). A sensor that stopped answering says so instead of a stale number. */
function Reading({ r, street, t, lang }: { r: ClimateReading; street: boolean; t: T; lang: Lang }) {
  const temp = r.temp === null ? '—' : num(r.temp, lang).replace('-', '−');
  return <div className={`at-cs-tile ${street ? 'is-street' : ''} ${r.online ? '' : 'is-off'}`} role="group" aria-label={`${street ? `${t('cs.street')} · ` : ''}${r.name}: ${r.online ? `${temp}°${r.hum !== null ? `, ${num(r.hum, lang, 0)} %` : ''}` : t('cs.offline')}`}>
    {street ? <small className="at-cs-name is-street"><b>{t('cs.street')}</b><span>{r.name}</span></small> : <small className="at-cs-name">{r.name}</small>}
    {r.online ? <>
      <strong className="at-cs-temp">{temp}<i>°</i></strong>
      <span className="at-cs-hum">{r.hum !== null ? <><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1.2C4.4 3.4 2.6 5.5 2.6 7.4a3.4 3.4 0 0 0 6.8 0C9.4 5.5 7.6 3.4 6 1.2z" fill="currentColor" /></svg>{num(r.hum, lang, 0)}&nbsp;%</> : ' '}</span>
    </> : <span className="at-cs-off">{t('cs.offline')}</span>}
  </div>;
}

export function ClimateSensorsBlock({ s, t, lang }: { s: ClimateSensors; t: T; lang: Lang }) {
  if (!s.outdoor.length && !s.rooms.length) return null;
  return <section className="at-heat-sec at-cs" aria-label={t('cs.title')}>
    <div className="hm-section-head"><h2>{t('cs.title')}</h2><small className="at-heat-sec-hint">{t('cs.hint')}</small></div>
    <div className="at-cs-grid">
      {s.outdoor.map(r => <Reading r={r} street t={t} lang={lang} />)}
      {s.rooms.map(r => <Reading r={r} street={false} t={t} lang={lang} />)}
    </div>
  </section>;
}
