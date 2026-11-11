"""The Air card's jobs without Home Assistant: python3 tests/components/atom_home/test_air_tasks.py"""
import asyncio
import importlib.util
import pathlib
import unittest
from types import SimpleNamespace as NS

spec = importlib.util.spec_from_file_location("air_tasks", pathlib.Path(__file__).parents[3] / "custom_components/atom_home/air_tasks.py")
air = importlib.util.module_from_spec(spec)
spec.loader.exec_module(air)


class Fake:
    def __init__(self, **states):
        self.calls, self.states_map, self.saved, self.stored, self.tasks, self.now = [], dict(states), None, None, [], 1000.0
        self.listeners, self.timers, self.fail, self.started, self.month, self.categories, self.gate = [], [], False, [], 1, {}, None
        self.gate_only, self.stuck, self.hang, self.contexts, self.removed = None, set(), set(), [], False
        self.fail_only, self.raise_after, self.renames = None, set(), []
        self.states = NS(get=lambda e: NS(state=self.states_map[e]) if e in self.states_map else None)
        self.services = NS(async_call=self._call)

    async def _call(self, domain, service, data, blocking=False, context=None):
        if self.gate and self.gate_only in (None, service):
            await self.gate.wait()
        if self.fail and self.fail_only in (None, service):
            raise RuntimeError("refused")
        if service in self.hang:
            await asyncio.Event().wait()
        self.calls.append((domain, service, data["entity_id"]))
        self.contexts.append(context)
        if service not in self.stuck:  # accepted and done; «stuck» is a relay that accepts and stays as it was
            self.states_map[data["entity_id"]] = "on" if service == "turn_on" else "off"
        if service in self.raise_after:  # the device obeyed, the call still failed
            raise RuntimeError("obeyed, then refused")

    def async_create_task(self, coro):
        self.tasks.append(coro)

    async def drain(self):
        while self.tasks:
            await self.tasks.pop()

    def make(self):
        fake = self

        class Store:
            async def async_load(self):
                return fake.stored

            async def async_save(self, data):
                fake.saved = data

            async def async_remove(self):
                fake.removed = True

        def track(_h, entities, cb):
            self.listeners.append((entities, cb))
            return lambda: self.listeners.remove((entities, cb))

        def later(_h, seconds, cb):
            self.timers.append((seconds, cb))
            return lambda: self.timers.remove((seconds, cb))

        def renames(_h, cb):
            self.renames.append(cb)
            return lambda: self.renames.remove(cb)

        return air.AirTasks(self, Store(), track, later, lambda: self.now, at_started=lambda _h, cb: self.started.append(cb) or (lambda: None), month=lambda: self.month, category=lambda e: self.categories.get(e), track_rename=renames)

    def event(self, entity, state, old="same"):
        """A state_changed event. By default the old state is what HA holds now, as in life."""
        before = self.states_map.get(entity) if old == "same" else old
        if state is None:
            self.states_map.pop(entity, None)
        else:
            self.states_map[entity] = state
        for entities, cb in list(self.listeners):
            if entity in entities:
                cb(NS(data={"entity_id": entity, "new_state": NS(state=state) if state is not None else None, "old_state": NS(state=before) if before is not None else None}))


VENT, HUM = "fan.bath_vent", "sensor.bath_climate_humidity"


def run(coro):
    return asyncio.run(coro)


