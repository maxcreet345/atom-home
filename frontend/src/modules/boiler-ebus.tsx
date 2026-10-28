import { useEffect, useState } from 'preact/hooks';
import type { ModuleDef } from './types.ts';
import { boilerEbusSpec } from './catalog.ts';
import { Icon } from '../ui/primitives.tsx';
import { num } from '../ui/format.ts';
/** Gas boiler on eBUS (ebusd): flow, return, hot water, pressure with the 1.0–1.5 bar norm, burner. Read-only. */
export const boilerEbus: ModuleDef = {
  ...boilerEbusSpec,
  Card({ registry, entities, host, t, lang, compact }) {
    const val = (role: string) => { const id = entities[role]; const s = id ? registry.states[id] : undefined; const v = s ? Number(s.state) : NaN; return Number.isFinite(v) ? v : null; };
    const flame = entities.flame ? registry.states[entities.flame]?.state : undefined, burning = flame === 'on';
    const pressure = val('pressure'), low = pressure !== null && pressure < 1, high = pressure !== null && pressure > 2.5;
    const [hist, setHist] = useState<Record<string, Array<[number, number]>>>({});
    useEffect(() => { let alive = true; const ids = ['flow', 'return', 'pressure'].map(r => entities[r]).filter((x): x is string => !!x); if (!ids.length || !host.history) return; host.history(ids, 24).then(d => { if (alive) setHist(d); }).catch(() => undefined); return () => { alive = false; }; }, [entities.flow, entities.pressure]);
    const tile = (role: string, label: string, unit: string, sub?: string, tone = '') => <div className={`at-boiler-tile ${tone}`}><small>{label}</small><strong>{val(role) === null ? '—' : num(val(role), lang, role === 'pressure' ? 2 : 1)} {unit}</strong>{sub && <span>{sub}</span>}<Spark points={hist[entities[role] ?? '']} band={role === 'pressure' ? [1, 1.5] : undefined} /></div>;
    if (compact) return <div className={`hm-card hm-status tone-${low || high ? 'warning' : 'calm'}`} role="status"><span className="hm-status-icon"><Icon name="flame" size={20} /></span><span className="hm-status-text"><small>{t('module.boiler.pressure')}</small><strong>{pressure === null ? '—' : `${num(pressure, lang, 2)} bar`}</strong><em>{low ? t('module.boiler.low') : high ? t('module.boiler.high') : t('module.boiler.norm')}</em></span></div>;
    return <section className="hm-card at-boiler">
      <div className="at-boiler-head"><span className={`hm-status-icon ${burning ? 'is-on' : ''}`}><Icon name="flame" size={22} /></span><div><strong>{t('module.boiler_ebus')}</strong><small>{burning ? t('module.boiler.burning') : flame === 'off' ? t('module.boiler.idle') : t('state.unknown')}</small></div><span className={`hm-badge ${low || high ? 'tone-warning' : 'tone-calm'}`}>{pressure === null ? '—' : `${num(pressure, lang, 2)} bar`}</span></div>
      <div className="at-boiler-grid">
        {tile('flow', t('module.boiler.flow'), '°C', val('flowSet') !== null ? `${t('ui.target')} ${num(val('flowSet'), lang, 0)}°` : undefined)}
        {entities.return && tile('return', t('module.boiler.return'), '°C', val('flow') !== null && val('return') !== null ? `Δ ${num(Math.abs(val('flow')! - val('return')!), lang, 1)}°` : undefined)}
        {entities.hwc && tile('hwc', t('module.boiler.hwc'), '°C', val('hwcSet') !== null ? `${t('ui.target')} ${num(val('hwcSet'), lang, 0)}°` : undefined)}
        {tile('pressure', t('module.boiler.pressure'), 'bar', low ? t('module.boiler.low') : high ? t('module.boiler.high') : t('module.boiler.norm'), low || high ? 'is-warning' : '')}
      </div>
    </section>;
  },
};
function Spark({ points, band }: { points?: Array<[number, number]>; band?: [number, number] }) {
  const H = 28;
  if (!points || points.length < 2) return <svg className="at-spark is-empty" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true"><path d={`M0 ${H - 2}H100`} /></svg>;
  const t0 = points[0][0], t1 = points[points.length - 1][0] || t0 + 1, vals = points.map(p => p[1]).concat(band ?? []);
  let min = Math.min(...vals), max = Math.max(...vals); if (max - min < 0.5) { min -= 0.25; max += 0.25; }
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 100, y = (v: number) => H - 3 - ((v - min) / (max - min)) * (H - 6);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(2)} ${y(p[1]).toFixed(2)}`).join('');
  return <svg className="at-spark" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">{band && <rect className="at-spark-band" x="0" width="100" y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} />}<path className="at-spark-area" d={`${line}L100 ${H}L0 ${H}Z`} /><path className="at-spark-line" d={line} {...{ 'vector-effect': 'non-scaling-stroke' }} /></svg>;
}
