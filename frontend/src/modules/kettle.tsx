import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ModuleDef, ModuleEntities, ModuleOptions } from './types.ts';
import { kettleSpec } from './catalog.ts';
import { Icon } from '../ui/primitives.tsx';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import type { Host } from '../runtime/host.ts';
import type { Registry } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import { errorText, num, type Lang } from '../ui/format.ts';
/** Xiaomi Smart Kettle 2 Pro, drawn after its Mi Home screen (owner 09.11.2026, studied on the owner's phone): the water's temperature big on a
 * teal wave, «Нагреть» and «Вскипятить», the kettle's own keep-warm modes, then its settings (keep warm after boiling, remember the temperature
 * when lifted, reminders, «Не беспокоить», the knob). One card and one sheet instead of seven switches named «function …». */
type Props = { registry: Registry; entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang };
const kk = (t: T, k: string, p?: Record<string, string | number>) => t(`module.kettle.${k}` as Key, p);
type Phase = 'idle' | 'heating' | 'keep' | 'cooling' | 'lifted' | 'off';
export interface KettleMode { id: string; name: string; heat: number; keep: boolean; keepTemp: number; minutes: number }
/** Mi Home's Chinese mode names in the panel's words */
const NAMES: Record<string, string> = { '温水': 'warm', '泡枸杞': 'goji', '花茶': 'flowerTea', '泡奶': 'milk', '蜂蜜': 'honey', '煮茶': 'tea', '咖啡': 'coffee', '绿茶': 'greenTea', '红茶': 'blackTea', '白茶': 'whiteTea' };
const modeName = (t: T, raw: string) => NAMES[raw] ? kk(t, `name.${NAMES[raw]}`) : raw;
/** «温水,45,1,45,1440_泡枸杞,70,1,70,1440» → the modes; «45,0,45,1440» (no name) → one */
export function parseModes(raw: unknown, idPrefix: string): KettleMode[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split('_').map(chunk => chunk.split(',')).filter(p => p.length >= 5 && Number(p[1]) > 0).map((p, i) => ({ id: `${idPrefix}${i}`, name: p[0], heat: Number(p[1]), keep: p[2] === '1', keepTemp: Number(p[3]), minutes: Number(p[4]) }));
}
function read({ registry, entities, host }: Props) {
  const st = (role: string) => { const id = entities[role]; return id ? registry.states[id] : undefined; };
  // nothing is not zero: Number('') and Number(null) are 0, and «heat to 0 °C» would be shown and sent
  const n = (v: unknown) => { if (v === null || v === undefined || (typeof v === 'string' && !v.trim()) || typeof v === 'boolean') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
  const heater = st('heater'), a = heater?.attributes ?? {};
  const available = !!heater && heater.state !== 'unavailable' && host.online;
  // a kettle that is not there has no «current» temperature: the last one it reported is not shown as today's
  const temp = available ? n(st('temp')?.state) ?? n(a.current_temperature) : null;
  const target = n(st('target')?.state) ?? n(a.temperature) ?? 99;
  const status = String(st('status')?.state ?? '').toLowerCase(), on = st('power')?.state === 'on' || a['kettle.on'] === true;
  const lifted = st('lifted')?.state === 'on';
  const keepOn = st('keepWarm')?.state === 'on', keepTemp = available ? n(st('keepTemp')?.state) ?? n(a['kettle.keep_warm_temperature']) : null, keepTime = available ? n(st('keepTime')?.state) : null;
  const warming = n(st('warming')?.state) ?? 0;
  const phase: Phase = !available ? 'off' : lifted ? 'lifted' : /warm|keep|insul/.test(status) ? 'keep' : /cool/.test(status) ? 'cooling' : /heat|boil/.test(status) || on ? 'heating' : 'idle'; // cooling before «on»: the kettle's switch may stay on while the water cools to the keep-warm temperature
  const heatMode = String(a['function.heat_mode'] ?? '').split(','), boilMode = String(a['function.boil_mode'] ?? '').split(',');
  const heatTo = n(heatMode[0]) ?? 70;
  const modes = parseModes(a['function.extended_mode'], 'x');
  const knob = ['one', 'two', 'three', 'four', 'five', 'six'].map(k => String(a[`knob_setting.knob_${k}`] ?? '').split(',')).filter(p => p[0] && n(p[2])).map(p => ({ name: p[0], temp: n(p[2])! }));
  // the socket's figures are the house's last words: with no connection to the house they are not «сейчас» (it said «Нет связи с чайником» and, under it, «Сейчас 1 812 Вт»)
  const watts = host.online ? n(st('plugPower')?.state) : null, today = host.online ? n(st('plugToday')?.state) : null;
  return { st, available, temp, target, phase, lifted, keepOn, keepTemp, keepTime, warming, heatTo, boilTemp: n(boilMode[0]) ?? 99, modes, knob, watts, today, knobModes: onOffOf(st('knob')?.state) };
}
/** Our own drawing of the kettle (white body, steel band, the handle's display), with steam while it heats. */
export function KettleArt({ phase, temp }: { phase: Phase; temp: number | null }) {
  const hot = phase === 'heating' || phase === 'keep';
  return <svg className={`at-kt-art is-${phase}`} viewBox="0 0 120 120" aria-hidden="true">
    {hot && <g className="at-kt-steam"><path d="M40 22c-5-6 5-9 0-15" /><path d="M54 20c-5-6 5-9 0-15" /><path d="M68 22c-5-6 5-9 0-15" /></g>}
    <ellipse cx="56" cy="108" rx="40" ry="5" className="at-kt-shadow" />
    <rect x="18" y="96" width="76" height="10" rx="5" className="at-kt-base" />
    <path d="M26 40h60l-4 56H30z" className="at-kt-body" />
    <rect x="25" y="32" width="62" height="10" rx="3" className="at-kt-band" />
    <path d="M86 44h10a7 7 0 0 1 7 7v26a7 7 0 0 1-7 7H84" className="at-kt-handle" />
    <rect x="94" y="52" width="6" height="12" rx="2" className="at-kt-screen" />
    {temp !== null && <text x="56" y="76" className="at-kt-art-num">{Math.round(temp)}</text>}
  </svg>;
}
function Wave() { return <svg className="at-kt-wave" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22C80 4 160 4 220 12s120 20 180 6V40H0z" className="is-back" /><path d="M0 30C90 14 170 16 240 24s110 14 160 2V40H0z" className="is-front" /></svg>; }
const hours = (min: number) => Math.round(min / 60);
/** on / off, or null when the entity says nothing (unavailable, unknown, gone): that is never «выкл» */
export const onOffOf = (state: string | undefined): boolean | null => state === 'on' ? true : state === 'off' ? false : null;
/** One command at a time: a second tap in the same frame is dropped, nothing is sent while the house is offline, the busy mark always clears, a refusal is told in words.
 * `holdMs`: after the house ACCEPTED the command the button keeps waiting until the kettle's new state is seen (`release`) or this long — the
 * kettle answers through its cloud a few seconds later, and in that gap the sheet still said «Ожидание» with a live «Включить»: a second tap sent
 * the target and the switch again. */
export const HOLD_MS = 6000;
function useRun(host: Host, t: T) {
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState(''), running = useRef(false), held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = () => { if (held.current) clearTimeout(held.current); held.current = null; running.current = false; setBusy(null); };
  useEffect(() => () => { if (held.current) clearTimeout(held.current); }, []);
  const run = async (key: string, steps: Array<[string, string, Record<string, unknown>]>, holdMs = 0): Promise<boolean> => {
    if (running.current || !steps.length) return false;
    if (!host.online) { setErr(t('ui.offline')); return false; }
    running.current = true; setBusy(key); setErr('');
    try { for (const [d, s, data] of steps) await host.call(d, s, data); } catch (e) { setErr(errorText(e, t)); release(); return false; }
    if (holdMs > 0) held.current = setTimeout(release, holdMs); else release();
    return true;
  };
  return { busy, err, run, running: () => running.current, /** the state the command asked for has arrived */ seen: () => { if (held.current) release(); } };
}
const STEP_SEND_MS = 600;
export function KettleSheet(props: Props & { room?: string; onClose: () => void; wide?: boolean }) {
  const { entities: E, t, lang, room, onClose, wide, host } = props;
  const photo = usePhoto(E.heater); // the kettle's own product photo, when the house has set one: in the head and next to the water's temperature
  const k = read(props), ui = useRun(host, t);
  // «heat to» is the kettle's own value until the person picks another one: a kettle that came back while the sheet is open is read again
  const [openId, setOpen] = useState<string | null>(null), [picked, setHeatTo] = useState<number | null>(null), [view, setView] = useState<'main' | 'settings'>('main');
  const heatTo = picked ?? k.heatTo, open = k.available ? openId : null;
  const active = k.phase === 'heating' || k.phase === 'keep' || k.phase === 'cooling';
  useEffect(() => { ui.seen(); }, [k.phase]); // the kettle answered: the button that waited for it is free again
  // the keep-warm temperature: a burst of taps is one intent, so one command goes out when the taps stop
  const [draft, setDraft] = useState<number | null>(null), stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null), stepValue = useRef<number | null>(null), hostRef = useRef(host); hostRef.current = host;
  const sendKeepTemp = async () => { if (ui.running()) { stepTimer.current = setTimeout(() => void sendKeepTemp(), 300); return; } /* another command of this sheet is on its way: wait for it, do not lose the choice */ stepTimer.current = null; const value = stepValue.current, id = E.keepTemp; stepValue.current = null; if (value === null || !id) return; const ok = await ui.run('keepTemp', [['number', 'set_value', { entity_id: id, value }]]); if (ok) setTimeout(() => setDraft(d => d === value ? null : d), 5000); else setDraft(null); };
  const stepKeepTemp = (value: number) => { setDraft(value); stepValue.current = value; if (stepTimer.current) clearTimeout(stepTimer.current); stepTimer.current = setTimeout(() => void sendKeepTemp(), STEP_SEND_MS); };
  // a sheet closed before the pause ended still sends what the person chose
  useEffect(() => () => { if (!stepTimer.current) return; clearTimeout(stepTimer.current); const value = stepValue.current, id = E.keepTemp; if (value !== null && id && hostRef.current.online) void hostRef.current.call('number', 'set_value', { entity_id: id, value }).catch(() => undefined); }, []);
  // start = the target, then the kettle's own switch (MIOT: number + switch; untested on the real kettle before the owner's «да»). «Нагреть» and
  // «Вскипятить» leave the permanent keep-warm settings alone: the kettle follows them by itself. A mode with its own keep-warm writes exactly
  // what its row promises (never «one degree lower»), and the row says that the kettle's setting changes.
  const start = (key: string, heat: number, keep: { temp: number; minutes: number } | null) => ui.run(key, [
    ...(E.target ? [['number', 'set_value', { entity_id: E.target, value: heat }] as [string, string, Record<string, unknown>]] : []),
    ...(keep && E.keepTemp ? [['number', 'set_value', { entity_id: E.keepTemp, value: keep.temp }] as [string, string, Record<string, unknown>]] : []),
    ...(keep && E.keepTime ? [['number', 'set_value', { entity_id: E.keepTime, value: keep.minutes }] as [string, string, Record<string, unknown>]] : []),
    ...(keep && E.keepWarm ? [['switch', 'turn_on', { entity_id: E.keepWarm }] as [string, string, Record<string, unknown>]] : []),
    ...(E.power ? [['switch', 'turn_on', { entity_id: E.power }] as [string, string, Record<string, unknown>]] : []),
  ], HOLD_MS);
  const stop = () => ui.run('stop', E.stop ? [['button', 'press', { entity_id: E.stop }]] : E.power ? [['switch', 'turn_off', { entity_id: E.power }]] : [], HOLD_MS);
  // a switch whose own entity says nothing is not «выкл»: the row says so in words and offers nothing to flip blindly
  const toggle = (role: string, label: string, hint?: string) => { const id = E[role]; if (!id) return null; const state = k.st(role)?.state, on = onOffOf(state); return <div className="ah-row hm-setting at-kt-row" data-kettle-switch={role}><span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>{on === null ? <small>{t(state === 'unknown' ? 'state.unknown' : 'state.unavailable')}</small> : <button type="button" role="switch" className={`at-kt-sw ${on ? 'is-on' : ''}`} aria-checked={on} aria-label={label} aria-busy={ui.busy === role} disabled={!k.available || ui.busy !== null} onClick={() => void ui.run(role, [['switch', on ? 'turn_off' : 'turn_on', { entity_id: id }]])}><i /></button>}</div>; };
  const setNum = (role: string, value: number) => { const id = E[role]; if (id) void ui.run(role, [['number', 'set_value', { entity_id: id, value }]]); };
  const stepper = (label: string, value: number | null, min: number, max: number, step: number, onSet: (v: number) => void, unit = '°C') => { const off = !k.available || value === null || ui.busy !== null; return <div className="at-kt-stepper" role="group" aria-label={label}>
    <button type="button" className="hm-round" aria-label={`${label}: −${step}`} disabled={off || value! <= min} onClick={() => onSet(Math.max(min, value! - step))}>−</button>
    <b>{!k.available || value === null ? '—' : <>{num(value, lang, 0)}<i>{unit}</i></>}</b>
    <button type="button" className="hm-round" aria-label={`${label}: +${step}`} disabled={off || value! >= max} onClick={() => onSet(Math.min(max, value! + step))}>+</button></div>; };
  const left = k.phase === 'keep' && k.keepTime !== null ? Math.max(0, k.keepTime - k.warming) : null, keepT = k.keepTemp === null ? '—' : k.keepTemp;
  const status = k.phase === 'off' ? kk(t, 'offline') : k.phase === 'lifted' ? kk(t, 'lifted') : k.phase === 'heating' ? kk(t, k.target >= 99 ? 'boiling' : 'heatingTo', { t: k.target }) : k.phase === 'keep' ? kk(t, 'keeping', { t: keepT, h: left === null ? '' : left >= 60 ? kk(t, 'leftH', { n: hours(left) }) : kk(t, 'leftM', { n: Math.round(left) }) }) : k.phase === 'cooling' ? (k.keepTemp === null ? kk(t, 'tileCool') : kk(t, 'cooling', { t: k.keepTemp })) : kk(t, 'idle');
  const progress = k.phase === 'heating' && k.temp !== null ? Math.max(0, Math.min(1, (k.temp - 20) / Math.max(1, k.target - 20))) : null;
  const row = (id: string, icon: 'heat' | 'boil' | 'mode', title: string, hint: string, body: ComponentChildren) => <div className={`at-kt-mode ${open === id ? 'is-open' : ''}`}>
    <button type="button" className="at-kt-mode-hit" aria-expanded={open === id} disabled={!k.available} onClick={() => setOpen(open === id ? null : id)}><span className={`at-kt-ico is-${icon}`} aria-hidden="true"><ModeGlyph k={icon} /></span><span className="at-kt-mode-text"><b>{title}</b><small>{hint}</small></span><span className="at-kt-chev" aria-hidden="true">›</span></button>
    {open === id && <div className="at-kt-mode-body">{body}</div>}</div>;
  const go = (key: string, heat: number, keep: { temp: number; minutes: number } | null) => <button type="button" className="hm-pill at-kt-go" aria-busy={ui.busy === key} disabled={!k.available || k.lifted || ui.busy !== null} onClick={() => void start(key, heat, keep)}>{ui.busy === key ? kk(t, 'starting') : kk(t, 'start')}</button>;
  const hero = <section className={`at-kt-hero is-${k.phase}`}>
    <ProductPhoto src={photo} className="at-kt-hero-pic" eager />
    <small>{kk(t, 'water')}</small>
    <p className="at-kt-temp"><b>{k.temp === null ? '—' : num(k.temp, lang, 0)}</b>{k.temp !== null && <i>°C</i>}</p>
    <p className="at-kt-status" role="status">{status}</p>
    {progress !== null && <span className="at-kt-bar" role="progressbar" aria-label={status} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
    {active && <button type="button" className="hm-pill at-kt-stop" disabled={ui.busy !== null} onClick={() => void stop()}>{kk(t, 'stop')}</button>}
    {k.watts !== null && (k.watts > 5 || k.today !== null) && <small className="at-kt-energy">{k.watts > 5 ? kk(t, 'watts', { w: num(k.watts, lang, 0) }) : ''}{k.watts > 5 && k.today !== null ? ' · ' : ''}{k.today !== null ? kk(t, 'today', { kwh: num(k.today, lang, 2) }) : ''}</small>}
    <Wave />
  </section>;
  const modes = <>
    <div className="at-kt-card"><h3>{kk(t, 'general')}</h3>
      {row('heat', 'heat', kk(t, 'heat'), kk(t, 'heatHint', { t: heatTo }), <>{stepper(kk(t, 'heatTo'), heatTo, 40, 95, 5, setHeatTo)}<div className="at-kt-chips">{[45, 60, 70, 85, 90].map(v => <button type="button" className={v === heatTo ? 'is-on' : ''} aria-pressed={v === heatTo} onClick={() => setHeatTo(v)}>{v}°</button>)}</div>{go('heat', heatTo, null)}</>)}
      {row('boil', 'boil', kk(t, 'boil'), k.keepOn && k.keepTemp !== null ? kk(t, 'boilKeep', { t: k.keepTemp }) : kk(t, 'boilHint'), <>{go('boil', k.boilTemp, null)}</>)}
    </div>
    {k.modes.length > 0 && <div className="at-kt-card"><h3>{kk(t, 'extended')}</h3>
      {k.modes.map(m => row(m.id, 'mode', modeName(t, m.name), m.keep ? kk(t, 'modeHint', { t: m.heat, h: hours(m.minutes) }) : `${m.heat} °C`, <><p className="at-kt-note">{m.keep ? kk(t, 'modeLong', { t: m.heat, k: m.keepTemp, h: hours(m.minutes) }) : kk(t, 'modeShort', { t: m.heat })}{m.keep && (!k.keepOn || k.keepTemp !== m.keepTemp || k.keepTime !== m.minutes) ? ` ${kk(t, 'modeChanges')}` : ''}</p>{go(m.id, m.heat, m.keep ? { temp: m.keepTemp, minutes: m.minutes } : null)}</>))}
    </div>}
  </>;
  const settings = <div className="at-kt-card at-kt-set">
    {toggle('keepWarm', kk(t, 'keepAfter'), kk(t, 'keepAfterHint'))}
    {E.keepTemp && <div className="ah-row hm-setting at-kt-row is-col"><span className="ah-row-text"><strong>{kk(t, 'keepTemp')}</strong><small>{kk(t, 'keepTempHint')}</small></span>{stepper(kk(t, 'keepTemp'), draft ?? k.keepTemp, 40, 90, 5, stepKeepTemp)}</div>}
    {E.keepTime && <div className="ah-row hm-setting at-kt-row is-col"><span className="ah-row-text"><strong>{kk(t, 'keepTime')}</strong></span><div className="at-kt-chips">{[1, 2, 4, 8, 12, 24].map(h => <button type="button" className={k.keepTime !== null && hours(k.keepTime) === h ? 'is-on' : ''} aria-pressed={k.keepTime !== null && hours(k.keepTime) === h} disabled={!k.available || ui.busy !== null} onClick={() => setNum('keepTime', h * 60)}>{kk(t, 'h', { n: h })}</button>)}</div></div>}
    {toggle('liftRemember', kk(t, 'liftRemember'), kk(t, 'liftRememberHint'))}
    {toggle('boilRemind', kk(t, 'boilRemind'), kk(t, 'boilRemindHint'))}
    {toggle('warmRemind', kk(t, 'warmRemind'), kk(t, 'warmRemindHint'))}
    {toggle('dnd', kk(t, 'dnd'), kk(t, 'dndHint'))}
    {E.knob && <div className="ah-row hm-setting at-kt-row is-col"><span className="ah-row-text"><strong>{kk(t, 'knob')}</strong><small>{!k.available ? kk(t, 'offline') : k.knobModes === null ? t('state.unknown') : k.knobModes ? kk(t, 'knobModes', { list: k.knob.map(x => `${modeName(t, x.name)} ${x.temp}°`).join(', ') }) : kk(t, 'knobFree')}</small></span>
      <div className="at-kt-seg" role="radiogroup" aria-label={kk(t, 'knob')}>{[false, true].map(m => <button type="button" role="radio" aria-checked={k.available && k.knobModes === m} className={k.available && k.knobModes === m ? 'is-on' : ''} disabled={!k.available || k.knobModes === null || ui.busy !== null} onClick={() => { if (k.knobModes !== m) void ui.run('knob', [['switch', m ? 'turn_on' : 'turn_off', { entity_id: E.knob! }]]); }}>{kk(t, m ? 'knobModesShort' : 'knobFreeShort')}</button>)}</div></div>}
  </div>;
  // three screens like Mi Home (owner 09.11.2026: «настройки должны быть в шестерёнке третьим экраном»): the tile, the kettle, its settings behind the gear
  if (view === 'settings') return <div className="at-kt-sheet is-settings">
    <div className="hm-sheet-head at-kt-head"><button type="button" className="hm-icon-btn at-kt-back" aria-label={t('ui.back' as Key)} onClick={() => setView('main')}><Icon name="back" size={20} /></button><div><small>{kk(t, 'title')}</small><h2>{kk(t, 'settings')}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>
    {ui.err && <p className="at-kt-err" role="alert">{kk(t, 'fail')}: {ui.err}</p>}
    <div className="at-kt-body">{settings}</div>
  </div>;
  return <div className={`at-kt-sheet ${wide ? 'is-wide' : ''}`}>
    <div className="hm-sheet-head at-kt-head"><span className="at-kt-face" aria-hidden="true"><ProductPhoto src={photo} eager><KettleArt phase={k.phase} temp={null} /></ProductPhoto></span><div>{room && <small>{room}</small>}<h2>{kk(t, 'title')}</h2></div>
      <button type="button" className="hm-icon-btn at-kt-gear" aria-label={kk(t, 'settings')} onClick={() => setView('settings')}><Icon name="gear" size={20} /></button>
      <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>
    {ui.err && <p className="at-kt-err" role="alert">{kk(t, 'fail')}: {ui.err}</p>}
    <div className="at-kt-cols"><div className="at-kt-col">{hero}</div><div className="at-kt-col">{modes}</div></div>
  </div>;
}
function ModeGlyph({ k }: { k: 'heat' | 'boil' | 'mode' }) {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    {k === 'mode' ? <><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M14 5v6" /></> : <><path d="M5 12h14v4a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />{k === 'boil' ? <path d="M8 4c-1 2 1 3 0 5M12 4c-1 2 1 3 0 5M16 4c-1 2 1 3 0 5" /> : <path d="M10 4c-1 2 1 3 0 5M14 4c-1 2 1 3 0 5" />}</>}
  </svg>;
}
export const kettle: ModuleDef = {
  ...kettleSpec, sheetKey: 'kettle', photoEntity: entities => entities.heater,
  // the kettle's own entities only: the socket it stands on stays a socket of its own
  claims: entities => [entities.heater, ...(entities.rest ?? '').split(',')].filter((x): x is string => !!x),
  Card(props) {
    const { t, lang, onOpen } = props, k = read(props), own = usePhoto(props.entities.heater), photo = k.phase === 'off' ? null : own; // the kettle's product photo replaces the drawing, when the house has set one; a kettle with no connection keeps the drawing
    const line = k.phase === 'off' ? kk(t, 'tileOff') : k.phase === 'lifted' ? kk(t, 'tileLifted') : k.phase === 'heating' ? kk(t, k.target >= 99 ? 'tileBoil' : 'tileHeat', { t: k.target }) : k.phase === 'keep' ? kk(t, 'tileKeep', { t: k.keepTemp === null ? '—' : k.keepTemp }) : k.phase === 'cooling' ? kk(t, 'tileCool') : kk(t, 'idle');
    // like Mi Home's tile: the kettle's picture, its name, the state with the water's temperature
    const temp = k.temp === null ? '' : ` · ${num(k.temp, lang, 0)}°`;
    return <div className={`ah-tile hm-card at-kt-tile is-${k.phase}`} data-module-card="kettle"><button type="button" className="ah-tile-hit" onClick={onOpen} disabled={!onOpen} aria-label={`${kk(t, 'title')}: ${line}${k.temp === null ? '' : `, ${Math.round(k.temp)} °C`}`}>
      <span className="at-kt-tile-art"><ProductPhoto src={photo}><KettleArt phase={k.phase} temp={null} /></ProductPhoto></span>
      <span className="ah-tile-text"><strong>{kk(t, 'title')}</strong><small>{line}{k.phase === 'off' ? '' : temp}</small></span></button></div>;
  },
};
