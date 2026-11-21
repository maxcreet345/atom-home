/* The laundry family's sheet (laundry.profiles.ts reads the machine). Drawn after the vendors' own screens — LG ThinQ's washer and
 * SmartThings' dryer — in the panel's style (the kettle's and the air fryer's sheet chrome): on top what the machine is doing, big, with the time
 * left, the moment it ends, the stages of the cycle and its buttons; beside it the program and its options where the machine lets them be
 * changed from here; behind the gear its sounds. Start, pause and stop always ask first. A machine whose remote control is off says so, and
 * what to press on the machine, instead of offering buttons that would be refused. */
import { useEffect, useState } from 'preact/hooks';
import type { ApplianceSheetProps, ApplianceUi } from './types.ts';
import { readLaundry, lineOf, actsFor, callFor, minutesText, clockText, stepText, errorWords, cycleName, type Act, type Laundry, type Step } from './laundry.profiles.ts';
import { HOLD_MS, onOffOf, useRun } from '../modules/kettle.tsx';
import { Ask, type Question } from '../ui/setup.tsx';
import { Icon } from '../ui/primitives.tsx';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';

const w = (t: T, k: string, p?: Record<string, string | number>) => t(`laundry.${k}` as Key, p);
/** the clock, so that «осталось 42 мин» counts down between the machine's own reports */
function useNow(every = 30_000) { const [now, setNow] = useState(() => Date.now()); useEffect(() => { const id = setInterval(() => setNow(Date.now()), every); return () => clearInterval(id); }, [every]); return now; }
/** Our drawing of a front loader (the house's own photo replaces it when set); its drum turns while it runs. */
export function LaundryArt({ phase, dryer }: { phase: Laundry['phase']; dryer: boolean }) {
  return <svg className={`at-ln-art is-${phase}`} viewBox="0 0 120 120" aria-hidden="true">
    <rect x="18" y="10" width="84" height="100" rx="12" className="at-ln-body" />
    <path d="M18 32h84" className="at-ln-line" /><rect x="26" y="17" width={dryer ? 22 : 18} height="8" rx="3" className="at-ln-panel" /><circle cx="88" cy="21" r="5" className="at-ln-knob" />
    <circle cx="60" cy="70" r="28" className="at-ln-door" /><g className="at-ln-drum"><circle cx="60" cy="70" r="20" className="at-ln-glass" />
      {phase === 'running' && <path d={dryer ? 'M46 74c6-8 14 8 28-2' : 'M42 76c8-6 12 6 18 0s12 6 18 0'} className="at-ln-water" />}</g>
  </svg>;
}
type Draft = { cycle?: string; dryLevel?: string; dryTime?: string; delay?: number; delayEnd?: number; buzzer?: string; finishSound?: string };
function LaundrySheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const inst = view.instance, B = inst.bindings, now = useNow();
  const read = readLaundry(registry, inst, t, now)!;
  const l: Laundry = host.online ? read : { ...read, phase: 'unavailable' }; // with no connection to the house nothing it last said is «now»
  const dryer = l.machine === 'dryer', there = l.phase !== 'unavailable';
  const photo = usePhoto(B.status ?? B.running), ui = useRun(host, t);
  const [ask, setAsk] = useState<Question | null>(null), [screen, setScreen] = useState<'main' | 'settings'>('main'), [draft, setDraft] = useState<Draft>({});
  useEffect(() => { ui.seen(); }, [l.phase, l.step]); // the machine answered: the button that waited for it is free again
  const st = (role: string) => B[role] ? registry.states[B[role]] : undefined;
  const remoteOff = l.remote === false, busy = ui.busy !== null, locked = l.phase === 'running' || l.phase === 'paused' || l.phase === 'delay';
  const canWrite = there && !remoteOff && !busy;
  // ---- energy: now, and of this cycle from the plug's meter (HA's statistics), else today's ----
  const watts = there ? numOf(st('plugPower')?.state) : null, today = there ? numOf(st('plugToday')?.state) : null;
  const cycle = useCycleEnergy(host, B.plugEnergy, l, now);
  // ---- commands ----
  const act = (a: Act) => { const c = callFor(registry, inst, a); if (!c) return; setAsk({ text: w(t, `ask.${a}.${l.machine}`, { p: l.program ?? '' }).replace(' «»', ''), yes: w(t, `yes.${a}`), run: () => void ui.run(a, [c], HOLD_MS) }); };
  const set = (role: string, domain: string, service: string, data: Record<string, unknown>, key: keyof Draft, value: string | number) => { const id = B[role]; if (!id) return; setDraft(d => ({ ...d, [key]: value })); void ui.run(role, [[domain, service, { entity_id: id, ...data }]]).then(ok => { if (!ok) setDraft(d => { const x = { ...d }; delete x[key]; return x; }); }); };
  // a value the machine now reports wins over the draft
  useEffect(() => { setDraft({}); }, [st('cycle')?.state, st('dryLevel')?.state, st('dryTime')?.state, st('delay')?.state, st('delayEnd')?.state, st('buzzer')?.state, st('finishSound')?.state]);
  const kind = w(t, `kind.${l.machine}`), title = view.device.name || kind;
  // ---- the hero ----
  const status = !there ? w(t, `offline.${l.machine}`) : lineOf(l, t, lang) ?? '';
  const big = (l.phase === 'running' || l.phase === 'paused') && l.left !== null ? l.left : null;
  const acts = there ? actsFor(l, registry, inst) : [];
  const actLabel = (a: Act) => w(t, `act.${a}.${l.brand}`);
  const hero = <section className={`at-kt-hero at-ln-hero is-${l.phase}`} data-laundry-phase={l.phase}>
    <ProductPhoto src={photo} className="at-kt-hero-pic" eager />
    <small>{l.program && there ? l.program : kind}</small>
    {big !== null ? <p className="at-kt-temp at-ln-time" aria-label={w(t, 'left', { m: minutesText(big, t) })}>{big >= 60 ? <><b>{Math.floor(big / 60)}:{String(big % 60).padStart(2, '0')}</b><i>{w(t, 'hUnit')}</i></> : <><b>{big}</b><i>{w(t, 'mUnit')}</i></>}</p>
      : <span className="at-ln-face"><ProductPhoto src={null}><LaundryArt phase={l.phase} dryer={dryer} /></ProductPhoto></span>}
    <p className="at-kt-status" role="status">{status}</p>
    {there && l.endAt !== null && (l.phase === 'running' || l.phase === 'paused') && <small className="at-ln-sub">{w(t, 'endsAt', { time: clockText(l.endAt, lang) })}</small>}
    {there && l.phase === 'done' && <small className="at-ln-sub">{l.doneAt !== null ? w(t, 'doneAt', { time: clockText(l.doneAt, lang) }) + ' · ' : ''}{w(t, dryer ? 'takeOutDry' : 'takeOut')}</small>}
    {there && l.phase === 'idle' && l.total !== null && l.total > 0 && <small className="at-ln-sub">{w(t, 'takes', { m: minutesText(l.total, t) })}</small>}
    {l.progress !== null && there && <span className="at-kt-bar" role="progressbar" aria-label={w(t, 'progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l.progress * 100)}><i style={{ width: `${Math.round(l.progress * 100)}%` }} /></span>}
    {there && (l.phase === 'running' || l.phase === 'paused' || l.phase === 'done') && <Steps l={l} t={t} />}
    {there && acts.length > 0 && <div className="at-af-acts at-ln-acts">{acts.map((a, i) => <button type="button" className={`hm-pill at-kt-stop ${i > 0 ? 'is-quiet' : ''}`} data-laundry-act={a} aria-busy={ui.busy === a} disabled={busy || remoteOff} onClick={() => act(a)}>{ui.busy === a ? w(t, 'sending') : actLabel(a)}</button>)}</div>}
    {there && (watts !== null || today !== null || cycle !== null) && <small className="at-kt-energy at-ln-energy">{[watts !== null && watts > 5 ? w(t, 'watts', { w: num(watts, lang, 0) }) : '', cycle !== null ? w(t, 'cycleKwh', { kwh: num(cycle, lang, 2) }) : today !== null ? w(t, 'today', { kwh: num(today, lang, 2) }) : ''].filter(Boolean).join(' · ')}</small>}
  </section>;
  // ---- remote control, child lock, errors in words ----
  const notices = there && <>
    {l.phase === 'error' && <p className="at-ln-note is-alert" role="alert"><Icon name="warning" size={18} /><span><b>{errorWords(l, t)}</b>{w(t, `errHint.${l.brand}`)}</span></p>}
    {remoteOff && <p className="at-ln-note" data-laundry-remote="off"><Icon name="lock" size={18} /><span><b>{w(t, `remoteOff.${l.brand}`)}</b>{w(t, `remoteHow.${l.brand}`)}</span></p>}
  </>;
  // ---- program and options ----
  const chips = <V extends string>(label: string, role: string, options: V[], value: V | null, text: (v: V) => string, key: keyof Draft, whileRunning = false) => <div className="ah-row hm-setting at-kt-row is-col" data-laundry-field={role}>
    <span className="ah-row-text"><strong>{label}</strong></span>
    <div className="at-kt-chips" role="radiogroup" aria-label={label}>{options.map(o => <button type="button" role="radio" aria-checked={o === value} className={o === value ? 'is-on' : ''} disabled={!canWrite || (locked && !whileRunning)} onClick={() => { if (o !== value) set(role, 'select', 'select_option', { option: o }, key, o); }}>{text(o)}</button>)}</div></div>;
  const optionsOf = (role: string): string[] => { const o = st(role)?.attributes.options; return Array.isArray(o) ? o.filter((x): x is string => typeof x === 'string') : []; };
  const valueOf = (role: string, key: keyof Draft) => (draft[key] as string | undefined) ?? (st(role)?.state && !['unknown', 'unavailable'].includes(st(role)!.state) ? st(role)!.state : null);
  const stepper = (label: string, hintKey: string, role: string, key: keyof Draft) => { const s = st(role); if (!s) return null; const a = s.attributes, min = numOf(a.min) ?? 0, max = numOf(a.max) ?? 24, step = numOf(a.step) ?? 1, v = (draft[key] as number | undefined) ?? numOf(s.state), off = !canWrite || locked || v === null;
    return <div className="ah-row hm-setting at-kt-row" data-laundry-field={role}><span className="ah-row-text"><strong>{label}</strong><small>{v ? w(t, hintKey, { h: v }) : w(t, 'noDelay')}</small></span>
      <div className="at-kt-stepper" role="group" aria-label={label}><button type="button" className="hm-round" aria-label={`${label}: −${step}`} disabled={off || v! <= min} onClick={() => set(role, 'number', 'set_value', { value: Math.max(min, v! - step) }, key, Math.max(min, v! - step))}>−</button>
        <b>{v === null || !there ? '—' : <>{num(v, lang, 0)}<i>{w(t, 'hUnit')}</i></>}</b>
        <button type="button" className="hm-round" aria-label={`${label}: +${step}`} disabled={off || v! >= max} onClick={() => set(role, 'number', 'set_value', { value: Math.min(max, v! + step) }, key, Math.min(max, v! + step))}>+</button></div></div>; };
  const program = l.brand === 'samsung' ? B.cycle && <div className="at-kt-card at-ln-card" data-laundry-card="program"><h3>{w(t, 'programs')}</h3>
    {chips(w(t, 'program'), 'cycle', optionsOf('cycle'), valueOf('cycle', 'cycle'), c => cycleName(c, t) ?? c, 'cycle')}
    {B.dryLevel && chips(w(t, 'dryLevel'), 'dryLevel', optionsOf('dryLevel'), valueOf('dryLevel', 'dryLevel'), o => w(t, `level.${o}`), 'dryLevel')}
    {B.dryTime && chips(w(t, 'dryTime'), 'dryTime', optionsOf('dryTime'), valueOf('dryTime', 'dryTime'), o => { const m = hms(o); return m ? minutesText(m, t) : w(t, 'byLevel'); }, 'dryTime')}
    {B.delay && stepper(w(t, 'delayLabel'), 'delayHint', 'delay', 'delay')}
    {B.finishBy && valid(st('finishBy')?.state) && <div className="ah-row hm-setting at-kt-row"><span className="ah-row-text"><strong>{w(t, 'finishBy')}</strong></span><small>{String(st('finishBy')!.state).slice(0, 5)}</small></div>}
    {locked && there && <p className="at-kt-note at-ln-pad">{w(t, 'lockedRunning')}</p>}
  </div> : <div className="at-kt-card at-ln-card" data-laundry-card="program"><h3>{w(t, 'programs')}</h3>
    <p className="at-kt-note at-ln-pad">{w(t, 'lgProgram')}</p>
    {B.delayEnd && stepper(w(t, 'delayEnd'), 'delayEndHint', 'delayEnd', 'delayEnd')}
    {l.phase === 'delay' && l.delayAt !== null && <p className="at-kt-note at-ln-pad">{w(t, 'delayEnds', { time: clockText(l.delayAt, lang) })}</p>}
  </div>;
  const toggle = (role: string, domain: string, label: string, hint?: string) => { const id = B[role]; if (!id) return null; const state = st(role)?.state, on = there ? onOffOf(state) : null;
    return <div className="ah-row hm-setting at-kt-row" data-laundry-switch={role}><span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      {on === null ? <small>{t(state === 'unknown' ? 'state.unknown' : 'state.unavailable')}</small> : <button type="button" role="switch" className={`at-kt-sw ${on ? 'is-on' : ''}`} aria-checked={on} aria-label={label} aria-busy={ui.busy === role} disabled={!canWrite} onClick={() => void ui.run(role, [[domain, on ? 'turn_off' : 'turn_on', { entity_id: id }]])}><i /></button>}</div>; };
  const info = (label: string, value: string, tone = '') => <div className={`ah-row hm-setting at-kt-row at-ln-info ${tone}`}><span className="ah-row-text"><strong>{label}</strong></span><small>{value}</small></div>;
  const extras = <div className="at-kt-card at-ln-card" data-laundry-card="options"><h3>{w(t, 'options')}</h3>
    {toggle('wrinkle', 'switch', w(t, 'wrinkle'), w(t, 'wrinkleHint'))}
    {toggle('damp', 'switch', w(t, 'damp'), w(t, 'dampHint'))}
    {toggle('light', 'light', w(t, 'light'))}
    {l.childLock !== null && there && info(w(t, 'childLock'), w(t, l.childLock ? 'childOn' : 'childOff'))}
    {l.drumClean !== null && there && info(w(t, 'drumClean'), l.drumClean <= 0 ? w(t, 'drumCleanNow') : w(t, 'drumCleanIn', { n: l.drumClean }), l.drumClean <= 0 ? 'is-warn' : '')}
    {l.cycles !== null && there && info(w(t, 'cycles'), String(l.cycles))}
    {B.energy && there && numOf(st('energy')?.state) !== null && info(w(t, 'ownEnergy'), w(t, 'kwh', { kwh: num(numOf(st('energy')?.state), lang, 1) }))}
  </div>;
  const hasExtras = ['wrinkle', 'damp', 'light'].some(r => B[r]) || l.childLock !== null || l.drumClean !== null || l.cycles !== null || !!B.energy;
  const hasSettings = !!(B.buzzer || B.finishSound);
  const err = ui.err && <p className="at-kt-err" role="alert">{w(t, 'fail')}: {ui.err}</p>;
  const close = <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button>;
  const asked = ask && <Ask q={ask} t={t} onClose={() => setAsk(null)} />;
  if (screen === 'settings') return <div className="at-kt-sheet at-ln is-settings">
    <div className="hm-sheet-head at-kt-head"><button type="button" className="hm-icon-btn at-kt-back" aria-label={t('ui.back' as Key)} onClick={() => setScreen('main')}><Icon name="back" size={20} /></button><div><small>{title}</small><h2>{w(t, 'settings')}</h2></div>{close}</div>
    {err}
    <div className="at-kt-body"><div className="at-kt-card at-kt-set">
      {B.buzzer && chips(w(t, 'buzzer'), 'buzzer', optionsOf('buzzer'), valueOf('buzzer', 'buzzer'), o => w(t, `vol.${o}`), 'buzzer', true)}
      {B.finishSound && chips(w(t, 'finishSound'), 'finishSound', optionsOf('finishSound'), valueOf('finishSound', 'finishSound'), o => w(t, 'melody', { n: o.replace(/\D+/g, '') || o }), 'finishSound', true)}
      {remoteOff && <p className="at-kt-note at-ln-pad">{w(t, `remoteOff.${l.brand}`)}</p>}
    </div></div>{asked}
  </div>;
  return <div className={`at-kt-sheet at-ln ${wide ? 'is-wide' : ''}`} data-laundry={l.machine}>
    <div className="hm-sheet-head at-kt-head"><span className="at-kt-face" aria-hidden="true"><ProductPhoto src={photo} eager><LaundryArt phase={l.phase} dryer={dryer} /></ProductPhoto></span><div>{room && <small>{room}</small>}<h2>{title}</h2></div>
      {hasSettings && <button type="button" className="hm-icon-btn at-kt-gear" aria-label={w(t, 'settings')} onClick={() => setScreen('settings')}><Icon name="gear" size={20} /></button>}
      {close}</div>
    {err}
    <div className="at-kt-cols"><div className="at-kt-col">{hero}{notices}</div><div className="at-kt-col">{program}{hasExtras && extras}</div></div>
    {asked}
  </div>;
}
/** The stages of the cycle, as the vendors' apps draw them: done ones ticked, the current one marked. */
function Steps({ l, t }: { l: Laundry; t: T }) {
  const cur = l.step === 'rinseHold' ? 'rinse' : l.step, at = l.phase === 'done' ? l.steps.length : cur ? l.steps.indexOf(cur as Step) : -1;
  return <ol className="at-ln-steps" aria-label={t('laundry.stages' as Key)}>{l.steps.map((s, i) => <li className={i < at || (l.phase === 'done' && s !== 'wrinkle') || (s === 'wrinkle' && l.wrinkle) ? 'is-done' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>{stepText(s, l, t)}</li>)}</ol>;
}
const numOf = (v: unknown): number | null => { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const valid = (s: string | undefined) => !!s && !['unknown', 'unavailable', 'None'].includes(s);
/** «01:30:00» → 90 */
const hms = (s: string) => { const m = /^(\d+):(\d\d)(?::\d\d)?$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
/** kWh the plug counted since the cycle began (HA's statistics of its total), refreshed every five minutes while it runs; null when not known. */
function useCycleEnergy(host: ApplianceSheetProps['host'], id: string | undefined, l: Laundry, now: number): number | null {
  const [v, setV] = useState<number | null>(null);
  const from = l.startAt, to = l.phase === 'done' ? l.doneAt : l.phase === 'running' || l.phase === 'paused' ? now : null, tick = Math.floor(now / 300_000);
  useEffect(() => {
    let live = true; setV(null);
    if (!id || from === null || to === null || to <= from || !host.statistic || !host.online) return;
    host.statistic(id, from, to, ['change']).then(r => { if (live) setV(typeof r.change === 'number' && r.change >= 0 ? r.change : null); }).catch(() => undefined);
    return () => { live = false; };
  }, [id, from, l.phase === 'done' ? to : tick, host.online]);
  return v;
}
export const ui: ApplianceUi = { id: 'laundry', Sheet: LaundrySheet };
