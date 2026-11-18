import { useEffect, useRef, useState } from 'preact/hooks';
import type preact from 'preact';
import type { ModuleDef, ModuleEntities, ModuleOptions } from './types.ts';
import { airfryerSpec } from './catalog.ts';
import { HOLD_MS, onOffOf, useRun } from './kettle.tsx';
import { Icon } from '../ui/primitives.tsx';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import type { Host } from '../runtime/host.ts';
import type { Registry } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';
/** Xiaomi Smart Air Fryer (xiaomi.fryer.*), one card and one sheet instead of nineteen entities: what it is doing and how long is left on
 * top with «Пауза / Продолжить / Отменить», Mi Home's thirteen programs as a grid (owner 17.11.2026, studied on the owner's phone), each
 * opening its own screen with exactly the parameters Mi Home gives it and «Начать», and behind the gear the fryer's settings. The functions are the model's own MIOT
 * spec (status 0–14, 13 programs, 40–220 °C in steps of 5, 1–1440 min). The fryer is on Wi-Fi only while it is switched on at its button:
 * a fryer that is not there says so and offers nothing to press. */
type Props = { registry: Registry; entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang };
const kk = (t: T, k: string, p?: Record<string, string | number>) => t(`module.airfryer.${k}` as Key, p);
export type FryerPhase = 'off' | 'standby' | 'idle' | 'delay' | 'cooking' | 'paused' | 'turn' | 'done' | 'keep' | 'keepPaused' | 'keepDone';
/** The status sensor's words (xiaomi_miot gives the spec's descriptions: «Cooking», «Turn Pot Paused», «Keep Warm Completed»…) → what the card shows */
export function fryerPhase(raw: unknown, online = true): FryerPhase {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!online || !s || s === 'unavailable' || s === 'unknown') return 'off';
  if (s === 'off') return 'standby';
  if (/keep ?warm/.test(s)) return /paus/.test(s) ? 'keepPaused' : /complet|finish/.test(s) ? 'keepDone' : 'keep';
  if (/turn/.test(s)) return 'turn';
  if (/paus/.test(s)) return 'paused';
  if (/delay|reserv|schedul/.test(s)) return 'delay';
  if (/complet|finish/.test(s)) return 'done';
  if (/cook|crispy|degrease|roast/.test(s)) return 'cooking';
  return 'idle';
}
/** the select's own option («French Fries», «Steak », «One Layer») → the key of its name in the panel's words; an option the panel does not know keeps its own text */
const optKey = (raw: string) => raw.trim().toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
const MODES = new Set(['manual', 'frenchFries', 'chickenWing', 'steak', 'lambChops', 'fish', 'shrimp', 'vegetables', 'cake', 'pizza', 'defrost', 'driedFruit', 'yogurt']);
const TEXTURES = new Set(['none', 'crispyRoast', 'tenderRoast', 'degrease']), LAYERS = new Set(['null', 'oneLayer', 'doubleLayer']);
const optName = (t: T, group: 'mode' | 'texture' | 'layers', raw: string) => { const k = optKey(raw); return (group === 'mode' ? MODES : group === 'texture' ? TEXTURES : LAYERS).has(k) ? kk(t, `${group}.${k}`) : raw.trim(); };
/** 12 → «12 мин», 80 → «1 ч 20 мин», 120 → «2 ч» */
export function minutesText(t: T, min: number): string { const m = Math.max(0, Math.round(min)), h = Math.floor(m / 60), r = m % 60; return h === 0 ? kk(t, 'min', { n: r }) : r === 0 ? kk(t, 'hr', { n: h }) : `${kk(t, 'hr', { n: h })} ${kk(t, 'min', { n: r })}`; }
function read({ registry, entities, host }: Props) {
  const st = (role: string) => { const id = entities[role]; return id ? registry.states[id] : undefined; };
  // nothing is not zero: Number('') and Number(null) are 0, and «0 °C, 0 мин» would be shown and sent
  const n = (v: unknown) => { if (v === null || v === undefined || (typeof v === 'string' && !v.trim()) || typeof v === 'boolean') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
  const phase = fryerPhase(st('status')?.state, host.online), available = phase !== 'off';
  const live = (role: string) => available ? n(st(role)?.state) : null;
  const range = (role: string, min: number, max: number, step: number) => { const a = st(role)?.attributes ?? {}; return { min: n(a.min) ?? min, max: n(a.max) ?? max, step: n(a.step) ?? step }; };
  const select = (role: string) => { const s = st(role), state = s?.state, options = Array.isArray(s?.attributes?.options) ? (s!.attributes.options as unknown[]).map(String) : []; return { value: available && state && state !== 'unavailable' && state !== 'unknown' ? state : null, options }; };
  const fault = String(st('fault')?.state ?? '').trim().toLowerCase(), broken = available && !!fault && !/^(0|no faults?|none|unknown|unavailable)$/.test(fault);
  // the meter's figures are the house's last words: with no connection to the house they are not «сейчас»
  const watts = host.online ? n(st('meterPower')?.state) : null, today = host.online ? n(st('meterToday')?.state) : null;
  return { st, phase, available, temp: live('temp'), time: live('time'), left: live('left'), delay: live('delay'), weight: live('weight'), tempRange: range('temp', 40, 220, 5), weightRange: range('weight', 100, 800, 100),
    mode: select('mode'), layers: select('layers'), texture: select('texture'), broken, watts, today };
}
/** Our own drawing of the fryer (a dark rounded body, the round display on top, the basket with its handle), with heat rising while it cooks. */
export function FryerArt({ phase }: { phase: FryerPhase }) {
  const hot = phase === 'cooking' || phase === 'keep';
  return <svg className={`at-af-art is-${phase}`} viewBox="0 0 120 120" aria-hidden="true">
    {hot && <g className="at-kt-steam"><path d="M46 20c-5-6 5-9 0-15" /><path d="M60 18c-5-6 5-9 0-15" /><path d="M74 20c-5-6 5-9 0-15" /></g>}
    <ellipse cx="60" cy="109" rx="38" ry="5" className="at-af-shadow" />
    <path d="M30 44a20 20 0 0 1 20-20h20a20 20 0 0 1 20 20v48a12 12 0 0 1-12 12H42a12 12 0 0 1-12-12z" className="at-af-body" />
    <circle cx="60" cy="42" r="9" className="at-af-dial" /><circle cx="60" cy="42" r="4.5" className={`at-af-lamp ${hot ? 'is-hot' : ''}`} />
    <path d="M34 62h52v30a8 8 0 0 1-8 8H42a8 8 0 0 1-8-8z" className="at-af-basket" />
    <rect x="50" y="70" width="20" height="16" rx="6" className="at-af-handle" />
  </svg>;
}
type Step = [string, string, Record<string, unknown>];
const STEP_SEND_MS = 600;
/** The steppers of the sheet: a burst of taps is one intent, so one command per value goes out when the taps stop; what was chosen is shown
 * until the fryer says the same. `flush` hands the waiting values to a command that must follow them («Запустить»). */
function useSteps(E: ModuleEntities, ui: ReturnType<typeof useRun>, host: Host) {
  const [drafts, setDrafts] = useState<Record<string, number>>({}), pend = useRef(new Map<string, { value: number; timer: ReturnType<typeof setTimeout> }>()), hostRef = useRef(host); hostRef.current = host;
  const drop = (role: string, value?: number) => setDrafts(d => { if (!(role in d) || (value !== undefined && d[role] !== value)) return d; const { [role]: _, ...rest } = d; return rest; });
  const send = async (role: string) => { const p = pend.current.get(role); if (!p) return;
    if (ui.running()) { p.timer = setTimeout(() => void send(role), 300); return; } // another command of this sheet is on its way: wait for it, do not lose the choice
    pend.current.delete(role); const id = E[role]; if (!id) return;
    const ok = await ui.run(role, [['number', 'set_value', { entity_id: id, value: p.value }]]);
    if (ok) setTimeout(() => drop(role, p.value), 8000); else drop(role); };
  const step = (role: string, value: number) => { setDrafts(d => ({ ...d, [role]: value })); const old = pend.current.get(role); if (old) clearTimeout(old.timer); pend.current.set(role, { value, timer: setTimeout(() => void send(role), STEP_SEND_MS) }); };
  const flush = (): Step[] => { const out: Step[] = []; for (const [role, p] of pend.current) { clearTimeout(p.timer); const id = E[role]; if (id) out.push(['number', 'set_value', { entity_id: id, value: p.value }]); } pend.current.clear(); return out; };
  const forget = () => { for (const p of pend.current.values()) clearTimeout(p.timer); pend.current.clear(); setDrafts({}); };
  // a sheet closed before the pause ended still sends what the person chose
  useEffect(() => () => { for (const [role, p] of pend.current) { clearTimeout(p.timer); const id = E[role]; if (id && hostRef.current.online) void hostRef.current.call('number', 'set_value', { entity_id: id, value: p.value }).catch(() => undefined); } }, []);
  return { drafts, step, flush, forget, drop };
}
/** The fryer's programs as Mi Home sets them up (read from the owner's phone, 17.11.2026): what each one starts with and which of its
 * parameters the person may choose. A program whose time the fryer works out itself (fries by weight, steak) has no time row: `about` is
 * Mi Home's estimate for the starting values. */
export interface Program { key: string; temp: number; time?: number; about?: number; weight?: number; layers?: boolean; texture?: boolean; shake?: boolean; maxTemp?: number; tint: [string, string] }
export const PROGRAMS: Program[] = [
  { key: 'manual', temp: 180, time: 15, tint: ['#22b8b4', '#6fdcd0'] },
  { key: 'frenchFries', temp: 200, about: 18, weight: 500, shake: true, maxTemp: 200, tint: ['#ff7a45', '#ffa883'] },
  { key: 'chickenWing', temp: 180, time: 15, layers: true, texture: true, tint: ['#ffa51f', '#ffc94d'] },
  { key: 'steak', temp: 200, about: 12, layers: true, texture: true, tint: ['#f26d6d', '#ff9c9c'] },
  { key: 'lambChops', temp: 180, time: 15, layers: true, texture: true, tint: ['#de4a74', '#f58fa9'] },
  { key: 'fish', temp: 180, time: 15, layers: true, tint: ['#1fb0f4', '#74d0fb'] },
  { key: 'shrimp', temp: 180, time: 15, layers: true, tint: ['#2a7de9', '#5aa3f5'] },
  { key: 'vegetables', temp: 190, time: 8, tint: ['#43b933', '#80d566'] },
  { key: 'cake', temp: 160, time: 20, tint: ['#8757f4', '#ac90fa'] },
  { key: 'pizza', temp: 160, time: 15, tint: ['#ffa51f', '#ffc94d'] },
  { key: 'defrost', temp: 50, time: 20, tint: ['#dc4186', '#f392bb'] },
  { key: 'driedFruit', temp: 40, time: 300, tint: ['#19b0c4', '#58cfdc'] },
  { key: 'yogurt', temp: 40, time: 480, tint: ['#2a80ee', '#5ea4f6'] },
];
/** A program's own picture, white on its colour: the same thirteen Mi Home draws, in the panel's hand. */
export function ProgramGlyph({ k, size = 30 }: { k: string; size?: number }) {
  const s = { fill: 'none', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const }, f = { fill: '#fff', stroke: 'none' };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...s}>
    {k === 'manual' && <><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M12 10.5a1.5 1.5 0 0 1 3 0V12a1.5 1.5 0 0 1 3 0v3a5.5 5.5 0 0 1-5.5 5.5H12a5 5 0 0 1-4.2-2.3L5.5 14.6a1.4 1.4 0 0 1 2.2-1.7L9 14.2V11" /></>}
    {k === 'frenchFries' && <><path d="M6 11h12l-1.4 8.2a1 1 0 0 1-1 .8H8.4a1 1 0 0 1-1-.8z" {...f} /><path d="M8.5 10.5 7.5 4M11 10.5V3M13.5 10.5l.7-6.5M16 10.5l1.2-5.5" stroke-width="2.2" /></>}
    {k === 'chickenWing' && <><path d="M13.5 4.5c3 0 5.5 2.4 5.5 5.3 0 3.4-3.2 5-6 4.6l-4.2 4.2a1.6 1.6 0 1 1-1.4-1.4l-.2-.2a1.6 1.6 0 1 1 1.4-1.4L11 13.2C9.500 9 10.500 4.500 13.500 4.500z" {...f} /></>}
    {k === 'steak' && <><path d="M4 12.500C4 8 8 5.500 12.500 5.500S20 8 20 11.500c0 3-2.500 4-4.500 4.500s-3 2.500-6 2.500S4 16 4 12.500z" {...f} /><circle cx="14.500" cy="10.500" r="1.900" fill="none" stroke="#f26d6d" stroke-width="1.600" /></>}
    {k === 'lambChops' && <><path d="M8 4.500v15M12 4.500v15M16 4.500v15" stroke-width="1.600" /><rect x="5.500" y="8" width="13" height="8" rx="3" {...f} /></>}
    {k === 'fish' && <><path d="M3.500 12c2.500-4 6-5.500 9.500-5.500 2.500 0 4.500 1.500 6 3l2-2v9l-2-2c-1.500 1.500-3.500 3-6 3-3.500 0-7-1.500-9.500-5.500z" {...f} /><circle cx="8" cy="11" r="1" fill="#1fb0f4" stroke="none" /></>}
    {k === 'shrimp' && <><path d="M5 9.500c0-3 3-5 6.500-5 4.500 0 8 3 8 7s-3 7-7 7h-2c2-1 3-2.500 3-4.500 0-2.500-2-4.500-4.500-4.500z" {...f} /><path d="M5 9.500 3.500 7M12.500 18.500l-2.500 1.500" /></>}
    {k === 'vegetables' && <><circle cx="8.500" cy="9.500" r="3.500" {...f} /><circle cx="14.500" cy="8" r="3.500" {...f} /><circle cx="15.500" cy="13" r="3" {...f} /><path d="M11 12.500 9.500 20h4L13 14z" {...f} /></>}
    {k === 'cake' && <><path d="M6.500 11a5.500 5.500 0 0 1 11 0c1 .300 1.500 1 1.500 1.800 0 1-.900 1.700-2 1.700H7c-1.100 0-2-.700-2-1.700 0-.800.500-1.500 1.500-1.800z" {...f} /><path d="M7.500 16.500h9l-1 4h-7z" {...f} /></>}
    {k === 'pizza' && <><path d="M4 7.500C9 5 15 5 20 7.500L12.500 20.500a.600.600 0 0 1-1 0z" {...f} /><circle cx="10" cy="10" r="1.200" fill="#ffa51f" stroke="none" /><circle cx="14" cy="11.500" r="1.200" fill="#ffa51f" stroke="none" /><circle cx="12" cy="15" r="1.100" fill="#ffa51f" stroke="none" /></>}
    {k === 'defrost' && <><path d="M12 3v18M4.200 7.500l15.600 9M19.800 7.500l-15.600 9M12 6.500 9.500 4.500M12 6.500l2.500-2M12 17.500l-2.500 2M12 17.500l2.500 2" /></>}
    {k === 'driedFruit' && <><path d="M12 4c4 2.500 6 5.500 6 9a6 6 0 0 1-12 0c0-3.500 2-6.500 6-9z" {...f} /><path d="M12 9v8M12 13l2.500-2M12 15.500 9.500 13.500" stroke="#19b0c4" stroke-width="1.400" /></>}
    {k === 'yogurt' && <><path d="M6 9.500h12l-1.200 9.300a1.500 1.500 0 0 1-1.500 1.200H8.700a1.500 1.500 0 0 1-1.500-1.200z" {...f} /><path d="M5 9.500c0-1 .800-1.800 1.800-1.800.200-2 1.900-3.200 3.700-2.900C11.300 3.500 13 3 14.300 4c1.600-.300 3 .900 3 2.500v1.200c1 0 1.700.800 1.700 1.800" /></>}
  </svg>;
}
/** what «Начать» sends for a program: the program, its choices, then the fryer's own «start»; nothing is sent before the tap */
export interface Choice { temp: number; time: number | null; weight: number | null; layers: string | null; texture: string | null; shake: boolean | null }
export function startSteps(E: ModuleEntities, option: string | null, p: Program, c: Choice, shakeNow: boolean | null): Step[] {
  const out: Step[] = [], sel = (role: string, option: string | null) => { const id = E[role]; if (id && option) out.push(['select', 'select_option', { entity_id: id, option }]); }, numb = (role: string, value: number | null) => { const id = E[role]; if (id && value !== null) out.push(['number', 'set_value', { entity_id: id, value }]); };
  sel('mode', option);
  if (p.shake && E.shake && c.shake !== null && c.shake !== shakeNow) out.push(['switch', c.shake ? 'turn_on' : 'turn_off', { entity_id: E.shake }]);
  if (p.weight) numb('weight', c.weight);
  if (p.layers) sel('layers', c.layers);
  if (p.texture) sel('texture', c.texture);
  numb('temp', c.temp); if (p.time) numb('time', c.time);
  if (E.start) out.push(['button', 'press', { entity_id: E.start }]);
  return out;
}
const TIME_CHIPS = [5, 10, 15, 20, 30, 45, 60];
export function FryerSheet(props: Props & { room?: string; onClose: () => void; wide?: boolean }) {
  const { entities: E, t, lang, room, onClose, wide, host } = props;
  const photo = usePhoto(E.status), f = read(props), ui = useRun(host, t), steps = useSteps(E, ui, host);
  const [view, setView] = useState<'main' | 'settings' | 'program'>('main'), [progKey, setProgKey] = useState('manual'), [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => { ui.seen(); }, [f.phase]); // the fryer answered: the button that waited for it is free again
  // the fryer says what was chosen: the draft has done its work
  useEffect(() => { if (steps.drafts.temp === f.temp) steps.drop('temp'); if (steps.drafts.time === f.time) steps.drop('time'); }, [f.temp, f.time]);
  const temp = steps.drafts.temp ?? f.temp, time = steps.drafts.time ?? f.time;
  const running = f.phase === 'cooking' || f.phase === 'paused' || f.phase === 'turn', warm = f.phase === 'keep' || f.phase === 'keepPaused', locked = running || warm || f.phase === 'delay';
  const busy = ui.busy !== null, off = !f.available || busy;
  // the fryer began to cook (from here or from its own panel): the program's screen has nothing more to offer
  useEffect(() => { if (view === 'program' && (locked || !f.available)) setView('main'); }, [locked, f.available]);
  const press = (role: string) => { const id = E[role]; return id ? ui.run(role, [['button', 'press', { entity_id: id }]], HOLD_MS) : Promise.resolve(false); };
  const optionOf = (s: { options: string[] }, key: string) => s.options.find(o => optKey(o) === key) ?? null;
  const modeText = f.mode.value ? optName(t, 'mode', f.mode.value) : '';
  // the programs this fryer really has (its own list), in Mi Home's order
  const programs = PROGRAMS.filter(p => !!optionOf(f.mode, p.key));
  const openProgram = (p: Program) => { const same = f.mode.value !== null && optKey(f.mode.value) === p.key, tex = f.texture.options.filter(o => optKey(o) !== 'none' && optKey(o) !== 'tenderRoast'), lay = f.layers.options.filter(o => optKey(o) !== 'null');
    // the fryer already stands on this program: its own values; otherwise the program's starting ones
    setChoice({ temp: Math.min(p.maxTemp ?? 220, same && f.temp !== null ? f.temp : p.temp), time: p.time ? (same && f.time !== null ? f.time : p.time) : null, weight: p.weight ? (same && f.weight !== null ? f.weight : p.weight) : null,
      layers: p.layers ? (same && f.layers.value && lay.includes(f.layers.value) ? f.layers.value : lay[0] ?? null) : null, texture: p.texture ? (same && f.texture.value && tex.includes(f.texture.value) ? f.texture.value : tex[0] ?? null) : null, shake: p.shake ? onOffOf(f.st('shake')?.state) : null });
    setProgKey(p.key); setView('program'); };
  const status = f.phase === 'off' ? kk(t, 'offline') : f.phase === 'standby' ? kk(t, 'standby') : f.broken ? kk(t, 'fault') : f.phase === 'cooking' ? kk(t, 'cooking', { t: temp ?? '—' }) : f.phase === 'paused' ? kk(t, 'paused') : f.phase === 'turn' ? kk(t, 'turn')
    : f.phase === 'delay' ? (f.delay ? kk(t, 'delayIn', { m: minutesText(t, f.delay) }) : kk(t, 'delay')) : f.phase === 'done' ? kk(t, 'done') : f.phase === 'keep' ? kk(t, 'keep') : f.phase === 'keepPaused' ? kk(t, 'keepPaused') : f.phase === 'keepDone' ? kk(t, 'keepDone') : kk(t, 'ready');
  // the big figure is what is left, and only while something runs
  const shown = running || warm ? f.left ?? time : null, big = shown === null ? null : Math.max(0, Math.round(shown));
  const progress = running && f.left !== null && f.time ? Math.max(0, Math.min(1, 1 - f.left / f.time)) : null;
  const act = (role: string, label: string, busyLabel: string, cls = '') => E[role] ? <button type="button" className={`hm-pill at-kt-stop ${cls}`} aria-busy={ui.busy === role} disabled={busy} onClick={() => void press(role)}>{ui.busy === role ? busyLabel : label}</button> : null;
  const hero = <section className={`at-kt-hero at-af-hero is-${f.phase} ${big === null ? 'is-calm' : ''}`}>
    <ProductPhoto src={photo} className="at-kt-hero-pic" eager />
    <small>{locked && modeText ? modeText : kk(t, 'title')}</small>
    {big !== null && <p className="at-kt-temp at-af-time">{big >= 100 ? <><b>{Math.floor(big / 60)}:{String(big % 60).padStart(2, '0')}</b><i>{kk(t, 'hUnit')}</i></> : <><b>{big}</b><i>{kk(t, 'mUnit')}</i></>}</p>}
    <p className="at-kt-status" role="status">{status}</p>
    {progress !== null && <span className="at-kt-bar" role="progressbar" aria-label={kk(t, 'progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
    {f.available && locked && <div className="at-af-acts">
      {f.phase === 'cooking' && act('pause', kk(t, 'pause'), kk(t, 'pausing'))}
      {(f.phase === 'paused' || f.phase === 'turn' || f.phase === 'keepPaused') && act('resume', kk(t, 'resume'), kk(t, 'resuming'))}
      {act('cancel', kk(t, warm ? 'finish' : 'cancel'), kk(t, 'cancelling'), 'is-quiet')}
    </div>}
    {f.watts !== null && (f.watts > 5 || f.today !== null) && <small className="at-kt-energy">{f.watts > 5 ? kk(t, 'watts', { w: num(f.watts, lang, 0) }) : ''}{f.watts > 5 && f.today !== null ? ' · ' : ''}{f.today !== null ? kk(t, 'today', { kwh: num(f.today, lang, 2) }) : ''}</small>}
  </section>;
  const stepperOf = (label: string, value: number | null, r: { min: number; max: number; step: number }, unit: string, onSet: (v: number) => void, no: boolean) => <div className="at-kt-stepper" role="group" aria-label={label}>
    <button type="button" className="hm-round" aria-label={`${label}: −${r.step}`} disabled={no || value === null || value <= r.min} onClick={() => onSet(Math.max(r.min, value! - r.step))}>−</button>
    <b>{!f.available || value === null ? '—' : <>{num(value, lang, 0)}<i>{unit}</i></>}</b>
    <button type="button" className="hm-round" aria-label={`${label}: +${r.step}`} disabled={no || value === null || value >= r.max} onClick={() => onSet(Math.min(r.max, value! + r.step))}>+</button></div>;
  // while it cooks: the temperature and the time may still be changed, as on the fryer itself
  const live = (E.temp || E.time) && <div className="at-kt-card at-af-card"><h3>{kk(t, 'params')}</h3>
    {E.temp && <div className="ah-row hm-setting at-kt-row"><span className="ah-row-text"><strong>{kk(t, 'temp')}</strong></span>{stepperOf(kk(t, 'temp'), temp, f.tempRange, '°C', v => steps.step('temp', v), off)}</div>}
    {E.time && <div className="ah-row hm-setting at-kt-row"><span className="ah-row-text"><strong>{kk(t, 'time')}</strong></span>{stepperOf(kk(t, 'time'), time, { min: 1, max: 1440, step: 1 }, kk(t, 'mUnit'), v => steps.step('time', v), off)}</div>}
  </div>;
  // Mi Home's «Режимы устройства»: every program at once (no pages to swipe), a tap opens the program's own screen
  const grid = programs.length > 0 && <div className="at-kt-card at-af-card"><h3>{kk(t, 'programs')}</h3>
    <div className="at-af-grid">{programs.map(p => <button type="button" className="at-af-prog" disabled={!f.available || f.broken} onClick={() => openProgram(p)}><span className="at-af-ball" style={{ background: `linear-gradient(135deg,${p.tint[0]},${p.tint[1]})` }}><ProgramGlyph k={p.key} /></span><span>{kk(t, `mode.${p.key}`)}</span></button>)}</div></div>;
  // a switch whose own entity says nothing is not «выкл»: the row says so in words and offers nothing to flip blindly
  const toggle = (role: string, label: string, hint?: string) => { const id = E[role]; if (!id) return null; const state = f.st(role)?.state, on = f.available ? onOffOf(state) : null; return <div className="ah-row hm-setting at-kt-row" data-fryer-switch={role}><span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>{on === null ? <small>{t(state === 'unknown' ? 'state.unknown' : 'state.unavailable')}</small> : <button type="button" role="switch" className={`at-kt-sw ${on ? 'is-on' : ''}`} aria-checked={on} aria-label={label} aria-busy={ui.busy === role} disabled={busy} onClick={() => void ui.run(role, [['switch', on ? 'turn_off' : 'turn_on', { entity_id: id }]])}><i /></button>}</div>; };
  const err = ui.err && <p className="at-kt-err" role="alert">{kk(t, 'fail')}: {ui.err}</p>;
  const close = <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button>;
  const back = <button type="button" className="hm-icon-btn at-kt-back" aria-label={t('ui.back' as Key)} onClick={() => setView('main')}><Icon name="back" size={20} /></button>;
  if (view === 'settings') return <div className="at-kt-sheet at-af is-settings">
    <div className="hm-sheet-head at-kt-head">{back}<div><small>{kk(t, 'title')}</small><h2>{kk(t, 'settings')}</h2></div>{close}</div>
    {err}
    <div className="at-kt-body"><div className="at-kt-card at-kt-set">
      {toggle('autoKeep', kk(t, 'autoKeep'), kk(t, 'autoKeepHint'))}
      {toggle('shake', kk(t, 'shake'), kk(t, 'shakeHint'))}
      {toggle('keepNow', kk(t, 'keepNow'), kk(t, 'keepNowHint'))}
    </div>{!f.available && <p className="at-kt-note at-af-pad">{kk(t, 'offlineHint')}</p>}</div>
  </div>;
  const p = PROGRAMS.find(x => x.key === progKey);
  if (view === 'program' && p && choice) {
    const c = choice, set = (patch: Partial<Choice>) => setChoice({ ...c, ...patch }), tex = f.texture.options.filter(o => optKey(o) !== 'none' && optKey(o) !== 'tenderRoast'), lay = f.layers.options.filter(o => optKey(o) !== 'null');
    // Mi Home's «Около N минут»: the chosen time, or its estimate while the program's own starting values stand
    const about = p.time ? c.time : (!p.weight || c.weight === p.weight) && (!p.layers || c.layers === lay[0]) ? p.about ?? null : null;
    const seg = (label: string, options: string[], value: string | null, group: 'layers' | 'texture', onSet: (o: string) => void) => <div className="at-kt-seg at-af-seg" role="radiogroup" aria-label={label}>{options.map(o => <button type="button" role="radio" aria-checked={value === o} className={value === o ? 'is-on' : ''} disabled={off} onClick={() => onSet(o)}>{optName(t, group, o)}</button>)}</div>;
    const row = (label: string, body: preact.ComponentChildren, col = false, hint?: string) => <div className={`ah-row hm-setting at-kt-row ${col ? 'is-col' : ''}`}><span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>{body}</div>;
    const go = () => ui.run('start', startSteps(E, optionOf(f.mode, p.key), p, c, onOffOf(f.st('shake')?.state)), HOLD_MS);
    return <div className={`at-kt-sheet at-af is-program ${wide ? 'is-wide' : ''}`}>
      <div className="hm-sheet-head at-kt-head">{back}<div><small>{kk(t, 'title')}</small><h2>{kk(t, `mode.${p.key}`)}</h2></div>{close}</div>
      {err}
      <div className="at-kt-cols"><div className="at-kt-col"><section className="at-af-stage">
        <span className="at-af-ball is-big" style={{ background: `linear-gradient(135deg,${p.tint[0]},${p.tint[1]})` }}><ProgramGlyph k={p.key} size={64} /></span>
        <p className="at-af-about" role="status">{about !== null ? kk(t, 'about', { m: minutesText(t, about) }) : kk(t, 'aboutAuto')}</p>
        <button type="button" className="hm-pill at-kt-go at-af-go" aria-busy={ui.busy === 'start'} disabled={off || !E.start} onClick={() => void go()}>{ui.busy === 'start' ? kk(t, 'starting') : kk(t, 'start')}</button>
      </section></div>
      <div className="at-kt-col"><div className="at-kt-card at-af-card at-kt-set">
        {p.shake && E.shake && c.shake !== null && row(kk(t, 'shakeRow'), <button type="button" role="switch" className={`at-kt-sw ${c.shake ? 'is-on' : ''}`} aria-checked={c.shake} aria-label={kk(t, 'shakeRow')} disabled={off} onClick={() => set({ shake: !c.shake })}><i /></button>, false, kk(t, 'shakeRowHint'))}
        {p.weight && E.weight && row(kk(t, 'amount'), stepperOf(kk(t, 'amount'), c.weight, f.weightRange, kk(t, 'gUnit'), v => set({ weight: v }), off))}
        {p.layers && E.layers && lay.length > 0 && row(kk(t, 'amount'), seg(kk(t, 'amount'), lay, c.layers, 'layers', o => set({ layers: o })), true)}
        {p.texture && E.texture && tex.length > 0 && row(kk(t, 'texture'), seg(kk(t, 'texture'), tex, c.texture, 'texture', o => set({ texture: o })), true)}
        {E.temp && row(kk(t, 'tempRow'), stepperOf(kk(t, 'tempRow'), c.temp, { ...f.tempRange, max: Math.min(f.tempRange.max, p.maxTemp ?? f.tempRange.max) }, '°C', v => set({ temp: v }), off))}
        {p.time && E.time && <div className="ah-row hm-setting at-kt-row is-col"><div className="at-af-line"><span className="ah-row-text"><strong>{kk(t, 'timeRow')}</strong></span>{stepperOf(kk(t, 'timeRow'), c.time, { min: 1, max: 1440, step: p.time >= 120 ? 30 : 1 }, kk(t, 'mUnit'), v => set({ time: v }), off)}</div>
          {p.time < 120 && <div className="at-kt-chips">{TIME_CHIPS.map(v => <button type="button" className={v === c.time ? 'is-on' : ''} aria-pressed={v === c.time} disabled={off} onClick={() => set({ time: v })}>{v}</button>)}</div>}</div>}
      </div></div></div>
    </div>;
  }
  return <div className={`at-kt-sheet at-af ${wide ? 'is-wide' : ''}`}>
    <div className="hm-sheet-head at-kt-head"><span className="at-kt-face" aria-hidden="true"><ProductPhoto src={photo} eager><FryerArt phase={f.phase} /></ProductPhoto></span><div>{room && <small>{room}</small>}<h2>{kk(t, 'title')}</h2></div>
      <button type="button" className="hm-icon-btn at-kt-gear" aria-label={kk(t, 'settings')} onClick={() => setView('settings')}><Icon name="gear" size={20} /></button>
      {close}</div>
    {err}
    <div className="at-kt-cols"><div className="at-kt-col">{hero}{!f.available && <p className="at-kt-note at-af-pad">{kk(t, 'offlineHint')}</p>}</div><div className="at-kt-col">{locked ? live : grid}</div></div>
  </div>;
}
export const airfryer: ModuleDef = {
  ...airfryerSpec, sheetKey: 'airfryer', photoEntity: entities => entities.status,
  // the fryer's own entities only: the meter in its line stays a meter of its own
  claims: entities => [entities.status, ...(entities.rest ?? '').split(',')].filter((x): x is string => !!x),
  Card(props) {
    const { t, onOpen } = props, f = read(props), own = usePhoto(props.entities.status), photo = f.phase === 'off' ? null : own; // a fryer with no connection keeps the drawing
    const left = f.left !== null ? minutesText(t, f.left) : '';
    const line = f.phase === 'off' ? kk(t, 'tileOff') : f.phase === 'standby' ? kk(t, 'standby') : f.broken ? kk(t, 'tileFault') : f.phase === 'cooking' ? (left ? kk(t, 'tileCooking', { m: left }) : kk(t, 'tileCookingBare')) : f.phase === 'paused' ? kk(t, 'paused') : f.phase === 'turn' ? kk(t, 'tileTurn')
      : f.phase === 'delay' ? kk(t, 'delay') : f.phase === 'done' ? kk(t, 'done') : f.phase === 'keep' || f.phase === 'keepPaused' ? kk(t, 'keep') : kk(t, 'ready');
    const on = f.phase === 'cooking' || f.phase === 'keep' || f.phase === 'turn' || f.phase === 'paused' || f.phase === 'done';
    return <div className={`ah-tile hm-card at-kt-tile at-af at-af-tile is-${f.phase} ${on ? 'is-on' : ''}`} data-module-card="airfryer"><button type="button" className="ah-tile-hit" onClick={onOpen} disabled={!onOpen} aria-label={`${kk(t, 'title')}: ${line}`}>
      <span className="at-kt-tile-art"><ProductPhoto src={photo}><FryerArt phase={f.phase} /></ProductPhoto></span>
      <span className="ah-tile-text"><strong>{kk(t, 'title')}</strong><small>{line}</small></span></button></div>;
  },
};
