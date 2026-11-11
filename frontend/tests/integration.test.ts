// What the integration pass of the audit of 09.11.2026 closed (the leftovers of the six fix agents): each test fails without its fix.
process.env.TZ = 'America/New_York'; // a browser seven hours behind the house: the zone tests below are about exactly that
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sleepTime, parseSleep } from '../src/model/lights.ts';
import { roomClimate, type Home } from '../src/model/discover.ts';
import type { Registry } from '../src/model/registry.ts';
import { peopleChips, menuFit, panelLayout } from '../src/ui/panel-size.ts';
import { restartNeeded } from '../src/runtime/store.ts';
import { haStore } from '../src/runtime/ha-store.ts';
import { setHouseZone, houseZone, houseDate, houseToReal, houseMonthStart, zoneOffset, zoneOption } from '../src/runtime/zone.ts';
import { nextFire, isTomorrow, sunInfo } from '../src/modules/clock-state.ts';
import { liveHost, type Hass } from '../src/runtime/host.ts';
import { watts } from '../src/ui/room-words.ts';
import { translator } from '../src/i18n/index.ts';
import { ru } from '../src/i18n/ru.ts';
import { en } from '../src/i18n/en.ts';
import { ro } from '../src/i18n/ro.ts';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const T = { ru: translator('ru'), en: translator('en'), ro: translator('ro') };

test('light timers: the integration\'s own answer wins over the mirror helper, which is only the fallback', () => {
  const mirror = 'light.a|17:40';
  assert.equal(sleepTime('light.b', { 'light.b': '2026-11-10T21:15:00+02:00' }, mirror), '21:15', 'a timer the helper had no room for is still shown');
  assert.equal(sleepTime('light.a', {}, mirror), null, 'the answer says no timer runs: a stale mirror does not bring it back');
  assert.equal(sleepTime('light.a', null, mirror), '17:40', 'an older integration has no answer: the mirror stays');
  assert.equal(sleepTime('light.a', undefined, undefined), null);
  assert.equal(sleepTime('light.b', { 'light.b': 'soon' }, mirror), null, 'a moment that is no moment is not shown');
  assert.equal(sleepTime('light.b', { 'light.b': '2026-11-10T23:05:00-05:00' }, ''), '23:05', 'the house\'s own clock is read from the text, whatever zone the browser is in');
  assert.deepEqual(parseSleep(mirror), { 'light.a': '17:40' });
});

test('the room list and the room page agree: a silent area link is «no reading», never another sensor\'s number', () => {
  const st = (state: string) => ({ state, attributes: {}, last_changed: '', last_updated: '' });
  const reg = { states: { 'sensor.link_h': st('unavailable'), 'sensor.link_t': st('21.5'), 'sensor.other_h': st('61'), 'sensor.other_t': st('19') } } as unknown as Registry;
  const env = { enabled: true, roomId: 'bath', kind: 'environment', metrics: [{ id: 'sensor.other_h', deviceClass: 'humidity', available: true, state: '61' }, { id: 'sensor.other_t', deviceClass: 'temperature', available: true, state: '19' }] };
  const home = (room: object) => ({ rooms: [{ id: 'bath', ...room }], devices: [env] }) as unknown as Home;
  assert.equal(roomClimate(home({ areaHumidity: 'sensor.link_h', areaTemperature: 'sensor.link_t' }), reg, 'bath').humidity, null, 'the link is silent: no 61 % from the other sensor');
  assert.equal(roomClimate(home({ areaHumidity: 'sensor.link_h', areaTemperature: 'sensor.link_t' }), reg, 'bath').temperature, 21.5);
  assert.equal(roomClimate(home({ areaHumidity: 'sensor.gone', areaTemperature: null }), reg, 'bath').humidity, null, 'a link to an entity that is not there is silent too');
  const none = roomClimate(home({ areaHumidity: null, areaTemperature: null }), reg, 'bath');
  assert.deepEqual([none.temperature, none.humidity], [19, 61], 'an area that names no sensor still takes the room\'s own');
});

test('header: one chip per person only where there is room; a phone on its side and a compact panel get the avatar stack', () => {
  const at = (w: number, h: number) => peopleChips(panelLayout({ width: w, height: h }, { noHover: true, noPointer: false }), 4);
  assert.equal(at(1070, 764), true, 'the wall tablet keeps its chips');
  assert.equal(at(1440, 900), true); assert.equal(at(1024, 600), true, 'a wide short panel has the room');
  assert.equal(at(792, 360), false, 'a phone on its side'); assert.equal(at(932, 430), false);
  assert.equal(at(640, 900), false, '600–760 px: the chips were cut to «Cri…»'); assert.equal(at(700, 1000), false);
  assert.equal(at(360, 792), false); assert.equal(at(768, 1024), true);
  assert.equal(peopleChips(panelLayout({ width: 1070, height: 764 }, { noHover: true, noPointer: false }), 5), false, 'five people never fit as chips');
});

