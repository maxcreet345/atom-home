"""Overlapping alarm lifetime and unload, including the real integration entry point."""
import asyncio
import unittest

from test_alarms import FLAG, TEXT, alarms, at, run, world
from test_alarms_regressions import CHILDREN, PARENTS, rooms, targets
from test_surface import Surface, ah


class Occurrences(unittest.TestCase):
    def test_newer_alarm_owns_a_shared_speaker_until_its_own_auto_stop(self):
        async def go():
            w = world()
            scheduler = alarms.AlarmScheduler(w)
            configured = rooms("07:05")
            configured[1]["station"] = PARENTS
            try:
                scheduler.set_alarms(configured)
                await w.advance(at(10, 7, 10))
                self.assertEqual(targets(w, "media_player.media_stop"), [], "the earlier alarm must not cut off the newer sound")
                self.assertEqual(w.map[FLAG].state, "on")
                await w.advance(at(10, 7, 15))
                self.assertEqual(targets(w, "media_player.media_stop"), [PARENTS])
                self.assertEqual(w.map[FLAG].state, "off")
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_stop_sends_one_command_to_a_shared_speaker(self):
        async def go():
            w = world()
            scheduler = alarms.AlarmScheduler(w)
            configured = rooms("07:05")
            configured[1]["station"] = PARENTS
            try:
                scheduler.set_alarms(configured)
                await w.advance(at(10, 7, 5))
                await scheduler.stop()
                self.assertEqual(targets(w, "media_player.media_stop"), [PARENTS])
                self.assertEqual(w.live_timers(), [])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_unload_finishes_the_one_shot_switch_off_write(self):
        async def go():
            w, entered, gate, persisted = world(), asyncio.Event(), asyncio.Event(), []

            async def on_once(alarm_id):
                entered.set()
                await gate.wait()
                persisted.append(alarm_id)
            scheduler = alarms.AlarmScheduler(w, on_once)
            scheduler.set_alarms(rooms()[:1])
            await w.advance(at(10, 7, 0))
            await entered.wait()
            closing = asyncio.ensure_future(scheduler.async_shutdown())
            try:
                await w.settle()
                self.assertFalse(closing.done(), "unload must drain the one-shot write before a reload can read the saved list")
            finally:
                gate.set()
                await closing
                await w.settle()
            self.assertEqual(persisted, ["parents"])
            self.assertEqual((w.live_timers(), w.tasks), ([], []))
        run(go())

    def test_editing_the_same_id_keeps_the_previous_speaker_stoppable(self):
        async def go():
            w = world()
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(rooms()[:1])
                await w.advance(at(10, 7, 0))
                changed = rooms()[0]
                changed.update(time="07:01", station=CHILDREN)
                scheduler.set_alarms([changed])
                await w.advance(at(10, 7, 1))
                await scheduler.stop()
                self.assertCountEqual(targets(w, "yandex_station.send_command"), [PARENTS, CHILDREN])
                self.assertCountEqual(targets(w, "media_player.media_stop"), [PARENTS, CHILDREN])
                self.assertEqual(w.live_timers(), [])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_stop_cancels_a_ring_waiting_for_its_speaker(self):
        async def go():
            w, gate = world(), asyncio.Event()
            original_call = w.services.async_call

            async def delayed(domain, service, data, **kwargs):
                if domain == "yandex_station":
                    await gate.wait()
                await original_call(domain, service, data, **kwargs)
            w.services.async_call = delayed
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(rooms()[:1])
                await w.advance(at(10, 7, 0))
                await scheduler.stop()
                gate.set()
                await w.settle()
                self.assertEqual(targets(w, "yandex_station.send_command"), [])
                self.assertEqual(w.live_timers(), [])
                self.assertEqual(w.map[FLAG].state, "off")
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_unload_cancels_restart_cleanup_waiting_for_its_speaker(self):
        async def go():
            w = world(**{FLAG.replace(".", "__"): "on", TEXT.replace(".", "__"): "parents|bedroom|07:00||0"})
            gate, original_call = asyncio.Event(), w.services.async_call

            async def delayed(domain, service, data, **kwargs):
                if domain == "media_player":
                    await gate.wait()
                await original_call(domain, service, data, **kwargs)
            w.services.async_call = delayed
            scheduler = alarms.AlarmScheduler(w)
            scheduler.set_alarms(rooms()[:1])
            scheduler.start()
            await w.settle()
            scheduler.shutdown()
            gate.set()
            await w.settle()
            self.assertEqual(w.calls, [], "the restart task must not issue commands after unload")
            self.assertEqual(w.tasks, [])
        run(go())


class Unload(Surface):
    def test_integration_unload_stops_both_speakers_before_discarding_their_timers(self):
        async def go():
            w = await self.house(stored={"schemaVersion": 1, "alarms": rooms("07:01")})
            await w.advance(at(10, 7, 1))
            self.assertCountEqual(targets(w, "yandex_station.send_command"), [PARENTS, CHILDREN])
            self.assertTrue(await ah.async_unload_entry(w, self.entry))
            await w.settle()
            self.assertCountEqual(targets(w, "media_player.media_stop"), [PARENTS, CHILDREN])
            self.assertEqual(w.map[FLAG].state, "off")
            self.assertEqual((w.live_timers(), w.tasks), ([], []))
        run(go())


if __name__ == "__main__":
    unittest.main()
