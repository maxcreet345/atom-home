import type { ComponentChildren } from 'preact';
import { useContext, useRef } from 'preact/hooks';
/* The room page (owner's choice of 09.11.2026, variant «Пульт»; docs/ROOM.md): a hero with what the room reads and one sentence about it,
 * one-tap actions, a card per real device in that device's own words, the room's radiator and who draws the power. */
import { Icon } from './primitives.tsx';
import { PhotoOf, ProductPhoto } from './photo.tsx';
import { thingTakesPhoto } from '../model/photos.ts';
import type { Registry } from '../model/registry.ts';
import type { HomeDevice } from '../model/discover.ts';
import type { Heating } from '../model/heating.ts';
import type { Vacuum } from '../model/vacuum.ts';
import type { Alarm } from '../model/config.ts';
import type { Host } from '../runtime/host.ts';
import type { Commands } from '../runtime/commands.ts';
import type { T } from '../i18n/index.ts';
import { rk, fmt, watts, detail, quickState, GUARDED } from './room-words.ts';
import type { Lang } from './format.ts';
import { readRoom, silence, worst, type RoomModel, type Thing, type ThingKind, type Num, type Binary } from '../model/room.ts';
import { heatRoomWord, HeatRoomCard, heatSetText } from './heating.tsx';
import { vacuumActions, HOLD_MS } from './vacuum.tsx';
import { LiveLoad } from './live-load.tsx';

export interface RoomProps { reg: Registry; roomId: string; roomName: string; heating: Heating | null; vacuum: Vacuum | null; host: Host; t: T; lang: Lang; now: number; alarms: Alarm[] | null;
  deviceOf: (entity: string) => HomeDevice | undefined; toggle: (d: HomeDevice) => void; open: (d: HomeDevice) => void; busy: (d: HomeDevice) => boolean; onHeating: () => void; onAlarms: () => void;
  /** the shell's command runner, and a device's own action by id through the sheet's runner (a valve's «open» / «close», with its question) */ commands: Commands; act: (d: HomeDevice, actionId: string) => void;
  /** a device the owner switched off in «Настройка» («Показывать»): it has no card here either */ hidden?: (th: Thing) => boolean;
  /** a device drawn by a module (the kettle): the module's sheet key, and how to open it */ sheetOf?: (deviceId: string) => string | undefined; openSheet?: (key: string) => void;
  /** the device's own card, when one was made for it (kettle, feeder, robot, camera): the room draws exactly that card */ ownCard?: (th: Thing, all: Thing[]) => ComponentChildren | null | false }
type P = RoomProps;

