import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import ableton
import ableton_branch as branch


class BranchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.library = self.root / 'Ableton'
        self.project = self.library / 'Song Project'
        self.project.mkdir(parents=True)
        self.parent = self.project / 'original.als'
        self.original = gzip.compress(b'<Ableton><LiveSet><Tracks/></LiveSet></Ableton>')
        self.parent.write_bytes(self.original)
        self.registry_file = self.root / 'registry.json'
        self.snapshots = self.root / 'snapshots'
        self.registry = {'schema_version': 1, 'sets': []}
        results = [{'source_path': ableton.path_key(self.parent), **ableton.analyze_set(self.parent)}]
        ableton.assign_ids(results, self.registry)
        self.parent_id = results[0]['set_id']
        ableton.save_registry(self.registry_file, self.registry)

    def create(self, name='Alternate ending', parent=None):
        return branch.make_branch(self.registry, self.registry_file, self.snapshots,
                                  self.library, parent or self.parent_id, name)

    def test_branch_copies_saved_bytes_and_captures_exact_origin(self):
        # Parent was edited since the registry was scanned.
        self.parent.write_bytes(gzip.compress(b'<Ableton><LiveSet><Tracks/><NewState/></LiveSet></Ableton>'))
        child = self.create()
        target = Path(child['paths'][-1]).expanduser()
        self.assertEqual(target.read_bytes(), self.parent.read_bytes())
        self.assertNotEqual(child['id'], self.parent_id)
        self.assertEqual(child['parent_set_id'], self.parent_id)
        report = json.loads((self.snapshots / child['branch_origin']['snapshot_file']).read_text())
        self.assertEqual(report['event'], 'branch')
        self.assertEqual(child['created_at'], child['branched_at'])
        self.assertEqual(report['created_at'], child['created_at'])
        self.assertEqual(len(report['sets']), 2)
        self.assertEqual(report['sets'][0]['source_sha256'], child['branch_origin']['source_sha256'])
        self.assertEqual(report['sets'][0]['xml_sha256'], report['sets'][1]['xml_sha256'])
        self.assertEqual(len(json.loads(self.registry_file.read_text())['sets']), 2)
        created_at = child['created_at']
        results = [{'source_path': ableton.path_key(p), **ableton.analyze_set(p)} for p in [self.parent, target]]
        ableton.assign_ids(results, self.registry)
        self.assertEqual(results[1]['set_id'], child['id'])
        self.assertEqual(self.registry['sets'][1]['created_at'], created_at)
        self.assertEqual(ableton.changed_sets(results, self.snapshots), [])

    def test_branch_of_branch_and_catalog(self):
        first = self.create()
        second = self.create('Another direction', first['id'])
        self.assertEqual(second['parent_set_id'], first['id'])
        catalog = branch.catalog(self.registry, self.snapshots)
        self.assertEqual(len(catalog), 3)
        self.assertTrue(all(r['available'] for r in catalog))
        self.assertTrue(all(r['analysis'] is not None for r in catalog))

    def test_new_idea_has_unassigned_project_identity_timestamp_and_snapshot(self):
        template = self.root / 'blank.als'
        template.write_bytes(self.original)
        row = branch.new_idea(self.registry, self.registry_file, self.snapshots,
                              self.library, template, 'Rain on the roof')
        target = Path(row['paths'][-1]).expanduser()
        self.assertEqual(target.read_bytes(), self.original)
        project_file = self.registry_file.parent / 'projects' / (row['project_id'] + '.md')
        project = json.loads(project_file.read_text().split('---')[1])
        self.assertIsNone(project['song'])
        self.assertEqual(project['created_at'], row['created_at'])
        self.assertEqual(project['sets'], [target.name])
        report = json.loads(next(self.snapshots.glob('*.json')).read_text())
        self.assertEqual(report['sets'][0]['set_id'], row['id'])
        self.assertEqual(report['created_at'], row['created_at'])
        with self.assertRaises(ValueError):
            branch.new_idea(self.registry, self.registry_file, self.snapshots,
                            self.library, template, 'Rain on the roof')
        child = self.create('Alternate idea', row['id'])
        self.assertEqual(child['project_id'], row['project_id'])

    def test_new_ideas_get_unique_date_ids_and_persistent_records(self):
        template = self.root / 'blank.als'
        template.write_bytes(self.original)
        rows = [branch.new_idea(self.registry, self.registry_file, self.snapshots,
                               self.library, template) for _ in range(2)]
        names = [Path(row['paths'][-1]).stem for row in rows]
        self.assertNotEqual(*names)
        for row, name in zip(rows, names):
            self.assertRegex(name, r'^idea-\d{8}-[a-f0-9]{12}$')
            idea = json.loads((self.root / 'ideas' / (name + '.md')).read_text().split('---')[1])
            self.assertEqual(idea['project_id'], row['project_id'])
            self.assertEqual(idea['created_at'], row['created_at'])
            self.assertIsNone(idea['song'])

    def test_new_idea_rolls_back_on_registry_failure_and_rejects_unsafe_names(self):
        template = self.root / 'blank.als'
        template.write_bytes(self.original)
        for name in ['../escape', '.hidden', 'bad/name', 'bad\nname', '']:
            with self.assertRaises(ValueError):
                branch.new_idea(self.registry, self.registry_file, self.snapshots,
                                self.library, template, name)
        with patch.object(branch, 'save_registry', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                branch.new_idea(self.registry, self.registry_file, self.snapshots,
                                self.library, template, 'Rollback')
        self.assertFalse((self.library / 'Rollback Project').exists())
        self.assertEqual(list((self.root / 'projects').glob('*.md')), [])
        self.assertEqual(list(self.snapshots.glob('*.json')), [])
        self.assertEqual(list((self.root / 'ideas').glob('*.md')), [])
        self.assertEqual(len(self.registry['sets']), 1)

    def test_invalid_names_collisions_and_outside_library(self):
        for name in ['', '../escape', 'nested/name', '.hidden', 'bad:name', 'bad\nname', 'original']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.create(name)
        self.assertEqual(self.parent.read_bytes(), self.original)
        with self.assertRaises(ValueError):
            branch.make_branch(self.registry, self.registry_file, self.snapshots,
                               self.root / 'other', self.parent_id, 'Nope')
        self.assertEqual(len(self.registry['sets']), 1)

    def test_failure_rolls_back_created_files(self):
        with patch.object(branch, 'save_registry', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.create()
        self.assertFalse((self.project / 'Alternate ending.als').exists())
        self.assertEqual(list(self.snapshots.glob('*.json')), [])
        self.assertEqual(len(json.loads(self.registry_file.read_text())['sets']), 1)

    def test_archive_preserves_files_history_and_lineage_and_can_restore(self):
        child = self.create()
        before = {p.name: p.read_bytes() for p in self.snapshots.glob('*.json')}
        archived = branch.archive_set(self.registry, self.registry_file, child['id'])
        self.assertTrue(archived['archived_at'])
        self.assertEqual(archived['parent_set_id'], self.parent_id)
        self.assertEqual(Path(child['paths'][-1]).expanduser().read_bytes(), self.original)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.snapshots.glob('*.json')})
        with self.assertRaises(ValueError):
            self.create('Not while archived', child['id'])
        restored = branch.archive_set(self.registry, self.registry_file, child['id'], restore=True)
        self.assertNotIn('archived_at', restored)
        self.assertEqual(self.create('After restoring', child['id'])['parent_set_id'], child['id'])


if __name__ == '__main__':
    unittest.main()
