import { useEffect, useRef, useState } from 'preact/hooks';
import type { HomeDevice, EntityRef } from '../model/discover.ts';
import type { Runner } from './sheet.tsx';
import type { Host } from '../runtime/host.ts';
import type { Action } from '../runtime/actions.ts';
import type { T, Key } from '../i18n/index.ts';
import { Icon } from './primitives.tsx';
import { Switch, held } from './cards.tsx';
import { errorText, isOn, num, type Lang } from './format.ts';
import { readableModel } from '../model/vacuum.ts';
import { isDimmable, hasColorTemp, hasColor, brightnessPct, kelvinOf, kelvinRange, kelvinColor, LEVELS, TEMP_PRESETS, AMBIENT_COLORS, nearestColor, rgbHex, ambientHex, clampKelvin, SLEEP_MINUTES, SLEEP_MIRROR, sleepTime, throttled, afterBusy } from '../model/lights.ts';

/** `offline`: the house is unreachable — every command control is marked `aria-disabled` and stays pressable (the press says «Нет связи с домом»). */
type Common = { device: HomeDevice; runner: Runner; t: T; lang: Lang; offline?: boolean };
/** `run` for the sheet's buttons that are not sliders: pressed while the lamp's previous command is still on its way, the command waits for
 * its turn instead of being dropped by the runner (`afterBusy`). After the sheet is closed the waiting one is tried at once and once more. */
function useTurn(runner: Runner, device: HomeDevice) {
  const now = useRef(runner); now.current = runner;
  const key = useRef(device.key); key.current = device.key;
  const gone = useRef(false), queue = useRef<ReturnType<typeof afterBusy> | null>(null);
  queue.current ??= afterBusy(() => !gone.current && now.current.busy.has(key.current));
  useEffect(() => () => { gone.current = true; }, []);
  return (action: Action, value?: unknown) => queue.current!(() => void now.current.run(device, action, value).then(ok => { if (!ok && gone.current) setTimeout(() => void now.current.run(device, action, value), 1500); }));
}
/** A light service call for any light entity of the card (the lamp or its ambient light); `serviceCall` maps the id to the HA field. */
const act = (entityId: string, id: string, data?: Record<string, unknown>, service = 'turn_on', kind: Action['kind'] = 'number'): Action => ({ id, label: id, kind, domain: entityId.split('.')[0] || 'light', service, entityId, data, confirm: false, risk: 'normal' });
const effectLabel = (o: string, t: T) => { const k = `mode.${o.toLowerCase().replace(/[\s-]+/g, '_')}` as Key; return t(k) !== k ? t(k) : o; };
const locales: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
/** «18:40» today, «3 нояб., 18:40» earlier. */
const since = (iso: string, lang: Lang) => { const d = new Date(iso); if (!iso || Number.isNaN(d.getTime())) return ''; const now = new Date(), sameDay = d.toDateString() === now.toDateString(); return new Intl.DateTimeFormat(locales[lang], sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d); };

