/* The room page (mock, 09.11.2026): three layouts of one content for the owner to choose from (docs/ROOM.md once chosen).
 * A — «Карточки»: the strip, the room's climate, a card per device, who draws the power.
 * B — «Пульт»: a hero with the readings, one-tap actions, square device tiles, the power as one bar.
 * C — «Список»: the strip as chips, then rows grouped like the phone's settings, the watts on each row.
 * Words are Russian only while it is a mock; the chosen one gets ro/en keys. */
import type { ComponentChildren } from 'preact';
import { Icon } from './primitives.tsx';
import { Switch } from './cards.tsx';
import type { Registry } from '../model/registry.ts';
import type { HomeDevice } from '../model/discover.ts';
import type { Heating } from '../model/heating.ts';
import type { Vacuum } from '../model/vacuum.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import type { Lang } from './format.ts';
import { readRoom, worst, type RoomModel, type Thing, type ThingKind, type Num, type Binary } from '../model/room.ts';
import { HeatRoomCard, heatRoomWord, heatingActions, useStepper, Stepper, heatSetText } from './heating.tsx';
import { vacuumActions } from './vacuum.tsx';

export type RoomLayout = 'a' | 'b' | 'c';
interface Props { layout: RoomLayout; reg: Registry; roomId: string; roomName: string; heating: Heating | null; vacuum: Vacuum | null; host: Host; t: T; lang: Lang; now: number; wide: boolean;
  deviceOf: (entity: string) => HomeDevice | undefined; toggle: (d: HomeDevice) => void; open: (d: HomeDevice) => void; busy: (d: HomeDevice) => boolean; onHeating: () => void; onVacuum: () => void }

const GLYPH: Record<ThingKind, string> = { light: 'light', kettle: 'cup', feeder: 'paw', fountain: 'water', fridge: 'socket', tv: 'media', speaker: 'speaker', player: 'media', vacuum: 'vacuum', washer: 'washer', dryer: 'washer', camera: 'camera', purifier: 'air', humidifier: 'water', vent: 'fan', airfryer: 'pot', boiler: 'flame', socket: 'socket', other: 'generic' };
const TINT: Record<ThingKind, string> = { light: '#ffb800', kettle: '#ff8a3d', feeder: '#c08a4a', fountain: '#32ade6', fridge: '#5ac8c8', tv: '#bf5af2', speaker: '#8e7cf0', player: '#bf5af2', vacuum: '#5e5ce6', washer: '#32ade6', dryer: '#64a8e6', camera: '#8e8e93', purifier: '#30b0c7', humidifier: '#32ade6', vent: '#64d2ff', airfryer: '#ff9f0a', boiler: '#ff6b35', socket: '#30d158', other: '#8e8e93' };
const LOC: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
const fmt = (v: number, lang: Lang, d = 0) => v.toLocaleString(LOC[lang], { maximumFractionDigits: d, minimumFractionDigits: 0 });
const watts = (w: number, lang: Lang) => w >= 1000 ? `${fmt(w / 1000, lang, 1)} кВт` : `${fmt(w, lang, w < 10 ? 1 : 0)} Вт`;
const ago = (since: number | null, now: number) => { if (!since) return ''; const m = Math.max(0, Math.round((now - since) / 60000)); return m < 1 ? 'только что' : m < 60 ? `${m} мин` : m < 60 * 24 ? `${Math.floor(m / 60)} ч` : `${Math.floor(m / 1440)} дн`; };
/** «Кухня» → «кухню»: the robot's button says where it goes */
const accus = (n: string) => { const l = n.toLowerCase(); return l.replace(/ая$/, 'ую').replace(/яя$/, 'юю').replace(/я$/, 'ю').replace(/а$/, 'у'); };

