import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from './primitives.tsx';
import type { HomeDevice, EntityRef } from '../model/discover.ts';
import type { Host, AutomationRow } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import { actionsFor, entityActions, stepTarget, type Action } from '../runtime/actions.ts';
import { stateText, isOn, num, iconOfKind, type Lang } from './format.ts';
import { metricLabel, Switch, artOf, tileColor, held, shownName, modelText, useTargetDraft, focusTwin } from './cards.tsx';
import { DeviceArt } from './device-art.tsx';
import { ProductPhoto, usePhoto } from './photo.tsx';
import { takesPhoto } from '../model/photos.ts';
import { LightBody } from './light-sheet.tsx';
import { parseSleep, SLEEP_MIRROR } from '../model/lights.ts';
import { familyDescription } from '../model/automation-text.ts';

/** `run` resolves true when the house accepted the command; false when it only asked first, was dropped as a second tap, was refused or the house is offline. */
export interface Runner { run(device: HomeDevice, action: Action, value?: unknown): Promise<boolean>; busy: ReadonlySet<string> }
/** `offline`: the house is unreachable. The controls are marked `aria-disabled` and stay pressable, so that a press says «Нет связи с домом»
 * (the runner's toast) instead of being swallowed by a native `disabled`. */
type Common = { device: HomeDevice; runner: Runner; t: T; lang: Lang; offline?: boolean };
const label = (a: Action, t: T) => t(a.label as Key) === a.label ? a.label : t(a.label as Key);
/** C1 of the audit: a thermostat that is off does not start heating from a stray «+»; the step becomes an explicit, confirmed «turn heating on to X°». */
export const heatOn = (temp: Action, v: number, t: T, lang: Lang = 'ru'): Action => ({ ...temp, label: t('climate.heatTo', { t: num(v, lang) }), confirm: true, data: { ...(temp.data ?? {}), hvac_mode: 'heat' } });
export { stepTarget };
/** Secondary entity names without the device's own name in front («Розетка туалет Delayed power on time» → «Delayed power on time»). */
const short = (name: string, device: HomeDevice) => { const dev = (typeof device.primary.attributes.friendly_name === 'string' ? device.primary.attributes.friendly_name : device.name).trim(); const a = name.split(/\s+/); let best = 0; for (const base of [dev, device.name]) { if (base === name) continue; const b = base.split(/\s+/); let n = 0; while (n < a.length - 1 && n < b.length && a[n].toLowerCase() === b[n].toLowerCase()) n++; if (n === b.length && n > best) best = n; } return best > 0 ? a.slice(best).join(' ').replace(/^[—·:-]+\s*/, '') : name; };
/** Words every name in a group starts with (at least two, e.g. «Главный блок распределения Sonoff SPM») — dropped from all of them. */
const commonPrefix = (names: string[]) => { if (names.length < 2) return 0; const w = names.map(n => n.split(/\s+/)); let k = 0; while (w.every(x => x.length > k + 1) && w.every(x => x[k].toLowerCase() === w[0][k].toLowerCase())) k++; return k >= 2 ? k : 0; };
/** Secondary buttons that only repeat the primary actions (vacuum start/stop/charge/locate, info) are not shown twice. */
const DUP_BUTTON = /_(start_sweep|stop_sweeping|start_charge|identify|info|locate|return_to_base|pause|stop|start)$/;
/** Option label: `mode.<option>` (hvac modes, fan speeds, effects…), else `state.<option>`, else the raw option. */
/** `nameOf` gives an entity's name: a speaker lists the other players as sources by their entity ids («media_player.gostinaia_3»); the id is
 * never what a person reads. An id nobody can name is shown by its own words («gostinaia 3»); the command still carries the id. */
export type NameOf = (entityId: string) => string | undefined;
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
export const optionLabel = (o: string, t: T, nameOf?: NameOf) => { const k = `mode.${o.toLowerCase().replace(/[\s-]+/g, '_')}` as Key, s = `state.${o}` as Key; if (t(k) !== k) return t(k); if (t(s) !== s) return t(s); if (!ENTITY_ID.test(o)) return o; const said = nameOf?.(o)?.trim(); if (said) return said; const w = o.slice(o.indexOf('.') + 1).replace(/_+/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); };
const namesOf = (host?: Host): NameOf => id => { const n = host?.states?.()[id]?.attributes.friendly_name; return typeof n === 'string' ? n : undefined; };
const MODE_ICON: Record<string, string> = { program: 'more', holiday: 'person', frost: 'air', antifrost: 'air', off: 'power', heat: 'flame', cool: 'air', auto: 'settings', heat_cool: 'settings', dry: 'water', fan_only: 'fan', silent: 'fan', basic: 'fan', standard: 'fan', strong: 'fan', turbo: 'fan', max: 'fan', full_speed: 'fan', day: 'light', night: 'motion', tv: 'media', hdmi: 'media', eco: 'air', comfort: 'home', boost: 'flame', away: 'person', home: 'home', sleep: 'motion', manual: 'settings', schedule: 'more' };

