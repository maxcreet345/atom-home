import type { ComponentChildren } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './primitives.tsx';
import type { HomeDevice, EntityRef, Room } from '../model/discover.ts';
import type { T } from '../i18n/index.ts';
import { stepTarget, targetDraft, type Action, type TargetDraft } from '../runtime/actions.ts';
import { stateText, isOn, num, iconOfKind, held, shownName, roomBeside, type Lang } from './format.ts';
import { roomType } from './art.ts';
import { roomArtSvg, roomArtStyle } from './room-art.ts';
import { DeviceArt, deviceArtType, DEVICE_ART_TYPES, type DeviceArtType } from './device-art.tsx';
import { Tick } from './motion.tsx';
import { ProductPhoto, usePhoto } from './photo.tsx';
import { takesPhoto } from '../model/photos.ts';
import { glowOf, ambientHex } from '../model/lights.ts';
export { held, shownName };
/** − / + of a plain thermostat: quick taps add up into one command (`targetDraft` of runtime/actions.ts). `shown` is the draft while there is one, else the house's target. */
export function useTargetDraft(target: number | null) {
  const [local, setLocal] = useState<number | null>(null), core = useRef<TargetDraft | null>(null);
  core.current ??= targetDraft(setLocal);
  useEffect(() => { core.current!.seen(target); }, [target]);
  useEffect(() => () => core.current!.flush(), []); // leaving within the pause still sends the last value
  return { shown: local ?? target, push: (v: number, send: (v: number) => Promise<boolean>) => core.current!.push(v, send, target) };
}
/** A step button that is about to reach the device's limit becomes `disabled`; when it holds the keyboard focus, the focus goes to its twin
 * (the other direction is still possible) instead of falling to the page. */
export const focusTwin = (b: HTMLElement, twin: string) => { if ((b.getRootNode() as Document | ShadowRoot).activeElement === b) b.parentElement?.querySelector<HTMLElement>(twin)?.focus({ preventScroll: true }); };
/** Stock picture for a card: the owner's choice from the configurator, else guessed from kind and name; 'none' switches it off. */
export function artOf(device: Pick<HomeDevice, 'kind' | 'name' | 'model' | 'art'>): DeviceArtType | null { if (device.art === 'none') return null; if (device.art && (DEVICE_ART_TYPES as string[]).includes(device.art)) return device.art as DeviceArtType; return deviceArtType(device.kind, device.name, device.model ?? ''); }

export function StatusCard({ icon, title, value, hint, tone, onClick, aside }: { icon: string; title: string; value: string; hint: string; tone: string; onClick?: () => void; aside?: ComponentChildren }) {
  return <div className={`hm-card hm-status tone-${tone} ${aside ? 'has-aside' : ''}`} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}>
    <span className="hm-status-icon"><Icon name={icon} size={20} /></span><span className="hm-status-text"><small>{title}</small><strong>{value}</strong><em>{hint}</em></span>{aside ? <span className="hm-status-aside">{aside}</span> : null}
  </div>;
}
export function Switch({ on, pending, disabled, label, onToggle, large, offline }: { on: boolean; pending?: boolean; disabled?: boolean; label: string; onToggle: () => void; large?: boolean; /** the house is unreachable: marked `aria-disabled`, the press still tells why */ offline?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`hm-switch ${on ? 'is-on' : ''} ${pending ? 'is-pending' : ''} ${large ? 'is-large' : ''}`} aria-busy={pending || undefined} aria-disabled={offline || undefined} disabled={disabled} onClick={e => { e.stopPropagation(); onToggle(); }}><span className="hm-switch-knob" /></button>;
}
/** Photo-less room tile: dark surface with the room's climate summary and lit lamps. */
/** A room's tile: its name, its lamps that are on, its temperature and humidity. The owner's own photo of the room when he set one (a dark
 * veil under white words, as before); otherwise the room's drawn picture (1.27.0, room-art.ts) on the room's own soft ground, in the theme's
 * version. The drawn tile is composed (`.ra-box`, atom.css): the name has the top, the readings the bottom left, and the picture takes the
 * space they leave — beside the readings on a wide tile, between the name and the readings on a tall one — standing at its right and bottom.
 * No word lies on the drawing (qa-nav measures every drawn shape against the words). */
