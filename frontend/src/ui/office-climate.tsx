import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from './format.ts';
import { Icon } from './primitives.tsx';
import { Err, Glyph, Stepper, useAct, useStepper } from './heating.tsx';
import type { HeatTone } from '../model/heating.ts';
import { officeHeating, officeTone, type OfficeClimate, type OfficeMode, type OfficeZone } from '../model/office-climate.ts';
/** The Climate card and panel of a working building heated by air conditioners (mock for the owner, 09.11.2026, atom-okapi/HEATING.md).
 * The Heating card's family: a warm tile with a little air conditioner and one sentence, a panel with the hero, today's plan, the zones and the modes.
 * Nobody sets a zone: the modes come from the alarm and the work calendar; an admin can change the three temperatures. */
const tk = (t: T, k: string, p?: Record<string, string | number>) => t(`module.oc.${k}` as Key, p);
const LOC: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
const setT = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(LOC[lang], { maximumFractionDigits: 1 });
const nowT = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(LOC[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const MOON = 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z', DAYOFF = 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 14l6 4M15 14l-6 4';
function ModeGlyph({ m, size = 15 }: { m: OfficeMode; size?: number }) { return m === 'work' ? <Icon name="sun" size={size} /> : <Glyph d={m === 'duty' ? MOON : DAYOFF} size={size} />; }
/** «в 17:30», «завтра в 08:59», «в пн в 08:59» */
function when(ms: number, now: number, t: T, lang: Lang) {
  const a = new Date(now); a.setHours(0, 0, 0, 0); const days = Math.floor((ms - a.getTime()) / 86400000);
  if (days <= 0) return tk(t, 'atToday', { at: hhmm(ms) });
  if (days === 1) return tk(t, 'atTomorrow', { at: hhmm(ms) });
  return tk(t, 'atDay', { d: new Date(ms).toLocaleDateString(LOC[lang], { weekday: 'short' }), at: hhmm(ms) });
}
function sentence(c: OfficeClimate, t: T): string {
  if (!c.modeKnown) return tk(t, 'noMode');
  const lost = c.zones.filter(z => z.action === 'offline');
  if (lost.length) return tk(t, 'noLink', { z: lost.map(z => z.name).join(', ') });
  const acLost = c.zones.filter(z => !z.ac.online);
  if (acLost.length) return tk(t, 'acLost', { z: acLost.map(z => z.name).join(', ') });
  const heat = c.zones.filter(z => z.action === 'heating');
  if (!heat.length) return tk(t, 'warmAll');
  if (heat.length === c.zones.length) return tk(t, 'heatAll');
  return tk(t, 'heatSome', { z: heat.map(z => z.name).join(', ') });
}
/** Only an admin sees the standby temperatures (owner, 09.11.2026): everyone sees the working target, the rest only the mode's name. */
export const seesTemp = (m: OfficeMode, admin: boolean) => admin || m === 'work';
function nextLine(c: OfficeClimate, t: T, lang: Lang, now: number, admin: boolean): string {
  if (!c.next) return '';
  const w = when(c.next.at, now, t, lang);
  if (c.next.mode === 'work') return tk(t, 'nextWork', { when: w, v: setT(c.next.temp, lang) });
  return seesTemp(c.next.mode, admin) ? tk(t, 'nextTemp', { when: w, v: setT(c.next.temp, lang) }) : tk(t, 'nextMode', { when: w, m: tk(t, `mode.${c.next.mode}`).toLowerCase() });
}
function caption(c: OfficeClimate, t: T, lang: Lang, now: number, admin: boolean): string {
  const n = nextLine(c, t, lang, now, admin);
  return n ? `${tk(t, `mode.${c.mode}`)} · ${n}` : tk(t, `mode.${c.mode}`);
}
/** The target, or the mode's name where its temperature is not this viewer's to see. */
function BigTarget({ c, t, lang, admin, hero }: { c: OfficeClimate; t: T; lang: Lang; admin: boolean; hero?: boolean }) {
  return seesTemp(c.mode, admin) ? <b className={`at-oc-big ${hero ? 'is-hero' : ''}`}>{setT(c.target, lang)}<i>°</i></b> : <b className={`at-oc-word ${hero ? 'is-hero' : ''}`}>{tk(t, 'standbyWord')}</b>;
}
/** The building's little air conditioner: warm air flows while a zone heats, calm when warm, worried when something is wrong. */
export function AcBuddy({ tone }: { tone: HeatTone }) {
  return <svg className={`at-heat-buddy at-oc-buddy is-${tone}`} viewBox="0 0 124 104" aria-hidden="true">
    <rect x="10" y="18" width="104" height="46" rx="14" className="at-heat-fin" />
    <rect x="22" y="52" width="80" height="6" rx="3" className="at-heat-pipe" />
    {tone === 'heat' && <g className="at-heat-waves" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M38 70c-5 5 5 9 0 15" /><path d="M62 70c-5 5 5 9 0 15" /><path d="M86 70c-5 5 5 9 0 15" /></g>}
    {tone === 'off' && <g className="at-heat-zz" fill="currentColor" font-size="15" font-weight="700"><text x="96" y="14">z</text><text x="108" y="6" font-size="11">z</text></g>}
    {tone === 'warn' ? <g fill="#2b3a44"><ellipse cx="50" cy="36" rx="4.5" ry="5.5" /><ellipse cx="74" cy="36" rx="4.5" ry="5.5" /><path d="M42 26l11 3M82 26l-11 3" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /></g>
      : tone === 'off' ? <path d="M44 37q5 4 10 0M70 37q5 4 10 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />
      : <path d="M44 38q6-7 12 0M68 38q6-7 12 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />}
    {tone !== 'off' && <><ellipse cx="40" cy="45" rx="5.5" ry="3.4" fill="#ff6f5a" opacity=".4" /><ellipse cx="84" cy="45" rx="5.5" ry="3.4" fill="#ff6f5a" opacity=".4" /></>}
    {tone === 'warn' ? <path d="M56 49q6-4 12 0" fill="none" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /> : <path d="M56 45q6 5 12 0" fill="none" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" />}
  </svg>;
}
const zoneWord = (z: OfficeZone, t: T) => tk(t, `z.${z.action}`);
function ModePill({ m, t }: { m: OfficeMode; t: T }) { return <span className={`at-oc-pill is-${m}`}><ModeGlyph m={m} />{tk(t, `mode.${m}`)}</span>; }
function Chip({ z, t, lang }: { z: OfficeZone; t: T; lang: Lang }) {
  return <li className={`at-heat-chip is-${z.action === 'off' ? 'off' : z.action}`} aria-label={`${z.name}: ${nowT(z.current, lang)}°, ${zoneWord(z, t)}`}>
    <span className="at-heat-chip-dot" aria-hidden="true">{z.action === 'offline' ? '!' : <Icon name="flame" size={13} />}</span>
    <b>{z.action === 'offline' ? '—' : <>{nowT(z.current, lang)}<i>°</i></>}</b><small>{z.name}</small>
  </li>;
}
export function OfficeClimateTile({ c, host, t, lang, onOpen, now }: { c: OfficeClimate; host: Host; t: T; lang: Lang; onOpen: () => void; now: number }) {
  const tone = officeTone(c), admin = host.admin;
  return <div className={`ah-tile hm-card at-heat-tile at-oc-tile hz-${tone}`} data-mode={c.mode}>
    <button type="button" className="at-heat-open" aria-label={`${tk(t, 'title')}: ${sentence(c, t)}. ${tk(t, 'open')}`} onClick={onOpen} />
    <span className="at-heat-tile-buddy"><AcBuddy tone={tone} /></span>
    <div className="at-heat-tile-head"><strong>{tk(t, 'title')}</strong><small>{sentence(c, t)}</small></div>
    <div className="at-heat-tile-mid">
      <ModePill m={c.mode} t={t} />
      <BigTarget c={c} t={t} lang={lang} admin={admin} />
      <small className="at-heat-cap">{nextLine(c, t, lang, now, admin)}</small>
    </div>
    <ul className="at-heat-chips">{c.zones.map(z => <Chip z={z} t={t} lang={lang} />)}</ul>
  </div>;
}
/* ---------- the panel ---------- */
/** Today as the automation runs it: duty → work (from the calendar, after the alarm is off) → duty; a day off: low until 23:00, then duty. */
function DayPlan({ c, t, lang, now, admin }: { c: OfficeClimate; t: T; lang: Lang; now: number; admin: boolean }) {
  const d0 = c.day[0].from, span = 86400000, pct = (ms: number) => `${Math.max(0, Math.min(100, (ms - d0) / span * 100))}%`;
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'today')}</h2><small className="at-heat-sec-hint">{c.work ? tk(t, 'workDay', { from: hhmm(c.work.start), to: hhmm(c.work.end), stop: hhmm(c.work.heatEnd) }) : tk(t, 'dayOff')}</small></div>
    <article className="at-oc-plan">
      <div className="at-oc-track" role="img" aria-label={c.day.map(x => `${hhmm(x.from)}–${x.to - d0 >= span ? '24:00' : hhmm(x.to)} ${tk(t, `mode.${x.mode}`)}${seesTemp(x.mode, admin) ? ` ${setT(x.temp, lang)}°` : ''}`).join('; ')}>
        {c.day.map(x => <span className={`at-oc-seg is-${x.mode} ${now >= x.from && now < x.to ? 'is-now' : ''} ${x.to - x.from < 3 * 3600000 ? 'is-narrow' : ''}`} style={`left:${pct(x.from)};width:calc(${pct(x.to)} - ${pct(x.from)})`}>{seesTemp(x.mode, admin) && <b>{setT(x.temp, lang)}°</b>}<small>{tk(t, `mode.${x.mode}`)}</small></span>)}
        <i className="at-oc-now" style={`left:${pct(now)}`} aria-hidden="true"><em>{hhmm(now)}</em></i>
      </div>
      <div className="at-oc-ticks" aria-hidden="true">{c.day.slice(1).map(x => <span style={`left:${pct(x.from)}`}>{hhmm(x.from)}</span>)}<span style="left:0">00:00</span><span style="left:100%">24:00</span></div>
      {c.mode === 'duty' && c.work && now < c.work.start && <p className="at-oc-note"><Icon name="shield" size={15} />{tk(t, 'waitAlarm')}</p>}
    </article></section>;
}
function ZoneCard({ z, c, t, lang, admin }: { z: OfficeZone; c: OfficeClimate; t: T; lang: Lang; admin: boolean }) {
  const gap = z.current !== null && z.target !== null ? z.target - z.current : null;
  const fill = z.current === null || z.target === null ? 0 : Math.max(4, Math.min(100, 100 - Math.max(0, z.target - z.current) / 6 * 100));
  const ac = z.ac, heatsNow = ac.online && ac.mode !== 'off' && ac.mode !== null, acLine = !ac.entity ? tk(t, 'acNone') : !ac.online ? tk(t, 'acOffline') : !heatsNow ? tk(t, 'acOff') : tk(t, 'acHeating');
  return <article className={`at-heat-room is-${z.action}`} aria-label={z.name}>
    <header><strong>{z.name}</strong><span className={`at-heat-badge is-${z.action}`}>{z.action === 'heating' && <i className="at-heat-badge-wave" aria-hidden="true" />}{zoneWord(z, t)}</span></header>
    <div className="at-heat-room-nums">
      <div className="at-heat-now"><b>{z.action === 'offline' ? '—' : <>{nowT(z.current, lang)}<i>°</i></>}</b><small>{tk(t, 'inZone')}</small></div>
      <div className="at-heat-set"><small>{seesTemp(c.mode, admin) ? tk(t, 'target', { m: tk(t, `mode.${c.mode}`).toLowerCase() }) : tk(t, 'targetHidden')}</small>{seesTemp(c.mode, admin) ? <b className="at-oc-target">{setT(z.target, lang)}<i>°</i></b> : <b className="at-heat-set is-muted at-oc-target">{tk(t, 'standbyWord')}</b>}</div>
    </div>
    <div className="at-heat-bar" aria-hidden="true"><i style={`width:${fill}%`} /></div>
    <p className="at-heat-room-line">{z.action === 'offline' ? tk(t, 'offlineLine') : seesTemp(c.mode, admin) && gap !== null && gap > 0.05 && z.action === 'heating' ? tk(t, 'gapLine', { d: setT(Math.round(gap * 10) / 10, lang) }) : z.action === 'heating' ? tk(t, 'heatLine') : tk(t, 'idleLine')}</p>
    <div className={`at-oc-ac ${ac.online && ac.mode === 'heat' ? 'is-on' : ''}`}>
      <span className="at-oc-ac-name"><Icon name="climate" size={16} />{acLine}</span>{heatsNow && ac.setpoint !== null && <span className="at-oc-ac-name">{tk(t, 'acSet', { v: setT(ac.setpoint, lang) })}</span>}
      {ac.reading !== null && <span>{tk(t, 'acSees', { v: nowT(ac.reading, lang) })}</span>}
      {ac.power !== null && ac.power > 0 && <span><Icon name="bolt" size={14} />{ac.power >= 1000 ? `${(ac.power / 1000).toLocaleString(LOC[lang], { maximumFractionDigits: 1 })} ${tk(t, 'kw')}` : `${Math.round(ac.power)} ${tk(t, 'w')}`}</span>}
    </div>
    <footer>{z.humidity !== null && <span><Icon name="water" size={14} />{tk(t, 'humidity', { v: Math.round(z.humidity) })}</span>}<span><Icon name="thermo" size={14} />{tk(t, 'sensorNote')}</span></footer>
  </article>;
}
function ModeCard({ m, c, host, t, lang, ui }: { m: OfficeMode; c: OfficeClimate; host: Host; t: T; lang: Lang; ui: ReturnType<typeof useAct> }) {
  const send = (v: number) => host.call('input_number', 'set_value', { entity_id: c.helpers[m], value: v });
  const st = useStepper(c.temps[m], send, () => ui.fail(`mode:${m}`), ui.ok, 5, 25);
  const isNow = c.mode === m;
  return <div className={`at-heat-scen-card at-oc-mode is-${m} ${isNow ? 'is-now' : ''}`}>
    <span className="at-heat-scen-top"><strong><ModeGlyph m={m} />{tk(t, `mode.${m}`)}</strong>{isNow && <em>{tk(t, 'now')}</em>}</span>
    <small>{tk(t, `rule.${m}`)}</small>
    {host.admin ? <Stepper value={st.shown} text={setT(st.shown, lang)} onStep={st.step} t={t} size="small" label={`${tk(t, `mode.${m}`)}: ${tk(t, 'temp')}`} atMin={st.atMin} atMax={st.atMax} pending={st.pending} />
      : <b className="at-oc-target">{setT(c.temps[m], lang)}<i>°</i></b>}
    <Err text={ui.err(`mode:${m}`)} />
  </div>;
}
export function OfficeClimatePanel({ c, host, t, lang, now }: { c: OfficeClimate; host: Host; t: T; lang: Lang; now: number }) {
  const tone = officeTone(c), ui = useAct(t), heating = officeHeating(c), admin = host.admin;
  const out = c.outdoor.temp !== null ? tk(t, 'outside', { v: setT(Math.round(c.outdoor.temp) || 0, lang).replace('-', '−') }) : '';
  const power = c.zones.reduce((a, z) => a + (z.ac.power ?? 0), 0);
  return <div className="at-heat-panel at-oc-panel">
    <section className={`at-heat-hero hz-${tone}`} aria-label={tk(t, 'title')}>
      <div className="at-heat-hero-text"><h2>{tk(t, 'title')}</h2>{out && <small>{out}</small>}<p className="at-heat-hero-say">{sentence(c, t)}</p></div>
      <span className="at-heat-hero-buddy"><AcBuddy tone={tone} /></span>
      <div className="at-heat-hero-ctl">
        <div className="at-heat-hero-temp"><BigTarget c={c} t={t} lang={lang} admin={admin} hero /><small className="at-heat-cap">{caption(c, t, lang, now, admin)}</small></div>
        <ul className="at-heat-hero-facts">
          <li className={c.armed ? 'is-warn' : ''}><Icon name="shield" size={15} />{c.armed === null ? tk(t, 'f.alarmUnknown') : c.armed ? tk(t, 'f.armed') : tk(t, 'f.disarmed')}</li>
          <li><Icon name="clock" size={15} />{c.work ? tk(t, 'f.work', { from: hhmm(c.work.start), stop: hhmm(c.work.heatEnd) }) : c.nextWork ? tk(t, 'f.nextWork', { when: when(c.nextWork, now, t, lang) }) : tk(t, 'f.noWork')}</li>
          <li className={heating ? 'is-hot' : ''}><Icon name="flame" size={15} />{heating ? power <= 0 ? tk(t, 'f.heatingN', { n: heating, total: c.zones.length }) : tk(t, 'f.heating', { n: heating, total: c.zones.length, p: power >= 1000 ? `${(power / 1000).toLocaleString(LOC[lang], { maximumFractionDigits: 1 })} ${tk(t, 'kw')}` : `${Math.round(power)} ${tk(t, 'w')}` }) : tk(t, 'f.rest')}</li>
        </ul>
        <div className="at-heat-hero-side"><ModePill m={c.mode} t={t} /><small className="at-heat-modehint">{tk(t, 'autoHint')}</small></div>
      </div>
    </section>
    <DayPlan c={c} t={t} lang={lang} now={now} admin={admin} />
    <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'zones')}</h2><small className="at-heat-sec-hint">{tk(t, 'zonesHint')}</small></div>
      <div className="at-heat-rooms">{c.zones.map(z => <ZoneCard z={z} c={c} t={t} lang={lang} admin={admin} />)}</div></section>
    {admin ? <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'modes')}</h2><small className="at-heat-sec-hint">{tk(t, 'modesAdmin')}</small></div>
      <div className="at-heat-scen at-oc-modes">{(['work', 'duty', 'dayoff'] as const).map(m => <ModeCard m={m} c={c} host={host} t={t} lang={lang} ui={ui} />)}</div>
      <p className="at-oc-note"><Icon name="lock" size={15} />{tk(t, 'locked')}</p></section>
      : <p className="at-oc-note"><Icon name="lock" size={15} />{tk(t, 'locked')}</p>}
  </div>;
}
