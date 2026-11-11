"""The room alarms without Home Assistant: python3 tests/components/atom_home/test_alarms.py

The real alarms.py and config_state.py run against the stand-ins of ha_stub.py; the test moves the clock.
"""
import asyncio
import pathlib
import sys
import types
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stub  # noqa: E402
from ha_stub import TZ, State, World, run, use  # noqa: E402

alarms = ha_stub.load("alarms")
cs = ha_stub.load("config_state")

FLAG, TEXT, LAMP, KIDS, STATION = "input_boolean.alarm_ringing", "input_text.alarm_ringing", "light.bedroom_lamp", "light.kids_chandelier", "media_player.living_yandex_max"


def at(day, hh, mm, ss=0):
    return datetime(2026, 11, day, hh, mm, ss, tzinfo=TZ)


def world(**kw):
    w = use(World(**{FLAG.replace(".", "__"): "off", TEXT.replace(".", "__"): State("", max=255), **kw}))
    # The sunrise sleeps 30 s between steps: the world's clock stands in for the loop's.
    alarms.asyncio = types.SimpleNamespace(sleep=w.sleep, CancelledError=asyncio.CancelledError, Task=asyncio.Task)
    return w


def one(**kw):
    return alarms.normalise_alarms([{"id": "a1", "room": "spalnia", "time": "07:00", "days": [], "enabled": True, **kw}])


