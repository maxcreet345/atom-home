import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModuleDef } from './types.ts';
import { petFeederSpec } from './catalog.ts';
import { Icon } from '../ui/primitives.tsx';
import { DeviceArt } from '../ui/device-art.tsx';
import { Switch } from '../ui/cards.tsx';
import { Automations, type SheetAutomation } from '../ui/sheet.tsx';
import type { Key } from '../i18n/index.ts';
import type { Host } from '../runtime/host.ts';
import type { Registry } from '../model/registry.ts';
import type { T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import type { ModuleEntities, ModuleOptions } from './types.ts';
import { num } from '../ui/format.ts';
import { clock, clockShift, dayKey, eatenOn, eventsOf, hoursOf, shiftTime, weekOf, type FeederLog } from './feeder-log.ts';
import { editFeederSchedule, feedCall, nextMeal, optionInt, parseFeederSchedule, scheduleCall, SCHEDULE_ATTR, type FeederMeal } from './feeder-protocol.ts';
type Props = { registry: Registry; entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang };
type Mood = 'hungry' | 'eating' | 'full' | 'sleep';
const tk = (t: T, k: string, params?: Record<string, string | number>) => t(`module.feeder.${k}` as Key, params);
/** The journal lives in Xiaomi's cloud: read on open and every two minutes, the backend caches it. */
function useLog(host: Host, entity?: string) {
  const [log, setLog] = useState<FeederLog | null>(null);
  useEffect(() => { if (!entity || !host.feederLog) return; let alive = true; const load = () => void host.feederLog!(entity).then(v => { if (alive) setLog(v); }); load(); const timer = setInterval(load, 120000); return () => { alive = false; clearInterval(timer); }; }, [host, entity]);
  return log;
}
/** What both the tile and the sheet read from the feeder. */
function read({ registry, entities, host, t }: Props, log: FeederLog | null) {
  const st = (role: string) => { const id = entities[role]; return id ? registry.states[id] : undefined; };
  const feed = st('feed'), available = !!feed && feed.state !== 'unavailable' && host.online;
  const bowlS = st('bowl'), bowl = bowlS && Number.isFinite(Number(bowlS.state)) ? Number(bowlS.state) : null;
  const stock = st('stock')?.state, low = stock === 'low', planS = st('plan'), planOn = planS?.state === 'on';
  const schedule = parseFeederSchedule(st('info')?.attributes[SCHEDULE_ATTR]);
  const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const shift = clockShift(log, now), meals = (schedule?.meals ?? []).map(m => ({ ...m, time: shiftTime(m.time, -shift) })).sort((a, b) => a.time.localeCompare(b.time));
  const next = planOn ? nextMeal(meals, hhmm) : null, today = dayKey(now), eaten = log ? eatenOn(log, today) : null;
  const lastAte = eventsOf(log, today).filter(e => e.kind === 'ate').pop(), hour = now.getHours();
  const ago = lastAte ? Date.now() / 1000 - lastAte.at : Infinity, mood: Mood = ago >= 0 && ago < 240 ? 'eating' : hour >= 23 || hour < 6 ? 'sleep' : bowl ? 'full' : 'hungry';
  const outAbnormal = st('outStatus')?.state === 'abnormal', stuck = st('stuck')?.state === 'abnormal', batteryLow = st('battery')?.state === 'on';
  // the desiccant comes from the cloud: the local property reads 0 % on this firmware while Mi Home shows the true value
  const desiccantDue = !!log?.desiccant && log.desiccant.level <= 5;
  const warnings = [!available && host.online && tk(t, 'offline'), stuck && tk(t, 'stuckNow'), outAbnormal && t('module.feeder.outAbnormal'), low && t('module.feeder.stockLow'), batteryLow && tk(t, 'batteryNow'), desiccantDue && t('module.feeder.desiccantDue')].filter((x): x is string => !!x);
  return { st, available, bowl, stock, low, planS, planOn, schedule, meals, shift, hhmm, next, today, eaten, mood, warnings };
}
/** An original cat that tells the bowl's story at a glance: waits at an empty bowl, eats, sleeps at night. */
function CatArt({ mood, grams, label }: { mood: Mood; grams: number | null; label?: string }) {
  const asleep = mood === 'sleep', fill = (grams ?? 0) > 0;
  return <svg className={`at-cat is-${mood}`} viewBox="0 0 190 160" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}>
    <ellipse cx="100" cy="150" rx="84" ry="7" className="at-cat-shadow" />
    <path className="at-cat-tail" d="M136 138c22 2 32-12 28-30" fill="none" stroke="#f0921c" stroke-width="13" stroke-linecap="round" />
    <path d="M70 150c-12-34 0-72 40-72s52 38 40 72z" fill="#ffae3b" />
    <ellipse cx="110" cy="126" rx="20" ry="22" fill="#ffdcA8" />
    <g className="at-cat-head">
      <path d="M72 46 66 12l32 20zM148 46l6-34-32 20z" fill="#ffae3b" /><path d="M76 38 73 21l15 10zM144 38l3-17-15 10z" fill="#ff8f7a" />
      <ellipse cx="110" cy="60" rx="44" ry="36" fill="#ffae3b" />
      <path d="M110 25v12M97 27l2 10M123 27l-2 10" stroke="#ef8f14" stroke-width="4" stroke-linecap="round" />
      {asleep ? <path d="M84 62q8 6 15 0M121 62q8 6 15 0" fill="none" stroke="#2b2118" stroke-width="3.5" stroke-linecap="round" /> : <g className="at-cat-eyes"><ellipse cx="92" cy="60" rx="6" ry="7.5" fill="#2b2118" /><ellipse cx="128" cy="60" rx="6" ry="7.5" fill="#2b2118" /><circle cx="94" cy="57" r="2" fill="#fff" /><circle cx="130" cy="57" r="2" fill="#fff" /></g>}
      <ellipse cx="78" cy="72" rx="8" ry="5" fill="#ff8f7a" opacity=".55" /><ellipse cx="142" cy="72" rx="8" ry="5" fill="#ff8f7a" opacity=".55" />
      <path d="M106 70h8l-4 5z" fill="#d9604a" /><path d="M110 75q-1 6-7 5M110 75q1 6 7 5" fill="none" stroke="#2b2118" stroke-width="2.4" stroke-linecap="round" />
      <path d="M72 66l-14-3M72 74l-14 2M148 66l14-3M148 74l14 2" stroke="#2b2118" stroke-opacity=".35" stroke-width="2" stroke-linecap="round" />
    </g>
    <ellipse cx="94" cy="148" rx="13" ry="7" fill="#ffc46e" /><ellipse cx="126" cy="148" rx="13" ry="7" fill="#ffc46e" />
    {fill && <g fill="#b0702c"><circle cx="24" cy="125" r="4" /><circle cx="34" cy="122" r="4.5" /><circle cx="44" cy="124" r="4" /><circle cx="29" cy="119" r="3.5" /><circle cx="40" cy="118" r="3.5" /></g>}
    <path d="M10 126h48l-7 24H17z" className="at-cat-bowl" /><path d="M10 126h48" stroke="#00000022" stroke-width="2" stroke-linecap="round" />
    {asleep && <text x="160" y="30" className="at-cat-z">z z</text>}
  </svg>;
}
const GLYPH: Record<string, string> = { bowl: 'M4 10h16l-2 8a2 2 0 0 1-2 1.5H8A2 2 0 0 1 6 18zM8 7.5h.01M12 6h.01M16 7.5h.01', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2', bars: 'M5 20v-6M12 20V5M19 20v-9', target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', waves: 'M8 4c-2 3 2 5 0 8s2 5 0 8M16 4c-2 3 2 5 0 8s2 5 0 8', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1' };
const Glyph = ({ name, size = 22 }: { name: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={GLYPH[name]} /></svg>;
type View = 'main' | 'journal' | 'plan' | 'stats' | 'desiccant' | 'settings';
/** Xiaomi MIOT pet feeder: everything the Mi Home card offers, in the panel's language. */
export function FeederSheet(props: Props & { room?: string; onClose: () => void; automations?: SheetAutomation[]; wide?: boolean }) {
  const { entities, options, host, t, lang, room, onClose, automations = [], wide } = props;
  const log = useLog(host, entities.info);
  const { st, available, bowl, stock, low, planS, planOn, schedule, meals, shift, hhmm, next, today, eaten, mood, warnings } = read(props, log);
  const grams = optionInt(options.portionGrams, 10, 1, 200), max = optionInt(options.maxPortions, 15, 1, 50);
  const [view, setView] = useState<View>('main'), [day, setDay] = useState(today), [range, setRange] = useState<'day' | 'week'>('day');
  const [feedOpen, setFeedOpen] = useState(false), [dose, setDose] = useState(1), [confirm, setConfirm] = useState<'plan' | 'save' | 'reset' | 'calibrate' | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const running = useRef(false);
  const [draft, setDraft] = useState<{ original: string; meals: FeederMeal[] } | null>(null);
  const stale = !!draft && !!schedule && draft.original !== schedule.raw;
  const draftValue = () => { try { return draft ? editFeederSchedule(draft.original, draft.meals.map(m => ({ ...m, time: shiftTime(m.time, shift) }))) : null; } catch { return null; } };
  const portions = (n: number) => t('module.feeder.portions', { n }), approx = (n: number) => t('module.feeder.approx', { g: n * grams });
  const run = async (call: { domain: string; service: string; data: Record<string, unknown> }, okText = t('module.feeder.sent')) => {
    if (running.current) return; running.current = true; setBusy(true); setNote(''); // a ref, not the state: three taps in one frame must feed the cat once
    try { await host.call(call.domain, call.service, call.data); setNote(okText); setFeedOpen(false); }
    catch (e) { setNote(`${t('module.feeder.fail')}: ${e instanceof Error ? e.message : String(e)}`); }
    finally { running.current = false; setBusy(false); setConfirm(null); }
  };
  const bodyRef = useRef<HTMLDivElement>(null), firstView = useRef(true);
  // a new page of the sheet starts at its top, and keyboard and screen-reader focus lands on it instead of falling out of the dialog
  useEffect(() => { if (firstView.current) { firstView.current = false; return; } const body = bodyRef.current; if (!body) return; const sheet = body.closest('.hm-sheet'); if (sheet) sheet.scrollTop = 0; body.querySelector<HTMLElement>('.at-fd-back, .hm-sheet-head .hm-icon-btn')?.focus({ preventScroll: true }); }, [view]);
  const go = (v: View) => { setView(v); setConfirm(null); setNote(''); if (v === 'journal') setDay(today); };
  const head = (title: string, sub?: string) => <div className="hm-sheet-head at-fd-head">{view === 'main' ? <span className="hm-sheet-photo"><DeviceArt type="feeder" fill /></span> : <button type="button" className="hm-icon-btn at-fd-back" aria-label={t('ui.back' as Key)} onClick={() => { setView('main'); setDraft(null); setConfirm(null); }}><Icon name="back" size={20} /></button>}<div><small>{sub ?? room ?? ''}</small><h2>{title}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>;
  const toggle = (role: string, label: string, hint?: string, icon?: string) => { const on = st(role)?.state === 'on'; return <div className={`ah-row hm-setting at-fd-row`}>{icon && <span className="at-fd-ico"><Glyph name={icon} /></span>}<span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span><Switch on={on} pending={busy} disabled={!available} label={label} onToggle={() => void run({ domain: 'switch', service: on ? 'turn_off' : 'turn_on', data: { entity_id: entities[role] } }, label)} /></div>; };
  const link = (icon: string, label: string, value: string, v: View) => <button type="button" className="ah-row hm-setting is-button at-fd-row" onClick={() => go(v)}><span className="at-fd-ico"><Glyph name={icon} /></span><span className="ah-row-text"><strong>{label}</strong>{value && <small>{value}</small>}</span><Icon name="next" size={18} /></button>;
  const ask = (text: string, yes: () => void) => <div className="at-feeder-confirm" role="alertdialog" aria-label={text}><span>{text}</span><button type="button" className="hm-pill at-fd-amber" disabled={busy} onClick={yes}>{t('module.feeder.yes')}</button><button type="button" className="hm-pill" disabled={busy} onClick={() => setConfirm(null)}>{t('ui.close')}</button></div>;
  const notice = note ? <p className="at-feeder-note" role="status">{note}</p> : null;
  /* the day as a line: what happened, then what is still planned */
  const timeline = (key: string, limit?: number) => {
    const done = eventsOf(log, key).map(e => ({ time: clock(e.at), past: true, next: false, text: e.kind === 'ate' ? tk(t, 'ate', { g: e.grams }) : tk(t, e.kind === 'plan' ? 'fedPlan' : 'fedManual', { n: portions(Math.max(1, Math.round(e.grams / grams))) }) }));
    const planned = key === today && planOn ? meals.filter(m => m.time > hhmm).map(m => ({ time: m.time, past: false, next: next?.time === m.time, text: `${portions(m.portions)} · ${approx(m.portions)}` })) : [];
    const rows = [...done, ...planned], shown = limit ? rows.slice(-limit) : rows;
    return shown.length ? <ol className="at-fd-line">{shown.map(r => <li className={`${r.past ? 'is-past' : ''} ${r.next ? 'is-next' : ''}`}><i /><b>{r.time}</b><span>{r.text}</span>{r.next && <em>{t('module.feeder.next')}</em>}</li>)}</ol> : <p className="at-fd-empty">{tk(t, 'noJournal')}</p>;
  };
  if (view === 'journal') { const days = weekOf(log); return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(tk(t, 'journal'))}
    <div className="at-fd-days" role="tablist">{days.map(d => <button type="button" role="tab" aria-selected={d.key === day} className={`${d.key === day ? 'is-active' : ''} ${d.grams ? '' : 'is-empty'}`} onClick={() => setDay(d.key)}><small>{d.date.toLocaleDateString(lang, { weekday: 'short' })}</small><b>{d.date.getDate()}</b></button>)}</div>
    <div className="ah-group"><small className="ah-group-title">{day === today ? tk(t, 'today') : new Date(day + 'T12:00').toLocaleDateString(lang, { day: 'numeric', month: 'long' })} · {num(eatenOn(log, day), lang, 0)} {tk(t, 'g')}</small>{timeline(day)}</div></div>; }
  if (view === 'stats') { const week = weekOf(log), hours = hoursOf(log, today), total = week.reduce((s, d) => s + d.grams, 0), seen = week.filter(d => d.grams > 0).length, peak = Math.max(1, ...(range === 'day' ? hours : week.map(d => d.grams))); return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(tk(t, 'statsTitle'))}
    <div className="ah-segments hm-range-tabs" role="tablist"><button type="button" role="tab" aria-selected={range === 'day'} className={range === 'day' ? 'is-active' : ''} onClick={() => setRange('day')}>{tk(t, 'day')}</button><button type="button" role="tab" aria-selected={range === 'week'} className={range === 'week' ? 'is-active' : ''} onClick={() => setRange('week')}>{tk(t, 'week')}</button></div>
    <div className="ah-group at-fd-stats"><div className="at-fd-big"><b>{num(range === 'day' ? eaten ?? 0 : total, lang, 0)}</b><i>{tk(t, 'g')}</i><small>{range === 'day' ? tk(t, 'gEaten') : tk(t, 'gWeek')}</small></div>{range === 'week' && seen > 0 && <small className="at-fd-avg">{tk(t, 'avgDay', { g: Math.round(total / seen) })}</small>}
      {range === 'day' ? <><div className="at-fd-bars is-day">{hours.map((g, h) => <span title={`${h}:00 — ${g} ${tk(t, 'g')}`}><i style={`height:${g ? Math.max(6, g / peak * 100) : 0}%`} /></span>)}</div><div className="at-fd-axis"><small>00</small><small>12</small><small>24</small></div></> : <div className="at-fd-bars is-week">{week.map(d => <span><em>{d.grams || ''}</em><i style={`height:${d.grams ? Math.max(5, d.grams / peak * 100) : 0}%`} /><small>{d.date.toLocaleDateString(lang, { weekday: 'short' })}</small></span>)}</div>}</div></div>; }
  if (view === 'desiccant') { const level = log?.desiccant?.level ?? null, left = log?.desiccant?.days ?? null; return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(t('module.feeder.desiccant'))}
    <div className="ah-group at-fd-ring-box"><svg viewBox="0 0 120 120" className="at-fd-ring" aria-hidden="true"><circle cx="60" cy="60" r="50" /><circle cx="60" cy="60" r="50" className="is-value" pathLength="100" stroke-dasharray={`${level ?? 0} 100`} transform="rotate(-90 60 60)" /></svg><div className="at-fd-ring-text"><b>{level === null ? '—' : num(level, lang, 0)}<i>%</i></b></div><small>{left === null ? t('state.unavailable') : tk(t, 'desicUse', { d: left })}</small></div>
    <div className="ah-rows"><div className="ah-row hm-setting"><span className="ah-row-text"><strong>{tk(t, 'desicCycle')}</strong></span><small>{tk(t, 'desicCycleV')}</small></div>{entities.resetDesiccant && <button type="button" className="ah-row hm-setting is-button" disabled={busy || !available} onClick={() => setConfirm('reset')}><span className="ah-row-text"><strong>{tk(t, 'resetDesiccant')}</strong></span><Icon name="next" size={18} /></button>}</div>
    {confirm === 'reset' && ask(tk(t, 'resetConfirm'), () => void run({ domain: 'button', service: 'press', data: { entity_id: entities.resetDesiccant } }))}{notice}</div>; }
  if (view === 'settings') { const scr = st('screen'), opts = (scr?.attributes.options as string[] | undefined) ?? []; const statuses: Array<[string, string]> = []; if (entities.stuck) statuses.push([tk(t, 'stuck'), st('stuck')?.state === 'abnormal' ? tk(t, 'abnormal') : tk(t, 'normal')]); if (entities.outStatus) statuses.push([tk(t, 'dispense'), st('outStatus')?.state === 'abnormal' ? tk(t, 'abnormal') : tk(t, 'normal')]); if (entities.battery) statuses.push([tk(t, 'battery'), st('battery')?.state === 'on' ? tk(t, 'batteryLow') : tk(t, 'normal')]);
    const screenLabel = (o: string) => { const k = `module.feeder.screen.${o}` as Key; return t(k) === k ? o : t(k); };
    return <div ref={bodyRef} className={`hm-sheet-body ah-sheet at-feeder-sheet ${wide ? 'is-split' : ''}`} data-view={view} data-kind="feeder">{head(tk(t, 'settings'))}<div className="at-feeder-col">
    <div className="ah-rows">{entities.lock && toggle('lock', tk(t, 'lock'), tk(t, 'lockHint'))}{entities.screen && scr && <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{tk(t, 'screen')}</strong></span><select value={scr.state} disabled={busy || !available} aria-label={tk(t, 'screen')} onChange={e => void run({ domain: 'select', service: 'select_option', data: { entity_id: entities.screen, option: (e.target as HTMLSelectElement).value } }, tk(t, 'screen'))}>{opts.map(o => <option value={o}>{screenLabel(o)}</option>)}</select></div>}{entities.reminder && toggle('reminder', tk(t, 'reminder'), tk(t, 'reminderHint'))}{entities.noPile && toggle('noPile', tk(t, 'noPile'), tk(t, 'noPileHint'))}{entities.calibrate && <button type="button" className="ah-row hm-setting is-button" disabled={busy || !available} onClick={() => setConfirm('calibrate')}><span className="ah-row-text"><strong>{tk(t, 'calibrate')}</strong><small>{tk(t, 'calibrateHint')}</small></span><Icon name="next" size={18} /></button>}</div>
    {confirm === 'calibrate' && ask(tk(t, 'calibrateConfirm'), () => void run({ domain: 'button', service: 'press', data: { entity_id: entities.calibrate } }))}{notice}</div><div className="at-feeder-col">
    {statuses.length > 0 && <div className="ah-rows">{statuses.map(([k, v]) => <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{k}</strong></span><small>{v}</small></div>)}</div>}<Automations rows={automations} t={t} lang={lang} /><p className="at-fd-empty">{tk(t, 'inMiHome')}</p></div></div>; }
  if (view === 'plan') return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(tk(t, 'auto'))}
    <div className="ah-rows">{planS && <div className="ah-row hm-setting at-fd-row"><span className="ah-row-text"><strong>{tk(t, 'auto')}</strong><small>{tk(t, 'autoHint')}</small></span><Switch on={planOn} pending={busy} disabled={!available} label={tk(t, 'auto')} onToggle={() => setConfirm(confirm === 'plan' ? null : 'plan')} /></div>}</div>
    {confirm === 'plan' && ask(t('module.feeder.planToggle'), () => void run({ domain: 'switch', service: planOn ? 'turn_off' : 'turn_on', data: { entity_id: entities.plan } }))}
    <div className="ah-group"><div className="at-fd-sums"><div><b>{meals.reduce((s, m) => s + m.portions, 0)}</b><small>{t('module.feeder.dose')}</small></div><div><b>{meals.length}</b><small>{tk(t, 'timesDay')}</small></div></div>
      {!draft && <ol className="at-fd-line is-plan">{meals.map(m => <li className={next?.time === m.time ? 'is-next' : ''}><i /><b>{m.time}</b><span>{portions(m.portions)} · {approx(m.portions)}</span>{next?.time === m.time && <em>{t('module.feeder.next')}</em>}</li>)}</ol>}
      {!draft && entities.info && meals.length > 0 && <button type="button" className="hm-pill at-fd-edit" disabled={busy || !available} onClick={() => { setDraft({ original: schedule!.raw, meals: meals.map(m => ({ ...m })) }); setNote(''); setConfirm(null); }}>{t('module.feeder.edit')}</button>}
      {draft && <div className="at-feeder-editor" data-feeder-editor>{draft.meals.map((m, n) => <div className="at-feeder-edit-row"><label className="at-field"><span>{t('module.feeder.time')}</span><input type="time" value={m.time} disabled={busy} onInput={e => setDraft(d => d && { ...d, meals: d.meals.map((x, k) => k === n ? { ...x, time: (e.target as HTMLInputElement).value } : x) })} /></label><label className="at-field"><span>{t('module.feeder.dose')}</span><input type="number" min={1} max={15} value={m.portions} disabled={busy} onInput={e => setDraft(d => d && { ...d, meals: d.meals.map((x, k) => k === n ? { ...x, portions: Number((e.target as HTMLInputElement).value) } : x) })} /></label></div>)}
        {stale && <p className="at-feeder-note">{t('module.feeder.stale')}</p>}<div className="hm-chips"><button type="button" className="hm-pill at-fd-amber at-feeder-save" disabled={busy || stale || !draftValue()} onClick={() => setConfirm('save')}>{t('module.feeder.save')}</button><button type="button" className="hm-pill" disabled={busy} onClick={() => { setDraft(null); setConfirm(null); }}>{t('ui.close')}</button>{!stale && !draftValue() && <span className="at-feeder-note">{t('module.feeder.invalid')}</span>}</div>
        {confirm === 'save' && draftValue() && ask(t('module.feeder.saveConfirm', { plan: draft.meals.map(m => `${m.time} — ${portions(m.portions)}`).join('; ') }), () => void run(scheduleCall(entities.info!, draftValue()!), t('module.feeder.planSent')).then(() => setDraft(null)))}</div>}</div>
    {entities.lowIntake && <div className="ah-rows">{toggle('lowIntake', tk(t, 'lowIntake'), tk(t, 'lowIntakeHint'))}</div>}{notice}</div>;
  const doneMeals = eventsOf(log, today).filter(e => e.kind !== 'ate').length, totalMeals = Math.max(meals.length, doneMeals), weekTotal = weekOf(log).reduce((s, d) => s + d.grams, 0);
  return <div ref={bodyRef} className={`hm-sheet-body ah-sheet at-feeder-sheet ${wide ? 'is-split' : ''}`} data-view={view} data-kind="feeder" data-module-card="pet_feeder">
    {head(t('module.pet_feeder'))}
    <div className="at-feeder-col">
      {warnings.length > 0 && <div className="at-feeder-warn">{warnings.map(w => <span><Icon name="warning" size={14} />{w}</span>)}</div>}
      <div className="at-fd-hero">
        <div className="at-fd-hero-text"><div className="at-fd-big"><b>{eaten === null ? (bowl === null ? '—' : num(bowl, lang, 0)) : num(eaten, lang, 0)}</b><i>{tk(t, 'g')}</i></div><small>{eaten === null ? tk(t, 'bowlLabel') : tk(t, 'eatenToday')}</small>
          {log && totalMeals > 0 && <div className="at-fd-progress" aria-label={tk(t, 'ofMeals', { a: doneMeals, b: totalMeals })}><span>{Array.from({ length: totalMeals }, (_, i) => <i className={i < doneMeals ? 'is-done' : ''} />)}</span><small>{tk(t, 'planDay')} · {tk(t, 'ofMeals', { a: doneMeals, b: totalMeals })}</small></div>}</div>
        <CatArt mood={mood} grams={bowl} label={tk(t, `cat.${mood}`)} />
      </div>
      <div className="at-fd-bowl"><span className="at-fd-ico is-big"><Glyph name="bowl" size={26} /></span><span className="at-fd-bowl-text"><b>{bowl === null ? '—' : `${num(bowl, lang, 0)} ${tk(t, 'g')}`}</b><small>{tk(t, 'bowlLabel')}{low ? ` · ${t('module.feeder.stockLow')}` : stock !== undefined ? ` · ${t('module.feeder.stockOk')}` : ''}</small></span><button type="button" className="hm-pill at-fd-amber at-feeder-go" disabled={busy || !available} onClick={() => setFeedOpen(o => !o)}>{tk(t, 'feedNow')}</button></div>
      {feedOpen && <div className="at-fd-feed" role="group" aria-label={tk(t, 'feedNow')}><div className="hm-stepper"><button type="button" className="hm-round" aria-label="−" disabled={busy || dose <= 1} onClick={() => setDose(d => Math.max(1, d - 1))}>−</button><div className="at-feeder-dose"><strong>{portions(dose)}</strong><small>{approx(dose)}</small></div><button type="button" className="hm-round" aria-label="+" disabled={busy || dose >= max} onClick={() => setDose(d => Math.min(max, d + 1))}>+</button></div><div className="at-fd-feed-btns"><button type="button" className="hm-pill at-fd-amber at-feeder-yes" disabled={busy} onClick={() => void run(feedCall(entities.feed!, dose, max))}>{tk(t, 'give')}</button><button type="button" className="hm-pill" disabled={busy} onClick={() => setFeedOpen(false)}>{t('ui.close')}</button></div></div>}
      {notice}
      {shift !== 0 && <p className="at-fd-tz"><Icon name="warning" size={14} />{tk(t, shift > 0 ? 'clockAhead' : 'clockBehind', { h: Math.abs(shift) / 60 })}</p>}
    </div>
    <div className="at-feeder-col">
      <button type="button" className="at-fd-card" onClick={() => go('journal')}><span className="at-fd-card-head"><strong>{tk(t, 'journalToday')}</strong><Icon name="next" size={18} /></span>{timeline(today, 6)}</button>
      <div className="ah-rows">
        {link('clock', tk(t, 'auto'), planOn ? tk(t, 'autoSum', { m: meals.length }) : t('module.feeder.planOff'), 'plan')}
        {link('bars', tk(t, 'statsTitle'), log ? `${num(weekTotal, lang, 0)} ${tk(t, 'g')} · ${tk(t, 'gWeek')}` : '—', 'stats')}
        {entities.compensate && toggle('compensate', tk(t, 'compensate'), tk(t, 'compensateHint'), 'target')}
        {link('waves', t('module.feeder.desiccant'), log?.desiccant ? `${num(log.desiccant.level, lang, 0)} % · ${tk(t, 'desicLeft', { d: log.desiccant.days })}` : '—', 'desiccant')}
        {link('gear', tk(t, 'settings'), '', 'settings')}
      </div>
    </div>
  </div>;
}
export const petFeeder: ModuleDef = {
  ...petFeederSpec, sheetKey: 'feeder',
  claims: entities => [...Object.entries(entities).filter(([k]) => k !== 'device' && k !== 'rest').map(([, v]) => v), ...(entities.rest ?? '').split(',')].filter((x): x is string => !!x),
  Card(props) {
    const { t, lang, onOpen, host, entities } = props, log = useLog(host, entities.info), { available, bowl, eaten, planOn, next, warnings, mood } = read(props, log);
    const sub = !available ? t('state.unavailable') : warnings[0] ?? (planOn && next ? tk(t, 'feedAt', { time: next.time }) : planOn ? t('module.feeder.planOn') : t('module.feeder.planOff'));
    const value = eaten ?? bowl;
    return <div className={`ah-tile ah-value hm-card at-fd-tile ${warnings.length ? 'is-warning' : ''}`} data-module-card="pet_feeder"><button type="button" className="ah-tile-hit" onClick={onOpen} disabled={!onOpen}><span className="at-fd-tile-cat"><CatArt mood={mood} grams={bowl} /></span><span className="ah-value-num"><b>{value === null ? '—' : num(value, lang, 0)}</b>{value !== null && <i>{tk(t, 'g')}</i>}</span><span className="ah-tile-text"><strong>{t('module.pet_feeder')}</strong><small>{sub}</small></span></button></div>;
  },
};
