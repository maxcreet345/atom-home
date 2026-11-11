"""HA dispatches unmarked sync timer callbacks in its executor, not on the event loop."""
import asyncio
import sys
import threading
import unittest
from datetime import datetime

import ha_stub
from ha_stub import TZ, run, use, World

ha_stub.install()


def callback(function):
    function._hass_callback = True
    return function


sys.modules["homeassistant.core"].callback = callback
alarms = ha_stub.load("alarms")
track_point = alarms.async_track_point_in_time


def ha_timer(hass, action, when):
    if getattr(action, "_hass_callback", False):
        return track_point(hass, action, when)

    def invoke(now):
        async def dispatch():
            try:
                await asyncio.get_running_loop().run_in_executor(None, action, now)
            except RuntimeError as error:
                hass.callback_errors.append(str(error))
        hass.dispatched.append(hass.async_create_task(dispatch()))
    return track_point(hass, invoke, when)


alarms.async_track_point_in_time = ha_timer


class Callbacks(unittest.TestCase):
    def exercise(self, snooze):
        async def go():
            w = use(World(input_boolean__alarm_ringing="off"))
            w.callback_errors, w.dispatched = [], []
            create_task = w.async_create_task

            def loop_task(coroutine):
                if threading.current_thread() is not threading.main_thread():
                    coroutine.close()
                    raise RuntimeError("hass.async_create_task called from executor")
                return create_task(coroutine)
            w.async_create_task = loop_task
            scheduler = alarms.AlarmScheduler(w)
            try:
                scheduler.set_alarms(alarms.normalise_alarms([{
                    "id": "bedroom", "room": "bedroom", "time": "07:00", "days": [],
                    "alice": "music", "station": "media_player.parents", "repeats": 0 if snooze else 1, "repeatEveryMin": 3,
                }]))
                await w.advance(datetime(2026, 11, 10, 7, 0, tzinfo=TZ))
                if snooze:
                    await scheduler.snooze(3)
                await w.advance(datetime(2026, 11, 10, 7, 3, tzinfo=TZ))
                await asyncio.gather(*w.dispatched)
                await w.settle()
                self.assertEqual(w.callback_errors, [], "HA must not dispatch the scheduler's task creation into an executor")
                self.assertEqual(len(w.named("yandex_station.send_command")), 2)
            finally:
                scheduler.shutdown()
                await w.settle()
        run(go())

    def test_repeat_callback_runs_on_the_ha_loop(self):
        self.exercise(snooze=False)

    def test_snooze_callback_runs_on_the_ha_loop(self):
        self.exercise(snooze=True)


if __name__ == "__main__":
    unittest.main()
