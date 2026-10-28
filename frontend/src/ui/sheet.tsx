import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from './primitives.tsx';
import type { HomeDevice } from '../model/discover.ts';
import type { T, Key } from '../i18n/index.ts';
import { actionsFor, type Action } from '../runtime/actions.ts';
import { stateText, isOn, num, iconOfKind, type Lang } from './format.ts';
import { metricLabel, Switch, artOf } from './cards.tsx';
import { DeviceArt } from './device-art.tsx';

export interface Runner { run(device: HomeDevice, action: Action, value?: unknown): Promise<void>; busy: ReadonlySet<string> }
export function ActionControl({ device, action, runner, t, lang }: { device: HomeDevice; action: Action; runner: Runner; t: T; lang: Lang }) {
  const label = t(action.label as Key) === action.label ? action.label : t(action.label as Key);
  const busy = runner.busy.has(device.key);
  if (action.kind === 'toggle') return <div className="hm-setting"><span>{label}</span><Switch on={action.current === true} pending={busy} disabled={!device.primary.available} label={label} onToggle={() => void runner.run(device, action, !action.current)} /></div>;
  if (action.kind === 'button') return <button type="button" className={`hm-pill ${action.confirm ? 'is-primary' : ''}`} disabled={busy || !device.primary.available} onClick={() => void runner.run(device, action)}>{label}</button>;
  if (action.kind === 'select') return <div className="hm-setting"><span>{label}</span><select value={String(action.current ?? '')} disabled={busy} onChange={e => void runner.run(device, action, (e.target as HTMLSelectElement).value)}>{!(action.options ?? []).includes(String(action.current ?? '')) && <option value="">—</option>}{(action.options ?? []).map(o => <option value={o}>{t(`state.${o}` as Key) === `state.${o}` ? o : t(`state.${o}` as Key)}</option>)}</select></div>;
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? (typeof action.current === 'number' ? action.current : action.min ?? 0);
  return <div className="hm-setting has-hint"><span>{label}<small>{num(value, lang, action.step && action.step < 1 ? 1 : 0)} {action.unit ?? ''}</small></span>
    <input type="range" min={action.min} max={action.max} step={action.step ?? 1} value={value} disabled={busy} aria-label={label} onInput={e => setDraft(Number((e.target as HTMLInputElement).value))} onChange={e => { setDraft(null); void runner.run(device, action, Number((e.target as HTMLInputElement).value)); }} />
  </div>;
}
export function DeviceSheet({ device, runner, onClose, t, lang, stage }: { device: HomeDevice; runner: Runner; onClose: () => void; t: T; lang: Lang; stage?: ComponentChildren }) {
  const actions = actionsFor(device), e = device.primary;
  const buttons = actions.filter(a => a.kind === 'button'), others = actions.filter(a => a.kind !== 'button');
  return <div className="hm-sheet-body">
    <div className="hm-sheet-head"><span className="hm-sheet-photo">{device.photo ? <img src={device.photo} alt="" /> : artOf(device) ? <DeviceArt type={artOf(device)!} fill /> : <Icon name={iconOfKind[device.kind] ?? 'generic'} size={30} />}</span><div><small>{t(`kind.${device.kind}` as Key)}{device.model ? ` · ${device.model}` : ''}</small><h2>{device.name}</h2></div><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>
    {stage && <div className="hm-camera-frame at-camera-stage">{stage}</div>}
    {!stage && <div className={`hm-big-state ${isOn(e) ? 'is-on' : ''}`}><Icon name={iconOfKind[device.kind] ?? 'generic'} size={28} /><div><strong>{stateText(e, t, lang)}</strong></div></div>}
    {buttons.length > 0 && <div className="hm-chips at-actions">{buttons.map(a => <ActionControl device={device} action={a} runner={runner} t={t} lang={lang} />)}</div>}
    {others.length > 0 && <div className="hm-fold-body">{others.map(a => <ActionControl device={device} action={a} runner={runner} t={t} lang={lang} />)}</div>}
    {device.metrics.filter(m => m.id !== e.id).length > 0 && <div className="hm-facts">{device.metrics.filter(m => m.id !== e.id).map(m => { const same = device.metrics.filter(x => x.deviceClass === m.deviceClass).length > 1; return <div className="hm-fact"><small>{same ? m.name.replace(device.name, '').replace(/^[\s—·:-]+/, '').trim() || m.name : metricLabel(m, t)}</small><strong>{stateText(m, t, lang)}</strong></div>; })}</div>}
    {device.parameters.length > 0 && <details className="hm-fold"><summary><span>{t('ui.parameters')} ({device.parameters.length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{device.parameters.map(p => <div className="hm-setting"><span>{p.name}</span><small>{stateText(p, t, lang)}</small></div>)}</div></details>}
    {device.diagnostics.length > 0 && <details className="hm-fold"><summary><span>{t('ui.diagnostics')} ({device.diagnostics.length})</span><Icon name="next" size={18} /></summary><div className="hm-fold-body">{device.diagnostics.map(p => <div className="hm-setting"><span>{p.name}</span><small>{stateText(p, t, lang)}</small></div>)}</div></details>}
  </div>;
}
