/* The nas family sheet: a home NAS read like the UGREEN NAS app's dashboard (Synology's mobile overview for the order) in the panel's own look —
 * the one sentence first («Всё в порядке» / what is wrong), the free space of each volume as a bar, the drives with their health and temperature,
 * the load (processor, memory, network, fan, running time), then the pools with their drives and volumes and «Об устройстве» in folds.
 * The fan and power modes and the two power buttons are the administrator's (`host.admin`); restart and shut down each ask first, in words that
 * say what will happen. Reads only the instance's bindings and the parts (pools, drives, volumes) under its own HA device. */
import { useState } from 'preact/hooks';
import type { ApplianceSheetProps, ApplianceUi } from './types.ts';
import { readNas, sentence, issueText, sizeText, rateText, uptimeText, type NasDisk, type NasRead, type NasAction, type Issue } from './nas.profiles.ts';
import { Icon } from '../ui/primitives.tsx';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import { Fold } from '../ui/sheet.tsx';
import { Ask, type Question } from '../ui/setup.tsx';
import { useRun } from '../modules/kettle.tsx';
import { roomBeside, num, type Lang } from '../ui/format.ts';
import type { Key, T } from '../i18n/index.ts';

const w = (t: T, k: string, p?: Record<string, string | number>) => t(`nas.${k}` as Key, p);
/** A drawn NAS (two bays, the status light): the fallback when the house has no photo of it. */
export function NasArt({ tone }: { tone: 'ok' | 'warn' | 'alert' | 'off' }) {
  return <svg className={`at-nas-art is-${tone}`} viewBox="0 0 48 48" aria-hidden="true">
    <rect x="9" y="5" width="30" height="38" rx="5" className="at-nas-art-body" />
    <rect x="14" y="11" width="20" height="9" rx="2" className="at-nas-art-bay" /><rect x="14" y="23" width="20" height="9" rx="2" className="at-nas-art-bay" />
    <circle cx="18" cy="38" r="1.8" className="at-nas-art-led" />
  </svg>;
}
const toneOf = (r: NasRead): 'ok' | 'warn' | 'alert' | 'off' => !r.available ? 'off' : r.issues.some(i => i.level === 'alert') ? 'alert' : r.issues.length ? 'warn' : 'ok';
const diskWhat = (d: NasDisk, t: T) => d.type ? w(t, d.type) : '';
const deviceName = (reg: ApplianceSheetProps['registry'], id: string | null) => { const d = id ? reg.devices.find(x => x.id === id) as { name: string | null; name_by_user?: string | null } | undefined : undefined; return d ? d.name_by_user ?? d.name ?? null : null; };
/** «Прихожая · NAS (UGREEN DXP2800)» in the Hall is «NAS (UGREEN DXP2800)»: the room stands above it */
const withoutRoom = (name: string, room?: string) => { const parts = name.split(' · '); return parts.length > 1 && (!room || parts[0].trim() === room) ? parts.slice(1).join(' · ') : name; };
const OPT = (o: string) => `opt.${o.trim().toLowerCase().replace(/[\s-]+/g, '_')}`;
const optLabel = (t: T, o: string) => { const k = `nas.${OPT(o)}` as Key, v = t(k); return v === k ? o : v; };

