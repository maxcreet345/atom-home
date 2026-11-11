"""Alarm scheduler regressions, using real services/timers against the plain HA stubs.

Run: python3 tests/components/atom_home/test_alarms_regressions.py
"""
import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from test_alarms import FLAG, LAMP, alarms, at, one, run, world

LOCAL = ZoneInfo("Europe/Chisinau")
PARENTS = "media_player.parents"
CHILDREN = "media_player.children"


def rooms(second_time="07:00", **options):
    return alarms.normalise_alarms([
        {"id": "parents", "room": "bedroom", "time": "07:00", "days": [], "alice": "music", "station": PARENTS, **options},
        {"id": "children", "room": "nursery", "time": second_time, "days": [], "alice": "music", "station": CHILDREN, **options},
    ])


def targets(w, service):
    return [call[2]["entity_id"] for call in w.named(service)]


class Simultaneous(unittest.TestCase):
    def test_both_rooms_ring_and_both_one_shots_are_spent(self):
        async def go():
            w, spent = world(), []

            async def on_once(aid):
                spent.append(aid)
            scheduler = alarms.AlarmScheduler(w, on_once)
            try:
                scheduler.set_alarms(rooms())
                await w.advance(at(10, 7, 0))
                self.assertCountEqual(targets(w, "yandex_station.send_command"), [PARENTS, CHILDREN])
                self.assertCountEqual(spent, ["parents", "children"])
                self.assertEqual(scheduler.summary()["next"], [])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_delayed_loop_processes_all_due_rooms_before_rescheduling(self):
        async def go():
            w = world()
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(rooms("07:01", days=[2]))
                w.now = at(10, 7, 1, 5)  # callbacks did not get CPU for 65 seconds
                await w.advance(w.now)
                self.assertCountEqual(targets(w, "yandex_station.send_command"), [PARENTS, CHILDREN])
                self.assertEqual([n["at"] for n in scheduler.summary()["next"]], [at(17, 7, 0).isoformat(), at(17, 7, 1).isoformat()])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())


class Overlap(unittest.TestCase):
    def test_stop_silences_every_active_room(self):
        async def go():
            w = world()
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(rooms("07:01"))
                await w.advance(at(10, 7, 1))
                await scheduler.stop()
                self.assertCountEqual(targets(w, "media_player.media_stop"), [PARENTS, CHILDREN])
                self.assertEqual(w.map[FLAG].state, "off")
                self.assertEqual(w.live_timers(), [])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_auto_stop_and_repeat_remain_independent_per_room(self):
        async def go():
            w = world()
            scheduler = alarms.AlarmScheduler(w)
            try:
                configured = rooms("07:01")
                configured[1].update(repeats=1, repeatEveryMin=3)
                scheduler.set_alarms(configured)
                await w.advance(at(10, 7, 10))
                self.assertIn(PARENTS, targets(w, "media_player.media_stop"), "the first room keeps its ten-minute auto-stop")
                self.assertEqual(targets(w, "yandex_station.send_command").count(CHILDREN), 2)
                self.assertEqual(scheduler.summary()["ringing"], "children")
                self.assertEqual(w.map[FLAG].state, "on")
                await w.advance(at(10, 7, 14))
                self.assertIsNone(scheduler.summary()["ringing"])
                self.assertEqual(w.map[FLAG].state, "off")
                self.assertEqual(w.live_timers(), [])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_snooze_quiets_and_resumes_all_active_rooms(self):
        async def go():
            w = world()
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(rooms("07:01"))
                await w.advance(at(10, 7, 1))
                await scheduler.snooze(9)
                self.assertCountEqual(targets(w, "media_player.media_stop"), [PARENTS, CHILDREN])
                self.assertEqual(w.map[FLAG].state, "off")
                await w.advance(at(10, 7, 10))
                self.assertCountEqual(targets(w, "yandex_station.send_command"), [PARENTS, CHILDREN, PARENTS, CHILDREN])
                await scheduler.stop()
                self.assertEqual(w.live_timers(), [])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_unload_cancels_a_ring_waiting_for_a_service(self):
        async def go():
            w, gate = world(), asyncio.Event()
            original_call = w.services.async_call

            async def delayed(domain, service, data, **kwargs):
                if domain == "yandex_station":
                    await gate.wait()
                await original_call(domain, service, data, **kwargs)
            w.services.async_call = delayed
            scheduler = alarms.AlarmScheduler(w)
            scheduler.set_alarms(rooms()[:1])
            await w.advance(at(10, 7, 0))
            scheduler.shutdown()
            gate.set()
            await w.settle()
            self.assertEqual(targets(w, "yandex_station.send_command"), [], "unloaded work cannot start the speaker")
            self.assertEqual(w.live_timers(), [], "unloaded work cannot install another stop timer")
            self.assertEqual(w.tasks, [])
        run(go())