class Jobs(unittest.TestCase):
    def test_runs_until_the_norm_then_stops_by_itself(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(f.calls, [("homeassistant", "turn_on", VENT)])
            self.assertEqual(t.summary()[0]["target"], 60, "January: the heating season")
            f.event(HUM, "65")
            await f.drain()
            self.assertEqual(len(f.calls), 1, "still above the norm")
            f.event(HUM, "60")
            await f.drain()
            self.assertEqual(f.calls[-1], ("homeassistant", "turn_off", VENT))
            self.assertEqual(t.summary(), [])
            self.assertEqual(f.listeners, [])
            self.assertEqual(f.timers, [])
        run(go())

    def test_an_hour_at_most(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(f.timers[0][0], 3600)
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(f.calls[-1][1], "turn_off")
            self.assertEqual([x.get("outcome") for x in t.summary()], ["out_of_time"], "the panel can say why it stopped short")
        run(go())

    def test_a_device_that_was_on_stays_on(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(f.calls, [])
            f.event(HUM, "50")
            await f.drain()
            self.assertEqual(f.calls, [])
            self.assertEqual(t.summary(), [])
        run(go())

    def test_stop_and_switching_off_by_hand(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            await t.stop(VENT)
            self.assertEqual(f.calls[-1][1], "turn_off")
            f2 = Fake(**{VENT: "off", HUM: "78"})
            t2 = f2.make()
            await t2.start("dehumidify", "vannaia", VENT, HUM)
            f2.event(VENT, "off", old="on")
            await f2.drain()
            self.assertEqual(f2.calls, [("homeassistant", "turn_on", VENT)], "by hand: no second command")
            self.assertEqual(t2.summary(), [])
        run(go())

    def test_a_double_tap_starts_one_job(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(len(f.calls), 1)
            self.assertEqual(len(t.summary()), 1)
        run(go())

    def test_refusals(self):
        async def go():
            f = Fake(**{VENT: "unavailable", HUM: "78", "light.x": "off"})
            t = f.make()
            with self.assertRaises(ValueError):
                await t.start("dehumidify", "vannaia", VENT, HUM)
            for bad in (("melt", "r", VENT, HUM), ("dehumidify", "r", "light.x", HUM), ("dehumidify", "r", "lock.door", HUM), ("dehumidify", "r", VENT, "light.x"), ("humidify", "r", VENT, HUM), ("dehumidify", "r", "switch.kitchen_cat_feeder_prevent_accumulation", HUM), ("dehumidify", "r", "switch.bath_dryer_wrinkle_prevent", HUM), ("purify", "r", "fan.living_air_purifier", HUM), ("purify", "r", "humidifier.x", HUM), ("dehumidify", "../x", VENT, HUM)):
                with self.assertRaises(ValueError):
                    await t.start(*bad)
            self.assertEqual(f.calls, [])
        run(go())

    def test_nothing_to_fix_starts_nothing(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "55"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual((f.calls, t.summary()), ([], []))
        run(go())

    def test_a_refused_start_leaves_no_job(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.fail, f.fail_only = True, "turn_on"
            t = f.make()
            with self.assertRaises(RuntimeError):
                await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(t.summary(), [])
            self.assertEqual(f.saved, {"jobs": []}, "not left on disk either")
            self.assertEqual(f.calls, [("homeassistant", "turn_off", VENT)], "it may have gone through")
        run(go())

    def test_a_start_and_its_switch_off_both_refused_end_at_the_next_look(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.fail = True
            t = f.make()
            with self.assertRaises(RuntimeError):
                await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual([x["stopping"] for x in t.summary()], [True], "the off did not go through: not forgotten yet")
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual((t.summary(), f.saved, f.listeners, f.timers), ([], {"jobs": []}, [], []), "it reads off a minute later")
        run(go())

    def test_a_turn_on_that_raises_after_the_device_obeyed_leaves_nothing_running(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.raise_after.add("turn_on")
            t = f.make()
            with self.assertRaises(RuntimeError):
                await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(f.calls, [("homeassistant", "turn_on", VENT), ("homeassistant", "turn_off", VENT)])
            self.assertEqual((f.states_map[VENT], t.summary(), f.saved), ("off", [], {"jobs": []}), "the panel is told, the vent is off")
        run(go())

    def test_the_target_is_judged_on_the_number_the_panel_prints(self):
        self.assertTrue(air.reached("dehumidify", "60.4", 60), "the panel prints 60 %")
        self.assertFalse(air.reached("dehumidify", "60.5", 60), "the panel prints 61 %; Python's round would make it 60")
        self.assertTrue(air.reached("dehumidify", "59.5", 60))
        self.assertTrue(air.reached("purify", "15.4", 15))
        self.assertFalse(air.reached("purify", "15.5", 15))
        self.assertFalse(air.reached("dehumidify", "unavailable", 60))
        self.assertFalse(air.reached("dehumidify", "nan", 60))

    def test_a_clock_behind_at_load_does_not_stretch_the_hour(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            f.stored = {"jobs": [{"kind": "dehumidify", "roomId": "vannaia", "device": VENT, "sensor": HUM, "target": 60, "startedAt": f.now + 86400, "wasOn": False, "stopping": False}]}
            t = f.make()
            await t.async_load()
            self.assertEqual(f.timers[0][0], 3600)
        run(go())

    def test_a_vent_gone_mid_job_is_noticed_in_a_minute(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.event(VENT, None)
            seconds, gone = f.timers[-1]
            self.assertEqual(seconds, 60)
            gone(None)
            await f.drain()
            self.assertEqual((t.summary(), f.calls, f.saved, f.listeners, f.timers), ([], [], {"jobs": []}, [], []), "no command: there is nothing to send it to")
        run(go())

    def test_a_vent_back_within_the_minute_keeps_its_job(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.event(VENT, None)
            f.event(VENT, "on", old=None)
            f.timers[-1][1](None)
            await f.drain()
            self.assertEqual(([x["stopping"] for x in t.summary()], f.calls[1:]), ([False], []), "a reload of its integration is not a removal")
        run(go())

    def test_a_renamed_vent_takes_its_job_along(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            t = f.make()
            await t.async_load()
            await t.start("dehumidify", "vannaia", VENT, HUM, context="who")
            new = "fan.bath_vent_2"
            f.renames[0](NS(data={"action": "update", "entity_id": new, "old_entity_id": VENT, "changes": {}}))
            await f.drain()
            self.assertEqual([x["device"] for x in t.summary()], [new])
            self.assertEqual([x["device"] for x in f.saved["jobs"]], [new], "the stored row too")
            self.assertEqual([e for e, _ in f.listeners], [[new, HUM]], "and its listeners")
            f.states_map[new] = f.states_map.pop(VENT)
            f.event(HUM, "60")
            await f.drain()
            self.assertEqual(t.summary(), [], "the target still ends it")
            t.unload()
            self.assertEqual(f.renames, [], "the listener goes with the unload")
        run(go())

    def test_a_vent_that_is_ours_is_stopped_under_its_new_id(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.async_load()
            await t.start("dehumidify", "vannaia", VENT, HUM, context="who")
            new = "fan.bath_vent_2"
            f.renames[0](NS(data={"action": "update", "entity_id": new, "old_entity_id": VENT, "changes": {}}))
            await f.drain()
            f.states_map[new] = f.states_map.pop(VENT)
            f.event(HUM, "60")
            await f.drain()
            self.assertEqual((f.calls[-1], f.contexts[-1]), (("homeassistant", "turn_off", new), "who"))
            self.assertEqual(t.summary(), [])
        run(go())

    def test_a_renamed_sensor_is_still_watched(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.async_load()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.renames[0](NS(data={"action": "update", "entity_id": "sensor.bath_h", "old_entity_id": HUM, "changes": {}}))
            await f.drain()
            f.event("sensor.bath_h", "60")
            await f.drain()
            self.assertEqual((f.calls[-1], t.summary()), (("homeassistant", "turn_off", VENT), []))
        run(go())

    def test_a_new_id_that_is_no_vent_ends_the_job_while_it_can(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.async_load()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.states_map["fan.living_air_purifier"] = f.states_map.pop(VENT)
            f.renames[0](NS(data={"action": "update", "entity_id": "fan.living_air_purifier", "old_entity_id": VENT, "changes": {}}))
            await f.drain()
            self.assertEqual((f.calls[-1], t.summary()), (("homeassistant", "turn_off", "fan.living_air_purifier"), []))
        run(go())

    def test_a_registry_event_about_something_else_changes_nothing(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.async_load()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            saved = f.saved
            f.renames[0](NS(data={"action": "update", "entity_id": VENT, "changes": {"name": "x"}}))
            f.renames[0](NS(data={"action": "remove", "entity_id": VENT}))
            await f.drain()
            self.assertEqual(([x["device"] for x in t.summary()], f.saved is saved), ([VENT], True))
        run(go())

    def test_a_vent_that_would_not_stop_is_reported_until_it_reads_off(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            await t.stop(VENT)
            for _ in range(5):
                f.timers[0][1](None)
                await f.drain()
            self.assertEqual([x.get("outcome") for x in t.summary()], ["no_stop"])
            f.now += 10 * air.OUTCOME_SECONDS
            self.assertEqual([x.get("outcome") for x in t.summary()], ["no_stop"], "hours later it still runs, so it is still said")
            f.event(VENT, "off")
            await f.drain()
            self.assertEqual(t.summary(), [], "it reads off: the alarm is over")
            self.assertEqual((f.listeners, f.timers, f.saved), ([], [], {"jobs": []}), "nothing left to watch, nothing left on disk")
        run(go())

    def test_how_a_job_ended_outlives_a_restart(self):
        async def go():
            for outcome, prepare in (("out_of_time", None), ("no_stop", "stuck")):
                f = Fake(**{VENT: "off", HUM: "78"})
                t = f.make()
                await t.start("dehumidify", "vannaia", VENT, HUM)
                if prepare:
                    f.stuck.add("turn_off")
                    await t.stop(VENT)
                    for _ in range(5):
                        f.timers[0][1](None)
                        await f.drain()
                else:
                    f.timers[0][1](None)
                    await f.drain()
                self.assertEqual([x.get("outcome") for x in t.summary()], [outcome])
                g = Fake(**{VENT: f.states_map[VENT], HUM: "78"})
                g.now, g.stored = f.now, f.saved
                t2 = g.make()
                await t2.async_load()
                self.assertEqual([x.get("outcome") for x in t2.summary()], [outcome], "said for an hour, whatever happens to HA")
                g.now += 3600
                if outcome == "no_stop":
                    await g.started[0]()
                    self.assertEqual([x.get("outcome") for x in t2.summary()], [outcome], "a vent still running is still said, after the hour too")
                    g.event(VENT, "off")
                    await g.drain()
                self.assertEqual(t2.summary(), [], "and no longer")
        run(go())

    def test_a_job_with_its_outcome_on_its_way_to_off_keeps_it_over_a_restart(self):
        async def go():
            f = Fake(**{VENT: "unavailable", HUM: "78"})
            f.stored = {"jobs": [{"kind": "dehumidify", "roomId": "vannaia", "device": VENT, "sensor": HUM, "target": 60, "startedAt": 1, "wasOn": False, "stopping": True, "stoppingSince": f.now, "outcome": "out_of_time"}]}
            t = f.make()
            await t.async_load()
            self.assertEqual(t.jobs[VENT]["outcome"], "out_of_time")
        run(go())

    def test_a_stored_outcome_that_makes_no_sense_is_ignored(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            good = {"kind": "dehumidify", "roomId": "vannaia", "device": VENT, "sensor": HUM, "target": 60, "startedAt": 1}
            f.stored = {"jobs": [], "outcomes": [{"job": {**good, "outcome": "whatever"}, "at": f.now}, {"job": good, "at": f.now}, {"at": f.now}, "x", {"job": {**good, "outcome": "no_stop"}, "at": "x"}]}
            t = f.make()
            await t.async_load()
            self.assertEqual(t.summary(), [])
        run(go())

    def test_the_season_sets_the_target(self):
        self.assertEqual([air.target_for("dehumidify", m) for m in (1, 4, 5, 9, 10, 12)], [60, 60, 64, 64, 60, 60])
        self.assertEqual(air.target_for("purify", 7), 15)

    def test_a_relay_vent_is_accepted(self):
        air.check("dehumidify", "switch.bath_vent", HUM, "vannaia")
        air.check("purify", "switch.kitchen_vent_relay", HUM, "kukhnia")
        air.check("dehumidify", "fan.office_fan", HUM, "kompiuternaia")

    def test_a_relay_with_an_ordinary_vent_name_is_accepted(self):
        for good in ("switch.vannaia_vytiazhka", "switch.ventiliatsiia_vannaia", "switch.ventiliator_vannaia", "switch.vytiazhnoi_ventiliator", "switch.vytiazhnaia_kukhnia", "switch.bath_ventilator", "switch.bath_fan", "switch.bathroom_extractor", "switch.extractor_kitchen", "switch.kukhnia_vytiazhka", "switch.vytiazhka_kukhnia", "switch.bath_vent", "switch.kitchen_hood"):
            air.check("dehumidify", good, HUM, "vannaia")

    def test_a_relay_that_is_no_vent_stays_refused(self):
        for bad in ("switch.kukhnia_vytiazhka_svet", "switch.kukhnia_vytiazhka_podsvetka", "switch.kukhnia_vytiazhka_lampa", "switch.kukhnia_vytiazhka_blokirovka", "switch.kukhnia_vytiazhka_zamok", "switch.kukhnia_vytiazhka_rezhim", "switch.kukhnia_vytiazhka_indikator", "switch.kukhnia_hood_lights", "switch.kukhnia_hood_lamps", "switch.x_fan_beep", "switch.fan_mode", "switch.fanatic", "switch.bath_fan\n", "switch.bath_fan_light", "switch.ventiliator_child_lock", "switch.vytiazhka_light", "switch.bathroom_extractor_indicator", "switch.kukhnia_relay_1", "switch.air_purifier_fan", "switch.living_air_purifier_ventilator", "switch.zhimi_airp_mb5_vent", "switch.kitchen_cat_feeder_prevent_accumulation", "switch.bath_dryer_wrinkle_prevent", "switch.kitchen_hood_light", "switch.bath_vent_child_lock"):
            with self.assertRaises(ValueError, msg=bad):
                air.check("dehumidify", bad, HUM, "vannaia")

    def test_a_dead_sensor_does_not_end_the_job(self):
        self.assertFalse(air.reached("dehumidify", "unavailable", 60))
        self.assertFalse(air.reached("purify", "nan", 15))
        self.assertTrue(air.reached("purify", "15", 15))
        self.assertFalse(air.reached("purify", "16", 15))

    def test_every_callback_runs_on_the_event_loop(self):
        """Without HA's mark a callback runs in a worker thread, and async_create_task from there raises: no job would ever end."""
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            await f.make().start("dehumidify", "vannaia", VENT, HUM)
            self.assertTrue(getattr(f.listeners[0][1], "_hass_callback", False))
            self.assertTrue(all(getattr(x[1], "_hass_callback", False) for x in f.timers))
            self.assertEqual(len(f.timers), 2, "the hour and the check that it started")
        run(go())

    def test_the_month_comes_from_the_house(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.month = 7
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(t.summary()[0]["target"], 64)
            f.event(HUM, "65")
            await f.drain()
            self.assertEqual(f.calls[-1][1], "turn_on", "summer: 65 is still «Влажно», it must not stop there")
            f.event(HUM, "64")
            await f.drain()
            self.assertEqual(f.calls[-1][1], "turn_off", "summer: just under the limit is enough")
        run(go())

    def test_a_device_blip_does_not_end_the_job(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            for state in ("unavailable", None):
                f.event(VENT, state)
                await f.drain()
            self.assertEqual(len(t.summary()), 1, "the job goes on")
            self.assertEqual(f.timers[0][0], 3600, "and so does its hour")
            f.states_map[VENT] = "on"
            f.event(HUM, "50")
            await f.drain()
            self.assertEqual(f.calls[-1][1], "turn_off")
        run(go())

    def test_a_device_away_at_the_end_is_switched_off_when_it_is_back(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.states_map[VENT] = "unavailable"
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(f.calls, [("homeassistant", "turn_on", VENT)], "HA would skip it silently")
            self.assertEqual([x["stopping"] for x in t.summary()], [True], "the panel says it is still on its way to off")
            self.assertTrue(f.saved["jobs"][0]["stopping"], "and a restart will not lose it")
            f.event(VENT, "on", old="unavailable")
            await f.drain()
            self.assertEqual(f.calls[-1], ("homeassistant", "turn_off", VENT))
            self.assertEqual(f.saved["jobs"], [])
            self.assertEqual((f.listeners, f.timers), ([], []))
        run(go())

    def test_a_refused_switch_off_is_tried_again(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.states_map[VENT] = "on"
            f.fail = True
            with self.assertRaises(RuntimeError):
                await t.stop(VENT)
            self.assertEqual([x["stopping"] for x in t.summary()], [True], "not hidden: the vent is still on")
            with self.assertRaises(ValueError) as busy:
                await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(str(busy.exception), "device busy")
            self.assertEqual(f.timers[0][0], air.RETRY_SECONDS)
            self.assertEqual(len(f.listeners), 1)
            f.fail = False
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(f.calls[-1][1], "turn_off")
            self.assertEqual(f.saved["jobs"], [])
        run(go())

    def test_two_panels_at_once(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.gate = asyncio.Event()
            t = f.make()
            both = asyncio.gather(t.start("dehumidify", "vannaia", VENT, HUM), t.start("dehumidify", "vannaia", VENT, HUM))
            await asyncio.sleep(0)
            f.gate.set()
            await both
            self.assertEqual(len(f.calls), 1)
            self.assertEqual((len(f.listeners), len(f.timers)), (1, 2), "the hour and the start check, no second listener or timer to kill a later job")
        run(go())

    def test_stop_while_the_device_is_starting(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.gate, f.gate_only = asyncio.Event(), "turn_on"
            t = f.make()
            starting = asyncio.ensure_future(t.start("dehumidify", "vannaia", VENT, HUM))
            await asyncio.sleep(0)
            stopping = asyncio.ensure_future(t.stop(VENT))
            await asyncio.sleep(0)
            f.gate.set()
            await asyncio.gather(starting, stopping)
            self.assertEqual([x[1] for x in f.calls], ["turn_off", "turn_on", "turn_off"], "the slow turn_on arrives after Stop, so the last word must be off")
            self.assertEqual(f.states_map[VENT], "off")
            self.assertEqual(t.summary(), [])
            self.assertEqual((f.listeners, f.timers), ([], []))
        run(go())

    def test_the_second_kind_on_one_vent_is_refused_aloud(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78", "sensor.pm": "40"})
            t = f.make()
            await t.start("dehumidify", "kukhnia", VENT, HUM)
            with self.assertRaises(ValueError):
                await t.start("purify", "kukhnia", VENT, "sensor.pm")
        run(go())

    def test_an_unknown_device_is_not_started(self):
        async def go():
            f = Fake(**{VENT: "unknown", HUM: "78"})
            t = f.make()
            with self.assertRaises(ValueError):
                await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(f.calls, [])
        run(go())

    def test_settings_of_a_vent_are_not_a_vent(self):
        async def go():
            f = Fake(**{"switch.bath_vent_turbo": "off", HUM: "78"})
            f.categories["switch.bath_vent_turbo"] = "config"
            t = f.make()
            with self.assertRaises(ValueError):
                await t.start("dehumidify", "vannaia", "switch.bath_vent_turbo", HUM)
        for bad in ("switch.bath_vent_child_lock", "switch.kitchen_hood_light", "switch.kitchen_vent_relay_mode", "fan.zhimi_airp_mb5", "fan.living_air_purifier", "switch.kitchen_cat_feeder_prevent_accumulation", "fan.x\n"):
            with self.assertRaises(ValueError, msg=bad):
                air.check("dehumidify", bad, HUM, "vannaia")
        with self.assertRaises(ValueError):
            air.check("dehumidify", VENT, HUM + "\n", "vannaia")
        run(go())


JOB = {"kind": "dehumidify", "roomId": "vannaia", "device": VENT, "sensor": HUM, "target": 60, "startedAt": 900.0, "wasOn": False}


class Restart(unittest.TestCase):
    def test_the_hour_goes_on_from_when_it_began(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            f.stored = {"jobs": [dict(JOB)]}
            t = f.make()
            await t.async_load()
            self.assertEqual(len(t.summary()), 1)
            self.assertEqual(f.timers[0][0], 3500.0)
            await f.started[0]()
            self.assertEqual(f.calls, [], "nothing is due")
            self.assertEqual(len(t.summary()), 1)
        run(go())

    def test_nothing_is_decided_before_ha_is_up(self):
        async def go():
            f = Fake(**{HUM: "78"})
            f.stored = {"jobs": [dict(JOB, startedAt=-5000.0)]}
            t = f.make()
            await t.async_load()
            self.assertEqual(f.calls, [], "the device has not loaded yet")
            self.assertEqual(len(f.started), 1)
            f.event(VENT, "off", old="on")
            f.event(HUM, "50", old="78")
            f.event(HUM, "78", old="50")
            f.timers[0][1](None)
            self.assertEqual((f.tasks, f.calls), ([], []), "no event and no timer decides anything while HA is starting")
            self.assertEqual(len(t.summary()), 1)
            f.states_map[VENT] = "on"
            await f.started[0]()
            self.assertEqual(f.calls, [("homeassistant", "turn_off", VENT)], "missed while HA was down")
            self.assertEqual(f.saved["jobs"], [])
        run(go())

    def test_the_device_comes_back_after_ha_is_up(self):
        """Zigbee2MQTT: a device is unavailable until its first message."""
        async def go():
            f = Fake(**{VENT: "unavailable", HUM: "78"})
            f.stored = {"jobs": [dict(JOB, startedAt=-5000.0)]}
            t = f.make()
            await t.async_load()
            await f.started[0]()
            self.assertEqual(f.calls, [])
            self.assertEqual(f.saved["jobs"][0]["device"], VENT, "the job is kept")
            f.event(VENT, "on", old="unavailable")
            await f.drain()
            self.assertEqual(f.calls, [("homeassistant", "turn_off", VENT)])
            self.assertEqual(f.saved["jobs"], [])
        run(go())

    def test_a_blip_after_a_restart_keeps_the_job(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            f.stored = {"jobs": [dict(JOB)]}
            t = f.make()
            await t.async_load()
            await f.started[0]()
            f.event(VENT, "unavailable")
            await f.drain()
            self.assertEqual(len(t.summary()), 1)
        run(go())

    def test_two_jobs_come_back_together(self):
        async def go():
            other = dict(JOB, device="fan.office_fan", roomId="kompiuternaia", sensor="sensor.office_humidity")
            f = Fake(**{VENT: "on", HUM: "78", "fan.office_fan": "on", "sensor.office_humidity": "78"})
            f.stored = {"jobs": [dict(JOB, startedAt=-5000.0), other]}
            t = f.make()
            await t.async_load()
            await f.started[0]()
            self.assertEqual([x["device"] for x in f.saved["jobs"]], ["fan.office_fan"], "the second job stays stored")
        run(go())

    def test_a_device_found_off_or_gone(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.stored = {"jobs": [dict(JOB)]}
            t = f.make()
            await t.async_load()
            await f.started[0]()
            self.assertEqual((f.calls, t.summary()), ([("homeassistant", "turn_off", VENT)], []), "it reads off, but a relay that reports late must still be told, and the job is over")
            self.assertEqual((f.listeners, f.timers), ([], []))
            h = Fake(**{VENT: "off", HUM: "78"})
            h.stored = {"jobs": [dict(JOB, wasOn=True)]}
            v = h.make()
            await v.async_load()
            await h.started[0]()
            self.assertEqual((h.calls, v.summary()), ([], []), "it was on before the job: no command, and no job")
            g = Fake(**{HUM: "78"})
            g.stored = {"jobs": [dict(JOB)]}
            u = g.make()
            await u.async_load()
            await g.started[0]()
            self.assertEqual((g.calls, g.saved), ([], {"jobs": []}), "HA is up and has no such device")
        run(go())

    def test_unload_leaves_nothing_behind(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            f.stored = {"jobs": [dict(JOB)]}
            t = f.make()
            await t.async_load()
            t.unload()
            self.assertEqual((f.listeners, f.timers), ([], []))
        run(go())


class Events(unittest.TestCase):
    """Only «on» to «off» is someone switching it off by hand. An «off» out of a blackout ends the job with a command, as a review does."""

    def test_an_off_out_of_a_blackout_ends_the_job_with_a_command(self):
        async def go():
            for old in ("unavailable", "unknown", None):
                f = Fake(**{VENT: "off", HUM: "78"})
                t = f.make()
                await t.start("dehumidify", "vannaia", VENT, HUM)
                f.event(VENT, "off", old=old)
                await f.drain()
                self.assertEqual((f.calls[-1], t.summary(), f.listeners, f.timers), (("homeassistant", "turn_off", VENT), [], [], []), old)
        run(go())

    def test_an_off_out_of_a_blackout_leaves_a_vent_that_was_on_alone(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.event(VENT, "off", old="unavailable")
            await f.drain()
            self.assertEqual((f.calls, t.summary()), ([], []))
        run(go())

    def test_an_off_from_off_says_nothing_and_from_on_is_by_hand(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.event(VENT, "off", old="off")
            await f.drain()
            self.assertEqual([x["stopping"] for x in t.summary()], [False])
            self.assertEqual(f.calls, [("homeassistant", "turn_on", VENT)])
            f.event(VENT, "off", old="on")
            await f.drain()
            self.assertEqual((f.calls[1:], t.summary(), f.listeners, f.timers), ([], [], [], []), "from on: by hand, no second command")
        run(go())

    def test_an_attribute_only_event_changes_nothing(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.event(VENT, "on", old="on")
            await f.drain()
            self.assertEqual((len(f.calls), len(t.summary())), (1, 1))
            f.stuck.add("turn_off")
            await t.stop(VENT)
            sent = len(f.calls)
            f.event(VENT, "on", old="on")
            await f.drain()
            self.assertEqual(len(f.calls), sent, "a stopping job does not resend on every attribute")
        run(go())

    def test_a_sensor_event_does_not_decide_while_stopping(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            await t.stop(VENT)
            sent = len(f.calls)
            f.event(HUM, "50")
            await f.drain()
            self.assertEqual(len(f.calls), sent)
        run(go())


class Effect(unittest.TestCase):
    """A command accepted says nothing about the device."""

    def test_a_switch_off_that_does_not_take_effect_is_sent_again_then_reported(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            f.event(HUM, "50")
            await f.drain()
            self.assertEqual([x["stopping"] for x in t.summary()], [True], "the job is not over while it reads on")
            self.assertEqual(f.timers[0][0], air.RETRY_SECONDS)
            for _ in range(air.RETRY_TIMES):
                f.timers[0][1](None)
                await f.drain()
            self.assertEqual(sum(x[1] == "turn_off" for x in f.calls), air.RETRY_TIMES, "bounded")
            self.assertEqual([x.get("outcome") for x in t.summary()], ["no_stop"], "and it says so")
            self.assertEqual(([e for e, _ in f.listeners], f.timers, f.saved["jobs"]), ([[VENT]], [], []), "the job's own listener and timers are gone; only the alarm's listener stays")
        run(go())

    def test_a_relay_that_reports_late_ends_the_job_when_it_does(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            await t.stop(VENT)
            self.assertEqual(sum(x[1] == "turn_off" for x in f.calls), 1)
            f.event(VENT, "off", old="on")
            await f.drain()
            self.assertEqual(sum(x[1] == "turn_off" for x in f.calls), 1, "no second command")
            self.assertEqual((t.summary(), f.listeners, f.timers), ([], [], []))
        run(go())

    def test_a_late_report_seen_at_the_next_look(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            await t.stop(VENT)
            f.states_map[VENT] = "off"
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(sum(x[1] == "turn_off" for x in f.calls), 1)
            self.assertEqual(t.summary(), [])
        run(go())

    def test_a_vent_that_does_not_start_ends_the_job_and_says_so(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.stuck.add("turn_on")
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(f.timers[1][0], air.START_GRACE_SECONDS)
            f.timers[1][1](None)
            await f.drain()
            self.assertEqual([x[1] for x in f.calls], ["turn_on", "turn_off"], "off too: it must not start late with no job")
            self.assertEqual([x.get("outcome") for x in t.summary()], ["no_start"])
            self.assertEqual((f.listeners, f.timers, f.saved["jobs"]), ([], [], []))
        run(go())

    def test_a_vent_started_by_hand_after_no_start_clears_the_word_for_good(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.stuck.add("turn_on")
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.timers[1][1](None)
            await f.drain()
            self.assertEqual(f.saved["outcomes"][0]["job"]["outcome"], "no_start")
            f.event(VENT, "on")
            self.assertEqual(t.summary(), [], "«вытяжка работает» and «не включилась» must not stand together")
            await f.drain()
            self.assertNotIn("outcomes", f.saved, "on disk too")
            f.event(VENT, "off")
            self.assertEqual(t.summary(), [], "it does not come back when the vent is switched off")
            f.stored = f.saved
            again = f.make()
            await again.async_load()
            self.assertEqual(again.summary(), [], "nor after a restart")
        run(go())

    def test_no_start_stays_while_the_vent_does_not_read_on(self):
        async def go():
            for state in ("off", "unavailable", "unknown"):
                f = Fake(**{VENT: "off", HUM: "78"})
                f.stuck.add("turn_on")
                t = f.make()
                await t.start("dehumidify", "vannaia", VENT, HUM)
                f.timers[1][1](None)
                await f.drain()
                f.states_map[VENT] = state
                self.assertEqual([x.get("outcome") for x in t.summary()], ["no_start"], state)
                self.assertEqual(f.tasks, [], "nothing changed: nothing to write")
        run(go())

    def test_out_of_time_beside_a_running_vent_stays(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.timers[0][1](None)
            await f.drain()
            f.event(VENT, "on")
            self.assertEqual([x.get("outcome") for x in t.summary()], ["out_of_time"], "«Прошлый раз…» beside a running vent is no contradiction")
        run(go())

    def test_a_vent_that_started_is_left_alone_by_the_check(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.timers[1][1](None)
            await f.drain()
            self.assertEqual(len(f.calls), 1)
            self.assertEqual([x.get("outcome") for x in t.summary()], [None])
        run(go())

    def test_outcomes_fade_and_a_new_job_clears_them(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(len(t.summary()), 1)
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual([x.get("outcome") for x in t.summary()], [None], "a new job clears the old word")
            f.timers[0][1](None)
            await f.drain()
            f.now += air.OUTCOME_SECONDS
            self.assertEqual(t.summary(), [])
        run(go())

    def test_the_summary_says_how_the_device_was(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            row = t.summary()[0]
            self.assertEqual((row["wasOn"], row["stopping"]), (True, False))
        run(go())


NO_STOP = {"job": dict(JOB, stopping=True, stoppingSince=900.0, outcome="no_stop"), "at": 950.0}


class Alarm(unittest.TestCase):
    """«Вытяжка не выключилась» ends only when the device itself reads off, seen with every panel closed: a read decides nothing, and where no panel is open no test reads before the vent has moved."""

    async def stuck(self, f):
        t = f.make()
        await t.async_load()
        await t.start("dehumidify", "vannaia", VENT, HUM)
        f.stuck.add("turn_off")
        await t.stop(VENT)
        for _ in range(air.RETRY_TIMES):
            f.timers[0][1](None)
            await f.drain()
        return t

    async def loaded(self, stored=NO_STOP, **states):
        f = Fake(**states)
        f.stored = {"jobs": [], "outcomes": [stored]}
        t = f.make()
        await t.async_load()
        return f, t

    def outcomes(self, t):
        return [x.get("outcome") for x in t.summary()]

    def test_a_read_while_the_vent_has_no_state_keeps_the_alarm(self):
        async def go():
            f, t = await self.loaded(**{HUM: "78"})
            self.assertEqual(self.outcomes(t), ["no_stop"], "HA is starting: no state says nothing")
            self.assertEqual((f.saved, f.timers), (None, []), "a read writes nothing, and no minute runs for a device that has not loaded yet")
            f.event(VENT, "on", old=None)
            await f.started[0]()
            self.assertEqual(self.outcomes(t), ["no_stop"], "the vent is back and still running")
            self.assertEqual([x["job"]["outcome"] for x in f.saved["outcomes"]], ["no_stop"])
        run(go())

    def test_a_read_after_ha_is_up_does_not_end_it_either(self):
        async def go():
            f, t = await self.loaded(**{VENT: "on", HUM: "78"})
            await f.started[0]()
            f.states_map.pop(VENT)
            self.assertEqual(self.outcomes(t), ["no_stop"], "only the listener decides")
        run(go())

    def test_only_a_stored_alarm_waits_for_ha_to_be_up(self):
        async def go():
            f, _t = await self.loaded(**{VENT: "on", HUM: "78"})
            self.assertEqual(len(f.started), 1)
            g, _u = await self.loaded({"job": dict(JOB, outcome="out_of_time"), "at": 950.0}, **{VENT: "on", HUM: "78"})
            self.assertEqual((g.started, g.listeners), ([], []), "an old word about a job has nothing to wait for")
        run(go())

    def test_the_review_drops_it_when_the_vent_reads_off_or_is_gone(self):
        async def go():
            for states, left in (({VENT: "off"}, []), ({}, []), ({VENT: "on"}, ["no_stop"]), ({VENT: "unavailable"}, ["no_stop"]), ({VENT: "unknown"}, ["no_stop"])):
                f, t = await self.loaded(**states, **{HUM: "78"})
                await f.started[0]()
                self.assertEqual(self.outcomes(t), left, states)
                self.assertEqual([x["job"]["outcome"] for x in f.saved.get("outcomes", [])], left, "the file says the same")
                self.assertEqual(len(f.listeners), len(left), "no listener outlives its alarm")
        run(go())

    def test_nothing_is_decided_before_ha_is_up(self):
        async def go():
            f, t = await self.loaded(**{VENT: "on", HUM: "78"})
            f.event(VENT, "off", old="on")
            f.event(VENT, None)
            self.assertEqual((f.tasks, f.timers), ([], []), "no save and no timer while HA is starting")
            f.event(VENT, "on", old=None)
            await f.started[0]()
            self.assertEqual(self.outcomes(t), ["no_stop"])
        run(go())

    def test_a_reload_after_the_vent_read_off_has_no_alarm(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            await self.stuck(f)
            self.assertEqual([x["job"]["outcome"] for x in f.saved["outcomes"]], ["no_stop"])
            f.event(VENT, "off")
            await f.drain()
            self.assertEqual(f.saved, {"jobs": []}, "saved with no panel open")
            g = Fake(**{VENT: "on", HUM: "78"})
            g.now, g.stored = f.now, f.saved
            t2 = g.make()
            await t2.async_load()
            self.assertEqual((self.outcomes(t2), g.started, g.listeners), ([], [], []), "someone started the repaired vent on purpose")
        run(go())

    def test_off_then_on_with_no_read_in_between_has_no_alarm(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            f.event(VENT, "off")
            f.event(VENT, "on")
            await f.drain()
            self.assertEqual((self.outcomes(t), f.saved, f.listeners), ([], {"jobs": []}, []))
        run(go())

    def test_it_stays_through_a_blip(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            for state in ("unavailable", "unknown", "on"):
                f.event(VENT, state)
                await f.drain()
                self.assertEqual(self.outcomes(t), ["no_stop"], state)
        run(go())

    def test_a_vent_gone_waits_a_minute_and_goes_only_if_still_gone(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            f.event(VENT, None)
            self.assertEqual([x[0] for x in f.timers], [air.RETRY_SECONDS])
            self.assertEqual(self.outcomes(t), ["no_stop"], "a reload of its integration looks the same for a moment")
            f.event(VENT, "on", old=None)
            f.timers[-1][1](None)
            await f.drain()
            self.assertEqual(self.outcomes(t), ["no_stop"], "it came back within the minute")
            f.event(VENT, None)
            f.timers[-1][1](None)
            await f.drain()
            self.assertEqual((self.outcomes(t), f.saved, f.listeners, f.timers), ([], {"jobs": []}, [], []), "no such device any more")
        run(go())

    def test_a_renamed_vent_takes_its_alarm_along(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            new = "fan.bath_vent_2"
            f.renames[0](NS(data={"action": "update", "entity_id": new, "old_entity_id": VENT, "changes": {}}))
            await f.drain()
            self.assertEqual(([e for e, _ in f.listeners], [x["device"] for x in t.summary()]), ([[new]], [new]))
            self.assertEqual(f.saved["outcomes"][0]["job"]["device"], new)
            f.event(new, "on", old=None)
            f.timers[-1][1](None)
            await f.drain()
            self.assertEqual(self.outcomes(t), ["no_stop"], "the new id has its state: still running")
            f.event(new, "off")
            await f.drain()
            self.assertEqual((self.outcomes(t), f.saved, f.listeners), ([], {"jobs": []}, []))
        run(go())

    def test_a_new_id_that_never_gets_a_state_does_not_stay_red_for_ever(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            f.renames[0](NS(data={"action": "update", "entity_id": "fan.bath_vent_2", "old_entity_id": VENT, "changes": {}}))
            await f.drain()
            self.assertEqual([x[0] for x in f.timers], [air.RETRY_SECONDS], "no event would ever come")
            f.timers[-1][1](None)
            await f.drain()
            self.assertEqual((self.outcomes(t), f.saved, f.listeners, f.timers), ([], {"jobs": []}, [], []))
        run(go())

    def test_a_rename_of_something_else_leaves_it_watched(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            f.renames[0](NS(data={"action": "update", "entity_id": "fan.y", "old_entity_id": "fan.x", "changes": {}}))
            await f.drain()
            f.event(VENT, "off")
            await f.drain()
            self.assertEqual(self.outcomes(t), [])
        run(go())

    def test_a_new_job_takes_over_from_it(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            f.stuck.clear()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual((self.outcomes(t), [e for e, _ in f.listeners]), ([None], [[VENT, HUM]]), "the job's listener only")
        run(go())

    def test_unload_leaves_no_listener_or_timer(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = await self.stuck(f)
            f.event(VENT, None)
            self.assertEqual(len(f.timers), 1)
            t.unload()
            self.assertEqual((f.listeners, f.timers), ([], []))
            g, u = await self.loaded(**{VENT: "on", HUM: "78"})
            u.unload()
            self.assertEqual(g.listeners, [])
            await u._end(dict(JOB, outcome="no_stop"))
            self.assertEqual(g.listeners, [], "an old instance watches nothing")
        run(go())

    def test_its_callbacks_run_on_the_event_loop(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            await self.stuck(f)
            f.event(VENT, None)
            self.assertTrue(all(getattr(x[1], "_hass_callback", False) for x in f.listeners + f.timers))
        run(go())


class Away(unittest.TestCase):
    def test_a_device_removed_from_ha_ends_the_job_without_a_command(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            del f.states_map[VENT]
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(len(t.summary()), 1, "a reload of its integration looks the same for a moment")
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual((f.calls[1:], f.listeners, f.timers, f.saved["jobs"]), ([], [], [], []))
        run(go())

    def test_a_device_gone_for_a_day_is_not_touched_when_it_is_back(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.states_map[VENT] = "unavailable"
            f.timers[0][1](None)
            await f.drain()
            f.now += air.AWAY_SECONDS - 1
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(len(t.summary()), 1, "still within the day")
            f.now += 1
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual((t.summary(), f.listeners, f.timers, f.saved), ([], [], [], {"jobs": []}))
            f.event(VENT, "on", old="unavailable")
            await f.drain()
            self.assertEqual(f.calls, [("homeassistant", "turn_on", VENT)], "someone may have started it on purpose")
        run(go())

    def test_a_day_counts_across_a_restart(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            f.stored = {"jobs": [dict(JOB, stopping=True, stoppingSince=f.now - air.AWAY_SECONDS)]}
            t = f.make()
            await t.async_load()
            await f.started[0]()
            self.assertEqual((f.calls, t.summary(), f.saved), ([], [], {"jobs": []}))
        run(go())


class Hung(unittest.TestCase):
    def setUp(self):
        self.calls_seconds, air.CALL_SECONDS = air.CALL_SECONDS, 0.01

    def tearDown(self):
        air.CALL_SECONDS = self.calls_seconds

    def test_a_hung_switch_off_counts_as_refused_and_keeps_its_timer(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.hang.add("turn_off")
            with self.assertRaises(RuntimeError):
                await asyncio.wait_for(t.stop(VENT), 2)
            self.assertEqual((f.timers[0][0], len(f.listeners)), (air.RETRY_SECONDS, 1), "armed again")
            f.hang.clear()
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual((t.summary(), f.states_map[VENT]), ([], "off"))
        run(go())

    def test_a_hung_switch_on_leaves_nothing_running_without_a_job(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.hang.add("turn_on")
            t = f.make()
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(t.start("dehumidify", "vannaia", VENT, HUM), 2)
            self.assertEqual(f.calls, [("homeassistant", "turn_off", VENT)], "it may have gone through")
            self.assertEqual(t.summary(), [])
        run(go())


class Holes(unittest.TestCase):
    def test_the_job_is_on_disk_before_the_device_moves(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.gate = asyncio.Event()
            t = f.make()
            starting = asyncio.ensure_future(t.start("dehumidify", "vannaia", VENT, HUM))
            await asyncio.sleep(0)
            self.assertEqual(f.calls, [])
            self.assertEqual(f.saved["jobs"][0]["device"], VENT)
            f.gate.set()
            await starting
        run(go())

    def test_a_press_during_the_end_of_a_job_is_refused_aloud(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.gate, f.gate_only = asyncio.Event(), "turn_off"
            ending = asyncio.ensure_future(t.stop(VENT))
            await asyncio.sleep(0)
            with self.assertRaises(ValueError) as busy:
                await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(str(busy.exception), "device busy")
            again = asyncio.ensure_future(t.stop(VENT))
            await asyncio.sleep(0)
            f.gate.set()
            await asyncio.gather(ending, again)
            self.assertEqual(sum(x[1] == "turn_off" for x in f.calls), 1, "two ends, one command")
        run(go())

    def test_a_malformed_store_does_not_stop_the_integration(self):
        async def go():
            for stored in ({"jobs": [1, None, "x", ["a"], dict(JOB)]}, {"jobs": 5}, {"jobs": None}, [], "junk", None):
                f = Fake(**{VENT: "on", HUM: "78"})
                f.stored = stored
                t = f.make()
                await t.async_load()
                self.assertEqual(len(t.summary()), 1 if isinstance(stored, dict) and isinstance(stored["jobs"], list) else 0, stored)
        run(go())

    def test_commands_carry_who_asked(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM, context="owner")
            f.event(HUM, "50")
            await f.drain()
            self.assertEqual(f.contexts, ["owner", "owner"], "the job's own later command too")
            g = Fake(**{VENT: "off", HUM: "78"})
            u = g.make()
            await u.start("dehumidify", "vannaia", VENT, HUM, context="owner")
            await u.stop(VENT, context="guest")
            self.assertEqual(g.contexts, ["owner", "guest"])
        run(go())

    def test_removal_stops_what_it_started_and_leaves_no_file(self):
        async def go():
            f = Fake(**{VENT: "on", "fan.office_fan": "on", "fan.a": "unavailable", HUM: "78"})
            f.stored = {"jobs": [dict(JOB), dict(JOB, device="fan.office_fan", wasOn=True), dict(JOB, device="fan.a")]}
            await f.make().async_remove()
            self.assertEqual(f.calls, [("homeassistant", "turn_off", VENT)], "one that was on before stays on")
            self.assertTrue(f.removed)
            g = Fake(**{VENT: "on", HUM: "78"})
            g.stored, g.fail = {"jobs": [dict(JOB)]}, True
            await g.make().async_remove()
            self.assertTrue(g.removed, "a refusal does not stop the removal")
        run(go())


class Flapping(unittest.TestCase):
    def test_a_link_that_flaps_does_not_spend_the_commands_in_seconds(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            await t.stop(VENT)
            off = lambda: [c for c in f.calls if c[1] == "turn_off"]
            self.assertEqual(len(off()), 1)
            for _ in range(9):  # up and down every six seconds, 54 seconds in all
                f.now += 3
                f.event(VENT, "unavailable", old="on")
                f.now += 3
                f.event(VENT, "on", old="unavailable")
                await f.drain()
            self.assertEqual(len(off()), 1, "within the minute: nothing new")
            f.now += 6
            f.timers[0][1](None)  # the retry timer stays armed
            await f.drain()
            self.assertEqual(len(off()), 2, "a minute after the last one")
            self.assertEqual([x["stopping"] for x in t.summary()], [True], "and no «did not switch off» after two")
        run(go())

    def test_the_first_return_still_sends_at_once(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.states_map[VENT] = "unavailable"
            with self.assertRaises(ValueError):
                await t.stop(VENT)
            f.event(VENT, "on", old="unavailable")
            await f.drain()
            self.assertEqual(f.calls[-1], ("homeassistant", "turn_off", VENT))
        run(go())

    def test_an_off_that_took_effect_ends_the_job_at_once(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            f.states_map[VENT] = "on"
            await t.stop(VENT)
            f.event(VENT, "off", old="unavailable")
            await f.drain()
            self.assertEqual(t.summary(), [], "the wait is for commands, not for good news")
        run(go())


class Closed(unittest.TestCase):
    def test_work_in_flight_at_unload_arms_nothing_and_writes_nothing(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stuck.add("turn_off")
            f.gate, f.gate_only = asyncio.Event(), "turn_off"
            stop = asyncio.ensure_future(t.stop(VENT))
            await asyncio.sleep(0)
            t.unload()
            saved = f.saved
            f.gate.set()
            await stop
            self.assertEqual((f.listeners, f.timers), ([], []), "the old instance is not armed again")
            self.assertIs(f.saved, saved, "and leaves the file to the new one")
            calls = list(f.calls)
            self.assertIsNone(await t._finish(VENT, switch_off=True))
            self.assertEqual(f.calls, calls, "no more commands from it")
        run(go())

    def test_a_start_in_flight_at_unload_arms_nothing(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            f.gate, f.gate_only = asyncio.Event(), "turn_on"
            start = asyncio.ensure_future(t.start("dehumidify", "vannaia", VENT, HUM))
            await asyncio.sleep(0)
            t.unload()
            f.gate.set()
            await start
            self.assertEqual((f.listeners, f.timers), ([], []))
            self.assertEqual([x["device"] for x in f.saved["jobs"]], [VENT], "on disk from before the command: the next instance takes it")
        run(go())


def load_integration():
    """__init__.py without Home Assistant: the WebSocket commands are plain functions under these stand-ins."""
    import sys
    from unittest.mock import MagicMock
    names = ("homeassistant", "homeassistant.components", "homeassistant.components.frontend", "homeassistant.components.panel_custom", "homeassistant.components.websocket_api", "homeassistant.components.http", "homeassistant.config_entries", "homeassistant.core", "homeassistant.exceptions", "homeassistant.helpers", "homeassistant.helpers.storage", "homeassistant.helpers.event", "homeassistant.helpers.start", "homeassistant.util", "homeassistant.util.dt", "voluptuous", "aiohttp", "aiohttp.web")
    saved = {n: sys.modules.get(n) for n in names}
    stubs = {n: MagicMock(name=n) for n in names}
    stubs["homeassistant.components.panel_custom"] = MagicMock(spec=["async_register_panel"], name="panel_custom")  # what real HA has: the panel is removed through frontend
    registered = []

    class Unauthorized(Exception):
        pass

    ws = stubs["homeassistant.components.websocket_api"]
    ws.websocket_command = lambda _schema: (lambda f: f)
    ws.async_response = lambda f: f
    ws.require_admin = lambda f: f
    ws.async_register_command = lambda _hass, f: registered.append(f)
    stubs["homeassistant.components"].websocket_api = ws
    stubs["homeassistant.components"].panel_custom = stubs["homeassistant.components.panel_custom"]
    stubs["homeassistant.components"].frontend = stubs["homeassistant.components.frontend"]
    stubs["homeassistant.components.http"].HomeAssistantView = object
    stubs["homeassistant.core"].callback = lambda f: f
    stubs["homeassistant.exceptions"].Unauthorized = Unauthorized
    stubs["aiohttp"].web = stubs["aiohttp.web"]
    sys.modules.update(stubs)
    root = pathlib.Path(__file__).parents[3]
    sys.path.insert(0, str(root))
    try:
        for name in [n for n in sys.modules if n.startswith("custom_components")]:
            del sys.modules[name]
        import custom_components.atom_home as integration
        tasks_module = sys.modules["custom_components.atom_home.air_tasks"]
    finally:
        sys.path.remove(str(root))
        for n, v in saved.items():
            if v is None:
                sys.modules.pop(n, None)
            else:
                sys.modules[n] = v
    return integration, tasks_module, registered, Unauthorized


class Socket(unittest.TestCase):
    """What the panel gets back. Real HA's own wrapper is covered in test_config_ws.py, which needs the HA test harness."""

    @classmethod
    def setUpClass(cls):
        cls.integration, cls.tasks_module, cls.registered, cls.Unauthorized = load_integration()
        hass = NS(data={cls.integration.DOMAIN: {}})
        cls.integration._register_ws(hass)
        cls.commands = {f.__name__: f for f in cls.registered}

    def connection(self, allowed=True):
        c = NS(sent=[], user=NS(permissions=NS(check_entity=lambda _e, _p: allowed)), context=lambda msg: f"context-{msg['id']}")
        c.send_result = lambda i, r: c.sent.append(("result", i, r))
        c.send_error = lambda i, code, message: c.sent.append(("error", i, code, message))
        return c

    def hass(self, fake=None):
        data = {"air_tasks": fake.make()} if fake else {}
        return NS(data={self.integration.DOMAIN: {"e": data}})

    def start_msg(self):
        return {"id": 7, "kind": "dehumidify", "roomId": "vannaia", "device": VENT, "sensor": HUM, "target": 60}  # as host.ts sends it: the target is there for display and the server keeps its own

    def test_tasks_with_no_integration_yet(self):
        c = self.connection()
        self.commands["ws_air_tasks"](self.hass(), c, {"id": 1})
        self.assertEqual(c.sent, [("result", 1, [])])

    def test_a_refused_stop_is_an_error_with_the_job_still_listed(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            hass, c = self.hass(f), self.connection()
            await self.commands["ws_air_start"](hass, c, self.start_msg())
            self.assertEqual((c.sent[0][0], c.sent[0][2][0]["device"], f.contexts), ("result", VENT, ["context-7"]))
            f.fail = True
            await self.commands["ws_air_stop"](hass, c, {"id": 8, "device": VENT})
            self.assertEqual(c.sent[-1], ("error", 8, "failed", "device refused"))
            c2 = self.connection()
            self.commands["ws_air_tasks"](hass, c2, {"id": 9})
            self.assertEqual(c2.sent[0][2][0]["stopping"], True)
        run(go())

    def test_stop_carries_who_asked(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            hass, c = self.hass(f), self.connection()
            await self.commands["ws_air_start"](hass, c, self.start_msg())
            await self.commands["ws_air_stop"](hass, c, {"id": 8, "device": VENT})
            self.assertEqual(f.contexts, ["context-7", "context-8"])
        run(go())

    def test_removing_the_integration_goes_through_its_jobs(self):
        from unittest.mock import patch
        removed = []

        class Stand:
            def __init__(self, hass):
                self.hass = hass

            async def async_remove(self):
                removed.append(self.hass)

        with patch.object(self.integration, "AirTasks", Stand):
            run(self.integration.async_remove_entry("hass", "entry"))
        self.assertEqual(removed, ["hass"])

    def test_stop_of_a_device_that_is_away_says_so(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            hass, c = self.hass(f), self.connection()
            await self.commands["ws_air_start"](hass, c, self.start_msg())
            f.states_map[VENT] = "unavailable"
            await self.commands["ws_air_stop"](hass, c, {"id": 8, "device": VENT})
            self.assertEqual(c.sent[-1], ("error", 8, "invalid", "device offline"))
        run(go())

    def test_a_start_that_is_refused_says_why(self):
        async def go():
            f = Fake(**{VENT: "unavailable", HUM: "78"})
            hass, c = self.hass(f), self.connection()
            await self.commands["ws_air_start"](hass, c, self.start_msg())
            self.assertEqual(c.sent, [("error", 7, "invalid", "device offline")])
            g = Fake(**{VENT: "off", HUM: "78"})
            g.fail = True
            hass, c = self.hass(g), self.connection()
            await self.commands["ws_air_start"](hass, c, self.start_msg())
            self.assertEqual(c.sent, [("error", 7, "failed", "refused")])
        run(go())

    def test_not_ready_before_the_integration_is_up(self):
        async def go():
            hass, c = self.hass(), self.connection()
            await self.commands["ws_air_start"](hass, c, self.start_msg())
            await self.commands["ws_air_stop"](hass, c, {"id": 8, "device": VENT})
            self.assertEqual([x[2] for x in c.sent], ["not_ready", "not_ready"])
        run(go())

    def test_a_user_who_may_not_control_the_device_is_unauthorized(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            hass, c = self.hass(f), self.connection(allowed=False)
            with self.assertRaises(self.Unauthorized):
                await self.commands["ws_air_start"](hass, c, self.start_msg())
            with self.assertRaises(self.Unauthorized):
                await self.commands["ws_air_stop"](hass, c, {"id": 8, "device": VENT})
            self.assertEqual(f.calls, [])
        run(go())


class Entry(unittest.TestCase):
    """Setting up and unloading through the integration's own functions. test_config_ws.py does the same under the real HA harness."""

    def setUp(self):
        from unittest.mock import AsyncMock, MagicMock, patch
        self.integration = load_integration()[0]
        self.air = NS(async_load=AsyncMock(), async_unload=AsyncMock(), async_remove=AsyncMock())
        store = NS(async_load=AsyncMock(return_value={}), async_save=AsyncMock())
        self.integration.panel_custom.async_register_panel = AsyncMock()

        async def executor(f, *a):
            return f(*a)

        self.hass = NS(data={}, async_add_executor_job=executor, config=NS(path=lambda p: "/tmp/atom-test-" + p), http=NS(async_register_static_paths=AsyncMock(), register_view=MagicMock()))
        parts = dict(Store=lambda *_a: store, AirTasks=lambda _h: self.air, AlarmScheduler=lambda _h, _once=None, authorize=None: NS(set_alarms=MagicMock(), start=MagicMock(), async_shutdown=AsyncMock()), LightSleep=lambda _h: NS(async_load=AsyncMock(), shutdown=MagicMock()), ConfigState=MagicMock(), _version=lambda: "1", _register_ws=MagicMock(), normalise_alarms=lambda _x: [])
        patcher = patch.multiple(self.integration, **parts)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_unload_runs_to_the_end_and_a_new_setup_does_not_register_the_server_twice(self):
        async def go():
            i, entry = self.integration, NS(entry_id="e", disabled_by=None)
            self.assertTrue(await i.async_setup_entry(self.hass, entry))
            self.assertTrue(await i.async_unload_entry(self.hass, entry), "panel_custom has no async_remove_panel in real HA; the stand-in has none either")
            i.frontend.async_remove_panel.assert_called_once_with(self.hass, i.PANEL_URL_PATH)
            self.air.async_unload.assert_awaited_once_with()
            self.air.async_remove.assert_not_awaited()  # a reload keeps the jobs
            self.assertNotIn("e", self.hass.data[i.DOMAIN])
            self.assertTrue(await i.async_setup_entry(self.hass, entry))
            self.assertEqual(i.panel_custom.async_register_panel.await_count, 2, "the panel is back")
            self.assertEqual(self.hass.http.async_register_static_paths.await_count, 1, "a path is taken once per run")
            self.assertEqual(self.hass.http.register_view.call_count, 3, "a view too")
        run(go())

    def test_disabling_the_entry_finishes_the_jobs(self):
        async def go():
            i, entry = self.integration, NS(entry_id="e", disabled_by="user")
            order = []
            self.air.async_unload.side_effect = lambda: order.append("unload")
            self.air.async_remove.side_effect = lambda: order.append("finish")
            await i.async_setup_entry(self.hass, entry)
            self.assertTrue(await i.async_unload_entry(self.hass, entry))
            self.assertEqual(order, ["unload", "finish"], "after unload: its listeners must not write the file back")
        run(go())

    def test_a_disabled_entry_stops_a_running_vent_for_real(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.stored = f.saved
            t.unload()
            await t.async_remove()
            self.assertEqual((f.calls[-1], f.removed, f.states_map[VENT]), (("homeassistant", "turn_off", VENT), True, "off"))
        run(go())


if __name__ == "__main__":
    result = unittest.main(exit=False).result
    # the gate reads this last line: it says plainly what did not run
    print(f"{'OK' if result.wasSuccessful() else 'FAILED'} {result.testsRun} tests; test_config_ws.py did not run here: it needs the HA test harness", flush=True)
    raise SystemExit(0 if result.wasSuccessful() else 1)
