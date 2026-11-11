"""«Выключить через» without Home Assistant: python3 tests/components/atom_home/test_light_sleep.py

The real light_sleep.py runs against the stand-ins of ha_stub.py; the test moves the clock and the lamp.
"""
import pathlib
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stub  # noqa: E402
from ha_stub import TZ, State, World, run, use  # noqa: E402

sleep = ha_stub.load("light_sleep")

LAMP, HALL, RELAY, MIRROR, KEY = "light.bedroom_lamp", "light.hall_lamp", "switch.kitchen_light_relay", "input_text.atom_light_sleep", "atom_home.light_sleep"
T22 = datetime(2026, 11, 10, 22, 0, 0, tzinfo=TZ)


def world(running=True, **states):
    return use(World(now=T22, running=running, **{MIRROR.replace(".", "__"): State("", max=255), **{k.replace(".", "__"): v for k, v in states.items()}}))


async def loaded(w):
    ls = sleep.LightSleep(w)
    await ls.async_load()
    await w.settle()
    return ls


def offs(w):
    return [(c[1], c[2]["entity_id"]) for c in w.calls if c[1].endswith("turn_off")]


class Timer(unittest.TestCase):
    def test_goes_off_at_its_time(self):
        async def go():
            w = world(**{LAMP: "on", RELAY: "on"})
            ls = await loaded(w)
            until = await ls.schedule(LAMP, 60, context="daniela")
            await ls.schedule(RELAY, 30)
            self.assertEqual(until, T22 + timedelta(minutes=60))
            self.assertEqual(w.map[MIRROR].state, f"{RELAY}|22:30;{LAMP}|23:00")
            await w.advance(minutes=30)
            self.assertEqual(offs(w), [("homeassistant.turn_off", RELAY)], "a relay shown as a light is a switch: light.turn_off would ignore it")
            await w.advance(minutes=30)
            self.assertEqual(offs(w)[-1], ("light.turn_off", LAMP))
            self.assertEqual(w.named("light.turn_off")[0][3], "daniela", "the logbook names who asked")
            self.assertEqual((ls.summary(), w.map[MIRROR].state, w.stored[KEY]), ({}, "", {"pending": {}}))
            self.assertEqual((w.live_timers(), [r for r in w.listeners if r[2]]), ([], []))
        run(go())

    def test_unavailable_for_a_moment_keeps_the_timer(self):
        async def go():
            w = world(**{LAMP: "on"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 60)
            await w.advance(minutes=5)
            w.set(LAMP, "unavailable")  # Zigbee2MQTT restarts
            await w.settle()
            w.set(LAMP, "on")
            await w.settle()
            self.assertEqual(list(ls.summary()), [LAMP])
            self.assertEqual(w.map[MIRROR].state, f"{LAMP}|23:00")
            self.assertIn(LAMP, w.stored[KEY]["pending"])
            await w.advance(minutes=55)
            self.assertEqual(offs(w), [("light.turn_off", LAMP)], "the lamp is switched off at 23:00 as promised")
        run(go())

    def test_switched_off_by_hand_forgets_the_timer(self):
        async def go():
            w = world(**{LAMP: "on"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 60)
            w.set(LAMP, "off")
            await w.settle()
            self.assertEqual((ls.summary(), w.map[MIRROR].state, w.stored[KEY]), ({}, "", {"pending": {}}))
            w.set(LAMP, "on")
            await w.advance(minutes=61)
            self.assertEqual(offs(w), [], "switched on again later: the old timer must not put it out")
        run(go())

    def test_switched_off_by_hand_while_it_was_out_of_the_network_forgets_the_timer(self):
        async def go():
            w = world(**{LAMP: "on"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 60)
            await w.advance(minutes=5)
            w.set(LAMP, "unavailable")  # Zigbee2MQTT restarts…
            await w.settle()
            await w.advance(minutes=1)
            w.set(LAMP, "off")  # …and someone switched the lamp off at the wall meanwhile: on → unavailable → off
            await w.settle()
            self.assertEqual((ls.summary(), w.map[MIRROR].state, w.stored[KEY]), ({}, "", {"pending": {}}))
            await w.advance(minutes=20)
            w.set(LAMP, "on")
            await w.advance(minutes=40)
            self.assertEqual(offs(w), [], "switched on again later: the old timer must not put it out")
            self.assertEqual((w.live_timers(), [r for r in w.listeners if r[2]]), ([], []))
        run(go())

    def test_back_from_the_network_through_unknown_and_on_keeps_the_timer(self):
        async def go():
            w = world(**{LAMP: "on"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 60)
            for state in ("unavailable", "unknown", "on"):
                w.set(LAMP, state)
                await w.settle()
            self.assertEqual(list(ls.summary()), [LAMP])
            w.set(LAMP, "unavailable")
            await w.settle()
            w.set(LAMP, "on")  # answered «on» in between: the next drop-out starts afresh
            await w.settle()
            await w.advance(minutes=60)
            self.assertEqual(offs(w), [("light.turn_off", LAMP)])
        run(go())

    def test_cancel(self):
        async def go():
            w = world(**{LAMP: "on"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 15)
            self.assertIsNone(await ls.schedule(LAMP, 0))
            await w.advance(minutes=20)
            self.assertEqual(offs(w), [])
            with self.assertRaises(ValueError):
                await ls.schedule("climate.living_thermostat", 15)
        run(go())

    def test_away_at_its_time_is_done_when_the_lamp_returns(self):
        async def go():
            w = world(**{LAMP: "on"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 15)
            w.set(LAMP, "unavailable")
            await w.advance(minutes=15)
            self.assertEqual(offs(w), [], "no command into the void")
            self.assertEqual(list(ls.summary()), [LAMP], "and the timer is not spent")
            await w.advance(minutes=3)
            w.set(LAMP, "on")
            await w.settle()
            self.assertEqual(offs(w), [("light.turn_off", LAMP)])
            self.assertEqual((ls.summary(), w.live_timers()), ({}, []))
        run(go())

    def test_away_too_long_is_dropped_and_never_strikes_later(self):
        async def go():
            w = world(**{LAMP: "on", HALL: "on"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 15)
            await ls.schedule(HALL, 15)
            w.set(LAMP, "unavailable")  # switched off at the wall
            w.set(HALL, "unavailable")
            await w.advance(minutes=16)
            w.set(HALL, "off")  # back, and dark already
            await w.settle()
            self.assertEqual((offs(w), list(ls.summary())), ([], [LAMP]))
            await w.advance(seconds=sleep.WAIT_SECONDS)
            self.assertEqual((ls.summary(), w.map[MIRROR].state, w.stored[KEY]), ({}, "", {"pending": {}}))
            w.set(LAMP, "on")  # next evening someone switches it on at the wall
            await w.advance(minutes=5)
            self.assertEqual(offs(w), [], "it does not go dark under their hand")
        run(go())


class Restart(unittest.TestCase):
    def test_timers_survive_and_the_missed_one_is_caught_up_once_ha_is_up(self):
        async def go():
            w = world(running=False)  # atom_home sets up before the lamps: no states, no light.turn_off yet
            w.refuse.add("light")
            w.stored[KEY] = {"pending": {LAMP: (T22 + timedelta(minutes=40)).isoformat(), HALL: (T22 - timedelta(minutes=1)).isoformat(), "climate.x": T22.isoformat(), RELAY: "junk"}}
            ls = await loaded(w)
            self.assertEqual(sorted(ls.summary()), sorted([HALL, LAMP]), "what is not a lamp or not a time is skipped")
            self.assertEqual(w.calls, [], "nothing is commanded before Home Assistant is up")
            for lamp in (LAMP, HALL):  # an MQTT lamp is added before its availability topic answers
                w.set(lamp, "unavailable")
                await w.settle()
                w.set(lamp, "on")
                await w.settle()
            self.assertEqual(sorted(ls.summary()), sorted([HALL, LAMP]), "the entity appearing is not a hand on the switch")
            self.assertLessEqual({HALL, LAMP}, set(w.stored[KEY]["pending"]), "and nothing was wiped from the file")
            w.refuse.clear()
            await w.start()
            self.assertEqual(offs(w), [("light.turn_off", HALL)], "missed while HA was down: switched off now")
            self.assertEqual(w.map[MIRROR].state, f"{LAMP}|22:40")
            await w.advance(minutes=40)
            self.assertEqual(offs(w)[-1], ("light.turn_off", LAMP))
        run(go())

    def test_a_timer_missed_by_hours_is_dropped_not_done_under_someones_hand(self):
        async def go():
            # due at 23:00, Home Assistant down from 22:50 until 07:30: the lamp is on because someone is in the room
            w = use(World(now=datetime(2026, 11, 11, 7, 30, tzinfo=TZ), running=False, **{MIRROR.replace(".", "__"): State(f"{LAMP}|23:00", max=255), LAMP.replace(".", "__"): "on", HALL.replace(".", "__"): "on"}))
            late, just = datetime(2026, 11, 10, 23, 0, tzinfo=TZ), w.now - timedelta(seconds=sleep.WAIT_SECONDS - 5)
            w.stored[KEY] = {"pending": {LAMP: late.isoformat(), HALL: just.isoformat()}}
            ls = await loaded(w)
            await w.start()
            self.assertEqual(offs(w), [("light.turn_off", HALL)], "overdue by 8.5 h: not switched off; overdue by under ten minutes: caught up as before")
            self.assertEqual((ls.summary(), w.map[MIRROR].state, w.stored[KEY]), ({}, "", {"pending": {}}), "and it is gone from the file and from the panel")
            await w.advance(hours=24)
            self.assertEqual(len(offs(w)), 1)
            self.assertEqual((w.live_timers(), [r for r in w.listeners if r[2]]), ([], []))
        run(go())

    def test_a_missed_timer_waits_for_a_lamp_that_is_still_away_at_start(self):
        async def go():
            w = world(running=False)
            w.stored[KEY] = {"pending": {HALL: (T22 - timedelta(minutes=1)).isoformat()}}
            ls = await loaded(w)
            w.set(HALL, "unavailable")
            await w.start()
            self.assertEqual((offs(w), list(ls.summary())), ([], [HALL]))
            w.set(HALL, "on")
            await w.settle()
            self.assertEqual(offs(w), [("light.turn_off", HALL)])
        run(go())

    def test_unload_cancels_everything(self):
        async def go():
            w = world(**{LAMP: "on", HALL: "unavailable"})
            ls = await loaded(w)
            await ls.schedule(LAMP, 15)
            await ls.schedule(HALL, 1)
            await w.advance(minutes=2)  # HALL is being waited for
            ls.shutdown()
            self.assertEqual((w.live_timers(), [r for r in w.listeners if r[2]]), ([], []))
            w2 = world(running=False)
            ls2 = await loaded(w2)
            ls2.shutdown()
            await w2.start()
            self.assertEqual(w2.calls, [])
        run(go())


class Mirror(unittest.TestCase):
    def many(self, n):
        return {f"light.room_{i:02d}_ceiling_lamp": T22 + timedelta(minutes=i) for i in range(n)}

    def test_whole_entries_only(self):
        text = sleep.mirror_text(self.many(12))
        self.assertLessEqual(len(text), 255)
        entries = text.split(";")
        self.assertTrue(all(len(e.split("|")) == 2 and len(e.split("|")[1]) == 5 for e in entries), f"no half entry at the end: {entries[-1]!r}")
        self.assertEqual(entries[0], "light.room_00_ceiling_lamp|22:00", "the soonest first: if some do not fit, it is the latest ones")
        self.assertEqual(len(entries), 255 // (len(entries[0]) + 1))
        self.assertEqual(sleep.mirror_text({}), "")

    def test_a_helper_with_a_short_max_gets_what_fits(self):
        async def go():
            w = world(**{f"light.room_{i:02d}_ceiling_lamp": "on" for i in range(6)})
            w.map[MIRROR] = State("", max=100)  # the default length of a new input_text
            ls = await loaded(w)
            for i in range(6):
                await ls.schedule(f"light.room_{i:02d}_ceiling_lamp", 15 if i else 30)
            value = w.map[MIRROR].state
            self.assertEqual(len(value.split(";")), 3, "three whole entries fit into 100 characters; before, set_value was refused and the mirror kept the old text")
            self.assertTrue(value.startswith("light.room_01_ceiling_lamp|22:15"))
        run(go())

    def test_no_helper_no_error(self):
        async def go():
            w = world(**{LAMP: "on"})
            del w.map[MIRROR]
            ls = await loaded(w)
            await ls.schedule(LAMP, 15)
            await w.advance(minutes=15)
            self.assertEqual(offs(w), [("light.turn_off", LAMP)])
        run(go())


if __name__ == "__main__":
    unittest.main()
