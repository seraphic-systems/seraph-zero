import gzip
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("ableton", Path(__file__).resolve().parents[1] / "scripts/ableton.py")
ableton = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ableton)


def plugin(tag="VstPluginInfo", name="Example", on="true"):
    return (f'<PluginDevice><On><Manual Value="{on}"/></On><PluginDesc>'
            f'<{tag}><PlugName Value="{name}"/><UniqueId Value="123"/></{tag}>'
            '</PluginDesc></PluginDevice>')


class AbletonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def analyze(self, body, compressed=True):
        source = self.root / "test.als"
        xml = f'<Ableton Creator="Ableton Live test"><LiveSet>{body}</LiveSet></Ableton>'.encode()
        source.write_bytes(gzip.compress(xml) if compressed else xml)
        return ableton.analyze_set(source)

    def test_instances_nested_repeated_disabled_and_formats(self):
        body = ('<Devices><Eq8/>' + plugin() + '<AudioEffectGroupDevice><Branches>'
                + plugin(on="false") + plugin("Vst3PluginInfo", "Other")
                + plugin("AuPluginInfo", "AU Example") + '</Branches></AudioEffectGroupDevice></Devices>')
        result = self.analyze(body)
        self.assertEqual(result["external_plugin_instances"], 4)
        self.assertEqual(result["distinct_plugins"], 3)
        self.assertEqual(result["instances_by_format"], {"AU": 1, "VST2": 2, "VST3": 1})
        self.assertEqual(result["warnings"], [])

    def test_unknown_descriptor_not_silently_dropped(self):
        result = self.analyze(plugin("FuturePluginInfo") + '<PluginDevice/>')
        self.assertEqual(result["external_plugin_instances"], 2)
        self.assertEqual(len(result["warnings"]), 2)

    def test_project_bpm_uses_main_or_master_track_not_scene_or_device_tempo(self):
        for track in ("MainTrack", "MasterTrack"):
            for tempo in ("120", "123.5"):
                with self.subTest(track=track, tempo=tempo):
                    result = self.analyze(
                        '<Scenes><Scene><Tempo Value="90"/></Scene></Scenes>'
                        '<Tracks><MidiTrack><Tempo><Manual Value="80"/></Tempo></MidiTrack></Tracks>'
                        f'<{track}><DeviceChain><Mixer><Tempo><Manual Value="{tempo}"/>'
                        f'</Tempo></Mixer></DeviceChain></{track}>')
                    self.assertEqual(result['bpm'], float(tempo))
                    self.assertEqual(result['warnings'], [])

    def test_missing_or_invalid_bpm_does_not_fail_plugin_analysis(self):
        self.assertIsNone(self.analyze('<Scenes><Scene><Tempo Value="90"/></Scene></Scenes>')['bpm'])
        for tempo in ('', 'invalid', 'NaN', 'Infinity', '-1', '0'):
            with self.subTest(tempo=tempo):
                result = self.analyze(plugin() + '<MainTrack><DeviceChain><Mixer><Tempo>'
                                      f'<Manual Value="{tempo}"/></Tempo></Mixer></DeviceChain></MainTrack>')
                self.assertIsNone(result['bpm'])
                self.assertEqual(result['external_plugin_instances'], 1)
                self.assertTrue(result['warnings'])

    def test_snapshot_saves_bpm_and_upgrades_previous_analysis_once(self):
        self.analyze('<MainTrack><DeviceChain><Mixer><Tempo><Manual Value="123.5"/>'
                     '</Tempo></Mixer></DeviceChain></MainTrack>')
        self.scan()
        saved = next((self.root / 'snapshots').glob('*.json'))
        old = json.loads(saved.read_text())
        self.assertEqual(old['sets'][0]['bpm'], 123.5)
        old['analyzer_version'] = 1
        del old['sets'][0]['bpm']
        saved.write_text(json.dumps(old))
        previous = saved.read_bytes()
        self.scan()
        self.assertEqual(saved.read_bytes(), previous)
        self.assertEqual(len(self.snapshots()), 2)
        self.assertEqual(self.snapshots()[-1]['sets'][0]['bpm'], 123.5)
        self.scan()
        self.assertEqual(len(self.snapshots()), 2)

    def test_empty_plain_xml_and_hash_changes(self):
        first = self.analyze('<Devices><Eq8/></Devices>', compressed=False)
        self.assertEqual(first["external_plugin_instances"], 0)
        second = self.analyze(plugin(), compressed=False)
        self.assertNotEqual(first["source_sha256"], second["source_sha256"])

    def test_discovery_excludes_backups_but_explicit_backup_allowed(self):
        (self.root / "Backup").mkdir()
        backup = self.root / "Backup" / "old.als"
        backup.touch()
        current = self.root / "current.als"
        current.touch()
        self.assertEqual(ableton.discover_sets(self.root), [current])
        self.assertEqual(ableton.discover_sets(backup), [backup])

    def test_invalid_document_is_an_error(self):
        source = self.root / "bad.als"
        for content in [b'<NotAbleton/>', b'<!DOCTYPE Ableton><Ableton><LiveSet/></Ableton>']:
            source.write_bytes(content)
            with self.assertRaises(ValueError):
                ableton.analyze_set(source)

    def test_cli_keeps_snapshots_and_reports_partial_failure(self):
        self.analyze(plugin())
        snapshots = self.root / "snapshots"
        command = [sys.executable, str(Path(ableton.__file__)), str(self.root),
                   "--registry", str(self.root / 'registry.json'),
                   "--snapshot", str(snapshots), "--json"]
        for _ in range(2):
            run = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(len(json.loads(run.stdout)["sets"]), 1)
        self.assertEqual(len(list(snapshots.glob('*.json'))), 1)
        (self.root / "bad.als").write_text("invalid XML")
        run = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(len(json.loads(run.stdout)["errors"]), 1)

    def scan(self, *extra):
        run = subprocess.run([sys.executable, str(Path(ableton.__file__)), str(self.root),
                              '--registry', str(self.root / 'registry.json'),
                              '--snapshot', str(self.root / 'snapshots'), '--json', *extra],
                             capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout)

    def snapshots(self):
        return [json.loads(p.read_text()) for p in sorted((self.root / 'snapshots').glob('*.json'))]

    def test_identity_survives_edits_and_unchanged_counts_still_snapshot(self):
        self.analyze(plugin())
        first = self.scan()['sets'][0]
        registry = json.loads((self.root / 'registry.json').read_text())
        created_at = registry['sets'][0]['created_at']
        self.assertTrue(created_at)
        self.assertEqual(self.snapshots()[0]['created_at'], self.snapshots()[0]['analyzed_at'])
        self.scan()
        self.assertEqual(json.loads((self.root / 'registry.json').read_text())['sets'][0]['created_at'], created_at)
        self.assertEqual(len(self.snapshots()), 1)
        self.analyze(plugin(name='Different'))
        second = self.scan()['sets'][0]
        self.assertEqual(first['set_id'], second['set_id'])
        self.assertEqual(first['external_plugin_instances'], second['external_plugin_instances'])
        self.assertEqual(len(self.snapshots()), 2)
        self.analyze(plugin())  # Reverting to an older state is a new event.
        self.scan()
        self.assertEqual(len(self.snapshots()), 3)

    def test_rename_keeps_id_and_copy_gets_separate_identity(self):
        self.analyze(plugin())
        first = self.scan()['sets'][0]
        renamed = self.root / 'renamed.als'
        (self.root / 'test.als').rename(renamed)
        second = self.scan()['sets'][0]
        self.assertEqual(first['set_id'], second['set_id'])
        self.assertEqual(len(self.snapshots()), 1)
        (self.root / 'copy.als').write_bytes(renamed.read_bytes())
        results = self.scan()['sets']
        self.assertEqual(len({r['set_id'] for r in results}), 2)
        self.assertEqual(len(self.snapshots()[-1]['sets']), 1)

    def test_gzip_metadata_does_not_make_duplicate_snapshot(self):
        self.analyze(plugin(), compressed=False)
        first = self.scan()['sets'][0]
        source = self.root / 'test.als'
        source.write_bytes(gzip.compress(source.read_bytes()))
        second = self.scan()['sets'][0]
        self.assertNotEqual(first['source_sha256'], second['source_sha256'])
        self.assertEqual(first['xml_sha256'], second['xml_sha256'])
        self.assertEqual(len(self.snapshots()), 1)

    def test_explicit_rename_plus_edits_preserves_history(self):
        self.analyze(plugin())
        first = self.scan()['sets'][0]
        old = self.root / 'test.als'
        new = self.root / 'renamed.als'
        old.rename(new)
        # Edit the XML, not just the compressed wrapper.
        new.write_bytes(gzip.compress(gzip.decompress(new.read_bytes()).replace(b'Example', b'Edited')))
        second = self.scan('--relink', str(old), str(new))['sets'][0]
        self.assertEqual(first['set_id'], second['set_id'])
        self.assertEqual(len(self.snapshots()), 2)

    def test_ambiguous_identical_moves_are_not_merged(self):
        self.analyze(plugin())
        first = self.scan()['sets'][0]
        source = self.root / 'test.als'
        content = source.read_bytes()
        source.unlink()
        for name in ['one.als', 'two.als']:
            (self.root / name).write_bytes(content)
        results = self.scan()['sets']
        self.assertEqual(len({r['set_id'] for r in results}), 2)
        self.assertNotIn(first['set_id'], [r['set_id'] for r in results])

    def test_analysis_upgrade_and_bad_history(self):
        self.analyze(plugin())
        self.scan()
        results = self.scan()['sets']
        directory = self.root / 'snapshots'
        previous = ableton.ANALYZER_VERSION
        try:
            ableton.ANALYZER_VERSION += 1
            self.assertEqual(ableton.changed_sets(results, directory), results)
        finally:
            ableton.ANALYZER_VERSION = previous
        (directory / 'corrupt.json').write_text('invalid json')
        with self.assertRaises(ValueError):
            ableton.changed_sets(results, directory)


if __name__ == "__main__":
    unittest.main()