export const GLYPH: Record<ThingKind, string> = { light: 'light', kettle: 'cup', feeder: 'paw', fountain: 'water', fridge: 'socket', tv: 'media', speaker: 'speaker', player: 'media', vacuum: 'vacuum', washer: 'washer', dryer: 'washer', camera: 'camera', purifier: 'air', humidifier: 'water', vent: 'fan', airfryer: 'pot', boiler: 'flame', valve: 'valve', socket: 'socket', other: 'generic' };
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
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  // not one sensor of the kind answers: «Не отвечает» (the Security card's word), never a state. Some do not: the known state stays and the
  // count of the silent ones stands beside it, amber — «Закрыты · 1 без связи» (a red «Вода!» stays red)
  const b = (key: string, icon: string, x: Binary | null, word: (x: Binary) => [string, Cell['tone'], string?]) => { if (!x) return; const [v, tone, label] = x.unknown ? [cap(t('sec.silent')), 'muted' as const] : word(x), part = !x.unknown && x.silent.length ? ` · ${rk(t, 'v.silentN', { n: x.silent.length })}` : '';
    out.push({ key, icon, label: label ?? rk(t, `m.${key}`), value: v + part, tone: part && tone !== 'bad' ? 'warn' : tone }); };
  b('motion', 'motion', r.motion, x => x.on.length ? [rk(t, 'v.motionYes'), 'on'] : [rk(t, 'v.motionNo', { ago: ago(x.since, now, t) }), 'ok']);
  b('windows', 'blinds', r.windows, x => x.on.length ? [x.ids.length > 1 ? rk(t, 'v.winOf', { n: x.on.length, all: x.ids.length }) : rk(t, 'v.winOpen'), 'warn', x.ids.length > 1 ? rk(t, 'm.windowsOpen') : undefined] : [rk(t, 'v.winClosed'), 'ok']);
  b('door', 'door', r.door, x => x.on.length ? [rk(t, 'v.doorOpen'), 'warn'] : [rk(t, 'v.doorClosed'), 'ok']);
  // a leak sensor has no state until its first alarm (owner's rule): «Ждёт первого срабатывания», calm — unless another one of the room already says «dry»
  b('leak', 'water', r.leak, x => x.on.length ? [rk(t, 'v.wet'), 'bad'] : x.waiting.length && x.waiting.length + x.silent.length === x.ids.length ? [cap(t('sec.waitFirst')), 'ok'] : [rk(t, 'v.dry'), 'ok']);
  b('gas', 'flame', r.gas, x => x.on.length ? [rk(t, 'v.gasAlarm'), 'bad'] : [rk(t, 'v.gasOk'), 'ok']);
  if (r.lux) out.push({ key: 'lux', icon: 'sun', label: rk(t, 'm.lux'), value: r.lux.value === null ? '—' : fmt(r.lux.value, lang), unit: rk(t, 'u.lx'), tone: 'ok' });
  return out;
}
function verdict(m: RoomModel, t: T): { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  const r = m.readings, quiet = silence(r), part = quiet === 'part' ? ` · ${rk(t, 'say.part')}` : '';
  if (r.leak?.on.length) return { text: rk(t, 'say.leak'), tone: 'bad' };
  if (r.gas?.on.length) return { text: rk(t, 'say.gas'), tone: 'bad' };
  const w = worst(r); if (w) return { text: (w.metric === 'humidity' && w.value < 40 ? rk(t, 'say.dry') : rk(t, `say.${w.metric}.${w.tone}`)) + part, tone: w.tone as 'warn' | 'bad' };
  if (r.windows?.on.length) return { text: rk(t, 'say.window') + part, tone: 'warn' };
  // «Всё в порядке» needs readings: with every sensor silent the room says so, with some silent it adds it (as the Air card does)
  if (quiet === 'all') return { text: rk(t, 'say.silent'), tone: 'muted' };
  // …and with some silent it does not say «Всё в порядке» and its opposite in one breath: the missing sensors are the news
  return quiet === 'part' ? { text: rk(t, 'say.partOnly'), tone: 'warn' } : { text: rk(t, 'say.ok'), tone: 'ok' };
}
function Hero({ m, p }: { m: RoomModel; p: P }) {
  const r = m.readings, v = verdict(m, p.t), list = cells(m, p.t, p.lang, p.now), heat = m.heat;
  return <section className={`rm-hero is-${v.tone}`} aria-label={rk(p.t, 'strip')}>
    <div className="rm-hero-main">{/* no reading — no big number: a room without a temperature (no sensor, or one that does not answer) shows no «— °» */}{r.temperature && r.temperature.value !== null && <b>{fmt(r.temperature.value, p.lang, 1)}<i>°</i></b>}<span><strong>{v.text}</strong><small>{heat ? rk(p.t, 'heatLine', { w: heatRoomWord(heat, p.t, p.now).toLowerCase() }) + (heat.target !== null && heat.action !== 'window' && heat.action !== 'off' ? rk(p.t, 'heatTo', { v: heatSetText(heat.target, p.lang) }) : '') : ''}</small></span></div>
    {list.length > 0 && <ul className="rm-hero-cells">{list.map(c => <li className={`is-${c.tone}`}><Icon name={c.icon} size={15} /><b>{c.value}{c.unit ? ` ${c.unit}` : ''}</b><small>{c.label}</small></li>)}</ul>}
  </section>;
}