test('header menus under the TV / 4K zoom: the measured box is turned into the shell\'s own pixels', () => {
  // a 4K television: the shell is a 960×540 layout drawn 4×; the menu's box is measured in screen pixels
  const fit = menuFit({ left: 3000, right: 3800, top: 400, bottom: 2600 }, { width: 3840, height: 2160 }, 4);
  assert.equal(fit.maxHeight, (2160 - 48 - 400) / 4, 'the room below, in layout pixels (was 4× too large: the menu ran off the screen)');
  assert.equal(fit.dx, (3840 - 48 - 3800) / 4);
  assert.deepEqual(menuFit({ left: 100, right: 300, top: 60, bottom: 200 }, { width: 1070, height: 764 }, 1), { dx: 0, maxHeight: null }, 'a menu that fits is left alone');
  assert.deepEqual(menuFit({ left: 2, right: 202, top: 60, bottom: 500 }, { width: 360, height: 400 }, 1), { dx: 10, maxHeight: 400 - 12 - 60 }, 'no zoom: as before');
  assert.equal(menuFit({ left: 0, right: 10, top: 390, bottom: 500 }, { width: 360, height: 400 }, 1).maxHeight, 96, 'never less than two rows');
  assert.equal(menuFit({ left: 100, right: 300, top: 60, bottom: 500 }, { width: 400, height: 400 }, 0).maxHeight, 328, 'a zoom that cannot be measured counts as 1');
  assert.match(src('ui/head-tools.tsx'), /menuFit\(r, \{[^}]+\}, zoom\)/, 'the header uses it');
});

test('an update without a restart of Home Assistant is noticed: the panel\'s version against the integration\'s', async () => {
  assert.equal(restartNeeded('1.26.0', '1.25.7'), true);
  assert.equal(restartNeeded('1.25.7', '1.25.7'), false); assert.equal(restartNeeded('1.25.7', ' 1.25.7 '), false);
  assert.equal(restartNeeded(null, '1.25.7'), false, 'a development build knows no version'); assert.equal(restartNeeded('1.26.0', undefined), false, 'an integration that says nothing');
  assert.equal(restartNeeded('1.26.0', '0'), false, '«0» is the integration\'s «could not read my manifest», not a version');
  const store = haStore(() => ({ callWS: async () => ({ config: null, version: '1.25.7', admin: true, revision: 3 }) }) as unknown as Hass);
  assert.equal((await store.load()).serverVersion, '1.25.7', 'the store hands the server\'s version on');
  assert.match(readFileSync(new URL('../vite.live.config.ts', import.meta.url), 'utf8'), /__ATOM_VERSION__: JSON\.stringify\(version\)/, 'the build writes the manifest\'s version into the bundle');
  for (const d of [ru, en, ro]) assert.match(d['ui.restartNeeded'], /Home Assistant/);
});