/* ---------- what each thing says ---------- */
function line(th: Thing, reg: Registry, lang: Lang): string {
  const st = (re: RegExp) => { const id = th.ids.find(i => re.test(i)); return id ? reg.states[id]?.state ?? null : null; }, n = (re: RegExp) => { const v = Number(st(re)); return Number.isFinite(v) ? v : null; };
  if (!th.available) return 'Нет связи';
  const main = th.main ? reg.states[th.main] : undefined, mainOn = main?.state === 'on';
  switch (th.kind) {
    case 'kettle': { const s = st(/kettle_status$/), c = n(/kettle_temperature$/); const temp = c !== null ? ` · ${fmt(c, lang)}°` : ''; return (s === 'heating' || s === 'boiling' ? 'Греет' : s === 'keep_warm' || s === 'warming' ? 'Подогрев' : st(/kettle_lifted$/) === 'on' ? 'Снят с базы' : 'Остыл') + temp; }
    case 'feeder': { const bowl = n(/bowl_percent$/), food = st(/food_level$/); return `${food === 'normal' ? 'Корм есть' : food ? 'Мало корма' : 'Кормушка'}${bowl !== null ? ` · в миске ${fmt(bowl, lang)} %` : ''}`; }
    case 'fountain': { const s = st(/fountain_status$/), f = n(/filter_level$/); return `${s === 'waterless' ? 'Нет воды' : mainOn ? 'Льётся' : 'Насос выкл.'}${f !== null ? ` · фильтр ${fmt(f, lang)} %` : ''}`; }
    case 'fridge': return mainOn ? 'Включён' : 'Выключен';
    case 'airfryer': { const s = st(/airfryer_status$/); return !s || s === 'unavailable' ? 'Спит' : s; }
    case 'washer': { const s = st(/washer_current_status$/); return s && s !== 'unavailable' && s !== 'power_off' ? s : mainOn ? 'Ждёт стирки' : 'Розетка выкл.'; }
    case 'dryer': { const s = st(/machine_state$/), r = n(/dryer_remaining$/); return s === 'run' ? `Сушит${r ? ` · ещё ${fmt(r, lang)} мин` : ''}` : 'Не работает'; }
    case 'tv': case 'player': { const app = st(/active_app$/); return main?.state === 'on' || main?.state === 'playing' ? `Включён${app && !/standby|off/i.test(app) ? ` · ${app}` : ''}` : main?.state === 'paused' ? 'Пауза' : 'Выключен'; }
    case 'speaker': { const title = main?.attributes.media_title as string | undefined; return main?.state === 'playing' ? `Играет${title ? ` · ${title}` : ''}` : main?.state === 'paused' ? 'На паузе' : main ? 'Тишина' : 'Розетка вкл.'; }
    case 'light': return mainOn ? `Горит${typeof main?.attributes.brightness === 'number' ? ` · ${Math.round(main.attributes.brightness / 2.55)} %` : ''}` : 'Выключен';
    case 'purifier': { const pm = n(/_pm25$/); return mainOn ? `Работает${pm !== null ? ` · PM2.5 ${fmt(pm, lang)}` : ''}` : 'Выключен'; }
    case 'humidifier': return main?.state === 'on' ? 'Увлажняет' : main?.state === 'unavailable' ? 'Нет связи' : 'Выключен';
    case 'vent': return mainOn ? 'Тянет' : 'Выключена';
    case 'camera': return 'Камера';
    default: return main ? (mainOn ? 'Включено' : 'Выключено') : '';
  }
}