class DstSchedule(unittest.TestCase):
    def test_second_autumn_hour_never_returns_a_past_instant(self):
        now = datetime(2026, 10, 25, 3, 15, tzinfo=LOCAL, fold=1)
        result = alarms.next_fire(one(time="03:30", days=[7])[0], now)
        self.assertGreater(result.timestamp(), now.timestamp(), "a past timer would immediately ring and reschedule forever")
        self.assertEqual(result.isoformat(), "2026-11-01T03:30:00+02:00", "ambiguous local times ring once, at the first occurrence")

    def test_first_autumn_hour_rings_once_then_skips_the_second_occurrence(self):
        alarm = one(time="03:30", days=[7])[0]
        before = datetime(2026, 10, 25, 3, 15, tzinfo=LOCAL)
        first = alarms.next_fire(alarm, before)
        self.assertEqual(first.isoformat(), "2026-10-25T03:30:00+03:00")
        self.assertEqual(alarms.next_fire(alarm, first).isoformat(), "2026-11-01T03:30:00+02:00")

    def test_missing_spring_time_is_shifted_forward_by_the_gap(self):
        alarm = one(time="03:30", days=[7])[0]
        now = datetime(2026, 3, 29, 4, 15, tzinfo=LOCAL)
        self.assertEqual(alarms.next_fire(alarm, now).isoformat(), "2026-03-29T04:30:00+03:00")

    def test_fall_scheduler_only_installs_future_timers(self):
        async def go():
            w = world(now=datetime(2026, 10, 25, 3, 15, tzinfo=LOCAL, fold=1))
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(one(time="03:30", days=[7]))
                self.assertTrue(w.live_timers())
                self.assertTrue(all(t.timestamp() > w.now.timestamp() for t in w.live_timers()), "no immediately retriggered callback")
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())


class DstDurations(unittest.TestCase):
    def test_snooze_is_nine_elapsed_minutes_across_both_transitions(self):
        async def go(now):
            w = world(now=now)
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(one(time=now.strftime("%H:%M")))
                # Install the alarm just before its nominal ring, without wall-clock arithmetic in the test.
                w.now = datetime.fromtimestamp(now.timestamp() - 1, LOCAL)
                scheduler.set_alarms(one(time=now.strftime("%H:%M")))
                await w.advance(now)
                await scheduler.snooze(9)
                self.assertEqual(len(w.live_timers()), 1)
                self.assertEqual(w.live_timers()[0].timestamp() - now.timestamp(), 540)
            finally:
                scheduler.shutdown()
                await w.settle()
        for now in (datetime(2026, 10, 25, 3, 55, tzinfo=LOCAL), datetime(2026, 3, 29, 2, 55, tzinfo=LOCAL)):
            with self.subTest(now=now.isoformat()):
                run(go(now))

    def test_repeat_and_auto_stop_use_elapsed_minutes_across_both_transitions(self):
        async def go(now, repeats, minutes):
            w = world(now=datetime.fromtimestamp(now.timestamp() - 1, LOCAL))
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(one(time=now.strftime("%H:%M"), repeats=repeats, repeatEveryMin=10))
                await w.advance(now)
                self.assertEqual(len(w.live_timers()), 1)
                self.assertEqual(w.live_timers()[0].timestamp() - now.timestamp(), minutes * 60)
            finally:
                scheduler.shutdown()
                await w.settle()
        for now in (datetime(2026, 10, 25, 3, 55, tzinfo=LOCAL), datetime(2026, 3, 29, 2, 55, tzinfo=LOCAL)):
            for repeats in (0, 1):
                with self.subTest(now=now.isoformat(), repeats=repeats):
                    run(go(now, repeats, 10))

    def test_sunrise_starts_fifteen_elapsed_minutes_before_a_post_fallback_ring(self):
        async def go():
            w = world(now=datetime(2026, 10, 25, 2, 0, tzinfo=LOCAL))
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(one(time="04:05", light=True, lightEntity=LAMP, fadeMin=15))
                deadlines = sorted(t.timestamp() for t in w.live_timers())
                self.assertEqual(len(deadlines), 2)
                self.assertEqual(deadlines[1] - deadlines[0], 900)
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_sunrise_progress_uses_elapsed_time_during_the_repeated_hour(self):
        async def go():
            w = world(now=datetime(2026, 10, 25, 3, 58, tzinfo=LOCAL))
            scheduler = alarms.AlarmScheduler(w)
            alarm = one(time="04:05", light=True, lightEntity=LAMP, fadeMin=15)[0]
            ring = datetime(2026, 10, 25, 4, 5, tzinfo=LOCAL)
            task = asyncio.ensure_future(scheduler._fade(alarm, ring))
            try:
                await w.settle()
                # Two real minutes later the clock has fallen back to 03:00.
                w.now = datetime(2026, 10, 25, 3, 0, tzinfo=LOCAL, fold=1)
                w.sleepers[-1][1].set_result(None)
                await w.settle()
                levels = [c[2]["brightness_pct"] for c in w.named("light.turn_on")]
                self.assertEqual(levels, [1, 4], "two minutes of a 67-minute remaining interval have elapsed")
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                scheduler.shutdown()
                await w.settle()
        run(go())


if __name__ == "__main__":
    unittest.main()
