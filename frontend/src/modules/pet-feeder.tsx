import { useState } from 'preact/hooks';
import type { ModuleDef } from './types.ts';
import { petFeederSpec } from './catalog.ts';
import { Icon } from '../ui/primitives.tsx';
import { num } from '../ui/format.ts';
import { feedCall, nextMeal, optionInt, parseFeederSchedule, SCHEDULE_ATTR } from './feeder-protocol.ts';
/** Xiaomi MIOT pet feeder: bowl weight, stock, daily plan with the next meal, warnings; one confirmed dosed feed per press; plan on/off with confirmation. Schedule editing stays out of scope. */
export const petFeeder: ModuleDef = {
  ...petFeederSpec,
  Card({ registry, entities, options, host, t, lang, compact }) {
    const st = (role: string) => { const id = entities[role]; return id ? registry.states[id] : undefined; };
    const feed = st('feed'), available = !!feed && feed.state !== 'unavailable' && host.online;
    const bowlS = st('bowl'), bowl = bowlS && Number.isFinite(Number(bowlS.state)) ? Number(bowlS.state) : null;
    const stock = st('stock')?.state, low = stock === 'low';
    const planS = st('plan'), planOn = planS?.state === 'on';
    const schedule = parseFeederSchedule(st('info')?.attributes[SCHEDULE_ATTR]);
    const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const next = planOn && schedule ? nextMeal(schedule.meals, hhmm) : null;
    const desiccant = st('desiccant'), desiccantDue = !!desiccant && Number.isFinite(Number(desiccant.state)) && Number(desiccant.state) <= 0;
    const outAbnormal = st('outStatus')?.state === 'abnormal';
    const grams = optionInt(options.portionGrams, 10, 1, 200), max = optionInt(options.maxPortions, 15, 1, 50);
    const warnings = [low && t('module.feeder.stockLow'), desiccantDue && t('module.feeder.desiccantDue'), outAbnormal && t('module.feeder.outAbnormal')].filter((x): x is string => !!x);
    const tone = !available ? 'muted' : warnings.length ? 'warning' : 'calm';
    const [dose, setDose] = useState(1), [confirm, setConfirm] = useState<'feed' | 'plan' | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState('');
    const portions = (n: number) => t('module.feeder.portions', { n }), approx = (n: number) => t('module.feeder.approx', { g: n * grams });
    const run = async (call: { domain: string; service: string; data: Record<string, unknown> }) => {
      if (busy) return; setBusy(true); setNote('');
      try { await host.call(call.domain, call.service, call.data); setNote(t('module.feeder.sent')); }
      catch (e) { setNote(`${t('module.feeder.fail')}: ${e instanceof Error ? e.message : String(e)}`); }
      finally { setBusy(false); setConfirm(null); }
    };
    if (compact) return <div className={`hm-card hm-status tone-${tone}`} role="status" data-module-card="pet_feeder"><span className="hm-status-icon"><Icon name="paw" size={20} /></span><span className="hm-status-text"><small>{t('module.pet_feeder')}</small><strong>{bowl === null ? '—' : `${num(bowl, lang, 0)} g`}</strong><span>{warnings[0] ?? (planOn ? (next ? `${t('module.feeder.next')} ${next.time}` : t('module.feeder.planOn')) : t('module.feeder.planOff'))}</span></span></div>;
    return <section className="hm-card at-feeder" data-module-card="pet_feeder">
      <div className="at-feeder-head"><span className={`hm-status-icon ${available ? 'is-on' : ''}`}><Icon name="paw" size={22} /></span><div><strong>{t('module.pet_feeder')}</strong><small>{!available ? t('state.unavailable') : planOn ? t('module.feeder.planOn') : t('module.feeder.planOff')}</small></div>
        {planS && <button type="button" className={`hm-switch ${planOn ? 'is-on' : ''}`} role="switch" aria-checked={planOn} aria-label={t('module.feeder.plan')} disabled={busy || !available} onClick={() => setConfirm(confirm === 'plan' ? null : 'plan')}><span className="hm-switch-knob" /></button>}
      </div>
      {warnings.length > 0 && <div className="at-feeder-warn">{warnings.map(w => <span><Icon name="warning" size={14} />{w}</span>)}</div>}
      <div className="at-feeder-grid">
        <div className="at-boiler-tile"><small>{t('module.feeder.bowl')}</small><strong>{bowl === null ? '—' : `${num(bowl, lang, 0)} g`}</strong></div>
        {entities.stock && <div className={`at-boiler-tile ${low ? 'is-warning' : ''}`}><small>{t('module.feeder.stock')}</small><strong>{stock === undefined ? '—' : low ? t('module.feeder.stockLow') : t('module.feeder.stockOk')}</strong></div>}
        <div className="at-boiler-tile at-feeder-plan"><small>{t('module.feeder.plan')}</small><strong>{schedule ? schedule.meals.map(m => `${m.time} · ${m.portions}`).join(', ') || '—' : '—'}</strong>{next && <span>{t('module.feeder.next')} {next.time} · {portions(next.portions)}</span>}</div>
        {entities.desiccant && <div className={`at-boiler-tile ${desiccantDue ? 'is-warning' : ''}`}><small>{t('module.feeder.desiccant')}</small><strong>{desiccant && Number.isFinite(Number(desiccant.state)) ? `${num(Number(desiccant.state), lang, 0)} %` : '—'}</strong></div>}
      </div>
      <div className="at-feeder-feed">
        <div className="hm-stepper"><button type="button" className="hm-round" aria-label="−" disabled={busy || dose <= 1} onClick={() => setDose(d => Math.max(1, d - 1))}>−</button><div className="at-feeder-dose"><strong>{portions(dose)}</strong><small>{approx(dose)}</small></div><button type="button" className="hm-round" aria-label="+" disabled={busy || dose >= max} onClick={() => setDose(d => Math.min(max, d + 1))}>+</button></div>
        <button type="button" className="hm-pill is-primary at-feeder-go" disabled={busy || !available || confirm === 'feed'} onClick={() => setConfirm('feed')}>{t('module.feeder.feed')}</button>
      </div>
      {confirm === 'feed' && <div className="at-feeder-confirm" role="alertdialog"><span>{t('module.feeder.confirm', { portions: portions(dose), approx: approx(dose) })}</span><button type="button" className="hm-pill is-primary at-feeder-yes" disabled={busy} onClick={() => void run(feedCall(entities.feed!, dose, max))}>{t('module.feeder.yes')}</button><button type="button" className="hm-pill" disabled={busy} onClick={() => setConfirm(null)}>{t('ui.close')}</button></div>}
      {confirm === 'plan' && planS && <div className="at-feeder-confirm" role="alertdialog"><span>{t('module.feeder.planToggle')}</span><button type="button" className="hm-pill is-primary at-feeder-plan-yes" disabled={busy} onClick={() => void run({ domain: 'switch', service: planOn ? 'turn_off' : 'turn_on', data: { entity_id: entities.plan } })}>{t('module.feeder.yes')}</button><button type="button" className="hm-pill" disabled={busy} onClick={() => setConfirm(null)}>{t('ui.close')}</button></div>}
      {note && <p className="at-feeder-note" role="status">{note}</p>}
    </section>;
  },
};
