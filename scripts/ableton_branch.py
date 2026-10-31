"""Create explicit Live Set branches alongside their saved parent sets."""

import argparse
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import sys
import uuid

from ableton import (ANALYZER_VERSION, SCHEMA_VERSION, DEFAULT_REGISTRY,
                     analyze_bytes, path_key, save_registry)


def catalog(registry, snapshots):
    latest = {}
    for file in sorted(snapshots.glob('*.json')):
        report = json.loads(file.read_text())
        for result in report.get('sets', []):
            if 'set_id' not in result:
                continue
            if result['set_id'] not in latest or report['analyzed_at'] > latest[result['set_id']]['at']:
                latest[result['set_id']] = {'at': report['analyzed_at'], **result}
    return [{**record, 'name': Path(record['paths'][-1]).stem,
             'available': Path(record['paths'][-1]).expanduser().is_file(),
             'saved_at': datetime.fromtimestamp(Path(record['paths'][-1]).expanduser().stat().st_mtime, timezone.utc).isoformat() if Path(record['paths'][-1]).expanduser().is_file() else None,
             'analysis': latest.get(record['id'])} for record in registry['sets']]


def make_branch(registry, registry_file, snapshots, library, parent_id, name):
    if not isinstance(name, str):
        raise ValueError('Enter a branch name.')
    name = name.strip()
    if name.lower().endswith('.als'):
        name = name[:-4].strip()
    if not name or len(name) > 100 or name.startswith('.') or any(c in '/\\:' or ord(c) < 32 for c in name):
        raise ValueError('Use a name of 1–100 characters without slashes, colons, or a leading dot.')
    parent = next((r for r in registry['sets'] if r['id'] == parent_id), None)
    if parent is None:
        raise ValueError('Parent set not found. Refresh the set list.')
    if parent.get('archived_at'):
        raise ValueError('Restore this set before making a branch.')
    source = Path(parent['paths'][-1]).expanduser().resolve()
    library = library.expanduser().resolve()
    if not source.is_relative_to(library) or source.suffix.lower() != '.als':
        raise ValueError('Parent must be a Live Set inside the Ableton library.')
    raw = source.read_bytes()
    analysis = analyze_bytes(raw)
    target = source.parent / f'{name}.als'
    key = path_key(target)
    if target.exists() or any(key in r['paths'] for r in registry['sets']):
        raise ValueError('That name already exists in this project or its history. Choose another name.')
    now = datetime.now(timezone.utc)
    snapshot_name = now.strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:8] + '.json'
    child = {'id': str(uuid.uuid4()), 'paths': [key], 'xml_sha256': analysis['xml_sha256'],
             'created_at': now.isoformat(),
             'parent_set_id': parent_id, 'branched_at': now.isoformat(),
             'branch_origin': {'snapshot_file': snapshot_name,
                               'source_sha256': analysis['source_sha256'],
                               'xml_sha256': analysis['xml_sha256']}}
    for field in ['project_id', 'song']:
        if field in parent:
            child[field] = parent[field]
    rows = [{**analysis, 'set_id': identity, 'source_path': path_key(file),
             'set_path': file.relative_to(library).as_posix()}
            for identity, file in [(parent_id, source), (child['id'], target)]]
    report = {'schema_version': SCHEMA_VERSION, 'analyzer_version': ANALYZER_VERSION,
              'created_at': now.isoformat(), 'analyzed_at': now.isoformat(), 'source': path_key(library),
              'event': 'branch', 'parent_set_id': parent_id, 'child_set_id': child['id'],
              'sets': rows, 'errors': []}
    snapshots.mkdir(parents=True, exist_ok=True)
    snapshot_file = snapshots / snapshot_name
    # Exclusive creation: never overwrite an existing Live Set or history file.
    created_target = created_snapshot = False
    try:
        with target.open('xb') as output:
            created_target = True
            output.write(raw)
        with snapshot_file.open('x') as output:
            created_snapshot = True
            json.dump(report, output, indent=2)
            output.write('\n')
        updated = {**registry, 'sets': [{**r} for r in registry['sets']]}
        next(r for r in updated['sets'] if r['id'] == parent_id)['xml_sha256'] = analysis['xml_sha256']
        updated['sets'].append(child)
        save_registry(registry_file, updated)
        registry.update(updated)
    except Exception:
        if created_target:
            target.unlink(missing_ok=True)
        if created_snapshot:
            snapshot_file.unlink(missing_ok=True)
        raise
    return child


