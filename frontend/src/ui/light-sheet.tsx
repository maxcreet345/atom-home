import { useEffect, useRef, useState } from 'preact/hooks';
import type { HomeDevice, EntityRef } from '../model/discover.ts';
import type { Runner } from './sheet.tsx';
import type { Host } from '../runtime/host.ts';
import type { Action } from '../runtime/actions.ts';
import type { T, Key } from '../i18n/index.ts';
import { Icon } from './primitives.tsx';
import { Switch } from './cards.tsx';
import { isOn, num, type Lang } from './format.ts';
import { isDimmable, hasColorTemp, hasColor, brightnessPct, kelvinOf, kelvinRange, kelvinColor, LEVELS, TEMP_PRESETS, AMBIENT_COLORS, nearestColor, rgbHex, ambientHex, clampKelvin, SLEEP_MINUTES } from '../model/lights.ts';

type Common = { device: HomeDevice; runner: Runner; t: T; lang: Lang };
/** A light service call for any light entity of the card (the lamp or its ambient light); `serviceCall` maps the id to the HA field. */
const act = (entityId: string, id: string, data?: Record<string, unknown>, service = 'turn_on', kind: Action['kind'] = 'number'): Action => ({ id, label: id, kind, domain: entityId.split('.')[0] || 'light', service, entityId, data, confirm: false, risk: 'normal' });
const effectLabel = (o: string, t: T) => { const k = `mode.${o.toLowerCase().replace(/[\s-]+/g, '_')}` as Key; return t(k) !== k ? t(k) : o; };
const locales: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
/** «18:40» today, «3 нояб., 18:40» earlier. */
const since = (iso: string, lang: Lang) => { const d = new Date(iso); if (!iso || Number.isNaN(d.getTime())) return ''; const now = new Date(), sameDay = d.toDateString() === now.toDateString(); return new Intl.DateTimeFormat(locales[lang], sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d); };

