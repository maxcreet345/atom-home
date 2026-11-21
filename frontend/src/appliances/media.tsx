/* The media family sheet: a TV or a TV box, drawn after the vendor's own remote apps (VIDAA RemoteNOW, SmartThings' TV card, Apple TV Remote,
 * Google TV remote) in the panel's look. Order: what is on (app or input, title, artwork) with power and play/pause → volume → the remote pad →
 * inputs / apps; picture and sound behind the gear. It reads and drives ONLY the entities bound to this card (`view.instance.bindings`): the
 * commands come from `mediaCommands` (media.profiles.ts), which knows nothing else. Power off is immediate (owner's brief: no confirmation);
 * the TV's service buttons (re-pairing, reconnect, clock sync) are not on the card at all. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ApplianceUi, ApplianceSheetProps } from './types.ts';
import { readMedia, mediaCommands, padKeysOf, sourceLabel, sourcesAreApps, type MediaAction, type PadKey } from './media.profiles.ts';
import { useRun } from '../modules/kettle.tsx';
import { Icon } from '../ui/primitives.tsx';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import { errorText, num } from '../ui/format.ts';
import type { Key, T } from '../i18n/index.ts';

const mw = (t: T, k: string, p?: Record<string, string | number>) => t(`media.${k}` as Key, p);
const has = (t: T, k: string) => t(k as Key) !== k;
/** «Cinema Night» → «Кино (ночь)»; a mode the panel has no word for (Samsung's own Russian names) stays as the TV says it */
export const modeLabel = (t: T, o: string) => { const k = `media.mode.${o.toLowerCase().replace(/[\s-]+/g, '_')}`; return has(t, k) ? t(k as Key) : o; };
const PAD_ORDER: PadKey[] = ['back', 'home', 'menu'];
const MAX_QUEUE = 6;

function TvGlyph({ box }: { box: boolean }) {
  return box ? <svg viewBox="0 0 48 48" aria-hidden="true" className="at-md-glyph"><rect x="8" y="18" width="32" height="14" rx="4" /><path d="M14 36h20" /><circle cx="34" cy="25" r="1.6" className="is-dot" /></svg>
    : <svg viewBox="0 0 48 48" aria-hidden="true" className="at-md-glyph"><rect x="5" y="9" width="38" height="24" rx="3" /><path d="M17 40h14M24 33v7" /></svg>;
}
const Arrow = ({ d }: { d: PadKey }) => <svg viewBox="0 0 24 24" aria-hidden="true" className={`at-md-arrow is-${d}`}><path d="M8 14l4-4 4 4" /></svg>;
const KeyGlyph = ({ k }: { k: PadKey }) => k === 'back' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" /></svg>
  : k === 'home' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v9H4z" /></svg>
  : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>;
