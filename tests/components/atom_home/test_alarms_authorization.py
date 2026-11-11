"""Runtime permission checks at the scheduler boundary, including cancellation."""
import asyncio
import unittest

from test_alarms import FLAG, LAMP, alarms, at, one, run, world
from test_alarms_regressions import rooms


class Authorization(unittest.TestCase):
    def test_revocation_during_sunrise_prevents_all_later_steps_and_the_ring(self):
        async def go():
            w, allowed = world(now=at(10, 6, 50)), True

            async def authorize(alarm):
                return allowed
            scheduler = alarms.AlarmScheduler(w, authorize=authorize)
            try:
                scheduler.set_alarms(one(light=True, lightEntity=LAMP, fadeMin=15))
                await w.settle()
                self.assertEqual(len(w.named("light.turn_on")), 1)
                allowed = False
                await w.advance(at(10, 7, 1))
                self.assertEqual(len(w.named("light.turn_on")), 1, "revocation stops later fade steps and the final 100 percent command")
                self.assertEqual(w.map[FLAG].state, "off")
                self.assertEqual(w.live_timers(), [])
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_cancelling_pending_authorization_cannot_send_even_a_stop_to_the_target(self):
        async def go(action):
            w, gate = world(), asyncio.Event()

            async def authorize(alarm):
                await gate.wait()
                return False
            scheduler = alarms.AlarmScheduler(w, authorize=authorize)
            try:
                scheduler.set_alarms(rooms()[:1])
                await w.advance(at(10, 7, 0))
                await getattr(scheduler, action)()
                gate.set()
                await w.settle()
                self.assertEqual(w.calls, [], "the scheduler never owned this speaker and cannot issue cleanup commands to it")
                self.assertEqual((w.live_timers(), w.tasks), ([], []))
            finally:
                scheduler.shutdown()
                await w.settle()
        for action in ("stop", "async_shutdown"):
            with self.subTest(action=action):
                run(go(action))


if __name__ == "__main__":
    unittest.main()