/** Row of round mode buttons (Xiaomi Home style): icon or first letter in a circle, label underneath, the active one tinted. */
export function ModeRow({ device, action, runner, t, nameOf, offline }: Common & { action: Action; nameOf?: NameOf }) {
  const busy = runner.busy.has(device.key), opts = action.options ?? [];
  // a group of buttons with a pressed one, not radios: a radio is chosen by the arrow keys, and here a choice is a command to the device
  return <div className="ah-modes" role="group" aria-label={label(action, t)}>
    <small className="ah-modes-title">{label(action, t)}</small>
    <div className="ah-modes-row">{opts.map(o => { const key = o.toLowerCase().replace(/[\s-]+/g, '_'), active = String(action.current) === o, icon = MODE_ICON[key]; return <button type="button" aria-pressed={active} className={`ah-mode ${active ? 'is-active' : ''}`} {...held(busy, offline)} disabled={!device.primary.available} onClick={() => { if (!busy) void runner.run(device, action, o); }}><span className="ah-mode-glyph">{icon ? <Icon name={icon} size={22} /> : <b>{optionLabel(o, t, nameOf).slice(0, 1).toUpperCase()}</b>}</span><span className="ah-mode-label">{optionLabel(o, t, nameOf)}</span></button>; })}</div>
  </div>;
}
/** Slider row with the current value; commits on release, shows the draft while dragging. */
export function SliderRow({ device, action, runner, t, lang, offline }: Common & { action: Action }) {
  const [draft, setDraft] = useState<number | null>(null);
  // a slider streams its values (the runner never drops a number): it is not switched off while one is on its way, so the arrow keys keep the focus
  const value = draft ?? (typeof action.current === 'number' ? action.current : action.min ?? 0);
  const digits = action.step && action.step < 1 ? 1 : 0;
  return <div className="ah-row ah-slider has-hint hm-setting"><span className="ah-row-text"><strong>{label(action, t)}</strong><small>{num(value, lang, digits)} {action.unit ?? ''}</small></span>
    <input type="range" min={action.min} max={action.max} step={action.step ?? 1} value={value} {...held(false, offline)} disabled={!device.primary.available} aria-label={label(action, t)} onInput={e => setDraft(Number((e.target as HTMLInputElement).value))} onChange={e => { setDraft(null); void runner.run(device, action, Number((e.target as HTMLInputElement).value)); }} />
  </div>;
}
/** List row with a coloured icon circle: toggle, select or button (Xiaomi Home settings style). */
export function SettingRow({ device, action, runner, t, lang, icon, color, nameOf, offline }: Common & { action: Action; icon?: string; color?: string; nameOf?: NameOf }) {
  const busy = runner.busy.has(device.key), name = label(action, t), off = !device.primary.available;
  const glyph = <span className="ah-row-icon" style={`--tile:${color ?? '#7b74d8'}`}><Icon name={icon ?? 'settings'} size={18} /></span>;
  if (action.kind === 'toggle') return <div className="ah-row hm-setting">{glyph}<span className="ah-row-text"><strong>{name}</strong></span><Switch on={action.current === true} pending={busy} disabled={off} offline={offline} label={name} onToggle={() => void runner.run(device, action, !action.current)} /></div>;
  if (action.kind === 'select') return <div className="ah-row hm-setting">{glyph}<span className="ah-row-text"><strong>{name}</strong></span><select value={String(action.current ?? '')} {...held(busy, offline)} disabled={off} aria-label={name} onChange={e => { const el = e.target as HTMLSelectElement; if (busy) { el.value = String(action.current ?? ''); return; } /* a command is on its way: the list keeps the focus and what the house holds */ void runner.run(device, action, el.value); }}>{!(action.options ?? []).includes(String(action.current ?? '')) && <option value="">—</option>}{(action.options ?? []).map(o => <option value={o}>{optionLabel(o, t, nameOf)}</option>)}</select></div>;
  if (action.kind === 'button') return <button type="button" className="ah-row hm-setting is-button" {...held(busy, offline)} disabled={off} onClick={() => { if (!busy) void runner.run(device, action); }}>{glyph}<span className="ah-row-text"><strong>{name}</strong></span><Icon name="next" size={18} /></button>;
  return <SliderRow device={device} action={action} runner={runner} t={t} lang={lang} offline={offline} />;
}
/** 24-hour sparkline for one numeric entity, read through the host's history (recorder). */
function History({ entity, host, t, lang }: { entity: EntityRef; host?: Host; t: T; lang: Lang }) {
  const [pts, setPts] = useState<Array<[number, number]> | null>(null);
  useEffect(() => { let alive = true; setPts(null); if (!host?.history) return; host.history([entity.id], 24).then(d => { if (alive) setPts(d[entity.id] ?? []); }).catch(() => { if (alive) setPts([]); }); return () => { alive = false; }; }, [entity.id, host]);
  // the chart's place is held while it loads, so the sheet does not jump when it arrives
  if (!pts && host?.history) return <div className="ah-history" style="visibility:hidden" aria-hidden="true"><div className="ah-history-head"><small>{t('ui.history')}</small></div><svg viewBox="0 0 100 28" preserveAspectRatio="none" /></div>;
  if (!pts || pts.length < 2) return null;
  const ys = pts.map(p => p[1]), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1, x0 = pts[0][0], xs = (pts[pts.length - 1][0] - x0) || 1;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(100 * (p[0] - x0) / xs).toFixed(1)} ${(28 - 24 * (p[1] - min) / span - 2).toFixed(1)}`).join(' ');
  return <div className="ah-history"><div className="ah-history-head"><small>{t('ui.history')}</small><small>{num(min, lang, 1)} – {num(max, lang, 1)} {entity.unit ?? ''}</small></div><svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" className="ah-draw"><path d={`${d} V28 H0 Z`} className="ah-history-area" /><path d={d} className="ah-history-line" pathLength={1} /></svg></div>;
}
/** Readings grid. Names like «Детская — расчётная температура» ×5 share a suffix: it becomes the grid caption, the cells keep only what differs. */
function Facts({ device, t, lang }: { device: HomeDevice; t: T; lang: Lang }) {
  const e = device.primary, list = device.metrics.filter(m => m.id !== e.id);
  if (!list.length) return null;
  const pre = commonPrefix(list.map(m => m.name));
  const names = list.map(m => { const same = list.filter(x => x.deviceClass === m.deviceClass).length > 1; return same ? short(m.name.split(/\s+/).slice(pre).join(' '), device) : metricLabel(m, t); });
  let caption = '';
  if (list.length > 1) { const words = names.map(n => n.split(/\s+/)); let k = 0; while (words.every(w => w.length > k + 1) && words.every(w => w[w.length - 1 - k].toLowerCase() === words[0][words[0].length - 1 - k].toLowerCase())) k++; if (k > 0) { caption = words[0].slice(-k).join(' ').replace(/^[—·:-]+\s*/, ''); names.forEach((_, i) => { names[i] = words[i].slice(0, -k).join(' ').replace(/[\s—·:-]+$/, ''); }); } }
  const cell = (m: EntityRef, i: number) => <div className="hm-fact"><small>{names[i]}</small><strong>{stateText(m, t, lang)}</strong></div>;
  const LIMIT = 6;
  return <div className="ah-facts-wrap">{caption && <small className="ah-facts-caption">{caption.charAt(0).toUpperCase() + caption.slice(1)}</small>}<div className="hm-facts">{list.slice(0, LIMIT).map(cell)}</div>{list.length > LIMIT && <Fold title={`${t('ui.readings')} (${list.length - LIMIT})`}><div className="hm-facts">{list.slice(LIMIT).map((m, i) => cell(m, i + LIMIT))}</div></Fold>}</div>;
}
export function Fold({ title, children, open }: { title: string; children: ComponentChildren; open?: boolean }) {
  return <details className="hm-fold" open={open}><summary><span>{title}</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{children}</div></details>;
}
/** Settings rows for the device's secondary entities: switches, numbers, selects and buttons become controls; button entities are grouped as chips. */
function Settings({ device, runner, t, lang, host, offline }: Common & { host?: Host }) {
  const params = device.parameters.filter(p => !(p.domain === 'button' && DUP_BUTTON.test(p.id)));
  // The device's own settings («Detach relay mode», «Power-on behavior», a restart button) change how the device works, not what it does now:
  // an administrator's, and never by one stray tap (owner's rule, audit 2026-11-09). A robot's room buttons are everyday actions and stay as they were.
  const admin = host?.admin === true, everyday = device.kind === 'vacuum';
  const rows = params.flatMap(p => entityActions(p).map(a => ({ p, a: { ...a, label: short(a.label, device), confirm: a.confirm || !(everyday && a.kind === 'button') } }))), readOnly = params.filter(p => entityActions(p).length === 0);
  const buttons = rows.filter(r => r.a.kind === 'button' && (admin || everyday)), others = admin ? rows.filter(r => r.a.kind !== 'button') : [];
  const bpre = commonPrefix(buttons.map(b => b.p.name)), chip = (name: string) => short(name.split(/\s+/).slice(bpre).join(' '), device);
  const model = modelText(device.model);
  const ICON: Record<string, string> = { switch: 'power', input_boolean: 'power', number: 'settings', input_number: 'settings', select: 'more', input_select: 'more' };
  return <>
    {buttons.length > 0 && <div className="ah-group"><small className="ah-group-title">{device.kind === 'vacuum' ? t('ui.rooms') : t('ui.actions')}</small><div className="hm-chips at-actions">{buttons.map(({ p, a }) => <button type="button" className="hm-pill" {...held(runner.busy.has(device.key), offline)} disabled={!p.available || !device.primary.available} onClick={() => { if (!runner.busy.has(device.key)) void runner.run(device, a); }}>{chip(p.name)}</button>)}</div></div>}
    {(others.length > 0 || readOnly.length > 0) && <Fold title={`${t('ui.settings')} (${others.length + readOnly.length})`}>
      {others.map(({ p, a }) => <SettingRow device={device} action={a} runner={runner} t={t} lang={lang} icon={ICON[p.domain]} color={a.kind === 'toggle' ? (a.current === true ? '#30d158' : '#8e8e93') : '#7b74d8'} nameOf={namesOf(host)} offline={offline} />)}
      {readOnly.map(p => <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{short(p.name, device)}</strong></span><small>{stateText(p, t, lang)}</small></div>)}
    </Fold>}
    {/* the model as a person reads it; an integration's technical id («yeelink.light.ceila») is never printed */}
    {(device.diagnostics.length > 0 || model) && <Fold title={`${t('ui.diagnostics')} (${device.diagnostics.length + (model ? 1 : 0)})`}>{model && <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{t('ui.model')}</strong></span><small>{device.manufacturer && !model.toLowerCase().startsWith(device.manufacturer.toLowerCase()) ? `${device.manufacturer} · ${model}` : model}</small></div>}{device.diagnostics.map(p => <div className="ah-row hm-setting"><span className="ah-row-text"><strong>{short(p.name, device)}</strong></span><small>{stateText(p, t, lang)}</small></div>)}</Fold>}
    {host && device.kind !== 'camera' && [e(device)].filter(x => x.domain === 'sensor' && Number.isFinite(Number(x.state))).map(x => <History entity={x} host={host} t={t} lang={lang} />)}
  </>;
}
const e = (d: HomeDevice) => d.primary;
/** Big power row: orange circle when on (Xiaomi), grey when off. */
function PowerRow({ device, action, runner, t, offline }: Common & { action: Action }) {
  const on = action.current === true, busy = runner.busy.has(device.key);
  return <button type="button" className={`ah-power ${on ? 'is-on' : ''}`} {...held(busy, offline)} disabled={!device.primary.available} onClick={() => { if (!busy) void runner.run(device, action, !on); }}><span className="ah-power-icon"><Icon name="power" size={22} /></span><strong>{on ? t('ui.turnOff') : t('ui.turnOn')}</strong></button>;
}
/** Hero block per kind: the one number or state the owner looks at first. */
function Hero({ device, runner, t, lang, host, offline }: Common & { host?: Host }) {
  const p = device.primary, a = p.attributes, acts = actionsFor(device), color = tileColor(device), on = isOn(p);
  // a thermostat's − / +: quick taps add up into one command, as on its tile (the draft lives here because a hook cannot stand in a branch)
  const draft = useTargetDraft(device.kind === 'climate' && typeof a.temperature === 'number' ? a.temperature : null);
  const glyph = <span className={`ah-hero-glyph ${on ? 'is-on' : ''}`} style={`--tile:${color}`}><Icon name={device.icon ?? iconOfKind[device.kind] ?? 'generic'} size={44} /></span>;
  if (device.kind === 'climate') {
    const cur = typeof a.current_temperature === 'number' ? a.current_temperature : null, target = draft.shown, temp = acts.find(x => x.id === 'temperature'), active = p.state !== 'off' && p.available;
    // a thermostat that is off asks first («Включить нагрев до N°?»); otherwise the tap moves the draft and a command on its way does not block the next one
    const step = (dir: 1 | -1, b: HTMLElement) => { if (!temp || target === null) return; const v = stepTarget(temp, target, dir); if (v === target) return; if (p.state === 'off') { void runner.run(device, heatOn(temp, v, t, lang), v); return; } if (stepTarget(temp, v, dir) === v) focusTwin(b, dir < 0 ? '.hm-round:last-of-type' : '.hm-round:first-of-type'); draft.push(v, x => runner.run(device, temp, x)); };
    const stuck = !p.available || target === null, atMin = !!temp && target !== null && stepTarget(temp, target, -1) === target, atMax = !!temp && target !== null && stepTarget(temp, target, 1) === target;
    const action = typeof a.hvac_action === 'string' ? a.hvac_action : null;
    return <div className={`ah-hero ah-hero-climate ${active ? 'is-on' : ''}`}>
      {/* the big number is the room's temperature or nothing: a head with no reading never shows its setpoint (a frost guard's 4°) as if it were the room's */}
      <div className="ah-hero-main" data-reading={cur === null ? 'none' : 'room'}><b>{cur === null ? '—' : <>{num(cur, lang)}<i>°</i></>}</b><small>{[cur === null && p.available ? t('state.unknown') : '', action && action !== 'off' ? optionLabel(action === 'heating' ? 'heat' : action === 'cooling' ? 'cool' : action, t) : stateText(p, t, lang).split(' · ')[0]].filter(Boolean).join(' · ')}</small></div>
      {temp && <div className="ah-target"><button type="button" className="hm-round" aria-label={t('ui.tempLower', { name: device.name })} {...held(false, offline)} disabled={stuck || atMin} onClick={ev => step(-1, ev.currentTarget as HTMLElement)}>−</button><span aria-live="polite"><small>{t('ui.target')}</small><strong>{target === null ? '—' : `${num(target, lang)}°`}</strong></span><button type="button" className="hm-round" aria-label={t('ui.tempRaise', { name: device.name })} {...held(false, offline)} disabled={stuck || atMax} onClick={ev => step(1, ev.currentTarget as HTMLElement)}>+</button></div>}
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
    const title = typeof a.media_title === 'string' && a.media_title.trim() ? a.media_title : null, src = typeof a.source === 'string' ? optionLabel(a.source, t, namesOf(host)) : null, vol = typeof a.volume_level === 'number' ? Math.round(a.volume_level * 100) : null;
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
/** AUTO-2 of the audit: the automations of HA that drive this card — name, last run, on/off dot. Read-only, nothing to tap. */
export type SheetAutomation = AutomationRow & { byRoom: boolean };
const locales: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
function whenRan(iso: string | null, lang: Lang, t: T): string {
  if (!iso) return t('auto.never'); const d = new Date(iso); if (Number.isNaN(d.getTime())) return t('auto.never');
  const now = new Date(), time = new Intl.DateTimeFormat(locales[lang], { hour: '2-digit', minute: '2-digit' }).format(d);
  if (d.toDateString() === now.toDateString()) return `${time} ${t('auto.today')}`;
  const y = new Date(now); y.setDate(now.getDate() - 1); if (d.toDateString() === y.toDateString()) return `${t('auto.yesterday')}, ${time}`;
  return new Intl.DateTimeFormat(locales[lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}
export function Automations({ rows, t, lang }: { rows: SheetAutomation[]; t: T; lang: Lang }) {
  if (!rows.length) return null;
  return <Fold title={`${t('auto.title')} (${rows.length})`}>{rows.map(a => <div className={`ah-row hm-setting at-auto-row ${a.enabled ? '' : 'is-off'}`}><span className="ah-row-icon at-auto-icon"><Icon name="settings" size={18} /></span><span className="ah-row-text"><strong>{a.name}</strong><small>{[familyDescription(a.description), a.byRoom ? t('auto.byRoom') : ''].filter(Boolean).join(' · ')}</small></span><small className="at-auto-when">{a.enabled ? whenRan(a.lastTriggered, lang, t) : t('auto.off')}<i className="at-auto-dot" aria-hidden="true" /></small></div>)}</Fold>;
}
export function DeviceSheet({ device, runner, onClose, t, lang, stage, host, room, automations = [], title }: { device: HomeDevice; runner: Runner; onClose: () => void; t: T; lang: Lang; stage?: ComponentChildren; host?: Host; room?: string; automations?: SheetAutomation[]; title?: string }) {
  const heading = shownName(title ?? device.name, device.kind, t); // the same short name as on the tile; the room stands above it, once
  const offline = host?.online === false; // the house is unreachable: said in the head in words, every command control is marked and its press tells why
  const roomShown = room && !heading.trim().toLowerCase().endsWith(room.trim().toLowerCase()) ? room : '';
  const acts = actionsFor(device), p = device.primary;
  const own = usePhoto(p.id), shot = takesPhoto(device) ? device.photo ?? own : null; // the appliance's own photo (the `photo` slot of its device) on its plate; without one, the stock scene or the glyph as before
  const toggle = acts.find(a => a.kind === 'toggle' && (a.id === 'toggle')), selects = acts.filter(a => a.kind === 'select'), sliders = acts.filter(a => a.kind === 'number' && !(device.kind === 'climate' && a.id === 'temperature')), buttons = acts.filter(a => a.kind === 'button'), otherToggles = acts.filter(a => a.kind === 'toggle' && a !== toggle);
  const head = <div className="hm-sheet-head"><span className="hm-sheet-photo"><ProductPhoto src={shot} eager>{artOf(device) ? <DeviceArt type={artOf(device)!} fill /> : <Icon name={iconOfKind[device.kind] ?? 'generic'} size={30} />}</ProductPhoto></span><div><small>{t(`kind.${device.kind}` as Key)}{roomShown ? ` · ${roomShown}` : ''}</small><h2>{heading}</h2>{offline && <span className="hm-badge tone-danger at-sheet-offline" style="justify-self:start">{t('ui.offline')}</span>}</div><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>;
  // The light card: a lamp of the room draws its own body (slider, temperature, ambient light; a relay gets the big bulb), then the readings and settings as everywhere.
  if (device.kind === 'light') return <div className="hm-sheet-body ah-sheet at-light-sheet" data-kind="light">{head}<LightBody device={device} runner={runner} t={t} lang={lang} host={host} sleepAt={parseSleep(host?.states?.()[SLEEP_MIRROR]?.state)[device.primary.id] ?? null} /><Facts device={device} t={t} lang={lang} /><Automations rows={automations} t={t} lang={lang} /><Settings device={device} runner={runner} t={t} lang={lang} host={host} offline={offline} /></div>;
  return <div className="hm-sheet-body ah-sheet" data-kind={device.kind}>
    {head}
    {stage ? <div className="hm-camera-frame at-camera-stage">{stage}</div> : <Hero device={device} runner={runner} t={t} lang={lang} host={host} offline={offline} />}
    {toggle && <PowerRow device={device} action={toggle} runner={runner} t={t} lang={lang} offline={offline} />}
    {buttons.length > 0 && <div className="hm-chips at-actions">{buttons.map(a => <button type="button" className={`hm-pill ${a.confirm ? 'is-primary' : ''}`} aria-label={`${label(a, t)}: ${heading}`} {...held(runner.busy.has(device.key), offline)} disabled={!p.available} onClick={() => { if (!runner.busy.has(device.key)) void runner.run(device, a); }}>{label(a, t)}</button>)}</div>}
    {selects.map(a => <ModeRow device={device} action={a} runner={runner} t={t} lang={lang} nameOf={namesOf(host)} offline={offline} />)}
    {(sliders.length > 0 || otherToggles.length > 0) && <div className="ah-rows">{sliders.map(a => <SliderRow device={device} action={a} runner={runner} t={t} lang={lang} offline={offline} />)}{otherToggles.map(a => <SettingRow device={device} action={a} runner={runner} t={t} lang={lang} icon="power" color={a.current === true ? '#30d158' : '#8e8e93'} offline={offline} />)}</div>}
    <Facts device={device} t={t} lang={lang} />
    <Automations rows={automations} t={t} lang={lang} />
    <Settings device={device} runner={runner} t={t} lang={lang} host={host} offline={offline} />
  </div>;
}
