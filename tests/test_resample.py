"""Temporary fixtures only; installed plugins are tested separately with `probe`."""
import importlib.util
from contextlib import redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('resample', Path(__file__).resolve().parents[1] / 'scripts/resample.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
try:
    import numpy as np
except ImportError:
    np = None


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def save(self, value=b'first'):
        class Plugin:
            name = 'Test plugin'
            raw_state = value
        with r.registry_lock(self.root):
            return r.save_chain(self.root, r.read_registry(self.root), 'test',
                                [{'plugin': '/not-installed.vst3'}], [Plugin()])

    def test_revisions_preserve_old_states_and_created_at(self):
        first = self.save()
        second = self.save(b'second')
        self.assertNotEqual(first['revision'], second['revision'])
        self.assertEqual(first['created_at'], second['created_at'])
        self.assertEqual(r.state_file(self.root, first['plugins'][0]).read_bytes(), b'first')
        self.assertEqual(r.get_chain(self.root, 'test'), second)

    def test_missing_or_corrupt_state_never_falls_back_to_defaults(self):
        entry = self.save()['plugins'][0]
        path = r.state_file(self.root, entry)
        path.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            r.state_file(self.root, entry)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            r.state_file(self.root, entry)

    def test_state_cannot_escape_workspace(self):
        with self.assertRaisesRegex(ValueError, 'inside'):
            r.state_file(self.root, {'state': '../outside.bin'})

    def test_failed_registry_switch_keeps_previous_revision(self):
        first = self.save()
        with patch.object(r, 'write_json', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.save(b'new')
        self.assertEqual(r.get_chain(self.root, 'test'), first)

    def test_exclusive_atomic_publication_and_lock(self):
        path = self.root / 'output.wav'
        r.atomic_bytes(path, b'original', overwrite=False)
        with self.assertRaises(FileExistsError):
            r.atomic_bytes(path, b'replacement', overwrite=False)
        self.assertEqual(path.read_bytes(), b'original')
        self.assertEqual(list(self.root.glob('.resample-*')), [])
        with r.registry_lock(self.root):
            with self.assertRaisesRegex(ValueError, 'Another'):
                with r.registry_lock(self.root):
                    pass

    def test_output_mapping_and_nested_output_rejection(self):
        source = self.root / 'input'
        source.mkdir()
        for name in ('kick.wav', 'kick.aif'):
            (source / name).touch()
        plan = r.plan_render(source, self.root / 'output', ['a b', 'a_b', 'A B'], False)
        self.assertEqual(len({str(dest).casefold() for _, _, dest in plan}), 6)
        self.assertEqual({dest.name for _, _, dest in plan}, {'kick.wav.wav', 'kick.aif.wav'})
        with self.assertRaisesRegex(ValueError, 'outside'):
            r.plan_render(source, source / 'renders', ['a'], True)

    def test_case_insensitive_collision_is_rejected(self):
        # Linux can represent both; macOS default filesystems cannot, so inject discovery.
        source = self.root / 'input'
        source.mkdir()
        a, b = source / 'Kick.wav', source / 'kick.wav'
        with patch.object(Path, 'glob', return_value=iter([a, b])), patch.object(Path, 'is_file', lambda p: p != source):
            with self.assertRaisesRegex(ValueError, 'collision'):
                r.plan_render(source, self.root / 'output', ['chain'], False)

    def test_single_file_mapping(self):
        source = self.root / 'input.wav'
        source.touch()
        self.assertEqual(r.plan_render(source, self.root / 'output', ['chain'], False)[0][1], source)

    def test_crashed_worker_does_not_stop_next_job(self):
        self.save()
        source = self.root / 'input'
        source.mkdir()
        for name in ('a.wav', 'b.wav'):
            (source / name).write_bytes(b'fixture')
        args = r.parser().parse_args(['--workspace', str(self.root), 'render', str(source), str(self.root / 'out')])
        calls = []

        def worker(command, **kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(command, -11)

        with patch.object(r.subprocess, 'run', side_effect=worker), patch.object(r, 'environment', return_value={}):
            with self.assertRaisesRegex(ValueError, '2 render'):
                r.cmd_render(args)
        self.assertEqual(len(calls), 2)
        manifest = json.loads(next((self.root / 'jobs').glob('*/manifest.json')).read_text())
        self.assertEqual([j['result']['status'] for j in manifest['jobs']], ['failed', 'failed'])
        self.assertIn('finished_at', manifest)

    def test_timeout_is_recorded_and_existing_output_is_skipped(self):
        self.save()
        source = self.root / 'input.wav'
        source.write_bytes(b'fixture')
        output = self.root / 'out'
        dest = r.plan_render(source, output, ['test'], False)[0][2]
        args = r.parser().parse_args(['--workspace', str(self.root), 'render', str(source), str(output)])
        with patch.object(r, 'environment', return_value={}), patch.object(r.subprocess, 'run', side_effect=subprocess.TimeoutExpired('worker', 1)):
            with self.assertRaisesRegex(ValueError, '1 render'):
                r.cmd_render(args)
        dest.parent.mkdir(parents=True)
        dest.write_bytes(b'existing')
        with patch.object(r, 'environment', return_value={}), patch.object(r.subprocess, 'run') as worker:
            r.cmd_render(args)
            worker.assert_not_called()
        self.assertEqual(dest.read_bytes(), b'existing')


class SessionTests(unittest.TestCase):
    setUp = StorageTests.setUp
    # Exercise the command boundary with fake native plugins; no GUI/devices in CI.
    def session(self, command, choices, fail=False):
        class Plugin:
            name = 'Test effect'
            raw_state = b'initial'
            def show_editor(self, close_event=None):
                if fail:
                    raise RuntimeError('editor failure')
                self.raw_state += b'-edited'
        class Player:
            failed = None
            def __init__(self, *args):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def check(self):
                pass
        module = types.SimpleNamespace(Pedalboard=lambda plugins: plugins, load_plugin=lambda *a, **k: Plugin())
        args = r.parser().parse_args(['--workspace', str(self.root), command, 'session'] +
                                   (['/test.vst3'] if command == 'capture' else []) + ['--audio', '/test.wav'])
        with patch.dict(sys.modules, {'pedalboard': module}), patch.object(r, 'loop_source', return_value=(None, 44100)), \
                patch.object(r, 'plugin_entry', return_value={'plugin': '/test.vst3', 'plugin_name': None, 'plugin_version': None}), \
                patch.object(r, 'prepare_plugin'), patch.object(r, 'load_entry', return_value=Plugin()), \
                patch.object(r, 'LoopPlayer', Player), patch('builtins.input', side_effect=choices), redirect_stdout(io.StringIO()):
            r.cmd_capture_edit(args)

    def test_capture_reopen_save_then_edit_discard(self):
        self.session('capture', ['1', 's'])
        chain = r.get_chain(self.root, 'session')
        self.assertEqual(r.state_file(self.root, chain['plugins'][0]).read_bytes(), b'initial-edited-edited')
        self.session('edit', ['q'])
        self.assertEqual(r.get_chain(self.root, 'session'), chain)

    def test_discard_and_editor_failure_do_not_publish_chain(self):
        self.session('capture', ['q'])
        self.assertEqual(r.read_registry(self.root)['chains'], {})
        with self.assertRaisesRegex(RuntimeError, 'editor failure'):
            self.session('capture', [], fail=True)
        self.assertEqual(r.read_registry(self.root)['chains'], {})


@unittest.skipIf(np is None, 'Install scripts/requirements-resample.txt for DSP tests')
class ProcessingTests(unittest.TestCase):
    def test_tail_trim_floor_and_mono_policy(self):
        audio = np.ones((1, 100), dtype=np.float32) * .1
        identity = lambda a, sr, reset: a
        out = r.process(identity, audio, 100, 1, -70, None, 'stereo')
        self.assertEqual(out.shape, (2, 100))
        out = r.process(identity, audio, 100, 1, None, None, 'preserve')
        self.assertEqual(out.shape, (1, 200))

    def test_tail_above_threshold_is_kept_and_normalization_hits_target(self):
        def reverb(a, sr, reset):
            a[:, 120:150] = .2
            return a
        out = r.process(reverb, np.ones((2, 100), dtype=np.float32) * .1, 100, 1, -70, -1, 'stereo')
        self.assertEqual(out.shape, (2, 150))
        self.assertAlmostEqual(float(np.max(np.abs(out))), 10 ** (-1 / 20), places=6)

    def test_silence_normalizes_without_nan_and_bad_audio_fails(self):
        identity = lambda a, sr, reset: a
        out = r.process(identity, np.zeros((1, 100), dtype=np.float32), 100, 0, -70, -1, 'preserve')
        self.assertTrue(np.isfinite(out).all())
        for audio in (np.zeros((2, 0)), np.zeros((3, 10)), np.full((1, 10), np.nan)):
            with self.assertRaises(ValueError):
                r.process(identity, audio, 100, 0, None, None, 'preserve')
        with self.assertRaisesRegex(ValueError, 'non-finite'):
            r.process(lambda a, sr, reset: a * np.nan, np.ones((1, 10)), 100, 0, None, None, 'preserve')

    def test_configured_plugins_are_never_reset_during_render(self):
        def configured_board(audio, sr, reset):
            self.assertFalse(reset, 'reset=True discards restored Decapitator AU settings')
            return audio * .5
        out = r.process(configured_board, np.ones((2, 100)), 48000, 0, None, None, 'stereo')
        self.assertEqual(float(out.max()), .5)

    def test_truncated_plugin_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'truncated'):
            r.process(lambda a, sr, reset: a[:, :1], np.ones((1, 10)), 100, 0, None, None, 'preserve')

    def test_loop_wrap_keeps_effect_state_and_monitor_gain_is_only_for_output(self):
        import types
        writes, resets = [], []
        player = r.LoopPlayer(None, np.ones((1, 3000), dtype=np.float32), 44100, 'test', -6)

        def board(audio, sr, reset):
            resets.append(reset)
            return audio * 4

        class Stream:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
            def __enter__(self):
                return self
            def __exit__(self, *exc):
                pass
            def write(self, audio, sr):
                writes.append(audio)
                if len(writes) == 3:
                    player.stop.set()

        player.board = board
        with patch.dict(sys.modules, {'pedalboard.io': types.SimpleNamespace(AudioStream=Stream)}):
            player.run()
        player.check()
        self.assertEqual(resets, [False, False, False])
        self.assertEqual([a.shape for a in writes], [(2, 2048), (2, 952), (2, 2048)])
        self.assertLessEqual(float(np.max(writes[0])), .981)
        self.assertEqual(float(player.audio.max()), 1)

    def test_loop_failure_signals_editor_close(self):
        import types
        class BrokenStream:
            def __init__(self, **kwargs):
                raise RuntimeError('missing device')
        player = r.LoopPlayer(None, np.ones((1, 10)), 44100, 'missing', -12)
        with patch.dict(sys.modules, {'pedalboard.io': types.SimpleNamespace(AudioStream=BrokenStream)}):
            player.run()
        self.assertTrue(player.failed.is_set())
        self.assertTrue(player.ready.is_set())
        with self.assertRaisesRegex(RuntimeError, 'missing device'):
            player.check()


class CLITests(unittest.TestCase):
    def test_bad_numeric_settings_are_rejected(self):
        for setting in (['--tail', '-1'], ['--tail', 'nan'], ['--normalize', '1'], ['--timeout', '0']):
            with self.subTest(setting=setting), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                r.parser().parse_args(['render', 'in', 'out'] + setting)

    def test_capture_requires_audition_audio(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            r.parser().parse_args(['capture', 'test', '/example.vst3'])


if __name__ == '__main__':
    unittest.main()
