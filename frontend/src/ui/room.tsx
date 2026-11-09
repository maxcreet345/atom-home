/* The room page (owner's choice of 09.11.2026, variant «Пульт»; docs/ROOM.md): a hero with what the room reads and one sentence about it,
 * one-tap actions, a card per real device in that device's own words, the room's radiator and who draws the power. */
import { Icon } from './primitives.tsx';
import type { Registry } from '../model/registry.ts';
import type { HomeDevice } from '../model/discover.ts';
import type { Heating } from '../model/heating.ts';
import type { Vacuum } from '../model/vacuum.ts';
import type { Alarm } from '../model/config.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import { rk, fmt, watts, detail, GUARDED } from './room-words.ts';
import type { Lang } from './format.ts';
import { readRoom, worst, type RoomModel, type Thing, type ThingKind, type Num, type Binary } from '../model/room.ts';
import { heatRoomWord, heatingActions, useStepper, Stepper, heatSetText } from './heating.tsx';
import { vacuumActions } from './vacuum.tsx';

export interface RoomProps { reg: Registry; roomId: string; roomName: string; heating: Heating | null; vacuum: Vacuum | null; host: Host; t: T; lang: Lang; now: number; alarms: Alarm[] | null;
  deviceOf: (entity: string) => HomeDevice | undefined; toggle: (d: HomeDevice) => void; open: (d: HomeDevice) => void; busy: (d: HomeDevice) => boolean; onHeating: () => void; onAlarms: () => void }
type P = RoomProps;

const GLYPH: Record<ThingKind, string> = { light: 'light', kettle: 'cup', feeder: 'paw', fountain: 'water', fridge: 'socket', tv: 'media', speaker: 'speaker', player: 'media', vacuum: 'vacuum', washer: 'washer', dryer: 'washer', camera: 'camera', purifier: 'air', humidifier: 'water', vent: 'fan', airfryer: 'pot', boiler: 'flame', valve: 'valve', socket: 'socket', other: 'generic' };
const TINT: Record<ThingKind, string> = { light: '#ffb800', kettle: '#ff8a3d', feeder: '#c08a4a', fountain: '#32ade6', fridge: '#5ac8c8', tv: '#bf5af2', speaker: '#8e7cf0', player: '#bf5af2', vacuum: '#5e5ce6', washer: '#32ade6', dryer: '#64a8e6', camera: '#8e8e93', purifier: '#30b0c7', humidifier: '#32ade6', vent: '#64d2ff', airfryer: '#ff9f0a', boiler: '#ff6b35', valve: '#32ade6', socket: '#30d158', other: '#8e8e93' };
const ago = (since: number | null, now: number, t: T) => { if (!since) return ''; const m = Math.max(0, Math.round((now - since) / 60000)); return m < 1 ? rk(t, 'ago.now') : m < 60 ? rk(t, 'ago.min', { n: m }) : m < 1440 ? rk(t, 'ago.h', { n: Math.floor(m / 60) }) : rk(t, 'ago.d', { n: Math.floor(m / 1440) }); };
/** «Кухня» → «кухню»: the robot's button says where it goes; other languages take the name as it is */
const where = (n: string, lang: Lang) => lang !== 'ru' ? n : n.toLowerCase().replace(/ая$/, 'ую').replace(/яя$/, 'юю').replace(/я$/, 'ю').replace(/а$/, 'у');

