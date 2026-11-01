import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "android_hierarchy", Path(__file__).resolve().parents[1] / "scripts/read-android-hierarchy.py"
)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class FakeDevice:
    def __init__(self, xml):
        self.xml = xml
        self.jsonrpc = self
        self.settings = None
        self.stopped = False

    def setConfigurator(self, config, **_kwargs):
        self.settings = config

    def dump_hierarchy(self, **kwargs):
        assert kwargs == {'compressed': False, 'max_depth': 80, 'root_in_active': True}
        return self.xml

    def stop_uiautomator(self, wait=True):
        assert not wait
        self.stopped = True


class AndroidHierarchyTests(unittest.TestCase):
    def test_reads_without_idle_wait_and_releases_owned_server(self):
        xml = '<hierarchy><node text="Next" /></hierarchy>'
        device = FakeDevice(xml)
        self.assertEqual(reader.read_hierarchy('127.0.0.1:5555', 4, lambda _: device), xml)
        self.assertEqual(device.settings, {'waitForIdleTimeout': 0, 'waitForSelectorTimeout': 0})
        self.assertTrue(device.stopped)

    def test_invalid_empty_and_entity_trees_fail_closed_with_cleanup(self):
        for xml in ['', '<hierarchy/>', '<wrong><node /></wrong>', '<hierarchy><node>',
                    '<!DOCTYPE hierarchy><hierarchy><node /></hierarchy>']:
            device = FakeDevice(xml)
            with self.assertRaises(Exception):
                reader.read_hierarchy('127.0.0.1:5555', 4, lambda _: device)
            self.assertTrue(device.stopped)

    def test_connection_not_used_for_invalid_input(self):
        def connect(_):
            self.fail('must not connect')
        with self.assertRaises(ValueError):
            reader.read_hierarchy('invalid;device', 4, connect)
        for timeout in [0, -1, float('inf'), float('nan'), 301]:
            with self.assertRaises(ValueError):
                reader.read_hierarchy('127.0.0.1:5555', timeout, connect)


if __name__ == '__main__':
    unittest.main()
