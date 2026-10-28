import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { HomeDevice, EntityRef, Room } from '../model/discover.ts';
import type { T } from '../i18n/index.ts';
import { stateText, isOn, num, iconOfKind, type Lang } from './format.ts';
import { stockRoomArt } from './art.ts';
import { DeviceArt, deviceArtType, DEVICE_ART_TYPES, type DeviceArtType } from './device-art.tsx';
/** Stock picture for a card: the owner's choice from the configurator, else guessed from kind and name; 'none' switches it off. */
export function artOf(device: Pick<HomeDevice, 'kind' | 'name' | 'model' | 'art'>): DeviceArtType | null { if (device.art === 'none') return null; if (device.art && (DEVICE_ART_TYPES as string[]).includes(device.art)) return device.art as DeviceArtType; return deviceArtType(device.kind, device.name, device.model ?? ''); }

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
    {(room.photo ?? stockRoomArt(room.name)) ? <img className="hm-photo" src={room.photo ?? stockRoomArt(room.name)!} alt="" decoding="async" /> : <span className="at-room-art" aria-hidden="true"><Icon name="rooms" size={40} /></span>}
    <span className="hm-room-top"><strong>{room.name || t('room.none')}</strong>{lightsOn > 0 && <span className="hm-lit"><Icon name="light" size={14} />{lightsOn}</span>}</span>
    <span className="hm-room-bottom">{temperature !== null && <b>{num(temperature, lang)}<i>°</i></b>}<small>{humidity === null ? '' : `${num(humidity, lang, 0)}%`}{co2 !== null ? ` · CO₂ ${num(co2, lang, 0)}` : ''}</small></span>
  </button>;
}
export function LightTile({ device, photo, pending, onToggle, onOpen, t, lang }: { device: HomeDevice; photo?: string | null; pending: boolean; onToggle: () => void; onOpen: () => void; t: T; lang: Lang }) {
  const e = device.primary, on = isOn(e), off = !e.available;
  return <div className={`hm-card hm-light at-light ${on ? 'is-on' : ''} ${off ? 'is-off' : ''} ${pending ? 'is-pending' : ''}`} data-device-key={device.key}>
    <button type="button" className="hm-light-hit" disabled={pending || off} onClick={onToggle} aria-label={`${device.name}: ${on ? t('action.off') : t('action.on')}`}>
      {(device.photo ?? photo) ? <img className="hm-photo" src={(device.photo ?? photo)!} alt="" loading="lazy" /> : <span className="at-light-art" aria-hidden="true">{artOf(device) ? <DeviceArt type={artOf(device)!} fill /> : <Icon name="light" size={56} />}</span>}
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
      <span className="hm-thumb">{device.photo ? <img src={device.photo} alt="" loading="lazy" /> : artOf(device) ? <DeviceArt type={artOf(device)!} fill /> : <Icon name={iconOfKind[device.kind] ?? 'generic'} size={22} />}</span>
      <span className="hm-row-text"><strong>{name ?? device.name}</strong><small>{stateText(e, t, lang)}</small></span>
    </button>
    {onToggle ? <Switch on={on} pending={pending} disabled={!e.available} label={`${name ?? device.name}: ${on ? t('action.off') : t('action.on')}`} onToggle={onToggle} /> : <Icon name="more" size={20} />}
  </div>;
}
export function Section({ title, action, children, className = '' }: { title: string; action?: ComponentChildren; children: ComponentChildren; className?: string }) {
  return <section className={`hm-section ${className}`}><div className="hm-section-head"><h2>{title}</h2>{action}</div>{children}</section>;
}
/** homeOS (Apple HomeView «Home Modular» face) tiles: square modules in a grid. An accessory module shows a large glyph, the name and a second line
 * (room for things you switch, the value for things you read). Tap = toggle when the device has one, else open; the small corner button always opens details. */