export function RoomTile({ room, temperature, humidity, co2, lightsOn, onClick, t, lang, label, theme = 'light' }: { room: Room; temperature: number | null; humidity: number | null; co2: number | null; lightsOn: number; onClick: () => void; t: T; lang: Lang; label: string; theme?: 'light' | 'dark' }) {
  // a photo that does not load (the house was unreachable when it was asked for, the file is gone) gives way to the drawn picture — never the browser's broken-image mark
  const [failed, setFailed] = useState<string[]>([]);
  const own = room.photo && !failed.includes(room.photo) ? room.photo : null, kind = roomType(room.name) ?? 'other', uid = useId();
  const svg = useMemo(() => own ? '' : roomArtSvg(kind, theme, false, uid), [own, kind, theme, uid]);
  // the lamps that are on stand before the name in the markup: on a slim tile they float to its right and the name wraps under them
  const top = <span className="hm-room-top">{lightsOn > 0 && <span className="hm-lit"><Icon name="light" size={14} />{lightsOn}</span>}<strong>{room.name || t('room.none')}</strong></span>;
  const bottom = <span className="hm-room-bottom">{temperature !== null && <b>{num(temperature, lang)}<i>°</i></b>}<small>{humidity === null ? '' : `${num(humidity, lang, 0)}%`}{co2 !== null ? <span className="hm-room-co2">{`${humidity === null ? '' : ' · '}CO₂ ${num(co2, lang, 0)}`}</span> : ''}</small></span>;
  if (own) return <button type="button" className="hm-card hm-room at-room is-photo" data-room-id={room.id} onClick={onClick} title={label}>
    <img className="hm-photo" key={own} src={own} width={960} height={640} alt="" decoding="async" loading="lazy" onError={() => setFailed(f => f.includes(own) ? f : [...f, own])} />{top}{bottom}
  </button>;
  return <button type="button" className={`hm-card hm-room at-room is-art ra-${kind}`} data-room-id={room.id} data-art={kind} onClick={onClick} title={label} style={roomArtStyle(kind, theme)}>
    <span className="ra-box">{top}<span className="ra-pic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />{bottom}</span>
  </button>;
}
export function LightTile({ device, photo, pending, onToggle, onOpen, t, lang }: { device: HomeDevice; photo?: string | null; pending: boolean; onToggle: () => void; onOpen: () => void; t: T; lang: Lang }) {
  const e = device.primary, on = isOn(e), off = !e.available;
  // the lamp's own product photo stands on its plate in place of the drawing (not while it has no connection); a picture handed in (`photo`) still fills the card
  const own = usePhoto(e.id), shot = off ? null : device.photo ?? own, art = artOf(device);
  return <div className={`hm-card hm-light at-light ${on ? 'is-on' : ''} ${off ? 'is-off' : ''} ${pending ? 'is-pending' : ''}`} data-device-key={device.key}>
    <button type="button" className="hm-light-hit" {...held(pending)} disabled={off} onClick={() => { if (!pending) onToggle(); }}>
      {photo && !shot ? <img className="hm-photo" src={photo} width={960} height={640} alt="" loading="lazy" /> : <span className="at-light-art" aria-hidden="true"><ProductPhoto src={shot}>{art ? <DeviceArt type={art} fill /> : <Icon name="light" size={56} />}</ProductPhoto></span>}
      <span className="hm-light-bulb"><Icon name="light" size={26} /></span>
      <span className="hm-light-text"><strong>{device.name}</strong><small>{stateText(e, t, lang)}</small></span>
    </button>
    <button type="button" className="hm-light-more" aria-label={`${t('ui.details')}: ${device.name}`} onClick={onOpen}><Icon name="more" size={20} /></button>
  </div>;
}
export function DeviceRow({ device, name, pending, onToggle, onOpen, t, lang }: { device: HomeDevice; name?: string; pending: boolean; onToggle?: () => void; onOpen: () => void; t: T; lang: Lang }) {
  const e = device.primary, on = isOn(e), tone = !e.available ? 'is-off' : (device.kind === 'leak' && e.state === 'on') || (device.kind === 'alarm' && e.state === 'on') ? 'is-danger' : on ? 'is-on' : '';
  // the appliance's own photo on its plate; «нет связи» and an alarm keep their pictogram (a product photo there would say «всё хорошо»)
  const own = usePhoto(e.id), shot = tone === 'is-off' || tone === 'is-danger' || !takesPhoto(device) ? null : device.photo ?? own; // a sensor, a relay, a plug keeps its pictogram (owner, 11.11.2026)
  return <div className={`hm-row ${tone}`} data-device-key={device.key}>
    <button type="button" className="hm-row-open" onClick={onOpen}>
      <span className="hm-thumb"><ProductPhoto src={shot}>{artOf(device) ? <DeviceArt type={artOf(device)!} fill /> : <Icon name={iconOfKind[device.kind] ?? 'generic'} size={22} />}</ProductPhoto></span>
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
  if (device.kind === 'light' && isOn(e) && typeof e.attributes.brightness === 'number') return `${t('mode.on')} · ${Math.max(1, Math.round(e.attributes.brightness / 2.55))} %`;
  return stateText(e, t, lang);
}
const READ_KINDS = ['environment', 'measurement', 'leak', 'opening', 'motion', 'person', 'weather', 'camera', 'energy', 'alarm'];
export function AccessoryTile({ device, name, sub, room, pending, onToggle, onOpen, t, lang, wide }: { device: HomeDevice; name?: string; sub?: string; room?: string; pending: boolean; onToggle?: () => void; onOpen: () => void; t: T; lang: Lang; wide?: boolean }) {
  const e = device.primary, on = isOn(e) || (device.kind === 'climate' && e.state !== 'off' && e.available), active = e.available && on && !READ_KINDS.includes(device.kind);
  const alert = e.available && (device.kind === 'leak' || device.kind === 'alarm') && e.state === 'on';
  const color = tileColor(device), ownName = shownName(device.name, device.kind, t), label = shownName(name ?? device.name, device.kind, t);
  // second line: the room for things you switch; the state (plus the room unless the name already ends with it) for everything else
  const roomShown = roomBeside(label, room);
  // a thing you switch says «Вкл · Ванная» / «Выкл · Ванная»: on or off is never told by the glyph's colour alone, and an unknown state is not «off»
  const switched = !e.available ? t('state.unavailable') : e.state === 'on' ? t('mode.on') : e.state === 'off' ? t('mode.off') : tileStatus(device, t, lang);
  const line2 = sub ?? (device.kind === 'climate' || device.kind === 'light' ? tileStatus(device, t, lang) : onToggle ? [switched, roomShown].filter(Boolean).join(' · ') : [tileStatus(device, t, lang), roomShown].filter(Boolean).join(' · '));
  // where the page's heading carries the room («Свет» under «Ванная»), assistive tech gets the device's full name: eight buttons «Свет» tell nothing apart
  const full = label !== ownName && ownName ? ownName : label;
  // long press (500 ms) opens details, like a press-and-hold on a HomeView module
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null), longPress = useRef(false);
  const down = () => { longPress.current = false; hold.current = setTimeout(() => { longPress.current = true; onOpen(); }, 500); };
  const up = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const click = () => { if (longPress.current) { longPress.current = false; return; } if (pending && onToggle) return; /* its command is on its way: the press is ignored, the focus stays */ (onToggle ?? onOpen)(); };
  const ambient = device.kind === 'light' ? device.controls.find((c, i) => i > 0 && c.domain === 'light' && c.available && isOn(c)) : undefined; // the lamp's lit ambient light: a coloured dot on the tile
  // the appliance's own photo (its device's `photo` slot) on a plate in the glyph's place; «нет связи» and an alarm keep their glyph — a product photo there would say «всё хорошо»
  const own = usePhoto(e.id), shot = e.available && !alert && takesPhoto(device) ? device.photo ?? own : null; // a sensor, a relay, a plug keeps its pictogram (owner, 11.11.2026)
  return <div className={`ah-tile hm-card ${active ? 'is-on' : ''} ${alert ? 'is-alert' : ''} ${e.available ? '' : 'is-off'} ${pending ? 'is-pending' : ''} ${wide ? 'is-wide' : ''} kind-${device.kind}`} data-device-key={device.key} style={`--tile:${color}${device.kind === 'light' ? `;--glow:${glowOf(e.attributes).toFixed(2)}` : ''}`}>
    {ambient && <i className="at-tile-amb" style={`--amb:${ambientHex(ambient.attributes)}`} aria-hidden="true" />}
    <button type="button" className="ah-tile-hit hm-light-hit" aria-label={full !== label ? `${full}${line2 ? `: ${line2}` : ''}` : undefined} aria-pressed={onToggle && e.available && (e.state === 'on' || e.state === 'off') ? e.state === 'on' : undefined} {...held(pending && !!onToggle)} disabled={!e.available && !!onToggle} onClick={click} onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={ev => { ev.preventDefault(); if (!longPress.current) onOpen(); }}>
      <span className="ah-glyph"><ProductPhoto src={shot}><Icon name={device.icon ?? (device.kind === 'light' && artOf(device) === 'chandelier' ? 'chandelier' : iconOfKind[device.kind]) ?? 'generic'} size={34} /></ProductPhoto></span>
      <span className="ah-tile-text"><strong>{label}</strong>{line2 && <small><Tick value={line2} /></small>}</span>
    </button>
    {/* a tile with nothing to switch opens its sheet itself: «Подробнее» would be a second Tab stop for the same action, so it stays for the pointer only */}
    <button type="button" className="ah-tile-more hm-light-more" aria-label={`${t('ui.details')}: ${full}`} tabIndex={onToggle ? undefined : -1} aria-hidden={onToggle ? undefined : 'true'} onClick={onOpen}><Icon name="more" size={16} /></button>
  </div>;
}
/** 2×2 thermostat module: big target number, chevrons at the bottom corners, name and room underneath. */
export function ThermostatTile({ device, name, sub, target: houseTarget, current, steps, onOpen, t, lang }: { device: HomeDevice; name?: string; sub?: string; target: number | null; current: number | null; /** − / +: the device's range and step, `send` (resolves true when the house accepted the target); `ask` instead of the draft for a thermostat that is off — the tap asks «Включить нагрев до N°?» */ steps?: { range: Pick<Action, 'min' | 'max' | 'step'>; send: (v: number) => Promise<boolean>; ask?: (v: number) => void }; onOpen: () => void; t: T; lang: Lang }) {
  const e = device.primary, on = e.available && e.state !== 'off';
  // C3 of the audit: the big number is always the room temperature; the mode and the target are the second line.
  // A head with no reading says «нет данных»: its setpoint (a frost-guard 4°) is never shown as if it were the room's temperature.
  // quick taps add up: the draft is shown at once, one command with the last value goes out after a pause; a command on its way never blocks the next tap
  const draft = useTargetDraft(houseTarget), target = draft.shown;
  const stepped = useRef(0), own = name ?? device.name, label = sub && !own.trim().toLowerCase().endsWith(sub.trim().toLowerCase()) ? `${own} · ${sub}` : own; // five «Радиатор» are told apart by their rooms
  const big = current, mode = !e.available ? t('state.unavailable') : on ? stateText(e, t, lang).split(' · ')[0] : t('mode.off');
  const line = target === null ? mode : `${mode} · ${t('ui.target')} ${num(target, lang)}°`;
  return <div className={`ah-tile ah-thermo kind-climate hm-card ${on ? 'is-on' : ''} ${e.available ? '' : 'is-off'}`} data-device-key={device.key} style={`--tile:${tileColor(device)}`}>
    <button type="button" className="ah-tile-hit" onClick={onOpen}>
      <span className="ah-thermo-value" data-reading={big === null ? 'none' : 'room'}>{big === null ? <b className="is-text">{e.available ? t('state.unknown') : '—'}</b> : <b><Tick value={num(big, lang, big % 1 ? 1 : 0)} />°</b>}<small><Tick value={line} /></small></span>
      <span className="ah-tile-text"><strong>{name ?? device.name}</strong><small>{sub && !(name ?? device.name).trim().toLowerCase().endsWith(sub.trim().toLowerCase()) ? sub : ''}</small></span>
    </button>
    {steps && <>{([[-1, 'is-down', 'ui.tempLower'], [1, 'is-up', 'ui.tempRaise']] as const).map(([dir, cls, key]) => { const next = target === null ? null : stepTarget(steps.range, target, dir), end = next === null || next === target; /* at the device's limit (a radiator at its 4°) there is nothing to do: off, as in the sheet */
      return <button type="button" className={`ah-chev ${cls}`} aria-label={t(key, { name: label })} disabled={!e.available || end} onClick={ev => { if (next === null || end) return; const b = ev.currentTarget as HTMLElement; b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); stepped.current = Date.now(); if (steps.ask) { steps.ask(next); return; } if (stepTarget(steps.range, next, dir) === next) focusTwin(b, dir < 0 ? '.ah-chev.is-up' : '.ah-chev.is-down'); draft.push(next, steps.send); }}><Icon name="back" size={22} /></button>; })}
      <span className="at-vh" aria-live="polite">{target !== null && Date.now() - stepped.current < 8000 ? `${t('ui.target')} ${num(target, lang)}°` : null}</span></>}
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
export function SceneTile({ icon, label, onClick, t, busy, done }: { icon: string; label: string; onClick: () => void; t: T; /** the house has just accepted the command: «Готово» for a moment (a refusal is the shell's toast) */ done?: boolean; /** the command is on its way: the tile waits like a lamp's does, and a second tap sends nothing */ busy?: boolean }) {
  return <div className={`ah-tile ah-scene hm-card hm-scene hm-scene-custom ${busy ? 'is-pending' : ''} ${done && !busy ? 'is-done' : ''}`}><button type="button" className="ah-tile-hit hm-scene-hit" {...held(busy)} onClick={() => { if (!busy) onClick(); }}><span className="ah-glyph hm-scene-icon"><Icon name={icon} size={34} /></span><span className="ah-tile-text"><strong>{label}</strong><small aria-live="polite">{busy ? t('ui.sending') : done ? t('ui.done') : t('ui.scene')}</small></span></button></div>;
}
/** 1×1 reading module: big value, label underneath (energy, weather, air). */
export function ValueTile({ icon, value, unit, label, sub, color, onClick, className = '' }: { icon: string; value: string; unit?: string; label: string; sub?: string; color: string; onClick?: () => void; className?: string }) {
  return <div className={`ah-tile ah-value hm-card ${className}`} style={`--tile:${color}`}><button type="button" className="ah-tile-hit" onClick={onClick} disabled={!onClick}><span className="ah-value-head"><Icon name={icon} size={18} /></span><span className={`ah-value-num ${/^[\d.,\s−-]+$/.test(value) ? '' : 'is-text'}`}><b><Tick value={value} /></b>{unit && <i>{unit}</i>}</span><span className="ah-tile-text"><strong>{label}</strong>{sub && <small>{sub}</small>}</span></button></div>;
}
export function Pill({ icon, color, label, value, onClick, className = '' }: { icon: string; color: string; label: string; value: string; onClick?: () => void; className?: string }) {
  return <button type="button" className={`ah-pill ${className}`} style={`--tile:${color}`} onClick={onClick}><span className="ah-glyph is-small"><Icon name={icon} size={16} /></span><span><small>{label}</small><strong>{value}</strong></span></button>;
}
export const metricLabel = (m: EntityRef, t: T) => { const key = `metric.${m.deviceClass ?? ''}`; const v = t(key as never); return v === key ? m.name : v; };
/** A device model as text, or null for an integration's technical id («roborock.vacuum.s5e», «chuangmi.camera.…»): tiles and sheets never print that. */
export { readableModel as modelText } from '../model/vacuum.ts';