class Once(unittest.TestCase):
    def test_no_weekdays_rings_once_and_switches_itself_off(self):
        async def go():
            w, spent = world(), []

            async def on_once(alarm_id):
                spent.append(alarm_id)
            s = alarms.AlarmScheduler(w, on_once)
            s.set_alarms(one(label="Самолёт"))
            self.assertEqual(s.summary()["next"], [{"id": "a1", "at": at(10, 7, 0).isoformat()}])
            await w.advance(at(10, 7, 0))
            self.assertEqual(len(w.named("input_boolean.turn_on")), 1, "it rang")
            self.assertEqual(spent, ["a1"], "the caller is told to store it switched off")
            self.assertEqual(s.summary()["next"], [], "«один раз»: no ring tomorrow")
            await s.stop()
            await w.advance(at(13, 12, 0))
            self.assertEqual(len(w.named("input_boolean.turn_on")), 1, "three more mornings, not one more ring")
            self.assertEqual(w.live_timers(), [])
            s.shutdown()
        run(go())

    def test_weekdays_go_on_ringing(self):
        async def go():
            w, spent = world(), []

            async def on_once(alarm_id):
                spent.append(alarm_id)
            s = alarms.AlarmScheduler(w, on_once)
            s.set_alarms(one(days=[1, 2, 3, 4, 5, 6, 7]))
            for day in (10, 11, 12):
                await w.advance(at(day, 7, 0))
                await s.stop()
            self.assertEqual(len(w.named("input_boolean.turn_on")), 3)
            self.assertEqual(spent, [])
            s.shutdown()
        run(go())

    def test_the_spent_alarm_still_repeats_and_snoozes(self):
        async def go():
            w = world()
            s = alarms.AlarmScheduler(w)
            s.set_alarms(one(repeats=2, repeatEveryMin=5))
            await w.advance(at(10, 7, 0))
            await w.advance(at(10, 7, 5))
            self.assertEqual(len(w.named("input_text.set_value")), 2, "the first repeat, five minutes on")
            await s.snooze(9)
            await w.advance(at(10, 7, 14))
            self.assertEqual(len(w.named("input_text.set_value")), 3, "«Ещё 9 минут»")
            await s.stop()
            await w.advance(at(11, 8, 0))
            self.assertEqual(len(w.named("input_text.set_value")), 3)
            s.shutdown()
        run(go())

    def test_it_is_stored_switched_off_and_nothing_else_changes(self):
        async def go():
            w, saved = world(), []

            async def save(data):
                saved.append(data)
            stored = {"schemaVersion": 1, "home": {"name": "Criuleni", "theme": "dark"}, "rooms": {"spalnia": {"feed": "apt9"}}, "alarms": [
                {"id": "a1", "room": "spalnia", "time": "07:00", "days": [], "enabled": True, "label": "Самолёт"},
                {"id": "a2", "room": "detskaia", "time": "07:30", "days": [1, 2, 3, 4, 5], "enabled": True}]}
            state = cs.ConfigState(stored, 57, save)
            s = alarms.AlarmScheduler(w, lambda alarm_id: state.write_alarms(alarms.switched_off(alarm_id)))
            s.set_alarms(alarms.normalise_alarms(stored["alarms"]))
            await w.advance(at(10, 7, 0))
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]["revision"], 58, "open panels see that the alarms changed")
            self.assertEqual([(a["id"], a["enabled"]) for a in saved[0]["config"]["alarms"]], [("a1", False), ("a2", True)])
            self.assertEqual({k: v for k, v in saved[0]["config"].items() if k != "alarms"}, {k: v for k, v in stored.items() if k != "alarms"})
            self.assertEqual(saved[0]["config"]["alarms"][0]["label"], "Самолёт")
            await s.stop()
            await w.advance(at(10, 7, 30))
            self.assertEqual(len(saved), 1, "an alarm with weekdays is not written off")
            # After a restart the scheduler reads the stored list: the spent alarm does not come back.
            again = alarms.AlarmScheduler(w)
            again.set_alarms(alarms.normalise_alarms(state.config["alarms"]))
            self.assertEqual([n["id"] for n in again.summary()["next"]], ["a2"])
            s.shutdown()
            again.shutdown()
        run(go())

    def test_a_save_that_was_being_written_when_it_rang_does_not_bring_it_back(self):
        async def go():
            w = world(now=at(10, 6, 59, 59))
            once = {"id": "a1", "room": "spalnia", "time": "07:00", "days": [], "enabled": True}
            gate, disk = asyncio.Event(), {}

            async def save(data):  # the disk is slow: the write of the panel's save is still going when 07:00 comes
                await gate.wait()
                disk.update(data)
            state = cs.ConfigState({"schemaVersion": 1, "alarms": [once]}, 57, save)
            s = alarms.AlarmScheduler(w, lambda alarm_id: state.write_alarms(alarms.switched_off(alarm_id)))
            s.set_alarms(alarms.normalise_alarms([once]))
            new = alarms.normalise_alarms([once, {"id": "a2", "room": "detskaia", "time": "07:30", "days": [1], "enabled": True}])

            async def panel():  # what atom_home/alarms/set does: write, then hand the list it wrote to the scheduler
                _revision, _current, saved = await state.write_alarms(lambda _stored: new, 57, None)
                s.set_alarms(saved)
            writing = asyncio.ensure_future(panel())
            await w.settle()
            await w.advance(at(10, 7, 0))  # it rings; its own switch-off waits for the panel's write to finish
            gate.set()
            await writing
            await w.settle()
            self.assertEqual([(a["id"], a["enabled"]) for a in disk["config"]["alarms"]], [("a1", False), ("a2", True)])
            self.assertEqual([n["id"] for n in s.summary()["next"]], ["a2"], "the list written a moment before the ring still had it on: it stays off here too")
            await s.stop()
            await w.advance(at(11, 7, 0, 1))
            self.assertEqual(len(w.named("input_boolean.turn_on")), 1, "no second ring the next morning")
            # switched on again by hand later, it rings again: nothing of the spent mark is left
            s.set_alarms(alarms.normalise_alarms([once]))
            self.assertEqual([n["id"] for n in s.summary()["next"]], ["a1"])
            s.shutdown()
        run(go())

    def test_a_switch_off_that_could_not_be_stored_still_frees_the_alarm_for_a_later_save(self):
        async def go():
            w = world()

            async def refuse(_alarm_id):
                raise cs.ConfigWriteError("save_failed", "disk full")
            s = alarms.AlarmScheduler(w, refuse)
            s.set_alarms(one())
            with self.assertLogs(alarms._LOGGER, "ERROR"):
                await w.advance(at(10, 7, 0))
            self.assertEqual(s.summary()["next"], [])
            s.set_alarms(one())  # the owner switches it on again in the list
            self.assertEqual([n["id"] for n in s.summary()["next"]], ["a1"])
            s.shutdown()
        run(go())

    def test_switched_off_writes_nothing_when_there_is_nothing_to_change(self):
        self.assertIsNone(alarms.switched_off("a1")([{"id": "a1", "enabled": False}, {"id": "a2"}]))
        self.assertIsNone(alarms.switched_off("gone")([{"id": "a2"}]))
        self.assertEqual(alarms.switched_off("a1")([{"id": "a1", "time": "07:00"}, "junk"]), [{"id": "a1", "time": "07:00", "enabled": False}, "junk"])


def brightness(w, entity=LAMP):
    return [(c[0][3:], c[2]["brightness_pct"]) for c in w.named("light.turn_on") if c[2]["entity_id"] == entity]