function Hero({ r, t }: { r: NasRead; t: T }) {
  const tone = toneOf(r), more = r.issues.slice(1);
  const facts = [r.available && r.uptime !== null ? w(t, 'uptime', { v: uptimeText(r.uptime, t) }) : '', r.version ? `UGOS ${r.version}` : ''].filter(Boolean).join(' · ');
  return <section className={`at-nas-hero is-${tone}`} data-nas-tone={tone}>
    <span className="at-nas-hero-ico" aria-hidden="true"><Icon name={tone === 'ok' ? 'check' : tone === 'off' ? 'offline' : 'warning'} size={26} /></span>
    <div className="at-nas-hero-text"><p className="at-nas-say" role="status" data-nas-say>{tone === 'ok' ? w(t, 'ok') : issueText(r.issues[0], t)}</p>{facts && <small>{facts}</small>}</div>
    {more.length > 0 && <ul className="at-nas-issues" aria-label={w(t, 'problems')}>{more.map((i: Issue) => <li className={`is-${i.level}`}>{issueText(i, t)}</li>)}</ul>}
    {r.available && r.update && <small className="at-nas-update">{w(t, 'update', { v: r.update })}</small>}
  </section>;
}
function Space({ r, t, lang }: { r: NasRead; t: T; lang: Lang }) {
  if (!r.volumes.length) return null;
  return <section className="at-nas-card" aria-label={w(t, 'storage')}><h3>{w(t, 'storage')}</h3>
    {r.volumes.map(v => { const full = v.pct !== null && v.pct > 90, bad = v.answers && v.status !== null && !v.ok; return <div className={`at-nas-vol ${full ? 'is-full' : ''} ${bad ? 'is-warn' : ''}`} data-nas-volume={v.n}>
      <div className="at-nas-vol-head"><b>{w(t, 'volumeN', { n: v.n })}</b><small>{bad ? w(t, 'attention') : v.pct === null ? '—' : w(t, 'usedPct', { p: v.pct })}</small></div>
      <span className="at-nas-bar" role="meter" aria-label={w(t, 'volumeN', { n: v.n })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.pct ?? 0} aria-valuetext={v.pct === null ? '—' : `${v.pct} %`}><i style={{ width: `${Math.max(v.pct ?? 0, v.pct ? 2 : 0)}%` }} /></span>
      <small className="at-nas-vol-free">{w(t, 'free', { v: sizeText(v.free, t, lang), total: sizeText(v.free !== null && v.used !== null ? v.free + v.used : v.total, t, lang) })}</small>
    </div>; })}
  </section>;
}
const diskState = (d: NasDisk, t: T) => !d.answers ? w(t, 'noAnswer') : !d.ok ? w(t, 'attention') : d.sleeping ? w(t, 'sleeping') : w(t, 'normal');
const diskTone = (r: NasRead, d: NasDisk) => !d.answers ? 'alert' : !d.ok || r.issues.some(i => i.kind === 'diskHot' && i.n === d.n) ? 'warn' : 'ok';
function Disks({ r, t, lang }: { r: NasRead; t: T; lang: Lang }) {
  if (!r.disks.length) return null;
  return <section className="at-nas-card" aria-label={w(t, 'disks')}><h3>{w(t, 'disks')}</h3>
    <div className="at-nas-disks">{r.disks.map(d => { const tone = diskTone(r, d); return <div className={`at-nas-disk is-${tone}`} data-nas-disk={d.n}>
      <b>{w(t, 'diskN', { n: d.n })}</b>
      <small>{[diskWhat(d, t), d.temp === null ? '' : `${num(d.temp, lang, 0)}°`].filter(Boolean).join(' · ') || '—'}</small>
      <span className="at-nas-disk-state"><i aria-hidden="true" />{diskState(d, t)}</span>
    </div>; })}</div>
  </section>;
}
function Load({ r, t, lang }: { r: NasRead; t: T; lang: Lang }) {
  const pct = (v: number | null) => v === null ? '—' : `${num(v, lang, 0)} %`;
  const rows: Array<[string, string, string?]> = [];
  if (r.cpu !== null) rows.push([w(t, 'cpu'), pct(r.cpu), 'cpu']);
  if (r.ram !== null) rows.push([w(t, 'ram'), r.ramTotal ? `${pct(r.ram)} · ${sizeText(r.ramTotal, t, lang)}` : pct(r.ram), 'ram']);
  if (r.up !== null || r.down !== null) rows.push([w(t, 'net'), w(t, 'netV', { down: rateText(r.down, t, lang), up: rateText(r.up, t, lang) }), 'net']);
  if (r.cpuTemp !== null) rows.push([w(t, 'cpuTemp'), `${num(r.cpuTemp, lang, 0)}°`, 'cpuTemp']);
  r.fans.forEach((f, i) => rows.push([r.fans.length > 1 ? `${w(t, 'fanRow')} ${i + 1}` : w(t, 'fanRow'), [f.rpm === null ? '—' : w(t, 'rpm', { n: num(f.rpm, lang, 0) }), r.fanOk === null ? '' : r.fanOk ? w(t, 'normal') : w(t, 'attention')].filter(Boolean).join(' · '), 'fan']));
  if (r.ups !== null) rows.push([w(t, 'ups'), w(t, 'upsV', { p: num(r.ups, lang, 0) }), 'ups']);
  if (!rows.length) return null;
  return <section className="at-nas-card" aria-label={w(t, 'load')}><h3>{w(t, 'load')}</h3><div className="hm-facts at-nas-facts">{rows.map(([k, v, id]) => <div className="hm-fact" data-nas-load={id}><small>{k}</small><strong>{v}</strong></div>)}</div></section>;
}
function Pools({ r, t, lang }: { r: NasRead; t: T; lang: Lang }) {
  if (!r.pools.length && !r.loose.length) return null;
  const disk = (d: NasDisk) => <div className="ah-row hm-setting at-nas-row" data-nas-pool-disk={d.n}><span className="ah-row-text"><strong>{[w(t, 'diskN', { n: d.n }), diskWhat(d, t)].filter(Boolean).join(' · ')}</strong><small>{[d.model, d.size !== null ? sizeText(d.size, t, lang) : '', d.hours !== null ? `${w(t, 'hoursOn')} ${w(t, 'hours', { n: num(d.hours, lang, 0) })}` : ''].filter(Boolean).join(' · ')}</small></span><small className={`at-nas-row-state is-${diskTone(r, d)}`}>{[d.temp === null ? '' : `${num(d.temp, lang, 0)}°`, diskState(d, t)].filter(Boolean).join(' · ')}</small></div>;
  return <Fold title={w(t, 'poolsFold')}>
    {r.pools.map(p => <div className="at-nas-pool" data-nas-pool={p.n}>
      <div className="ah-row hm-setting at-nas-row is-head"><span className="ah-row-text"><strong>{[w(t, 'poolN', { n: p.n }), p.level ? p.level.toUpperCase().replace(/^RAID(\d+)$/, 'RAID $1') : ''].filter(Boolean).join(' · ')}</strong></span><small className={`at-nas-row-state is-${p.status === null ? 'ok' : p.ok ? 'ok' : 'warn'}`}>{p.status === null ? '—' : p.ok ? w(t, 'normal') : w(t, 'attention')}</small></div>
      {p.disks.map(disk)}
      {p.volumes.map(v => <div className="ah-row hm-setting at-nas-row"><span className="ah-row-text"><strong>{w(t, 'volumeN', { n: v.n })}</strong><small>{[v.fs, v.total !== null ? sizeText(v.total, t, lang) : ''].filter(Boolean).join(' · ')}</small></span><small className={`at-nas-row-state is-${v.status !== null && !v.ok ? 'warn' : 'ok'}`}>{v.status === null ? '—' : v.ok ? w(t, 'normal') : w(t, 'attention')}</small></div>)}
    </div>)}
    {r.loose.length > 0 && <div className="at-nas-pool"><div className="ah-row hm-setting at-nas-row is-head"><span className="ah-row-text"><strong>{w(t, 'loose')}</strong></span></div>{r.loose.map(disk)}</div>}
  </Fold>;
}
function About({ r, t, model }: { r: NasRead; t: T; model: string | null }) {
  const rows = [[w(t, 'model'), model], [w(t, 'os'), r.version ? `UGOS ${r.version}` : null], r.version ? [w(t, 'update', { v: '' }).replace(/\s+$/, ''), r.update ? r.update : w(t, 'upToDate')] : null].filter((x): x is [string, string | null] => !!x && !!x[1]);
  if (!rows.length) return null;
  return <Fold title={w(t, 'about')}>{rows.map(([k, v]) => <div className="ah-row hm-setting at-nas-row"><span className="ah-row-text"><strong>{k}</strong></span><small>{v}</small></div>)}</Fold>;
}
function Manage({ r, t, ui, ask }: { r: NasRead; t: T; ui: ReturnType<typeof useRun>; ask: (q: Question) => void }) {
  const sel = r.actions.filter(a => a.kind === 'select' && a.options.length), btn = r.actions.filter(a => a.kind === 'button');
  if (!sel.length && !btn.length) return null;
  const off = (a: NasAction) => !r.available || !a.answers || ui.busy !== null;
  return <section className="at-nas-card at-nas-manage" aria-label={w(t, 'manage')} data-nas-manage><h3>{w(t, 'manage')}<small>{w(t, 'manageHint')}</small></h3>
    {sel.map(a => <div className="ah-row hm-setting at-nas-row is-col" data-nas-select={a.role}><span className="ah-row-text"><strong>{w(t, a.role)}</strong></span>
      <div className="at-nas-seg" role="group" aria-label={w(t, a.role)}>{a.options.map(o => <button type="button" aria-pressed={a.current === o} className={a.current === o ? 'is-on' : ''} aria-busy={ui.busy === a.role || undefined} disabled={off(a)} onClick={() => { if (a.current !== o) void ui.run(a.role, [['select', 'select_option', { entity_id: a.entity, option: o }]]); }}>{optLabel(t, o)}</button>)}</div></div>)}
    {btn.length > 0 && <div className="at-nas-power">{btn.map(a => { const k = a.role as 'reboot' | 'shutdown'; return <button type="button" className={`hm-pill at-nas-power-btn is-${k}`} data-nas-button={k} aria-busy={ui.busy === k || undefined} disabled={off(a)} onClick={() => ask({ text: w(t, `${k}Ask`), yes: w(t, `${k}Yes`), run: () => void ui.run(k, [['button', 'press', { entity_id: a.entity }]]) })}><Icon name="power" size={18} />{w(t, k)}</button>; })}</div>}
  </section>;
}
export function NasSheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const r = readNas(registry, view.instance, host.online), ui = useRun(host, t), [question, setQuestion] = useState<Question | null>(null);
  const photo = usePhoto(view.instance.bindings.status), tone = toneOf(r);
  const dev = r.deviceId ? registry.devices.find(d => d.id === r.deviceId) : undefined;
  const heading = view.instance.name ?? (deviceName(registry, r.deviceId) ? withoutRoom(deviceName(registry, r.deviceId)!, room) : null) ?? t('cat.kind.nas' as Key);
  const roomShown = roomBeside(heading, room), model = dev?.model ? (dev.manufacturer && !dev.model.toLowerCase().startsWith(dev.manufacturer.toLowerCase()) ? `${dev.manufacturer} ${dev.model}` : dev.model) : null;
  const left = <><Hero r={r} t={t} />{r.available && <><Space r={r} t={t} lang={lang} /><Disks r={r} t={t} lang={lang} /></>}</>;
  const right = <>{r.available && <Load r={r} t={t} lang={lang} />}{r.available && <Pools r={r} t={t} lang={lang} />}<About r={r} t={t} model={model} />{host.admin && <Manage r={r} t={t} ui={ui} ask={setQuestion} />}</>;
  return <div className={`at-nas-sheet ${wide ? 'is-wide' : ''}`} data-nas-sheet={tone} aria-label={sentence(r, t)}>
    <div className="hm-sheet-head at-nas-head"><span className="at-nas-face" aria-hidden="true"><ProductPhoto src={photo} eager><NasArt tone={tone} /></ProductPhoto></span>
      <div><small>{t('cat.kind.nas' as Key)}{roomShown ? ` · ${roomShown}` : ''}</small><h2>{heading}</h2>{!host.online && <span className="hm-badge tone-danger at-sheet-offline" style="justify-self:start">{t('ui.offline')}</span>}</div>
      <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>
    {ui.err && <p className="at-nas-err" role="alert">{w(t, 'fail')}: {ui.err}</p>}
    <div className="at-nas-cols"><div className="at-nas-col">{left}</div><div className="at-nas-col">{right}</div></div>
    {question && <Ask q={question} t={t} onClose={() => setQuestion(null)} />}
  </div>;
}
export const ui: ApplianceUi = { id: 'nas', Sheet: NasSheet };