/* ---------- the strip ---------- */
interface Cell { key: string; icon: string; label: string; value: string; unit?: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'on' }
function cells(m: RoomModel, lang: Lang, now: number): Cell[] {
  const r = m.readings, out: Cell[] = [];
  const numCell = (key: string, icon: string, label: string, n: Num | null, unit: string, digits = 0) => { if (!n) return; out.push({ key, icon, label, value: n.value === null ? '—' : fmt(n.value, lang, digits), unit: n.value === null ? '' : unit, tone: n.value === null ? 'muted' : n.tone }); };
  numCell('t', 'thermo', 'Температура', r.temperature, '°', 1); numCell('h', 'water', 'Влажность', r.humidity, '%'); numCell('co2', 'air', 'CO₂', r.co2, 'ppm'); numCell('pm', 'air', 'PM2.5', r.pm25, 'мкг');
  const b = (key: string, icon: string, label: string, x: Binary | null, word: (x: Binary) => [string, Cell['tone']]) => { if (!x) return; const [v, tone] = x.unknown ? ['—', 'muted' as const] : word(x); out.push({ key, icon, label, value: v, tone }); };
  b('motion', 'motion', 'Движение', r.motion, x => x.on.length ? ['Есть', 'on'] : [`Нет · ${ago(x.since, now)}`, 'ok']);
  b('win', 'blinds', r.windows?.on.length && r.windows.ids.length > 1 ? 'Окна открыты' : 'Окна', r.windows, x => x.on.length ? [x.ids.length > 1 ? `${x.on.length} из ${x.ids.length}` : 'Открыто', 'warn'] : ['Закрыты', 'ok']);
  b('door', 'door', 'Дверь', r.door, x => x.on.length ? ['Открыта', 'warn'] : ['Закрыта', 'ok']);
  b('leak', 'water', 'Протечка', r.leak, x => x.on.length ? ['Вода!', 'bad'] : ['Сухо', 'ok']);
  b('gas', 'flame', 'Газ', r.gas, x => x.on.length ? ['Утечка!', 'bad'] : ['Норма', 'ok']);
  if (r.lux) out.push({ key: 'lux', icon: 'sun', label: 'Освещённость', value: r.lux.value === null ? '—' : fmt(r.lux.value, lang), unit: 'лк', tone: 'ok' });
  return out;
}
const VERDICT: Record<string, Record<'warn' | 'bad', string>> = { co2: { warn: 'Душно — стоит проветрить', bad: 'Очень душно — откройте окно' }, pm25: { warn: 'Пыльно — включите очиститель', bad: 'Очень пыльно' }, humidity: { warn: 'Влажно', bad: 'Сыро — нужна вытяжка' }, temperature: { warn: 'Температура вне нормы', bad: 'Холодно или жарко' } };
function verdict(m: RoomModel): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  const r = m.readings;
  if (r.leak?.on.length) return { text: 'Протечка! Проверьте пол', tone: 'bad' };
  if (r.gas?.on.length) return { text: 'Датчик газа сработал', tone: 'bad' };
  const w = worst(r); if (w) { const low = w.metric === 'humidity' && w.value < 40; return { text: low ? 'Сухо — включите увлажнитель' : VERDICT[w.metric][w.tone as 'warn' | 'bad'], tone: w.tone as 'warn' | 'bad' }; }
  if (r.windows?.on.length) return { text: 'Окно открыто', tone: 'warn' };
  return { text: 'Всё в порядке', tone: 'ok' };
}
function Strip({ m, lang, now, compact }: { m: RoomModel; lang: Lang; now: number; compact?: boolean }) {
  const all = cells(m, lang, now), rank = (c: Cell) => c.tone === 'bad' ? 0 : c.tone === 'warn' ? 1 : 2, list = compact ? [...all].sort((a, b) => rank(a) - rank(b)) : all, v = verdict(m);
  return <section className={`rm-strip ${compact ? 'is-chips' : ''} is-${v.tone}`} aria-label="Показания комнаты">
    {!compact && <p className="rm-verdict"><i />{v.text}</p>}
    <ul>{list.map(c => <li key={c.key} className={`rm-cell is-${c.tone}`}><span className="rm-cell-ic"><Icon name={c.icon} size={compact ? 15 : 17} /></span><span className="rm-cell-tx"><b>{c.value}{c.unit && <i>{c.unit === '°' ? '°' : ` ${c.unit}`}</i>}</b><small>{c.label}</small></span></li>)}</ul>
  </section>;
}

/* ---------- pieces ---------- */
const Glyph = ({ th, size = 20 }: { th: Thing; size?: number }) => <span className={`rm-glyph ${th.on ? 'is-on' : ''}`} style={`--rm-tint:${TINT[th.kind]}`}><Icon name={GLYPH[th.kind]} size={size} /></span>;
function Toggle({ th, p }: { th: Thing; p: Props }) {
  const d = th.main ? p.deviceOf(th.main) : undefined; if (!d || th.kind === 'camera') return null;
  return <Switch on={!!th.on} pending={p.busy(d)} disabled={!th.available} label={`${th.name}: ${th.on ? 'выключить' : 'включить'}`} onToggle={() => p.toggle(d)} />;
}
const openThing = (th: Thing, p: Props) => { const d = (th.main ? p.deviceOf(th.main) : undefined) ?? th.ids.map(p.deviceOf).find(Boolean); if (d) p.open(d); };
function VacButton({ m, p, big }: { m: RoomModel; p: Props; big?: boolean }) {
  if (!p.vacuum || !m.vacuum?.linked) return null;
  const v = p.vacuum, busy = v.phase === 'cleaning';
  return <button type="button" className={`rm-vac ${big ? 'is-big' : ''}`} onClick={() => void vacuumActions(v, p.host).rooms([m.id], 1)} disabled={!v.available || busy}>
    <span className="rm-glyph" style="--rm-tint:#5e5ce6"><Icon name="vacuum" size={big ? 22 : 18} /></span><span><strong>Убрать {accus(p.roomName)}</strong><small>{busy ? 'Робот уже убирает' : v.phase === 'docked' ? `Робот на базе · ${v.battery ?? '—'} %` : 'Робот свободен'}</small></span></button>;
}
function Power({ m, lang, kind }: { m: RoomModel; lang: Lang; kind: 'list' | 'bar' }) {
  if (!m.consumers.length) return null;
  const top = m.consumers.slice(0, 5), max = Math.max(1, ...top.map(c => c.power)), today = m.consumers.reduce((s, c) => s + (c.today ?? 0), 0);
  const head = <div className="rm-pw-head"><span><b>{watts(m.total ?? 0, lang)}</b> сейчас</span>{today > 0 && <small>{fmt(today, lang, today < 10 ? 2 : 1)} кВт·ч за сегодня</small>}</div>;
  if (kind === 'bar') { const sum = top.reduce((s, c) => s + c.power, 0) || 1, cols = ['#30d158', '#0a84ff', '#ff9f0a', '#bf5af2', '#8e8e93'];
    return <section className="rm-card rm-power is-bar"><h3>Потребление</h3>{head}<div className="rm-pw-stack" aria-hidden="true">{top.map((c, i) => <i style={`flex:${Math.max(c.power, sum * 0.02)};background:${cols[i]}`} />)}</div>
      <ul className="rm-pw-legend">{top.map((c, i) => <li><i style={`background:${cols[i]}`} />{c.name}<b>{watts(c.power, lang)}</b></li>)}</ul></section>; }
  return <section className="rm-card rm-power"><h3>Кто тянет</h3>{head}<ol>{top.map(c => <li><span className="rm-pw-name">{c.name}</span><span className="rm-pw-bar"><i style={`width:${Math.max(3, c.power / max * 100)}%`} /></span><b>{watts(c.power, lang)}</b></li>)}</ol></section>;
}