class Sunrise(unittest.TestCase):
    def test_a_save_of_the_settings_does_not_start_the_sunrise_again(self):
        async def go():
            w = world()
            s = alarms.AlarmScheduler(w)
            mine = one(light=True, lightEntity=LAMP, fadeMin=15)
            s.set_alarms(mine)
            await w.advance(at(10, 6, 54, 45))
            before = brightness(w)
            self.assertGreater(before[-1][1], 60, "ten minutes in")
            s.set_alarms(one(light=True, lightEntity=LAMP, fadeMin=15))  # a theme switched on another screen: the same alarms come back
            s.set_alarms(mine + alarms.normalise_alarms([{"id": "b7", "room": "gostinaia", "time": "09:00"}]))  # someone adds an alarm elsewhere
            await w.advance(at(10, 6, 56))
            after = brightness(w)[len(before):]
            self.assertTrue(after and all(pct >= before[-1][1] for _, pct in after), f"it went on from where it was, not from 1 %: {after}")
            self.assertEqual(sum(1 for _, pct in brightness(w) if pct == 1), 1)
            await w.advance(at(10, 7, 0))
            self.assertEqual(brightness(w)[-1][1], 100)
            s.shutdown()
        run(go())

    def test_a_sunrise_begun_late_lasts_to_the_ring_and_a_save_does_not_begin_it_again(self):
        async def go():
            w = world(now=at(10, 6, 50, 20))  # Home Assistant came up 9 min 40 s before the ring: not a whole number of steps
            s = alarms.AlarmScheduler(w)
            mine = one(light=True, lightEntity=LAMP, fadeMin=15, days=[2])
            s.set_alarms(mine)
            await w.settle()
            await w.advance(at(10, 6, 59, 55))
            before = brightness(w)
            self.assertEqual(before[0][1], 1)
            self.assertEqual(before[-1][0], "06:59:50", "still going in the last half minute")
            s.set_alarms(one(light=True, lightEntity=LAMP, fadeMin=15, days=[2]))  # a theme switched on another screen, 5 s before the ring
            await w.advance(at(10, 6, 59, 59))
            levels = [pct for _, pct in brightness(w)]
            self.assertEqual(levels.count(1), 1, f"not from 1 % again: {brightness(w)[len(before):]}")
            self.assertEqual(levels, sorted(levels), "the lamp only ever gets brighter")
            self.assertGreaterEqual(levels[-1], 95)
            await w.advance(at(10, 7, 0))
            self.assertEqual(brightness(w)[-1], ("07:00:00", 100))
            await w.advance(at(10, 7, 5))
            self.assertEqual(brightness(w)[-1], ("07:00:00", 100), "nothing after the ring")
            await s.stop()
            s.shutdown()
        run(go())

    def test_a_sunrise_resumed_before_the_light_service_exists_goes_on_once_it_does(self):
        async def go():
            w = world(now=at(10, 6, 50), running=False)  # Home Assistant restarted in the middle of the sunrise
            w.refuse.add("light")  # atom_home sets up before `light`: light.turn_on is not there yet
            s = alarms.AlarmScheduler(w)
            with self.assertLogs(alarms._LOGGER, "WARNING") as logs:
                s.set_alarms(one(light=True, lightEntity=LAMP, fadeMin=15, days=[2]))
                await w.settle()
                await w.advance(at(10, 6, 51, 15))
            self.assertEqual(len(logs.output), 1, "said once, not every half minute")
            self.assertEqual(brightness(w), [])
            w.refuse.clear()
            await w.advance(at(10, 6, 55))
            self.assertGreater(len(brightness(w)), 5, "the sunrise goes on as soon as the lamp can be commanded")
            self.assertGreater(brightness(w)[0][1], 10, "from where the morning is, not from 1 %")
            await s.stop()
            s.shutdown()
        run(go())

    def test_two_rooms_fade_side_by_side(self):
        async def go():
            w = world()
            s = alarms.AlarmScheduler(w)
            s.set_alarms(alarms.normalise_alarms([
                {"id": "bed", "room": "spalnia", "time": "07:00", "days": [2], "light": True, "lightEntity": LAMP, "fadeMin": 15},
                {"id": "kid", "room": "detskaia", "time": "07:10", "days": [2], "light": True, "lightEntity": KIDS, "fadeMin": 15}]))
            await w.advance(at(10, 6, 55, 10))
            n = len(brightness(w))
            await w.advance(at(10, 6, 59, 50))
            self.assertGreater(len(brightness(w)), n + 5, "the bedroom's sunrise goes on after the nursery's began at 06:55")
            self.assertGreater(len(brightness(w, KIDS)), 5)
            await w.advance(at(10, 7, 0))
            await s.stop()  # «Стоп» for the bedroom
            n = len(brightness(w, KIDS))
            await w.advance(at(10, 7, 5))
            self.assertGreater(len(brightness(w, KIDS)), n + 5, "the nursery's sunrise is not stopped by the bedroom's «Стоп»")
            s.shutdown()
        run(go())

    def test_a_changed_or_removed_alarm_stops_its_sunrise(self):
        async def go():
            w = world()
            s = alarms.AlarmScheduler(w)
            s.set_alarms(one(light=True, lightEntity=LAMP, fadeMin=15))
            await w.advance(at(10, 6, 50))
            s.set_alarms(one(light=True, lightEntity=LAMP, fadeMin=15, time="08:00"))
            n = len(brightness(w))
            await w.advance(at(10, 6, 58))
            self.assertEqual(len(brightness(w)), n, "moved to 08:00: the 07:00 sunrise stops")
            await w.advance(at(10, 7, 50))
            s.set_alarms([])
            n = len(brightness(w))
            await w.advance(at(10, 7, 59))
            self.assertEqual(len(brightness(w)), n, "deleted: no more light commands")
            s.shutdown()
        run(go())

    def test_unload_leaves_nothing_running(self):
        async def go():
            w = world()
            s = alarms.AlarmScheduler(w)
            s.set_alarms(one(light=True, lightEntity=LAMP, fadeMin=15))
            await w.advance(at(10, 6, 50))
            s.shutdown()
            await w.settle()
            n = len(w.calls)
            await w.advance(at(10, 7, 30))
            self.assertEqual(len(w.calls), n)
            self.assertEqual((w.live_timers(), [r for r in w.listeners if r[2]], w.tasks), ([], [], []))
        run(go())


