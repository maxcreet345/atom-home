/* What each device of a room says on its card (docs/ROOM.md): pure, so it is tested under Node. */
import type { Registry } from '../model/registry.ts';
import type { HomeDevice } from '../model/discover.ts';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import type { Lang } from './format.ts';
import type { Thing } from '../model/room.ts';
export const rk = (t: T, k: string, p?: Record<string, string | number>) => t(`room.${k}` as Key, p);
const LOC: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
export const fmt = (v: number, lang: Lang, d = 0) => v.toLocaleString(LOC[lang], { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const watts = (w: number, t: T, lang: Lang) => w >= 1000 ? rk(t, 'kw', { v: fmt(w / 1000, lang, 1) }) : rk(t, 'w', { v: fmt(w, lang, w < 10 ? 1 : 0) });
export interface DetailInput { reg: Registry; lang: Lang; t: T; host: Host; deviceOf: (entity: string) => HomeDevice | undefined; toggle: (d: HomeDevice) => void }
/* ---------- each device in its own words ---------- */
export type Tone = 'ok' | 'warn' | 'muted' | 'on';
export interface Fact { text: string; tone?: 'warn' }
export interface Detail { status: string; tone: Tone; active: boolean; facts: Fact[]; action: { label: string; run: () => void } | null }
/** Never a switch on the card: what feeds the rest of the house or keeps food cold. Their own sheet still has it, behind a tap. */
export const GUARDED = /ибп|ups|роутер|router|nas|холодильн|fridge|котёл|котл|boiler|ввод|spm|компьютер|\bpc\b/i; // a running computer is not switched off from a tile either
/** What the device does now, the facts the owner looks for, the one thing to do with it. Standby is not «on», a silent device is «Не в сети». */
export function detail(th: Thing, p: DetailInput): Detail {
  const { reg, lang, t } = p, id = (re: RegExp) => th.ids.find(i => re.test(i)) ?? null, st = (re: RegExp) => { const i = id(re); return i ? reg.states[i]?.state ?? null : null; }, n = (re: RegExp) => { const s = st(re), v = Number(s); return s !== null && s !== '' && Number.isFinite(v) ? v : null; };
  const k = (key: string, x?: Record<string, string | number>) => rk(t, `d.${key}`, x), main = th.main ? reg.states[th.main] : undefined, call = (d: string, s: string, e: string) => () => void p.host.call(d, s, { entity_id: e });
  const guarded = GUARDED.test(th.name);
  const tog = (on: string, off: string) => { const d = th.main && !guarded ? p.deviceOf(th.main) : undefined; return d ? { label: th.on ? off : on, run: () => p.toggle(d) } : null; };
  const pct = (v: number | null) => v === null ? '—' : `${fmt(v, lang)} %`, plugW = th.power !== null && th.power >= 0.5 ? watts(th.power, t, lang) : null;
  const silent = (why = k('offline')): Detail => ({ status: why, tone: 'muted', active: false, facts: plugW ? [{ text: k('fromPlug', { w: plugW }) }] : [], action: null });
  switch (th.kind) {
    case 'light': if (!th.available) return silent(); return { status: th.on ? k('lit') : k('off'), tone: th.on ? 'on' : 'ok', active: !!th.on, facts: typeof main?.attributes.brightness === 'number' ? [{ text: k('bright', { v: Math.round(main.attributes.brightness / 2.55) }) }] : [], action: tog(k('turnOn'), k('turnOff')) };
    case 'kettle': { if (!th.available) return silent(); const s = st(/kettle_status$/), c = n(/kettle_temperature$/), wh = th.ids.find(i => i.startsWith('water_heater.')), target = wh ? reg.states[wh]?.attributes.temperature as number | undefined : undefined, warm = st(/auto_keep_warm$/) === 'on', heating = s === 'heating' || s === 'boiling', lifted = st(/kettle_lifted$/) === 'on';
      const facts: Fact[] = [{ text: k('water', { v: c !== null ? fmt(c, lang) : '—' }) }]; if (target) facts.push({ text: k('boilTo', { v: fmt(target, lang) }) }); if (warm) facts.push({ text: k('keepWarm') });
      return { status: lifted ? k('lifted') : heating ? k('heating') : s === 'keep_warm' || s === 'warming' ? k('warming') : c !== null && c < 40 ? k('cold') : k('cooling'), tone: heating ? 'on' : 'ok', active: heating, facts, action: th.main && !lifted ? { label: heating ? k('turnOff') : k('boil'), run: call('switch', heating ? 'turn_off' : 'turn_on', th.main) } : null }; }
    case 'feeder': { if (!th.available) return silent(); const bowl = n(/bowl_percent$/), food = st(/food_level$/), des = n(/desiccant_level$/), sched = st(/feeder_schedule$/) === 'on', stuck = st(/food_stuck$/), jam = !!stuck && stuck !== 'normal' && stuck !== 'unknown';
      const facts: Fact[] = []; if (bowl !== null) facts.push({ text: k('bowl', { v: pct(bowl) }) }); if (food) facts.push(food === 'normal' ? { text: k('hopperFull') } : { text: k('hopperLow'), tone: 'warn' }); if (des !== null && des <= 10) facts.push({ text: k('desiccant'), tone: 'warn' });
      return { status: jam ? k('jam') : sched ? k('bySchedule') : k('scheduleOff'), tone: jam ? 'warn' : 'ok', active: false, facts, action: null }; }
    case 'fountain': { if (!th.available) return silent(); const dry = st(/fountain_status$/) === 'waterless' || st(/water_low$/) === 'on', f = n(/filter_level$/), days = n(/filter_days$/);
      return { status: dry ? k('noWater') : th.on ? k('flowing') : k('pumpOff'), tone: dry ? 'warn' : th.on ? 'on' : 'ok', active: !dry && !!th.on, facts: f !== null ? [{ text: k('filter', { v: pct(f) }) + (days !== null ? k('days', { n: fmt(days, lang) }) : ''), tone: f <= 15 ? 'warn' : undefined }] : [], action: tog(k('pumpOn'), k('pumpOffDo')) }; }
    case 'fridge': { if (!th.available) return silent(); const w = th.power ?? 0; return { status: th.on === false ? k('fridgeUnplugged') : w > 15 ? k('compressorOn') : k('compressorRest'), tone: th.on === false ? 'warn' : 'ok', active: false, facts: th.today !== null ? [{ text: k('today', { v: fmt(th.today, lang, 2) }) }] : [], action: null }; }
    case 'tv': case 'player': { if (!main || main.state === 'unavailable') return silent(); const app = st(/active_app$/) ?? (main.attributes.app_name as string | undefined) ?? null, standby = /standby/i.test(app ?? '') || (main.state === 'on' && /standby/i.test(st(/active_source$/) ?? '')), live = ['on', 'playing', 'paused'].includes(main.state) && !standby;
      const facts: Fact[] = []; if (live && app && !/^off$/i.test(app)) facts.push({ text: app }); if (plugW) facts.push({ text: live ? plugW : k('standbyW', { w: plugW }) }); if (live && typeof main.attributes.volume_level === 'number') facts.push({ text: k('volume', { v: Math.round(main.attributes.volume_level * 100) }) });
      return { status: live ? (main.state === 'paused' ? k('paused') : k('watching')) : standby ? k('standby') : k('off'), tone: live ? 'on' : 'ok', active: live, facts, action: th.main ? { label: live || standby ? k('turnOff') : k('turnOn'), run: call('media_player', live || standby ? 'turn_off' : 'turn_on', th.main) } : null }; }
    case 'speaker': { if (!main || main.state === 'unavailable') return silent(); const title = [main.attributes.media_artist, main.attributes.media_title].filter(Boolean).join(' — '), vol = typeof main.attributes.volume_level === 'number' ? Math.round(main.attributes.volume_level * 100) : null;
      const facts: Fact[] = []; if (title) facts.push({ text: title }); if (vol !== null) facts.push({ text: k('volume', { v: vol }) }); if (plugW) facts.push({ text: plugW });
      return { status: main.state === 'playing' ? k('playing') : main.state === 'paused' ? k('pausedSpeaker') : k('waiting'), tone: main.state === 'playing' ? 'on' : 'ok', active: main.state === 'playing', facts, action: main.state === 'playing' ? { label: k('pause'), run: call('media_player', 'media_pause', th.main!) } : main.state === 'paused' ? { label: k('resume'), run: call('media_player', 'media_play', th.main!) } : null }; }
    case 'purifier': { if (!th.available) return silent(); const pm = n(/_pm25$/), life = n(/filter_life$/), left = n(/filter_left_time$/), mode = main?.attributes.preset_mode as string | undefined, sp = main?.attributes.percentage as number | undefined;
      const facts: Fact[] = [{ text: `PM2.5 ${pm !== null ? fmt(pm, lang) : '—'}` }]; if (life !== null) facts.push({ text: k('filter', { v: pct(life) }) + (left !== null ? k('days', { n: fmt(left, lang) }) : ''), tone: life <= 20 ? 'warn' : undefined });
      const modeWord = mode === 'Auto' ? k('auto') : mode === 'Sleep' ? k('night') : mode ? mode.toLowerCase() : '';
      return { status: th.on ? k('purifying', { m: [modeWord, sp ? `${sp} %` : ''].filter(Boolean).join(', ') }) : k('off'), tone: th.on ? 'on' : 'ok', active: !!th.on, facts, action: tog(k('turnOn'), k('turnOff')) }; }
    case 'humidifier': { if (!main || main.state === 'unavailable') { const plug = th.ids.find(i => /^switch\..*plug$/.test(i)); return silent(plug && reg.states[plug]?.state === 'off' ? k('offlinePlugOff') : k('offline')); }
      const hum = main.attributes.current_humidity as number | undefined, target = main.attributes.humidity as number | undefined; const facts: Fact[] = []; if (hum !== undefined) facts.push({ text: k('humNow', { v: fmt(hum, lang) }) }); if (target !== undefined) facts.push({ text: k('humTo', { v: fmt(target, lang) }) });
      return { status: main.state === 'on' ? k('humidifying') : k('off'), tone: main.state === 'on' ? 'on' : 'ok', active: main.state === 'on', facts, action: tog(k('turnOn'), k('turnOff')) }; }
    case 'vent': if (!th.available) return silent(); return { status: th.on ? k('pulling') : k('off'), tone: th.on ? 'on' : 'ok', active: !!th.on, facts: plugW ? [{ text: plugW }] : [], action: tog(k('turnOn'), k('turnOff')) };
    case 'airfryer': { const s = st(/airfryer_status$/), left = n(/left_time$/); if (!s || s === 'unavailable') return silent(); const idle = /idle|standby|off/i.test(s); return { status: idle ? k('waiting') : k('cooking'), tone: idle ? 'ok' : 'on', active: !idle, facts: !idle && left ? [{ text: k('left', { v: fmt(left, lang) }) }] : [], action: null }; }
    case 'washer': { const s = st(/washer_current_status$/); if (s && !['unavailable', 'unknown', 'power_off', 'end', 'sleep', 'initial'].includes(s)) return { status: k('washing'), tone: 'on', active: true, facts: plugW ? [{ text: plugW }] : [], action: null };
      return { status: s === 'end' ? k('washDone') : k('notWashing'), tone: 'ok', active: false, facts: [{ text: th.on === false ? k('plugOff') : plugW ? k('plugOnW', { w: plugW }) : k('plugOn') }], action: null }; }
    case 'dryer': { const s = st(/machine_state$/), r = n(/dryer_remaining$/), drum = n(/drum_clean_due_in$/); const facts: Fact[] = drum !== null ? [{ text: drum <= 1 ? k('drumNow') : k('drumIn', { n: fmt(drum, lang) }), tone: drum <= 1 ? 'warn' : undefined }] : [];
      return s === 'run' || s === 'active' ? { status: r ? k('dryingLeft', { v: fmt(r, lang) }) : k('drying'), tone: 'on', active: true, facts, action: null } : { status: k('notDrying'), tone: 'ok', active: false, facts, action: null }; }
    case 'valve': { if (!main || main.state === 'unavailable') return silent(); const open = main.state === 'open'; const d = th.main ? p.deviceOf(th.main) : undefined; return { status: open ? k('valveOpen') : k('valveClosed'), tone: open ? 'ok' : 'warn', active: false, facts: [], action: d ? { label: open ? k('valveClose') : k('valveOpenDo'), run: () => p.toggle(d) } : null }; }
    case 'camera': return { status: th.available ? k('cameraOn') : k('offline'), tone: th.available ? 'ok' : 'muted', active: false, facts: [], action: null };
    default: if (!th.available) return silent(); return { status: th.on ? k('on') : k('offN'), tone: th.on ? 'on' : 'ok', active: !!th.on, facts: plugW ? [{ text: plugW }] : [], action: tog(k('turnOn'), k('turnOff')) };
  }
}