/* ---------- what the room reads ---------- */
interface Cell { key: string; icon: string; label: string; value: string; unit?: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'on' }
function cells(m: RoomModel, t: T, lang: Lang, now: number): Cell[] {
  const r = m.readings, out: Cell[] = [];
  const numCell = (key: string, icon: string, n: Num | null, unit: string, digits = 0) => { if (!n) return; out.push({ key, icon, label: rk(t, `m.${key}`), value: n.value === null ? '—' : fmt(n.value, lang, digits), unit: n.value === null ? '' : unit, tone: n.value === null ? 'muted' : n.tone }); };
  numCell('humidity', 'water', r.humidity, '%'); numCell('co2', 'air', r.co2, 'ppm'); numCell('pm25', 'air', r.pm25, rk(t, 'u.ug'));
  const b = (key: string, icon: string, x: Binary | null, word: (x: Binary) => [string, Cell['tone'], string?]) => { if (!x) return; const [v, tone, label] = x.unknown ? ['—', 'muted' as const] : word(x); out.push({ key, icon, label: label ?? rk(t, `m.${key}`), value: v, tone }); };
  b('motion', 'motion', r.motion, x => x.on.length ? [rk(t, 'v.motionYes'), 'on'] : [rk(t, 'v.motionNo', { ago: ago(x.since, now, t) }), 'ok']);
  b('windows', 'blinds', r.windows, x => x.on.length ? [x.ids.length > 1 ? rk(t, 'v.winOf', { n: x.on.length, all: x.ids.length }) : rk(t, 'v.winOpen'), 'warn', x.ids.length > 1 ? rk(t, 'm.windowsOpen') : undefined] : [rk(t, 'v.winClosed'), 'ok']);
  b('door', 'door', r.door, x => x.on.length ? [rk(t, 'v.doorOpen'), 'warn'] : [rk(t, 'v.doorClosed'), 'ok']);
  b('leak', 'water', r.leak, x => x.on.length ? [rk(t, 'v.wet'), 'bad'] : [rk(t, 'v.dry'), 'ok']);
  b('gas', 'flame', r.gas, x => x.on.length ? [rk(t, 'v.gasAlarm'), 'bad'] : [rk(t, 'v.gasOk'), 'ok']);
  if (r.lux) out.push({ key: 'lux', icon: 'sun', label: rk(t, 'm.lux'), value: r.lux.value === null ? '—' : fmt(r.lux.value, lang), unit: rk(t, 'u.lx'), tone: 'ok' });
  return out;
}
function verdict(m: RoomModel, t: T): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  const r = m.readings;
  if (r.leak?.on.length) return { text: rk(t, 'say.leak'), tone: 'bad' };
  if (r.gas?.on.length) return { text: rk(t, 'say.gas'), tone: 'bad' };
  const w = worst(r); if (w) return { text: w.metric === 'humidity' && w.value < 40 ? rk(t, 'say.dry') : rk(t, `say.${w.metric}.${w.tone}`), tone: w.tone as 'warn' | 'bad' };
  if (r.windows?.on.length) return { text: rk(t, 'say.window'), tone: 'warn' };
  return { text: rk(t, 'say.ok'), tone: 'ok' };
}
function Hero({ m, p }: { m: RoomModel; p: P }) {
  const r = m.readings, v = verdict(m, p.t), list = cells(m, p.t, p.lang, p.now), heat = m.heat;
  return <section className={`rm-hero is-${v.tone}`} aria-label={rk(p.t, 'strip')}>
    <div className="rm-hero-main">{r.temperature && <b>{r.temperature.value !== null ? fmt(r.temperature.value, p.lang, 1) : '—'}<i>°</i></b>}<span><strong>{v.text}</strong><small>{heat ? rk(p.t, 'heatLine', { w: heatRoomWord(heat, p.t, p.now).toLowerCase() }) + (heat.target !== null && heat.action !== 'window' && heat.action !== 'off' ? rk(p.t, 'heatTo', { v: heatSetText(heat.target, p.lang) }) : '') : ''}</small></span></div>
    {list.length > 0 && <ul className="rm-hero-cells">{list.map(c => <li className={`is-${c.tone}`}><Icon name={c.icon} size={15} /><b>{c.value}{c.unit ? ` ${c.unit}` : ''}</b><small>{c.label}</small></li>)}</ul>}
  </section>;
}

const openThing = (th: Thing, p: P) => { const d = (th.main ? p.deviceOf(th.main) : undefined) ?? th.ids.map(p.deviceOf).find(Boolean); if (d) p.open(d); };
function Tile({ th, p }: { th: Thing; p: P }) {
  const x = detail(th, p);
  return <article className={`rm-tile is-${x.tone} ${x.active ? 'is-on' : ''}`} style={`--rm-tint:${TINT[th.kind]}`}>
    <button type="button" className="rm-tile-open" aria-label={`${th.name}: ${x.status}. ${rk(p.t, 'more')}`} onClick={() => openThing(th, p)} />
    <div className="rm-tile-head"><span className="rm-tile-ic"><Icon name={GLYPH[th.kind]} size={22} /></span><span className="rm-tile-name"><strong>{th.name}</strong><small>{x.status}</small></span></div>
    {x.facts.length > 0 && <ul className="rm-facts">{x.facts.slice(0, 3).map(f => <li className={f.tone === 'warn' ? 'is-warn' : ''}>{f.tone === 'warn' && <Icon name="warning" size={12} />}{f.text}</li>)}</ul>}
    {x.action && <button type="button" className="rm-tile-act" disabled={!th.available} onClick={x.action.run}>{x.action.label}</button>}
  </article>;
}