/* ---------- A: cards ---------- */
function DeviceCard({ th, p }: { th: Thing; p: Props }) {
  return <article className={`rm-dev ${th.on ? 'is-on' : ''} ${th.available ? '' : 'is-off'}`}>
    <button type="button" className="rm-dev-open" aria-label={`${th.name}: подробнее`} onClick={() => openThing(th, p)} />
    <div className="rm-dev-top"><Glyph th={th} size={22} />{th.power !== null && th.power >= 0.5 && <span className="rm-watt">{watts(th.power, p.lang)}</span>}</div>
    <strong>{th.name}</strong><small>{line(th, p.reg, p.lang)}</small>
    <div className="rm-dev-sw"><Toggle th={th} p={p} /></div>
  </article>;
}
function AirRows({ m, p }: { m: RoomModel; p: Props }) {
  if (!m.air.length) return null;
  return <section className="rm-card rm-air"><h3>Воздух</h3>{m.air.map(th => <div className="rm-row"><Glyph th={th} size={18} /><button type="button" className="rm-row-tx" onClick={() => openThing(th, p)}><strong>{th.name}</strong><small>{line(th, p.reg, p.lang)}</small></button><Toggle th={th} p={p} /></div>)}</section>;
}
function LayoutA({ m, p }: { m: RoomModel; p: Props }) {
  return <div className={`rm-page rm-a ${p.wide ? 'is-wide' : ''}`}>
    <Strip m={m} lang={p.lang} now={p.now} />
    <div className="rm-a-cols">
      <div className="rm-a-side">
        {(m.heat || m.air.length > 0) && <h2 className="rm-h">Климат комнаты</h2>}
        {m.heat && p.heating && <div className="rm-heat"><HeatRoomCard h={p.heating} room={m.heat} host={p.host} t={p.t} lang={p.lang} now={p.now} /></div>}
        <AirRows m={m} p={p} />
        {p.wide && <Power m={m} lang={p.lang} kind="list" />}
      </div>
      <div className="rm-a-main">
        <h2 className="rm-h">Устройства</h2>
        <VacButton m={m} p={p} />
        <div className="rm-dev-grid">{m.things.map(th => <DeviceCard th={th} p={p} />)}</div>
        {!p.wide && <Power m={m} lang={p.lang} kind="list" />}
      </div>
    </div>
  </div>;
}

