#!/usr/bin/env python3
"""Exercise isolation, dependency failure, correction and compact context without any API."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('fleet', Path(__file__).resolve().parents[1] / 'scripts/improvement-fleet.py')
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)

FAKE_RELAY = r'''
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const val = name => args[args.indexOf(name) + 1];
const cwd = val('--cd'), out = val('--out-dir');
const task = path.basename(path.dirname(cwd));
fs.mkdirSync(out, { recursive: true });
if (task === 'rogue') fs.writeFileSync(path.join(cwd, 'input.txt'), 'tampered');
if (task !== 'retry' || args.includes('--session')) {
  fs.writeFileSync(path.join(cwd, 'answer.json'), JSON.stringify({value: 0.5}));
}
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({status:'completed',exitCode:0,
  sessionId:'ses_fixture',finalMessage:'x'.repeat(100000)}));
'''


class FleetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'input.txt').write_text('source')
        (self.root / '.env').write_text('SECRET_CANARY_DO_NOT_COPY')
        self.relay = self.root / 'fake-relay.mjs'
        self.relay.write_text(FAKE_RELAY)
        self.run = self.root / 'runs'
        self.run.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def task(self, name, **extra):
        return {'id': name, 'model': 'nvidia/nvidia/nemotron-3.5-lightning-30b-a3b',
                'objective': 'Produce the artifact', 'inputs': ['input.txt'],
                'outputs': [{'path': 'answer.json', 'kind': 'json', 'required_keys': ['value'],
                             'numeric_ranges': {'value': [0, 1]}}], **extra}

    def manifest(self, tasks):
        path = self.root / 'manifest.json'
        path.write_text(json.dumps({'tasks': tasks}))
        return fleet.load_manifest(path, self.root)

    def test_reject_paths_credentials_symlinks_and_provider(self):
        for name in ['../input.txt', '/etc/passwd', '.env', 'x/auth.json', 'token.key']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                fleet.relative(name)
        (self.root / 'linked.txt').symlink_to(self.root / '.env')
        with self.assertRaises(ValueError):
            self.manifest([self.task('one', inputs=['linked.txt'])])
        with self.assertRaises(ValueError):
            self.manifest([self.task('one', model='openrouter/free')])

    def test_reject_secret_inside_innocent_filename_and_dependency_cycle(self):
        (self.root / 'notes.txt').write_text('nvapi-' + 'a' * 25)
        with self.assertRaises(ValueError):
            self.manifest([self.task('one', inputs=['notes.txt'])])
        with self.assertRaises(ValueError):
            self.manifest([self.task('one', depends_on=['two']), self.task('two', depends_on=['one'])])

    def test_parallel_candidates_copy_only_allowed_files_and_bound_report(self):
        tasks = self.manifest([self.task('one'), self.task('two')])
        results = fleet.dispatch(tasks, self.root, self.run, self.relay, 2)
        self.assertTrue(all(v['status'] == 'candidate' for v in results.values()))
        self.assertEqual((self.root / 'input.txt').read_text(), 'source')
        for name in ['one', 'two']:
            self.assertFalse((self.run / name / 'work/.env').exists())
            self.assertEqual((self.run / name / 'work/input.txt').read_text(), 'source')
        report = fleet.compact_report(results, self.run)
        self.assertLessEqual(len(report.encode()), 4096)
        self.assertNotIn('x' * 100, report)
        self.assertNotIn('SECRET_CANARY', report)

    def test_reject_scope_violation_and_skip_dependents(self):
        tasks = self.manifest([self.task('rogue'), self.task('later', depends_on=['rogue'])])
        results = fleet.dispatch(tasks, self.root, self.run, self.relay, 2)
        self.assertEqual(results['rogue']['status'], 'failed')
        self.assertEqual(results['later']['status'], 'skipped')
        self.assertFalse((self.run / 'later').exists())
        self.assertEqual((self.root / 'input.txt').read_text(), 'source')

    def test_one_correction_uses_exact_session(self):
        results = fleet.dispatch(self.manifest([self.task('retry', corrections=1)]), self.root, self.run, self.relay, 1)
        self.assertEqual(results['retry']['status'], 'candidate')
        self.assertEqual(results['retry']['attempts'], 2)
        self.assertEqual(results['retry']['sessionId'], 'ses_fixture')

    def test_nonfinite_and_oversized_artifact_rejected(self):
        work = self.run / 'sample'
        work.mkdir()
        task = self.task('one')
        (work / 'answer.json').write_text('{"value":NaN}')
        with self.assertRaises(ValueError):
            fleet.validate(work, {}, task)
        (work / 'answer.json').write_bytes(b'x' * (fleet.MAX_OUTPUT + 1))
        with self.assertRaises(ValueError):
            fleet.validate(work, {}, task)


if __name__ == '__main__':
    unittest.main()
