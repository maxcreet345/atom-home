import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from './primitives.tsx';
import type { HomeDevice, EntityRef } from '../model/discover.ts';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import { actionsFor, entityActions, type Action } from '../runtime/actions.ts';
import { stateText, isOn, num, iconOfKind, type Lang } from './format.ts';
import { metricLabel, Switch, artOf, tileColor } from './cards.tsx';
import { DeviceArt } from './device-art.tsx';

export interface Runner { run(device: HomeDevice, action: Action, value?: unknown): Promise<void>; busy: ReadonlySet<string> }
type Common = { device: HomeDevice; runner: Runner; t: T; lang: Lang };
const label = (a: Action, t: T) => t(a.label as Key) === a.label ? a.label : t(a.label as Key);
/** Secondary entity names without the device's own name in front («Розетка туалет Delayed power on time» → «Delayed power on time»). */
const short = (name: string, device: HomeDevice) => { const dev = (typeof device.primary.attributes.friendly_name === 'string' ? device.primary.attributes.friendly_name : device.name).trim(); for (const base of [dev, device.name, ...device.metrics.map(m => m.name)]) { const a = name.split(/\s+/), b = base.split(/\s+/); let n = 0; while (n < a.length - 1 && n < b.length && a[n].toLowerCase() === b[n].toLowerCase()) n++; if (n >= 2 || (n === 1 && a[0].length > 3)) return a.slice(n).join(' ').replace(/^[—·:-]+\s*/, ''); } return name; };
/** Secondary buttons that only repeat the primary actions (vacuum start/stop/charge/locate, info) are not shown twice. */
const DUP_BUTTON = /_(start_sweep|stop_sweeping|start_charge|identify|info|locate|return_to_base|pause|stop|start)$/;
/** Option label: `mode.<option>` (hvac modes, fan speeds, effects…), else `state.<option>`, else the raw option. */
export const optionLabel = (o: string, t: T) => { const k = `mode.${o.toLowerCase().replace(/[\s-]+/g, '_')}` as Key, s = `state.${o}` as Key; return t(k) !== k ? t(k) : t(s) !== s ? t(s) : o; };
const MODE_ICON: Record<string, string> = { program: 'more', holiday: 'person', frost: 'air', antifrost: 'air', off: 'power', heat: 'flame', cool: 'air', auto: 'settings', heat_cool: 'settings', dry: 'water', fan_only: 'fan', silent: 'fan', basic: 'fan', standard: 'fan', strong: 'fan', turbo: 'fan', max: 'fan', full_speed: 'fan', day: 'light', night: 'motion', tv: 'media', hdmi: 'media', eco: 'air', comfort: 'home', boost: 'flame', away: 'person', home: 'home', sleep: 'motion', manual: 'settings', schedule: 'more' };