/* ---------- B: control panel ---------- */
function Hero({ m, p }: { m: RoomModel; p: Props }) {
  const r = m.readings, v = verdict(m), list = cells(m, p.lang, p.now).filter(c => c.key !== 't');
  return <section className={`rm-hero is-${v.tone}`}>
    <div className="rm-hero-main"><b>{r.temperature?.value != null ? fmt(r.temperature.value, p.lang, 1) : '—'}<i>°</i></b><span><strong>{v.text}</strong><small>{m.heat ? `Батарея: ${heatRoomWord(m.heat, p.t, p.now).toLowerCase()}${m.heat.target !== null ? ` · до ${heatSetText(m.heat.target, p.lang)}°` : ''}` : 'Без отопления'}</small></span></div>
    <ul className="rm-hero-cells">{list.map(c => <li className={`is-${c.tone}`}><Icon name={c.icon} size={15} /><b>{c.value}{c.unit && c.unit !== '°' ? ` ${c.unit}` : ''}</b><small>{c.label}</small></li>)}</ul>
  </section>;
}
function Quick({ m, p }: { m: RoomModel; p: Props }) {
  const picks = [...m.things.filter(t => t.kind === 'light'), ...m.air, ...m.things.filter(t => ['kettle', 'tv', 'fountain'].includes(t.kind))].filter(t => t.main && p.deviceOf(t.main)).slice(0, 4);
  if (!picks.length && !(p.vacuum && m.vacuum?.linked)) return null;
  return <div className="rm-quick">{picks.map(th => { const d = p.deviceOf(th.main!)!, x = detail(th, p), on = ['tv', 'player', 'speaker'].includes(th.kind) ? x.active : !!th.on; return <button type="button" className={`rm-q ${on ? 'is-on' : ''}`} style={`--rm-tint:${TINT[th.kind]}`} aria-pressed={on} disabled={!th.available || p.busy(d)} onClick={() => p.toggle(d)}><Icon name={GLYPH[th.kind]} size={22} /><strong>{['purifier', 'humidifier', 'vent'].includes(th.kind) ? th.name.split(' ')[0] : th.name}</strong><small>{on ? 'Вкл.' : th.available ? 'Выкл.' : 'Нет связи'}</small></button>; })}
    {p.vacuum && m.vacuum?.linked && <button type="button" className="rm-q is-vac" style="--rm-tint:#5e5ce6" onClick={() => void vacuumActions(p.vacuum!, p.host).rooms([m.id], 1)} disabled={!p.vacuum.available || p.vacuum.phase === 'cleaning'}><Icon name="vacuum" size={22} /><strong>Убрать</strong><small>{accus(p.roomName)}</small></button>}
  </div>;
}
function HeatLine({ m, p }: { m: RoomModel; p: Props }) {
  const r = m.heat, h = p.heating, act = h ? heatingActions(h, p.host) : null;
  const st = useStepper(r?.target ?? null, v => act && r ? act.room(r, v) : Promise.resolve(), () => {}, () => {}, 5, 30);
  if (!r || !h) return null;
  return <section className={`rm-card rm-heatline is-${r.action}`}><span className="rm-glyph" style="--rm-tint:#ff7a1a"><Icon name="heating" size={20} /></span>
    <button type="button" className="rm-row-tx" onClick={p.onHeating}><strong>Батарея</strong><small>{heatSetText(r.current, p.lang)}° · {heatRoomWord(r, p.t, p.now).toLowerCase()}</small></button>
    {r.action === 'window' || r.action === 'off' ? <span className="rm-muted">Выкл</span> : <Stepper value={st.shown} text={heatSetText(st.shown, p.lang)} onStep={st.step} t={p.t} size="small" label={`${p.roomName}: задано`} atMin={st.atMin} atMax={st.atMax} pending={st.pending} />}</section>;
}
/* ---------- B: one card per device, in that device's own words ---------- */
type Tone = 'ok' | 'warn' | 'muted' | 'on';
interface Fact { text: string; tone?: 'warn' }
interface Detail { status: string; tone: Tone; active: boolean; facts: Fact[]; action: { label: string; run: () => void } | null }
/** What the device does now, the two facts the owner looks for, and the one thing to do with it. Honest: standby is not «on», a silent device is «Не в сети». */
export function detail(th: Thing, p: Pick<Props, 'reg' | 'lang' | 'host' | 'deviceOf' | 'toggle'>): Detail {
  const reg = p.reg, lang = p.lang, id = (re: RegExp) => th.ids.find(i => re.test(i)) ?? null, st = (re: RegExp) => { const i = id(re); return i ? reg.states[i]?.state ?? null : null; }, n = (re: RegExp) => { const v = Number(st(re)); return st(re) !== null && Number.isFinite(v) ? v : null; };
  const main = th.main ? reg.states[th.main] : undefined, call = (d: string, s: string, e: string) => () => void p.host.call(d, s, { entity_id: e });
  const tog = (on: string, off: string) => { const d = th.main ? p.deviceOf(th.main) : undefined; return d ? { label: th.on ? off : on, run: () => p.toggle(d) } : null; };
  const pct = (v: number | null) => v === null ? '' : `${fmt(v, lang)} %`, standbyW = th.power !== null && th.power >= 0.5 ? watts(th.power, lang) : null;
  const off = (why = 'Не в сети'): Detail => ({ status: why, tone: 'muted', active: false, facts: standbyW ? [{ text: `${standbyW} из розетки` }] : [], action: null });
  switch (th.kind) {
    case 'light': if (!th.available) return off(); return { status: th.on ? 'Горит' : 'Выключен', tone: th.on ? 'on' : 'ok', active: !!th.on, facts: typeof main?.attributes.brightness === 'number' ? [{ text: `Яркость ${Math.round(main.attributes.brightness / 2.55)} %` }] : [], action: tog('Включить', 'Выключить') };
    case 'kettle': { const s = st(/kettle_status$/), c = n(/kettle_temperature$/), target = reg.states['water_heater.kitchen_kettle']?.attributes.temperature as number | undefined, warm = st(/auto_keep_warm$/) === 'on', heating = s === 'heating' || s === 'boiling', lifted = st(/kettle_lifted$/) === 'on';
      const facts: Fact[] = [{ text: `Вода ${c !== null ? fmt(c, lang) : '—'}°` }]; if (target) facts.push({ text: `Кипятит до ${fmt(target, lang)}°` }); if (warm) facts.push({ text: 'Подогрев вкл.' });
      return { status: lifted ? 'Снят с базы' : heating ? 'Греет воду' : s === 'keep_warm' || s === 'warming' ? 'Держит тепло' : c !== null && c < 40 ? 'Холодный' : 'Остывает', tone: heating ? 'on' : 'ok', active: heating, facts, action: th.main && !lifted ? { label: heating ? 'Выключить' : 'Вскипятить', run: call('switch', heating ? 'turn_off' : 'turn_on', th.main) } : null }; }
    case 'feeder': { const bowl = n(/bowl_percent$/), food = st(/food_level$/), des = n(/desiccant_level$/), sched = st(/feeder_schedule$/) === 'on', stuck = st(/food_stuck$/);
      const facts: Fact[] = [{ text: `В миске ${pct(bowl)}` }, food === 'normal' ? { text: 'Бункер полный' } : { text: 'Мало корма в бункере', tone: 'warn' }]; if (des !== null && des <= 10) facts.push({ text: 'Сменить осушитель', tone: 'warn' });
      return { status: stuck && stuck !== 'normal' ? 'Корм застрял' : sched ? 'Кормит по расписанию' : 'Расписание выключено', tone: stuck && stuck !== 'normal' ? 'warn' : 'ok', active: false, facts, action: null }; }
    case 'fountain': { const dry = st(/fountain_status$/) === 'waterless' || st(/water_low$/) === 'on', f = n(/filter_level$/), days = n(/filter_days$/);
      return { status: dry ? 'Нет воды — долейте' : th.on ? 'Вода течёт' : 'Насос выключен', tone: dry ? 'warn' : th.on ? 'on' : 'ok', active: !dry && !!th.on, facts: [{ text: `Фильтр ${pct(f)}${days !== null ? ` · ${fmt(days, lang)} дн.` : ''}`, tone: f !== null && f <= 15 ? 'warn' : undefined }], action: tog('Включить насос', 'Выключить насос') }; }
    case 'fridge': { const w = th.power ?? 0; return { status: !th.on ? 'Розетка выключена!' : w > 15 ? 'Компрессор работает' : 'Компрессор отдыхает', tone: th.on ? 'ok' : 'warn', active: false, facts: [{ text: th.today !== null ? `${fmt(th.today, lang, 2)} кВт·ч за сегодня` : 'Без счётчика за день' }], action: null }; } // never a switch: a fridge is not turned off by a stray tap
    case 'tv': case 'player': { if (!main || main.state === 'unavailable') return off(); const app = st(/active_app$/) ?? (main.attributes.app_name as string | undefined) ?? null, standby = /standby/i.test(app ?? '') || (main.state === 'on' && /standby/i.test(st(/active_source$/) ?? '')), live = ['on', 'playing', 'paused'].includes(main.state) && !standby;
      const facts: Fact[] = []; if (live && app && !/^off$/i.test(app)) facts.push({ text: app }); if (standbyW) facts.push({ text: live ? standbyW : `${standbyW} в ожидании` }); if (live && typeof main.attributes.volume_level === 'number') facts.push({ text: `Громкость ${Math.round(main.attributes.volume_level * 100)} %` });
      return { status: live ? (main.state === 'paused' ? 'Пауза' : 'Смотрят') : standby ? 'Спит (ожидание)' : 'Выключен', tone: live ? 'on' : 'ok', active: live, facts, action: th.main ? { label: live || standby ? 'Выключить' : 'Включить', run: call('media_player', live || standby ? 'turn_off' : 'turn_on', th.main) } : null }; }
    case 'speaker': { if (!main || main.state === 'unavailable') return off(); const title = [main.attributes.media_artist, main.attributes.media_title].filter(Boolean).join(' — '), vol = typeof main.attributes.volume_level === 'number' ? Math.round(main.attributes.volume_level * 100) : null;
      const facts: Fact[] = []; if (title) facts.push({ text: title }); if (vol !== null) facts.push({ text: `Громкость ${vol} %` }); if (standbyW) facts.push({ text: standbyW });
      return { status: main.state === 'playing' ? 'Играет' : main.state === 'paused' ? 'На паузе' : 'Ждёт команды', tone: main.state === 'playing' ? 'on' : 'ok', active: main.state === 'playing', facts, action: main.state === 'playing' ? { label: 'Пауза', run: call('media_player', 'media_pause', th.main!) } : main.state === 'paused' ? { label: 'Продолжить', run: call('media_player', 'media_play', th.main!) } : null }; }
    case 'purifier': { const pm = n(/_pm25$/), life = n(/filter_life$/), left = n(/filter_left_time$/), mode = main?.attributes.preset_mode as string | undefined, sp = main?.attributes.percentage as number | undefined;
      return { status: th.on ? `Чистит · ${mode === 'Auto' ? 'авто' : mode === 'Sleep' ? 'ночной' : mode ?? ''}${sp ? `, ${sp} %` : ''}` : 'Выключен', tone: th.on ? 'on' : 'ok', active: !!th.on, facts: [{ text: `PM2.5 ${pm !== null ? fmt(pm, lang) : '—'}` }, { text: `Фильтр ${pct(life)}${left !== null ? ` · ${fmt(left, lang)} дн.` : ''}`, tone: life !== null && life <= 20 ? 'warn' : undefined }], action: tog('Включить', 'Выключить') }; }
    case 'humidifier': if (main?.state === 'unavailable' || !main) return off(reg.states['switch.living_humidifier_plug']?.state === 'off' ? 'Не в сети · розетка выкл.' : 'Не в сети'); return { status: main.state === 'on' ? 'Увлажняет' : 'Выключен', tone: main.state === 'on' ? 'on' : 'ok', active: main.state === 'on', facts: [], action: tog('Включить', 'Выключить') };
    case 'airfryer': { const s = st(/airfryer_status$/); if (!s || s === 'unavailable') return off(); return { status: s, tone: 'on', active: true, facts: [], action: null }; }
    case 'washer': { const s = st(/washer_current_status$/); if (s && !['unavailable', 'power_off', 'end', 'sleep', 'initial'].includes(s)) return { status: 'Стирает', tone: 'on', active: true, facts: standbyW ? [{ text: standbyW }] : [], action: null }; return { status: s === 'end' ? 'Стирка закончена' : 'Не стирает', tone: 'ok', active: false, facts: [{ text: th.on ? `Розетка вкл.${standbyW ? ` · ${standbyW}` : ''}` : 'Розетка выключена' }], action: null }; }
    case 'dryer': { const s = st(/machine_state$/), r = n(/dryer_remaining$/), drum = n(/drum_clean_due_in$/); const facts: Fact[] = drum !== null ? [{ text: drum <= 1 ? 'Пора почистить барабан' : `Чистка барабана через ${fmt(drum, lang)} цикла`, tone: drum <= 1 ? 'warn' : undefined }] : [];
      return s === 'active' || s === 'run' ? { status: `Сушит${r ? ` · ещё ${fmt(r, lang)} мин` : ''}`, tone: 'on', active: true, facts, action: null } : { status: 'Не сушит', tone: 'ok', active: false, facts, action: null }; }
    case 'camera': return { status: th.available ? 'Пишет' : 'Не в сети', tone: th.available ? 'ok' : 'muted', active: false, facts: [], action: null };
    default: if (!th.available) return off(); return { status: th.on ? 'Включено' : 'Выключено', tone: th.on ? 'on' : 'ok', active: !!th.on, facts: standbyW ? [{ text: standbyW }] : [], action: tog('Включить', 'Выключить') };
  }
}
function Tile({ th, p }: { th: Thing; p: Props }) {
  const x = detail(th, p);
  return <article className={`rm-tile is-${x.tone} ${x.active ? 'is-on' : ''}`} style={`--rm-tint:${TINT[th.kind]}`}>
    <button type="button" className="rm-tile-open" aria-label={`${th.name}: подробнее`} onClick={() => openThing(th, p)} />
    <div className="rm-tile-head"><span className="rm-tile-ic"><Icon name={GLYPH[th.kind]} size={22} /></span><span className="rm-tile-name"><strong>{th.name}</strong><small>{x.status}</small></span></div>
    {x.facts.length > 0 && <ul className="rm-facts">{x.facts.slice(0, 3).map(f => <li className={f.tone === 'warn' ? 'is-warn' : ''}>{f.tone === 'warn' && <Icon name="warning" size={12} />}{f.text}</li>)}</ul>}
    {x.action && <button type="button" className="rm-tile-act" onClick={x.action.run}>{x.action.label}</button>}
  </article>;
}
function LayoutB({ m, p }: { m: RoomModel; p: Props }) {
  const rest = [...m.things.filter(t => t.kind !== 'light' || m.things.filter(x => x.kind === 'light').length > 1), ...m.air];
  return <div className={`rm-page rm-b ${p.wide ? 'is-wide' : ''}`}>
    <div className="rm-b-top"><Hero m={m} p={p} /><Quick m={m} p={p} /></div>
    <div className="rm-b-cols"><div className="rm-b-main"><h2 className="rm-h">Устройства</h2><div className="rm-tile-grid">{rest.map(th => <Tile th={th} p={p} />)}</div></div>
      <div className="rm-b-side"><h2 className="rm-h">Климат и энергия</h2><HeatLine m={m} p={p} /><Power m={m} lang={p.lang} kind="bar" /></div></div>
  </div>;
}

