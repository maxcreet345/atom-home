import { useEffect, useState } from 'preact/hooks';
import type { Registry } from '../model/registry.ts';
import { gasMeters, type GasMeter } from '../model/gas.ts';
import type { Host } from '../runtime/host.ts';
import { houseAt, houseDate, houseMonthStart } from '../runtime/zone.ts';
import type { T } from '../i18n/index.ts';
import { num, type Lang } from './format.ts';

/** «Газ» on «Энергия» (owner, 18.11.2026: «счётчик газа тоже должен быть»). The meter is any gas counter HA keeps statistics of (a sensor of
 *  class `gas` that only grows — in Criuleni the kitchen meter read by a camera every 5 minutes). Cubic metres stay apart from the kWh and lei
 *  above: the electricity report never adds them. Today and this month come from HA's statistics, the same numbers HA's Energy dashboard shows.
 *  Read-only. */
const unitWord = (u: string, t: T) => /^m³|m3$/i.test(u) ? t('gas.m3') : u;

function GasOne({ m, host, t, lang, now }: { m: GasMeter; host: Host; t: T; lang: Lang; now: number }) {
  const [use, setUse] = useState<{ day: number | null; month: number | null } | null>(null);
  // asked again when the reading moves and every 5 minutes (the camera reads the meter that often)
  const slot = Math.floor(now / 300000);
  useEffect(() => { let alive = true; if (!host.statistic) { setUse({ day: null, month: null }); return; }
    const at = Date.now(), d = houseDate(at), dayStart = houseAt(d.getFullYear(), d.getMonth(), d.getDate()), monthStart = houseMonthStart(at);
    const read = (from: number) => host.statistic!(m.id, from, at, ['change']).then(r => typeof r.change === 'number' ? Math.max(0, r.change) : null, () => null);
    Promise.all([read(dayStart), read(monthStart)]).then(([day, month]) => { if (alive) setUse({ day, month }); });
    return () => { alive = false; }; }, [host, m.id, m.value, slot]);
  const u = unitWord(m.unit, t), time = m.changed ? new Date(m.changed).toLocaleTimeString(lang === 'en' ? 'en-GB' : lang === 'ro' ? 'ro-RO' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }) : null;
  const amount = (v: number | null | undefined) => use === null ? '…' : v === null || v === undefined ? '—' : num(v, lang, 2);
  return <section className={`at-ep-card at-gas ${m.online ? '' : 'is-off'}`} aria-label={t('gas.title')}>
    <div className="at-gas-head"><span className="at-gas-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2.5c.6 3-1.6 4.6-3 6.6-1.3 1.8-2 3.4-2 5.2a5 5 0 0 0 10 0c0-2.6-1.4-4.3-2.6-5.6.1 1.6-.4 2.8-1.5 3.4.3-3.3-.5-6.6-.9-9.6z" fill="currentColor" /></svg></span>
      <div><h2>{t('gas.title')}</h2><small>{m.name}</small></div></div>
    <div className="at-gas-figs">
      <div className="at-gas-fig"><small>{t('gas.today')}</small><b>{amount(use?.day)}<i>{u}</i></b></div>
      <div className="at-gas-fig"><small>{t('gas.month')}</small><b>{amount(use?.month)}<i>{u}</i></b></div>
    </div>
    <div className="at-gas-meter"><span>{t('gas.reading')}</span><b>{m.value === null ? '—' : num(m.value, lang, 3)}<i>{u}</i></b></div>
    <p className="at-gas-note">{!m.online ? t('gas.offline') : time ? t('gas.changed', { time }) : ''}</p>
  </section>;
}

export function GasCard({ registry, host, t, lang, now }: { registry: Registry; host: Host; t: T; lang: Lang; now: number }) {
  const list = gasMeters(registry);
  if (!list.length) return null;
  return <div className="at-gas-list">{list.map(m => <GasOne key={m.id} m={m} host={host} t={t} lang={lang} now={now} />)}</div>;
}