/** Sends a dragged value at most every 150 ms, and always the last one. */
function useThrottled(run: (v: number) => void) {
  const last = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null), pending = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (v: number, final = false) => {
    const now = Date.now();
    if (final || now - last.current >= 150) { last.current = now; pending.current = null; if (timer.current) { clearTimeout(timer.current); timer.current = null; } run(v); return; }
    pending.current = v;
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; if (pending.current !== null) { const x = pending.current; pending.current = null; last.current = Date.now(); run(x); } }, 150 - (now - last.current));
  };
}
/** The tall brightness slider (Apple Home): drag or tap, fill coloured by the light's temperature. */
function VSlider({ pct, on, kelvin, disabled, label, onChange, onCommit }: { pct: number; on: boolean; kelvin: number | null; disabled: boolean; label: string; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null); const [drag, setDrag] = useState(false);
  const at = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return Math.max(1, Math.min(100, Math.round(100 * (1 - (e.clientY - r.top) / r.height)))); };
  const down = (e: PointerEvent) => { if (disabled) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); onChange(at(e)); };
  const move = (e: PointerEvent) => { if (drag) onChange(at(e)); };
  const up = (e: PointerEvent) => { if (!drag) return; setDrag(false); onCommit(at(e)); };
  const key = (e: KeyboardEvent) => { const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 5 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -5 : 0; if (d) { e.preventDefault(); onCommit(Math.max(1, Math.min(100, pct + d))); } };
  return <div ref={ref} className={`at-vs ${on ? 'is-on' : ''} ${drag ? 'is-drag' : ''} ${disabled ? 'is-disabled' : ''}`} role="slider" aria-valuemin={1} aria-valuemax={100} aria-valuenow={on ? pct : 0} aria-label={label} tabIndex={disabled ? -1 : 0} style={`--p:${on ? pct : 0}%;--k:${kelvinColor(kelvin ?? 4000)}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(false)} onKeyDown={key}>
    <div className="at-vs-fill" /><b className="at-vs-pct">{on ? <>{pct}<i> %</i></> : '—'}</b><span className="at-vs-bulb"><Icon name="light" size={26} /></span>
  </div>;
}
/** Colour temperature strip: warm → cold, drag or tap, commits on release. */
function TempStrip({ value, min, max, disabled, label, onCommit }: { value: number; min: number; max: number; disabled: boolean; label: string; onCommit: (k: number) => void }) {
  const ref = useRef<HTMLDivElement>(null); const [draft, setDraft] = useState<number | null>(null);
  const at = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return clampKelvin(min + (max - min) * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), min, max); };
  const k = draft ?? value, x = max > min ? (100 * (k - min) / (max - min)) : 50;
  return <div ref={ref} className={`at-temp-strip ${disabled ? 'is-disabled' : ''}`} role="slider" aria-valuemin={min} aria-valuemax={max} aria-valuenow={k} aria-label={label} tabIndex={disabled ? -1 : 0} style={`--x:${x.toFixed(1)}%`}
    onPointerDown={e => { if (disabled) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDraft(at(e)); }} onPointerMove={e => { if (draft !== null) setDraft(at(e)); }} onPointerUp={e => { if (draft === null) return; const v = at(e); setDraft(null); onCommit(v); }} onPointerCancel={() => setDraft(null)}
    onKeyDown={e => { const d = e.key === 'ArrowRight' ? 100 : e.key === 'ArrowLeft' ? -100 : 0; if (d) { e.preventDefault(); onCommit(clampKelvin(k + d, min, max)); } }}><i /></div>;
}
/** The dimmable lamp: slider, quick levels, temperature with presets, effects, the ambient light. A relay lamp gets the big bulb and the power row instead. */
export function LightBody({ device, runner, t, lang, host, sleepAt }: Common & { host?: Host; sleepAt?: string | null }) {
  const e = device.primary, a = e.attributes, on = isOn(e), avail = e.available;
  const ambient = device.controls.find((c, i) => i > 0 && c.domain === 'light') ?? null;
  const [draft, setDraft] = useState<number | null>(null); // brightness shown while dragging, until HA reports it
  const live = brightnessPct(a) ?? 0;
  useEffect(() => { if (draft !== null && on && Math.abs(live - draft) <= 2) setDraft(null); }, [live, on, draft]);
  useEffect(() => { if (draft === null) return; const id = setTimeout(() => setDraft(null), 2500); return () => clearTimeout(id); }, [draft]);
  if (!isDimmable(a)) return <><RelayHero device={device} runner={runner} t={t} lang={lang} /><SleepRow entityId={e.id} on={on && avail} host={host} sleepAt={sleepAt ?? null} t={t} /></>;
  const pct = draft ?? live, shownOn = on || draft !== null;
  const send = useThrottled(v => void runner.run(device, act(e.id, 'brightness', { transition: 0.3 }), v));
  const k = kelvinOf(a), range = kelvinRange(a), temp = hasColorTemp(a);
  const effects = Array.isArray(a.effect_list) ? a.effect_list.filter((x): x is string => typeof x === 'string') : [], effect = typeof a.effect === 'string' ? a.effect : null;
  const state = !avail ? t('state.unavailable') : shownOn ? [`${pct} %`, temp && k !== null ? `${num(k, lang, 0)}\u00a0K` : null, effect ? effectLabel(effect, t) : null].filter(Boolean).join(' · ') : t('state.off');
  const level = (v: number) => <button type="button" className={`at-light-level ${shownOn && Math.abs(pct - v) <= 2 ? 'is-on' : ''}`} disabled={!avail} onClick={() => { setDraft(v); send(v, true); }}>{v === 1 ? <>{t('light.level.night')}<small>1 %</small></> : `${v} %`}</button>;
  return <div className="at-light-body" data-on={shownOn ? '1' : '0'}>
    <div className="at-light-hero">
      <VSlider pct={pct} on={shownOn} kelvin={k} disabled={!avail} label={t('action.brightness')} onChange={v => { setDraft(v); send(v); }} onCommit={v => { setDraft(v); send(v, true); }} />
      <div className="at-light-side">
        <div className="at-light-state"><b>{avail ? t(shownOn ? 'state.on' : 'state.off') : t('state.unavailable')}</b><small>{state}</small></div>
        <div className="at-light-levels">{LEVELS.map(level)}<button type="button" className="at-light-level is-off" disabled={!avail || !on} onClick={() => { setDraft(null); void runner.run(device, act(e.id, 'off', undefined, 'turn_off', 'button')); }}><Icon name="power" size={16} /><span className="at-long">{t('ui.turnOff')}</span><span className="at-short">{t('mode.off')}</span></button></div>
      </div>
    </div>
    {(temp || effects.length > 0 || ambient) && <div className="at-light-right">
      {(temp || effects.length > 0) && <div className="at-light-temp">
        {temp && <><small className="at-light-title">{t('light.temp')}<b>{k === null ? '—' : `${num(k, lang, 0)}\u00a0K`}</b></small>
          <TempStrip value={k ?? Math.round((range.min + range.max) / 2)} min={range.min} max={range.max} disabled={!avail} label={t('light.temp')} onCommit={v => void runner.run(device, act(e.id, 'color_temp'), v)} />
          <div className="at-temp-presets">{TEMP_PRESETS.filter(p => p.k >= range.min && p.k <= range.max).map(p => <button type="button" className={`at-temp-preset ${k !== null && Math.abs(k - p.k) < 150 ? 'is-on' : ''}`} disabled={!avail} onClick={() => void runner.run(device, act(e.id, 'color_temp'), p.k)}>{t(`light.preset.${p.key}` as Key)}<small>{p.k}</small></button>)}</div></>}
        {effects.length > 0 && <><small className="at-light-title">{t('action.effect')}</small><div className="at-light-seg" role="radiogroup" aria-label={t('action.effect')}>{effects.map(o => <button type="button" role="radio" aria-checked={effect === o} className={effect === o ? 'is-on' : ''} disabled={!avail} onClick={() => void runner.run(device, act(e.id, 'effect', undefined, 'turn_on', 'select'), o)}>{effectLabel(o, t)}</button>)}</div></>}
      </div>}
      {ambient && <AmbientRows device={device} ambient={ambient} runner={runner} t={t} lang={lang} />}
    </div>}
    <SleepRow entityId={e.id} on={on && avail} host={host} sleepAt={sleepAt ?? null} t={t} />
  </div>;
}
/** The lamp's ambient light: switch, six colours and white tones, its own brightness. */
function AmbientRows({ device, ambient, runner, t, lang }: Common & { ambient: EntityRef }) {
  const a = ambient.attributes, on = isOn(ambient), avail = ambient.available, pct = brightnessPct(a) ?? 0, cur = nearestColor(a.rgb_color), hex = ambientHex(a), k = kelvinOf(a), range = kelvinRange(a);
  const colour = cur ? t(`light.color.${cur}` as Key) : k !== null && !Array.isArray(a.rgb_color) ? (k <= 3500 ? t('light.white.warm') : t('light.white.cold')) : '';
  return <div className="ah-rows at-amb">
    <div className="ah-row"><span className="ah-row-icon" style={`--tile:${on && avail ? hex : '#8e8e93'}`}><Icon name="sun" size={18} /></span><span className="ah-row-text"><strong>{t('light.ambient')}</strong><small>{!avail ? t('state.unavailable') : on ? [colour, `${pct} %`].filter(Boolean).join(' · ') : t('state.off')}</small></span>
      <Switch on={on} disabled={!avail} label={t('light.ambient')} onToggle={() => void runner.run(device, act(ambient.id, 'toggle', undefined, 'toggle', 'toggle'), !on)} /></div>
    {on && avail && <div className="ah-row at-amb-row">
      <div className="at-amb-colors">
        {hasColor(a) && AMBIENT_COLORS.map(c => <button type="button" className={`at-amb-dot ${cur === c.key ? 'is-on' : ''}`} style={`--c:${rgbHex(c.rgb)}`} aria-label={t(`light.color.${c.key}` as Key)} onClick={() => void runner.run(device, act(ambient.id, 'color', undefined, 'turn_on', 'select'), c.rgb)} />)}
        {hasColorTemp(a) && <><button type="button" className={`at-amb-dot is-white ${!cur && k !== null && k <= 3500 ? 'is-on' : ''}`} style={`--c:${kelvinColor(2700)}`} aria-label={t('light.white.warm')} onClick={() => void runner.run(device, act(ambient.id, 'color_temp'), clampKelvin(2700, range.min, range.max))} /><button type="button" className={`at-amb-dot is-white ${!cur && k !== null && k > 3500 ? 'is-on' : ''}`} style={`--c:${kelvinColor(6000)}`} aria-label={t('light.white.cold')} onClick={() => void runner.run(device, act(ambient.id, 'color_temp'), clampKelvin(6000, range.min, range.max))} /></>}
      </div>
      {isDimmable(a) && <input type="range" className="at-amb-range" min={1} max={100} step={1} value={pct} aria-label={`${t('light.ambient')} · ${t('action.brightness')}`} style={`--c:${hex}`} onChange={ev => void runner.run(device, act(ambient.id, 'brightness', { transition: 0.3 }), Number((ev.target as HTMLInputElement).value))} />}
    </div>}
  </div>;
}
/** «Выключить через 15/30/60»: the integration keeps the timer and switches the lamp off; the pending time comes back through the mirror text. */
function SleepRow({ entityId, on, host, sleepAt, t }: { entityId: string; on: boolean; host?: Host; sleepAt: string | null; t: T }) {
  const ws = host?.ws; if (!ws) return null;
  const [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const set = async (minutes: number) => { if (busy) return; setBusy(true); setNote(''); try { await ws({ type: 'atom_home/light/sleep', entity_id: entityId, minutes }); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } };
  return <div className="ah-group at-sleep" data-sleep={sleepAt ?? ''}>
    <small className="ah-group-title">{t('light.sleep')}</small>
    {sleepAt ? <div className="at-sleep-at"><Icon name="clock" size={18} /><strong>{t('light.sleepAt', { time: sleepAt })}</strong><button type="button" className="hm-pill" disabled={busy} onClick={() => void set(0)}>{t('light.sleepCancel')}</button></div>
      : <div className="hm-chips at-sleep-chips">{SLEEP_MINUTES.map(m => <button type="button" className="hm-pill" disabled={busy || !on} onClick={() => void set(m)}>{m} {t('ui.min')}</button>)}</div>}
    {note && <small className="at-sleep-note">{note}</small>}
  </div>;
}
/** A relay lamp: the big bulb with its bloom, when it was switched, one power row. */
function RelayHero({ device, runner, t, lang }: Common) {
  const e = device.primary, on = isOn(e), avail = e.available, busy = runner.busy.has(device.key), at = since(e.lastChanged, lang);
  return <>
    <div className={`ah-hero at-relay-hero ${on && avail ? 'is-on' : ''}`}><span className={`ah-hero-glyph at-relay-glyph ${on && avail ? 'is-on' : ''}`}><Icon name="light" size={44} /></span>
      <div className="ah-hero-main"><b>{!avail ? t('state.unavailable') : t(on ? 'state.on' : 'state.off')}</b><small>{[avail && at ? t('light.since', { time: at }) : null, device.model ?? t('light.relay')].filter(Boolean).join(' · ')}</small></div></div>
    <button type="button" className={`ah-power ${on ? 'is-on' : ''}`} disabled={busy || !avail} onClick={() => void runner.run(device, act(e.id, 'toggle', undefined, 'toggle', 'toggle'), !on)}><span className="ah-power-icon"><Icon name="power" size={22} /></span><strong>{on ? t('ui.turnOff') : t('ui.turnOn')}</strong></button>
  </>;
}
