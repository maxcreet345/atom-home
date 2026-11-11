"""The integration's HTTP addresses and WebSocket commands without Home Assistant: python3 tests/components/atom_home/test_surface.py

The real __init__.py is set up against the stand-ins of ha_stub.py: what a signed-out browser gets, how the bundle goes
over the wire, what a non-admin may do, and that an unload leaves nothing behind.
"""
import asyncio
import gzip
import os
import pathlib
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stub  # noqa: E402
from ha_stub import TZ, Connection, Request, State, run, send  # noqa: E402

ah = ha_stub.install_surface()
bundle = sys.modules["atom_home_surface.bundle"]

LAMP, BOILER, STATION = "light.bedroom_lamp", "switch.kitchen_boiler_heat_relay", "media_player.living_yandex_max"
FLAG, TEXT, MIRROR = "input_boolean.alarm_ringing", "input_text.alarm_ringing", "input_text.atom_light_sleep"
HELPERS = {FLAG: "off", TEXT: State("", max=255), MIRROR: State("", max=255)}
STORED = {"schemaVersion": 1, "home": {"name": "Criuleni", "language": "ru", "theme": "light"}, "rooms": {"spalnia": {"feed": "apt9"}}, "devices": {}, "energy": {"tariffs": [{"from": "2026-04-02", "lei": 3.56}]},
          "alarms": [{"id": "a1", "room": "spalnia", "time": "07:00", "days": [1, 2, 3, 4, 5], "enabled": True, "light": True, "lightEntity": LAMP, "fadeMin": 15}]}
JS = ("export const panel = 'Atom Home';\n" * 4000).encode()