/* ---------- one-tap actions, the radiator, the power ---------- */
function Quick({ m, p }: { m: RoomModel; p: P }) {
  const picks = [...m.things.filter(t => t.kind === 'light'), ...m.air, ...m.things.filter(t => ['kettle', 'tv', 'fountain'].includes(t.kind))].filter(t => t.main && t.available && !GUARDED.test(t.name) && p.deviceOf(t.main)).slice(0, 4);
  const clean = p.vacuum && m.vacuum?.linked ? p.vacuum : null;
  if (!picks.length && !clean) return null;
  return <div className="rm-quick">{picks.map(th => { const d = p.deviceOf(th.main!)!, x = detail(th, p), on = ['tv', 'player', 'speaker'].includes(th.kind) ? x.active : !!th.on; return <button type="button" className={`rm-q ${on ? 'is-on' : ''}`} style={`--rm-tint:${TINT[th.kind]}`} aria-pressed={on} disabled={!th.available || p.busy(d)} onClick={() => p.toggle(d)}><Icon name={GLYPH[th.kind]} size={22} /><strong>{['purifier', 'humidifier', 'vent'].includes(th.kind) ? th.name.split(' ')[0] : th.name}</strong><small>{on ? rk(p.t, 'on') : th.available ? rk(p.t, 'off') : rk(p.t, 'offline')}</small></button>; })}
    {clean && <button type="button" className="rm-q is-vac" style="--rm-tint:#5e5ce6" onClick={() => void vacuumActions(clean, p.host).rooms([m.id], 1)} disabled={!clean.available || clean.phase === 'cleaning'} aria-label={rk(p.t, 'cleanRoom', { r: where(p.roomName, p.lang) })}><Icon name="vacuum" size={22} /><strong>{rk(p.t, 'clean')}</strong><small>{clean.phase === 'cleaning' ? rk(p.t, 'cleaning') : where(p.roomName, p.lang)}</small></button>}
  </div>;
}
function HeatLine({ m, p }: { m: RoomModel; p: P }) {
  const r = m.heat, h = p.heating, act = h ? heatingActions(h, p.host) : null;
  const st = useStepper(r?.target ?? null, v => act && r ? act.room(r, v) : Promise.resolve(), () => {}, () => {}, 5, 30);
  if (!r || !h) return null;
  const word = heatRoomWord(r, p.t, p.now);
  return <section className={`rm-card rm-heatline is-${r.action}`}><span className="rm-glyph" style="--rm-tint:#ff7a1a"><Icon name="heating" size={20} /></span>
    <button type="button" className="rm-row-tx" onClick={p.onHeating}><strong>{rk(p.t, 'radiator')}</strong><small>{heatSetText(r.current, p.lang)}° · {word.toLowerCase()}</small></button>
    {r.action === 'window' || r.action === 'off' || r.action === 'offline' || !h.system ? <span className="rm-muted">{rk(p.t, 'offShort')}</span> : <Stepper value={st.shown} text={heatSetText(st.shown, p.lang)} onStep={st.step} t={p.t} size="small" label={`${p.roomName}: ${rk(p.t, 'set')}`} atMin={st.atMin} atMax={st.atMax} pending={st.pending} />}</section>;
}
function Power({ m, p }: { m: RoomModel; p: P }) {
  if (!m.consumers.length) return null;
  const top = m.consumers.slice(0, 5), today = m.consumers.reduce((s, c) => s + (c.today ?? 0), 0), sum = top.reduce((s, c) => s + c.power, 0) || 1, cols = ['#30d158', '#0a84ff', '#ff9f0a', '#bf5af2', '#8e8e93'];
  return <section className="rm-card rm-power is-bar"><h3>{rk(p.t, 'power')}</h3>
    <div className="rm-pw-head"><span><b>{watts(m.total ?? 0, p.t, p.lang)}</b> {rk(p.t, 'now')}</span>{today > 0 && <small>{rk(p.t, 'today', { v: fmt(today, p.lang, today < 10 ? 2 : 1) })}</small>}</div>
    <div className="rm-pw-stack" aria-hidden="true">{top.map((c, i) => <i style={`flex:${Math.max(c.power, sum * 0.02)};background:${cols[i]}`} />)}</div>
    <ul className="rm-pw-legend">{top.map((c, i) => <li><i style={`background:${cols[i]}`} />{c.name}<b>{watts(c.power, p.t, p.lang)}</b></li>)}</ul></section>;
}
function Alarms({ p }: { p: P }) {
  if (!p.alarms) return null;
  return <button type="button" className="rm-card rm-alarms" onClick={p.onAlarms}><span className="rm-glyph" style="--rm-tint:#7b74d8"><Icon name="bell" size={18} /></span><span className="rm-row-tx"><strong>{p.t('alarm.title')}</strong><small>{p.alarms.length ? p.alarms.map(a => `${a.time}${a.enabled ? '' : ` (${p.t('state.off').toLowerCase()})`}`).join(' · ') : p.t('alarm.addHere')}</small></span><Icon name="next" size={18} /></button>;
}

export function RoomView(p: RoomProps) {
  const m = readRoom(p.reg, p.roomId, p.roomName, p.heating, p.vacuum, p.now);
  // one lamp lives in the one-tap row; several get their own cards
  const tiles = [...m.things.filter(t => t.kind !== 'light' || m.things.filter(x => x.kind === 'light').length > 1), ...m.air];
  const side = m.heat || m.consumers.length;
  return <div className="rm-page rm-b">
    <div className="rm-b-top"><Hero m={m} p={p} /><Quick m={m} p={p} /></div>
    <Alarms p={p} />
    <div className="rm-b-cols">
      {tiles.length > 0 && <div className="rm-b-main"><h2 className="rm-h">{rk(p.t, 'devices')}</h2><div className="rm-tile-grid">{tiles.map(th => <Tile th={th} p={p} />)}</div></div>}
      {side ? <div className="rm-b-side"><h2 className="rm-h">{m.heat && m.consumers.length ? rk(p.t, 'climateEnergy') : m.heat ? rk(p.t, 'climate') : rk(p.t, 'energy')}</h2><HeatLine m={m} p={p} /><Power m={m} p={p} /></div> : null}
    </div>
  </div>;
}
