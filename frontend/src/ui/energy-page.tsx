import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import type { HomeDevice } from '../model/discover.ts';
import { locales, numFixed, type Lang } from './format.ts';
import { Icon } from './primitives.tsx';
import { Tick } from './motion.tsx';
import { energyText, powerText } from '../model/energy.ts';
import type { FloorRow } from '../model/registry.ts';
import { channels as findChannels, feedOfStat, gridIds, prefChannels, prefName, shortName, prefTariff, ratesOf, type EnergyPrefs, firstStatistics, keptSessions, loadReport, meters as findMeters, range } from '../model/energy-load.ts';
import type { Tariff } from '../model/config.ts';
import { PERIODS, UNASSIGNED, failedLoad, type LoadState, axis, barAverage, byRoom, change, cost, costOf, counted, daysElapsed, forecast, lei, pick as pickSum, sum, totals, type Bucket, type EnergyReport, type FeedInfo, type Period, type Split } from '../model/energy-report.ts';
/** The Energy panel (owner, 08.11.2026, approved from the mock): the period and its lei on top, one big animated chart of the house feed split
 * by the SPM's channels, the channels side by side, each apartment by room and device, the comparison and the month's forecast, the network
 * quality of each input and the car's charging sessions. Read-only: nothing here switches anything, the SPM's relays stay off it. */