/** What «подробнее» opens: the module's sheet or the device's own; null when there is nothing to open — then the card is not a button. */
const opensOf = (th: Thing, p: P): (() => void) | null => { const sheet = p.sheetOf?.(th.key); if (sheet && p.openSheet) return () => p.openSheet!(sheet); const d = (th.main ? p.deviceOf(th.main) : undefined) ?? th.ids.map(p.deviceOf).find(Boolean); return d ? () => p.open(d) : null; };
function Tile({ th, p }: { th: Thing; p: P }) {
  // a button whose command is on its way, or with the house offline, is not `disabled` (the keyboard's focus would fall to nowhere, and a press
  // could not tell why): it is `aria-disabled` — a waiting one ignores the press, an offline one lets the runner say «Нет связи с домом»
  const x = detail(th, p), opens = opensOf(th, p), waits = !!x.action && p.commands.pending(x.action.key), offline = !p.host.online;
  // the appliance's own photo in place of the kind's glyph; a device with no connection (or nothing known) keeps its glyph
  const photoOf = useContext(PhotoOf), shot = th.available && x.tone !== 'muted' && thingTakesPhoto(th.kind, th.main) ? photoOf(th.main) ?? th.ids.map(id => photoOf(id)).find(Boolean) ?? null : null;
  // a lamp answers for its bulb (ST-01): a bulb that does not answer is the muted «Нет связи» card, one without data keeps the plain card with «Нет данных»
  const tone = x.link === 'unknown' ? 'ok' : x.tone;
  return <article className={`rm-tile is-${tone} ${x.active ? 'is-on' : ''}`} data-state={x.link} style={`--rm-tint:${TINT[th.kind]}`}>
    {opens && <button type="button" className="rm-tile-open" aria-label={`${th.name}: ${x.status}. ${rk(p.t, 'more')}`} onClick={opens} />}
    <div className="rm-tile-head"><span className="rm-tile-ic"><ProductPhoto src={shot}><Icon name={GLYPH[th.kind]} size={22} /></ProductPhoto></span><span className="rm-tile-name"><strong>{th.name}</strong><small>{x.status}</small></span></div>
    {x.facts.length > 0 && <ul className="rm-facts">{x.facts.slice(0, 3).map(f => <li className={f.tone === 'warn' ? 'is-warn' : ''}>{f.tone === 'warn' && <Icon name="warning" size={12} />}{f.text}</li>)}</ul>}
    {x.action && <button type="button" className="rm-tile-act" disabled={!th.available} aria-disabled={waits || offline || undefined} aria-busy={waits || undefined} onClick={() => { if (!waits) x.action!.run(); }}>{x.action.label}</button>}
  </article>;
}

/* ---------- one-tap actions, the radiator, the power ---------- */
function Quick({ m, p }: { m: RoomModel; p: P }) {
  // a lamp stays in the row when it does not answer (ST-01): it is the room's light, and «Нет связи» is its news — the room's only lamp has no other card
  const picks = [...m.things.filter(t => t.kind === 'light'), ...m.air, ...m.things.filter(t => ['kettle', 'tv', 'fountain'].includes(t.kind))].filter(t => t.main && (t.available || t.kind === 'light') && !GUARDED.test(t.name) && p.deviceOf(t.main)).slice(0, 4);
  const clean = p.vacuum && m.vacuum?.linked ? p.vacuum : null, offline = !p.host.online;
  const phase = useRef(clean?.phase); phase.current = clean?.phase;
  // ST-02: the room's only lamp has no card below (RoomView) — a long press (500 ms) or the context menu (a right click, the keyboard's menu key or
  // Shift+F10) opens its own sheet with the brightness, as a lamp's tile does on «Главная» and in «Свет»; the tap stays the power. It sends nothing.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: string | null }>({ timer: null, fired: null });
  if (!picks.length && !clean) return null;
  // «Убрать» waits until the robot's phase changes (it answers seconds later; up to 15 s, as in its own panel) and is off while it cleans or drives home
  const vacKey = `vac:room:${m.id}`, vacWaits = p.commands.pending(vacKey), vacBusy = !!clean && (clean.phase === 'cleaning' || clean.phase === 'returning');
  const lamps = m.things.filter(x => x.kind === 'light').length;
  const release = () => { if (hold.current.timer) clearTimeout(hold.current.timer); hold.current.timer = null; };
  const opener = (key: string, open: (() => void) | null) => open ? {
    onPointerDown: () => { release(); hold.current.fired = null; hold.current.timer = setTimeout(() => { hold.current.timer = null; hold.current.fired = key; open(); }, 500); },
    onPointerUp: release, onPointerLeave: release, onPointerCancel: release, onKeyDown: () => { hold.current.fired = null; /* a key is never the release of a long press */ },
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); release(); if (hold.current.fired !== key) open(); },
  } : {};
  return <div className="rm-quick">{picks.map(th => { const d = p.deviceOf(th.main!)!, x = detail(th, p), q = quickState(th, x, p.t), waits = q.own ? p.commands.pending(q.own.key) : p.busy(d);
    const more = th.kind === 'light' && lamps === 1 ? opensOf(th, p) : null;
    // the word and the tap follow the device's card below (`quickState`); waiting or offline is `aria-disabled`, only a silent device is `disabled` —
    // and a silent one sends nothing even when a press reaches it (ST-01); a state that is not known is said in words, never as `aria-pressed="false"`
    return <button type="button" className={`rm-q ${q.on ? 'is-on' : ''}`} style={`--rm-tint:${TINT[th.kind]}`} data-opens={more ? 'sheet' : undefined} aria-pressed={q.own || !q.known ? undefined : q.on} aria-label={q.own ? `${th.name}: ${x.status}. ${q.own.label}` : undefined} disabled={q.silent} aria-disabled={!q.silent && (waits || offline) || undefined} aria-busy={waits || undefined} {...opener(th.key, more)} onClick={() => { if (hold.current.fired === th.key) { hold.current.fired = null; return; } /* the long press opened the sheet: its release is no tap */ if (waits || q.silent) return; if (q.own) q.own.run(); else p.toggle(d); }}><Icon name={GLYPH[th.kind]} size={22} /><strong>{['purifier', 'humidifier', 'vent'].includes(th.kind) ? th.name.split(' ')[0] : th.name}</strong><small>{q.word}</small></button>; })}
    {clean && <button type="button" className="rm-q is-vac" style="--rm-tint:#5e5ce6" onClick={() => { if (vacWaits || vacBusy) return; const was = phase.current; void p.commands.run(vacKey, () => vacuumActions(clean, p.host).rooms([m.id], 1), { until: () => phase.current !== was, untilMs: HOLD_MS }); }} disabled={!clean.available} aria-disabled={clean.available && (vacWaits || vacBusy || offline) || undefined} aria-busy={vacWaits || undefined} aria-label={rk(p.t, 'cleanRoom', { r: where(p.roomName, p.lang) })}><Icon name="vacuum" size={22} /><strong>{rk(p.t, 'clean')}</strong><small>{clean.phase === 'cleaning' ? rk(p.t, 'cleaning') : clean.phase === 'returning' ? rk(p.t, 'returning') : where(p.roomName, p.lang)}</small></button>}
  </div>;
}
function Alarms({ p }: { p: P }) {
  if (!p.alarms) return null;
  return <button type="button" className="rm-card rm-alarms" onClick={p.onAlarms}><span className="rm-glyph" style="--rm-tint:#7b74d8"><Icon name="bell" size={18} /></span><span className="rm-row-tx"><strong>{p.t('alarm.title')}</strong><small>{p.alarms.length ? p.alarms.map(a => `${a.time}${a.enabled ? '' : ` (${p.t('state.off').toLowerCase()})`}`).join(' · ') : p.t('alarm.addHere')}</small></span><Icon name="next" size={18} /></button>;
}

