/* The «speaker» family's sheet: a Yandex Station after the «Дом с Алисой» app's speaker screen — what plays (cover, track, artist) with pause and
 * the tracks, the volume, «Сказать Алисе», the sound, the station's next alarm, the socket it stands on; and a Station Mini 2 turned into Home
 * Assistant's voice assistant (pulsar): what it is doing, the volume, the microphones and the ring light, its own settings for an administrator.
 * Every command comes from `speakerCommands(view.instance)`: the card drives only the entities bound to it (two Minis — two cards, two players). */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ApplianceSheetProps, ApplianceUi } from './types.ts';
import { readSpeaker, speakerCommands, artOf, tidyName, whenText, SAY_MAX, type SpeakerRead, type Step } from './speaker.profiles.ts';
import { useRun } from '../modules/kettle.tsx';
import { Icon } from '../ui/primitives.tsx';
import { ProductPhoto, usePhoto } from '../ui/photo.tsx';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';

const w = (t: T, k: string, p?: Record<string, string | number>) => t(`speaker.${k}` as Key, p);
/** a word of the dictionary for an option of the station, else the option as the station says it («Алиса», «Яндекс») */
const optWord = (t: T, group: string, o: string) => { const k = `speaker.${group}.${o.toLowerCase().replace(/[\s-]+/g, '_')}` as Key, v = t(k); return v === k ? o : v; };
const mmss = (s: number) => { const x = Math.max(0, Math.floor(s)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };

/** Our own drawing of the station: the Max a fabric box with its screen, the Lite a low puck with its ring, the Mini a small puck. */
export function SpeakerArt({ kind, lit }: { kind: 'max' | 'lite' | 'mini'; lit?: boolean }) {
  return <svg className={`at-sp-art is-${kind} ${lit ? 'is-lit' : ''}`} viewBox="0 0 120 120" aria-hidden="true">
    <ellipse cx="60" cy="108" rx="40" ry="5" className="at-sp-art-shadow" />
    {kind === 'max' ? <>
      <rect x="22" y="20" width="76" height="84" rx="12" className="at-sp-art-body" />
      <rect x="32" y="32" width="56" height="26" rx="6" className="at-sp-art-screen" />
      {lit && <g className="at-sp-art-bars">{[0, 1, 2, 3, 4].map(i => <rect x={40 + i * 8} y={40 + (i % 2) * 4} width="4" height={10 - (i % 2) * 4} rx="1.5" />)}</g>}
      <path d="M30 70h60M30 78h60M30 86h60M30 94h60" className="at-sp-art-grille" />
    </> : kind === 'lite' ? <>
      <path d="M18 66c0-10 19-16 42-16s42 6 42 16v18c0 10-19 16-42 16s-42-6-42-16z" className="at-sp-art-body" />
      <ellipse cx="60" cy="66" rx="42" ry="16" className="at-sp-art-top" />
      <ellipse cx="60" cy="66" rx="30" ry="10" className="at-sp-art-ring" />
    </> : <>
      <path d="M26 64c0-8 15-13 34-13s34 5 34 13v20c0 8-15 13-34 13s-34-5-34-13z" className="at-sp-art-body" />
      <ellipse cx="60" cy="64" rx="34" ry="13" className="at-sp-art-top" />
      <ellipse cx="60" cy="64" rx="22" ry="8" className="at-sp-art-ring" />
      <circle cx="60" cy="64" r="3" className="at-sp-art-dot" />
    </>}
  </svg>;
}
type GlyphName = 'prev' | 'next' | 'play' | 'pause' | 'vol' | 'mute' | 'shuffle' | 'repeat' | 'repeatOne' | 'mic' | 'micOff' | 'send' | 'speak';
function G({ n, size = 22 }: { n: GlyphName; size?: number }) {
  const d: Record<GlyphName, ComponentChildren> = {
    prev: <><path d="M6 5v14" /><path d="M19 5 9 12l10 7z" fill="currentColor" /></>, next: <><path d="M18 5v14" /><path d="m5 5 10 7-10 7z" fill="currentColor" /></>,
    play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />, pause: <><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></>,
    vol: <><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>, mute: <><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
    shuffle: <><path d="M4 7h3.5c3 0 4 10 7 10H20M4 17h3.5c1.2 0 2-1.5 2.7-3.2M14.5 7H20" /><path d="m17.5 4.5 2.5 2.5-2.5 2.5M17.5 14.5l2.5 2.5-2.5 2.5" /></>,
    repeat: <><path d="M5 11V9a2 2 0 0 1 2-2h12M19 13v2a2 2 0 0 1-2 2H5" /><path d="m16.5 4.5 2.5 2.5-2.5 2.5M7.5 14.5 5 17l2.5 2.5" /></>,
    repeatOne: <><path d="M5 11V9a2 2 0 0 1 2-2h12M19 13v2a2 2 0 0 1-2 2H5" /><path d="m16.5 4.5 2.5 2.5-2.5 2.5M7.5 14.5 5 17l2.5 2.5" /><path d="M11.5 10.5 12.5 10v4" /></>,
    mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20" /></>, micOff: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20M4 4l16 16" /></>,
    send: <path d="M4 12 20 4l-4 16-4-6.5z" />, speak: <><path d="M5 5h14v10H10l-4 4v-4H5z" /><path d="M9 9.5h6M9 12h4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d[n]}</svg>;
}
/** A switch row in the kettle's style; a switch that says nothing is never «off»: the row says so in words */
function SwitchRow({ label, hint, on, busy, disabled, onSet, attr }: { label: string; hint?: string; on: boolean | null; busy: boolean; disabled: boolean; onSet: (v: boolean) => void; attr: string }) {
  return <div className="ah-row hm-setting at-kt-row" data-speaker-switch={attr}><span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
    {on === null ? <small className="at-sp-unknown">—</small> : <button type="button" role="switch" className={`at-kt-sw ${on ? 'is-on' : ''}`} aria-checked={on} aria-label={label} aria-busy={busy} disabled={disabled} onClick={() => onSet(!on)}><i /></button>}</div>;
}
function SelectRow({ label, hint, value, options, word, disabled, onPick, attr, t }: { label: string; hint?: string; value: string | null; options: string[]; word: (o: string) => string; disabled: boolean; onPick: (o: string) => void; attr: string; t: T }) {
  return <label className="ah-row hm-setting at-kt-row at-sp-select" data-speaker-select={attr}><span className="ah-row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
    <select value={value ?? ''} disabled={disabled} aria-label={label} onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v && v !== value) onPick(v); }}>
      {(value === null || !options.includes(value)) && <option value="">{w(t, 'eqUnknown')}</option>}
      {options.map(o => <option value={o}>{word(o)}</option>)}</select></label>;
}
/** a question before what cannot be undone by a tap (the station's power, a restart) */
function Ask({ text, yes, t, onYes, onNo }: { text: string; yes: string; t: T; onYes: () => void; onNo: () => void }) {
  return <div className="at-sp-ask" role="alertdialog" aria-label={text}><p>{text}</p><div><button type="button" className="hm-pill" onClick={onNo}>{w(t, 'cancel')}</button><button type="button" className="hm-pill is-danger at-sp-yes" onClick={onYes}>{yes}</button></div></div>;
}