type Fmt = (v: number, digits: number) => string;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const REFRESH = 5 * 60000;
function useWidth<E extends HTMLElement>() {
  const ref = useRef<E>(null), [w, setW] = useState(0);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; const read = () => setW(el.clientWidth); read(); const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect(); }, []);
  return [ref, w] as const;
}
export interface EnergyPanelProps { /** the feed the car's charger is billed with (config modules.energy.options.chargerOf) */ chargerOf?: string | null; /** the panel's own electricity price history (config energy.tariffs); empty: HA's Energy settings' price, then ANRE's figures */ tariffs?: Tariff[]; host: Host; devices: HomeDevice[]; boilers: Set<string>; feedOfRoom: (roomId: string) => string | null; /** the feeds the rooms are assigned to in the config (rooms.<area>.feed) */ roomFeeds: string[]; roomName: (id: string) => string; nameOf: (d: HomeDevice) => string; onDevice: (key: string) => void; t: T; lang: Lang; fallback: ComponentChildren; /** HA's floors: the buildings the feeds are in (Atom + Okapi, 09.11.2026); one or none = no buildings card */ floors?: FloorRow[]; floorOfArea?: (areaId: string | null) => string | null }
export function EnergyPanel({ chargerOf = null, tariffs = [], host, devices, boilers, feedOfRoom, roomFeeds, roomName, nameOf, onDevice, t, lang, fallback, floors = [], floorOfArea = () => null }: EnergyPanelProps) {
  const [period, setPeriod] = useState<Period>('day'), [offset, setOffset] = useState(0), [state, setState] = useState<LoadState | null>(null);
  // first: undefined until firstStatistics answers (the report waits for it: a month's row starts on the 1st whatever day the statistics began);
  // a failed read gives the report null (nothing limited) and is asked again with every refresh, «Повторить» and after the next good report
  const [hidden, setHidden] = useState<string[]>([]), [pick, setPick] = useState<number | null>(null), [group, setGroup] = useState<string | null>(null), [prefs, setPrefs] = useState<{ parents: Set<string>; listed: Set<string>; ok: boolean; raw?: EnergyPrefs | null } | null>(null), [tick, setTick] = useState(0), [firstState, setFirst] = useState<{ key: string; v: number | null; failed: boolean } | null>(null), [firstAgain, setFirstAgain] = useState(0);
  const h2 = useRef<HTMLHeadingElement>(null), focusHead = useRef(false), attempts = useRef(0), last = useRef<EnergyReport | null>(null), firstFailed = useRef(false);
  const grid = useMemo(() => gridIds(prefs?.raw), [prefs?.raw]);
  // a line is named where the owner names it, in HA's Energy settings («Пайка»); otherwise by its meter
  const chs = useMemo(() => prefChannels(findChannels(devices, boilers, grid), prefs?.raw ?? null).map(c => { const n = prefName(prefs?.raw, [c.total, c.energy].filter((x): x is string => !!x)); return n ? { ...c, name: n, short: shortName(n) } : c; }), [devices, boilers, grid, prefs?.raw]);
  const chKey = chs.map(c => c.energy).join(' '), firstRead = firstState?.key === chKey ? firstState.v : undefined, first = firstRead ?? null;
  firstFailed.current = firstState?.key === chKey && firstState.failed;
  // HA's Energy settings say which plug holds others (the kitchen's appliance plug held the fridge, the kettle and the air fryer): left out, or they
  // count twice. Read again with every refresh; a failed read keeps what was known and says so, it is never taken for «no parents». An HA whose
  // Energy dashboard was never set up answers not_found («No prefs», energy/websocket_api.py): that is no parents, not a failure
  useEffect(() => { let alive = true; if (!host.ws) { setPrefs({ parents: new Set(), listed: new Set(), ok: true }); return; }
    host.ws<EnergyPrefs & { device_consumption?: Array<{ stat_consumption?: string; included_in_stat?: string }> }>({ type: 'energy/get_prefs' }).then(p => { if (alive) setPrefs({ raw: p, parents: new Set((p?.device_consumption ?? []).map(x => x.included_in_stat).filter((x): x is string => !!x)), listed: new Set((p?.device_consumption ?? []).map(x => x.stat_consumption).filter((x): x is string => !!x)), ok: true }); }, e => { if (!alive) return; if ((e as { code?: string } | null)?.code === 'not_found') setPrefs({ parents: new Set(), listed: new Set(), ok: true }); else setPrefs(s => ({ raw: s?.raw ?? null, parents: s?.parents ?? new Set(), listed: s?.listed ?? new Set(), ok: false })); });
    return () => { alive = false; }; }, [host, tick]);
  const parentsKey = prefs ? [...prefs.parents].sort().join(' ') + '|' + [...prefs.listed].sort().join(' ') : null;
  // a room's saved feed counts only while it is one of the SPM's apartment channels (their ids changed once, eWeLink → Tasmota): a stale one is
  // «not assigned», not a group of its own that no button opens
  const feedKeys = useMemo(() => new Set(chs.filter(c => !c.charger).map(c => c.key)), [chKey]);
  const meters = useMemo(() => prefs ? findMeters(devices, boilers, { name: d => prefName(prefs.raw, [...d.metrics, ...d.parameters].map(m => m.id)) ?? nameOf(d), room: d => roomName(d.roomId), feed: d => { const f = feedOfStat(chs, prefs.raw, [...d.metrics, ...d.parameters].map(m => m.id)) ?? feedOfRoom(d.roomId); return f && feedKeys.has(f) ? f : null; }, parents: prefs.parents, listed: prefs.listed, grid }) : [], [devices, boilers, parentsKey, nameOf, roomName, feedOfRoom, feedKeys, chKey]);
  // a feed is a group when rooms are assigned to it or HA's Energy settings put metered devices inside it
  const feedSet = new Set([...roomFeeds, ...meters.map(m => m.feed).filter((f): f is string => !!f)].filter(f => feedKeys.has(f))), grouped = feedSet.size > 0, meterKey = meters.map(m => `${m.id}:${m.feed ?? ''}:${m.room}`).join(' ');
  const key = `${period}${offset}`, tariffKey = tariffs.map(x => `${x.from}:${x.lei}`).join(' ');
  useEffect(() => { if (firstState?.key === chKey && !firstState.failed) return; let alive = true;
    firstStatistics(host, chs, Date.now()).then(v => { if (alive) setFirst({ key: chKey, v, failed: false }); }, () => { if (alive) setFirst(s => ({ key: chKey, v: s?.key === chKey ? s.v : null, failed: true })); });
    return () => { alive = false; }; }, [host, chKey, tick, firstAgain]);
  useEffect(() => { if (!host.statistics || !chs.length || parentsKey === null || firstRead === undefined) return; let alive = true;
    // a period still starting where it did keeps its sessions; offset 0 after 1 January (1 July) is another year (half): read again
    const at = Date.now(), sessions = keptSessions(last.current, period, offset, at);
    loadReport(host, { channels: chs, meters, period, offset, now: at, tariff: tariffs.length ? ratesOf(tariffs) : prefTariff(prefs?.raw ?? null, id => host.states()[id]?.state), chargerOf, grouped, sessions, first: firstRead }).then(report => { if (alive) { last.current = report; setState({ key, report }); if (firstFailed.current) setFirstAgain(n => n + 1); } },
      () => { if (!alive) return; const attempt = ++attempts.current, at = Date.now(); setState(s => failedLoad(s, key, attempt, at)); });
    return () => { alive = false; }; }, [host, chKey, meterKey, period, offset, parentsKey, tick, grouped, firstRead, tariffKey]);
  // every 5 minutes while shown; a kiosk screen that comes back after the night (no tick while hidden) reads at once if the figures are older than
  // that or from another day, instead of showing yesterday under «Сегодня» until the next tick
  useEffect(() => { if (offset !== 0) return; const timer = setInterval(() => { if (!document.hidden) setTick(n => n + 1); }, REFRESH);
    const back = () => { if (document.hidden) return; const l = last.current, n = Date.now(); if (!l || n - l.now >= REFRESH || new Date(l.now).toDateString() !== new Date(n).toDateString()) setTick(x => x + 1); };
    document.addEventListener('visibilitychange', back); window.addEventListener('pageshow', back);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', back); window.removeEventListener('pageshow', back); }; }, [offset]);
  // the panel opened (from the tile, the tab bar or a link): focus on its title, not on nothing; and back there when a step button switches itself off
  useEffect(() => { h2.current?.focus({ preventScroll: true }); }, [!host.statistics || !chs.length]);
  useEffect(() => { if (focusHead.current) { focusHead.current = false; h2.current?.focus({ preventScroll: true }); } });
  if (!host.statistics || !chs.length) return <>{fallback}</>;
  const loc = locales[lang], fmt: Fmt = (v, d) => numFixed(v, lang, d);
  const kwh = (v: number) => { const x = energyText(v, fmt); return `${x.value}\u00a0${x.unit}`; }, money = (v: number) => t('ep.lei', { v: fmt(v, v < 100 ? 2 : 0) });
  const report = state?.key === key ? state.report : undefined, failed = state?.key === key && state.failed, now = report?.now ?? Date.now();
  const choose = (p: Period) => { if (p !== period) { setPeriod(p); setOffset(0); setPick(null); } };
  const atFirst = first !== null && range(period, offset - 1, now).end <= first;
  const step = (d: number) => { const o = offset + d; if (o > 0 || (d < 0 && atFirst)) return; if (o >= 0 || (first !== null && range(period, o - 1, now).end <= first)) focusHead.current = true; setOffset(o); setPick(null); };
  const head = <div className="at-ep-top">
    <div className="ah-segments hm-range-tabs at-ep-periods" role="group" aria-label={t('ep.period')}>{PERIODS.map(p => <button type="button" aria-pressed={period === p} className={period === p ? 'is-active' : ''} onClick={() => choose(p)}>{t(`ep.period.${p}` as Key)}</button>)}</div>
    <div className="at-ep-nav"><button type="button" className="at-ep-step" aria-label={t('ep.prev')} disabled={atFirst} onClick={() => step(-1)}><Icon name="back" size={18} /></button><h2 ref={h2} tabIndex={-1} aria-live="polite">{title(period, offset, now, t, loc)}</h2><button type="button" className="at-ep-step is-next" aria-label={t('ep.next')} disabled={offset >= 0} onClick={() => step(1)}><Icon name="back" size={18} /></button></div>
    {report && state?.stale && <p className="at-ep-stale" role="status">{t('ep.stale')}</p>}
  </div>;
  if (failed) return <div className="at-ep">{head}<div className="at-ep-card at-ep-fail" role="alert" key={`fail${state!.attempt}`}><p>{t('ep.failed')}<small>{t('ep.attempt', { time: new Date(state!.at!).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</small></p><button type="button" className="hm-pill" onClick={() => { focusHead.current = true; /* the button goes with the card: the focus to the title, not to the page */ setState(null); setTick(n => n + 1); }}>{t('ep.retry')}</button></div></div>;
  if (!report) return <div className="at-ep" aria-busy="true">{head}<div className="at-ep-card at-ep-skel is-hero" /><div className="at-ep-card at-ep-skel is-chart"><span className="at-vh">{t('ep.loading')}</span></div></div>;
  // a period without statistics is empty, not zero: one line instead of 0,0 kWh and 0,00 lei everywhere. Before they began it says since when;
  // after that the meter was silent (a day the SPM was offline), and «there were no meters before» would be untrue
  if (report.dataFrom === null) return <div className="at-ep" data-period={period}>{head}<section className="at-ep-card at-ep-nostats"><p>{t('ep.noStats')}</p>{first !== null && <small>{range(period, offset, now).end <= first ? t('ep.since', { d: dateLong(first, loc) }) : t('ep.gap')}</small>}</section></div>;
  // a channel silent now for more than 15 minutes: no badge (today stopped at 15:00 read «▼ 25 %» against yesterday up to now)
  const feeds = report.feeds, tot = totals(report), all = sum(tot), before = report.previous ? sum(report.previous) : null, delta = typeof report.silentSince === 'number' ? null : change(all, before), fc = forecast(report), empty = all < 0.005, past = offset < 0;
  const live: Split | null = offset === 0 ? Object.fromEntries(chs.filter(c => report.feeds.some(f => f.key === c.key)).map(c => [c.key, c.power.available && Number.isFinite(Number(c.power.state)) ? Number(c.power.state) * (c.power.unit === 'kW' ? 1000 : 1) : NaN])) : null;
  const liveOk = live && Object.values(live).every(Number.isFinite);
  const toggle = (k: string) => setHidden(h => h.includes(k) ? h.filter(x => x !== k) : h.length < feeds.length - 1 ? [...h, k] : h);
  const vs = (long: boolean) => t(`ep.vs.${long ? 'long.' : ''}${past ? 'past.' : ''}${period}` as Key);
  const deltaBadge = (long: boolean) => delta === null ? null : <span className={`at-ep-delta ${Math.round(delta) === 0 ? 'is-flat' : delta > 0 ? 'is-up' : 'is-down'}`}>{long ? `${Math.round(delta) === 0 ? '=' : delta > 0 ? '▲' : '▼'} ${fmt(Math.abs(delta), 0)}\u00a0% ${vs(false)}` : `${Math.round(delta) === 0 ? '' : delta > 0 ? '+' : '−'}${fmt(Math.abs(delta), 0)}\u00a0%`}</span>;
  // apartments: the feeds the config assigns rooms to (never what happened to be used this period), and the devices of rooms on no feed apart
  const unassigned: FeedInfo = { key: UNASSIGNED, name: t('ep.unassigned'), short: t('ep.unassigned'), color: '#8e8e93', charger: false };
  const groups = report.grouped ? [...feeds.filter(f => !f.charger && feedSet.has(f.key)), ...(meters.some(m => m.feed === null) ? [unassigned] : [])] : [], g = groups.find(f => f.key === group) ?? groups[0] ?? null;
  // a picked bar or minute survives the 5-minute refresh; one that is no longer there (or before the statistics) is dropped
  const curveLast = report.curve ? report.curve.reduce((m, b, i) => b.future ? m : i, -1) : -1, lastPast = report.buckets.reduce((m, b, i) => b.future ? m : i, -1), firstBar = firstCounted(report);
  const pk = pick === null ? null : period === 'day' && report.curve ? (pick <= curveLast ? pick : null) : (pick >= firstBar && pick <= lastPast ? pick : null);
  const hint = t(period === 'day' ? 'ep.hint.day' : 'ep.hint.bars');
  // the bar the meter came back in holds the silent stretch's energy: the hero names it (the tallest bar and «the costliest day» told apart),
  // and the rooms' rest says so too (the SPM put yesterday into today's 00:00, the plugs kept their own days). The sessions are built from the
  // charger's power, which HA does not write while the SPM is silent: a charge then is missing from the list, which says by how much
  const carriedAt = report.buckets.findIndex(b => b.carried), carried = carriedAt >= 0;
  const charger = feeds.find(f => f.charger), missed = carried && charger && report.sessions ? tot[charger.key] - report.sessions.reduce((a, x) => a + x.kwh, 0) : 0;
  return <div className="at-ep" data-period={period}>
    {head}
    <section className="at-ep-card at-ep-hero" key={`h${key}`}>
      <div className="at-ep-used"><small>{t('ep.used')}</small><span className="at-ep-big"><Tick value={energyText(all, fmt).value} /><i>kWh</i></span>
        <span className="at-ep-money">≈&nbsp;{money(cost(report))}</span>{deltaBadge(true)}
      </div>
      {live && <div className="at-ep-now"><small><i className={`at-ep-live${liveOk ? '' : ' is-off'}`} />{t('ep.now')}</small>{liveOk ? <><span className="at-ep-big is-now"><Tick value={powerText(sum(live), fmt).value} /><i>{powerText(sum(live), fmt).unit}</i></span>
        <span className="at-ep-now-feeds">{feeds.map(f => { const p = powerText(live[f.key], fmt); return <span><i style={`--c:${f.color}`} />{f.short} <b>{`${p.value}\u00a0${p.unit}`}</b></span>; })}</span></> : <span className="at-ep-big is-now is-off">—<i>{t('overview.energy.offline')}</i></span>}
      </div>}
      {carried && <p className="at-ep-note at-ep-carried"><span aria-hidden="true">*&nbsp;</span>{`${bucketName(report, carriedAt, loc)}: ${t('ep.carried')}`}</p>}
      <p className="at-ep-note at-ep-tariff" data-tariff={report.tariff.source}>{tariffNote(report, t, fmt, loc)}</p>
    </section>
    <Buildings floors={floors} feeds={feeds} chs={chs} tot={tot} live={liveOk ? live : null} floorOfArea={floorOfArea} report={report} t={t} fmt={fmt} kwh={kwh} money={money} />
    <section className="at-ep-card at-ep-chart">
      <div className="at-ep-legend">{feeds.map(f => <button type="button" aria-pressed={!hidden.includes(f.key)} className={hidden.includes(f.key) ? 'is-off' : ''} onClick={() => toggle(f.key)}><i style={`--c:${f.color}`} /><span className="is-long">{f.name}</span><span className="is-short">{f.short}</span><b>{kwh(tot[f.key])}</b></button>)}</div>
      {empty ? <p className="at-ep-readout is-hint">{t('ep.nodata')}</p> : <>
        {report.dataFrom - report.start > 86400000 && <p className="at-ep-since">{t('ep.since', { d: dateLong(report.dataFrom, loc) })}</p>}
        <span id="at-ep-hint" className="at-vh">{hint}</span>
        <Readout report={report} pick={pk} hidden={hidden} hint={hint} t={t} loc={loc} kwh={kwh} money={money} fmt={fmt} />
        {period === 'day' && report.curve ? <Curve key={key} report={report} hidden={hidden} pick={pk} setPick={setPick} t={t} fmt={fmt} /> : <Bars key={key} report={report} hidden={hidden} pick={pk} setPick={setPick} t={t} loc={loc} fmt={fmt} />}
      </>}
    </section>
    {/* a feed billed with another (the car with apartment 8) is inside its block, not beside it: the block is the bill */}
    <div className={`at-ep-feeds is-${Math.min(feeds.filter(f => !f.partOf).length, 4)}`}>{feeds.filter(f => !f.partOf).map(f => { const kids = feeds.filter(k => k.partOf === f.key), keys = [f.key, ...kids.map(k => k.key)], v = keys.reduce((a, k) => a + (tot[k] ?? 0), 0); return <section className="at-ep-card at-ep-feed" style={`--c:${f.color}`} key={`${f.key}${key}`}>
      <span className="at-ep-feed-head"><i /><span className="at-ep-feed-name">{f.name}</span><small>{all ? t('ep.share', { n: fmt(v / all * 100, 0) }) : ''}</small></span>
      <span className="at-ep-feed-num"><b>{energyText(v, fmt).value}</b>{'\u00a0'}kWh</span><span className="at-ep-money">≈&nbsp;{money(cost(report, keys))}</span>
      {kids.map(k => <span className="at-ep-feed-part" style={`--c:${k.color}`}><i />{t('ep.including', { name: k.name })}<b>{kwh(tot[k.key] ?? 0)}</b><small>≈&nbsp;{money(cost(report, [k.key]))}</small></span>)}
      <Spark values={(report.curve && period === 'day' ? report.curve : report.buckets).filter(b => !b.future).map(b => keys.reduce((a, k) => a + (b.v[k] ?? 0), 0))} />
    </section>; })}</div>
    <Rooms report={report} group={g} groups={groups} setGroup={k => { setGroup(k); setPick(null); }} prefsOk={prefs?.ok !== false} carried={carried} t={t} fmt={fmt} kwh={kwh} money={money} onDevice={onDevice} />
    <div className="at-ep-side">
      <section className="at-ep-card at-ep-compare"><h3>{t('ep.compare')}</h3>
        {delta !== null && before !== null && <Row label={vs(true)} value={deltaBadge(false)} sub={t('ep.before', { v: kwh(before) })} />}
        {(before === 0 || before === null) && all > 0 && !report.silentSince && <Row label={vs(true)} value="—" sub={t('ep.noPrev')} />}
        {period !== 'day' && <Row label={t('ep.avg')} value={kwh(all / daysElapsed(report))} sub={`≈\u00a0${money(lei(all / daysElapsed(report), report))}`} />}
        <Peak report={report} t={t} loc={loc} kwh={kwh} />
        {fc && <Row label={t('ep.forecast', { m: new Date(fc.at).toLocaleString(loc, { month: 'long' }) })} value={`≈\u00a0${money(fc.lei)}`} sub={kwh(fc.kwh)} strong />}
      </section>
      {report.network.length > 0 && <section className="at-ep-card at-ep-net"><h3>{t('ep.network')}</h3>{report.network.map(n => <Network n={n} feed={feeds.find(f => f.key === n.feed)!} live={offset === 0} t={t} fmt={fmt} />)}</section>}
    </div>
    {report.sessions && <Sessions report={report} sessions={report.sessions} color={charger?.color ?? '#ff9f0a'} missed={missed > 0.3 ? missed : 0} t={t} loc={loc} kwh={kwh} money={money} fmt={fmt} />}
  </div>;
}
/** What a kWh cost in this period: ANRE's figure (and where to write one's own) until the owner has, HA's Energy settings' price, the owner's price
 * with its day, or the changes inside the period, each with its day (owner, 09.11.2026: a past month at its own price). */
function tariffNote(r: EnergyReport, t: T, fmt: Fmt, loc: string): string {
  const rates = r.tariff.rates, start = Math.max(r.start, r.dataFrom ?? r.start), until = Math.min(r.now, r.end), day = (v: number) => dateLong(v, loc), price = (v: number) => fmt(v, 2);
  if (r.tariff.source === 'ha') return t('ep.tariff.ha', { v: price(r.tariff.lei) });
  const cur = rates.filter(x => x.from <= until).at(-1) ?? rates[0], at = rates.filter(x => x.from <= start).at(-1) ?? rates[0], inside = rates.filter(x => x.from > start && x.from < until);
  if (!cur || !at) return '';
  if (r.tariff.source === 'anre') return t('ep.tariff', { v: price(cur.lei), d: day(cur.from), path: `${t('section.settings')} → ${t('setup.energy')}` });
  if (!inside.length) return t('ep.tariff.set', { v: price(at.lei), d: day(at.from) });
  return t('ep.tariff.changed', { list: [t('ep.tariff.until', { v: price(at.lei), d: day(inside[0].from) }), ...inside.map(x => t('ep.tariff.from', { v: price(x.lei), d: day(x.from) }))].join(', ') });
}
const dateLong = (v: number, loc: string) => new Date(v).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
/** The first bar that counts: the one in which the statistics begin (none before it opens a reading). */
const firstCounted = (r: EnergyReport) => { const c = counted(r); return c.length ? r.buckets.indexOf(c[0]) : r.buckets.length; };
function title(period: Period, offset: number, now: number, t: T, loc: string): string {
  const n = new Date(now), y = n.getFullYear(), mo = n.getMonth(), d = (x: Date, o: Intl.DateTimeFormatOptions) => x.toLocaleDateString(loc, o), noYear = (s: string) => s.replace(/\s*г\.$/, '');
  if (period === 'day') { const x = new Date(y, mo, n.getDate() + offset), s = d(x, { day: 'numeric', month: 'long' }); return offset === 0 ? t('ep.today', { d: s }) : offset === -1 ? t('ep.yesterday', { d: s }) : cap(d(x, { weekday: 'long', day: 'numeric', month: 'long', ...(x.getFullYear() !== y ? { year: 'numeric' } : {}) })); }
  if (period === 'week') { const mon = new Date(y, mo, n.getDate() - (n.getDay() + 6) % 7 + 7 * offset), sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6), same = mon.getMonth() === sun.getMonth(); return `${d(mon, same ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} – ${noYear(d(sun, { day: 'numeric', month: 'long', ...(sun.getFullYear() !== y ? { year: 'numeric' } : {}) }))}`; }
  if (period === 'month') return cap(noYear(d(new Date(y, mo + offset, 1), { month: 'long', year: 'numeric' })));
  if (period === 'half') { const h = mo < 6 ? 0 : 6, s = new Date(y, h + 6 * offset, 1), e = new Date(y, h + 6 * offset + 5, 1); return `${cap(d(s, { month: 'long' }))} – ${noYear(d(e, { month: 'long', year: 'numeric' }))}`; }
  return String(y + offset);
}
/** What one bucket is called: the hour, the day, the week or the month. */
function bucketName(r: EnergyReport, i: number, loc: string): string {
  const b = r.buckets[i], d = (o: Intl.DateTimeFormatOptions) => new Date(b.at).toLocaleDateString(loc, o), hm = (x: number) => new Date(x).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  if (r.period === 'day') return `${hm(b.at)}–${hm(b.at + 3600000)}`;
  if (r.period === 'week' || r.period === 'month') return cap(d({ weekday: 'short', day: 'numeric', month: 'long' }));
  if (r.period === 'half') { const end = (r.buckets[i + 1]?.at ?? r.end) - 1; return `${d({ day: 'numeric', month: 'short' })} – ${new Date(end).toLocaleDateString(loc, { day: 'numeric', month: 'short' })}`; }
  return cap(d({ month: 'long' }));
}
function Readout({ report, pick, hidden, hint, t, loc, kwh, money, fmt }: { report: EnergyReport; pick: number | null; hidden: string[]; hint: string; t: T; loc: string; kwh: (v: number) => string; money: (v: number) => string; fmt: Fmt }) {
  const shown = report.feeds.filter(f => !hidden.includes(f.key));
  // one live region in every state, the hint included: a reader hears the first value too
  if (pick === null) return <p className="at-ep-readout is-hint" aria-live="polite">{hint}</p>;
  if (report.period === 'day' && report.curve) {
    const p = report.curve[pick], x = powerText(pickSum(p.v, shown.map(f => f.key)), fmt), time = new Date(p.at).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    // a silent meter, or a channel of it: not 0 W and not a partial sum
    if (p.missing || p.partial) return <p className="at-ep-readout is-gap" aria-live="polite"><strong>{time}</strong><span>{t('ep.gap')}</span></p>;
    return <p className="at-ep-readout" aria-live="polite"><strong>{new Date(p.at).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}</strong><b>{`${x.value}\u00a0${x.unit}`}</b>{shown.map(f => { const y = powerText(p.v[f.key] ?? 0, fmt); return <span><i style={`--c:${f.color}`} /><span className="at-vh">{f.name} </span>{`${y.value}\u00a0${y.unit}`}</span>; })}</p>;
  }
  // a carried bar: «*» after its figure, the mark of the note under the total and under «Без своего датчика» (on a 13R lying down that note is
  // scrolled away); the sentence itself for a screen reader only: on a line of its own it moved the chart 31 px under the finger
  const b = report.buckets[pick], v = pickSum(b.v, shown.map(f => f.key));
  if (b.missing) return <p className="at-ep-readout is-gap" aria-live="polite"><strong>{bucketName(report, pick, loc)}</strong><span>{t('ep.gap')}</span></p>;
  return <p className="at-ep-readout" aria-live="polite"><strong>{bucketName(report, pick, loc)}</strong><b>{kwh(v)}{b.carried && <span className="at-ep-mark" aria-hidden="true">*</span>}</b><span className="at-ep-money">≈&nbsp;{money(costOf(report, v, b.at))}</span>{shown.map(f => <span><i style={`--c:${f.color}`} /><span className="at-vh">{f.name} </span>{kwh(b.v[f.key] ?? 0)}</span>)}{b.carried && <span className="at-vh">{t('ep.carried')}</span>}</p>;
}
const roundTop = (x: number, y: number, w: number, h: number, r: number) => { r = Math.min(r, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };
/** The plot's frame: the unit once above the axis (a «1 000 kWh» tick ran past the card on a phone), the band above the plot keeps it and the average. */
const TOP = 22;
const plotProps = (t: T, label: string) => ({ className: 'at-ep-plot', tabIndex: 0, role: 'group' as const, 'aria-roledescription': t('ep.chart'), 'aria-label': label, 'aria-describedby': 'at-ep-hint' });
/** The day: the feed's power every five minutes, stacked, drawn in from the left; a finger or the pointer reads any minute, a tap by the reading clears it. */
function Curve({ report, hidden, pick, setPick, t, fmt }: { report: EnergyReport; hidden: string[]; pick: number | null; setPick: (i: number | null) => void; t: T; fmt: Fmt }) {
  const points = report.curve!, [ref, width] = useWidth<HTMLDivElement>(), H = width < 520 ? 190 : 250, L = 34, R = 8, Tp = TOP, B = 22, shown = report.feeds.filter(f => !hidden.includes(f.key));
  const past = points.filter(p => !p.future), last = past.length - 1, tap = useRef<{ x: number; clear: boolean } | null>(null);
  const stack = past.map(p => { let acc = 0; return shown.map(f => (acc += p.v[f.key] ?? 0)); });
  const { top, step } = axis(Math.max(500, ...stack.map(s => s.at(-1) ?? 0)) / 1000 * 1.05), iw = Math.max(1, width - L - R), ih = H - Tp - B;
  const x = (i: number) => L + i / (points.length - 1) * iw, y = (w: number) => Tp + ih - w / 1000 / top * ih;
  // the meter (or a channel of it) silent: the area and the line break there, and the stretch is a dashed baseline, as a silent bar is
  const gapAt = (i: number) => !!(points[i]?.missing || points[i]?.partial), runs: Array<{ a: number; b: number; gap: boolean }> = [];
  for (let i = 0; i <= last; i++) { const g = gapAt(i), r = runs.at(-1); if (r && r.gap === g) r.b = i; else runs.push({ a: i, b: i, gap: g }); }
  const layers = last < 0 ? [] : shown.map((f, k) => { let d = '', line = ''; for (const r of runs) { if (r.gap) continue; const idx = Array.from({ length: r.b - r.a + 1 }, (_, n) => r.a + n), up = idx.map(i => `${x(i).toFixed(1)},${y(stack[i][k]).toFixed(1)}`), down = idx.map(i => `${x(i).toFixed(1)},${y(k ? stack[i][k - 1] : 0).toFixed(1)}`).reverse(); d += `M${up.join('L')}L${down.join('L')}Z`; line += `M${up.join('L')}`; } return { f, d, line, used: past.some((p, i) => !gapAt(i) && (p.v[f.key] ?? 0) > 1) }; });
  const total = (i: number) => gapAt(i) ? 0 : stack[i]?.at(-1) ?? 0;
  const index = (e: PointerEvent) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); return Math.max(0, Math.min(last, Math.round((e.clientX - r.left - L) / iw * (points.length - 1)))); };
  const at = (e: PointerEvent) => { if (last >= 0) setPick(index(e)); };
  const down = (e: PointerEvent) => { if (last < 0) return; const i = index(e), slot = Math.max(1, Math.round(points.length / iw * 6)); /* a finger is wider than a slot: «near the reading» is a few of them */ if (e.pointerType !== 'mouse' && pick !== null && Math.abs(i - pick) <= slot) { tap.current = { x: e.clientX, clear: true }; return; } tap.current = null; setPick(i); };
  const move = (e: PointerEvent) => { if (tap.current?.clear && Math.abs(e.clientX - tap.current.x) > 4) tap.current = null; if (!tap.current && (e.buttons || e.pointerType === 'mouse')) at(e); };
  const up = () => { if (tap.current?.clear) setPick(null); tap.current = null; };
  const key = (e: KeyboardEvent) => { if (last < 0) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPick(Math.max(0, Math.min(last, (pick ?? last) + (e.key === 'ArrowLeft' ? -6 : 6)))); } else if (e.key === 'Escape') setPick(null); };
  const peakAt = stack.reduce((m, _, i) => total(i) > total(m) ? i : m, 0), peak = powerText(total(peakAt), fmt);
  const isToday = report.offset === 0;
  return <div ref={ref} {...plotProps(t, t('ep.chart.day', { v: `${peak.value}\u00a0${peak.unit}` }))} onKeyDown={key}>
    {width > 0 && <svg width={width} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { tap.current = null; }} onPointerLeave={e => { if (e.pointerType === 'mouse') setPick(null); }}>
      <text className="at-ep-unit" x={L - 6} y={Tp - 9} text-anchor="end">kW</text>
      {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map(v => <g className="at-ep-grid"><line x1={L} x2={width - R} y1={y(v * 1000)} y2={y(v * 1000)} /><text x={L - 6} y={y(v * 1000) + 4} text-anchor="end">{fmt(v, step < 1 ? 1 : 0)}</text></g>)}
      {[0, 6, 12, 18, 24].map(h => <text className="at-ep-axis" x={Math.min(width - R - 10, Math.max(L + 8, L + h / 24 * iw))} y={H - 5} text-anchor="middle">{`${String(h).padStart(2, '0')}:00`}</text>)}
      <g className="at-ep-draw">{layers.map(l => <path className="at-ep-area" d={l.d} style={`--c:${l.f.color}`} />)}{layers.filter(l => l.used).map(l => <path className="at-ep-line" d={l.line} style={`--c:${l.f.color}`} />)}
        {runs.filter(r => r.gap).map(r => <line className="at-ep-curvegap" x1={x(Math.max(0, r.a - 1))} x2={x(Math.min(last, r.b + 1))} y1={y(0)} y2={y(0)} />)}</g>
      {isToday && last >= 0 && last < points.length - 1 && <g className="at-ep-nowmark"><line x1={x(last)} x2={x(last)} y1={Tp} y2={Tp + ih} /><circle cx={x(last)} cy={y(total(last))} r="4.5" /><circle className="is-pulse" cx={x(last)} cy={y(total(last))} r="4.5" /></g>}
      {pick !== null && pick <= last && <g className="at-ep-cross"><line x1={x(pick)} x2={x(pick)} y1={Tp} y2={Tp + ih} />{!gapAt(pick) && stack[pick].map((v, k) => <circle cx={x(pick)} cy={y(v)} r="4" style={`--c:${shown[k].color}`} />)}</g>}
    </svg>}
  </div>;
}
/** Days, weeks or months as stacked bars that grow in one after another; the ones still to come stand as dashed outlines at the average.
 * A tap or a drag across them reads the bar under the finger (a month's bar is 9 px wide on a phone); a tap on the picked one clears it. */
function Bars({ report, hidden, pick, setPick, t, loc, fmt }: { report: EnergyReport; hidden: string[]; pick: number | null; setPick: (i: number | null) => void; t: T; loc: string; fmt: Fmt }) {
  const [ref, width] = useWidth<HTMLDivElement>(), H = width < 520 ? 200 : 250, L = 38, R = 6, Tp = TOP, B = 22, shown = report.feeds.filter(f => !hidden.includes(f.key)), bs = report.buckets;
  const val = (b: Bucket) => pickSum(b.v, shown.map(f => f.key)), past = counted(report), avg = barAverage(report, val), tap = useRef<{ i: number; clear: boolean } | null>(null);
  const { top, step } = axis(Math.max(0.1, ...bs.map(val), avg) * 1.04), iw = Math.max(1, width - L - R), ih = H - Tp - B, slot = iw / bs.length, bw = Math.max(3, Math.min(42, slot * (bs.length > 20 ? 0.62 : 0.56)));
  const y = (v: number) => Tp + ih - v / top * ih, every = Math.max(1, Math.ceil(bs.length / Math.max(1, Math.floor(iw / (report.period === 'year' ? 34 : 30)))));
  const label = (i: number) => { const b = new Date(bs[i].at), short = (o: Intl.DateTimeFormatOptions) => cap(b.toLocaleDateString(loc, o)).replace('.', ''); if (report.period === 'week') return short({ weekday: 'short' }); if (report.period === 'month') return i % every === 0 ? String(b.getDate()) : ''; if (report.period === 'half') return i === 0 || new Date(bs[i - 1].at).getMonth() !== b.getMonth() ? short({ month: 'short' }) : ''; return i % every === 0 ? short({ month: 'short' }) : ''; };
  const lastPast = bs.reduce((m, b, i) => b.future ? m : i, -1), firstBar = firstCounted(report);
  const key = (e: KeyboardEvent) => { if (lastPast < firstBar) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPick(Math.max(firstBar, Math.min(lastPast, (pick ?? lastPast + 1) + (e.key === 'ArrowLeft' ? -1 : 1)))); } else if (e.key === 'Escape') setPick(null); };
  const raw = (e: PointerEvent) => Math.floor((e.clientX - (e.currentTarget as SVGElement).getBoundingClientRect().left - L) / slot);
  const index = (e: PointerEvent) => lastPast < firstBar ? null : Math.max(firstBar, Math.min(lastPast, raw(e)));
  // a tap on a bar before the statistics or still to come opens nothing (clamped, January opened November and April cleared it); a drag that
  // runs past the ends stays on the last bar it can read
  const down = (e: PointerEvent) => { const i = raw(e); if (lastPast < firstBar || i < firstBar || i > lastPast) return; tap.current = { i, clear: i === pick }; if (i !== pick) setPick(i); };
  const move = (e: PointerEvent) => { if (!e.buttons || !tap.current) return; const i = index(e); if (i === null || i === tap.current.i) return; tap.current = { i, clear: false }; setPick(i); };
  const up = () => { if (tap.current?.clear) setPick(null); tap.current = null; };
  const avgText = t('ep.avgShort', { v: fmt(avg, avg < 10 ? 1 : 0) });
  return <div ref={ref} {...plotProps(t, t('ep.chart.bars', { n: past.length }))} onKeyDown={key}>
    {width > 0 && <svg width={width} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { tap.current = null; }}>
      <text className="at-ep-unit" x={L - 6} y={Tp - 9} text-anchor="end">kWh</text>
      {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map(v => <g className="at-ep-grid"><line x1={L} x2={width - R} y1={y(v)} y2={y(v)} /><text x={L - 6} y={y(v) + 4} text-anchor="end">{fmt(v, step < 1 ? 1 : 0)}</text></g>)}
      {bs.map((b, i) => { const cx = L + slot * i + slot / 2, x0 = cx - bw / 2; if (b.future) return avg > 0 ? <rect className="at-ep-ghost" x={x0} y={y(avg)} width={bw} height={Math.max(0, Tp + ih - y(avg))} rx={Math.min(4, bw / 2)} /> : null;
        let acc = 0; const parts = shown.map(f => { const v = b.v[f.key] ?? 0, h = v / top * ih, part = { f, y0: y(acc + v), h }; acc += v; return part; }).filter(p => p.h > 0.2), topPart = parts.at(-1);
        return <g className={`at-ep-bar${pick !== null && pick !== i ? ' is-dim' : ''}${pick === i ? ' is-pick' : ''}${b.missing ? ' is-gap' : ''}${b.carried ? ' is-carried' : ''}`} style={`--i:${Math.min(i, 30)}`}>
          <rect className="at-ep-hit" x={L + slot * i} y={Tp} width={slot} height={ih} />
          {b.missing && <rect className="at-ep-gapslot" x={x0} y={Tp} width={bw} height={ih} rx={Math.min(4, bw / 2)} />}
          {parts.map(p => p === topPart ? <path d={roundTop(x0, p.y0, bw, p.h, 4)} style={`--c:${p.f.color}`} /> : <rect x={x0} y={p.y0} width={bw} height={p.h + 0.5} style={`--c:${p.f.color}`} />)}
        </g>; })}
      {bs.map((_, i) => { const s = label(i); return s ? <text className={`at-ep-axis${pick === i ? ' is-pick' : ''}`} x={L + slot * i + slot / 2} y={H - 5} text-anchor="middle">{s}</text> : null; })}
      {avg > 0 && <g className="at-ep-avg"><line x1={L} x2={width - R} y1={y(avg)} y2={y(avg)} /><line className="is-key" x1={width - R - avgText.length * 6.2 - 22} x2={width - R - avgText.length * 6.2 - 6} y1={Tp - 13} y2={Tp - 13} /><text x={width - R} y={Tp - 9} text-anchor="end">{avgText}</text></g>}
    </svg>}
  </div>;
}
function Spark({ values }: { values: number[] }) {
  const w = 120, h = 34, max = Math.max(1e-9, ...values); if (values.length < 2) return null;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - 2 - v / max * (h - 4)).toFixed(1)}`);
  return <svg className="at-ep-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path className="is-fill" d={`M0,${h}L${pts.join('L')}L${w},${h}Z`} /><path d={`M${pts.join('L')}`} /></svg>;
}
/** The buildings (owner, 09.11.2026: «Атом и Окапи вместе, бухгалтерия отдельно, офис отдельно»): HA's floors, each with the feeds whose meter
 * stands in one of its rooms. A building without a meter says so instead of a zero. Shown only where there are two buildings or more. */
function Buildings({ floors, feeds, chs, tot, live, floorOfArea, report, t, fmt, kwh, money }: { floors: FloorRow[]; feeds: FeedInfo[]; chs: Array<{ key: string; areaId: string | null }>; tot: Split; live: Split | null; floorOfArea: (a: string | null) => string | null; report: EnergyReport; t: T; fmt: Fmt; kwh: (v: number) => string; money: (v: number) => string }) {
  if (floors.length < 2) return null;
  const floorOf = (k: string) => floorOfArea(chs.find(c => c.key === k)?.areaId ?? null), all = sum(tot);
  const rows = [...floors].sort((a, b) => (a.level ?? 0) - (b.level ?? 0)).map(f => { const keys = feeds.filter(x => floorOf(x.key) === f.floor_id).map(x => x.key); return { f, keys, v: keys.reduce((a, k) => a + (tot[k] ?? 0), 0), w: live && keys.length ? keys.reduce((a, k) => a + (live[k] ?? 0), 0) : null }; });
  return <section className="at-ep-card at-ep-buildings"><h3>{t('ep.buildings')}</h3><div className="at-ep-bld-list">{rows.map(r => <div className={`at-ep-bld${r.keys.length ? '' : ' is-none'}`}>
    <span className="at-ep-bld-name"><Icon name="home" size={18} /><b>{r.f.name}</b><small>{r.keys.length ? t('ep.bld.feeds', { n: r.keys.length }) : t('ep.bld.noMeter')}</small></span>
    {r.keys.length ? <><span className="at-ep-bld-num"><b>{energyText(r.v, fmt).value}</b>{'\u00a0'}kWh<small>≈&nbsp;{money(cost(report, r.keys))}{all ? ` · ${t('ep.share', { n: fmt(r.v / all * 100, 0) })}` : ''}</small></span>
      {r.w !== null && <span className="at-ep-bld-now"><i className="at-ep-live" />{(x => `${x.value}\u00a0${x.unit}`)(powerText(r.w, fmt))}</span>}</> : <span className="at-ep-bld-num is-none">—</span>}
  </div>)}</div></section>;
}
function Row({ label, value, sub, strong }: { label: string; value: ComponentChildren; sub?: string; strong?: boolean }) {
  return <div className={`at-ep-row${strong ? ' is-strong' : ''}`}><span><span>{label}</span>{sub && <small>{sub}</small>}</span><b>{value}</b></div>;
}
function Peak({ report, t, loc, kwh }: { report: EnergyReport; t: T; loc: string; kwh: (v: number) => string }) {
  // a bar that holds a silent stretch's energy is not «the costliest»: its own use is not known
  const past = report.buckets.map((b, i) => ({ v: sum(b.v), i, future: b.future, carried: b.carried })).filter(x => !x.future && !x.carried && x.v > 0); if (past.length < 2) return null;
  const m = past.reduce((a, x) => x.v > a.v ? x : a);
  return <Row label={t(`ep.peak.${report.period}` as Key)} value={kwh(m.v)} sub={bucketName(report, m.i, loc)} />;
}
function Rooms({ report, group, groups, setGroup, prefsOk, carried, t, fmt, kwh, money, onDevice }: { report: EnergyReport; group: FeedInfo | null; groups: FeedInfo[]; setGroup: (k: string) => void; prefsOk: boolean; carried: boolean; t: T; fmt: Fmt; kwh: (v: number) => string; money: (v: number) => string; onDevice: (key: string) => void }) {
  const r = byRoom(report, group?.key ?? null), pct = (v: number) => r.total ? fmt(v / r.total * 100, 0) : '0', w = (v: number) => `width:${r.total ? Math.max(1.5, Math.min(100, v / r.total * 100)) : 0}%`;
  const small = (v: number) => v < 1 ? `${fmt(v, 2)}\u00a0kWh` : kwh(v), rest = group?.key !== UNASSIGNED; // the same rule for a room, its devices and the rest: «0,01 kWh» under «0,0 kWh» no more
  return <section className="at-ep-card at-ep-rooms" style={`--c:${group?.color ?? '#32ade6'}`}>
    <div className="at-ep-rooms-head"><h3>{t('ep.rooms')}</h3>{groups.length > 1 && <div className="ah-segments is-small" role="group" aria-label={t('ep.apartments')}>{groups.map(f => <button type="button" aria-pressed={group?.key === f.key} className={group?.key === f.key ? 'is-active' : ''} onClick={() => setGroup(f.key)}>{f.name}</button>)}</div>}</div>
    {!report.grouped && <p className="at-ep-note at-ep-rooms-hint">{t('ep.roomsHint', { path: `${t('section.settings')} → ${t('setup.rooms')}` })}</p>}
    {!prefsOk && <p className="at-ep-note at-ep-prefs" role="status">{t('ep.prefsFail')}</p>}
    <p className="at-ep-rooms-total"><b>{small(r.total)}</b> ≈&nbsp;{money(lei(r.total, report))}</p>
    {!r.rooms.length && <p className="hm-muted">{t('ep.noMeters')}</p>}
    <div className="at-ep-room-list" key={`${group?.key}${report.period}${report.offset}`}>
      {r.rooms.map((room, n) => <div className="at-ep-room" style={`--i:${n}`}>
        <div className="at-ep-room-line"><strong>{room.room}</strong><span>{small(room.kwh)}</span><small>{`${pct(room.kwh)}\u00a0%`}</small></div>
        <span className="at-ep-meter"><i style={w(room.kwh)} /></span>
        {room.devices.map(d => <button type="button" className="at-ep-dev" onClick={() => onDevice(d.key)}><span>{d.name}</span><span className="at-ep-meter is-thin"><i style={w(d.kwh)} /></span><b>{small(d.kwh)}</b><small>{money(lei(d.kwh, report))}</small></button>)}
      </div>)}
      {rest && <div className="at-ep-room is-rest" style={`--i:${r.rooms.length}`}><div className="at-ep-room-line"><strong>{t('ep.rest')}</strong><span>{small(r.rest)}</span><small>{`${pct(r.rest)}\u00a0%`}</small></div><span className="at-ep-meter"><i style={w(r.rest)} /></span><p className="at-ep-note">{t('ep.restHint')}</p>{carried && <p className="at-ep-note at-ep-carried"><span aria-hidden="true">*&nbsp;</span>{t('ep.carried')}</p>}</div>}
    </div>
  </section>;
}
function Network({ n, feed, live, t, fmt }: { n: EnergyReport['network'][number]; feed: FeedInfo; live: boolean; t: T; fmt: Fmt }) {
  const lo = 200, hi = 260, at = (v: number) => `${Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100))}%`, known = n.voltsMin !== null && n.voltsMax !== null, ok = known && n.voltsMin! >= 207 && n.voltsMax! <= 253;
  // now and silent: «нет связи», never a blank; a past period without readings: «—»
  return <div className="at-ep-netrow" style={`--c:${feed.color}`}>
    <div className="at-ep-netline"><strong><i />{feed.name}</strong>{n.volts !== null ? <b>{`${fmt(n.volts, 0)}\u00a0V`}</b> : live ? <b className="is-off">{t('overview.energy.offline')}</b> : <b>{known ? '' : '—'}</b>}</div>
    {known && <div className="at-ep-volt" aria-hidden="true"><span className="at-ep-norm" style={`left:${at(207)};right:calc(100% - ${at(253)})`} /><span className={`at-ep-span${ok ? '' : ' is-bad'}`} style={`left:${at(n.voltsMin!)};right:calc(100% - ${at(n.voltsMax!)})`} />{n.volts !== null && <span className="at-ep-dot" style={`left:${at(n.volts)}`} />}</div>}
    <div className="at-ep-netfacts">{known && <span className={ok ? '' : 'is-bad'}>{t('ep.range', { a: fmt(n.voltsMin!, 0), b: fmt(n.voltsMax!, 0) })}{ok ? '' : ` · ${t('ep.outOfNorm')}`}</span>}{n.amps !== null && <span>{t('ep.amps', { v: fmt(n.amps, 1) })}</span>}{n.ampsMax !== null && <span>{t('ep.ampsMax', { v: fmt(n.ampsMax, 1) })}</span>}{n.pf !== null && <span>{t('ep.pf', { v: fmt(n.pf, 2) })}</span>}</div>
  </div>;
}
function Sessions({ report, sessions, color, missed, t, loc, kwh, money, fmt }: { report: EnergyReport; sessions: NonNullable<EnergyReport['sessions']>; color: string; missed: number; t: T; loc: string; kwh: (v: number) => string; money: (v: number) => string; fmt: Fmt }) {
  const [more, setMore] = useState(false), s = sessions, total = s.reduce((a, x) => a + x.kwh, 0), list = more ? s : s.slice(0, 5);
  const time = (v: number) => new Date(v).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  return <section className="at-ep-card at-ep-sessions" style={`--c:${color}`}>
    <div className="at-ep-rooms-head"><h3>{t('ep.sessions')}</h3>{s.length > 0 && <span className="at-ep-sessum">{t('ep.sessions.count', { n: s.length })} · {kwh(total)} · ≈&nbsp;{money(s.reduce((a, x) => a + costOf(report, x.kwh, x.start), 0))}</span>}</div>
    {missed > 0 && <p className="at-ep-note at-ep-missed">{t('ep.sessions.missed', { kwh: kwh(missed) })}</p>}
    {!s.length ? <p className="hm-muted">{t('ep.sessions.none')}</p> : <div className="at-ep-sess-list">{list.map(x => <div className="at-ep-sess">
      <span className="at-ep-sess-icon" aria-hidden="true"><Icon name="energy" size={16} /></span>
      <span className="at-ep-sess-when"><strong>{cap(new Date(x.start).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'long' }))}</strong><small>{time(x.start)}–{time(x.end)} · {t('ep.hours', { v: fmt((x.end - x.start) / 3600000, 1) })} · {t('ep.upTo', { v: fmt(x.peakW / 1000, 1) })}</small></span>
      <span className="at-ep-sess-sum"><b>{kwh(x.kwh)}</b><small>≈&nbsp;{money(costOf(report, x.kwh, x.start))}</small></span>
    </div>)}{s.length > 5 && <button type="button" className="hm-pill at-ep-more" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? t('ep.less') : t('ep.more', { n: s.length - 5 })}</button>}</div>}
  </section>;
}
