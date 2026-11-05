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
        self.listeners, self.timers, self.fail = [], [], False
        self.states = NS(get=lambda e: NS(state=self.states_map[e]) if e in self.states_map else None)
        self.services = NS(async_call=self._call)

    async def _call(self, domain, service, data, blocking=False):
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

        return air.AirTasks(self, Store(), track, later, lambda: self.now)

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
            self.assertEqual(t.summary()[0]["target"], 60)
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
            for bad in (("melt", "r", VENT, HUM), ("dehumidify", "r", "light.x", HUM), ("dehumidify", "r", "lock.door", HUM), ("dehumidify", "r", VENT, "light.x"), ("purify", "r", "switch.x", HUM), ("humidify", "r", VENT, HUM), ("dehumidify", "../x", VENT, HUM)):
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

    def test_a_dead_sensor_does_not_end_the_job(self):
        self.assertFalse(air.reached("dehumidify", "unavailable", 60))
        self.assertFalse(air.reached("humidify", "nan", 45))
        self.assertTrue(air.reached("humidify", "45", 45))
        self.assertFalse(air.reached("humidify", "44", 45))

    def test_survives_a_restart(self):
        async def go():
            f = Fake(**{VENT: "on", HUM: "78"})
            f.stored = {"jobs": [{"kind": "dehumidify", "roomId": "vannaia", "device": VENT, "sensor": HUM, "target": 60, "startedAt": 900.0, "wasOn": False}]}
            t = f.make()
            await t.async_load()
            self.assertEqual(len(t.summary()), 1)
            self.assertEqual(f.timers[0][0], 3500.0, "the hour goes on from when it began")
            f2 = Fake(**{VENT: "on", HUM: "78"})
            f2.stored = {"jobs": [{"kind": "dehumidify", "roomId": "vannaia", "device": VENT, "sensor": HUM, "startedAt": -5000.0, "wasOn": False}]}
            t2 = f2.make()
            await t2.async_load()
            self.assertEqual(f2.calls, [("homeassistant", "turn_off", VENT)], "missed while HA was down")
            self.assertEqual(t2.summary(), [])
        run(go())


if __name__ == "__main__":
    unittest.main()