test('the house\'s time zone: Host carries it, and the clock, the sun, «next alarm» and the month are the house\'s', () => {
  const hass = { states: {}, config: { time_zone: 'Europe/Chisinau' }, callWS: async () => null, callService: async () => null } as unknown as Hass;
  assert.equal(liveHost(() => hass).timeZone, 'Europe/Chisinau');
  assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), 300, 'this test runs as a browser in New York');
  const real = Date.UTC(2026, 10, 10, 20, 30); // 22:30 in Criuleni, 15:30 in New York
  setHouseZone(undefined); assert.equal(houseZone(), undefined); assert.equal(houseDate(real).getHours(), 15, 'no zone known: the browser\'s clock, as before'); assert.deepEqual(zoneOption(), {});
  setHouseZone('Not/AZone'); assert.equal(houseZone(), undefined, 'a zone the browser does not know is no zone');
  setHouseZone('Europe/Chisinau'); assert.deepEqual(zoneOption(), { timeZone: 'Europe/Chisinau' });
  assert.equal(zoneOffset(real, 'Europe/Chisinau'), 2 * 3600_000); assert.equal(zoneOffset(Date.UTC(2026, 6, 1), 'Europe/Chisinau'), 3 * 3600_000, 'summer time');
  const wall = houseDate(real); assert.deepEqual([wall.getDate(), wall.getHours(), wall.getMinutes()], [10, 22, 30], 'the hands show the house\'s time');
  assert.equal(houseToReal(wall), real);
  // …and on the days the clocks change, the BROWSER's or the house's (round 2 of the audit: this test pinned one November day and did not see
  // the hands an hour off for 13 hours a year from New York). 8 March: New York goes to summer time at 07:00 UTC; 1 November: back at 06:00 UTC;
  // 29 March and 25 October: the house's own changes. Every hour of those days and of the days around them
  const houseClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Chisinau', hourCycle: 'h23', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  for (const [mo, d] of [[2, 8], [10, 1], [2, 29], [9, 25]]) for (let t = Date.UTC(2026, mo, d - 1, 0, 30); t < Date.UTC(2026, mo, d + 2); t += 3600_000) {
    const p = Object.fromEntries(houseClock.formatToParts(t).map(x => [x.type, Number(x.value)])), w = houseDate(t);
    // the one clock time New York itself skips (02:00–03:00 of 8 March) cannot be a Date of this browser: Date moves it an hour on
    if (!(mo === 2 && d === 8 && p.day === 8 && p.hour === 2)) assert.deepEqual([w.getDate(), w.getHours(), w.getMinutes()], [p.day, p.hour, p.minute], `the hands at ${new Date(t).toISOString()}`);
    assert.equal(houseToReal(w), t, `and back: ${new Date(t).toISOString()}`); // the hour the house shows twice (25 October, 03:00–04:00) included
  }
  assert.deepEqual([houseDate(Date.UTC(2026, 2, 8, 5, 0)).getHours(), houseDate(Date.UTC(2026, 10, 1, 3, 0)).getHours()], [7, 5], 'seven and five in the house (the hands said eight and four)');
  assert.equal(nextFire({ time: '07:00', days: [], enabled: true }, new Date(Date.UTC(2026, 2, 8, 4, 0))), Date.UTC(2026, 2, 8, 5, 0), 'an alarm on the morning New York changes its clocks');
  assert.equal(nextFire({ time: '07:00', days: [], enabled: true }, new Date(Date.UTC(2026, 10, 1, 3, 0))), Date.UTC(2026, 10, 1, 5, 0), '…and on the morning it changes them back');
  assert.equal(nextFire({ time: '07:00', days: [], enabled: true }, new Date(Date.UTC(2026, 9, 24, 20, 0))), Date.UTC(2026, 9, 25, 5, 0), 'the house\'s 25-hour day: still seven by its wall');
  // an alarm «07:00» rings at seven by the house's clock: 05:00 UTC, which is midnight in New York — not seven in New York
  const at = nextFire({ time: '07:00', days: [], enabled: true }, new Date(real));
  assert.equal(at, Date.UTC(2026, 10, 11, 5, 0)); assert.equal(isTomorrow(at!, new Date(real)), true, 'tomorrow by the house\'s calendar');
  assert.equal(nextFire({ time: '23:00', days: [], enabled: true }, new Date(real)), Date.UTC(2026, 10, 10, 21, 0), 'today while the house\'s clock has not passed it');
  assert.equal(nextFire({ time: '07:00', days: [3], enabled: true }, new Date(real)), Date.UTC(2026, 10, 11, 5, 0), '11 November 2026 is a Wednesday in the house');
  assert.equal(isTomorrow(Date.UTC(2026, 10, 10, 21, 50), new Date(real)), false);
  // through the change of the clocks (29 March 2026, 03:00 → 04:00 in Moldova): «07:00» next morning is still seven by the wall
  assert.equal(nextFire({ time: '07:00', days: [], enabled: true }, new Date(Date.UTC(2026, 2, 28, 20, 0))), Date.UTC(2026, 2, 29, 4, 0));
  // the month begins at the house's midnight: 30 November 22:00 UTC is already 1 December in the house
  assert.equal(houseMonthStart(Date.UTC(2026, 10, 30, 22, 30)), Date.UTC(2026, 10, 30, 22, 0));
  assert.equal(houseMonthStart(real), Date.UTC(2026, 9, 31, 22, 0));
  // before dawn in the house (03:00) it is still «yesterday evening» in New York: sunrise and sunset are both today's
  const night = Date.UTC(2026, 10, 11, 1, 0), sun = sunInfo({ state: 'below_horizon', attributes: { next_rising: '2026-11-11T05:10:00+00:00', next_setting: '2026-11-11T14:40:00+00:00', elevation: -30 }, last_changed: '', last_updated: '' }, night);
  assert.deepEqual([sun.rise, sun.set], [Date.UTC(2026, 10, 11, 5, 10), Date.UTC(2026, 10, 11, 14, 40)]);
  setHouseZone(undefined);
  assert.match(src('ui/app.tsx'), /setHouseZone\(bareHost\.timeZone\)/, 'the shell sets it');
  assert.match(src('runtime/host.ts'), /houseMonthStart\(now\.getTime\(\), current\(\)\.config\?\.time_zone\)/, 'the energy month starts on the house\'s 1st');
});