/** Row of round mode buttons (Xiaomi Home style): icon or first letter in a circle, label underneath, the active one tinted. */
export function ModeRow({ device, action, runner, t }: Common & { action: Action }) {
  const busy = runner.busy.has(device.key), opts = action.options ?? [];
  return <div className="ah-modes" role="radiogroup" aria-label={label(action, t)}>
    <small className="ah-modes-title">{label(action, t)}</small>
    <div className="ah-modes-row">{opts.map(o => { const key = o.toLowerCase().replace(/[\s-]+/g, '_'), active = String(action.current) === o, icon = MODE_ICON[key]; return <button type="button" role="radio" aria-checked={active} className={`ah-mode ${active ? 'is-active' : ''}`} disabled={busy || !device.primary.available} onClick={() => void runner.run(device, action, o)}><span className="ah-mode-glyph">{icon ? <Icon name={icon} size={22} /> : <b>{o.slice(0, 1).toUpperCase()}</b>}</span><span className="ah-mode-label">{optionLabel(o, t)}</span></button>; })}</div>
  </div>;
}
/** Slider row with the current value; commits on release, shows the draft while dragging. */
export function SliderRow({ device, action, runner, t, lang }: Common & { action: Action }) {
  const [draft, setDraft] = useState<number | null>(null);
  const busy = runner.busy.has(device.key), value = draft ?? (typeof action.current === 'number' ? action.current : action.min ?? 0);
  const digits = action.step && action.step < 1 ? 1 : 0;
  return <div className="ah-row ah-slider has-hint hm-setting"><span className="ah-row-text"><strong>{label(action, t)}</strong><small>{num(value, lang, digits)} {action.unit ?? ''}</small></span>
    <input type="range" min={action.min} max={action.max} step={action.step ?? 1} value={value} disabled={busy || !device.primary.available} aria-label={label(action, t)} onInput={e => setDraft(Number((e.target as HTMLInputElement).value))} onChange={e => { setDraft(null); void runner.run(device, action, Number((e.target as HTMLInputElement).value)); }} />
  </div>;
}
/** List row with a coloured icon circle: toggle, select or button (Xiaomi Home settings style). */
export function SettingRow({ device, action, runner, t, icon, color }: Common & { action: Action; icon?: string; color?: string }) {
  const busy = runner.busy.has(device.key), name = label(action, t), off = !device.primary.available;
  const glyph = <span className="ah-row-icon" style={`--tile:${color ?? '#7b74d8'}`}><Icon name={icon ?? 'settings'} size={18} /></span>;
  if (action.kind === 'toggle') return <div className="ah-row hm-setting">{glyph}<span className="ah-row-text"><strong>{name}</strong></span><Switch on={action.current === true} pending={busy} disabled={off} label={name} onToggle={() => void runner.run(device, action, !action.current)} /></div>;
  if (action.kind === 'select') return <div className="ah-row hm-setting">{glyph}<span className="ah-row-text"><strong>{name}</strong></span><select value={String(action.current ?? '')} disabled={busy || off} aria-label={name} onChange={e => void runner.run(device, action, (e.target as HTMLSelectElement).value)}>{!(action.options ?? []).includes(String(action.current ?? '')) && <option value="">—</option>}{(action.options ?? []).map(o => <option value={o}>{optionLabel(o, t)}</option>)}</select></div>;
  if (action.kind === 'button') return <button type="button" className="ah-row hm-setting is-button" disabled={busy || off} onClick={() => void runner.run(device, action)}>{glyph}<span className="ah-row-text"><strong>{name}</strong></span><Icon name="next" size={18} /></button>;
  return <SliderRow device={device} action={action} runner={runner} t={t} lang={'ru'} />;
}
/** 24-hour sparkline for one numeric entity, read through the host's history (recorder). */
function History({ entity, host, t, lang }: { entity: EntityRef; host?: Host; t: T; lang: Lang }) {
  const [pts, setPts] = useState<Array<[number, number]> | null>(null);
  useEffect(() => { let alive = true; setPts(null); if (!host?.history) return; host.history([entity.id], 24).then(d => { if (alive) setPts(d[entity.id] ?? []); }).catch(() => { if (alive) setPts([]); }); return () => { alive = false; }; }, [entity.id, host]);
  if (!pts || pts.length < 2) return null;
  const ys = pts.map(p => p[1]), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1, x0 = pts[0][0], xs = (pts[pts.length - 1][0] - x0) || 1;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(100 * (p[0] - x0) / xs).toFixed(1)} ${(28 - 24 * (p[1] - min) / span - 2).toFixed(1)}`).join(' ');
  return <div className="ah-history"><div className="ah-history-head"><small>{t('ui.history')}</small><small>{num(min, lang, 1)} – {num(max, lang, 1)} {entity.unit ?? ''}</small></div><svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d={`${d} V28 H0 Z`} className="ah-history-area" /><path d={d} className="ah-history-line" /></svg></div>;
}
/** Readings grid. Names like «Детская — расчётная температура» ×5 share a suffix: it becomes the grid caption, the cells keep only what differs. */
function Facts({ device, t, lang }: { device: HomeDevice; t: T; lang: Lang }) {
  const e = device.primary, list = device.metrics.filter(m => m.id !== e.id);
  if (!list.length) return null;
  const names = list.map(m => { const same = list.filter(x => x.deviceClass === m.deviceClass).length > 1; return same ? short(m.name, device) : metricLabel(m, t); });
  let caption = '';
  if (list.length > 1) { const words = names.map(n => n.split(/\s+/)); let k = 0; while (words.every(w => w.length > k + 1) && words.every(w => w[w.length - 1 - k].toLowerCase() === words[0][words[0].length - 1 - k].toLowerCase())) k++; if (k > 0) { caption = words[0].slice(-k).join(' ').replace(/^[—·:-]+\s*/, ''); names.forEach((_, i) => { names[i] = words[i].slice(0, -k).join(' ').replace(/[\s—·:-]+$/, ''); }); } }
  const cell = (m: EntityRef, i: number) => <div className="hm-fact"><small>{names[i]}</small><strong>{stateText(m, t, lang)}</strong></div>;
  const LIMIT = 6;
  return <div className="ah-facts-wrap">{caption && <small className="ah-facts-caption">{caption.charAt(0).toUpperCase() + caption.slice(1)}</small>}<div className="hm-facts">{list.slice(0, LIMIT).map(cell)}</div>{list.length > LIMIT && <Fold title={`${t('ui.readings')} (${list.length - LIMIT})`}><div className="hm-facts">{list.slice(LIMIT).map((m, i) => cell(m, i + LIMIT))}</div></Fold>}</div>;
}
function Fold({ title, children, open }: { title: string; children: ComponentChildren; open?: boolean }) {
  return <details className="hm-fold" open={open}><summary><span>{title}</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{children}</div></details>;
}
/** Settings rows for the device's secondary entities: switches, numbers, selects and buttons become controls; button entities are grouped as chips. */
function Settings({ device, runner, t, lang, host }: Common & { host?: Host }) {
  const params = device.parameters.filter(p => !(p.domain === 'button' && DUP_BUTTON.test(p.id)));
  const rows = params.flatMap(p => entityActions(p).map(a => ({ p, a: { ...a, label: short(a.label, device) } }))), readOnly = params.filter(p => entityActions(p).length === 0);
  const buttons = rows.filter(r => r.a.kind === 'button'), others = rows.filter(r => r.a.kind !== 'button');
  const ICON: Record<string, string> = { switch: 'power', input_boolean: 'power', number: 'settings', input_number: 'settings', select: 'more', input_select: 'more' };
  return <>
    {buttons.length > 0 && <div className="ah-group"><small className="ah-group-title">{device.kind === 'vacuum' ? t('ui.rooms') : t('ui.actions')}</small><div className="hm-chips at-actions">{buttons.map(({ p, a }) => <button type="button" className="hm-pill" disabled={runner.busy.has(device.key) || !p.available} onClick={() => void runner.run(device, a)}>{short(p.name, device)}</button>)}</div></div>}
    {(others.length > 0 || readOnly.length > 0) && <Fold title={`${t('ui.settings')} (${others.length + readOnly.length})`}>
      {others.map(({ p, a }) => <SettingRow device={device} action={a} runner={runner} t={t} lang={lang} icon={ICON[p.domain]} color={a.kind === 'toggle' ? '#30d158' : '#7b74d8'} />)}
      {readOnly.map(p => <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{short(p.name, device)}</strong></span><small>{stateText(p, t, lang)}</small></div>)}
    </Fold>}
    {device.diagnostics.length > 0 && <Fold title={`${t('ui.diagnostics')} (${device.diagnostics.length})`}>{device.diagnostics.map(p => <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{short(p.name, device)}</strong></span><small>{stateText(p, t, lang)}</small></div>)}</Fold>}
    {host && device.kind !== 'camera' && [e(device)].filter(x => x.domain === 'sensor' && Number.isFinite(Number(x.state))).map(x => <History entity={x} host={host} t={t} lang={lang} />)}
  </>;
}
const e = (d: HomeDevice) => d.primary;
/** Big power row: orange circle when on (Xiaomi), grey when off. */
function PowerRow({ device, action, runner, t }: Common & { action: Action }) {
  const on = action.current === true, busy = runner.busy.has(device.key);
  return <button type="button" className={`ah-power ${on ? 'is-on' : ''}`} disabled={busy || !device.primary.available} onClick={() => void runner.run(device, action, !on)}><span className="ah-power-icon"><Icon name="power" size={22} /></span><strong>{on ? t('ui.turnOff') : t('ui.turnOn')}</strong></button>;
}
/** Hero block per kind: the one number or state the owner looks at first. */
function Hero({ device, runner, t, lang, host }: Common & { host?: Host }) {
  const p = device.primary, a = p.attributes, acts = actionsFor(device), color = tileColor(device), on = isOn(p);
  const glyph = <span className={`ah-hero-glyph ${on ? 'is-on' : ''}`} style={`--tile:${color}`}><Icon name={device.icon ?? iconOfKind[device.kind] ?? 'generic'} size={44} /></span>;
  if (device.kind === 'climate') {
    const cur = typeof a.current_temperature === 'number' ? a.current_temperature : null, target = typeof a.temperature === 'number' ? a.temperature : null, temp = acts.find(x => x.id === 'temperature'), active = p.state !== 'off' && p.available;
    const step = (dir: 1 | -1) => temp && target !== null && void runner.run(device, temp, Math.round((target + dir * (temp.step ?? 0.5)) * 10) / 10);
    const action = typeof a.hvac_action === 'string' ? a.hvac_action : null;
    return <div className={`ah-hero ah-hero-climate ${active ? 'is-on' : ''}`}>
      <div className="ah-hero-main"><b>{cur === null ? (target === null ? '—' : num(target, lang)) : num(cur, lang)}<i>°</i></b><small>{action && action !== 'off' ? optionLabel(action === 'heating' ? 'heat' : action === 'cooling' ? 'cool' : action, t) : stateText(p, t, lang).split(' · ')[0]}</small></div>
      {temp && <div className="ah-target"><button type="button" className="hm-round" aria-label="−" disabled={!p.available || target === null || runner.busy.has(device.key)} onClick={() => step(-1)}>−</button><span><small>{t('ui.target')}</small><strong>{target === null ? '—' : num(target, lang)}°</strong></span><button type="button" className="hm-round" aria-label="+" disabled={!p.available || target === null || runner.busy.has(device.key)} onClick={() => step(1)}>+</button></div>}
    </div>;
  }
  if (device.kind === 'light') {
    const br = typeof a.brightness === 'number' ? Math.round(a.brightness / 2.55) : null;
    return <div className={`ah-hero ${on ? 'is-on' : ''}`}>{glyph}<div className="ah-hero-main"><b>{on && br !== null ? <>{br}<i>%</i></> : stateText(p, t, lang)}</b>{on && br !== null && <small>{t('state.on')}</small>}</div></div>;
  }
  if (device.kind === 'vacuum') {
    const bat = typeof a.battery_level === 'number' ? a.battery_level : null;
    return <div className={`ah-hero ${on ? 'is-on' : ''}`}>{glyph}<div className="ah-hero-main"><b>{stateText(p, t, lang).split(' · ')[0]}</b>{bat !== null && <small>{t('metric.battery')} {bat}%</small>}</div></div>;
  }
  if (device.kind === 'media') {
    const title = typeof a.media_title === 'string' ? a.media_title : null, src = typeof a.source === 'string' ? a.source : null, vol = typeof a.volume_level === 'number' ? Math.round(a.volume_level * 100) : null;
    return <div className={`ah-hero ${on ? 'is-on' : ''}`}>{glyph}<div className="ah-hero-main"><b>{title ?? stateText(p, t, lang)}</b>{(src || vol !== null) && <small>{[src, vol !== null ? `${t('action.volume')} ${vol}%` : null].filter(Boolean).join(' · ')}</small>}</div></div>;
  }
  if (['switch', 'socket', 'energy'].includes(device.kind)) {
    const power = device.metrics.find(m => m.deviceClass === 'power' && m.available), energy = device.metrics.filter(m => m.deviceClass === 'energy' && m.available);
    return <div className={`ah-hero ${on ? 'is-on' : ''}`}>{glyph}<div className="ah-hero-main"><b>{power ? stateText(power, t, lang) : stateText(p, t, lang)}</b>{power && <small>{`${stateText(p, t, lang)}${energy[0] ? ` · ${stateText(energy[0], t, lang)}` : ''}`}</small>}</div></div>;
  }
  if (p.domain === 'sensor' || p.domain === 'binary_sensor') {
    return <div className="ah-hero">{glyph}<div className="ah-hero-main"><b>{stateText(p, t, lang)}</b><small>{metricLabel(p, t)}</small></div></div>;
  }
  return <div className={`ah-hero ${on ? 'is-on' : ''}`}>{glyph}<div className="ah-hero-main"><b>{stateText(p, t, lang)}</b></div></div>;
}
export function DeviceSheet({ device, runner, onClose, t, lang, stage, host }: { device: HomeDevice; runner: Runner; onClose: () => void; t: T; lang: Lang; stage?: ComponentChildren; host?: Host }) {
  const acts = actionsFor(device), p = device.primary;
  const toggle = acts.find(a => a.kind === 'toggle' && (a.id === 'toggle')), selects = acts.filter(a => a.kind === 'select'), sliders = acts.filter(a => a.kind === 'number' && !(device.kind === 'climate' && a.id === 'temperature')), buttons = acts.filter(a => a.kind === 'button'), otherToggles = acts.filter(a => a.kind === 'toggle' && a !== toggle);
  return <div className="hm-sheet-body ah-sheet" data-kind={device.kind}>
    <div className="hm-sheet-head"><span className="hm-sheet-photo">{device.photo ? <img src={device.photo} alt="" /> : artOf(device) ? <DeviceArt type={artOf(device)!} fill /> : <Icon name={iconOfKind[device.kind] ?? 'generic'} size={30} />}</span><div><small>{t(`kind.${device.kind}` as Key)}{device.model ? ` · ${device.model}` : ''}</small><h2>{device.name}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>
    {stage ? <div className="hm-camera-frame at-camera-stage">{stage}</div> : <Hero device={device} runner={runner} t={t} lang={lang} host={host} />}
    {toggle && <PowerRow device={device} action={toggle} runner={runner} t={t} lang={lang} />}
    {buttons.length > 0 && <div className="hm-chips at-actions">{buttons.map(a => <button type="button" className={`hm-pill ${a.confirm ? 'is-primary' : ''}`} disabled={runner.busy.has(device.key) || !p.available} onClick={() => void runner.run(device, a)}>{label(a, t)}</button>)}</div>}
    {selects.map(a => <ModeRow device={device} action={a} runner={runner} t={t} lang={lang} />)}
    {(sliders.length > 0 || otherToggles.length > 0) && <div className="ah-rows">{sliders.map(a => <SliderRow device={device} action={a} runner={runner} t={t} lang={lang} />)}{otherToggles.map(a => <SettingRow device={device} action={a} runner={runner} t={t} lang={lang} icon="power" color="#30d158" />)}</div>}
    <Facts device={device} t={t} lang={lang} />
    <Settings device={device} runner={runner} t={t} lang={lang} host={host} />
  </div>;
}
