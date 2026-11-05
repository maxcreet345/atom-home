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
        self.states = NS(get=lambda e: NS(state=self.states_map[e]) if e in self.states_map else None)
        self.services = NS(async_call=self._call)

    async def _call(self, domain, service, data, blocking=False):
        if self.gate:
            await self.gate.wait()
        if self.fail:
            raise RuntimeError("refused")
        self.calls.append((domain, service, data["entity_id"]))

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

        def track(_h, entities, cb):
            self.listeners.append((entities, cb))
            return lambda: self.listeners.remove((entities, cb))

        def later(_h, seconds, cb):
            self.timers.append((seconds, cb))
            return lambda: self.timers.remove((seconds, cb))

        return air.AirTasks(self, Store(), track, later, lambda: self.now, at_started=lambda _h, cb: self.started.append(cb) or (lambda: None), month=lambda: self.month, category=lambda e: self.categories.get(e))

    def event(self, entity, state):
        for entities, cb in list(self.listeners):
            if entity in entities:
                cb(NS(data={"entity_id": entity, "new_state": NS(state=state) if state is not None else None}))


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
            f2.event(VENT, "off")
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
            f.fail = True
            t = f.make()
            with self.assertRaises(RuntimeError):
                await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(t.summary(), [])
        run(go())

    def test_the_season_sets_the_target(self):
        self.assertEqual([air.target_for("dehumidify", m) for m in (1, 4, 5, 9, 10, 12)], [60, 60, 65, 65, 60, 60])
        self.assertEqual(air.target_for("purify", 7), 15)

    def test_a_relay_vent_is_accepted(self):
        air.check("dehumidify", "switch.bath_vent", HUM, "vannaia")
        air.check("purify", "switch.kitchen_vent_relay", HUM, "kukhnia")
        air.check("dehumidify", "fan.office_fan", HUM, "kompiuternaia")

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
            self.assertTrue(getattr(f.timers[0][1], "_hass_callback", False))
        run(go())

    def test_the_month_comes_from_the_house(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.month = 7
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            self.assertEqual(t.summary()[0]["target"], 65)
            f.event(HUM, "64")
            await f.drain()
            self.assertEqual(f.calls[-1][1], "turn_off", "summer: 65 is enough")
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
            self.assertEqual(len(f.timers), 1, "and so does its hour")
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
            self.assertEqual(t.summary(), [], "the panel shows no running job")
            self.assertTrue(f.saved["jobs"][0]["stopping"], "and a restart will not lose it")
            f.states_map[VENT] = "on"
            f.event(VENT, "on")
            await f.drain()
            self.assertEqual(f.calls[-1], ("homeassistant", "turn_off", VENT))
            self.assertEqual(f.saved, {"jobs": []})
            self.assertEqual((f.listeners, f.timers), ([], []))
        run(go())

    def test_a_refused_switch_off_is_tried_again(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            t = f.make()
            await t.start("dehumidify", "vannaia", VENT, HUM)
            f.states_map[VENT] = "on"
            f.fail = True
            await t.stop(VENT)
            self.assertEqual(f.timers[0][0], air.RETRY_SECONDS)
            self.assertEqual(len(f.listeners), 1)
            f.fail = False
            f.timers[0][1](None)
            await f.drain()
            self.assertEqual(f.calls[-1][1], "turn_off")
            self.assertEqual(f.saved, {"jobs": []})
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
            self.assertEqual((len(f.listeners), len(f.timers)), (1, 1), "no second listener or timer to kill a later job")
        run(go())

    def test_stop_while_the_device_is_starting(self):
        async def go():
            f = Fake(**{VENT: "off", HUM: "78"})
            f.gate = asyncio.Event()
            t = f.make()
            starting = asyncio.ensure_future(t.start("dehumidify", "vannaia", VENT, HUM))
            await asyncio.sleep(0)
            f.states_map[VENT] = "on"
            stopping = asyncio.ensure_future(t.stop(VENT))
            await asyncio.sleep(0)
            f.gate.set()
            await asyncio.gather(starting, stopping)
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
            f.states_map[VENT] = "on"
            await f.started[0]()
            self.assertEqual(f.calls, [("homeassistant", "turn_off", VENT)], "missed while HA was down")
            self.assertEqual(f.saved, {"jobs": []})
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
            f.states_map[VENT] = "on"
            f.event(VENT, "on")
            await f.drain()
            self.assertEqual(f.calls, [("homeassistant", "turn_off", VENT)])
            self.assertEqual(f.saved, {"jobs": []})
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
            self.assertEqual((f.calls, t.summary()), ([], []), "it went off while HA was down")
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


if __name__ == "__main__":
    unittest.main()