test('words: one of a thing is counted as one, «нет связи» is one word for one state, 999,5 W is a kilowatt', () => {
  assert.equal(T.ru('module.heat.heatN', { n: 1, total: 5 }), 'Греет 1 из 5'); assert.equal(T.ru('module.heat.heatN', { n: 3, total: 5 }), 'Греют 3 из 5'); assert.equal(T.ru('module.heat.heatN', { n: 21, total: 30 }), 'Греет 21 из 30');
  assert.equal(T.ro('module.heat.heatN', { n: 1, total: 5 }), 'Încălzește 1 din 5');
  for (const n of [1, 2, 5, 7, 21]) for (const l of ['ru', 'en', 'ro'] as const) assert.match(T[l]('module.doorbell.archiveNote', { n }), /клипами$|clips$|clipuri$/, `${l} ${n}: every form says what the days hold`);
  assert.equal(T.ru('module.doorbell.archiveNote', { n: 1 }), '1 день со снимками и клипами');
  assert.equal(T.ru('room.d.drumIn', { n: 5 }), 'Чистка барабана через 5 циклов'); assert.equal(T.ru('room.d.drumIn', { n: 2 }), 'Чистка барабана через 2 цикла'); assert.equal(T.en('room.d.drumIn', { n: 1 }), 'Drum clean in 1 cycle');
  assert.match(src('ui/room-words.ts'), /k\('drumIn', \{ n: Math\.round\(drum\) \}\)/, 'the count is a number, or no form is chosen');
  for (const d of [ru, en, ro]) { assert.equal(d['room.d.offline'], d['state.unavailable']); assert.ok(d['room.d.offlinePlugOff'].startsWith(d['state.unavailable'])); }
  assert.equal(watts(999.6, T.ru, 'ru'), watts(1000, T.ru, 'ru')); assert.doesNotMatch(watts(999.6, T.ru, 'ru'), /1.000/); assert.match(watts(999.4, T.ru, 'ru'), /^999/);
  for (const d of [ru, en, ro]) for (const k of ['ui.done', 'ui.stale', 'ui.restartNeeded', 'ui.tempLower', 'ui.tempRaise', 'ui.closeSheet'] as const) assert.ok(d[k] && d[k].length > 1, k);
});

test('the shell\'s live region does not share a class with the camera\'s LIVE badge', () => {
  const app = src('ui/app.tsx'), css = src('styles/apple.css') + src('styles/atom.css') + src('styles/home.css');
  assert.match(app, /className="hm-announce"[^>]*aria-live="assertive"/); assert.ok(!/aria-live="assertive"/.test(app.split('\n').filter(l => /hm-live/.test(l)).join('\n')) && !app.includes('<div className="hm-live"'), 'no live region is called hm-live');
  assert.doesNotMatch(css, /\.hm-shell>\.hm-live/, 'the stop-gap scoping is gone');
  assert.match(css, /\.hm-shell>\.hm-announce\{[^}]*pointer-events:none/, 'the region covers the shell and takes no taps');
  assert.match(src('modules/go2rtc-view.tsx'), /className=\{`hm-live /, 'the badge keeps its name');
});

test('sheets: «×» is «Закрыть окно» everywhere, the runner says whether the house accepted, a status role is not put on a reading', () => {
  for (const f of ['modules/event-feed.tsx', 'modules/doorbell.tsx', 'modules/air.tsx', 'modules/clock.tsx', 'modules/camera-go2rtc.tsx', 'modules/kettle.tsx', 'modules/pet-feeder.tsx', 'ui/sheet.tsx'])
    assert.doesNotMatch(src(f), /aria-label=\{t\('ui\.close'\)\}[^>]*>×/, f);
  assert.notEqual(ru['ui.closeSheet'], ru['ui.close']);
  assert.match(src('ui/sheet.tsx'), /run\(device: HomeDevice, action: Action, value\?: unknown\): Promise<boolean>/);
  assert.doesNotMatch(src('modules/boiler-ebus.tsx'), /role="status"/);
});