def new_idea(registry, registry_file, snapshots, library, template, name=None):
    """Create a persistent idea, project, set, registry identity and initial snapshot."""
    now = datetime.now(timezone.utc)
    idea_id = 'idea-' + now.strftime('%Y%m%d') + '-' + uuid.uuid4().hex[:12]
    if name is None:
        name = idea_id
    if not isinstance(name, str):
        raise ValueError('Invalid idea name.')
    name = name.strip()
    if not name or len(name) > 100 or name.startswith('.') or any(c in '/\\:' or ord(c) < 32 for c in name):
        raise ValueError('Use 1–100 characters without slashes, colons, or a leading dot.')
    raw = template.expanduser().read_bytes()
    analysis = analyze_bytes(raw)
    library = library.expanduser().resolve()
    library.mkdir(parents=True, exist_ok=True)
    folder = library / f'{name} Project'
    if folder.exists() or any(Path(p).expanduser().parent.resolve() == folder for row in registry['sets'] for p in row['paths']):
        raise ValueError('That project name already exists. Choose another name.')
    created_at = now.isoformat()
    identity = str(uuid.uuid4())
    project_id = 'idea-' + uuid.uuid4().hex[:12]
    target = folder / f'{name}.als'
    project_file = registry_file.parent / 'projects' / f'{project_id}.md'
    idea_file = registry_file.parent / 'ideas' / f'{idea_id}.md'
    snapshot_name = now.strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:8] + '.json'
    snapshot_file = snapshots / snapshot_name
    row = {'id': identity, 'project_id': project_id, 'created_at': created_at,
           'paths': [path_key(target)], 'xml_sha256': analysis['xml_sha256']}
    project = {'id': project_id, 'title': name, 'created_at': created_at, 'song': None,
               'root': 'ableton', 'folder': folder.name, 'main_set': target.name, 'sets': [target.name]}
    report = {'schema_version': SCHEMA_VERSION, 'analyzer_version': ANALYZER_VERSION,
              'created_at': created_at, 'analyzed_at': created_at, 'source': path_key(library),
              'event': 'new-idea', 'sets': [{**analysis, 'set_id': identity,
                  'source_path': path_key(target), 'set_path': target.relative_to(library).as_posix()}], 'errors': []}
    snapshots.mkdir(parents=True, exist_ok=True)
    project_file.parent.mkdir(parents=True, exist_ok=True)
    idea_file.parent.mkdir(parents=True, exist_ok=True)
    # Roll back only files created by this operation, never an existing project.
    created = []
    made_folder = False
    try:
        folder.mkdir()
        made_folder = True
        with target.open('xb') as output:
            created.append(target)
            output.write(raw)
        for file, content in [(idea_file, '---\n' + json.dumps({'id': idea_id, 'created_at': created_at, 'project_id': project_id, 'song': None}, indent=2) + '\n---\n'),
                              (project_file, '---\n' + json.dumps(project, indent=2) + '\n---\n'),
                              (snapshot_file, json.dumps(report, indent=2) + '\n')]:
            with file.open('x') as output:
                created.append(file)
                output.write(content)
        updated = {**registry, 'sets': [*registry['sets'], row]}
        save_registry(registry_file, updated)
        registry.update(updated)
    except Exception:
        for file in reversed(created):
            file.unlink(missing_ok=True)
        if made_folder:
            folder.rmdir()
        raise
    return row


def associate_song(registry, registry_file, set_id, song):
    record = next((r for r in registry['sets'] if r['id'] == set_id), None)
    if record is None:
        raise ValueError('Set not found. Refresh the set list.')
    # A set-level association is explicit; branches inherit it at creation.
    updated = {**registry, 'sets': [{**r, **({'song': song} if r['id'] == set_id else {})} for r in registry['sets']]}
    save_registry(registry_file, updated)
    registry.update(updated)
    return next(r for r in registry['sets'] if r['id'] == set_id)


def archive_set(registry, registry_file, set_id, restore=False):
    record = next((r for r in registry['sets'] if r['id'] == set_id), None)
    if record is None:
        raise ValueError('Set not found. Refresh the set list.')
    if restore:
        record.pop('archived_at', None)
    elif not record.get('archived_at'):
        record['archived_at'] = datetime.now(timezone.utc).isoformat()
    save_registry(registry_file, registry)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['list', 'create', 'new', 'associate', 'archive', 'restore'])
    parser.add_argument('--registry', type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument('--snapshots', type=Path, default=DEFAULT_REGISTRY.parent / 'set-snapshots')
    parser.add_argument('--library', type=Path, default=Path.home() / 'Ableton')
    parser.add_argument('--parent')
    parser.add_argument('--name')
    parser.add_argument('--set-id')
    parser.add_argument('--template', type=Path)
    parser.add_argument('--song')
    args = parser.parse_args()
    try:
        args.registry.parent.mkdir(parents=True, exist_ok=True)
        with args.registry.with_suffix(args.registry.suffix + '.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('Another scan or branch is running. Try again in a moment.')
            registry = json.loads(args.registry.read_text()) if args.registry.exists() else {'schema_version': 1, 'sets': []}
            if registry['schema_version'] != 1:
                raise ValueError('Unsupported registry schema.')
            if args.action == 'list':
                result = {'sets': catalog(registry, args.snapshots)}
            elif args.action == 'new':
                if args.template is None:
                    raise ValueError('A blank Live Set template is required.')
                result = new_idea(registry, args.registry, args.snapshots, args.library, args.template, args.name)
            elif args.action == 'associate':
                result = associate_song(registry, args.registry, args.set_id, args.song)
            elif args.action in ['archive', 'restore']:
                result = archive_set(registry, args.registry, args.set_id, args.action == 'restore')
            else:
                result = make_branch(registry, args.registry, args.snapshots,
                                     args.library, args.parent, args.name)
            print(json.dumps(result))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    sys.exit(main())