export function SpeakerSheet({ view, registry, host, t, lang, onClose, room, wide }: ApplianceSheetProps) {
  const r: SpeakerRead = readSpeaker(registry, view.instance, host.online), cmd = speakerCommands(view.instance), ui = useRun(host, t);
  const photo = usePhoto(r.satellite ? view.instance.bindings.satellite : r.player), kind = artOf(view.profile.id);
  const [ask, setAsk] = useState<null | 'plug' | 'restart'>(null), [screen, setScreen] = useState<'main' | 'settings'>('main');
  const [say, setSay] = useState(''), [note, setNote] = useState(''), [vol, setVol] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { ui.seen(); }, [r.phase, r.plug?.on]);
  useEffect(() => { setVol(null); }, [r.volume]);
  useEffect(() => { if (!note) return; const i = setTimeout(() => setNote(''), 3500); return () => clearTimeout(i); }, [note]);
  // the track's time runs on while it plays (HA sends the position only now and then)
  useEffect(() => { if (r.phase !== 'playing' || r.duration === null) return; const i = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(i); }, [r.phase, r.duration]);
  const off = !r.available, busy = ui.busy !== null;
  const send = (key: string, steps: Step[], hold = 0) => { if (steps.length) void ui.run(key, steps, hold); };
  const name = tidyName(view.device.name);
  const status = off ? w(t, 'offline') : r.alice === 'listening' || r.alice === 'speaking' || r.alice === 'busy' ? w(t, `alice.${r.alice}`) : r.satellite && r.assist ? w(t, `assist.${r.assist}`) : r.phase === 'playing' ? w(t, 'playing') : r.phase === 'paused' ? w(t, 'paused') : r.phase === 'off' ? w(t, 'off') : w(t, 'silent');
  const head = (title: string, back?: () => void) => <div className="hm-sheet-head at-kt-head at-sp-head">
    {back ? <button type="button" className="hm-icon-btn at-kt-back" aria-label={t('ui.back')} onClick={back}><Icon name="back" size={20} /></button> : <span className="at-sp-face" aria-hidden="true"><ProductPhoto src={photo} eager><SpeakerArt kind={kind} /></ProductPhoto></span>}
    <div><small>{back ? name : [room, t(view.profile.kindKey as Key)].filter(Boolean).join(' · ')}</small><h2>{title}</h2>{!host.online && <span className="hm-badge tone-danger at-sheet-offline" style="justify-self:start">{t('ui.offline')}</span>}</div>
    {!back && r.satellite && host.admin && <button type="button" className="hm-icon-btn at-kt-gear" aria-label={w(t, 'settings')} onClick={() => setScreen('settings')}><Icon name="gear" size={20} /></button>}
    <button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>;
  const err = ui.err && <p className="at-kt-err" role="alert">{w(t, 'fail')}: {ui.err}</p>;

  // ---- what plays ----
  const pos = r.position !== null && r.duration ? Math.min(r.duration, r.position + (r.phase === 'playing' && r.positionAt ? (Date.now() - r.positionAt) / 1000 : 0)) : null;
  const playing = r.phase === 'playing', music = playing || r.phase === 'paused';
  const transport = r.player && !off && (r.can.playPause || r.can.next || r.can.prev) && <div className="at-sp-transport">
    {r.can.shuffle && <button type="button" className={`at-sp-mini ${r.shuffle ? 'is-on' : ''}`} aria-pressed={r.shuffle === true} aria-label={w(t, 'shuffle')} disabled={busy} onClick={() => send('shuffle', cmd.shuffle(!r.shuffle))}><G n="shuffle" size={20} /></button>}
    <button type="button" className="at-sp-skip" aria-label={w(t, 'prev')} disabled={!r.can.prev || busy} onClick={() => send('prev', cmd.prev())}><G n="prev" size={26} /></button>
    <button type="button" className="at-sp-play" aria-label={playing ? w(t, 'pause') : w(t, 'play')} aria-busy={ui.busy === 'play'} disabled={!r.can.playPause || busy} onClick={() => send('play', cmd.playPause(), 4000)}><G n={playing ? 'pause' : 'play'} size={30} /></button>
    <button type="button" className="at-sp-skip" aria-label={w(t, 'next')} disabled={!r.can.next || busy} onClick={() => send('next', cmd.next())}><G n="next" size={26} /></button>
    {r.can.repeat && <button type="button" className={`at-sp-mini ${r.repeat !== 'off' ? 'is-on' : ''}`} aria-pressed={r.repeat !== 'off'} aria-label={r.repeat === 'one' ? w(t, 'repeatOne') : w(t, 'repeat')} disabled={busy} onClick={() => send('repeat', cmd.repeat(r.repeat === 'off' ? 'all' : r.repeat === 'all' ? 'one' : 'off'))}><G n={r.repeat === 'one' ? 'repeatOne' : 'repeat'} size={20} /></button>}
  </div>;
  const plugOff = r.plug?.on === false;
  const hero = <section className={`at-sp-hero is-${r.phase} ${r.satellite ? 'is-voice' : ''} ${r.alice && r.alice !== 'idle' || r.assist && r.assist !== 'idle' ? 'is-alive' : ''}`} data-phase={r.phase}>
    <span className={`at-sp-cover ${r.cover ? 'has-cover' : ''}`}>{r.cover ? <ProductPhoto src={r.cover} eager><SpeakerArt kind={kind} lit /></ProductPhoto> : <ProductPhoto src={photo} eager><SpeakerArt kind={kind} lit={playing} /></ProductPhoto>}</span>
    <div className="at-sp-now">
      <small className="at-sp-status" role="status">{status}</small>
      {music && r.title ? <><b className="at-sp-title">{r.title}</b>{r.artist && <span className="at-sp-artist">{r.artist}</span>}</>
        : off ? <><b className="at-sp-title">{plugOff ? w(t, 'offlinePlug') : name}</b><span className="at-sp-artist">{plugOff ? '' : w(t, 'offlineHint')}</span></>
        : r.satellite ? <b className="at-sp-title">{r.hwMute === true || r.mics?.on === false ? w(t, 'tile.micsOff') : w(t, 'tile.ready')}</b>
        : <><b className="at-sp-title">{w(t, 'silent')}</b><span className="at-sp-artist">{w(t, 'silentHint')}</span></>}
      {pos !== null && r.duration ? <div className="at-sp-time"><span className="at-sp-bar" role="progressbar" aria-label={r.title ?? status} aria-valuemin={0} aria-valuemax={Math.round(r.duration)} aria-valuenow={Math.round(pos)}><i style={{ width: `${Math.round(100 * pos / r.duration)}%` }} /></span><small><span>{mmss(pos)}</span><span>{mmss(r.duration)}</span></small></div> : null}
    </div>
    {transport}
    {off && plugOff && r.plug && <button type="button" className="hm-pill is-primary at-sp-wake" disabled={busy || !host.online} aria-busy={ui.busy === 'plug'} onClick={() => send('plug', cmd.plug(true), 6000)}>{t('ui.turnOn')}</button>}
  </section>;
  const volPct = vol ?? (r.volume === null ? null : Math.round(r.volume * 100));
  const volume = r.player && (r.can.volume || r.can.mute) && <div className="at-kt-card at-sp-vol" role="group" aria-label={w(t, 'volume')}>
    <button type="button" className={`at-sp-mute ${r.muted ? 'is-on' : ''}`} aria-pressed={r.muted === true} aria-label={r.muted ? w(t, 'unmute') : w(t, 'mute')} disabled={off || !r.can.mute || busy} onClick={() => send('mute', cmd.mute(!r.muted))}><G n={r.muted ? 'mute' : 'vol'} /></button>
    <input type="range" min={0} max={100} step={1} value={volPct ?? 0} disabled={off || !r.can.volume || volPct === null} aria-label={w(t, 'volume')} aria-valuetext={volPct === null ? w(t, 'unknownState') : `${volPct} %`} style={{ '--sp-fill': `${volPct ?? 0}%` }}
      onInput={e => setVol(Number((e.target as HTMLInputElement).value))} onChange={e => { const v = Number((e.target as HTMLInputElement).value); setVol(v); void ui.run('volume', cmd.volume(v)).then(ok => { if (!ok) setVol(null); }); }} />
    <b className="at-sp-volnum">{r.muted ? <small>{w(t, 'muted')}</small> : volPct === null ? '—' : <>{num(volPct, lang, 0)}<i>%</i></>}</b>
  </div>;

  // ---- «Сказать Алисе» ----
  const said = async (how: 'command' | 'text', text = say) => { const steps = cmd.say(text, how); if (!steps.length) return; if (await ui.run(`say:${how}`, steps)) { setSay(''); setNote(w(t, 'sent')); } };
  const QUICK = ['Включи мою волну', 'Какая погода?', 'Включи радио', 'Стоп'];
  const sayCard = !r.satellite && r.can.say && <div className="at-kt-card at-sp-say"><h3>{w(t, 'say')}</h3>
    <div className="at-sp-say-body">
      <div className="at-sp-quick">{QUICK.map(q => <button type="button" className="hm-pill" disabled={off || busy} onClick={() => void said('command', q)}>{q}</button>)}</div>
      <label className="at-sp-field"><span className="at-sp-sr">{w(t, 'say')}</span><input type="text" value={say} maxLength={SAY_MAX} placeholder={w(t, 'sayPlaceholder')} disabled={off} enterKeyHint="send" onInput={e => setSay((e.target as HTMLInputElement).value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void said('command'); } }} /></label>
      <div className="at-sp-say-acts">
        <button type="button" className="hm-pill is-primary" disabled={off || busy || !say.trim()} aria-busy={ui.busy === 'say:command'} onClick={() => void said('command')}><G n="send" size={18} />{w(t, 'sayDo')}</button>
        <button type="button" className="hm-pill" disabled={off || busy || !say.trim()} aria-busy={ui.busy === 'say:text'} onClick={() => void said('text')}><G n="speak" size={18} />{w(t, 'sayAloud')}</button>
        <small className="at-sp-left" aria-live="polite">{note || (say ? w(t, 'sayLeft', { n: SAY_MAX - say.length }) : '')}</small>
      </div>
      <small className="at-kt-note">{w(t, 'sayHint')}</small>
    </div></div>;

  // ---- the sound, the alarms, the power ----
  const sound = r.eq && <div className="at-kt-card"><h3>{w(t, 'sound')}</h3>
    <SelectRow t={t} attr="equalizer" label={w(t, 'equalizer')} hint={r.eq.value === null ? w(t, 'eqHint') : undefined} value={r.eq.value} options={r.eq.options} word={o => optWord(t, 'eq', o)} disabled={off || !r.eq.available || busy} onPick={o => send('eq', cmd.equalizer(o))} /></div>;
  const alarms = r.alarm && <div className="at-kt-card at-sp-alarms"><h3>{w(t, 'alarms')}</h3>
    <div className="ah-row hm-setting at-kt-row"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{!r.alarm.available || !host.online ? w(t, 'unknownState') : r.alarm.ringing ? w(t, 'alarmRinging') : r.alarm.next ? w(t, 'alarmNext', { when: whenText(r.alarm.next.start, Date.now(), lang, t, host.timeZone) }) : w(t, 'alarmNone')}</strong>{r.alarm.next?.message && <small>{r.alarm.next.message}</small>}</span></div>
    <p className="at-kt-note at-sp-pad">{w(t, 'alarmHint')}</p></div>;
  const power = r.plug && <div className="at-kt-card at-sp-power"><h3>{w(t, 'power')}</h3>
    <SwitchRow attr="plug" label={w(t, 'plug')} hint={r.watts !== null ? w(t, 'watts', { w: num(r.watts, lang, r.watts < 10 ? 1 : 0) }) : undefined} on={r.plug.on} busy={ui.busy === 'plug'} disabled={busy || !host.online} onSet={v => { if (v) send('plug', cmd.plug(true), 6000); else setAsk('plug'); }} />
    {ask === 'plug' && <Ask t={t} text={w(t, 'plugAsk')} yes={w(t, 'plugYes')} onNo={() => setAsk(null)} onYes={() => { setAsk(null); send('plug', cmd.plug(false), 6000); }} />}</div>;

  // ---- the voice assistant (pulsar) ----
  const voice = r.satellite && (r.mics || r.ring) && <div className="at-kt-card"><h3>{w(t, 'voice')}</h3>
    {r.mics && <SwitchRow attr="mics" label={w(t, 'mics')} hint={r.hwMute === true ? w(t, 'hwMute') : w(t, 'micsHint')} on={r.mics.on} busy={ui.busy === 'mics'} disabled={off || busy || r.hwMute === true} onSet={v => send('mics', cmd.mics(v))} />}
    {r.ring && <SwitchRow attr="ring" label={w(t, 'ring')} hint={w(t, 'ringHint')} on={r.ring.on} busy={ui.busy === 'ring'} disabled={off || busy} onSet={v => send('ring', cmd.ring(v))} />}</div>;
  const A = r.admin;
  if (screen === 'settings' && r.satellite && host.admin) return <div className="at-kt-sheet at-sp-sheet is-settings" data-speaker={view.id}>
    {head(w(t, 'settings'), () => setScreen('main'))}{err}
    <div className="at-kt-body"><div className="at-kt-card at-kt-set">
      {A.wakeWord && <SelectRow t={t} attr="wakeWord" label={w(t, 'wakeWord')} value={A.wakeWord.value} options={A.wakeWord.options} word={o => optWord(t, 'wake', o)} disabled={off || busy} onPick={o => send('wakeWord', cmd.wakeWord(o))} />}
      {A.wakeSound && <SwitchRow attr="wakeSound" label={w(t, 'wakeSound')} on={A.wakeSound.on} busy={ui.busy === 'wakeSound'} disabled={off || busy} onSet={v => send('wakeSound', cmd.wakeSound(v))} />}
      {A.voiceLight && <SwitchRow attr="voiceLight" label={w(t, 'voiceLight')} on={A.voiceLight.on} busy={ui.busy === 'voiceLight'} disabled={off || busy} onSet={v => send('voiceLight', cmd.voiceLight(v))} />}
      {A.visual && <SelectRow t={t} attr="visual" label={w(t, 'visual')} value={A.visual.value} options={A.visual.options} word={o => optWord(t, 'vis', o)} disabled={off || busy} onPick={o => send('visual', cmd.visual(o))} />}
      {A.nearest && <SwitchRow attr="nearest" label={w(t, 'nearest')} on={A.nearest.on} busy={ui.busy === 'nearest'} disabled={off || busy} onSet={v => send('nearest', cmd.nearest(v))} />}
      {A.restart && <button type="button" className="ah-row hm-setting at-kt-row is-button at-sp-restart" disabled={off || busy} onClick={() => setAsk('restart')}><span className="ah-row-text"><strong>{w(t, 'restart')}</strong></span><Icon name="next" size={18} /></button>}
      {ask === 'restart' && <Ask t={t} text={w(t, 'restartAsk')} yes={w(t, 'restartYes')} onNo={() => setAsk(null)} onYes={() => { setAsk(null); send('restart', cmd.restart()); }} />}
    </div></div></div>;
  const left = <>{hero}{volume}</>, right = <>{voice}{sayCard}{sound}{alarms}{power}</>;
  return <div className={`at-kt-sheet at-sp-sheet ${wide ? 'is-wide' : ''}`} data-speaker={view.id} data-phase={r.phase}>
    {head(name)}{err}
    <div className="at-kt-cols"><div className="at-kt-col">{left}</div><div className="at-kt-col">{right}</div></div>
  </div>;
}
export const ui: ApplianceUi = { id: 'speaker', Sheet: SpeakerSheet };