export function RoomView(p: RoomProps) {
  const m = readRoom(p.reg, p.roomId, p.roomName, p.heating, p.vacuum, p.now);
  // one lamp lives in the one-tap row; several get their own cards
  const tiles = [...m.things.filter(t => t.kind !== 'light' || m.things.filter(x => x.kind === 'light').length > 1), ...m.air].filter(th => !p.hidden?.(th));
  // a device that already has its own card (kettle, feeder, robot, camera) is drawn by it, the same as on Home; the rest get the room's card
  const cards = tiles.map(th => [th, p.ownCard?.(th, tiles) ?? null] as const), own = cards.filter(([, c]) => c !== null && c !== false), plain = cards.filter(([, c]) => c === null).map(([th]) => th); // false: drawn by another device's card (the room's cameras card)
  const side = m.heat || m.consumers.length;
  return <div className="rm-page rm-b">
    <div className="rm-b-top"><Hero m={m} p={p} /><Quick m={m} p={p} /></div>
    <Alarms p={p} />
    <div className="rm-b-cols">
      {tiles.length > 0 && <div className="rm-b-main"><h2 className="rm-h">{rk(p.t, 'devices')}</h2>
        {own.length > 0 && <div className="ah-grid ah-face rm-own">{own.map(([, card]) => card)}</div>}
        {plain.length > 0 && <div className="rm-tile-grid">{plain.map(th => <Tile th={th} p={p} />)}</div>}</div>}
      {side ? <div className="rm-b-side"><h2 className="rm-h">{m.heat && m.consumers.length ? rk(p.t, 'climateEnergy') : m.heat ? rk(p.t, 'climate') : rk(p.t, 'energy')}</h2>{m.heat && p.heating && <div className="rm-heat"><HeatRoomCard h={p.heating} room={m.heat} host={p.host} t={p.t} lang={p.lang} now={p.now} /></div>}{m.consumers.length > 0 && <LiveLoad title={rk(p.t, 'liveTitle')} rows={m.consumers.map(c => ({ key: c.key, name: c.name, watts: c.power, icon: GLYPH[[...m.things, ...m.air].find(x => x.key === c.key)?.kind ?? 'other'] }))} today={m.consumers.reduce((s, c) => s + (c.today ?? 0), 0)} t={p.t} lang={p.lang} />}</div> : null}
    </div>
  </div>;
}