export const KIND_COLOR: Record<string, string> = { light: '#ffcc00', switch: '#30d158', socket: '#30d158', climate: '#ff9f0a', fan: '#64d2ff', cover: '#a2845e', lock: '#0a84ff', vacuum: '#5e5ce6', media: '#bf5af2', camera: '#8e8e93', weather: '#32ade6', environment: '#30d158', measurement: '#30d158', leak: '#32ade6', opening: '#0a84ff', motion: '#0a84ff', alarm: '#ff3b30', alarm_panel: '#0a84ff', valve: '#32ade6', energy: '#30d158', person: '#0a84ff', generic: '#8e8e93' };
export function tileColor(device: HomeDevice): string {
  const e = device.primary;
  if (!e.available) return '#8e8e93';
  if (device.kind === 'leak' || device.kind === 'alarm') return e.state === 'on' ? '#ff3b30' : KIND_COLOR[device.kind];
  if (device.kind === 'climate') return e.state === 'off' ? '#8e8e93' : e.state === 'cool' ? '#34aadc' : '#ff9f0a';
  if (device.kind === 'opening') return e.state === 'on' ? '#ff9f0a' : '#30d158';
  if (device.kind === 'motion') return e.state === 'on' ? '#ff9f0a' : '#8e8e93';
  if (['light', 'switch', 'socket', 'fan', 'media', 'vacuum', 'cover', 'lock'].includes(device.kind)) return isOn(e) ? KIND_COLOR[device.kind] : '#8e8e93';
  return KIND_COLOR[device.kind] ?? '#8e8e93';
}
export function tileStatus(device: HomeDevice, t: T, lang: Lang): string {
  const e = device.primary;
  if (!e.available) return t('state.unavailable');
  if (device.kind === 'climate') { const cur = typeof e.attributes.current_temperature === 'number' ? e.attributes.current_temperature : null, target = typeof e.attributes.temperature === 'number' ? e.attributes.temperature : null; return e.state === 'off' ? (cur === null ? t('state.off') : `${t('state.off')} · ${num(cur, lang)}°`) : `${target === null ? '—' : num(target, lang) + '°'}${cur === null ? '' : ` · ${num(cur, lang)}°`}`; }
  if (device.kind === 'light' && isOn(e) && typeof e.attributes.brightness === 'number') return `${t('state.on')} · ${Math.round(e.attributes.brightness / 2.55)} %`;
  return stateText(e, t, lang);
}
const READ_KINDS = ['environment', 'measurement', 'leak', 'opening', 'motion', 'person', 'weather', 'camera', 'energy', 'alarm'];
export function AccessoryTile({ device, name, sub, room, pending, onToggle, onOpen, t, lang, wide }: { device: HomeDevice; name?: string; sub?: string; room?: string; pending: boolean; onToggle?: () => void; onOpen: () => void; t: T; lang: Lang; wide?: boolean }) {
  const e = device.primary, on = isOn(e) || (device.kind === 'climate' && e.state !== 'off' && e.available), active = e.available && on && !READ_KINDS.includes(device.kind);
  const alert = e.available && (device.kind === 'leak' || device.kind === 'alarm') && e.state === 'on';
  const color = tileColor(device), label = name ?? device.name;
  // second line: the room for things you switch; the state (plus the room unless the name already ends with it) for everything else
  const roomShown = room && !label.trim().toLowerCase().endsWith(room.trim().toLowerCase()) ? room : '';
  const line2 = sub ?? (device.kind === 'climate' ? tileStatus(device, t, lang) : onToggle ? roomShown : [tileStatus(device, t, lang), roomShown].filter(Boolean).join(' · '));
  // long press (500 ms) opens details, like a press-and-hold on a HomeView module
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null), held = useRef(false);
  const down = () => { held.current = false; hold.current = setTimeout(() => { held.current = true; onOpen(); }, 500); };
  const up = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const click = () => { if (held.current) { held.current = false; return; } (onToggle ?? onOpen)(); };
  return <div className={`ah-tile hm-card ${active ? 'is-on' : ''} ${alert ? 'is-alert' : ''} ${e.available ? '' : 'is-off'} ${pending ? 'is-pending' : ''} ${wide ? 'is-wide' : ''} kind-${device.kind}`} data-device-key={device.key} style={`--tile:${color}`}>
    <button type="button" className="ah-tile-hit hm-light-hit" disabled={pending || !e.available && !!onToggle} onClick={click} onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={ev => { ev.preventDefault(); if (!held.current) onOpen(); }} aria-label={onToggle ? `${label}: ${on ? t('action.off') : t('action.on')}` : `${t('ui.details')}: ${label}`}>
      <span className="ah-glyph">{device.photo ? <img src={device.photo} alt="" loading="lazy" /> : <Icon name={device.icon ?? iconOfKind[device.kind] ?? 'generic'} size={34} />}</span>
      <span className="ah-tile-text"><strong>{label}</strong>{line2 && <small>{line2}</small>}</span>
    </button>
    <button type="button" className="ah-tile-more hm-light-more" aria-label={`${t('ui.details')}: ${label}`} onClick={onOpen}><Icon name="more" size={16} /></button>
  </div>;
}
/** 2×2 thermostat module: big target number, chevrons at the bottom corners, name and room underneath. */
export function ThermostatTile({ device, sub, target, current, onStep, onOpen, t, lang, disabled }: { device: HomeDevice; sub?: string; target: number | null; current: number | null; onStep?: (dir: 1 | -1) => void; onOpen: () => void; t: T; lang: Lang; disabled?: boolean }) {
  const e = device.primary, on = e.available && e.state !== 'off';
  return <div className={`ah-tile ah-thermo kind-climate hm-card ${on ? 'is-on' : ''} ${e.available ? '' : 'is-off'}`} data-device-key={device.key} style={`--tile:${tileColor(device)}`}>
    <button type="button" className="ah-tile-hit" onClick={onOpen} aria-label={`${t('ui.details')}: ${device.name}`}>
      <span className="ah-thermo-value">{on ? <><b>{target === null ? (current === null ? '—' : num(current, lang, 0)) : num(target, lang, target % 1 ? 1 : 0)}</b>{current !== null && target !== null && <small>{t('ui.now')} {num(current, lang)}°</small>}</> : <><b>{current === null ? '—' : num(current, lang, current % 1 ? 1 : 0)}</b>{target !== null && <small>{t('ui.target')} {num(target, lang)}°</small>}</>}</span>
      <span className="ah-tile-text"><strong>{device.name}</strong><small>{sub && !device.name.trim().toLowerCase().endsWith(sub.trim().toLowerCase()) ? sub : (on ? stateText(e, t, lang) : t('state.off'))}</small></span>
    </button>
    {onStep && <><button type="button" className="ah-chev is-down" aria-label="−" disabled={disabled || !e.available} onClick={() => onStep(-1)}><Icon name="back" size={22} /></button><button type="button" className="ah-chev is-up" aria-label="+" disabled={disabled || !e.available} onClick={() => onStep(1)}><Icon name="back" size={22} /></button></>}
  </div>;
}
/** 1×1 analog clock module with numerals (homeOS clock face). */
export function ClockTile({ now, lang }: { now: Date; lang: Lang }) {
  const h = now.getHours() % 12, m = now.getMinutes(), hourA = (h + m / 60) * 30, minA = m * 6;
  const date = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', { weekday: 'short', day: 'numeric' }).format(now);
  const pt = (angle: number, r: number) => [50 + r * Math.sin(angle * Math.PI / 180), 50 - r * Math.cos(angle * Math.PI / 180)] as const;
  const nums = Array.from({ length: 12 }, (_, i) => { const [x, y] = pt((i + 1) * 30, 37.5); return <text x={x} y={y} text-anchor="middle" dominant-baseline="central" font-size="7.2" font-weight="500">{i + 1}</text>; });
  const [hx, hy] = pt(hourA, 23), [hx0, hy0] = pt(hourA + 180, 5), [mx, my] = pt(minA, 33), [mx0, my0] = pt(minA + 180, 6);
  return <div className="ah-tile ah-clock hm-card" aria-label={`${date} ${String(now.getHours()).padStart(2, '0')}:${String(m).padStart(2, '0')}`}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" className="ah-clock-face" />
      <g className="ah-clock-nums">{nums}</g>
      <line x1={hx0} y1={hy0} x2={hx} y2={hy} className="ah-hand is-hour" />
      <line x1={mx0} y1={my0} x2={mx} y2={my} className="ah-hand is-min" />
      <circle cx="50" cy="50" r="2.2" className="ah-hand-cap" />
    </svg>
  </div>;
}
/** 1×1 scene module (owner's quick button). */
export function SceneTile({ icon, label, onClick, t }: { icon: string; label: string; onClick: () => void; t: T }) {
  return <div className="ah-tile ah-scene hm-card hm-scene hm-scene-custom"><button type="button" className="ah-tile-hit hm-scene-hit" onClick={onClick}><span className="ah-glyph hm-scene-icon"><Icon name={icon} size={34} /></span><span className="ah-tile-text"><strong>{label}</strong><small>{t('action.custom')}</small></span></button></div>;
}
/** 1×1 reading module: big value, label underneath (energy, weather, air). */
export function ValueTile({ icon, value, unit, label, sub, color, onClick, className = '' }: { icon: string; value: string; unit?: string; label: string; sub?: string; color: string; onClick?: () => void; className?: string }) {
  return <div className={`ah-tile ah-value hm-card ${className}`} style={`--tile:${color}`}><button type="button" className="ah-tile-hit" onClick={onClick} disabled={!onClick}><span className="ah-value-head"><Icon name={icon} size={18} /></span><span className={`ah-value-num ${/^[\d.,\s−-]+$/.test(value) ? '' : 'is-text'}`}><b>{value}</b>{unit && <i>{unit}</i>}</span><span className="ah-tile-text"><strong>{label}</strong>{sub && <small>{sub}</small>}</span></button></div>;
}
export function Pill({ icon, color, label, value, onClick, className = '' }: { icon: string; color: string; label: string; value: string; onClick?: () => void; className?: string }) {
  return <button type="button" className={`ah-pill ${className}`} style={`--tile:${color}`} onClick={onClick}><span className="ah-glyph is-small"><Icon name={icon} size={16} /></span><span><small>{label}</small><strong>{value}</strong></span></button>;
}
export const metricLabel = (m: EntityRef, t: T) => { const key = `metric.${m.deviceClass ?? ''}`; const v = t(key as never); return v === key ? m.name : v; };
