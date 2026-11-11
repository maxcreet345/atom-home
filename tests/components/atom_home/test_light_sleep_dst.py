"""CODEX-017: elapsed light timers across both Chisinau clock changes.

Run with python3; only HA boundaries are stubbed, with real ZoneInfo conversions.
"""
import pathlib
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stub
from ha_stub import State, World, run, use

sleep = ha_stub.load("light_sleep")
LOCAL = ZoneInfo("Europe/Chisinau")
LAMP = "light.bedroom"
MIRROR = sleep.MIRROR


class ElapsedTimers(unittest.TestCase):
    def setUp(self):
        self.local = patch.object(sleep.dt_util, "as_local", lambda at: at.astimezone(LOCAL))
        self.local.start()
        self.addCleanup(self.local.stop)

    def check_timer(self, now, expected_utc, label):
        async def go():
            w = use(World(now=now, **{LAMP: "on", MIRROR: State("", max=255)}))
            timer = sleep.LightSleep(w)
            await timer.async_load()
            await w.settle()
            due = await timer.schedule(LAMP, 15)
            self.assertEqual(due.timestamp() - now.timestamp(), 900,
                             "15 minutes must mean 900 elapsed seconds across DST")
            self.assertEqual(due.astimezone(timezone.utc), expected_utc)
            self.assertEqual(w.map[MIRROR].state, f"{LAMP}|{label}")
            self.assertEqual(w.live_timers()[0].timestamp(), expected_utc.timestamp())
            await w.advance(to=expected_utc)
            self.assertEqual([c[2]["entity_id"] for c in w.named("light.turn_off")], [LAMP])
            self.assertEqual(timer.summary(), {})
            timer.shutdown()
        run(go())

    def test_autumn_fifteen_minutes_do_not_become_seventy_five(self):
        self.check_timer(datetime(2026, 10, 25, 3, 50, tzinfo=LOCAL, fold=0),
                         datetime(2026, 10, 25, 1, 5, tzinfo=timezone.utc), "03:05")

    def test_spring_fifteen_minutes_do_not_become_negative(self):
        self.check_timer(datetime(2026, 3, 29, 2, 50, tzinfo=LOCAL),
                         datetime(2026, 3, 29, 1, 5, tzinfo=timezone.utc), "04:05")

    def test_second_autumn_hour_keeps_its_fold(self):
        self.check_timer(datetime(2026, 10, 25, 3, 10, tzinfo=LOCAL, fold=1),
                         datetime(2026, 10, 25, 1, 25, tzinfo=timezone.utc), "03:25")

    def check_restart(self, now, stored, should_switch_off, remains):
        async def go():
            w = use(World(now=now, running=False, **{LAMP: "on"}))
            w.stored[sleep.STORAGE_KEY] = {"pending": {LAMP: stored}}
            timer = sleep.LightSleep(w)
            await timer.async_load()
            await w.start()
            self.assertEqual(bool(w.named("light.turn_off")), should_switch_off)
            self.assertEqual(LAMP in timer.pending, remains)
            timer.shutdown()
        run(go())

    def test_restart_before_fold_does_not_fire_a_future_timer(self):
        self.check_restart(datetime(2026, 10, 25, 3, 50, tzinfo=LOCAL, fold=0),
                           "2026-10-25T03:05:00+02:00", False, True)

    def test_restart_after_fold_drops_a_timer_missed_by_forty_minutes(self):
        self.check_restart(datetime(2026, 10, 25, 3, 30, tzinfo=LOCAL, fold=1),
                           "2026-10-25T03:50:00+03:00", False, False)

    def test_restart_after_fold_catches_a_timer_missed_by_five_minutes(self):
        self.check_restart(datetime(2026, 10, 25, 3, 2, tzinfo=LOCAL, fold=1),
                           "2026-10-25T03:57:00+03:00", True, False)

    def test_mirror_orders_absolute_times_but_displays_local_clock(self):
        pending = {
            "light.later": datetime(2026, 10, 25, 3, 5, tzinfo=LOCAL, fold=1),
            "light.first": datetime(2026, 10, 25, 3, 55, tzinfo=LOCAL, fold=0),
        }
        self.assertEqual(sleep.mirror_text(pending), "light.first|03:55;light.later|03:05")


if __name__ == "__main__":
    unittest.main()