const SpeakerGlyph = ({ off }: { off: boolean }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" />{off ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}</svg>;
const Prev = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6v12M19 6l-9 6 9 6z" /></svg>;
const Next = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6v12M5 6l9 6-9 6z" /></svg>;

function MediaSheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const inst = view.instance, profile = view.profile, b = inst.bindings;
  const m = readMedia(registry, inst), ui = useRun(host, t), photo = usePhoto(b.tv);
  const box = profile.kindKey === 'cat.kind.tvbox', online = host.online, live = online && (m.phase === 'on' || m.phase === 'playing' || m.phase === 'paused');
  const [screen, setScreen] = useState<'main' | 'settings'>('main');
  const send = (key: string, act: MediaAction) => ui.run(key, mediaCommands(registry, profile, inst, act));
  // the pad: taps are queued and sent one after another (an arrow pressed three times moves three times), never more than a few ahead
  const queue = useRef<PadKey[]>([]), sending = useRef(false), [padErr, setPadErr] = useState(''), alive = useRef(true), ctx = useRef({ registry, profile, inst, host });
  ctx.current = { registry, profile, inst, host };
  useEffect(() => () => { alive.current = false; queue.current = []; }, []);
  const drain = async () => {
    sending.current = true;
    while (queue.current.length && alive.current) {
      const k = queue.current.shift()!, c = ctx.current;
      try { for (const [d, s, data] of mediaCommands(c.registry, c.profile, c.inst, { k: 'pad', key: k })) await c.host.call(d, s, data); if (alive.current) setPadErr(''); }
      catch (e) { queue.current = []; if (alive.current) setPadErr(errorText(e, t)); }
    }
    sending.current = false;
  };
  const press = (k: PadKey) => { if (!host.online) { setPadErr(t('ui.offline')); return; } if (queue.current.length >= MAX_QUEUE) return; queue.current.push(k); if (!sending.current) void drain(); };
  const keys = padKeysOf(profile), padKeyLabel = (k: PadKey) => k === 'menu' && keys.menu === 'SETTINGS' ? mw(t, 'key.settings') : mw(t, `key.${k}`);
  const busy = ui.busy !== null;

  // what the hero says
  const stateWord = !online ? t('ui.offline') : m.phase === 'unavailable' ? mw(t, 'offline') : m.phase === 'off' ? mw(t, 'off') : m.phase === 'playing' ? mw(t, 'playing') : m.phase === 'paused' ? mw(t, 'paused') : mw(t, 'on');
  const big = !online || m.phase === 'unavailable' || m.phase === 'off' ? null : m.app ? (sourcesAreApps(profile.id) ? m.app : sourceLabel(t, m.app)) : mw(t, 'nothing');
  const offHint = online && m.phase === 'off' && !m.can.on ? mw(t, 'noPowerOn') : online && m.phase === 'unavailable' ? mw(t, 'offlineHint') : null;
  const hero = <section className={`at-md-hero is-${online ? m.phase : 'unavailable'} ${m.artwork && live ? 'has-art' : ''}`} aria-label={stateWord}>
    {m.artwork && live && <span className="at-md-art-bg" aria-hidden="true" style={{ backgroundImage: `url("${m.artwork.replace(/["\\]/g, '')}")` }} />}
    <div className="at-md-now">
      <span className="at-md-cover" aria-hidden="true">{m.artwork && live ? <img src={m.artwork} alt="" decoding="async" /> : <ProductPhoto src={photo} eager><TvGlyph box={box} /></ProductPhoto>}</span>
      <div className="at-md-what">
        <small role="status">{stateWord}</small>
        {big && <b>{big}</b>}
        {live && m.title && <span className="at-md-title">{m.title}</span>}
        {offHint && <span className="at-md-title">{offHint}</span>}
      </div>
    </div>
    <div className="at-md-acts">
      {live && m.can.off && <button type="button" className="at-md-power is-on" aria-label={mw(t, 'powerOff')} aria-busy={ui.busy === 'power'} disabled={busy} onClick={() => void send('power', { k: 'power', on: false })}><Icon name="power" size={22} /></button>}
      {online && m.phase === 'off' && m.can.on && <button type="button" className="hm-pill at-md-on" aria-busy={ui.busy === 'power'} disabled={busy} onClick={() => void send('power', { k: 'power', on: true })}><Icon name="power" size={20} />{mw(t, 'powerOn')}</button>}
      {live && (m.can.prev || m.can.play || m.can.next) && <div className="at-md-trans" role="group" aria-label={stateWord}>
        {m.can.prev && <button type="button" aria-label={mw(t, 'prev')} disabled={busy} onClick={() => void send('prev', { k: 'prev' })}><Prev /></button>}
        {m.can.play && <button type="button" className="is-main" aria-label={mw(t, m.phase === 'playing' ? 'pause' : 'play')} aria-busy={ui.busy === 'play'} disabled={busy} onClick={() => void send('play', { k: 'playPause' })}><Icon name={m.phase === 'playing' ? 'pause' : 'play'} size={24} /></button>}
        {m.can.next && <button type="button" aria-label={mw(t, 'next')} disabled={busy} onClick={() => void send('next', { k: 'next' })}><Next /></button>}
      </div>}
    </div>
  </section>;

  const volume = live && (m.can.volumeStep || m.can.volumeSet || m.can.mute) ? <section className="at-md-card at-md-vol" aria-label={mw(t, 'volume')}>
    <span className="at-md-vol-text"><strong>{mw(t, 'volume')}</strong><small>{m.muted ? mw(t, 'muted') : m.volume !== null ? `${num(m.volume, lang, 0)} %` : ''}</small></span>
    {m.volume !== null && <span className={`at-md-vol-bar ${m.muted ? 'is-muted' : ''}`} role="meter" aria-label={mw(t, 'volume')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.volume}><i style={{ width: `${m.volume}%` }} /></span>}
    <div className="at-md-vol-btns">
      {m.can.mute && <button type="button" className={`hm-round at-md-mute ${m.muted ? 'is-on' : ''}`} aria-pressed={!!m.muted} aria-label={mw(t, m.muted ? 'unmute' : 'mute')} disabled={busy} onClick={() => void send('mute', { k: 'mute' })}><SpeakerGlyph off={!!m.muted} /></button>}
      {(m.can.volumeStep || m.can.volumeSet) && <><button type="button" className="hm-round" aria-label={mw(t, 'quieter')} disabled={busy} onClick={() => void send('vol', { k: 'volume', dir: -1 })}>−</button>
        <button type="button" className="hm-round" aria-label={mw(t, 'louder')} disabled={busy} onClick={() => void send('vol', { k: 'volume', dir: 1 })}>+</button></>}
    </div>
  </section> : null;

  const pad = b.remote ? <section className={`at-md-card at-md-pad ${m.can.pad && online ? '' : 'is-idle'}`} aria-label={mw(t, 'remote')}>
    <h3>{mw(t, 'remote')}</h3>
    <div className="at-md-ring">
      {(['up', 'left', 'right', 'down'] as PadKey[]).filter(k => keys[k]).map(k => <button type="button" className={`at-md-dir is-${k}`} aria-label={mw(t, `key.${k}`)} disabled={!m.can.pad || !online} onClick={() => press(k)}><Arrow d={k} /></button>)}
      {keys.ok && <button type="button" className="at-md-ok" aria-label={mw(t, 'key.ok')} disabled={!m.can.pad || !online} onClick={() => press('ok')}>OK</button>}
    </div>
    <div className="at-md-keys">{PAD_ORDER.filter(k => keys[k]).map(k => <button type="button" disabled={!m.can.pad || !online} onClick={() => press(k)}><KeyGlyph k={k} /><span>{padKeyLabel(k)}</span></button>)}</div>
    {online && !m.can.pad && <p className="at-md-note">{mw(t, 'padOff')}</p>}
    {padErr && <p className="at-md-err" role="alert">{mw(t, 'fail')}: {padErr}</p>}
  </section> : null;

  const apps = sourcesAreApps(profile.id), label = (x: string) => apps ? x : sourceLabel(t, x);
  const sources = live && m.can.source ? <section className="at-md-card" aria-label={mw(t, apps ? 'apps' : 'inputs')}>
    <h3>{mw(t, apps ? 'apps' : 'inputs')}</h3>
    <div className="at-md-chips" role="radiogroup" aria-label={mw(t, apps ? 'apps' : 'inputs')}>{m.sources.map(s => { const on = s.id === m.source; return <button type="button" role="radio" aria-checked={on} className={on ? 'is-on' : ''} disabled={busy} onClick={() => { if (!on) void send('source', { k: 'source', id: s.id }); }}>{label(s.label)}{s.sub && <small>{label(s.sub)}</small>}</button>; })}</div>
  </section> : null;

  // picture and sound (behind the gear): the TV's own selects and numbers, or SmartThings' for the Samsung
  const sel = (role: string, label: string) => { const id = b[role], s = id ? registry.states[id] : undefined; if (!id || !s) return null; const opts = Array.isArray(s.attributes.options) ? s.attributes.options.filter((o): o is string => typeof o === 'string') : [], cur = s.state;
    return <div className="at-md-set is-col" data-media-set={role}><strong>{label}</strong><div className="at-md-chips" role="radiogroup" aria-label={label}>{opts.map(o => <button type="button" role="radio" aria-checked={o === cur} className={o === cur ? 'is-on' : ''} disabled={!live || busy} onClick={() => { if (o !== cur) void send(role, { k: 'select', role, option: o }); }}>{modeLabel(t, o)}</button>)}</div></div>; };
  const soundModes = m.can.soundMode && !b.soundMode ? <div className="at-md-set is-col" data-media-set="soundModeMp"><strong>{mw(t, 'soundMode')}</strong><div className="at-md-chips" role="radiogroup" aria-label={mw(t, 'soundMode')}>{m.soundModes.map(o => <button type="button" role="radio" aria-checked={o === m.soundMode} className={o === m.soundMode ? 'is-on' : ''} disabled={!live || busy} onClick={() => { if (o !== m.soundMode) void send('soundMode', { k: 'soundMode', mode: o }); }}>{modeLabel(t, o)}</button>)}</div></div> : null;
  const [draft, setDraft] = useState<Record<string, number>>({});
  const numRow = (role: string, label: string) => { const id = b[role], s = id ? registry.states[id] : undefined; if (!id || !s) return null; const a = s.attributes, v = Number(s.state), ok = Number.isFinite(v) && s.state !== '', min = typeof a.min === 'number' ? a.min : 0, max = typeof a.max === 'number' ? a.max : 100, step = typeof a.step === 'number' ? a.step : 1, shown = draft[role] ?? (ok ? v : null);
    return <label className="at-md-set is-col" data-media-set={role}><span className="at-md-set-head"><strong>{label}</strong><small>{shown === null ? '—' : num(shown, lang, 0)}</small></span>
      <input type="range" min={min} max={max} step={step} value={shown ?? min} disabled={!live || busy || shown === null} aria-label={label} onInput={e => setDraft(d => ({ ...d, [role]: Number((e.target as HTMLInputElement).value) }))} onChange={e => { const value = Number((e.target as HTMLInputElement).value); void send(role, { k: 'number', role, value }).then(() => setDraft(d => { const n = { ...d }; delete n[role]; return n; })); }} /></label>; };
  const sw = (role: string, label: string, hint: string) => { const id = b[role], s = id ? registry.states[id] : undefined; if (!id || !s) return null; const on = s.state === 'on' ? true : s.state === 'off' ? false : null;
    return <div className="at-md-set" data-media-set={role}><span className="at-md-set-head is-text"><strong>{label}</strong><small>{hint}</small></span>{on === null ? <small>{t('state.unavailable')}</small> : <button type="button" role="switch" className={`at-kt-sw at-md-sw ${on ? 'is-on' : ''}`} aria-checked={on} aria-label={label} disabled={!live || busy} onClick={() => void send(role, { k: 'switch', role, on: !on })}><i /></button>}</div>; };
  const settingsRows = [sel('pictureMode', mw(t, 'pictureMode')), sel('soundMode', mw(t, 'soundMode')), soundModes, numRow('backlight', mw(t, 'backlight')), numRow('brightness', mw(t, 'brightness')), numRow('contrast', mw(t, 'contrast')), sw('audioOnly', mw(t, 'audioOnly'), mw(t, 'audioOnlyHint'))].filter(Boolean);
  const hasSettings = settingsRows.length > 0;
  const err = ui.err && <p className="at-md-err is-top" role="alert">{mw(t, 'fail')}: {ui.err}</p>;
  const title = view.device.name;
  const head = (inner: boolean) => <div className="hm-sheet-head at-md-head">
    {inner ? <button type="button" className="hm-icon-btn at-md-back" aria-label={t('ui.back' as Key)} onClick={() => setScreen('main')}><Icon name="back" size={20} /></button> : <span className="at-md-face" aria-hidden="true"><ProductPhoto src={photo} eager><TvGlyph box={box} /></ProductPhoto></span>}
    <div>{inner ? <small>{title}</small> : room && <small>{room}</small>}<h2>{inner ? mw(t, 'picture') : title}</h2></div>
    {!inner && hasSettings && <button type="button" className="hm-icon-btn at-md-gear" aria-label={mw(t, 'picture')} onClick={() => setScreen('settings')}><Icon name="gear" size={20} /></button>}
    <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>;
  if (screen === 'settings' && hasSettings) return <div className="at-md-sheet is-settings" data-media={profile.id}>{head(true)}{err}
    <div className="at-md-body"><section className="at-md-card">{!live && <p className="at-md-note is-pad">{mw(t, 'settingsOff')}</p>}{settingsRows}</section></div></div>;
  return <div className={`at-md-sheet ${wide ? 'is-wide' : ''}`} data-media={profile.id} data-phase={online ? m.phase : 'offline'}>{head(false)}{err}
    <div className="at-md-cols"><div className="at-md-col">{hero}{volume}</div><div className="at-md-col">{pad}{sources}</div></div>
  </div>;
}
export const ui: ApplianceUi = { id: 'media', Sheet: MediaSheet };