/* ---------- C: list ---------- */
const Group = ({ title, hint, children }: { title: string; hint?: string; children: ComponentChildren }) => <section className="rm-group"><div className="rm-group-head"><h2>{title}</h2>{hint && <small>{hint}</small>}</div><div className="rm-group-body">{children}</div></section>;
function Row({ th, p }: { th: Thing; p: Props }) {
  return <div className={`rm-row ${th.available ? '' : 'is-off'}`}><Glyph th={th} size={18} /><button type="button" className="rm-row-tx" onClick={() => openThing(th, p)}><strong>{th.name}</strong><small>{line(th, p.reg, p.lang)}</small></button>
    {th.power !== null && th.power >= 0.5 && <span className="rm-row-w">{watts(th.power, p.lang)}</span>}<Toggle th={th} p={p} />{!(th.main && p.deviceOf(th.main)) && <Icon name="next" size={16} />}</div>;
}
function LayoutC({ m, p }: { m: RoomModel; p: Props }) {
  const on = m.things.filter(t => t.on), off = m.things.filter(t => !t.on), top = m.consumers[0];
  const today = m.consumers.reduce((s, c) => s + (c.today ?? 0), 0);
  return <div className={`rm-page rm-c ${p.wide ? 'is-wide' : ''}`}>
    <Strip m={m} lang={p.lang} now={p.now} compact />
    {(() => { const climate = (m.heat || m.air.length > 0) && <Group title="Климат"><HeatLine m={m} p={p} />{m.air.map(th => <Row th={th} p={p} />)}</Group>;
      const clean = p.vacuum && m.vacuum?.linked && <Group title="Уборка"><VacButton m={m} p={p} /></Group>;
      const energy = m.total !== null && <Group title="Энергия" hint={today > 0 ? `${fmt(today, p.lang, 2)} кВт·ч сегодня` : undefined}><div className="rm-c-total"><b>{watts(m.total, p.lang)}</b><small>тянет комната сейчас{top && top.power > 0 ? ` · больше всех: ${top.name.toLowerCase()}` : ''}</small></div>
        {m.consumers.slice(0, 3).map(c => <div className="rm-row is-plain"><span className="rm-row-tx"><strong>{c.name}</strong></span><span className="rm-row-w">{watts(c.power, p.lang)}</span></div>)}</Group>;
      const devices = <>{on.length > 0 && <Group title="Работает сейчас">{on.map(th => <Row th={th} p={p} />)}</Group>}{off.length > 0 && <Group title={on.length ? 'Остальное' : 'Устройства'}>{off.map(th => <Row th={th} p={p} />)}</Group>}</>;
      return p.wide ? <div className="rm-c-cols"><div>{climate}{clean}{energy}</div><div>{devices}</div></div> : <div className="rm-c-cols"><div>{climate}{devices}{clean}{energy}</div></div>; })()}
  </div>;
}

export function RoomView(p: Props) {
  const m = readRoom(p.reg, p.roomId, p.roomName, p.heating, p.vacuum, p.now);
  return p.layout === 'b' ? <LayoutB m={m} p={p} /> : p.layout === 'c' ? <LayoutC m={m} p={p} /> : <LayoutA m={m} p={p} />;
}
