"""Air-task shutdown races, with real scheduling logic and an in-memory HA boundary."""
import asyncio
import copy
import unittest
from types import SimpleNamespace as NS

import test_air_tasks as base


class LifecycleFake(base.Fake):
    def __init__(self):
        super().__init__(**{base.VENT: "off", base.HUM: "78"})
        self.entered_on = asyncio.Event()
        self.entered_save = asyncio.Event()
        self.save_gate = None
        self.history = []

    async def _call(self, domain, service, data, blocking=False, context=None):
        if service == "turn_on":
            self.entered_on.set()
        try:
            await super()._call(domain, service, data, blocking, context)
        finally:
            self.history.append((service, self.states_map.get(data["entity_id"])))

    def make(self):
        tasks = super().make()

        async def save(data):
            self.entered_save.set()
            if self.save_gate:
                await self.save_gate.wait()
            self.saved = self.stored = copy.deepcopy(data)
            self.history.append(("save", self.states_map[base.VENT]))

        async def remove():
            self.history.append(("remove", self.states_map[base.VENT]))
            self.removed = True
            self.stored = None

        tasks.store.async_save = save
        tasks.store.async_remove = remove
        return tasks


class Unload(unittest.TestCase):
    def start(self, tasks):
        return asyncio.create_task(tasks.start("dehumidify", "vannaia", base.VENT, base.HUM))

    async def finish_pending(self, fake, tasks, starting, gate):
        tasks.unload()
        removing = asyncio.create_task(tasks.async_remove())
        # Give removal a turn while the actual service/save boundary is held.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        gate.set()
        result = await asyncio.gather(starting, removing, return_exceptions=True)
        self.assertIsNone(result[1], "shutdown must finish even if the start failed")
        self.assertEqual(fake.states_map[base.VENT], "off", fake.history)
        self.assertEqual(fake.history[-1], ("remove", "off"), fake.history)
        self.assertTrue(fake.removed)
        self.assertIsNone(fake.stored)
        self.assertEqual((fake.listeners, fake.timers), ([], []))
        return result[0]

    def test_disable_waits_for_pending_turn_on_before_final_off(self):
        async def go():
            fake = LifecycleFake()
            fake.gate, fake.gate_only = asyncio.Event(), "turn_on"
            tasks = fake.make()
            starting = self.start(tasks)
            await fake.entered_on.wait()
            result = await self.finish_pending(fake, tasks, starting, fake.gate)
            self.assertIsNone(result)
            self.assertEqual([call[1] for call in fake.calls], ["turn_on", "turn_off"])
        asyncio.run(go())

    def test_disable_waits_even_when_turn_on_obeys_then_raises(self):
        async def go():
            fake = LifecycleFake()
            fake.gate, fake.gate_only = asyncio.Event(), "turn_on"
            fake.raise_after.add("turn_on")
            tasks = fake.make()
            starting = self.start(tasks)
            await fake.entered_on.wait()
            result = await self.finish_pending(fake, tasks, starting, fake.gate)
            self.assertIsInstance(result, RuntimeError)
            self.assertEqual([call[1] for call in fake.calls], ["turn_on", "turn_off"])
        asyncio.run(go())

    def test_stop_then_disable_keeps_the_job_until_pending_on_is_stopped(self):
        async def go():
            for obey_then_raise in (False, True):
                fake = LifecycleFake()
                fake.gate, fake.gate_only = asyncio.Event(), "turn_on"
                if obey_then_raise:
                    fake.raise_after.add("turn_on")
                tasks = fake.make()
                starting = self.start(tasks)
                await fake.entered_on.wait()
                await tasks.stop(base.VENT)
                await self.finish_pending(fake, tasks, starting, fake.gate)
                self.assertEqual([call[1] for call in fake.calls], ["turn_off", "turn_on", "turn_off"])
        asyncio.run(go())

    def test_unload_during_initial_save_cannot_send_a_new_turn_on(self):
        async def go():
            fake = LifecycleFake()
            fake.save_gate = asyncio.Event()
            tasks = fake.make()
            starting = self.start(tasks)
            await fake.entered_save.wait()
            result = await self.finish_pending(fake, tasks, starting, fake.save_gate)
            self.assertIsNone(result)
            self.assertNotIn("turn_on", [call[1] for call in fake.calls])
        asyncio.run(go())

    def test_closed_instance_refuses_a_new_start(self):
        async def go():
            fake = LifecycleFake()
            tasks = fake.make()
            tasks.unload()
            with self.assertRaises(ValueError):
                await tasks.start("dehumidify", "vannaia", base.VENT, base.HUM)
            self.assertEqual((fake.calls, tasks.summary()), ([], []))
        asyncio.run(go())

    def test_entry_reload_waits_for_start_before_next_instance_can_load(self):
        async def go():
            integration = base.load_integration()[0]
            fake = LifecycleFake()
            fake.gate, fake.gate_only = asyncio.Event(), "turn_on"
            tasks = fake.make()
            starting = self.start(tasks)
            await fake.entered_on.wait()
            hass = NS(data={integration.DOMAIN: {"entry": {"air_tasks": tasks}}})
            entry = NS(entry_id="entry", disabled_by=None)
            unloading = asyncio.create_task(integration.async_unload_entry(hass, entry))
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            finished_before_start = unloading.done()
            fake.gate.set()
            await asyncio.gather(starting, unloading)
            self.assertFalse(finished_before_start, "a reload/removal must not overtake the old turn_on")
            self.assertFalse(fake.removed, "reload keeps the persisted job for its successor")
            self.assertEqual([call[1] for call in fake.calls], ["turn_on"])
            self.assertEqual([job["device"] for job in fake.stored["jobs"]], [base.VENT])
            self.assertEqual((fake.listeners, fake.timers), ([], []))
            await fake.make().async_remove()
            self.assertEqual(fake.states_map[base.VENT], "off", "fresh-instance removal is now after the old start")
        asyncio.run(go())

    def test_hung_start_times_out_before_removal_finishes(self):
        async def go():
            fake = LifecycleFake()
            fake.hang.add("turn_on")
            tasks = fake.make()
            old_timeout, base.air.CALL_SECONDS = base.air.CALL_SECONDS, 0.01
            try:
                starting = self.start(tasks)
                await fake.entered_on.wait()
                tasks.unload()
                result = await asyncio.wait_for(asyncio.gather(starting, tasks.async_remove(), return_exceptions=True), 1)
                self.assertIsInstance(result[0], asyncio.TimeoutError)
                self.assertIsNone(result[1])
                self.assertEqual([call[1] for call in fake.calls], ["turn_off"])
                self.assertEqual(fake.history[-1], ("remove", "off"))
                self.assertEqual((fake.listeners, fake.timers), ([], []))
            finally:
                base.air.CALL_SECONDS = old_timeout
        asyncio.run(go())

    def test_cancelled_start_that_may_have_obeyed_is_stopped_before_removal(self):
        class CancelledServiceFake(LifecycleFake):
            async def _call(self, domain, service, data, blocking=False, context=None):
                if service != "turn_on":
                    return await super()._call(domain, service, data, blocking, context)
                self.entered_on.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    self.states_map[data["entity_id"]] = "on"  # cancellation is not proof the relay ignored the command
                    self.calls.append((domain, service, data["entity_id"]))
                    self.history.append((service, "on"))
                    raise

        async def go():
            fake = CancelledServiceFake()
            tasks = fake.make()
            starting = self.start(tasks)
            await fake.entered_on.wait()
            tasks.unload()
            removing = asyncio.create_task(tasks.async_remove())
            await asyncio.sleep(0)
            starting.cancel()
            result = await asyncio.wait_for(asyncio.gather(starting, removing, return_exceptions=True), 1)
            self.assertIsInstance(result[0], asyncio.CancelledError)
            self.assertIsNone(result[1])
            self.assertEqual([call[1] for call in fake.calls], ["turn_on", "turn_off"])
            self.assertEqual(fake.history[-1], ("remove", "off"))
            self.assertEqual((fake.listeners, fake.timers), ([], []))
        asyncio.run(go())

    def test_removal_waits_for_every_device_start(self):
        async def go():
            fake = LifecycleFake()
            other = "fan.office_vent"
            fake.states_map[other] = "off"
            fake.gate, fake.gate_only = asyncio.Event(), "turn_on"
            tasks = fake.make()
            first = self.start(tasks)
            second = asyncio.create_task(tasks.start("dehumidify", "office", other, base.HUM))
            await fake.entered_on.wait()
            tasks.unload()
            removing = asyncio.create_task(tasks.async_remove())
            await asyncio.sleep(0)
            fake.gate.set()
            await asyncio.gather(first, second, removing)
            self.assertEqual((fake.states_map[base.VENT], fake.states_map[other]), ("off", "off"))
            for device in (base.VENT, other):
                self.assertEqual([call[1] for call in fake.calls if call[2] == device], ["turn_on", "turn_off"])
            self.assertEqual(fake.history[-1], ("remove", "off"))
            self.assertEqual((fake.listeners, fake.timers), ([], []))
        asyncio.run(go())


if __name__ == "__main__":
    unittest.main()