function useThrottled(run: (v: number) => void) {
  const fn = useRef(run); fn.current = run;
  const th = useRef<ReturnType<typeof throttled> | null>(null); th.current ??= throttled(v => fn.current(v));
  useEffect(() => () => th.current?.flush(), []);
  return th.current.send;
}
/** The tall brightness slider (Apple Home): drag or tap, fill coloured by the light's temperature. */
function VSlider({ pct, on, kelvin, disabled, offline, label, offText, onChange, onCommit }: { pct: number; on: boolean; kelvin: number | null; disabled: boolean; offline?: boolean; label: string; /** what the slider says when the lamp is not lit: «Выключено», «Нет связи», «Нет данных» */ offText: string; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null); const [drag, setDrag] = useState(false);
  const at = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return Math.max(1, Math.min(100, Math.round(100 * (1 - (e.clientY - r.top) / r.height)))); };
  const down = (e: PointerEvent) => { if (disabled) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); onChange(at(e)); };
  const move = (e: PointerEvent) => { if (drag) onChange(at(e)); };
  const up = (e: PointerEvent) => { if (!drag) return; setDrag(false); onCommit(at(e)); };
  // a held arrow goes through the throttle like a drag (the last value always arrives): not one command per repeat of the key
  const key = (e: KeyboardEvent) => { const base = on ? pct : 0, v = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? base + 5 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? base - 5 : e.key === 'PageUp' ? base + 20 : e.key === 'PageDown' ? base - 20 : e.key === 'Home' ? 1 : e.key === 'End' ? 100 : null; if (v !== null) { e.preventDefault(); onChange(Math.max(1, Math.min(100, v))); } };
  return <div ref={ref} className={`at-vs ${on ? 'is-on' : ''} ${drag ? 'is-drag' : ''} ${disabled ? 'is-disabled' : ''}`} role="slider" aria-orientation="vertical" aria-valuemin={1} aria-valuemax={100} aria-valuenow={Math.max(1, pct)} aria-valuetext={on && !disabled ? `${pct} %` : offText} aria-disabled={disabled || offline || undefined} aria-label={label} tabIndex={disabled ? -1 : 0} style={`--p:${on ? pct : 0}%;--k:${kelvinColor(kelvin ?? 4000)}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(false)} onKeyDown={key}>
    <div className="at-vs-fill" /><b className="at-vs-pct">{on ? <>{pct}<i> %</i></> : '—'}</b><span className="at-vs-bulb"><Icon name="light" size={26} /></span>
  </div>;
}
/** Colour temperature strip: warm → cold, drag or tap, commits on release. */
function TempStrip({ value, min, max, disabled, offline, label, onCommit }: { value: number; min: number; max: number; disabled: boolean; offline?: boolean; label: string; onCommit: (k: number) => void }) {
  const ref = useRef<HTMLDivElement>(null); const [draft, setDraft] = useState<number | null>(null);
  const at = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return clampKelvin(min + (max - min) * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), min, max); };
  const k = draft ?? value, x = max > min ? (100 * (k - min) / (max - min)) : 50;
  return <div ref={ref} className={`at-temp-strip ${disabled ? 'is-disabled' : ''}`} role="slider" aria-orientation="horizontal" aria-valuemin={min} aria-valuemax={max} aria-valuenow={k} aria-valuetext={`${k} K`} aria-disabled={disabled || offline || undefined} aria-label={label} tabIndex={disabled ? -1 : 0} style={`--x:${x.toFixed(1)}%`}
    onPointerDown={e => { if (disabled) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDraft(at(e)); }} onPointerMove={e => { if (draft !== null) setDraft(at(e)); }} onPointerUp={e => { if (draft === null) return; const v = at(e); setDraft(null); onCommit(v); }} onPointerCancel={() => setDraft(null)}
    onKeyDown={e => { const v = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? k + 100 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? k - 100 : e.key === 'PageUp' ? k + 500 : e.key === 'PageDown' ? k - 500 : e.key === 'Home' ? min : e.key === 'End' ? max : null; if (v !== null && !disabled) { e.preventDefault(); onCommit(clampKelvin(v, min, max)); } }}><i /></div>;
}
/** The dimmable lamp: slider, quick levels, temperature with presets, effects, the ambient light. A relay lamp gets the big bulb and the power row instead. */
export function LightBody({ device, runner, t, lang, host, sleepAt }: Common & { host?: Host; sleepAt?: string | null }) {
  const e = device.primary, a = e.attributes, on = isOn(e), avail = e.available, offline = host?.online === false, turn = useTurn(runner, device);
  // a lamp that says nothing about itself (`unknown`) is not «Выключено»: it is «Нет данных», like one without a link is «Нет связи»
  const silent = !avail ? t('state.unavailable') : e.state === 'unknown' ? t('state.unknown') : null;
  const ambient = device.controls.find((c, i) => i > 0 && c.domain === 'light') ?? null;
  const [draft, setDraft] = useState<number | null>(null); // brightness shown while dragging, until HA reports it
  const live = brightnessPct(a) ?? 0;
  useEffect(() => { if (draft !== null && on && Math.abs(live - draft) <= 2) setDraft(null); }, [live, on, draft]);
  useEffect(() => { if (draft === null) return; const id = setTimeout(() => setDraft(null), 2500); return () => clearTimeout(id); }, [draft]);
  // a relay that powers a strip (Atom + Okapi, 09.11.2026: «LED Шоурума» is the S60TPF socket, the Gledopto strip inside it): the big bulb is the
  // power, the strip below has its colour, brightness and scenes but no switch of its own
  if (!isDimmable(a)) return <><RelayHero device={device} runner={runner} t={t} lang={lang} offline={offline} />{ambient && <StripRows device={device} strip={ambient} powered={on && avail} runner={runner} turn={turn} t={t} lang={lang} offline={offline} />}<SleepRow entityId={e.id} on={on && avail} host={host} sleepAt={sleepAt ?? null} t={t} /></>;
  const pct = draft ?? live, shownOn = on || draft !== null;
  const send = useThrottled(v => void runner.run(device, act(e.id, 'brightness', { transition: 0.3 }), v));
  const k = kelvinOf(a), range = kelvinRange(a), temp = hasColorTemp(a);
  const effects = Array.isArray(a.effect_list) ? a.effect_list.filter((x): x is string => typeof x === 'string') : [], effect = typeof a.effect === 'string' ? a.effect : null;
  const state = silent && !shownOn ? silent : !avail ? t('state.unavailable') : shownOn ? [`${pct} %`, temp && k !== null ? `${num(k, lang, 0)}\u00a0K` : null, effect ? effectLabel(effect, t) : null].filter(Boolean).join(' · ') : t('state.off');
  const level = (v: number) => <button type="button" className={`at-light-level ${shownOn && Math.abs(pct - v) <= 2 ? 'is-on' : ''}`} aria-pressed={shownOn && Math.abs(pct - v) <= 2} {...held(false, offline)} disabled={!avail} onClick={() => { setDraft(v); send(v, true); }}>{v === 1 ? <>{t('light.level.night')}<small>1 %</small></> : `${v} %`}</button>;
  return <div className="at-light-body" data-on={shownOn ? '1' : '0'}>
    <div className="at-light-hero">
      <VSlider pct={pct} on={shownOn} kelvin={k} disabled={!avail} offline={offline} label={t('action.brightness')} offText={silent ?? t('state.off')} onChange={v => { setDraft(v); send(v); }} onCommit={v => { setDraft(v); send(v, true); }} />
      <div className="at-light-side">
        {/* the roomy sheet (tablet, desktop) hides the <b> (atom.css: `.is-roomy .at-light-state b`) because the line under it says the same; a lamp without
            a link, or one that says nothing, has no such line — there the word itself stays on screen (the inline style outranks that rule) */}
        <div className={`at-light-state ${silent && !shownOn ? 'is-silent' : ''}`}><b style={silent && !shownOn ? 'display:block' : undefined}>{silent && !shownOn ? silent : avail ? t(shownOn ? 'state.on' : 'state.off') : t('state.unavailable')}</b>{avail && shownOn && <small>{state}</small>}</div>
        <div className="at-light-levels">{LEVELS.map(level)}<button type="button" className="at-light-level is-off" {...held(false, offline)} disabled={!avail || !on} onClick={() => { setDraft(null); turn(act(e.id, 'off', undefined, 'turn_off', 'button')); }}><Icon name="power" size={16} /><span className="at-long">{t('ui.turnOff')}</span><span className="at-short">{t('mode.off')}</span></button></div>
      </div>
    </div>
    {(temp || effects.length > 0 || ambient) && <div className="at-light-right">
      {(temp || effects.length > 0) && <div className="at-light-temp">
        {temp && <><small className="at-light-title">{t('light.temp')}<b>{k === null ? '—' : `${num(k, lang, 0)}\u00a0K`}</b></small>
          <TempStrip value={k ?? Math.round((range.min + range.max) / 2)} min={range.min} max={range.max} disabled={!avail} offline={offline} label={t('light.temp')} onCommit={v => void runner.run(device, act(e.id, 'color_temp'), v)} />
          <div className="at-temp-presets">{TEMP_PRESETS.filter(p => p.k >= range.min && p.k <= range.max).map(p => <button type="button" className={`at-temp-preset ${k !== null && Math.abs(k - p.k) < 150 ? 'is-on' : ''}`} aria-pressed={k !== null && Math.abs(k - p.k) < 150} {...held(false, offline)} disabled={!avail} onClick={() => void runner.run(device, act(e.id, 'color_temp'), p.k)}>{t(`light.preset.${p.key}` as Key)}<small>{p.k}</small></button>)}</div></>}
        {effects.length > 0 && <><small className="at-light-title">{t('action.effect')}</small><div className="at-light-seg" role="group" aria-label={t('action.effect')}>{effects.map(o => <button type="button" aria-pressed={effect === o} className={effect === o ? 'is-on' : ''} {...held(false, offline)} disabled={!avail} onClick={() => turn(act(e.id, 'effect', undefined, 'turn_on', 'select'), o)}>{effectLabel(o, t)}</button>)}</div></>}
      </div>}
      {ambient && <AmbientRows device={device} ambient={ambient} runner={runner} turn={turn} t={t} lang={lang} offline={offline} />}
    </div>}
    <SleepRow entityId={e.id} on={on && avail} host={host} sleepAt={sleepAt ?? null} t={t} />
  </div>;
}
/** The lamp's ambient light: switch, six colours and white tones, its own brightness. */
type Turn = (action: Action, value?: unknown) => void;
function AmbientRows({ device, ambient, runner, turn, t, lang, offline }: Common & { ambient: EntityRef; turn: Turn }) {
  const a = ambient.attributes, on = isOn(ambient), avail = ambient.available, pct = brightnessPct(a) ?? 0, cur = nearestColor(a.rgb_color), hex = ambientHex(a), k = kelvinOf(a), range = kelvinRange(a);
  const colour = cur ? t(`light.color.${cur}` as Key) : k !== null && !Array.isArray(a.rgb_color) ? (k <= 3500 ? t('light.white.warm') : t('light.white.cold')) : '';
  return <div className="ah-rows at-amb">
    <div className="ah-row"><span className="ah-row-icon" style={`--tile:${on && avail ? hex : '#8e8e93'}`}><Icon name="sun" size={18} /></span><span className="ah-row-text"><strong>{t('light.ambient')}</strong><small>{!avail ? t('state.unavailable') : on ? [colour, `${pct} %`].filter(Boolean).join(' · ') : t('state.off')}</small></span>
      <Switch on={on} disabled={!avail} offline={offline} label={t('light.ambient')} onToggle={() => turn(act(ambient.id, 'toggle', undefined, 'toggle', 'toggle'), !on)} /></div>
    {on && avail && <div className="ah-row at-amb-row">
      <div className="at-amb-colors">
        {hasColor(a) && AMBIENT_COLORS.map(c => <button type="button" className={`at-amb-dot ${cur === c.key ? 'is-on' : ''}`} aria-pressed={cur === c.key} style={`--c:${rgbHex(c.rgb)}`} aria-label={t(`light.color.${c.key}` as Key)} {...held(false, offline)} onClick={() => turn(act(ambient.id, 'color', undefined, 'turn_on', 'select'), c.rgb)} />)}
        {hasColorTemp(a) && <><button type="button" className={`at-amb-dot is-white ${!cur && k !== null && k <= 3500 ? 'is-on' : ''}`} style={`--c:${kelvinColor(2700)}`} aria-label={t('light.white.warm')} {...held(false, offline)} onClick={() => void runner.run(device, act(ambient.id, 'color_temp'), clampKelvin(2700, range.min, range.max))} /><button type="button" className={`at-amb-dot is-white ${!cur && k !== null && k > 3500 ? 'is-on' : ''}`} style={`--c:${kelvinColor(6000)}`} aria-label={t('light.white.cold')} {...held(false, offline)} onClick={() => void runner.run(device, act(ambient.id, 'color_temp'), clampKelvin(6000, range.min, range.max))} /></>}
      </div>
      {isDimmable(a) && <input type="range" className="at-amb-range" min={1} max={100} step={1} value={pct} aria-label={`${t('light.ambient')} · ${t('action.brightness')}`} {...held(false, offline)} style={`--c:${hex}`} onChange={ev => void runner.run(device, act(ambient.id, 'brightness', { transition: 0.3 }), Number((ev.target as HTMLInputElement).value))} />}
    </div>}
  </div>;
}
/** A strip fed by the lamp's relay: colours, white tones, brightness and the controller's scenes; no switch (the relay is the power). Picking a colour
 * or a scene turns the strip on; while the relay is off there is nothing to drive, and it says so. */
function StripRows({ device, strip, powered, runner, turn, t, lang, offline }: Common & { strip: EntityRef; powered: boolean; turn: Turn }) {
  const a = strip.attributes, avail = strip.available && powered, on = isOn(strip), pct = brightnessPct(a), cur = nearestColor(a.rgb_color), k = kelvinOf(a), range = kelvinRange(a), hex = ambientHex(a);
  // the live scene select first: Z2M leaves an unavailable twin of every entity it moved
  const sceneSel = [...device.parameters, ...device.controls, ...device.metrics].filter(x => x.domain === 'select' && /_scene(_\d+)?$/.test(x.id)), scene = sceneSel.find(x => x.available) ?? sceneSel[0] ?? null;
  const scenes = scene && Array.isArray(scene.attributes.options) ? (scene.attributes.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
  const sceneName = (o: string) => { const key = `light.scene.${o}` as Key; return t(key) !== key ? t(key) : o.replace(/_/g, ' '); };
  const colour = cur ? t(`light.color.${cur}` as Key) : k !== null && !Array.isArray(a.rgb_color) ? (k <= 3500 ? t('light.white.warm') : t('light.white.cold')) : '';
  const line = !powered ? t('light.stripOff') : !strip.available ? t('state.unavailable') : [on && scene && scenes.includes(scene.state) ? sceneName(scene.state) : null, on ? colour : null, on && pct !== null ? `${pct} %` : null].filter(Boolean).join(' · ') || t('light.stripReady');
  return <div className="ah-group at-strip">
    <div className="ah-row"><span className="ah-row-icon" style={`--tile:${avail && on ? hex : '#8e8e93'}`}><Icon name="sun" size={18} /></span><span className="ah-row-text"><strong>{t('light.strip')}</strong><small>{line}</small></span></div>
    <div className={`at-amb-row at-strip-body ${avail ? '' : 'is-off'}`} aria-disabled={!avail || undefined}>
      <div className="at-amb-colors">
        {hasColor(a) && AMBIENT_COLORS.map(c => <button type="button" className={`at-amb-dot ${on && cur === c.key ? 'is-on' : ''}`} style={`--c:${rgbHex(c.rgb)}`} {...held(false, offline)} disabled={!avail} aria-label={t(`light.color.${c.key}` as Key)} onClick={() => turn(act(strip.id, 'color', undefined, 'turn_on', 'select'), c.rgb)} />)}
        {hasColorTemp(a) && <><button type="button" className={`at-amb-dot is-white ${on && !cur && k !== null && k <= 3500 ? 'is-on' : ''}`} style={`--c:${kelvinColor(2700)}`} {...held(false, offline)} disabled={!avail} aria-label={t('light.white.warm')} onClick={() => void runner.run(device, act(strip.id, 'color_temp'), clampKelvin(2700, range.min, range.max))} /><button type="button" className={`at-amb-dot is-white ${on && !cur && k !== null && k > 3500 ? 'is-on' : ''}`} style={`--c:${kelvinColor(6000)}`} {...held(false, offline)} disabled={!avail} aria-label={t('light.white.cold')} onClick={() => void runner.run(device, act(strip.id, 'color_temp'), clampKelvin(6000, range.min, range.max))} /></>}
      </div>
      <input type="range" className="at-amb-range" min={1} max={100} step={1} value={pct ?? 100} {...held(false, offline)} disabled={!avail} aria-label={`${t('light.strip')} · ${t('action.brightness')}`} style={`--c:${hex}`} onChange={ev => void runner.run(device, act(strip.id, 'brightness', { transition: 0.3 }), Number((ev.target as HTMLInputElement).value))} />
      {scene && scenes.length > 0 && <><small className="at-light-title">{t('light.scenes')}</small><div className="hm-chips at-strip-scenes">{scenes.map(o => <button type="button" className={`hm-pill ${on && scene.state === o ? 'is-on' : ''}`} aria-pressed={on && scene.state === o} {...held(false, offline)} disabled={!avail} onClick={() => turn(act(scene.id, 'option', undefined, 'select_option', 'select'), o)}>{sceneName(o)}</button>)}</div></>}
    </div>
  </div>;
}
/** «Выключить через 15/30/60»: the integration keeps the timer and switches the lamp off; the pending time comes back through the mirror text. */
function SleepRow({ entityId, on, host, sleepAt: mirrored, t }: { entityId: string; on: boolean; host?: Host; /** what the mirror helper says: the fallback */ sleepAt: string | null; t: T }) {
  const ws = host?.ws; if (!ws) return null;
  const [busy, setBusy] = useState(false), [note, setNote] = useState('');
  // The integration's own list of timers: read when the sheet opens and again when the mirror or the lamp changes (a timer set or cancelled on
  // another screen, a timer that fired); every answer to this sheet's own command carries it too. An older integration has no such read: the mirror stays.
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const mirror = host?.states?.()[SLEEP_MIRROR]?.state;
  useEffect(() => { let alive = true; if (host && !host.online) return; void ws<{ pending?: unknown }>({ type: 'atom_home/light/sleep/state' }).then(r => { if (alive && r && typeof r.pending === 'object' && r.pending) setPending(r.pending as Record<string, unknown>); }, () => undefined); return () => { alive = false; }; }, [entityId, mirror, on, host?.online]);
  const sleepAt = pending ? sleepTime(entityId, pending, null) : mirrored, dead = !!host && !host.online;
  // the house off the line: nothing is sent; a refusal is said in the panel's language (HA answers with a {code, message} object, never shown raw)
  const set = async (minutes: number) => { if (busy) return; if (host && !host.online) { setNote(t('ui.offline')); return; } setBusy(true); setNote(''); try { const r = await ws<{ pending?: unknown } | null>({ type: 'atom_home/light/sleep', entity_id: entityId, minutes }); if (r && typeof r.pending === 'object' && r.pending) setPending(r.pending as Record<string, unknown>); } catch (err) { setNote(errorText(err, t)); } finally { setBusy(false); } };
  return <div className="ah-group at-sleep" data-sleep={sleepAt ?? ''}>
    <small className="ah-group-title">{t('light.sleep')}</small>
    {sleepAt ? <div className="at-sleep-at"><Icon name="clock" size={18} /><strong>{t('light.sleepAt', { time: sleepAt })}</strong><button type="button" className="hm-pill" {...held(busy, dead)} onClick={() => void set(0)}>{t('light.sleepCancel')}</button></div>
      : <div className="hm-chips at-sleep-chips">{SLEEP_MINUTES.map(m => <button type="button" className="hm-pill" {...held(busy, dead)} disabled={!on} onClick={() => void set(m)}>{m} {t('ui.min')}</button>)}</div>}
    {note && <small className="at-sleep-note" role="alert">{note}</small>}
  </div>;
}
/** A relay lamp: the big bulb with its bloom, when it was switched, one power row. */
function RelayHero({ device, runner, t, lang, offline }: Common) {
  const e = device.primary, on = isOn(e), avail = e.available, busy = runner.busy.has(device.key), at = since(e.lastChanged, lang), known = avail && e.state !== 'unknown';
  return <>
    <div className={`ah-hero at-relay-hero ${on && avail ? 'is-on' : ''}`}><span className={`ah-hero-glyph at-relay-glyph ${on && avail ? 'is-on' : ''}`}><Icon name="light" size={44} /></span>
      <div className="ah-hero-main"><b>{!avail ? t('state.unavailable') : !known ? t('state.unknown') : t(on ? 'state.on' : 'state.off')}</b><small>{[known && at ? t('light.since', { time: at }) : null, readableModel(device.model) ?? t('light.relay')].filter(Boolean).join(' · ')}</small></div></div>
    <button type="button" className={`ah-power ${on ? 'is-on' : ''}`} {...held(busy, offline)} disabled={!avail} onClick={() => { if (!busy) void runner.run(device, act(e.id, 'toggle', undefined, 'toggle', 'toggle'), !on); }}><span className="ah-power-icon"><Icon name="power" size={22} /></span><strong>{on ? t('ui.turnOff') : t('ui.turnOn')}</strong></button>
  </>;
}
