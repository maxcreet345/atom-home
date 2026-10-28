import type { ComponentChildren } from 'preact';
import { Icon } from './primitives.tsx';
import type { HomeDevice, EntityRef, Room } from '../model/discover.ts';
import type { T } from '../i18n/index.ts';
import { stateText, isOn, num, iconOfKind, type Lang } from './format.ts';

export function StatusCard({ icon, title, value, hint, tone, onClick, aside }: { icon: string; title: string; value: string; hint: string; tone: string; onClick?: () => void; aside?: ComponentChildren }) {
  return <div className={`hm-card hm-status tone-${tone} ${aside ? 'has-aside' : ''}`} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}>
    <span className="hm-status-icon"><Icon name={icon} size={20} /></span><span className="hm-status-text"><small>{title}</small><strong>{value}</strong><em>{hint}</em></span>{aside ? <span className="hm-status-aside">{aside}</span> : null}
  </div>;
}
export function Switch({ on, pending, disabled, label, onToggle, large }: { on: boolean; pending?: boolean; disabled?: boolean; label: string; onToggle: () => void; large?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`hm-switch ${on ? 'is-on' : ''} ${pending ? 'is-pending' : ''} ${large ? 'is-large' : ''}`} disabled={disabled} onClick={e => { e.stopPropagation(); onToggle(); }}><span className="hm-switch-knob" /></button>;
}
/** Photo-less room tile: dark surface with the room's climate summary and lit lamps. */
export function RoomTile({ room, temperature, humidity, co2, lightsOn, onClick, t, lang, label }: { room: Room; temperature: number | null; humidity: number | null; co2: number | null; lightsOn: number; onClick: () => void; t: T; lang: Lang; label: string }) {
  return <button type="button" className="hm-card hm-room at-room" data-room-id={room.id} onClick={onClick} aria-label={label}>
    {room.photo ? <img className="hm-photo" src={room.photo} alt="" /> : <span className="at-room-art" aria-hidden="true"><Icon name="rooms" size={40} /></span>}
    <span className="hm-room-top"><strong>{room.name || t('room.none')}</strong>{lightsOn > 0 && <span className="hm-lit"><Icon name="light" size={14} />{lightsOn}</span>}</span>
    <span className="hm-room-bottom"><b>{temperature === null ? '—' : num(temperature, lang)}<i>°</i></b><small>{humidity === null ? '' : `${num(humidity, lang, 0)}%`}{co2 !== null ? ` · CO₂ ${num(co2, lang, 0)}` : ''}</small></span>
  </button>;
}
export function LightTile({ device, pending, onToggle, onOpen, t, lang }: { device: HomeDevice; pending: boolean; onToggle: () => void; onOpen: () => void; t: T; lang: Lang }) {
  const e = device.primary, on = isOn(e), off = !e.available;
  return <div className={`hm-card hm-light at-light ${on ? 'is-on' : ''} ${off ? 'is-off' : ''} ${pending ? 'is-pending' : ''}`} data-device-key={device.key}>
    <button type="button" className="hm-light-hit" disabled={pending || off} onClick={onToggle} aria-label={`${device.name}: ${on ? t('action.off') : t('action.on')}`}>
      <span className="at-light-art" aria-hidden="true"><Icon name="light" size={56} /></span>
      <span className="hm-light-bulb"><Icon name="light" size={26} /></span>
      <span className="hm-light-text"><strong>{device.name}</strong><small>{stateText(e, t, lang)}</small></span>
    </button>
    <button type="button" className="hm-light-more" aria-label={`${t('ui.details')}: ${device.name}`} onClick={onOpen}><Icon name="more" size={20} /></button>
  </div>;
}
export function DeviceRow({ device, name, pending, onToggle, onOpen, t, lang }: { device: HomeDevice; name?: string; pending: boolean; onToggle?: () => void; onOpen: () => void; t: T; lang: Lang }) {
  const e = device.primary, on = isOn(e), tone = !e.available ? 'is-off' : (device.kind === 'leak' && e.state === 'on') || (device.kind === 'alarm' && e.state === 'on') ? 'is-danger' : on ? 'is-on' : '';
  return <div className={`hm-row ${tone}`} data-device-key={device.key}>
    <button type="button" className="hm-row-open" onClick={onOpen} aria-label={`${t('ui.details')}: ${name ?? device.name}`}>
      <span className="hm-thumb"><Icon name={iconOfKind[device.kind] ?? 'generic'} size={22} /></span>
      <span className="hm-row-text"><strong>{name ?? device.name}</strong><small>{stateText(e, t, lang)}</small></span>
    </button>
    {onToggle ? <Switch on={on} pending={pending} disabled={!e.available} label={`${name ?? device.name}: ${on ? t('action.off') : t('action.on')}`} onToggle={onToggle} /> : <Icon name="more" size={20} />}
  </div>;
}
export function Section({ title, action, children, className = '' }: { title: string; action?: ComponentChildren; children: ComponentChildren; className?: string }) {
  return <section className={`hm-section ${className}`}><div className="hm-section-head"><h2>{title}</h2>{action}</div>{children}</section>;
}
export const metricLabel = (m: EntityRef, t: T) => { const key = `metric.${m.deviceClass ?? ''}`; const v = t(key as never); return v === key ? m.name : v; };
