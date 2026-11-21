/* The humidifier family sheet (types.ts), drawn after the Mi Home screen of Xiaomi Smart Humidifier 2 in the panel's style (the kettle's
 * hero and cards, src/modules/kettle.tsx): the room's humidity big, what it is doing and the power button; «Нет воды» / «Бак снят» as a warning
 * right under it; the target humidity with − / +; Mi Home's four modes (three strengths and «Авто» = constant humidity); the indicator and
 * the beep; the readings. It reads and drives only the entities bound to its instance (`view.instance.bindings`). */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ApplianceSheetProps, ApplianceUi } from './types.ts';
import { readHumidifier, levelWord, statusText } from './humidifier.profiles.ts';
import { useRun, HOLD_MS } from '../modules/kettle.tsx';
import { Icon } from '../ui/primitives.tsx';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';

const hk = (t: T, k: string, p?: Record<string, string | number>) => t(`hu.${k}` as Key, p);
type Step = [string, string, Record<string, unknown>];
/** a burst of − / + taps is one intent: one command goes out this long after the last tap */
export const STEP_SEND_MS = 600;

/** Our own drawing of the humidifier (a white column with its mist), the fallback of the product photo. */
export function HumidifierArt({ on }: { on: boolean }) {
  return <svg className={`at-hu-art ${on ? 'is-on' : ''}`} viewBox="0 0 120 120" aria-hidden="true">
    {on && <g className="at-hu-mist"><path d="M52 24c-6-5 4-9-1-15" /><path d="M62 22c-6-5 4-9-1-15" /><path d="M72 24c-6-5 4-9-1-15" /></g>}
    <ellipse cx="62" cy="110" rx="30" ry="4" className="at-hu-shadow" />
    <path d="M38 38q24-10 48 0v62q-24 8-48 0z" className="at-hu-body" />
    <ellipse cx="62" cy="38" rx="24" ry="6" className="at-hu-top" />
    <path d="M40 74q22 7 44 0v24q-22 7-44 0z" className="at-hu-water" />
    <circle cx="62" cy="56" r="3" className="at-hu-dot" />
  </svg>;
}
function Wave() { return <svg className="at-kt-wave" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22C80 4 160 4 220 12s120 20 180 6V40H0z" className="is-back" /><path d="M0 30C90 14 170 16 240 24s110 14 160 2V40H0z" className="is-front" /></svg>; }

function HumidifierSheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const B = view.instance.bindings, h = readHumidifier(registry, B, host.online), ui = useRun(host, t), photo = usePhoto(B.humidifier);
  const live = h.available && host.online;
  useEffect(() => { ui.seen(); }, [h.phase, h.level, h.buzzer, h.light]); // the humidifier answered: the button that waited for it is free again
  // the target humidity: the device's own value until the person steps it; a burst of taps sends one command when the taps stop
  const [draft, setDraft] = useState<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), pending = useRef<number | null>(null), hostRef = useRef(host); hostRef.current = host;
  const send = async () => {
    if (ui.running()) { timer.current = setTimeout(() => void send(), 300); return; } // another command of this sheet is on its way: wait, do not lose the choice
    timer.current = null; const value = pending.current; pending.current = null; if (value === null || !B.humidifier) return;
    const ok = await ui.run('target', [['humidifier', 'set_humidity', { entity_id: B.humidifier, humidity: value }]]);
    if (ok) setTimeout(() => setDraft(d => d === value ? null : d), 5000); else setDraft(null);
  };
  const stepTo = (v: number) => { if (!live) return; setDraft(v); pending.current = v; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void send(), STEP_SEND_MS); };
  // a sheet closed before the pause ended still sends what the person chose (only while the house answers)
  useEffect(() => () => { if (!timer.current) return; clearTimeout(timer.current); const v = pending.current, id = B.humidifier; if (v !== null && id && hostRef.current.online) void hostRef.current.call('humidifier', 'set_humidity', { entity_id: id, humidity: v }).catch(() => undefined); }, []);
  useEffect(() => { if (!live && timer.current) { clearTimeout(timer.current); timer.current = null; pending.current = null; setDraft(null); } }, [live]); // gone mid-burst: nothing is sent later
  const target = draft ?? h.target;
  const [ask, setAsk] = useState(false);
  const run = (key: string, steps: Step[]) => void ui.run(key, steps, HOLD_MS);
  const power = () => { if (!B.humidifier) return; run('power', [['humidifier', h.phase === 'on' ? 'turn_off' : 'turn_on', { entity_id: B.humidifier }]]); };
  const plugOn = () => { setAsk(false); if (B.plug) run('plug', [['switch', 'turn_on', { entity_id: B.plug }]]); };
  const pct = (v: number | null) => v === null ? '—' : num(v, lang, 0);
  const status = statusText(h, t, lang), on = h.phase === 'on', idle = h.phase !== 'on' && h.phase !== 'off';
  const hero = <section className={`at-kt-hero at-hu-hero is-${on ? 'on' : h.phase === 'off' ? 'idle' : 'off'}`}>
    <small>{hk(t, 'inRoom')}</small>
    <p className={`at-kt-temp at-hu-num ${h.current === null ? 'is-none' : ''}`}><b>{pct(h.current)}</b>{h.current !== null && <i>%</i>}</p>
    <p className="at-kt-status" role="status">{status}</p>
    {(h.phase === 'on' || h.phase === 'off') && B.humidifier && <button type="button" className="hm-pill at-kt-stop at-hu-power" data-action="power" aria-busy={ui.busy === 'power'} disabled={!host.online || ui.busy !== null} onClick={power}><Icon name="power" size={18} />{on ? hk(t, 'turnOff') : hk(t, 'turnOn')}</button>}
    {h.phase === 'plugOff' && B.plug && !ask && <button type="button" className="hm-pill at-kt-stop at-hu-power" data-action="plug-on" disabled={!host.online || ui.busy !== null} onClick={() => setAsk(true)}><Icon name="socket" size={18} />{hk(t, 'plugOn')}</button>}
    {h.phase === 'plugOff' && ask && <div className="at-hu-ask" role="alertdialog" aria-label={hk(t, 'plugOn')}><p>{hk(t, 'plugAsk')}</p><div><button type="button" className="hm-pill at-kt-stop" data-action="plug-yes" disabled={!host.online || ui.busy !== null} onClick={plugOn}>{hk(t, 'yes')}</button><button type="button" className="hm-pill at-kt-stop is-quiet" onClick={() => setAsk(false)}>{hk(t, 'cancel')}</button></div></div>}
    <Wave />
  </section>;
  const warn = h.tankOut ? ['tankOut', hk(t, 'tankOut'), hk(t, 'tankOutText')] : h.noWater ? ['noWater', hk(t, 'noWater'), hk(t, 'noWaterText')] : h.fault ? ['fault', hk(t, 'fault'), h.fault] : null;
  const warning = warn && <div className="at-hu-warn" role="alert" data-warn={warn[0]}><span className="at-hu-warn-ico" aria-hidden="true"><Icon name={warn[0] === 'fault' ? 'warning' : 'water'} size={22} /></span><span><b>{warn[1]}</b><small>{warn[2]}</small></span></div>;
  const auto = h.level === 'auto';
  const stuck = !live || target === null;
  const targetCard = B.humidifier && <div className="at-kt-card at-hu-card" data-part="target"><h3>{hk(t, 'target')}</h3>
    <div className="at-hu-target">
      <div className="at-kt-stepper" role="group" aria-label={hk(t, 'target')}>
        <button type="button" className="hm-round" data-step="-1" aria-label={hk(t, 'lower')} disabled={stuck || target! <= h.min} onClick={() => stepTo(Math.max(h.min, target! - h.step))}>−</button>
        <b aria-live="polite">{stuck ? '—' : <>{num(target, lang, 0)}<i>%</i></>}</b>
        <button type="button" className="hm-round" data-step="1" aria-label={hk(t, 'raise')} disabled={stuck || target! >= h.max} onClick={() => stepTo(Math.min(h.max, target! + h.step))}>+</button>
      </div>
      {live && <small className="at-kt-note">{auto || !h.levels.length ? hk(t, 'targetAuto') : hk(t, 'targetLevel')}</small>}
    </div></div>;
  const modeCard = B.fanLevel && h.levels.length > 0 && <div className="at-kt-card at-hu-card" data-part="mode"><h3>{hk(t, 'mode')}</h3>
    <div className="at-hu-modes" role="group" aria-label={hk(t, 'mode')}>{h.levels.map(l => { const active = h.level === l.level; return <button type="button" className={`at-hu-mode ${active ? 'is-on' : ''}`} data-level={String(l.level)} aria-pressed={live ? active : undefined} disabled={!live || ui.busy !== null} onClick={() => { if (!active) run('mode', [['select', 'select_option', { entity_id: B.fanLevel, option: l.option }]]); }}><span className="at-hu-mode-glyph" aria-hidden="true">{l.level === 'auto' ? <Icon name="water" size={20} /> : <Bars n={l.level} />}</span><span>{levelWord(t, l.level)}</span></button>; })}</div>
    {live && <small className="at-kt-note at-hu-pad">{hk(t, 'modeAuto')}</small>}</div>;
  const sw = (role: 'indicator' | 'buzzer', value: boolean | null, label: string, hint: string) => { const id = B[role]; if (!id) return null; const domain = id.split('.')[0];
    return <div className="ah-row hm-setting at-kt-row" data-hu-switch={role}><span className="ah-row-text"><strong>{label}</strong><small>{hint}</small></span>{value === null ? <small>{t(live ? 'state.unknown' : 'state.unavailable')}</small> : <button type="button" role="switch" className={`at-kt-sw ${value ? 'is-on' : ''}`} aria-checked={value} aria-label={label} aria-busy={ui.busy === role} disabled={!live || ui.busy !== null} onClick={() => run(role, [[domain, value ? 'turn_off' : 'turn_on', { entity_id: id }]])}><i /></button>}</div>; };
  const settings = (B.indicator || B.buzzer) && <div className="at-kt-card at-kt-set at-hu-card" data-part="settings"><h3>{hk(t, 'settings')}</h3>{sw('indicator', h.light, hk(t, 'light'), hk(t, 'lightHint'))}{sw('buzzer', h.buzzer, hk(t, 'sound'), hk(t, 'soundHint'))}</div>;
  const facts = [h.temperature !== null ? [hk(t, 'temperature'), `${num(h.temperature, lang, 1)} °C`] : null, h.watts !== null ? [hk(t, 'power'), hk(t, 'watts', { w: num(h.watts, lang, 0) })] : null].filter((x): x is string[] => !!x);
  const readings = facts.length > 0 && <div className="at-kt-card at-hu-card" data-part="readings"><h3>{hk(t, 'readings')}</h3>{facts.map(([k, v]) => <div className="ah-row hm-setting at-kt-row"><span className="ah-row-text"><strong>{k}</strong></span><small className="at-hu-val">{v}</small></div>)}</div>;
  return <div className={`at-kt-sheet at-hu-sheet ${idle ? 'is-idle' : ''}`} data-wide={wide || undefined} data-phase={h.phase}>
    <div className="hm-sheet-head at-kt-head"><span className="at-kt-face" aria-hidden="true"><ProductPhoto src={photo} eager><HumidifierArt on={on} /></ProductPhoto></span><div><small>{[t('cat.kind.humidifier' as Key), room].filter(Boolean).join(' · ')}</small><h2>{view.device.name || hk(t, 'title')}</h2></div>
      <button type="button" className="hm-icon-btn at-hu-close" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>
    {ui.err && <p className="at-kt-err" role="alert">{hk(t, 'fail')}: {ui.err}</p>}
    <div className="at-kt-cols"><div className="at-kt-col">{hero}{warning}</div><div className="at-kt-col">{targetCard}{modeCard}{settings}{readings}</div></div>
  </div>;
}
function Bars({ n }: { n: number }) {
  return <svg width="20" height="20" viewBox="0 0 20 20">{[0, 1, 2].map(i => <rect x={3 + i * 5.5} y={13 - i * 4} width="3.5" height={4 + i * 4} rx="1.2" className={i < n ? 'is-lit' : ''} />)}</svg>;
}
export const ui: ApplianceUi = { id: 'humidifier', Sheet: HumidifierSheet };
