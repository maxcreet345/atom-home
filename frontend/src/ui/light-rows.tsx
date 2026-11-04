import type { HomeDevice } from '../model/discover.ts';
import type { Runner } from './sheet.tsx';
import type { Action } from '../runtime/actions.ts';
import type { T } from '../i18n/index.ts';
import { Icon } from './primitives.tsx';
import { Switch, Section, artOf } from './cards.tsx';
import { isOn, num, type Lang } from './format.ts';
import { isDimmable, brightnessPct, kelvinOf, kelvinColor, ambientHex, nearestColor } from '../model/lights.ts';
import type { Key } from '../i18n/index.ts';

const act = (entityId: string, id: string, data?: Record<string, unknown>, service = 'turn_on', kind: Action['kind'] = 'number'): Action => ({ id, label: id, kind, domain: 'light', service, entityId, data, confirm: false, risk: 'normal' });
/** The room's lamps as a list (Apple Home «Lights» group): one row per lamp with its switch, a brightness strip under a dimmable one, and a switch for the whole room in the head. */
export function LightRows({ devices, room, runner, toggle, open, t, lang }: { devices: HomeDevice[]; room: string; runner: Runner; toggle: (d: HomeDevice) => void; open: (d: HomeDevice) => void; t: T; lang: Lang }) {
  const lit = devices.filter(d => d.primary.available && isOn(d.primary)), any = lit.length > 0;
  const all = () => { if (any) lit.forEach(toggle); else devices.filter(d => d.primary.available).forEach(toggle); };
  const name = (d: HomeDevice) => { const n = d.name.trim(), r = room.trim().toLowerCase(); if (!r) return n; const l = n.toLowerCase(); return l.endsWith(' · ' + r) ? n.slice(0, -(r.length + 3)) : l.startsWith(r + ' · ') ? n.slice(r.length + 3) : n; };
  return <Section title={t('section.lights')} className="at-light-rows-sec" action={<Switch on={any} label={t('light.allInRoom')} disabled={!devices.some(d => d.primary.available)} onToggle={all} />}>
    <div className="ah-rows at-light-rows">{devices.map(d => {
      const e = d.primary, a = e.attributes, on = e.available && isOn(e), dim = isDimmable(a), pct = brightnessPct(a), k = kelvinOf(a), busy = runner.busy.has(d.key);
      const ambient = d.controls.find((c, i) => i > 0 && c.domain === 'light' && c.available && isOn(c));
      const line = !e.available ? t('state.unavailable') : on ? [dim && pct !== null ? `${pct} %` : t('state.on'), k !== null ? `${num(k, lang, 0)} K` : null].filter(Boolean).join(' · ') : t('state.off');
      return <div className={`ah-row at-light-row ${on ? 'is-on' : ''}`} data-device-key={d.key}>
        <button type="button" className="at-light-row-hit" onClick={() => open(d)}>
          <span className="ah-row-icon at-light-row-icon" style={`--tile:${on ? '#ffcc00' : '#8e8e93'}`}><Icon name={artOf(d) === 'chandelier' ? 'chandelier' : 'light'} size={18} />{ambient && <i className="at-tile-amb" style={`--amb:${ambientHex(ambient.attributes)}`} aria-hidden="true" />}</span>
          <span className="ah-row-text"><strong>{name(d)}</strong><small>{line}</small>
            {dim && on && <input type="range" className="at-light-mini" min={1} max={100} step={1} value={pct ?? 100} aria-label={`${name(d)} · ${t('action.brightness')}`} style={`--k:${kelvinColor(k ?? 4000)}`} onClick={ev => ev.stopPropagation()} onPointerDown={ev => ev.stopPropagation()} onChange={ev => { ev.stopPropagation(); void runner.run(d, act(e.id, 'brightness', { transition: 0.3 }), Number((ev.target as HTMLInputElement).value)); }} />}
          </span>
        </button>
        <Switch on={on} pending={busy} disabled={!e.available} label={name(d)} onToggle={() => toggle(d)} />
      </div>; }).flatMap((row, i) => { const d = devices[i], amb = d.controls.find((c, j) => j > 0 && c.domain === 'light'); if (!amb) return [row];
      const aon = amb.available && isOn(amb), cur = nearestColor(amb.attributes.rgb_color), apct = brightnessPct(amb.attributes);
      return [row, <div className={`ah-row at-light-row is-ambient ${aon ? 'is-on' : ''}`} data-device-key={`${d.key}:ambient`}>
        <button type="button" className="at-light-row-hit" onClick={() => open(d)}><span className="ah-row-icon at-light-row-icon" style={`--tile:${aon ? ambientHex(amb.attributes) : '#8e8e93'}`}><Icon name="sun" size={18} /></span>
          <span className="ah-row-text"><strong>{t('light.ambient')}</strong><small>{!amb.available ? t('state.unavailable') : aon ? [cur ? t(`light.color.${cur}` as Key) : null, apct !== null ? `${apct} %` : null].filter(Boolean).join(' · ') || t('state.on') : t('state.off')}</small></span></button>
        <Switch on={aon} pending={runner.busy.has(d.key)} disabled={!amb.available} label={t('light.ambient')} onToggle={() => void runner.run(d, act(amb.id, 'toggle', undefined, 'toggle', 'toggle'), !aon)} />
      </div>]; })}</div>
  </Section>;
}
