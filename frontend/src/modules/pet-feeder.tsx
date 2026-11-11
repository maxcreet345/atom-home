import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModuleDef } from './types.ts';
import { petFeederSpec } from './catalog.ts';
import { Icon } from '../ui/primitives.tsx';
import { Switch } from '../ui/cards.tsx';
import { Automations, type SheetAutomation } from '../ui/sheet.tsx';
import type { Key } from '../i18n/index.ts';
import type { Host } from '../runtime/host.ts';
import type { Registry } from '../model/registry.ts';
import type { T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import type { ModuleEntities, ModuleOptions } from './types.ts';
import { errorText, num } from '../ui/format.ts';
import { clock, clockShift, dayKey, eatenOn, eventsOf, hoursOf, journalAge, mealsForFeeder, missedMeals, parseZone, shiftTime, tileLine, weekOf, type FeederLog } from './feeder-log.ts';
import { askScroll, editFeederSchedule, feedCall, nextMeal, onOff, optionInt, parseFeederSchedule, planState, scheduleCall, SCHEDULE_ATTR, stateKnown, type FeederMeal } from './feeder-protocol.ts';
type Props = { registry: Registry; entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang };
type Mood = 'hungry' | 'eating' | 'full' | 'calm' | 'sleep';
const tk = (t: T, k: string, params?: Record<string, string | number>) => t(`module.feeder.${k}` as Key, params);
/** One command at a time for the whole panel, not per sheet: closing and reopening the sheet during a slow dispense must not feed twice. */
let commandRunning = false;
/** When the last dispense was sent: the journal lags, and a second tap in that minute would feed twice. */
let lastFeed = 0, lastFeedSure = true;
const FEED_LOCK_MS = 60000, ZONE_KEY = 'atom-home-feeder-tz', known = new Map<string, { log: FeederLog; at: number }>(), PLAN_KEY = 'atom-home-feeder-plan';
const storedZone = () => { try { return parseZone(localStorage.getItem(ZONE_KEY)); } catch { return null; } };
/** The journal lives in Xiaomi's cloud: read on open and every two minutes while visible. A failed read keeps the last good journal; a reopened sheet starts from what is known. */
function useLog(host: Host, entity?: string) {
  const [state, setState] = useState<{ log: FeederLog | null; answered: boolean; fetchedAt: number }>(() => { const k = entity ? known.get(entity) : undefined; return { log: k?.log ?? null, answered: !!k, fetchedAt: k?.at ?? 0 }; });
  const load = useRef<(fresh?: boolean) => void>(() => {});
  useEffect(() => { if (!entity || !host.feederLog) { setState({ log: null, answered: true, fetchedAt: 0 }); return; } let alive = true; load.current = fresh => { if (document.hidden && !fresh) return; void host.feederLog!(entity, fresh).then(v => { if (!alive) return; const at = Date.now(); if (v) { known.set(entity, { log: v, at }); if (parseZone(v.tz) !== null) try { localStorage.setItem(ZONE_KEY, String(v.tz)); } catch { /* private mode */ } } setState(s => ({ log: v ?? s.log, answered: true, fetchedAt: v ? at : s.fetchedAt })); }); }; const tick = () => load.current(); tick(); const timer = setInterval(tick, 120000); document.addEventListener('visibilitychange', tick); return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', tick); }; }, [host, entity]);
  return { ...state, refresh: () => load.current(true) };
}
/** What both the tile and the sheet read from the feeder. */
function read({ registry, entities, host, t, lang }: Props, log: FeederLog | null, fetchedAt: number) {
  const st = (role: string) => { const id = entities[role]; return id ? registry.states[id] : undefined; };
  const feed = st('feed'), available = !!feed && feed.state !== 'unavailable' && host.online;
  const bowlS = st('bowl'), bowl = bowlS && Number.isFinite(Number(bowlS.state)) ? Number(bowlS.state) : null;
  // unavailable / unknown is not «enough food», not «by hand» and not «normal»: three states everywhere (audit 2026-11-09)
  const stock = st('stock')?.state, stockKnown = stateKnown(stock), low = stock === 'low', planS = st('plan'), planOn: boolean | null = planS ? onOff(planS.state) : false;
  const rawPlan = st('info')?.attributes[SCHEDULE_ATTR], schedule = parseFeederSchedule(rawPlan), plan = planState(rawPlan);
  const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const zone = parseZone(log?.tz) ?? storedZone(), shift = clockShift(zone === null ? null : { tz: zone, events: [], desiccant: null }, now), meals = (schedule?.meals ?? []).map(m => ({ ...m, time: shiftTime(m.time, -shift) })).sort((a, b) => a.time.localeCompare(b.time));
  // a journal read long ago is told with its hour; one read yesterday knows nothing of what was eaten today
  const age = journalAge(fetchedAt, now.getTime()), stale = !!log && age.stale, asOf = !stale ? '' : tk(t, 'dataAt', { time: `${age.sameDay ? '' : `${new Date(fetchedAt).toLocaleDateString(lang, { day: 'numeric', month: 'short' })}, `}${clock(Math.floor(fetchedAt / 1000))}` });
  // the tile's line holds twelve characters on a phone: the hour, or the day when the journal is not of today
  const asOfShort = !stale ? '' : tk(t, 'dataAtTile', { time: age.sameDay ? clock(Math.floor(fetchedAt / 1000)) : new Date(fetchedAt).toLocaleDateString(lang, { day: '2-digit', month: '2-digit' }) });
  const next = planOn !== false ? nextMeal(meals, hhmm) : null, today = dayKey(now), eaten = log && !(stale && !age.sameDay) ? eatenOn(log, today) : null;
  const lastAte = eventsOf(log, today).filter(e => e.kind === 'ate').pop(), hour = now.getHours(), ago = lastAte ? Date.now() / 1000 - lastAte.at : Infinity;
  const outAbnormal = st('outStatus')?.state === 'abnormal', stuck = st('stuck')?.state === 'abnormal', batteryLow = st('battery')?.state === 'on';
  // the desiccant comes from the cloud: the local property reads 0 % on this firmware while Mi Home shows the true value
  const desiccantDue = !!log?.desiccant && log.desiccant.level <= 5;
  const faults = [!available && host.online && tk(t, 'offline'), stuck && tk(t, 'stuckNow'), outAbnormal && t('module.feeder.outAbnormal')].filter((x): x is string => !!x);
  const warnings = [low && t('module.feeder.stockLow'), batteryLow && tk(t, 'batteryNow'), desiccantDue && t('module.feeder.desiccantDue')].filter((x): x is string => !!x);
  // an empty bowl between meals is the normal state: the cat is sad only over a fault or when it has really gone long without food
  const lastEver = (log?.events ?? []).filter(e => e.kind === 'ate').reduce((m, e) => Math.max(m, e.at), 0), hungry = !!log && !stale && (bowlS ? bowl === 0 : true) && Date.now() / 1000 - lastEver > 6 * 3600;
  const mood: Mood = faults.length ? 'hungry' : ago >= 0 && ago < 240 ? 'eating' : hour >= 23 || hour < 6 ? 'sleep' : bowl ? 'full' : hungry ? 'hungry' : 'calm';
  return { st, available, bowl, stock, stockKnown, low, planS, planOn, schedule, plan, meals, shift, hhmm, next, today, eaten, mood, faults, warnings, stale, asOf, asOfShort, catLabel: available ? tk(t, `cat.${mood}`) : tk(t, 'offline') };
}
const FUR = '#ffae3b', FUR_DARK = '#f0921c', CREAM = '#ffe2b5', INK = '#2b2118', PINK = '#ff8f7a';
/** The head alone, on the sheet's title and inside every pose. */
function CatHead({ mood }: { mood: Mood }) {
  const happy = mood === 'full', closed = mood === 'eating' || mood === 'sleep', sad = mood === 'hungry';
  return <g>
    <path d="M70 44 62 6l40 23zM170 44l8-38-40 23z" fill={FUR} /><path d="M75 34 71 16l19 11zM165 34l4-18-19 11z" fill={PINK} />
    <ellipse cx="120" cy="66" rx="60" ry="48" fill={FUR} />
    <path d="M120 19v15M104 21l3 13M136 21l-3 13" stroke={FUR_DARK} stroke-width="5" stroke-linecap="round" />
    <path d="M62 62h13M61 76l13-2M178 62h-13M179 76l-13-2" stroke={FUR_DARK} stroke-width="4" stroke-linecap="round" />
    {happy && <path d="M86 72q10-13 20 0M134 72q10-13 20 0" fill="none" stroke={INK} stroke-width="4.5" stroke-linecap="round" />}
    {closed && <path d="M86 68q10 9 20 0M134 68q10 9 20 0" fill="none" stroke={INK} stroke-width="4.5" stroke-linecap="round" />}
    {!happy && !closed && <g className="at-cat-eyes"><ellipse cx="96" cy="68" rx="10" ry="12.5" fill={INK} /><ellipse cx="144" cy="68" rx="10" ry="12.5" fill={INK} /><circle cx="92" cy="62" r="3.8" fill="#fff" /><circle cx="140" cy="62" r="3.8" fill="#fff" /><circle cx="99" cy="73" r="1.8" fill="#fff" /><circle cx="147" cy="73" r="1.8" fill="#fff" /></g>}
    {sad && <path d="M84 53l18-6M156 53l-18-6" stroke={INK} stroke-width="3.6" stroke-linecap="round" />}
    <ellipse cx="80" cy="86" rx="11" ry="7" fill={PINK} opacity=".5" /><ellipse cx="160" cy="86" rx="11" ry="7" fill={PINK} opacity=".5" />
    <path d="M115 81h10l-5 5.5z" fill="#d9604a" />
    {sad ? <path d="M112 96q8-6 16 0" fill="none" stroke={INK} stroke-width="3" stroke-linecap="round" /> : <path d="M120 87q-1 8-9 7M120 87q1 8 9 7" fill="none" stroke={INK} stroke-width="3" stroke-linecap="round" />}
    <path d="M60 80l-17-4M60 90l-17 2M180 80l17-4M180 90l17 2" stroke={INK} stroke-opacity=".3" stroke-width="2.2" stroke-linecap="round" />
  </g>;
}
const Bowl = ({ food }: { food: boolean }) => <g>{food && <g fill="#b0702c"><circle cx="24" cy="130" r="4.5" /><circle cx="35" cy="126" r="5" /><circle cx="46" cy="129" r="4.5" /><circle cx="30" cy="123" r="4" /><circle cx="42" cy="122" r="4" /></g>}<path d="M8 132h56l-8 26H16z" className="at-cat-bowl" /><path d="M8 132h56" stroke="#00000024" stroke-width="2.4" stroke-linecap="round" /></g>;
/** Our own cat, drawn for this card. It tells the bowl's story at a glance: looks at an empty bowl, eats with its head down, sits content, curls up at night. */
function CatArt({ mood, grams, label }: { mood: Mood; grams: number | null; label?: string }) {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true }, food = (grams ?? 0) > 0 || mood === 'eating';
  if (mood === 'sleep') return <svg className="at-cat is-sleep" viewBox="0 0 240 170" {...a11y}><ellipse cx="124" cy="160" rx="104" ry="7" className="at-cat-shadow" /><Bowl food={food} />
    <path d="M196 140c24-4 26-34 2-40" fill="none" stroke={FUR_DARK} stroke-width="15" stroke-linecap="round" /><ellipse cx="146" cy="124" rx="62" ry="36" fill={FUR} /><path d="M160 92v16M176 96l-3 14M144 92l3 15" stroke={FUR_DARK} stroke-width="5" stroke-linecap="round" />
    <g transform="translate(26 54) scale(.72)"><CatHead mood="sleep" /></g><text x="196" y="44" className="at-cat-z">z</text><text x="212" y="26" className="at-cat-z is-small">z</text></svg>;
  if (mood === 'eating') return <svg className="at-cat is-eating" viewBox="0 0 240 170" {...a11y}><ellipse cx="116" cy="160" rx="108" ry="7" className="at-cat-shadow" />
    <path className="at-cat-tail" d="M186 146c24 2 34-14 28-34" fill="none" stroke={FUR_DARK} stroke-width="15" stroke-linecap="round" /><path d="M116 160c-6-40 12-74 44-74s42 40 34 74z" fill={FUR} /><ellipse cx="146" cy="154" rx="15" ry="8" fill="#ffc97c" />
    <g className="at-cat-nod"><g transform="translate(4 62) rotate(-16 120 100) scale(.78)"><CatHead mood="eating" /></g></g><Bowl food={food} /></svg>;
  return <svg className={`at-cat is-${mood}`} viewBox="0 0 240 170" {...a11y}><ellipse cx="124" cy="160" rx="108" ry="7" className="at-cat-shadow" /><Bowl food={food} />
    <path className="at-cat-tail" d="M172 150c26 2 38-14 32-38" fill="none" stroke={FUR_DARK} stroke-width="15" stroke-linecap="round" />
    <path d="M90 160c-12-30-2-68 40-68s52 38 40 68z" fill={FUR} /><ellipse cx="130" cy="136" rx="23" ry="24" fill={CREAM} /><ellipse cx="108" cy="155" rx="17" ry="9" fill="#ffc97c" /><ellipse cx="152" cy="155" rx="17" ry="9" fill="#ffc97c" />
    <g transform={mood === 'hungry' ? 'translate(5 2) rotate(-7 130 100) scale(.86)' : 'translate(19 3) scale(.92)'}><CatHead mood={mood} /></g></svg>;
}
const GLYPH: Record<string, string> = { bowl: 'M4 10h16l-2 8a2 2 0 0 1-2 1.5H8A2 2 0 0 1 6 18zM8 7.5h.01M12 6h.01M16 7.5h.01', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2', bars: 'M5 20v-6M12 20V5M19 20v-9', target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', waves: 'M8 4c-2 3 2 5 0 8s2 5 0 8M16 4c-2 3 2 5 0 8s2 5 0 8', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1' };
const Glyph = ({ name, size = 22 }: { name: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={GLYPH[name]} /></svg>;
type View = 'main' | 'journal' | 'plan' | 'stats' | 'desiccant' | 'settings';
/** ST-15: the sheet scrolls so that `el` — or, when `el` is taller than what is seen, `safe` — stands whole in the part of the sheet a person sees:
 * the sheet ∩ the scrim ∩ the visual viewport, under the sheet's head when it stays on top, 8 px inside. `hidden`: only when `el` is not whole in sight already. */
function reveal(sheet: HTMLElement, el: HTMLElement, safe: HTMLElement, hidden = false) {
  const s = sheet.getBoundingClientRect(), vv = window.visualViewport, scrim = (sheet.getRootNode() as Document | ShadowRoot).querySelector?.('.hm-scrim')?.getBoundingClientRect();
  let top = Math.max(s.top, vv ? vv.offsetTop : 0), bottom = Math.min(s.bottom, vv ? vv.offsetTop + vv.height : innerHeight);
  if (scrim && scrim.height > 0) { top = Math.max(top, scrim.top); bottom = Math.min(bottom, scrim.bottom); }
  const head = sheet.querySelector<HTMLElement>('.hm-sheet-head'); if (head && /sticky|fixed/.test(getComputedStyle(head).position)) { const h = head.getBoundingClientRect(); if (h.bottom > top && h.top < bottom) top = Math.max(top, h.bottom); }
  const box = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }, at = box(el);
  if (hidden && at.top >= top - 1 && at.bottom <= bottom + 1) return;
  sheet.scrollTop = askScroll({ top: top + 8, bottom: bottom - 8 }, at, box(safe), { top: sheet.scrollTop, max: sheet.scrollHeight - sheet.clientHeight, scale: sheet.offsetHeight ? s.height / sheet.offsetHeight : 1 });
}
const pad2 =(n: number) => String(n).padStart(2, '0');
/** Xiaomi MIOT pet feeder: everything the Mi Home card offers, in the panel's language. */
export function FeederSheet(props: Props & { room?: string; onClose: () => void; automations?: SheetAutomation[]; wide?: boolean }) {
  const { entities, options, host, t, lang, room, onClose, automations = [], wide } = props;
  const { log, answered, fetchedAt, refresh } = useLog(host, entities.info);
  const { st, available, bowl, stock, stockKnown, low, planS, planOn, schedule, plan, meals, shift, hhmm, next, today, eaten, mood, faults, warnings, stale: aged, asOf, catLabel } = read(props, log, fetchedAt);
  const grams = optionInt(options.portionGrams, 10, 1, 200), max = optionInt(options.maxPortions, 15, 1, 50), unit = tk(t, 'g');
  const [view, setView] = useState<View>('main'), [day, setDay] = useState(today), [statDay, setStatDay] = useState(today), [range, setRange] = useState<'day' | 'week'>('day');
  const [feedOpen, setFeedOpen] = useState(false), [dose, setDose] = useState(1), [confirm, setConfirm] = useState<'plan' | 'save' | 'reset' | 'calibrate' | null>(null), [busy, setBusy] = useState(false), [said, setSaid] = useState<{ text: string; bad: boolean }>({ text: '', bad: false });
  // one line for what the feeder answered: a refusal is an alert (said at once by a screen reader), «отправлено» a status
  const note = said.text, setNote = (text: string, bad = false) => setSaid({ text, bad });
  const [draft, setDraft] = useState<{ original: string; meals: FeederMeal[]; shift: number } | null>(null), [expected, setExpected] = useState<{ raw: string; before: string; meals: FeederMeal[]; late: boolean } | null>(null), [, setTick] = useState(0);
  // a plan changed elsewhere, or a clock learned after the editor opened, makes the draft's times wrong
  const stale = !!draft && !!schedule && (draft.original !== schedule.raw || draft.shift !== shift);
  const pendingPlan = !!expected && !expected.late && schedule?.raw === expected.before, planLate = !!expected?.late && schedule?.raw === expected.before;
  useEffect(() => { if (!expected) return; if (schedule && schedule.raw !== expected.before) { setExpected(null); return; } if (expected.late) return; const late = setTimeout(() => setExpected(e => e && { ...e, late: true }), 90000); return () => clearTimeout(late); }, [expected, schedule?.raw]);
  // a meal is «missed» only against a plan that stood at that hour: remember when the plan last changed
  const planStamp = useRef<{ raw: string; on: boolean; at: number } | null>(null);
  if (schedule && planOn !== null && (!planStamp.current || planStamp.current.raw !== schedule.raw || planStamp.current.on !== planOn)) { let v: { raw: string; on: boolean; at: number } | null = null; if (!planStamp.current) try { v = JSON.parse(localStorage.getItem(PLAN_KEY) ?? 'null'); } catch { v = null; } if (v?.raw === schedule.raw && v?.on === planOn) planStamp.current = v; else { planStamp.current = { raw: schedule.raw, on: planOn, at: Date.now() }; try { localStorage.setItem(PLAN_KEY, JSON.stringify(planStamp.current)); } catch { /* private mode */ } } }
  const feedLocked = Date.now() - lastFeed < FEED_LOCK_MS;
  useEffect(() => { if (!feedLocked) return; const left = FEED_LOCK_MS - (Date.now() - lastFeed), unlock = setTimeout(() => setTick(n => n + 1), left + 50); return () => clearTimeout(unlock); });
  // the draft keeps the shift it was opened with: a journal arriving later must not move the plan by an hour
  const draftValue = () => { try { return draft ? editFeederSchedule(draft.original, mealsForFeeder(draft.meals, draft.shift)) : null; } catch { return null; } };
  const portions = (n: number) => t('module.feeder.portions', { n }), approx = (n: number) => t('module.feeder.approx', { g: n * grams });
  const run = async (call: { domain: string; service: string; data: Record<string, unknown> }, okText = t('module.feeder.sent')): Promise<boolean | 'unknown'> => {
    if (commandRunning) { setNote(tk(t, 'stillRunning')); return false; }
    if (!host.online) { setNote(t('ui.offline'), true); setConfirm(null); return false; } // the house is not there: nothing is sent, so nothing is locked
    commandRunning = true; setBusy(true); setNote(''); // module-wide, not state: three taps in one frame or a reopened sheet must feed the cat once
    try { await host.call(call.domain, call.service, call.data); setNote(okText); setFeedOpen(false); return true; }
    catch (e) {
      const code = (e as { code?: unknown } | null)?.code, text = errorText(e, t);
      if (code === 'offline') { setNote(text, true); return false; } // the panel itself refused to send (runtime/commands.ts): the feeder got nothing
      if (!host.online || code === 3 || /connection/i.test(String((e as { message?: unknown } | null)?.message ?? ''))) { setNote(tk(t, 'unknownResult'), true); return 'unknown'; }
      setNote(text === t('error.command') ? t('module.feeder.fail') : `${t('module.feeder.fail')}. ${text}`, true); return false; // the reason in the user's language; never «[object Object]» or a parser's English
    }
    finally { commandRunning = false; setBusy(false); setConfirm(null); }
  };
  const feed = async () => { const ok = await run(feedCall(entities.feed!, dose, max), ''); if (!ok) return; lastFeed = Date.now(); lastFeedSure = ok === true; setTick(n => n + 1); setDose(1); setFeedOpen(false); if (ok === true) setNote(''); setTimeout(refresh, 20000); setTimeout(refresh, 60000); }; // a lost answer locks too: the food may have dropped
  const bodyRef = useRef<HTMLDivElement>(null), firstView = useRef(true);
  // a new page of the sheet starts at its top, and keyboard and screen-reader focus lands on it instead of falling out of the dialog
  useEffect(() => { if (firstView.current) { firstView.current = false; return; } const body = bodyRef.current; if (!body) return; const sheet = body.closest('.hm-sheet'); if (sheet) sheet.scrollTop = 0; body.querySelector<HTMLElement>('.at-fd-back, .hm-sheet-head .hm-icon-btn')?.focus({ preventScroll: true }); }, [view]);
  // a question takes the focus, so that a screen reader says it — first brought whole into the part of the sheet a person sees, and the first focus
  // is its safe «Закрыть», so Enter answers «no» (ST-15: «Сохранить» sat under the screen's edge while the focus went to the unseen «Сохранить»)
  // Escape answers «no» to the question and closes it alone, not the whole sheet (the shell's own Escape closes the sheet: the key is stopped
  // here first); the focus then returns to the control that asked, and the sheet to where it stood — only on the same page, in the same body,
  // with that control still there (a new page, «Назад», a saved plan or a closed sheet drop the remembered place: `askSnap`)
  const asker = useRef<HTMLElement | null>(null), busyNow = useRef(busy), viewNow = useRef(view), askRef = useRef<HTMLDivElement>(null), safeRef = useRef<HTMLButtonElement>(null), askSnap = useRef<{ view: View; body: HTMLElement; top: number } | null>(null);
  busyNow.current = busy; viewNow.current = view;
  useEffect(() => {
    const body = bodyRef.current, active = () => ((body?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement as HTMLElement | null | undefined) ?? null, sheet = body?.closest<HTMLElement>('.hm-sheet') ?? null;
    if (!confirm) { const back = asker.current, snap = askSnap.current; asker.current = null; askSnap.current = null; const at = active(), usable = !!back?.isConnected && !(back as HTMLButtonElement).disabled;
      if (snap && sheet && usable && body?.isConnected && snap.body === body && snap.view === viewNow.current && body.contains(back)) { sheet.scrollTop = snap.top; reveal(sheet, back!, back!, true); }
      if (usable && (!at || !body?.contains(at))) back!.focus({ preventScroll: true }); return; }
    if (!body) return; asker.current ??= active(); if (!askSnap.current && sheet) askSnap.current = { view: viewNow.current, body, top: sheet.scrollTop };
    const show = () => { const q = askRef.current, safe = safeRef.current; if (sheet && q && safe) reveal(sheet, q, safe); };
    show(); safeRef.current?.focus({ preventScroll: true });
    // the window or the on-screen keyboard changes size while the question is open: it is brought back into sight, as long as the focus is in it
    const resize = () => { if (askRef.current?.contains(active())) show(); }, vv = window.visualViewport;
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.defaultPrevented) return; e.preventDefault(); e.stopPropagation(); if (!busyNow.current) setConfirm(null); };
    body.addEventListener('keydown', key); addEventListener('resize', resize); vv?.addEventListener('resize', resize);
    return () => { body.removeEventListener('keydown', key); removeEventListener('resize', resize); vv?.removeEventListener('resize', resize); };
  }, [confirm]);
  const go = (v: View) => { askSnap.current = null; setView(v); setConfirm(null); setNote(''); if (v === 'journal') setDay(today); if (v === 'stats') setStatDay(today); };
  const head = (title: string) => <div className="hm-sheet-head at-fd-head">{view === 'main' ? <span className="at-fd-face" aria-hidden="true"><svg viewBox="52 0 136 118"><CatHead mood={mood === 'sleep' ? 'sleep' : 'calm'} /></svg></span> : <button type="button" className="hm-icon-btn at-fd-back" aria-label={t('ui.back' as Key)} onClick={() => { askSnap.current = null; setView('main'); setDraft(null); setConfirm(null); setNote(''); }}><Icon name="back" size={20} /></button>}<div>{view === 'main' && room && <small>{room}</small>}<h2>{title}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>;
  // a switch whose own entity says nothing (unavailable, unknown, gone) is not «выкл»: the row says so in words and offers no switch to flip blindly
  const toggle = (role: string, label: string, hint?: string, icon?: string) => { const state = st(role)?.state, on = onOff(state); return <div className="ah-row hm-setting at-fd-row" data-feeder-switch={role}>{icon && <span className="at-fd-ico"><Glyph name={icon} /></span>}<span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>{on === null ? <small>{t(state === 'unknown' ? 'state.unknown' : 'state.unavailable')}</small> : <Switch on={on} pending={busy} disabled={!available} label={label} onToggle={() => void run({ domain: 'switch', service: on ? 'turn_off' : 'turn_on', data: { entity_id: entities[role] } }, '')} />}</div>; };
  const link = (icon: string, label: string, value: string, v: View) => <button type="button" className="ah-row hm-setting is-button at-fd-row" onClick={() => go(v)}><span className="at-fd-ico"><Glyph name={icon} /></span><span className="ah-row-text"><strong>{label}</strong>{value && <small>{value}</small>}</span><Icon name="next" size={18} /></button>;
  const ask = (text: string, yes: () => void, yesLabel: string) => <div ref={askRef} className="at-feeder-confirm" role="alertdialog" aria-label={text}><span>{text}</span><div className="at-fd-ask-btns"><button type="button" className="hm-pill at-fd-amber" disabled={busy || !available} onClick={yes}>{yesLabel}</button><button ref={safeRef} type="button" className="hm-pill" disabled={busy} onClick={() => setConfirm(null)}>{t('ui.close')}</button></div></div>;
  const notice = note ? <p className="at-feeder-note" role={said.bad ? 'alert' : 'status'} key={said.bad ? 'bad' : 'ok'}>{note}</p> : null;
  const clockNote = shift !== 0 ? <p className="at-fd-tz"><Icon name="warning" size={14} />{tk(t, shift > 0 ? 'clockAhead' : 'clockBehind', { h: Math.abs(shift) / 60 })}</p> : answered && (parseZone(log?.tz) ?? storedZone()) === null ? <p className="at-fd-tz">{tk(t, 'feederTime')}</p> : null;
  /* the day as a line: what happened, then what is still planned */
  const timeline = (key: string, limit?: number) => {
    const events = eventsOf(log, key), minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
    const done = events.map(e => ({ time: clock(e.at), past: true, next: false, missed: false, text: e.kind === 'ate' ? tk(t, 'ate', { g: e.grams }) : tk(t, e.kind === 'plan' ? 'fedPlan' : 'fedManual', { n: portions(Math.max(1, Math.round(e.grams / grams))) }) }));
    // a plan meal that passed a quarter of an hour ago with no dispense on record: the owner should see it, not lose it
    const fedAt = events.filter(e => e.kind === 'plan').map(e => minutes(clock(e.at)));
    const stood = planStamp.current?.at ?? 0, planFrom = stood && dayKey(new Date(stood)) === today ? minutes(clock(Math.floor(stood / 1000))) : -1;
    // a dispense that came late closes its meal (feeder-log.ts missedMeals): never «Не выдано» and «По плану» for one meal
    const lost = key === today && planOn === true && log && !aged ? new Set(missedMeals(meals.map(m => minutes(m.time)), fedAt, minutes(hhmm)).filter(m => m > planFrom)) : new Set<number>();
    const missed = meals.filter(m => lost.has(minutes(m.time))).map(m => ({ time: m.time, past: true, next: false, missed: true, text: tk(t, 'notFed', { n: portions(m.portions) }) }));
    const planned = key === today && planOn !== false ? meals.filter(m => m.time > hhmm).map(m => ({ time: m.time, past: false, next: next?.time === m.time, missed: false, text: `${portions(m.portions)} · ${approx(m.portions)}` })) : [];
    const rows = [...done, ...missed, ...planned].sort((a, b) => a.time.localeCompare(b.time)), shown = limit ? rows.filter((r, i) => r.missed || i >= rows.length - limit) : rows;
    return shown.length ? <ol className="at-fd-line">{shown.map(r => <li className={`${r.past ? 'is-past' : ''} ${r.next ? 'is-next' : ''} ${r.missed ? 'is-missed' : ''}`}><i /><b>{r.time}</b><span>{r.text}</span>{r.next && <em>{t('module.feeder.next')}</em>}</li>)}</ol> : <p className="at-fd-empty">{tk(t, 'noJournal')}</p>;
  };
  const alerts = (faults.length > 0 || warnings.length > 0) && <div className="at-fd-alerts" role="status">{faults.map(w => <p className="is-fault"><Icon name="warning" size={18} />{w}</p>)}{warnings.map(w => <p className="is-warn"><Icon name="warning" size={18} />{w}</p>)}</div>;
  if (view === 'journal') { const days = weekOf(log); return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(tk(t, 'journal'))}
    <div className="at-fd-days" role="tablist">{days.map(d => <button type="button" role="tab" aria-selected={d.key === day} className={`${d.key === day ? 'is-active' : ''} ${d.grams ? '' : 'is-empty'}`} onClick={() => setDay(d.key)}><small>{d.date.toLocaleDateString(lang, { weekday: 'short' })}</small><b>{d.date.getDate()}</b></button>)}</div>
    <div className="ah-group"><small className="ah-group-title">{day === today ? tk(t, 'today') : new Date(day + 'T12:00').toLocaleDateString(lang, { day: 'numeric', month: 'long' })}{log ? ` · ${num(eatenOn(log, day), lang, 0)} ${unit}` : ''}</small>{timeline(day)}</div>{aged && <p className="at-fd-tz">{asOf}</p>}</div>; }
  if (view === 'stats') { const week = weekOf(log), hours = hoursOf(log, statDay), dayTotal = hours.reduce((s, g) => s + g, 0), total = week.reduce((s, d) => s + d.grams, 0), seen = week.filter(d => d.grams > 0).length, values = range === 'day' ? hours : week.map(d => d.grams), peak = Math.max(1, ...values), avg = seen ? Math.round(total / seen) : 0, idx = week.findIndex(d => d.key === statDay), summary = range === 'day' ? `${dayTotal} ${unit}` : week.map(d => `${d.date.getDate()}: ${d.grams} ${unit}`).join(', '), step = (by: number) => { const n = week[idx + by]; if (n) setStatDay(n.key); }; return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(tk(t, 'statsTitle'))}
    <div className="ah-segments hm-range-tabs" role="tablist"><button type="button" role="tab" aria-selected={range === 'day'} className={range === 'day' ? 'is-active' : ''} onClick={() => setRange('day')}>{tk(t, 'day')}</button><button type="button" role="tab" aria-selected={range === 'week'} className={range === 'week' ? 'is-active' : ''} onClick={() => setRange('week')}>{tk(t, 'week')}</button></div>
    <div className="ah-group at-fd-stats">
      {range === 'day' && <div className="at-fd-date"><button type="button" className="hm-icon-btn" aria-label={tk(t, 'prevDay')} disabled={idx <= 0} onClick={() => step(-1)}><Icon name="back" size={18} /></button><strong>{statDay === today ? tk(t, 'today') : new Date(statDay + 'T12:00').toLocaleDateString(lang, { day: 'numeric', month: 'long' })}</strong><button type="button" className="hm-icon-btn" aria-label={tk(t, 'nextDay')} disabled={idx >= week.length - 1} onClick={() => step(1)}><Icon name="next" size={18} /></button></div>}
      <div className="at-fd-big"><b>{log ? num(range === 'day' ? dayTotal : total, lang, 0) : '—'}</b>{log && <i>&nbsp;{unit}</i>}<small>{range === 'day' ? tk(t, 'gEaten') : tk(t, 'gWeek')}{range === 'week' && seen > 0 ? ` · ${tk(t, 'avgDay', { g: avg })}` : ''}</small></div>
      <div className={`at-fd-chart ${range === 'day' ? 'is-day' : 'is-week'}`} role="img" aria-label={summary}><span className="at-fd-scale"><small>{peak}</small><small>0</small></span>
        <div className="at-fd-bars">{range === 'week' && seen > 0 && <hr style={`bottom:calc(${avg / peak} * (100% - 24px) + 24px)`} />}{range === 'day' ? hours.map(g => <span><i style={`height:${g ? Math.max(6, g / peak * 100) : 0}%`} /></span>) : week.map(d => <span className={d.grams ? '' : 'is-empty'}><u><i style={`height:${d.grams ? Math.max(5, d.grams / peak * 100) : 0}%`} /></u><small>{d.date.toLocaleDateString(lang, { weekday: 'short' })}</small></span>)}</div></div>
      {range === 'day' && <div className="at-fd-axis"><small>00</small><small>12</small><small>24</small></div>}</div></div>; }
  if (view === 'desiccant') { const level = log?.desiccant?.level ?? null, left = log?.desiccant?.days ?? null; return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(t('module.feeder.desiccant'))}
    <div className="ah-group at-fd-ring-box"><svg viewBox="0 0 120 120" className="at-fd-ring" aria-hidden="true"><circle cx="60" cy="60" r="50" /><circle cx="60" cy="60" r="50" className="is-value" pathLength="100" stroke-dasharray={`${level ?? 0} 100`} transform="rotate(-90 60 60)" /></svg><div className="at-fd-ring-text"><b>{level === null ? '—' : num(level, lang, 0)}{level !== null && <i>%</i>}</b></div><small>{left === null ? tk(t, answered ? 'noCloud' : 'loading') : tk(t, 'desicUse', { d: left, n: left })}</small></div>
    <div className="ah-rows"><div className="ah-row hm-setting"><span className="ah-row-text"><strong>{tk(t, 'desicCycle')}</strong></span><small>{tk(t, 'desicCycleV')}</small></div>{entities.resetDesiccant && <button type="button" className="ah-row hm-setting is-button" disabled={busy || !available} onClick={() => setConfirm('reset')}><span className="ah-row-text"><strong>{tk(t, 'resetDesiccant')}</strong></span><Icon name="next" size={18} /></button>}</div>
    {confirm === 'reset' && ask(tk(t, 'resetConfirm'), () => void run({ domain: 'button', service: 'press', data: { entity_id: entities.resetDesiccant } }, tk(t, 'resetDone')), tk(t, 'resetYes'))}{notice}</div>; }
  if (view === 'settings') { const scr = st('screen'), opts = (scr?.attributes.options as string[] | undefined) ?? []; const statuses: Array<[string, string, boolean]> = [];
    // a sensor that says nothing is «Нет данных», not «Норма»
    const status = (role: string, label: string, badState: string, badText: string) => { if (!entities[role]) return; const s = st(role)?.state, bad = s === badState; statuses.push([label, bad ? badText : stateKnown(s) ? tk(t, 'normal') : t('state.unknown'), bad]); };
    status('stuck', tk(t, 'stuck'), 'abnormal', tk(t, 'abnormal')); status('outStatus', tk(t, 'dispense'), 'abnormal', tk(t, 'abnormal')); status('battery', tk(t, 'battery'), 'on', tk(t, 'batteryLow'));
    const screenLabel = (o: string) => { const k = `module.feeder.screen.${o}` as Key; return t(k) === k ? o : t(k); };
    return <div ref={bodyRef} className={`hm-sheet-body ah-sheet at-feeder-sheet ${wide ? 'is-split' : ''}`} data-view={view} data-kind="feeder">{head(tk(t, 'settings'))}<div className="at-feeder-col">
    <div className="ah-rows">{entities.lock && toggle('lock', tk(t, 'lock'), tk(t, 'lockHint'))}{entities.screen && scr && <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{tk(t, 'screen')}</strong></span><select value={scr.state} disabled={busy || !available} aria-label={tk(t, 'screen')} onChange={e => void run({ domain: 'select', service: 'select_option', data: { entity_id: entities.screen, option: (e.target as HTMLSelectElement).value } }, '')}>{opts.map(o => <option value={o}>{screenLabel(o)}</option>)}</select></div>}{entities.reminder && toggle('reminder', tk(t, 'reminder'), tk(t, 'reminderHint'))}{entities.noPile && toggle('noPile', tk(t, 'noPile'), tk(t, 'noPileHint'))}{entities.calibrate && <button type="button" className="ah-row hm-setting is-button" disabled={busy || !available} onClick={() => setConfirm('calibrate')}><span className="ah-row-text"><strong>{tk(t, 'calibrate')}</strong><small>{tk(t, 'calibrateHint')}</small></span><Icon name="next" size={18} /></button>}</div>
    {confirm === 'calibrate' && ask(tk(t, 'calibrateConfirm'), () => void run({ domain: 'button', service: 'press', data: { entity_id: entities.calibrate } }, tk(t, 'calibrateDone')), tk(t, 'calibrateYes'))}{notice}</div><div className="at-feeder-col">
    {statuses.length > 0 && <div className="ah-rows">{statuses.map(([k, v, bad]) => <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{k}</strong></span><small className={bad ? 'at-fd-bad' : ''}>{v}</small></div>)}</div>}<Automations rows={automations} t={t} lang={lang} /><p className="at-fd-empty">{tk(t, 'inMiHome')}</p></div></div>; }
  if (view === 'plan') { const setMeal = (n: number, patch: Partial<FeederMeal>) => setDraft(d => d && { ...d, meals: d.meals.map((x, k) => k === n ? { ...x, ...patch } : x) }); return <div ref={bodyRef} className="hm-sheet-body ah-sheet at-feeder-sheet" data-view={view} data-kind="feeder">{head(tk(t, 'auto'))}
    <div className="ah-rows">{planS && <div className="ah-row hm-setting at-fd-row"><span className="ah-row-text"><strong>{tk(t, 'auto')}</strong><small>{planOn === null ? t('state.unknown') : tk(t, 'autoHint')}</small></span><Switch on={planOn === true} pending={busy} disabled={!available || planOn === null} label={tk(t, 'auto')} onToggle={() => setConfirm(confirm === 'plan' ? null : 'plan')} /></div>}</div>
    {confirm === 'plan' && planOn !== null && ask(tk(t, planOn ? 'planOffAsk' : 'planOnAsk'), () => void run({ domain: 'switch', service: planOn ? 'turn_off' : 'turn_on', data: { entity_id: entities.plan } }, ''), tk(t, planOn ? 'turnOff' : 'turnOn'))}
    <div className="ah-group"><div className="at-fd-sums"><div><b>{plan !== 'ok' ? '—' : (pendingPlan ? expected!.meals : meals).reduce((s, m) => s + m.portions, 0)}</b><small>{t('module.feeder.dose')}</small></div><div><b>{plan !== 'ok' ? '—' : meals.length}</b><small>{tk(t, 'timesDay')}</small></div></div>
      {plan === 'unparsed' && <p className="at-feeder-note" data-feeder-plan="unparsed">{tk(t, 'planUnparsed')}</p>}
      {pendingPlan && !draft && <p className="at-fd-tz">{tk(t, 'planPending')}</p>}{planLate && !draft && <p className="at-feeder-note" role="status">{tk(t, 'planNotApplied')}</p>}{!draft && <ol className="at-fd-line is-plan">{(pendingPlan ? expected!.meals : meals).map(m => { const isNext = !pendingPlan && next?.time === m.time; return <li className={isNext ? 'is-next' : ''}><i /><b>{m.time}</b><span>{portions(m.portions)} · {approx(m.portions)}</span>{isNext && <em>{t('module.feeder.next')}</em>}</li>; })}</ol>}
      {!draft && entities.info && meals.length > 0 && <button type="button" className="hm-pill at-fd-edit" disabled={busy || !available || !answered || pendingPlan} onClick={() => { setDraft({ original: schedule!.raw, meals: meals.map(m => ({ ...m })), shift }); setNote(''); setConfirm(null); }}>{t('module.feeder.edit')}</button>}
      {draft && <div className="at-fd-editor" data-feeder-editor><div className="at-fd-edit-head"><small>{t('module.feeder.time')}</small><small>{t('module.feeder.dose')}</small></div>{draft.meals.map((m, n) => { const [h, mi] = m.time.split(':'); return <div className="at-fd-edit-row"><div className="at-fd-time"><select aria-label={`${t('module.feeder.time')} ${n + 1}: ${tk(t, 'hours')}`} value={h} disabled={busy} onChange={e => setMeal(n, { time: `${(e.target as HTMLSelectElement).value}:${mi}` })}>{Array.from({ length: 24 }, (_, x) => <option value={pad2(x)}>{pad2(x)}</option>)}</select><b>:</b><select aria-label={`${t('module.feeder.time')} ${n + 1}: ${tk(t, 'minutes')}`} value={mi} disabled={busy} onChange={e => setMeal(n, { time: `${h}:${(e.target as HTMLSelectElement).value}` })}>{Array.from({ length: 60 }, (_, x) => <option value={pad2(x)}>{pad2(x)}</option>)}</select></div><div className="hm-stepper"><button type="button" className="hm-round" aria-label={tk(t, 'less')} disabled={busy || m.portions <= 1} onClick={() => setMeal(n, { portions: m.portions - 1 })}>−</button><strong>{m.portions}</strong><button type="button" className="hm-round" aria-label={tk(t, 'more')} disabled={busy || m.portions >= 15} onClick={() => setMeal(n, { portions: m.portions + 1 })}>+</button></div></div>; })}
        {stale && <p className="at-feeder-note">{t('module.feeder.stale')}</p>}<div className="at-fd-ask-btns"><button type="button" className="hm-pill at-fd-amber at-feeder-save" disabled={busy || stale || !draftValue() || draftValue() === draft.original} onClick={() => setConfirm('save')}>{t('module.feeder.saveYes')}</button><button type="button" className="hm-pill" disabled={busy} onClick={() => { setDraft(null); setConfirm(null); }}>{t('ui.close')}</button></div>{!stale && !draftValue() && <p className="at-feeder-note">{t('module.feeder.invalid')}</p>}
        {confirm === 'save' && !stale && draftValue() && ask(t('module.feeder.saveConfirm', { plan: draft.meals.map(m => `${m.time} — ${portions(m.portions)}`).join('; ') }), () => { const raw = draftValue()!, before = draft.original, shown = [...draft.meals].sort((a, b) => a.time.localeCompare(b.time)); void run(scheduleCall(entities.info!, raw), t('module.feeder.planSent')).then(ok => { if (ok === true) { askSnap.current = null; setExpected({ raw, before, meals: shown, late: false }); setDraft(null); } }); }, t('module.feeder.saveYes'))}</div>}</div>
    {clockNote}{entities.lowIntake && <div className="ah-rows">{toggle('lowIntake', tk(t, 'lowIntake'), tk(t, 'lowIntakeHint'))}</div>}{notice}</div>; }
  const doneMeals = eventsOf(log, today).filter(e => e.kind === 'plan').length, totalMeals = Math.max(meals.length, doneMeals), cloud = (text: string | false | null | undefined) => text || tk(t, answered ? 'noCloud' : 'loading'), weekTotal = weekOf(log).reduce((s, d) => s + d.grams, 0);
  return <div ref={bodyRef} className={`hm-sheet-body ah-sheet at-feeder-sheet ${wide ? 'is-split' : ''}`} data-view={view} data-kind="feeder" data-module-card="pet_feeder">
    {head(t('module.pet_feeder'))}
    <div className="at-feeder-col at-fd-left">
      {alerts}
      <div className={`at-fd-hero ${available ? '' : 'is-off'}`}>
        <div className="at-fd-hero-text"><div className="at-fd-big"><b>{eaten !== null ? num(eaten, lang, 0) : !answered || bowl === null ? '—' : num(bowl, lang, 0)}</b>{(eaten !== null || (answered && bowl !== null)) && <i>&nbsp;{unit}</i>}</div><small>{eaten !== null || !answered ? tk(t, 'eatenToday') : tk(t, 'bowlLabel')}{aged && eaten !== null ? ` · ${asOf}` : ''}</small>
          {log && !aged && planOn === true && plan === 'ok' && totalMeals > 0 && <div className="at-fd-progress" role="img" aria-label={`${tk(t, 'planDay')}: ${tk(t, 'ofMeals', { a: doneMeals, b: totalMeals })}`}><span>{Array.from({ length: totalMeals }, (_, i) => <i className={i < doneMeals ? 'is-done' : ''} />)}</span><small>{tk(t, 'planDay')} · {tk(t, 'ofMeals', { a: doneMeals, b: totalMeals })}</small></div>}</div>
        <CatArt mood={mood} grams={bowl} label={catLabel} />
      </div>
      <div className="at-fd-bowl"><span className="at-fd-ico is-big"><Glyph name="bowl" size={26} /></span><span className="at-fd-bowl-text"><b>{bowl === null ? '—' : `${num(bowl, lang, 0)} ${unit}`}</b><small>{tk(t, 'bowlLabel')}</small>{stock !== undefined && <small className={low ? 'at-fd-low' : ''}>{low ? t('module.feeder.stockLow') : stockKnown ? t('module.feeder.stockOk') : tk(t, 'stockUnknown')}</small>}</span><button type="button" className="hm-pill at-fd-amber at-feeder-go" disabled={busy || !available || feedLocked} onClick={() => setFeedOpen(o => !o)}>{tk(t, 'feedNow')}</button></div>
      {feedOpen && <div className="at-fd-feed" role="group" aria-label={tk(t, 'feedNow')}><div className="hm-stepper"><button type="button" className="hm-round" aria-label={tk(t, 'less')} disabled={busy || dose <= 1} onClick={() => setDose(d => Math.max(1, d - 1))}>−</button><div className="at-feeder-dose"><strong>{portions(dose)}</strong><small>{approx(dose)}</small></div><button type="button" className="hm-round" aria-label={tk(t, 'more')} disabled={busy || dose >= max} onClick={() => setDose(d => Math.min(max, d + 1))}>+</button></div><div className="at-fd-ask-btns"><button type="button" className="hm-pill at-fd-amber at-feeder-yes" disabled={busy || !available || feedLocked} onClick={() => void feed()}>{tk(t, 'give')}</button><button type="button" className="hm-pill" disabled={busy} onClick={() => setFeedOpen(false)}>{t('ui.close')}</button></div></div>}
      {notice}{feedLocked && !note && <p className="at-feeder-note" role="status">{lastFeedSure ? tk(t, 'fedAt', { time: clock(Math.floor(lastFeed / 1000)) }) : tk(t, 'unknownResult')}</p>}
    </div>
    <div className="at-feeder-col">
      <div className="at-fd-card"><button type="button" className="at-fd-card-head" onClick={() => go('journal')}><strong>{tk(t, 'journalToday')}</strong><Icon name="next" size={18} /></button>{timeline(today, 6)}{aged && eaten === null && <p className="at-fd-tz">{asOf}</p>}</div>
      <div className="ah-rows">
        {link('clock', tk(t, 'auto'), planOn === false ? t('module.feeder.planOff') : plan === 'unparsed' ? tk(t, 'planUnparsed') : plan === 'missing' || planOn === null ? t('state.unknown') : tk(t, 'autoSum', { m: meals.length }), 'plan')}
        {link('bars', tk(t, 'statsTitle'), cloud(log && `${num(weekTotal, lang, 0)} ${unit} · ${tk(t, 'gWeek')}`), 'stats')}
        {entities.compensate && toggle('compensate', tk(t, 'compensate'), tk(t, 'compensateHint'), 'target')}
        {link('waves', t('module.feeder.desiccant'), cloud(log?.desiccant && `${num(log.desiccant.level, lang, 0)} % · ${tk(t, 'desicLeft', { d: log.desiccant.days, n: log.desiccant.days })}`), 'desiccant')}
        {link('gear', tk(t, 'settings'), '', 'settings')}
      </div>
    </div>
  </div>;
}
export const petFeeder: ModuleDef = {
  ...petFeederSpec, sheetKey: 'feeder', // no product photo: the owner keeps the drawn cat (11.11.2026), on the tile, in the sheet's head and its hero
  claims: entities => [...Object.entries(entities).filter(([k]) => k !== 'device' && k !== 'rest').map(([, v]) => v), ...(entities.rest ?? '').split(',')].filter((x): x is string => !!x),
  Card(props) {
    const { t, lang, onOpen, host, entities } = props, { log, answered, fetchedAt } = useLog(host, entities.info), { available, bowl, eaten, planOn, next, faults, warnings, mood, stale, asOfShort } = read(props, log, fetchedAt);
    // the number is what was eaten today; without the journal it is the bowl's weight, and then the line under the name says so
    const value = eaten ?? (answered ? bowl : null), ofBowl = eaten === null && value !== null;
    // (the bowl's weight is read now, from the feeder: it is «в миске», never «данные 09.11» — that is the journal's date, and the journal is not shown)
    const alert = faults[0] ?? warnings[0], line = tileLine(!!alert, ofBowl, stale), sub = line === 'alert' ? alert! : line === 'bowl' ? t('module.feeder.bowl') : line === 'asOf' ? asOfShort : planOn === null ? t('state.unknown') : planOn && next ? tk(t, 'feedAt', { time: next.time }) : planOn ? t('module.feeder.planOn') : t('module.feeder.planOff');
    return <div className={`ah-tile ah-value hm-card at-fd-tile ${faults.length ? 'is-fault' : warnings.length ? 'is-warning' : ''} ${available ? '' : 'is-off'}`} data-module-card="pet_feeder"><button type="button" className="ah-tile-hit" onClick={onOpen} disabled={!onOpen}><span className="at-fd-tile-cat"><CatArt mood={mood} grams={bowl} /></span><span className="ah-value-num"><b>{value === null ? '—' : num(value, lang, 0)}</b>{value !== null && <i>{tk(t, 'g')}</i>}</span><span className="ah-tile-text"><strong>{t('module.pet_feeder')}</strong><small>{sub}</small></span></button></div>;
  },
};
