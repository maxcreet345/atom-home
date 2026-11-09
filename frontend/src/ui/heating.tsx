import { useEffect, useRef, useState } from 'preact/hooks';
import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from './format.ts';
import { Icon } from './primitives.tsx';
import { DeviceArt } from './device-art.tsx';
import { heatTone, heatingRooms, type HeatRoom, type Heating, type HeatTone, type Scenario } from '../model/heating.ts';
/** The Heating card and panel (mock for the owner, 09.11.2026). The look is the Air card's family: a tinted tile with a little character
 * and one sentence, a panel with a wide tinted hero, then the rooms and the boiler. docs/HEATING.md */
const tk = (t: T, k: string, p?: Record<string, string | number>) => t(`module.heat.${k}` as Key, p);
const LOC: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
/** 20 → «20», 20.5 → «20,5»: the set temperature; the room's reading always has its tenth. */
const setT = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(LOC[lang], { maximumFractionDigits: 1 });
const nowT = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(LOC[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const left = (ms: number, t: T) => { const m = Math.max(1, Math.round(ms / 60000)), h = Math.floor(m / 60); return h ? tk(t, 'leftHM', { h, m: m % 60 }) : tk(t, 'leftM', { m }); };
const short = (name: string) => name.length > 9 ? `${name.slice(0, 4)}.` : name;
/** What the panel can do. Every command is one HA service the automations already understand (HEATING.md §D). */
export function heatingActions(h: Heating, host: Host) {
  const call = (d: string, s: string, data: Record<string, unknown>) => host.call(d, s, data);
  return {
    /** «Авто»: the common temperature — in «Дома» it is the «Дома» temperature, in another scenario a change until the scenario ends (as on the thermostat).
     * «Ручной»: every room gets it at once. */
    house: (v: number): Promise<unknown> => h.mode === 'manual' ? Promise.all(h.rooms.map(r => call('input_number', 'set_value', { entity_id: `input_number.${r.key}_heating_manual_temp`, value: v }))) :
      h.scenario === 'home' ? call('input_number', 'set_value', { entity_id: 'input_number.heating_home_temp', value: v }) :
      Promise.all([call('input_number', 'set_value', { entity_id: 'input_number.heating_scenario_override_temp', value: v }), call('input_boolean', 'turn_on', { entity_id: 'input_boolean.heating_scenario_override' })]),
    mode: (m: 'auto' | 'manual') => call('input_select', 'select_option', { entity_id: 'input_select.heating_mode', option: m === 'manual' ? 'Ручной' : 'Авто' }),
    power: (on: boolean) => call('climate', 'set_hvac_mode', { entity_id: h.thermostat, hvac_mode: on ? 'heat' : 'off' }),
    /** the head itself: in «Авто» the automation keeps it three hours, in «Ручной» it becomes the room's temperature */
    room: (r: HeatRoom, v: number) => call('climate', 'set_temperature', { entity_id: r.trv, temperature: v }),
    back: (r: HeatRoom) => call('timer', 'cancel', { entity_id: `timer.${r.key}_heating_override` }),
    /** the heads' hysteresis for the whole house: the helpers only, the heating automation puts it on every head */
    hyst: (k: 'down' | 'up', v: number) => call('input_number', 'set_value', { entity_id: `input_number.heating_hyst_${k}`, value: v }),
    flag: (k: 'eco' | 'guests' | 'vacation', on: boolean) => call('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: `input_boolean.heating_${k}` }),
  };
}
/** One command at a time per card: the button that sent it waits, a refusal is said in words. */
/** The refusal is said next to the control that sent it (a room's card, the scenarios, the hero), and the next accepted command clears it. */
function useAct(t: T) {
  const [busy, setBusy] = useState<string | null>(null), [errKey, setErrKey] = useState<string | null>(null);
  const fail = (key: string) => setErrKey(key), ok = () => setErrKey(null);
  const run = (key: string, p: () => Promise<unknown>) => { if (busy === key) return; setBusy(key); setErrKey(null); p().then(ok, () => fail(key)).finally(() => setBusy(null)); };
  const err = (...keys: string[]) => errKey && keys.some(k => errKey === k || errKey.startsWith(k + ':')) ? tk(t, 'failed') : null;
  return { busy, err, fail, ok, run };
}
const Err = ({ text }: { text: string | null }) => <p className="at-heat-err" role="alert">{text ?? ''}</p>;
/** Turning the whole house's heating off asks once more; turning it on does not. */
function Power({ on, busy, t, onPower, offline }: { on: boolean; busy: boolean; t: T; onPower: (v: boolean) => void; offline?: boolean }) {
  const [ask, setAsk] = useState(false), cancel = useRef<HTMLButtonElement>(null), main = useRef<HTMLButtonElement>(null), back = useRef(false);
  // focus goes to the safe choice when the question opens, and back to the button when it closes (WCAG 2.4.3)
  useEffect(() => { if (ask) cancel.current?.focus(); else if (back.current) { back.current = false; main.current?.focus(); } }, [ask]);
  const close = () => { back.current = true; setAsk(false); };
  if (offline) return <p className="at-heat-modehint">{tk(t, 'screenOffPower')}</p>; // HA would quietly skip a command to a thermostat it cannot reach
  if (ask) return <div className="at-heat-confirm" role="group" aria-label={tk(t, 'confirmOff')} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}><span>{tk(t, 'confirmOff')}</span><button type="button" className="at-heat-power is-danger" onClick={e => { e.stopPropagation(); close(); onPower(false); }}>{tk(t, 'offYes')}</button><button type="button" ref={cancel} className="at-heat-power is-on" onClick={e => { e.stopPropagation(); close(); }}>{tk(t, 'cancel')}</button></div>;
  return <button type="button" ref={main} className={`at-heat-power ${on ? 'is-on' : ''}`} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={e => { e.stopPropagation(); if (busy) return; if (on) setAsk(true); else onPower(true); }}><Icon name="power" size={16} />{on ? tk(t, 'turnOff') : tk(t, 'turnOn')}</button>;
}
/** The house's little radiator: warm and smiling with heat rising while a room heats, content when all is warm, asleep when off, worried when something is wrong. */
export function Radiator({ tone }: { tone: HeatTone }) {
  const fins = [0, 1, 2, 3].map(i => <rect x={14 + i * 24} y="34" width="20" height="54" rx="9" className="at-heat-fin" />);
  return <svg className={`at-heat-buddy is-${tone}`} viewBox="0 0 124 104" aria-hidden="true">
    {tone === 'heat' && <g className="at-heat-waves" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M38 26c-5-5 5-9 0-15" /><path d="M62 24c-5-5 5-9 0-15" /><path d="M86 26c-5-5 5-9 0-15" /></g>}
    {tone === 'off' && <g className="at-heat-zz" fill="currentColor" font-size="15" font-weight="700"><text x="88" y="22">z</text><text x="100" y="12" font-size="11">z</text></g>}
    <rect x="8" y="80" width="108" height="8" rx="4" className="at-heat-pipe" />{fins}
    <rect x="20" y="88" width="8" height="10" rx="3" className="at-heat-pipe" /><rect x="96" y="88" width="8" height="10" rx="3" className="at-heat-pipe" />
    {tone === 'off' ? <path d="M46 58q5 4 10 0M68 58q5 4 10 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" /> : tone === 'warn' ? <g fill="#2b3a44"><ellipse cx="51" cy="57" rx="4.5" ry="5.5" /><ellipse cx="73" cy="57" rx="4.5" ry="5.5" /><path d="M43 47l11 3M81 47l-11 3" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /></g> : <path d="M45 58q6-7 12 0M67 58q6-7 12 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />}
    {tone !== 'off' && <><ellipse cx="42" cy="68" rx="6" ry="3.8" fill="#ff6f5a" opacity=".4" /><ellipse cx="82" cy="68" rx="6" ry="3.8" fill="#ff6f5a" opacity=".4" /></>}
    {tone === 'warn' ? <path d="M56 74q6-5 12 0" fill="none" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /> : tone === 'off' ? <path d="M58 72h8" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /> : <path d="M55 70q7 6 14 0" fill="none" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" />}
  </svg>;
}
const WIN = 'M5 3h14v18H5zM12 3v18M5 12h14';
const Glyph = ({ d, size = 14 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>;
/** The words for a room's state, the same on the tile's chip (its label) and in the panel. */
function roomWord(r: HeatRoom, t: T, now: number) {
  if (r.action === 'offline') return tk(t, 'r.offline');
  if (r.action === 'window') return tk(t, 'r.window');
  const open = r.windows.find(w => w.open);
  if (open && open.since && now - open.since < 60000) return tk(t, 'r.windowSoon');
  if (r.action === 'off') return tk(t, 'r.off');
  return r.action === 'heating' ? tk(t, 'r.heating') : tk(t, 'r.idle');
}
function sentence(h: Heating, t: T, lang: Lang): string {
  if (!h.systemKnown) return tk(t, 'noState');
  if (!h.system) return tk(t, 'offSentence');
  if (!h.thermostatOnline) return tk(t, 'screenOff');
  const off = h.rooms.filter(r => r.action === 'offline');
  if (off.length) return tk(t, 'noLink', { rooms: off.map(r => r.name).join(', ') });
  if (h.boiler.pressureLow || h.boiler.pressureHigh) return tk(t, h.boiler.pressureLow ? 'pressureLow' : 'pressureHigh', { v: h.boiler.pressure === null ? '—' : h.boiler.pressure.toLocaleString(LOC[lang], { maximumFractionDigits: 2 }) });
  const n = heatingRooms(h), win = h.rooms.filter(r => r.action === 'window');
  const main = n ? tk(t, 'heatN', { n, total: h.rooms.length }) : tk(t, 'warmAll');
  return win.length ? `${main} · ${tk(t, 'winPaused', { n: win.length })}` : main;
}
function caption(h: Heating, t: T): string {
  if (!h.system) return tk(t, 'offHint');
  if (!h.scenarioKnown) return tk(t, 'noScenario');
  if (h.mode === 'manual') return tk(t, 'capManual');
  const sc = tk(t, `sc.${h.scenario}`);
  if (h.scenario === 'home') return tk(t, 'capHome');
  if (h.scenario === 'sleep') return h.scenarioOverride ? tk(t, 'capOwnTill', { s: sc, at: h.sleep.to }) : tk(t, 'capTill', { s: sc, at: h.sleep.to });
  return h.scenarioOverride ? tk(t, 'capOwn', { s: sc }) : sc;
}
/** The number the house is held at: in «Ручной» the rooms' common value when they agree, else their range. */
function houseValue(h: Heating, lang: Lang): { text: string; value: number | null; lo?: number } {
  if (h.mode !== 'manual') return h.scenarioKnown ? { text: setT(h.target, lang), value: h.target } : { text: setT(h.target, lang), value: null }; // an unknown scenario must not be taken for «Дома» and overwritten
  const vals = h.rooms.map(r => r.manual).filter((x): x is number => x !== null), min = Math.min(...vals), max = Math.max(...vals);
  // a range: − starts from its low end, + from its high end, so neither raises or lowers every room by surprise
  return !vals.length ? { text: '—', value: null } : min === max ? { text: setT(min, lang), value: min } : { text: `${setT(min, lang)}–${setT(max, lang)}`, value: max, lo: min };
}
/** ± answers at once and sends the last value after a short pause, so five taps are one command. */
/** A refused command puts the real value back and says so; an accepted one that HA never reflects gives up after 20 s. */
function useStepper(value: number | null, send: (v: number) => Promise<unknown>, onFail: () => void, onOk: () => void, min = 8, max = 24, lo?: number, by = 0.5) {
  const [local, setLocal] = useState<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), stale = useRef<ReturnType<typeof setTimeout> | null>(null), seq = useRef(0), waiting = useRef<number | null>(null);
  useEffect(() => { if (local !== null && value === local) setLocal(null); }, [value]);
  const fire = (v: number) => { const n = ++seq.current; waiting.current = null; send(v).then(() => { if (n === seq.current) onOk(); }, () => { if (n === seq.current) { setLocal(null); onFail(); } }); stale.current = setTimeout(() => { if (n === seq.current) setLocal(null); }, 20000); };
  // leaving the card within the pause still sends the last value: a tap is never lost
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (stale.current) clearTimeout(stale.current); if (waiting.current !== null) fire(waiting.current); }, []);
  const shown = local ?? value;
  const step = (dir: 1 | -1) => { if (shown === null) return; const base = local ?? (dir < 0 && lo !== undefined ? lo : shown); const v = Math.min(max, Math.max(min, Math.round((base + dir * by) / by) * by)); const r = Math.round(v * 10) / 10; setLocal(r); waiting.current = r; seq.current++; if (timer.current) clearTimeout(timer.current); if (stale.current) clearTimeout(stale.current);
    timer.current = setTimeout(() => fire(r), 700); };
  return { shown, step, pending: local !== null && local !== value, atMin: shown !== null && (local ?? lo ?? shown) <= min, atMax: shown !== null && shown >= max };
}
function Stepper({ value, text, onStep, t, size = 'big', disabled, label, atMin, atMax, pending, fine }: { value: number | null; text: string; onStep: (d: 1 | -1) => void; t: T; size?: 'big' | 'small'; disabled?: boolean; label: string; atMin?: boolean; atMax?: boolean; pending?: boolean; /** steps of 0,2° */ fine?: boolean }) {
  return <div className={`at-heat-step is-${size} ${pending ? 'is-pending' : ''} ${text.includes('–') ? 'is-range' : ''}`} role="group" aria-label={label}>
    <button type="button" className="at-heat-pm" aria-label={`${label}: ${tk(t, fine ? 'downFine' : 'down')}`} disabled={disabled || value === null} aria-disabled={atMin || undefined} onClick={e => { e.stopPropagation(); if (!atMin) onStep(-1); }}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg></button>
    <b aria-live="polite">{text}<i>°</i></b>
    <button type="button" className="at-heat-pm" aria-label={`${label}: ${tk(t, fine ? 'upFine' : 'up')}`} disabled={disabled || value === null} aria-disabled={atMax || undefined} onClick={e => { e.stopPropagation(); if (!atMax) onStep(1); }}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg></button>
  </div>;
}
function ModeSwitch({ h, t, onMode, disabled }: { h: Heating; t: T; onMode: (m: 'auto' | 'manual') => void; disabled?: boolean }) {
  // the group is the radio set; the arrow keys are not needed for two options, Tab reaches both
  return <div className="at-heat-mode" role="radiogroup" aria-label={tk(t, 'mode')}>{(['auto', 'manual'] as const).map(m => <button type="button" role="radio" aria-checked={h.mode === m} className={h.mode === m ? 'is-on' : ''} aria-disabled={disabled || undefined} onClick={e => { e.stopPropagation(); if (!disabled && h.mode !== m) onMode(m); }}>{tk(t, `mode.${m}`)}</button>)}</div>;
}
/** One room on the tile: its radiator lit while it heats, its reading, its name; a window or a lost head says so instead of the reading. */
function Chip({ r, t, lang, now }: { r: HeatRoom; t: T; lang: Lang; now: number }) {
  const winOpen = r.windows.some(w => w.open);
  return <li className={`at-heat-chip is-${r.action}`} aria-label={`${r.name}: ${nowT(r.current, lang)}°, ${roomWord(r, t, now)}`}>
    <span className="at-heat-chip-dot" aria-hidden="true">{r.action === 'window' || winOpen ? <Glyph d={WIN} size={13} /> : r.action === 'offline' ? '!' : <Icon name="flame" size={13} />}</span>
    <b>{r.action === 'offline' ? '—' : <>{nowT(r.current, lang)}<i>°</i></>}</b><small>{short(r.name)}</small>
  </li>;
}
export function HeatingTile({ h, host, t, lang, onOpen, now }: { h: Heating; host: Host; t: T; lang: Lang; onOpen: () => void; now: number }) {
  const act = heatingActions(h, host), tone = heatTone(h), hv = houseValue(h, lang), ui = useAct(t);
  const st = useStepper(hv.value, act.house, () => ui.fail('house'), ui.ok, 8, 24, hv.lo);
  const text = st.pending && st.shown !== null ? setT(st.shown, lang) : hv.text;
  return <div className={`ah-tile hm-card at-heat-tile hz-${tone}`} data-mode={h.mode}>
    <button type="button" className="at-heat-open" aria-label={`${tk(t, 'title')}: ${sentence(h, t, lang)}. ${tk(t, 'open')}`} onClick={onOpen} />
    <span className="at-heat-tile-buddy"><Radiator tone={tone} /></span>
    <div className="at-heat-tile-head"><strong>{tk(t, 'title')}</strong><small>{sentence(h, t, lang)}</small><Err text={ui.err('house', 'mode', 'power')} /></div>
    <div className="at-heat-tile-mid">
      {h.system || !h.systemKnown ? <><ModeSwitch h={h} t={t} disabled={ui.busy === 'mode'} onMode={m => ui.run('mode', () => act.mode(m))} />
        <Stepper value={st.shown} text={text} onStep={st.step} t={t} label={tk(t, 'houseTemp')} atMin={st.atMin} atMax={st.atMax} pending={st.pending} />
        <small className="at-heat-cap">{caption(h, t)}</small></> :
        <><b className="at-heat-offword">{tk(t, 'offWord')}</b>{h.systemKnown && <Power on={false} busy={ui.busy === 'power'} offline={!h.thermostatOnline} t={t} onPower={v => ui.run('power', () => act.power(v))} />}</>}
    </div>
    <ul className="at-heat-chips">{h.rooms.map(r => <Chip r={r} t={t} lang={lang} now={now} />)}</ul>
  </div>;
}
/* ---------- the panel ---------- */
function RoomCard({ r, h, act, t, lang, now, ui }: { r: HeatRoom; h: Heating; act: ReturnType<typeof heatingActions>; t: T; lang: Lang; now: number; ui: ReturnType<typeof useAct> }) {
  const st = useStepper(r.target, v => act.room(r, v), () => ui.fail(`room:${r.key}`), ui.ok, 5, 30), dis = !h.system || r.action === 'offline' || r.action === 'window';
  const own = h.mode === 'auto' && r.override, gap = r.current !== null && st.shown !== null ? st.shown - r.current : null;
  const fill = r.current === null || st.shown === null ? 0 : Math.max(4, Math.min(100, 100 - Math.max(0, st.shown - r.current) / 3 * 100));
  const openWins = r.windows.filter(w => w.open);
  return <article className={`at-heat-room is-${r.action}`} aria-label={r.name}>
    <header><strong>{r.name}</strong><span className={`at-heat-badge is-${r.action}`}>{r.action === 'heating' && <i className="at-heat-badge-wave" aria-hidden="true" />}{roomWord(r, t, now)}</span></header>
    <div className="at-heat-room-nums">
      <div className="at-heat-now"><b>{r.action === 'offline' ? '—' : <>{nowT(r.current, lang)}<i>°</i></>}</b><small>{tk(t, 'inRoom')}</small></div>
      <div className="at-heat-set"><small>{own ? tk(t, 'ownSet') : h.mode === 'manual' ? tk(t, 'manualSet') : tk(t, 'set')}</small>
        {r.action === 'window' || r.action === 'off' || !h.system ? <b className="is-muted">{tk(t, 'r.off')}</b> : <Stepper value={st.shown} text={setT(st.shown, lang)} onStep={st.step} t={t} size="small" disabled={dis} label={`${r.name}: ${tk(t, 'set')}`} atMin={st.atMin} atMax={st.atMax} pending={st.pending} />}</div>
    </div>
    <div className="at-heat-bar" aria-hidden="true"><i style={`width:${fill}%`} /></div>
    <p className="at-heat-room-line">{r.action === 'window' ? tk(t, 'windowLine', { w: openWins.map(w => w.name.toLowerCase()).join(', ') || tk(t, 'aWindow') }) : r.action === 'offline' ? tk(t, 'offlineLine') : gap !== null && gap > 0.05 && r.action === 'heating' ? tk(t, 'gapLine', { d: setT(Math.round(gap * 10) / 10, lang) }) : r.action === 'idle' ? tk(t, 'idleLine') : r.action === 'off' ? tk(t, 'offLine') : ''}</p>
    {own && r.override && <div className="at-heat-own"><span><Icon name="hourglass" size={15} />{tk(t, 'ownLine', { v: setT(r.override.temp, lang), at: hhmm(r.override.until), left: left(r.override.until - now, t) })}</span><button type="button" className="hm-text-btn" aria-disabled={ui.busy === `back:${r.key}` || undefined} onClick={() => ui.run(`back:${r.key}`, () => act.back(r))}>{tk(t, 'backAuto')}</button></div>}
    <Err text={ui.err(`room:${r.key}`, `back:${r.key}`)} />
    <footer>
      <span className={openWins.length ? 'is-open' : ''}><Glyph d={WIN} />{r.windows.length ? (openWins.length ? tk(t, 'winOpen', { w: openWins.map(w => w.name.toLowerCase()).join(', ') }) : r.windows.length > 1 ? tk(t, 'winsClosed', { n: r.windows.length }) : tk(t, 'winClosed')) : tk(t, 'noWin')}</span>
      {r.battery !== null && <span className={r.battery < 20 ? 'is-open' : ''}><Icon name="battery" size={14} />{r.battery} %</span>}
    </footer>
  </article>;
}
const SCEN: Array<{ id: Scenario | 'guests'; flag?: 'eco' | 'guests' | 'vacation' }> = [{ id: 'home' }, { id: 'sleep' }, { id: 'away' }, { id: 'eco', flag: 'eco' }, { id: 'guests', flag: 'guests' }, { id: 'vacation', flag: 'vacation' }];
function Scenarios({ h, act, t, lang, ui }: { h: Heating; act: ReturnType<typeof heatingActions>; t: T; lang: Lang; ui: ReturnType<typeof useAct> }) {
  const sub = (id: string) => id === 'home' ? tk(t, 'scs.home') : id === 'sleep' ? `${h.sleep.from}–${h.sleep.to}` : id === 'away' ? tk(t, 'scs.away') : id === 'eco' ? tk(t, 'scs.eco') : id === 'guests' ? tk(t, 'scs.guests') : h.vacation && h.vacationReturn ? tk(t, 'scs.back', { at: new Date(h.vacationReturn.replace(' ', 'T')).toLocaleDateString(LOC[lang], { day: 'numeric', month: 'short' }) }) : tk(t, 'scs.vacation');
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'scenario')}</h2></div>
    <div className="at-heat-scen">{SCEN.map(s => { const now = s.id === h.scenario, on = s.flag ? h[s.flag] : now, temp = s.id === 'guests' ? null : h.temps[s.id as Scenario];
      const body = <><span className="at-heat-scen-top"><strong>{tk(t, `sc.${s.id}`)}</strong>{temp !== null && <b>{setT(temp, lang)}°</b>}</span><small>{sub(s.id)}</small>{now ? <em>{tk(t, 'now')}</em> : s.flag ? <em className="is-sw">{on ? tk(t, 'on') : tk(t, 'turnOnShort')}</em> : <em className="is-auto">{tk(t, 'byItself')}</em>}</>;
      return s.flag ? <button type="button" role="switch" aria-checked={on} className={`at-heat-scen-card ${now ? 'is-now' : ''} ${on ? 'is-on' : ''}`} aria-disabled={ui.busy === s.flag || undefined} aria-busy={ui.busy === s.flag || undefined} onClick={() => ui.run(s.flag!, () => act.flag(s.flag!, !on))}>{body}</button> : <div className={`at-heat-scen-card ${now ? 'is-now' : ''}`}>{body}</div>; })}</div><Err text={ui.err('eco', 'guests', 'vacation')} /></section>;
}
/** One hysteresis for all five heads. A head can open again at most 1° below where it closes, so «down» and «up» share that degree. */
function Hysteresis({ h, act, t, lang, ui }: { h: Heating; act: ReturnType<typeof heatingActions>; t: T; lang: Lang; ui: ReturnType<typeof useAct> }) {
  const y = h.hyst!, down = useStepper(y.down, v => act.hyst('down', v), () => ui.fail('hyst'), ui.ok, 0.2, Math.min(1, Math.round((1 - y.up) * 10) / 10), undefined, 0.2), up = useStepper(y.up, v => act.hyst('up', v), () => ui.fail('hyst'), ui.ok, 0, Math.round((1 - (down.shown ?? y.down)) * 10) / 10, undefined, 0.2);
  const base = h.target ?? 20, d = down.shown ?? y.down, u = up.shown ?? y.up, f = (v: number) => v.toLocaleString(LOC[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'hyst')}</h2><small className="at-heat-sec-hint">{tk(t, 'hystAll')}</small></div>
    <div className="at-heat-hyst">
      <div className="at-heat-hyst-row"><div><strong>{tk(t, 'hystDown')}</strong><small>{tk(t, 'hystDownHint')}</small></div><Stepper value={down.shown} text={f(d)} onStep={down.step} t={t} size="small" label={tk(t, 'hystDown')} fine atMin={down.atMin} atMax={down.atMax} pending={down.pending} /></div>
      <div className="at-heat-hyst-row"><div><strong>{tk(t, 'hystUp')}</strong><small>{tk(t, 'hystUpHint')}</small></div><Stepper value={up.shown} text={f(u)} onStep={up.step} t={t} size="small" label={tk(t, 'hystUp')} fine atMin={up.atMin} atMax={up.atMax} pending={up.pending} /></div>
      <p className="at-heat-hyst-say">{tk(t, 'hystExample', { t: setT(base, lang), from: f(Math.round((base - d) * 10) / 10), to: f(Math.round((base + u) * 10) / 10) })}</p>
      <Err text={ui.err('hyst')} />
    </div></section>;
}
function BoilerCard({ h, t, lang }: { h: Heating; t: T; lang: Lang }) {
  const b = h.boiler, f = (v: number | null, d = 1) => v === null ? '—' : v.toLocaleString(LOC[lang], { maximumFractionDigits: d }), low = b.pressureLow, high = b.pressureHigh;
  const cell = (label: string, value: string, unit: string, sub: string, tone = '') => <div className={`at-heat-bcell ${tone}`}><small>{label}</small><b>{value}{value !== '—' && <i>{unit}</i>}</b><span>{sub}</span></div>;
  const state = !b.online ? tk(t, 'b.offline') : b.flame ? (b.relay ? tk(t, 'b.burningHeat') : tk(t, 'b.burningDhw')) : tk(t, 'b.idle');
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'boiler')}</h2></div>
    <article className={`at-heat-boiler ${b.online ? '' : 'is-offline'} ${b.flame ? 'is-burning' : ''}`}>
      <header><span className="at-heat-boiler-art"><DeviceArt type="boiler" fill /></span><div><strong>Demir Döküm Nitromix P24</strong><small>{state}</small></div>
        <span className={`at-heat-relay ${b.relay ? 'is-on' : ''}`}><Icon name="flame" size={15} />{b.relay ? tk(t, 'b.ask') : tk(t, 'b.noAsk')}</span></header>
      <div className="at-heat-bgrid">
        {cell(tk(t, 'b.flow'), f(b.flow), '°', b.flowTarget !== null ? tk(t, 'b.target', { v: f(b.flowTarget, 0) }) : '')}
        {cell(tk(t, 'b.dhw'), f(b.dhw), '°', b.dhwTarget !== null ? tk(t, 'b.target', { v: f(b.dhwTarget, 0) }) : '')}
        {cell(tk(t, 'b.return'), f(b.ret), '°', b.flow !== null && b.ret !== null ? `Δ ${f(Math.abs(b.flow - b.ret))}°` : '')}
        {cell(tk(t, 'b.pressure'), f(b.pressure, 2), ' bar', low ? tk(t, 'b.low') : high ? tk(t, 'b.high') : tk(t, 'b.norm'), low || high ? 'is-warn' : '')}
      </div>
      {!b.online && <p className="at-heat-bnote">{tk(t, 'b.offlineNote')}</p>}
    </article></section>;
}
export function HeatingPanel({ h, host, t, lang, now }: { h: Heating; host: Host; t: T; lang: Lang; now: number }) {
  const act = heatingActions(h, host), tone = heatTone(h), hv = houseValue(h, lang), ui = useAct(t), st = useStepper(hv.value, act.house, () => ui.fail('house'), ui.ok, 8, 24, hv.lo);
  const out = h.outdoor.temp !== null ? tk(t, 'outside', { v: setT(Math.round(h.outdoor.temp), lang).replace('-', '−'), w: (k => t(k as Key) === k ? '' : ` · ${t(k as Key).toLocaleLowerCase()}`)(`clock.weather.${(h.outdoor.state ?? '').replace('-', '')}`) }) : '';
  return <div className="at-heat-panel">
    <section className={`at-heat-hero hz-${tone}`} aria-label={tk(t, 'title')}>
      <div className="at-heat-hero-text"><h2>{tk(t, 'title')}</h2>{out && <small>{out}</small>}<p className="at-heat-hero-say">{sentence(h, t, lang)}</p><Err text={ui.err('house', 'mode', 'power')} /></div>
      <span className="at-heat-hero-buddy"><Radiator tone={tone} /></span>
      <div className="at-heat-hero-ctl">
        {h.system || !h.systemKnown ? <div className="at-heat-hero-temp"><Stepper value={st.shown} text={st.pending && st.shown !== null ? setT(st.shown, lang) : hv.text} onStep={st.step} t={t} label={tk(t, 'houseTemp')} atMin={st.atMin} atMax={st.atMax} pending={st.pending} /><small className="at-heat-cap">{caption(h, t)}</small></div> : <div className="at-heat-hero-temp"><b className="at-heat-offword">{tk(t, 'offWord')}</b><small className="at-heat-cap">{tk(t, 'offHint')}</small></div>}
        <ul className="at-heat-hero-facts">
        <li className={h.boiler.relay ? 'is-hot' : ''}><Icon name="flame" size={15} />{!h.boiler.online ? tk(t, 'f.boilerOff') : h.boiler.flame ? tk(t, 'f.burning', { v: setT(h.boiler.flow === null ? null : Math.round(h.boiler.flow), lang) }) : tk(t, 'f.rest')}</li>
        <li><Icon name="thermo" size={15} />{h.thermostatOnline ? tk(t, 'f.screen') : tk(t, 'f.screenOff')}</li>
        <li className={h.rooms.some(r => r.windows.some(w => w.open)) ? 'is-warn' : ''}><Glyph d={WIN} />{(n => n ? tk(t, 'f.winOpen', { n }) : tk(t, 'f.winClosed'))(h.rooms.reduce((a, r) => a + r.windows.filter(w => w.open).length, 0))}</li>
      </ul>
        <div className="at-heat-hero-side">{(h.system || !h.systemKnown) && <ModeSwitch h={h} t={t} disabled={ui.busy === 'mode'} onMode={m => ui.run('mode', () => act.mode(m))} />}<small className="at-heat-modehint">{h.mode === 'manual' ? tk(t, 'manualHint') : tk(t, 'autoHint')}</small>
          {h.systemKnown && <Power on={h.system} busy={ui.busy === 'power'} offline={!h.thermostatOnline} t={t} onPower={v => ui.run('power', () => act.power(v))} />}</div>
      </div>

    </section>
    <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'rooms')}</h2><small className="at-heat-sec-hint">{h.mode === 'manual' ? tk(t, 'roomsManual') : tk(t, 'roomsAuto')}</small></div>
      <div className="at-heat-rooms">{h.rooms.map(r => <RoomCard r={r} h={h} act={act} t={t} lang={lang} now={now} ui={ui} />)}</div></section>
    <Scenarios h={h} act={act} t={t} lang={lang} ui={ui} />
    <BoilerCard h={h} t={t} lang={lang} />
    {h.hyst && <Hysteresis h={h} act={act} t={t} lang={lang} ui={ui} />}
  </div>;
}
