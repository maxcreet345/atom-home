"""The helpers a panel creates, and «таймер готов» raised by the integration (26.11.2026): python3 -m pytest tests/components/atom_home/test_helpers_setup.py

A new house had no `timer.atom_1…3` and the «Time» sheet showed no timers; nothing raised `input_boolean.timer_done` there either.
"""
import pathlib
import sys
import types
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stub  # noqa: E402

check = ha_stub.load("helpers_check")


class State:
    def __init__(self, state="", **attributes):
        self.state, self.attributes = state, attributes


class ToCreate(unittest.TestCase):
    def test_a_new_house_gets_every_helper_with_its_object_id(self):
        out = check.to_create(lambda _id: None, lambda _id: False)
        self.assertEqual([x["entity_id"] for x in out], list(check.SPECS))
        timer = next(x for x in out if x["entity_id"] == "timer.atom_1")
        self.assertEqual((timer["domain"], timer["params"]["name"], timer["params"]["restore"]), ("timer", "Atom 1", True))
        labels = next(x for x in out if x["entity_id"] == check.TIMER_LABELS)
        self.assertEqual(labels["params"]["max"], 255, "the labels' JSON needs the long text helper")

    def test_an_older_house_gets_only_what_it_lacks(self):
        have = {check.RING_FLAG, check.RING_TEXT, check.SLEEP_MIRROR, "timer.atom_1"}
        out = check.to_create(lambda i: State() if i in have else None, lambda _id: False)
        self.assertEqual([x["entity_id"] for x in out], ["timer.atom_2", "timer.atom_3", check.TIMER_LABELS, check.TIMER_DONE])

    def test_a_disabled_helper_is_left_alone(self):
        out = check.to_create(lambda _id: None, lambda i: i == "timer.atom_2")
        self.assertNotIn("timer.atom_2", [x["entity_id"] for x in out], "creating it again would make timer.atom_2_2")

    def test_a_short_labels_helper_is_reported(self):
        self.assertEqual(check.short_helpers(lambda i: State(max=100) if i == check.TIMER_LABELS else None), [check.TIMER_LABELS])


class LeaseTest(unittest.TestCase):
    def test_one_panel_at_a_time(self):
        now = [0.0]
        lease = check.Lease(lambda: now[0])
        self.assertTrue(lease.take("tablet"))
        self.assertFalse(lease.take("phone"), "a second kiosk that reloads at the same moment gets nothing to create")
        self.assertTrue(lease.take("tablet"), "the screen that holds it may try a failed helper again at once")
        now[0] += check.LEASE_SECONDS
        self.assertTrue(lease.take("phone"), "after two minutes another panel may try")


class TimerDoneTest(unittest.TestCase):
    def setUp(self):
        self.later = []
        self.td = ha_stub.load("timer_done")
        self.td.async_call_later = lambda _hass, seconds, action: (self.later.append((seconds, action)), lambda: self.later.remove((seconds, action)) if (seconds, action) in self.later else None)[1]
        self.states, self.calls, self.listeners = {}, [], {}
        test = self

        class Services:
            async def async_call(self, domain, service, data, blocking=False):
                test.calls.append((domain, service, data["entity_id"]))
                test.states[data["entity_id"]] = State("on" if service == "turn_on" else "off")

        self.hass = types.SimpleNamespace(
            states=types.SimpleNamespace(get=self.states.get),
            services=Services(),
            bus=types.SimpleNamespace(async_listen=lambda ev, fn: (self.listeners.__setitem__(ev, fn), lambda: self.listeners.pop(ev, None))[1]),
            tasks=[],
        )
        self.hass.async_create_task = lambda coro: self.hass.tasks.append(coro)

    def fire(self, entity_id):
        self.listeners["timer.finished"](types.SimpleNamespace(data={"entity_id": entity_id}))
        ha_stub.run(self._drain())

    async def _drain(self):
        while self.hass.tasks:
            await self.hass.tasks.pop(0)

    def test_a_finished_timer_raises_the_flag_and_lowers_it_after_two_minutes(self):
        self.states[check.TIMER_DONE] = State("off")
        w = self.td.TimerDone(self.hass)
        w.start()
        self.fire("timer.atom_2")
        self.assertEqual(self.calls, [("input_boolean", "turn_on", check.TIMER_DONE)])
        self.assertEqual([s for s, _ in self.later], [120])
        self.later[0][1](None)
        ha_stub.run(self._drain())
        self.assertEqual(self.calls[-1], ("input_boolean", "turn_off", check.TIMER_DONE))
        w.shutdown()
        self.assertEqual(self.listeners, {})

    def test_other_timers_and_a_house_without_the_flag_are_ignored(self):
        w = self.td.TimerDone(self.hass)
        w.start()
        self.fire("timer.atom_1")  # no flag helper yet
        self.states[check.TIMER_DONE] = State("off")
        self.fire("timer.laundry")
        self.assertEqual(self.calls, [])

    def test_stopped_by_hand_is_not_touched_again(self):
        self.states[check.TIMER_DONE] = State("off")
        w = self.td.TimerDone(self.hass)
        w.start()
        self.fire("timer.atom_1")
        self.states[check.TIMER_DONE] = State("off")  # «Стоп» on the banner
        self.later[0][1](None)
        ha_stub.run(self._drain())
        self.assertEqual(self.calls, [("input_boolean", "turn_on", check.TIMER_DONE)])


if __name__ == "__main__":
    unittest.main()