class Restart(unittest.TestCase):
    MUSIC = dict(alice="music", station=STATION, days=[1, 2, 3, 4, 5, 6, 7])

    def test_a_ring_cut_by_a_restart_is_cleared_once_ha_is_up(self):
        async def go():
            w = use(World(running=False))  # atom_home sets up before input_boolean / input_text have restored their states
            s = alarms.AlarmScheduler(w)
            s.set_alarms(one(**self.MUSIC))
            s.start()
            await w.settle()
            self.assertEqual(w.calls, [], "nothing is commanded before Home Assistant is up")
            w.map[FLAG], w.map[TEXT] = State("on"), State("a1|spalnia|07:00||0", max=255)
            await w.start()
            self.assertEqual([(c[1], c[2].get("entity_id")) for c in w.calls], [("media_player.media_stop", STATION), ("input_boolean.turn_off", FLAG), ("input_text.set_value", TEXT)])
            self.assertEqual((w.map[FLAG].state, w.map[TEXT].state), ("off", ""))
            s.shutdown()
        run(go())

    def test_a_quiet_house_is_left_alone_at_start(self):
        async def go():
            w = use(World(running=False, **{FLAG.replace(".", "__"): "off", TEXT.replace(".", "__"): "a1|spalnia|07:00||0"}))  # the text keeps the last ring
            s = alarms.AlarmScheduler(w)
            s.set_alarms(one(**self.MUSIC))
            s.start()
            await w.start()
            self.assertEqual(w.named("media_player.media_stop"), [], "music someone listens to is not stopped by a restart")
            self.assertEqual(w.named("input_boolean.turn_off"), [])
            s.shutdown()
        run(go())

    def test_stop_on_a_stale_banner_silences_the_speaker(self):
        async def go():
            w = world(**{FLAG.replace(".", "__"): "on", TEXT.replace(".", "__"): "a1|spalnia|07:00||0"})
            s = alarms.AlarmScheduler(w)
            s.set_alarms(one(**self.MUSIC))
            await s.stop()  # atom_home/alarm/stop from the banner; this run never rang
            self.assertEqual([c[2]["entity_id"] for c in w.named("media_player.media_stop")], [STATION])
            self.assertEqual(w.map[FLAG].state, "off")
            s.shutdown()
        run(go())

    def test_a_speaker_that_refuses_does_not_keep_the_banner(self):
        async def go():
            w = world()
            s = alarms.AlarmScheduler(w)
            s.set_alarms(one(**self.MUSIC))
            await w.advance(at(10, 7, 0))
            self.assertEqual(w.map[FLAG].state, "on")
            w.refuse.add("media_player")
            await s.stop()
            self.assertEqual(w.map[FLAG].state, "off")
            self.assertIsNone(s.summary()["ringing"])
            s.shutdown()
        run(go())

    def test_unload_before_start_forgets_the_clean_up(self):
        async def go():
            w = use(World(running=False, **{FLAG.replace(".", "__"): "on"}))
            s = alarms.AlarmScheduler(w)
            s.start()
            s.shutdown()
            await w.start()
            self.assertEqual(w.calls, [])
        run(go())


class Manifest(unittest.TestCase):
    def test_the_helpers_load_first(self):
        import json
        manifest = json.loads((ha_stub.SRC / "manifest.json").read_text(encoding="utf-8"))
        self.assertLessEqual({"input_boolean", "input_text"}, set(manifest.get("after_dependencies", [])))


if __name__ == "__main__":
    unittest.main()