class Surface(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        front = pathlib.Path(self.tmp.name) / "frontend"
        front.mkdir()
        (front / "atom-home.js").write_bytes(JS)
        ah.FRONTEND_DIR = front

    async def house(self, stored=STORED, revision=57, states=None, running=True):
        w = ha_stub.house(self.tmp.name, running=running, **{k.replace(".", "__"): v for k, v in {**HELPERS, LAMP: "on", BOILER: "on", **(states or {})}.items() if v is not None})
        ha_stub.COMMANDS.clear()
        w.stored["atom_home.config"] = {"config": stored, "revision": revision} if stored is not None else None
        self.entry = types.SimpleNamespace(entry_id="entry1", disabled_by=None)
        self.assertTrue(await ah.async_setup_entry(w, self.entry))
        await w.settle()
        return w

    def view(self, w, kind):
        return next(v for v in w.views if isinstance(v, kind))


class Http(Surface):
    def test_the_bundle_goes_out_compressed_to_who_accepts_it(self):
        async def go():
            w = await self.house()
            view = self.view(w, ah.BundleView)
            etag = '"' + bundle.etag_of((ah.FRONTEND_DIR / "atom-home.js").stat()) + '"'
            r = await view.get(Request(w, {"Accept-Encoding": "gzip, deflate, br"}, {"e": etag.strip('"')}))
            self.assertEqual((r.status, r.headers.get("Content-Encoding"), r.headers["ETag"], r.content_type), (200, "gzip", etag, "text/javascript"))
            self.assertEqual(gzip.decompress(r.body), JS)
            self.assertLess(len(r.body), len(JS) // 3)
            self.assertIn("Accept-Encoding", r.headers["Vary"], "a cache between the house and the phone must not hand gzip to a client that cannot read it")
            self.assertIn("immutable", r.headers["Cache-Control"])
            plain = await view.get(Request(w, {}, {}))
            self.assertEqual((plain.body, plain.headers.get("Content-Encoding"), plain.headers["Cache-Control"]), (JS, None, "no-cache"))
            refused = await view.get(Request(w, {"Accept-Encoding": "gzip;q=0, identity"}))
            self.assertEqual(refused.body, JS)
            again = await view.get(Request(w, {"Accept-Encoding": "gzip", "If-None-Match": etag}))
            self.assertEqual((again.status, again.body), (304, None))
        run(go())

    def test_head_answers_like_get_without_the_file(self):
        async def go():
            w = await self.house()
            view, jobs = self.view(w, ah.BundleView), []
            etag = '"' + bundle.etag_of((ah.FRONTEND_DIR / "atom-home.js").stat()) + '"'
            self.assertTrue(callable(getattr(view, "head", None)), "Home Assistant registers only the methods a view has: without `head` a «curl -I» gets 405")
            real = w.async_add_executor_job

            async def counted(func, *args):
                jobs.append(getattr(func, "__name__", str(func)))
                return await real(func, *args)
            w.async_add_executor_job = counted
            r = await view.head(Request(w, {"Accept-Encoding": "gzip"}, {"e": etag.strip('"')}))
            self.assertEqual(jobs, ["stat"], "the megabyte is neither read nor compressed for a question about the headers")
            got = await view.get(Request(w, {"Accept-Encoding": "gzip"}, {"e": etag.strip('"')}))
            self.assertEqual((r.status, r.body, r.content_type), (200, None, "text/javascript"))
            self.assertEqual(r.headers, got.headers, "the headers a GET would carry")
            self.assertEqual((await view.head(Request(w, {"If-None-Match": etag}))).status, 304)
            (ah.FRONTEND_DIR / "atom-home.js").unlink()
            self.assertEqual((await view.head(Request(w))).status, 404)
        run(go())

    def test_if_none_match_weak_or_a_list(self):
        async def go():
            w = await self.house()
            view = self.view(w, ah.BundleView)
            etag = '"' + bundle.etag_of((ah.FRONTEND_DIR / "atom-home.js").stat()) + '"'
            for header in (etag, "W/" + etag, f'"0-0", {etag}', f'"0-0" , W/{etag},"1-1"', "*"):
                r = await view.get(Request(w, {"Accept-Encoding": "gzip", "If-None-Match": header}))
                self.assertEqual((r.status, r.body, r.headers["ETag"]), (304, None, etag), header)
            for header in ('"0-0"', 'W/"0-0", "1-1"', etag.strip('"'), "", " , "):
                r = await view.get(Request(w, {"If-None-Match": header}))
                self.assertEqual((r.status, r.body), (200, JS), header)
        run(go())

    def test_etag_matches(self):
        for header, expected in (('"a-1"', True), ('W/"a-1"', True), ('w/"a-1"', True), ('"b", "a-1"', True), ("*", True), ('"b", *', True), ('"a-10"', False), ("a-1", False), ('"b"', False), (None, False), ("", False)):
            self.assertEqual(bundle.etag_matches(header, '"a-1"'), expected, header)
        self.assertTrue(bundle.etag_matches('"a-1"', 'W/"a-1"'))

    def test_compressed_once_per_build_and_off_the_event_loop(self):
        async def go():
            w = await self.house()
            view, jobs, threads = self.view(w, ah.BundleView), [], set()
            real = w.async_add_executor_job

            async def counted(func, *args):
                import threading
                jobs.append(getattr(func, "__name__", str(func)))

                def traced(*a):
                    threads.add(threading.current_thread() is threading.main_thread())
                    return func(*a)
                return await real(traced, *args)
            w.async_add_executor_job = counted
            both = await asyncio.gather(*(view.get(Request(w, {"Accept-Encoding": "gzip"})) for _ in range(4)))
            await view.get(Request(w, {"Accept-Encoding": "gzip"}))
            self.assertEqual(len({r.body for r in both}), 1)
            self.assertEqual(jobs.count("_compress"), 1, "four panels opening at once and a fifth later share one compression")
            self.assertEqual(threads, {False}, "the file is read, measured and compressed in a worker thread")
            path = ah.FRONTEND_DIR / "atom-home.js"  # HACS replaces the file without a restart
            path.write_bytes(JS + b"// 1.25.8\n")
            os.utime(path, (1800000000, 1800000000))
            fresh = await view.get(Request(w, {"Accept-Encoding": "gzip"}))
            self.assertEqual(gzip.decompress(fresh.body), JS + b"// 1.25.8\n")
            self.assertNotEqual(fresh.headers["ETag"], both[0].headers["ETag"])
            path.unlink()
            self.assertEqual((await view.get(Request(w, {"Accept-Encoding": "gzip"}))).status, 404)
        run(go())

    def test_accept_encoding(self):
        for header, expected in (("gzip", True), ("GZIP, br", True), ("br, gzip;q=0.5", True), ("*", True), ("x-gzip", True), ("br", False), ("", False), (None, False), ("gzip;q=0", False), ("*;q=0", False), ("identity, *;q=0, gzip;q=0.1", True), ("gzip;q=x", False)):
            self.assertEqual(bundle.accepts_gzip(header), expected, header)

    def test_a_failed_compression_is_tried_again(self):
        async def go():
            cache, calls = bundle.GzipCache(), []

            async def executor(func, path):
                calls.append(path)
                if len(calls) == 1:
                    raise OSError("the file is being replaced")
                return func(path)
            path = ah.FRONTEND_DIR / "atom-home.js"
            with self.assertRaises(OSError):
                await cache.get(executor, path, "e1")
            self.assertEqual(gzip.decompress(await cache.get(executor, path, "e1")), JS)
            await cache.get(executor, path, "e1")
            self.assertEqual(len(calls), 2)
        run(go())

    def test_a_signed_out_browser_learns_only_which_bundle_is_current(self):
        async def go():
            w = await self.house()
            r = await self.view(w, ah.MetaView).get(Request(w))
            self.assertEqual(list(r.body), ["etag"], "no version of the integration for a stranger")
            self.assertEqual(r.headers["Cache-Control"], "no-store")
            self.assertIn("m.etag", ah.LOADER_JS)
            self.assertNotIn("m.version", ah.LOADER_JS)
        run(go())


class Alarms(Surface):
    NEW = {"id": "b2", "room": "gostinaia", "time": "06:30", "days": [], "enabled": True}

    def test_a_save_elsewhere_that_left_the_alarms_alone_does_not_block_an_alarm(self):
        async def go():
            w = await self.house()
            admin, tablet = Connection(admin=True), Connection()
            await send(admin, type="atom_home/config/set", config={**STORED, "home": {**STORED["home"], "theme": "dark"}}, expected_revision=57, client_features=["device_composition_v1", "room_feed_v1", "energy_tariff_v1"])
            self.assertEqual(admin.results, [{"saved": True, "revision": 58}])
            await send(tablet, type="atom_home/alarms/set", alarms=STORED["alarms"] + [self.NEW], expected_revision=57)  # the tablet has not read since
            self.assertEqual(tablet.errors, [], "the theme was switched on the Mac; the tablet's alarm list is still the current one")
            self.assertEqual([a["id"] for a in tablet.results[0]["alarms"]], ["a1", "b2"])
            self.assertNotIn("revision", tablet.results[0], "its copy of the rest is old: it must not take the new revision and save a light theme back over the dark one")
            stored = w.stored["atom_home.config"]
            self.assertEqual((stored["revision"], stored["config"]["home"]["theme"], len(stored["config"]["alarms"])), (59, "dark", 2))
            self.assertEqual({k: v for k, v in stored["config"].items() if k not in ("alarms", "home")}, {k: v for k, v in STORED.items() if k not in ("alarms", "home")})
            # …and then switches the new alarm off: the same tablet, still at revision 57, holding the list it was just answered with
            await send(tablet, type="atom_home/alarms/set", alarms=[STORED["alarms"][0], {**self.NEW, "enabled": False}], expected_revision=57)
            self.assertEqual(tablet.errors, [], "its second alarm save in a row is not refused either")
            phone = Connection()  # a third screen, also at 57, that has not seen the tablet's alarm
            await send(phone, type="atom_home/alarms/set", alarms=STORED["alarms"], expected_revision=57)
            self.assertEqual([code for code, _ in phone.errors], ["conflict"], "its old list would wipe the tablet's alarm")
            self.assertEqual(len(w.stored["atom_home.config"]["config"]["alarms"]), 2)
            tablet.close()
            self.assertEqual(tablet.subscriptions and [k for k in tablet.subscriptions], ["atom_home/alarms/seen"])
            again = Connection()
            await send(again, type="atom_home/alarms/set", alarms=[], expected_revision=57)
            self.assertEqual([code for code, _ in again.errors], ["conflict"], "nothing of a closed socket is remembered for the next one")
        run(go())

    def test_alarms_changed_elsewhere_are_still_a_conflict(self):
        async def go():
            w = await self.house()
            phone, tablet = Connection(), Connection()
            await send(phone, type="atom_home/alarms/set", alarms=STORED["alarms"] + [self.NEW], expected_revision=57)
            self.assertEqual(phone.results[0]["revision"], 58, "a panel that was current gets the new revision")
            await send(tablet, type="atom_home/alarms/set", alarms=[], expected_revision=57)
            self.assertEqual([code for code, _ in tablet.errors], ["conflict"], "the tablet has not seen the phone's alarm: its list would wipe it")
            self.assertEqual(len(w.stored["atom_home.config"]["config"]["alarms"]), 2)
            await send(tablet, type="atom_home/config/get")
            got = tablet.results[-1]
            await send(tablet, type="atom_home/alarms/set", alarms=got["config"]["alarms"][:1], expected_revision=got["revision"])
            self.assertEqual(tablet.results[-1]["revision"], 59, "after reading afresh it saves")
        run(go())

    def test_an_admin_who_took_a_stale_alarm_answer_cannot_overwrite_newer_settings(self):
        async def go():
            w = await self.house()
            mac, pad = Connection(admin=True), Connection(admin=True)
            features = ["device_composition_v1", "room_feed_v1", "energy_tariff_v1"]
            await send(mac, type="atom_home/config/set", config={**STORED, "home": {**STORED["home"], "theme": "dark"}}, expected_revision=57, client_features=features)
            await send(pad, type="atom_home/alarms/set", alarms=STORED["alarms"] + [self.NEW], expected_revision=57)
            revision = pad.results[-1].get("revision", 57)  # what ha-store.ts keeps: the answer's revision when there is one
            await send(pad, type="atom_home/config/set", config={**STORED, "alarms": pad.results[-1]["alarms"]}, expected_revision=revision, client_features=features)
            self.assertEqual([code for code, _ in pad.errors], ["conflict"])
            self.assertEqual(w.stored["atom_home.config"]["config"]["home"]["theme"], "dark")
        run(go())

    def test_nothing_stored_yet(self):
        async def go():
            w = await self.house(stored=None)
            user = Connection()
            await send(user, type="atom_home/alarms/set", alarms=[self.NEW])
            self.assertEqual(user.errors, [])
            config = w.stored["atom_home.config"]["config"]
            self.assertEqual((config["schemaVersion"], [a["id"] for a in config["alarms"]]), (1, ["b2"]))
        run(go())

    def test_a_once_alarm_is_stored_switched_off_after_it_rang(self):
        async def go():
            w = await self.house(stored={**STORED, "alarms": [self.NEW]})
            await w.advance(datetime(2026, 11, 10, 6, 30, tzinfo=TZ))
            self.assertEqual(w.map[FLAG].state, "on")
            stored = w.stored["atom_home.config"]
            self.assertEqual((stored["revision"], stored["config"]["alarms"][0]["enabled"], stored["config"]["rooms"]), (58, False, STORED["rooms"]))
            user = Connection()
            await send(user, type="atom_home/config/get")
            self.assertFalse(user.results[0]["config"]["alarms"][0]["enabled"], "the panel reads it as switched off")
            await send(user, type="atom_home/alarms/state")
            self.assertEqual(user.results[-1]["next"], [])
            await send(user, type="atom_home/alarm/stop")
            await w.advance(datetime(2026, 11, 12, 12, 0, tzinfo=TZ))
            self.assertEqual(len(w.named("input_boolean.turn_on")), 1)
        run(go())

    def test_a_user_cannot_point_an_alarm_at_what_he_may_not_command(self):
        async def go():
            w = await self.house()
            guest = Connection(deny={STATION, LAMP})
            with self.assertRaises(ha_stub.Unauthorized):
                await send(guest, type="atom_home/alarms/set", alarms=STORED["alarms"] + [{**self.NEW, "alice": "tts", "phrase": "Подъём", "station": STATION}], expected_revision=57)
            self.assertEqual(w.stored["atom_home.config"]["revision"], 57)
            await send(guest, type="atom_home/alarms/set", alarms=STORED["alarms"] + [self.NEW], expected_revision=57)
            self.assertEqual(guest.errors, [], "the lamp of an alarm that is already stored is not asked for again: he only added his own")
        run(go())


class LightSleep(Surface):
    def test_only_what_the_user_may_command_and_only_the_offered_minutes(self):
        async def go():
            w = await self.house()
            guest = Connection(deny={BOILER})
            with self.assertRaises(ha_stub.Unauthorized):
                await send(guest, type="atom_home/light/sleep", entity_id=BOILER, minutes=15)
            await w.advance(minutes=20)
            self.assertEqual(w.named("homeassistant.turn_off"), [])
            rule = ha_stub.COMMANDS["atom_home/light/sleep"].schema["minutes"]
            self.assertEqual((rule.kind, tuple(rule.args[0])), ("in", (0, 15, 30, 60)), "not «in one minute», not «in twelve hours»")
            await send(guest, type="atom_home/light/sleep", entity_id="light.no_such_lamp", minutes=15)
            self.assertEqual([code for code, _ in guest.errors], ["not_found"])
        run(go())

    def test_the_switch_off_carries_who_asked(self):
        async def go():
            w = await self.house()
            user = Connection()
            await send(user, type="atom_home/light/sleep", entity_id=LAMP, minutes=15)
            self.assertEqual(user.results[0]["until"], (w.now + timedelta(minutes=15)).isoformat())
            await send(user, type="atom_home/light/sleep/state")
            self.assertEqual(list(user.results[-1]["pending"]), [LAMP])
            await w.advance(minutes=15)
            self.assertEqual([(c[1], c[3]) for c in w.calls if c[1] == "light.turn_off"], [("light.turn_off", "context of daniela")])
        run(go())


class Lifecycle(Surface):
    def test_admin_only_commands(self):
        async def go():
            await self.house()
            guarded = sorted(name for name, func in ha_stub.COMMANDS.items() if getattr(func, "admin_only", False))
            self.assertEqual(guarded, ["atom_home/config/set", "atom_home/photo/delete", "atom_home/photo/set"], "everything that writes the house configuration or files")
            user = Connection()
            with self.assertRaises(ha_stub.Unauthorized):
                await send(user, type="atom_home/config/set", config=STORED, expected_revision=57)
        run(go())

    def test_missing_or_short_helpers_are_reported_in_repairs(self):
        async def go():
            w = await self.house(states={MIRROR: None, TEXT: State("", max=100)}, running=False)
            self.assertEqual(w.issues, {}, "judged once Home Assistant is up: before that the helpers may not be loaded yet")
            await w.start()
            self.assertEqual(w.issues["missing_helpers"]["translation_placeholders"], {"helpers": MIRROR})
            self.assertEqual(w.issues["short_helpers"]["translation_placeholders"], {"helpers": TEXT})
            self.assertFalse(w.issues["missing_helpers"]["is_fixable"])
            import json
            for name in ("strings.json", "translations/en.json", "translations/ru.json", "translations/ro.json"):
                issues = json.loads((ha_stub.SRC / name).read_text(encoding="utf-8"))["issues"]
                for key in w.issues:
                    self.assertIn("{helpers}", issues[key]["description"], f"{name}: {key}")
                    self.assertTrue(issues[key]["title"])
            ok = await self.house()
            self.assertEqual(ok.issues, {})
        run(go())

    def test_unload_takes_its_repairs_along(self):
        async def go():
            w = await self.house(states={MIRROR: None, TEXT: State("", max=100)})
            self.assertEqual(sorted(w.issues), ["missing_helpers", "short_helpers"])
            self.assertTrue(await ah.async_unload_entry(w, self.entry))
            self.assertEqual(w.issues, {}, "an integration that is switched off must not go on asking for its helpers in «Исправления»")
            self.assertTrue(await ah.async_setup_entry(w, self.entry))  # a reload judges them afresh
            await w.settle()
            self.assertEqual(sorted(w.issues), ["missing_helpers", "short_helpers"])
            await ah.async_unload_entry(w, self.entry)
        run(go())

    def test_a_read_during_a_reload_is_refused_not_answered_with_an_empty_house(self):
        async def go():
            w = await self.house()
            user, admin = Connection(), Connection(admin=True)
            self.assertTrue(await ah.async_unload_entry(w, self.entry))  # the first half of a reload; the panel's five-minute read lands here
            await send(user, type="atom_home/config/get")
            self.assertEqual(user.results, [], "«config: null, revision: 0» would be shown as a house with factory settings")
            self.assertEqual([code for code, _ in user.errors], ["not_loaded"], "an error: the panel keeps what it has and reads again")
            await send(admin, type="atom_home/config/set", config=STORED, expected_revision=57)
            self.assertEqual([code for code, _ in admin.errors], ["not_loaded"], "the same code as a save at this moment")
            self.assertTrue(await ah.async_setup_entry(w, self.entry))
            await send(user, type="atom_home/config/get")
            self.assertEqual((user.results[-1]["revision"], user.results[-1]["config"]["home"]["name"]), (57, "Criuleni"))
            await ah.async_unload_entry(w, self.entry)
            fresh = await self.house(stored=None)  # a house with nothing stored yet is still an answer, not an error
            await send(user, type="atom_home/config/get")
            self.assertEqual((user.results[-1]["config"], user.results[-1]["revision"]), (None, 0))
            self.assertEqual(len(user.errors), 1)
            await ah.async_unload_entry(fresh, self.entry)
        run(go())

    def test_a_reload_after_a_hacs_update_still_answers_with_the_version_that_runs(self):
        async def go():
            real, kept = ah._version, ah._RUNNING_VERSION
            self.addCleanup(lambda: (setattr(ah, "_version", real), setattr(ah, "_RUNNING_VERSION", kept)))
            ah._RUNNING_VERSION, ah._version = None, lambda: "1.25.7"  # Home Assistant starts on 1.25.7
            w = await self.house()
            user = Connection()
            await send(user, type="atom_home/config/get")
            self.assertEqual(user.results[-1]["version"], "1.25.7")
            ah._version = lambda: "1.26.0"  # HACS replaced the files; the Python in memory is still 1.25.7
            self.assertTrue(await ah.async_unload_entry(w, self.entry))
            self.assertTrue(await ah.async_setup_entry(w, self.entry))  # «Перезагрузить» on the integration, no restart
            await send(user, type="atom_home/config/get")
            self.assertEqual(user.results[-1]["version"], "1.25.7", "the panel (already 1.26.0) must go on saying that a restart is needed")
            self.assertEqual(w.data["_panels"][-1]["config"], {"version": "1.25.7"})
            await ah.async_unload_entry(w, self.entry)
        run(go())

    def test_hashed_pictures_may_be_kept_the_bundle_folder_may_not(self):
        async def go():
            (ah.FRONTEND_DIR / "assets").mkdir()
            w = await self.house()
            paths = [(url, cache) for url, _path, cache in w.static]
            self.assertIn(("/atom_home_static/assets", True), paths, "file names with a hash: cached for good")
            self.assertIn(("/atom_home_static", False), paths)
            self.assertLess(paths.index(("/atom_home_static/assets", True)), paths.index(("/atom_home_static", False)), "the longer path must be registered first, or the folder's rule answers for it")
        run(go())

    def test_a_build_without_pictures_still_sets_up(self):
        async def go():
            w = await self.house()
            self.assertEqual([(url, cache) for url, _path, cache in w.static if url.startswith("/atom_home_static")], [("/atom_home_static", False)])
        run(go())

    def test_unload_leaves_nothing_behind(self):
        async def go():
            w = await self.house(stored={**STORED, "alarms": [{**STORED["alarms"][0], "days": []}]}, running=False)
            w.now = datetime(2026, 11, 10, 6, 50, tzinfo=TZ)
            user = Connection()
            await send(user, type="atom_home/alarms/set", alarms=[{**STORED["alarms"][0], "days": []}], expected_revision=57)  # a sunrise is under way
            w.running = True
            await send(user, type="atom_home/light/sleep", entity_id=LAMP, minutes=15)
            self.assertTrue(await ah.async_unload_entry(w, self.entry))
            await w.settle()
            n = len(w.calls)
            await w.start()
            await w.advance(hours=2)
            self.assertEqual(len(w.calls), n, "no timer, listener, sunrise or start-up job outlives the unload")
            self.assertEqual((w.live_timers(), [r for r in w.listeners if r[2]], w.tasks), ([], [], []))
            self.assertEqual(w.data["_removed_panels"], ["atom-home"])
        run(go())


if __name__ == "__main__":
    unittest.main()
