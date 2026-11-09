import { useEffect, useRef, useState } from 'preact/hooks';
import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from './format.ts';
import { Icon } from './primitives.tsx';
import { useAct, Err } from './heating.tsx';
import { percentLeft, vacuumAlerts, type Consumable, type VacSelect, type VacSwitch, type Vacuum } from '../model/vacuum.ts';
/** The robot vacuum: a tile on «Дом», a panel in «Системы → Уборка», and its settings behind the gear in the panel's corner.
 * The look follows the Roborock app the owner uses (device card → map panel → settings), in the panel's own family:
 * a tinted tile with a little character and one sentence, like Air and Heating. docs/VACUUM.md */
const tk = (t: T, k: string, p?: Record<string, string | number>) => t(`module.vac.${k}` as Key, p);
/** A word from the dictionary, or the integration's own word made readable when the dictionary has none. */
const word = (t: T, k: string, raw: string) => { const v = tk(t, k); return v === `module.vac.${k}` ? raw.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : v; };
const LOC: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
const fmt = (v: number, lang: Lang, d = 0) => v.toLocaleString(LOC[lang], { maximumFractionDigits: d });
const dur = (min: number | null, t: T) => { if (min === null) return '—'; const m = Math.round(min), h = Math.floor(m / 60); return h ? tk(t, 'hm', { h, m: m % 60 }) : tk(t, 'm', { m }); };
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
export type VacTone = 'clean' | 'pause' | 'dock' | 'care' | 'warn';
export function vacTone(v: Vacuum): VacTone {
  if (v.phase === 'error' || v.phase === 'offline') return 'warn'; // red is for a stuck or lost robot only
  if (vacuumAlerts(v).length && (v.phase === 'docked' || v.phase === 'idle')) return 'care'; // a tank or a part: amber, the robot itself is fine
  return v.phase === 'cleaning' || v.phase === 'returning' ? 'clean' : v.phase === 'paused' ? 'pause' : 'dock';
}
/** What the robot does, in one sentence. */
export function vacSentence(v: Vacuum, t: T, lang: Lang): string {
  if (v.phase === 'offline') return tk(t, 's.offline');
  if (v.phase === 'error') return v.error ? tk(t, 's.error', { e: word(t, `err.${v.error}`, v.error) }) : tk(t, 's.errorPlain');
  const pct = v.progress !== null ? ` · ${fmt(v.progress, lang)} %` : '';
  if (v.phase === 'cleaning') { if (v.status && ['washing_the_mop', 'going_to_wash_the_mop', 'emptying_the_bin'].includes(v.status)) return word(t, `st.${v.status}`, v.status) + pct; return (v.currentRoom ? tk(t, 's.cleaningIn', { r: v.currentRoom }) : tk(t, 's.cleaning')) + pct; }
  if (v.phase === 'paused') return v.currentRoom ? tk(t, 's.pausedIn', { r: v.currentRoom }) : tk(t, 's.paused');
  if (v.phase === 'returning') return tk(t, 's.returning');
  if (v.status && ['washing_the_mop', 'emptying_the_bin', 'drying_the_mop', 'drying'].includes(v.status)) return word(t, `st.${v.status}`, v.status);
  if (v.dock.dryingLeft) return tk(t, 's.drying');
  if (v.phase === 'docked') return v.battery !== null && v.battery >= 100 ? tk(t, 's.dockedFull') : v.charging ? tk(t, 's.charging') : tk(t, 's.docked');
  return tk(t, 's.idle');
}
/** Every command is one HA service; the rooms go through HA's own area link (vacuum.clean_area). */
export function vacuumActions(v: Vacuum, host: Host) {
  const call = (d: string, s: string, data: Record<string, unknown> = {}) => host.call(d, s, { entity_id: v.entity, ...data });
  return {
    start: () => call('vacuum', 'start'), pause: () => call('vacuum', 'pause'), stop: () => call('vacuum', 'stop'), dock: () => call('vacuum', 'return_to_base'), locate: () => call('vacuum', 'locate'),
    /** the chosen rooms in HA's link; more than one pass goes to the robot directly, as clean_area has no repeat */
    rooms: (areas: string[], repeat: number) => repeat > 1
      ? call('vacuum', 'send_command', { command: 'app_segment_clean', params: [{ segments: areas.flatMap(a => v.rooms.find(r => r.areaId === a)?.segments ?? []).map(s => Number(s.split('_').pop())), repeat }] })
      : call('vacuum', 'clean_area', { cleaning_area_id: areas }),
    fan: (speed: string) => call('vacuum', 'set_fan_speed', { fan_speed: speed }),
    select: (s: VacSelect, option: string) => host.call('select', 'select_option', { entity_id: s.id, option }),
    sw: (s: VacSwitch, on: boolean) => host.call('switch', on ? 'turn_on' : 'turn_off', { entity_id: s.id }),
    time: (id: string, v: string) => host.call('time', 'set_value', { entity_id: id, time: `${v}:00` }),
    volume: (id: string, value: number) => host.call('number', 'set_value', { entity_id: id, value }),
    press: (id: string) => host.call('button', 'press', { entity_id: id }),
  };
}
type Act = ReturnType<typeof vacuumActions>;
/** set by «‹ Пылесос» in the settings, so the panel puts focus back on the gear it came from */
let backFromSettings = false;
type UI = ReturnType<typeof useAct>;
/** The robot itself, seen from above: the lidar turret is its face. It hums along with sparkles while cleaning, sleeps on the dock, frowns at trouble. */
export function Robot({ tone }: { tone: VacTone }) {
  const face = tone === 'dock' || tone === 'care' ? <path d="M50 49q4 3 8 0M66 49q4 3 8 0" fill="none" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" />
    : tone === 'warn' ? <g fill="#2b3a44"><ellipse cx="54" cy="49" rx="3.6" ry="4.4" /><ellipse cx="70" cy="49" rx="3.6" ry="4.4" /><path d="M48 43.5l9-3M76 43.5l-9-3" stroke="#2b3a44" stroke-width="2.6" stroke-linecap="round" /></g>
    : <g fill="#2b3a44"><ellipse cx="54" cy="48" rx="3.6" ry="4.4" /><ellipse cx="70" cy="48" rx="3.6" ry="4.4" /><circle cx="55.3" cy="46.6" r="1.2" fill="#fff" /><circle cx="71.3" cy="46.6" r="1.2" fill="#fff" /></g>;
  return <svg className={`at-vac-buddy is-${tone}`} viewBox="0 0 124 104" aria-hidden="true">
    {tone === 'clean' && <g className="at-vac-spark" fill="currentColor"><path d="M14 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path d="M106 18l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" /><circle cx="22" cy="78" r="2.4" /><circle cx="100" cy="86" r="2" /></g>}
    {tone === 'dock' && <g className="at-vac-zz" fill="currentColor" font-size="15" font-weight="700"><text x="96" y="24">z</text><text x="107" y="14" font-size="11">z</text></g>}
    <ellipse cx="62" cy="96" rx="36" ry="5" fill="#000" opacity=".12" />
    <circle cx="62" cy="56" r="40" className="at-vac-shell" />
    <circle cx="62" cy="56" r="33" className="at-vac-top" />
    <path d="M30 76a36 36 0 0 0 64 0" fill="none" className="at-vac-bumper" stroke-width="4" stroke-linecap="round" />
    <rect x="44" y="34" width="36" height="28" rx="14" className="at-vac-lidar" />
    {face}
    {tone !== 'dock' && <><ellipse cx="47" cy="58" rx="4.5" ry="2.6" fill="#ff6f5a" opacity=".35" /><ellipse cx="77" cy="58" rx="4.5" ry="2.6" fill="#ff6f5a" opacity=".35" /></>}
    {tone === 'warn' ? <path d="M57 58q5-4 10 0" fill="none" stroke="#2b3a44" stroke-width="2.6" stroke-linecap="round" /> : tone !== 'dock' && <path d="M57 56q5 4 10 0" fill="none" stroke="#2b3a44" stroke-width="2.6" stroke-linecap="round" />}
    {tone === 'clean' && <g className="at-vac-brush"><path d="M24 86l10-8M28 92l9-10M20 80l12-4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></g>}
    <circle cx="62" cy="80" r="3" className={`at-vac-led is-${tone}`} />
  </svg>;
}
/** The robot as the Roborock app draws it: on its dock while docked, alone while it is out; a small badge says the rest.
 * The renders live in the house's own Atom Home photos (not in this public repository); without them the drawn character stands in. */
export interface VacPics { robot: string | null; dock: string | null }
export function RobotPic({ v, tone, pics, size }: { v: Vacuum; tone: VacTone; pics: VacPics; size: 'tile' | 'hero' }) {
  const home = v.phase === 'docked' || (v.phase === 'idle' && v.charging) || (v.phase === 'error' && v.charging) || (v.phase === 'offline');
  const src = home ? pics.dock ?? pics.robot : pics.robot ?? pics.dock;
  if (!src) return <Robot tone={tone} />;
  const badge = tone === 'warn' || tone === 'care' ? <i className={`at-vac-badge is-${tone}`} aria-hidden="true">!</i> : v.phase === 'docked' && v.charging && (v.battery ?? 100) < 100 ? <i className="at-vac-badge is-charge" aria-hidden="true"><Icon name="bolt" size={12} /></i> : null;
  return <span className={`at-vac-pic is-${tone} is-${home ? 'home' : 'out'} is-${size}`}><img src={src} alt="" decoding="async" />{tone === 'clean' && !home && <i className="at-vac-trail" aria-hidden="true" />}{badge}</span>;
}
/** The one button that matters now: start, pause, or carry on; its fill is the progress while it cleans. */
function mainAction(v: Vacuum, t: T, chosen: number): { key: 'start' | 'pause' | 'resume'; label: string; icon: string } {
  if (v.phase === 'cleaning' || v.phase === 'returning') return { key: 'pause', label: tk(t, 'pause'), icon: 'pause' };
  if (v.phase === 'paused' || v.phase === 'error') return { key: 'resume', label: tk(t, 'resume'), icon: 'play' }; // after the owner frees it, Roborock waits for «resume»
  return { key: 'start', label: chosen ? tk(t, 'startRooms', { n: chosen }) : tk(t, 'startAll'), icon: 'play' };
}
/** No rooms chosen is the whole flat; more than one pass of it goes room by room through every linked room. */
const run = (v: Vacuum, act: Act, key: 'start' | 'pause' | 'resume', rooms: string[] = [], repeat = 1) => key === 'pause' ? act.pause() : key === 'resume' ? act.start() : rooms.length ? act.rooms(rooms, repeat) : repeat > 1 && v.rooms.length ? act.rooms(v.rooms.map(r => r.areaId), repeat) : act.start();
function Facts({ v, t, lang }: { v: Vacuum; t: T; lang: Lang }) {
  const active = v.phase === 'cleaning' || v.phase === 'paused' || v.phase === 'returning';
  return <ul className="at-vac-facts">
    {active && <li><Icon name="clock" size={14} />{dur(v.cleanMinutes, t)}</li>}
    {active && v.cleanArea !== null && <li><Icon name="grid" size={14} />{fmt(v.cleanArea, lang)} {tk(t, 'm2')}</li>}
    {!active && v.last.end && <li><Icon name="check" size={14} />{tk(t, 'lastAt', { at: lastWhen(v.last.end, t, lang) })}</li>}
    {v.battery !== null && <li className={v.battery < 20 ? 'is-low' : ''}><Icon name={v.charging ? 'bolt' : 'battery'} size={14} /><span className="at-vh">{v.charging ? tk(t, 'batteryCharging') : tk(t, 'battery')} </span>{fmt(v.battery, lang)} %</li>}
  </ul>;
}
function lastWhen(ms: number, t: T, lang: Lang) {
  const d = new Date(ms), today = new Date(), y = new Date(today.getTime() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  return same(d, today) ? tk(t, 'today', { at: hhmm(ms) }) : same(d, y) ? tk(t, 'yesterday', { at: hhmm(ms) }) : d.toLocaleDateString(LOC[lang], { day: 'numeric', month: 'short' });
}
export function VacuumTile({ v, host, t, lang, onOpen, pics }: { v: Vacuum; host: Host; t: T; lang: Lang; onOpen: () => void; pics: VacPics }) {
  const act = vacuumActions(v, host), ui = useAct(t), tone = vacTone(v), main = mainAction(v, t, 0), say = vacSentence(v, t, lang);
  const alerts = vacuumAlerts(v), first = alerts.find(a => a.key !== 'error');
  const progress = v.phase === 'cleaning' || v.phase === 'paused' ? v.progress ?? 0 : 0, can = v.available;
  return <div className={`ah-tile hm-card at-vac-tile vz-${tone}`}>
    <button type="button" className="at-vac-open" aria-label={`${tk(t, 'title')}: ${say}${first ? `. ${alertText(first, t, v)}` : ''}. ${tk(t, 'open')}`} onClick={onOpen} />
    <div className="at-vac-tile-head"><strong>{tk(t, 'title')}</strong><small>{say}</small>{first && <em className={`at-vac-alert is-${first.tone}`}>{alertText(first, t, v)}</em>}<Err text={ui.err('main', 'dock')} /></div>
    <span className="at-vac-tile-buddy"><RobotPic v={v} tone={tone} pics={pics} size="tile" /></span>
    <Facts v={v} t={t} lang={lang} />
    <div className="at-vac-tile-btns">
      <button type="button" className={`at-vac-go is-${main.key} ${progress > 0 ? 'has-pct' : ''}`} style={`--p:${progress}%`} aria-label={main.label} aria-busy={ui.busy === 'main' || undefined} aria-disabled={!can || ui.busy === 'main' || undefined} onClick={e => { e.stopPropagation(); if (can) ui.run('main', () => run(v, act, main.key)); }}>
        {progress > 0 && <b className="at-vac-go-pct">{fmt(progress, lang)}<i>%</i></b>}<Icon name={main.icon} size={26} /><span>{main.label}</span></button>
      <button type="button" className="at-vac-home" aria-label={v.phase === 'docked' ? tk(t, 'onDock') : tk(t, 'dock')} aria-busy={ui.busy === 'dock' || undefined} aria-disabled={!v.available || v.phase === 'docked' || ui.busy === 'dock' || undefined} onClick={e => { e.stopPropagation(); if (v.available && v.phase !== 'docked') ui.run('dock', act.dock); }}><Icon name="home" size={24} /><span>{v.phase === 'docked' ? tk(t, 'onDock') : tk(t, 'dock')}</span></button>
    </div>
  </div>;
}
function alertText(a: ReturnType<typeof vacuumAlerts>[number], t: T, v?: Vacuum) { return a.key === 'due' ? tk(t, 'a.due', { p: tk(t, `c.${a.consumable}`) }) : a.key === 'dockError' && v?.dockError ? tk(t, 'a.dockIs', { e: word(t, `dock.${v.dockError}`, v.dockError) }) : tk(t, `a.${a.key}`); }
/** HA draws the robot's map on a wide empty canvas: cut the empty margins away (once per map picture) so the flat fills its card.
 * Falls back to the picture as it is when the canvas cannot read it. */
function useTrimmedMap(url: string | null): string | null {
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    setOut(null); if (!url) return;
    let live = true; const img = new Image(); img.decoding = 'async';
    img.onload = () => { try {
      const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0 || (x1 - x0) > w * 0.92) return; // nothing to trim
      const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03); x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
      const t = document.createElement('canvas'); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1; t.getContext('2d')!.drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
      if (live) setOut(t.toDataURL('image/png'));
    } catch { /* a picture the canvas may not read stays as it is */ } };
    img.src = url; return () => { live = false; };
  }, [url]);
  return out ?? url;
}
/* ---------- the panel ---------- */
function Chips<V extends string>({ label, value, options, name, onPick, busy, disabled, hint }: { label: string; value: string | null; options: V[]; name: (o: V) => string; onPick: (o: V) => void; busy?: boolean; disabled?: boolean; hint?: string }) {
  return <div className="at-vac-row"><div className="at-vac-row-head"><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
    <div className="at-vac-seg" role="group" aria-label={label}>{options.map(o => <button type="button" aria-pressed={value === o} className={value === o ? 'is-on' : ''} disabled={disabled} aria-disabled={busy || undefined} onClick={() => { if (!disabled && !busy && value !== o) onPick(o); }}>{name(o)}</button>)}</div></div>;
}
const MODES = ['smart_mode', 'vac_and_mop', 'vacuum', 'mop', 'custom'];
const FANS = ['quiet', 'balanced', 'turbo', 'max', 'max_plus'];
const WATER = ['low', 'medium', 'high'];
const ROUTE = ['fast', 'standard', 'deep', 'deep_plus'];
function ModeCard({ v, act, t, ui }: { v: Vacuum; act: Act; t: T; ui: UI }) {
  const mode = v.cleaningMode?.value ?? null, smart = mode === 'smart_mode';
  const opts = (s: VacSelect | null, wanted: string[]) => s ? wanted.filter(o => s.options.includes(o)) : [];
  return <section className="at-vac-sec"><div className="hm-section-head"><h2 tabIndex={-1}>{tk(t, 'mode')}</h2><small className="at-vac-hint">{smart ? tk(t, 'smartHint') : tk(t, 'modeHint')}</small></div>
    <div className="at-vac-card">
      {v.cleaningMode && <div className="at-vac-modes" role="group" aria-label={tk(t, 'mode')}>{opts(v.cleaningMode, MODES).map(o => <button type="button" aria-pressed={mode === o} className={`at-vac-mode ${mode === o ? 'is-on' : ''}`} aria-disabled={ui.busy === 'mode' || undefined} onClick={() => { if (mode !== o && ui.busy !== 'mode') ui.run('mode', () => act.select(v.cleaningMode!, o)); }}><span className={`at-vac-mode-ic is-${o}`} aria-hidden="true">{MODE_ICON[o]}</span><small>{word(t, `mode.${o}`, o)}</small></button>)}</div>}
      <div className={`at-vac-opts ${smart ? 'is-smart' : ''}`}>
        {mode !== 'mop' && v.fans.length > 0 && <Chips label={tk(t, 'fan')} value={v.fan} options={FANS.filter(f => v.fans.includes(f))} name={o => word(t, `fan.${o}`, o)} busy={ui.busy === 'fan'} disabled={smart} onPick={o => ui.run('fan', () => act.fan(o))} />}
        {mode !== 'vacuum' && v.mopIntensity && <Chips label={tk(t, 'water')} value={v.mopIntensity.value} options={opts(v.mopIntensity, WATER)} name={o => word(t, `water.${o}`, o)} busy={ui.busy === 'water'} disabled={smart} onPick={o => ui.run('water', () => act.select(v.mopIntensity!, o))} />}
        {mode !== 'vacuum' && v.mopMode && <Chips label={tk(t, 'route')} value={v.mopMode.value} options={opts(v.mopMode, ROUTE)} name={o => word(t, `route.${o}`, o)} busy={ui.busy === 'route'} disabled={smart} onPick={o => ui.run('route', () => act.select(v.mopMode!, o))} />}
      </div>
      <Err text={ui.err('mode', 'fan', 'water', 'route')} />
    </div></section>;
}
const G = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d={d} /></svg>;
const MODE_ICON: Record<string, preact.JSX.Element> = {
  smart_mode: G('M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z'),
  vac_and_mop: G('M4 13a6 6 0 0 1 12 0M7 17h6M17 4c-1.5 2.5-3 4-3 6a3 3 0 0 0 6 0c0-2-1.5-3.5-3-6z'),
  vacuum: G('M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0M8 8h8M9 16h6'),
  mop: G('M12 3c-3 4.5-6 7.5-6 11a6 6 0 0 0 12 0c0-3.5-3-6.5-6-11z'),
  custom: G('M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4'),
};
function Rooms({ v, chosen, setChosen, repeat, setRepeat, t }: { v: Vacuum; chosen: string[]; setChosen: (x: string[]) => void; repeat: number; setRepeat: (n: number) => void; t: T }) {
  const all = chosen.length === 0, busy = v.phase === 'cleaning' || v.phase === 'paused' || v.phase === 'returning';
  const toggle = (id: string) => { if (!busy) setChosen(chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]); };
  if (!v.rooms.length) return <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'rooms')}</h2></div><p className="at-vac-note">{tk(t, 'noLink')}</p></section>;
  return <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'rooms')}</h2><small className="at-vac-hint">{busy ? tk(t, 'roomsBusy') : all ? tk(t, 'roomsAll') : tk(t, 'roomsN', { n: chosen.length })}</small></div>
    <div className="at-vac-card">
      <div className="at-vac-rooms">
        <button type="button" role="checkbox" aria-checked={all} aria-disabled={busy || undefined} className={`at-vac-room is-all ${all ? 'is-on' : ''}`} onClick={() => { if (!busy) setChosen([]); }}><Icon name="home" size={18} /><span>{tk(t, 'wholeFlat')}</span></button>
        {v.rooms.map((r, i) => { const on = chosen.includes(r.areaId), here = v.currentRoom === r.name && v.phase === 'cleaning';
          return <button type="button" role="checkbox" aria-checked={on} aria-disabled={busy || undefined} className={`at-vac-room ${on ? 'is-on' : ''} ${here ? 'is-here' : ''}`} onClick={() => toggle(r.areaId)} title={r.robotName && r.robotName.toLowerCase() !== r.name.toLowerCase() ? tk(t, 'robotCalls', { n: r.robotName }) : undefined}>
            <i className="at-vac-room-n" aria-hidden="true">{on ? chosen.indexOf(r.areaId) + 1 : i + 1}</i><span>{r.name.replace(/ (у|в|к|с|и|на) /g, ' $1\u00a0')}</span>{here && <em>{tk(t, 'hereNow')}</em>}</button>; })}
      </div>
      <div className="at-vac-repeat"><small>{tk(t, 'passes')}</small><div className="at-vac-seg is-small" role="group" aria-label={tk(t, 'passes')}>{[1, 2, 3].map(n => <button type="button" aria-pressed={repeat === n} className={repeat === n ? 'is-on' : ''} onClick={() => setRepeat(n)}>×{n}</button>)}</div>{!all && <small className="at-vac-order">{tk(t, 'orderHint')}</small>}</div>
      {v.unlinked.length > 0 && <p className="at-vac-note is-warn">{tk(t, 'unlinked', { r: v.unlinked.join(', ') })}</p>}
    </div></section>;
}
function Ring({ p, children }: { p: number; children: preact.ComponentChildren }) {
  const C = 2 * Math.PI * 44;
  return <span className="at-vac-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" className="at-vac-ring-bg" /><circle cx="50" cy="50" r="44" className="at-vac-ring-fg" stroke-dasharray={`${C * p / 100} ${C}`} transform="rotate(-90 50 50)" /></svg>{children}</span>;
}
function Dock({ v, act, t, lang, ui }: { v: Vacuum; act: Act; t: T; lang: Lang; ui: UI }) {
  if (!v.dock.present) return null;
  const tank = (label: string, bad: boolean | null, badWord: string, icon: string) => <li className={bad ? 'is-bad' : ''}><Icon name={icon} size={16} /><span><small>{label}</small><b>{bad === null ? '—' : bad ? badWord : tk(t, 'ok')}</b></span></li>;
  const atDock = v.available && (v.phase === 'docked' || (v.phase === 'idle' && v.charging)); // the dock's own jobs need the robot on it
  const btn = (key: string, s: VacSwitch | null, label: string, icon: string) => s && <button type="button" className={`at-vac-dockbtn ${s.on ? 'is-on' : ''}`} aria-pressed={!!s.on} aria-busy={ui.busy === key || undefined} aria-disabled={!atDock || ui.busy === key || undefined} onClick={() => { if (atDock) ui.run(key, () => act.sw(s, !s.on)); }}><Icon name={icon} size={18} /><span>{label}</span>{s.on && <em>{tk(t, 'running')}</em>}</button>;
  return <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'dockTitle')}</h2>{v.dockError && <small className="at-vac-hint is-warn">{word(t, `dock.${v.dockError}`, v.dockError)}</small>}</div>
    <div className="at-vac-card">
      <ul className="at-vac-tanks">
        {tank(tk(t, 'cleanTank'), v.dock.cleanEmpty, tk(t, 'empty'), 'water')}
        {tank(tk(t, 'dirtyTank'), v.dock.dirtyFull, tk(t, 'full'), 'water')}
        {tank(tk(t, 'fluid'), v.dock.fluidEmpty, tk(t, 'over'), 'water')}
        <li><Icon name="sun" size={16} /><span><small>{tk(t, 'dryingMop')}</small><b>{v.dock.dryingLeft ? tk(t, 'dryLeft', { v: dur(v.dock.dryingLeft * 60, t) }) : tk(t, 'notDrying')}</b></span></li>
      </ul>
      <div className="at-vac-dockbtns">
        {btn('dust', v.dock.dustEmptying, tk(t, 'empty.do'), 'air')}
        {btn('wash', v.dock.mopWashing, tk(t, 'wash.do'), 'water')}
        {btn('dry', v.dock.mopDrying, tk(t, 'dry.do'), 'sun')}
      </div>
      {!atDock && <p className="at-vac-note">{tk(t, 'notOnDock')}</p>}
      <Err text={ui.err('dust', 'wash', 'dry')} />
    </div></section>;
}
export function VacuumPanel({ v, host, t, lang, onSettings, pics }: { v: Vacuum; host: Host; t: T; lang: Lang; onSettings: () => void; pics: VacPics }) {
    const act = vacuumActions(v, host), ui = useAct(t), tone = vacTone(v), [chosen, setChosen] = useState<string[]>([]), [repeat, setRepeat] = useState(1);
  const main = mainAction(v, t, chosen.length), say = vacSentence(v, t, lang), alerts = vacuumAlerts(v), can = v.available;
  const active = v.phase === 'cleaning' || v.phase === 'paused' || v.phase === 'returning', gear = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (backFromSettings) { backFromSettings = false; gear.current?.focus(); } }, []);
  const mapUrl = useTrimmedMap(v.mapImage ? host.previewFrame?.(v.mapImage.entity) ?? v.mapImage.url : null);
  return <div className="at-vac-panel">
    <section className={`at-vac-hero vz-${tone}`} aria-label={tk(t, 'title')}>
      <div className="at-vac-hero-top">
        <span className="at-vac-hero-buddy"><RobotPic v={v} tone={tone} pics={pics} size="hero" /></span>
        <div className="at-vac-hero-text"><small>{(v.model ?? v.name).replace(/^Roborock\s+/i, '')}</small><h2>{tk(t, 'title')}</h2><p className="at-vac-hero-say">{say}</p></div>
        <div className="at-vac-corner">
          <button type="button" className="at-vac-icon" aria-label={tk(t, 'locate')} aria-busy={ui.busy === 'locate' || undefined} aria-disabled={!v.available || undefined} onClick={() => { if (v.available) ui.run('locate', act.locate); }}><Icon name="bell" size={20} /></button>
          <button type="button" ref={gear} className="at-vac-icon" aria-label={tk(t, 'settings')} onClick={onSettings}><Icon name="gear" size={20} /></button>
        </div>
      </div>
      {alerts.length > 0 && <ul className="at-vac-alerts">{alerts.map(a => <li className={`is-${a.tone}`}><Icon name="warning" size={15} />{alertText(a, t, v)}</li>)}</ul>}
      <div className="at-vac-map">
        {mapUrl ? <img src={mapUrl} alt={tk(t, 'mapAlt', { m: v.map?.value ?? '' })} loading="lazy" decoding="async" /> : <p className="at-vac-note">{tk(t, 'noMap')}</p>}
        {v.currentRoom && active && <span className="at-vac-here"><i aria-hidden="true" />{v.currentRoom}</span>}
        {v.map?.value && <span className="at-vac-mapname">{v.map.value}</span>}
      </div>
      <div className="at-vac-bar">
        <div className="at-vac-bar-info"><b>{active ? (v.currentRoom ?? word(t, `st.${v.status}`, v.status ?? '')) : say}</b><Facts v={v} t={t} lang={lang} /></div>
        <div className="at-vac-bar-btns">
          {active ? <button type="button" className="at-vac-side" aria-busy={ui.busy === 'stop' || undefined} onClick={() => ui.run('stop', act.stop)}><span className="at-vac-side-ic"><Icon name="power" size={20} /></span><small>{tk(t, 'stop')}</small></button>
            : <button type="button" className="at-vac-side" aria-label={`${tk(t, 'mode')}: ${word(t, `mode.${v.cleaningMode?.value}`, tk(t, 'mode'))}`} onClick={() => { const h = document.getElementById('at-vac-mode')?.querySelector('h2') as HTMLElement | null; h?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); h?.focus({ preventScroll: true }); }}><span className="at-vac-side-ic"><Icon name="settings" size={20} /></span><small>{word(t, `mode.${v.cleaningMode?.value}`, tk(t, 'mode'))}</small></button>}
          <button type="button" className={`at-vac-big is-${main.key}`} aria-label={main.label} aria-busy={ui.busy === 'main' || undefined} aria-disabled={!can || ui.busy === 'main' || undefined} onClick={() => { if (can) ui.run('main', () => run(v, act, main.key, chosen, repeat)); }}>
            <Ring p={active ? v.progress ?? 0 : 0}><Icon name={main.icon} size={30} /></Ring><small>{main.label}</small></button>
          <button type="button" className="at-vac-side" aria-busy={ui.busy === 'dock' || undefined} aria-disabled={!v.available || v.phase === 'docked' || undefined} onClick={() => { if (v.available && v.phase !== 'docked') ui.run('dock', act.dock); }}><span className="at-vac-side-ic is-home"><Icon name="home" size={20} /></span><small>{v.phase === 'docked' ? tk(t, 'onDock') : tk(t, 'dock')}</small></button>
        </div>
        <Err text={ui.err('main', 'dock', 'stop', 'locate')} />
      </div>
    </section>
    <Rooms v={v} chosen={chosen} setChosen={setChosen} repeat={repeat} setRepeat={setRepeat} t={t} />
    <div id="at-vac-mode"><ModeCard v={v} act={act} t={t} ui={ui} /></div>
    <Dock v={v} act={act} t={t} lang={lang} ui={ui} />
  </div>;
}
/* ---------- the settings, behind the gear ---------- */
function Toggle({ s, label, hint, act, ui, k }: { s: VacSwitch; label: string; hint?: string; act: Act; ui: UI; k: string }) {
  return <div className="at-vac-set-row"><div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
    <button type="button" role="switch" aria-checked={!!s.on} aria-label={label} className={`at-vac-switch ${s.on ? 'is-on' : ''}`} aria-busy={ui.busy === k || undefined} aria-disabled={s.on === null || ui.busy === k || undefined} onClick={() => { if (s.on !== null) ui.run(k, () => act.sw(s, !s.on)); }}><i /></button></div>;
}
function TimeField({ x, label, act, ui, k, disabled, of }: { x: { id: string; v: string }; label: string; act: Act; ui: UI; k: string; disabled?: boolean; of: string }) {
  // the browser fires change on every hour or minute part: keep a draft and send once, when the field is left
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [x.v]);
  const send = () => { if (draft && /^\d\d:\d\d$/.test(draft) && draft !== x.v) ui.run(`${k}:${x.id}`, () => act.time(x.id, draft)); };
  return <label><small>{label}</small><input type="time" aria-label={`${of}: ${label}`} value={draft ?? x.v} disabled={disabled} onInput={e => setDraft((e.target as HTMLInputElement).value)} onBlur={send} onKeyDown={e => { if (e.key === 'Enter') send(); }} /></label>;
}
function Times({ from, to, act, ui, k, t, disabled, of }: { from: { id: string; v: string } | null; to: { id: string; v: string } | null; act: Act; ui: UI; k: string; t: T; disabled?: boolean; of: string }) {
  if (!from || !to) return null;
  return <div className={`at-vac-times ${disabled ? 'is-off' : ''}`}><TimeField x={from} of={of} label={tk(t, 'from')} act={act} ui={ui} k={k} disabled={disabled} /><span aria-hidden="true">—</span><TimeField x={to} of={of} label={tk(t, 'to')} act={act} ui={ui} k={k} disabled={disabled} /></div>;
}
function Part({ c, v, act, t, lang, ui }: { c: Consumable; v: Vacuum; act: Act; t: T; lang: Lang; ui: UI }) {
  const [ask, setAsk] = useState(false), cancel = useRef<HTMLButtonElement>(null), resetBtn = useRef<HTMLButtonElement>(null), opened = useRef(false), p = percentLeft(c), low = p !== null ? p <= 10 : c.left !== null && c.left <= 5;
  // focus goes to the safe choice when the question opens, and back to «Сброс» when it closes (WCAG 2.4.3)
  useEffect(() => { if (ask) { opened.current = true; cancel.current?.focus(); } else if (opened.current) { opened.current = false; resetBtn.current?.focus(); } }, [ask]);
  return <article className={`at-vac-part ${low ? 'is-low' : ''}`}>
    <span className="at-vac-part-art" aria-hidden="true">{PART_ART[c.key]}</span>
    <div className="at-vac-part-body"><strong>{tk(t, `c.${c.key}`)}</strong>
      <div className="at-vac-part-nums"><span><b>{c.left === null ? '—' : fmt(c.left, lang)}<i>{tk(t, 'h')}</i></b><small>{tk(t, 'leftH')}</small></span>{p !== null && <span><b>{p}<i>%</i></b><small>{tk(t, 'leftP')}</small></span>}</div>
      {p !== null && <div className="at-vac-part-bar" aria-hidden="true"><i style={`width:${p}%`} /></div>}
      {!c.total && <small className="at-vac-part-note">{tk(t, 'asNeeded')}</small>}
    </div>
    {c.reset && v.available && (ask ? <div className="at-vac-part-ask" role="group" aria-label={tk(t, 'resetAsk', { p: tk(t, `c.${c.key}`) })} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAsk(false); } }}><small>{tk(t, 'resetAsk', { p: tk(t, `c.${c.key}`) })}</small><button type="button" className="at-vac-pill is-danger" onClick={() => { setAsk(false); ui.run(`reset:${c.key}`, () => act.press(c.reset!)); }}>{tk(t, 'resetYes')}</button><button type="button" ref={cancel} className="at-vac-pill" onClick={() => setAsk(false)}>{tk(t, 'cancel')}</button></div>
      : <button type="button" ref={resetBtn} className="at-vac-pill" aria-label={`${tk(t, 'reset')}: ${tk(t, `c.${c.key}`)}`} aria-busy={ui.busy === `reset:${c.key}` || undefined} onClick={() => setAsk(true)}>{tk(t, 'reset')}</button>)}
    <Err text={ui.err(`reset:${c.key}`)} />
  </article>;
}
const P = (d: string) => <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d={d} /></svg>;
const PART_ART: Record<Consumable['key'], preact.JSX.Element> = {
  filter: P('M8 16l26-6 6 6-26 6zM14 22v10l26-6V16M14 22l-6-6M18 21v10M22 20v10M26 19v10M30 18v10M34 17v10'),
  main: P('M6 30l30-14M10 34l30-14M6 30c-2 1-1 5 4 4M36 16c4-1 6 2 4 4M12 27l3 5M18 24l3 5M24 21l3 5M30 18l3 5'),
  side: P('M30 12a8 8 0 1 1-8 8M22 20c-4 4-8 10-14 16M24 23c-2 5-4 11-8 16M27 25c0 5 1 10 0 15'),
  sensor: P('M24 8a16 16 0 1 0 0 32 16 16 0 0 0 0-32zM24 18a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8 24h4M36 24h4M24 8v4'),
  strainer: P('M10 14h28l-4 22H14zM14 20h20M15 26h18M16 32h16M20 14v22M28 14v22'),
};
export function VacuumSettings({ v, host, t, lang, onBack }: { v: Vacuum; host: Host; t: T; lang: Lang; onBack: () => void }) {
  const act = vacuumActions(v, host), ui = useAct(t), [vol, setVol] = useState<number | null>(null), backBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { const m = backBtn.current?.closest('.hm-main') as HTMLElement | null; if (m) m.scrollTop = 0; backBtn.current?.focus({ preventScroll: true }); }, []); // the settings open at their top, focus on «‹ Пылесос»
  useEffect(() => { setVol(null); }, [v.volume?.value]);
  const lastMin = v.last.begin && v.last.end && v.last.end > v.last.begin ? (v.last.end - v.last.begin) / 60000 : null;
  return <div className="at-vac-panel is-settings">
    <div className="at-vac-set-head"><button type="button" ref={backBtn} className="hm-back" onClick={() => { backFromSettings = true; onBack(); }}><Icon name="back" size={20} />{tk(t, 'title')}</button><h2>{tk(t, 'settings')}</h2><small>{v.name}{v.model ? ` · ${v.model}` : ''}</small></div>
    <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'history')}</h2></div>
      <div className="at-vac-hist">
        <div className="at-vac-stat"><b>{lastMin === null ? '—' : dur(lastMin, t)}</b><small>{tk(t, 'lastDur')}</small></div>
        <div className="at-vac-stat"><b>{v.cleanArea === null ? '—' : fmt(v.cleanArea, lang)}<i>{tk(t, 'm2')}</i></b><small>{v.phase === 'cleaning' || v.phase === 'paused' ? tk(t, 'nowArea') : tk(t, 'lastArea')}</small></div>
        <div className="at-vac-total"><small>{v.last.end ? tk(t, 'lastFull', { at: lastWhen(v.last.end, t, lang) }) : tk(t, 'totals')}</small><span>{v.total.hours !== null && <b>{fmt(v.total.hours, lang)} {tk(t, 'h')}</b>}{v.total.area !== null && <b>{fmt(v.total.area, lang)} {tk(t, 'm2')}</b>}{v.total.count !== null && <b>{tk(t, 'times', { n: v.total.count })}</b>}</span></div>
      </div></section>
    <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'care')}</h2><small className="at-vac-hint">{tk(t, 'careHint')}</small></div>
      <div className="at-vac-parts">{v.consumables.map(c => <Part c={c} v={v} act={act} t={t} lang={lang} ui={ui} />)}</div></section>
    {v.dock.present && <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'dockTitle')}</h2></div>
      <div className="at-vac-card at-vac-set">
        {v.emptyMode && <Chips label={tk(t, 'emptyMode')} value={v.emptyMode.value} options={v.emptyMode.options.filter(o => o !== 'unknown')} name={o => word(t, `emptyM.${o}`, o)} busy={ui.busy === 'emptyMode'} onPick={o => ui.run('emptyMode', () => act.select(v.emptyMode!, o))} />}
        {v.dock.childLock && <Toggle s={v.dock.childLock} label={tk(t, 'childLock')} hint={tk(t, 'childLockHint')} act={act} ui={ui} k="lock" />}
        <Err text={ui.err('emptyMode', 'lock')} />
      </div></section>}
    <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'robotSet')}</h2></div>
      <div className="at-vac-card at-vac-set">
        {v.dnd.sw && <><Toggle s={v.dnd.sw} label={tk(t, 'dnd')} hint={tk(t, 'dndHint')} act={act} ui={ui} k="dnd" /><Times of={tk(t, 'dnd')} from={v.dnd.from} to={v.dnd.to} act={act} ui={ui} k="dndT" t={t} disabled={!v.dnd.sw.on} /></>}
        {v.offPeak.sw && <><Toggle s={v.offPeak.sw} label={tk(t, 'offPeak')} hint={tk(t, 'offPeakHint')} act={act} ui={ui} k="peak" /><Times of={tk(t, 'offPeak')} from={v.offPeak.from} to={v.offPeak.to} act={act} ui={ui} k="peakT" t={t} disabled={!v.offPeak.sw.on} /></>}
        {v.volume && <div className="at-vac-set-row is-col"><div><strong>{tk(t, 'volume')}</strong><small>{v.volume.value === null ? '—' : `${fmt(vol ?? v.volume.value, lang)} %`}</small></div>
          <input type="range" min="0" max="100" step="5" className="at-vac-range" aria-label={tk(t, 'volume')} value={vol ?? v.volume.value ?? 0} style={`--p:${vol ?? v.volume.value ?? 0}%`} onInput={e => setVol(Number((e.target as HTMLInputElement).value))} onChange={e => { const n = Number((e.target as HTMLInputElement).value); ui.run('vol', () => act.volume(v.volume!.id, n)); }} /></div>}
        <Err text={ui.err('dnd', 'peak', 'vol') ?? ui.err('dndT', 'peakT')} />
      </div></section>
    <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'mapRooms')}</h2><small className="at-vac-hint">{v.map?.value ? tk(t, 'mapIs', { m: v.map.value }) : ''}</small></div>
      <div className="at-vac-card">
        {v.rooms.length ? <ul className="at-vac-links">{v.rooms.map(r => <li><span>{r.robotName ? r.robotName.charAt(0).toUpperCase() + r.robotName.slice(1) : '—'}</span><Icon name="next" size={14} /><span className="at-vh">→</span><b>{r.name}</b></li>)}</ul> : <p className="at-vac-note">{tk(t, 'noLink')}</p>}
        {v.unlinked.length > 0 && <p className="at-vac-note is-warn">{tk(t, 'unlinked', { r: v.unlinked.join(', ') })}</p>}
        <p className="at-vac-note">{tk(t, 'linkHow')}</p>
      </div></section>
    {v.routines.length > 0 && <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'routines')}</h2><small className="at-vac-hint">{tk(t, 'routinesHint')}</small></div>
      <div className="at-vac-card at-vac-routines">{v.routines.map(r => <button type="button" className="at-vac-routine" aria-busy={ui.busy === r.id || undefined} aria-disabled={!v.available || undefined} onClick={() => { if (v.available) ui.run(r.id, () => act.press(r.id)); }}><Icon name="play" size={16} /><span>{r.name}</span></button>)}<Err text={ui.err(...v.routines.map(r => r.id))} /></div></section>}
    <section className="at-vac-sec"><div className="hm-section-head"><h2>{tk(t, 'appOnly')}</h2></div>
      <div className="at-vac-card"><p className="at-vac-note">{tk(t, 'appOnlyList')}</p></div></section>
  </div>;
}
