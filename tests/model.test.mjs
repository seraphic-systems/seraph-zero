import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCatalog, validateRecord, modelSchema } from '../scripts/model.mjs';
import { createInternalRecord } from '../scripts/create-internal-record.mjs';

const parent = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';
async function fixture(t) {
  const source = await mkdtemp(path.join(tmpdir(), 'seraph-model-'));
  t.after(() => rm(source, { recursive: true, force: true }));
  async function record(file, data) {
    await mkdir(path.dirname(path.join(source, 'data', file)), { recursive: true });
    await writeFile(path.join(source, 'data', file), file.endsWith('.md') ? `---\n${JSON.stringify(data)}\n---\n` : JSON.stringify(data));
  }
  await record('songs/work.md', { id: 'work', title: 'Renamed work' });
  return { source, record };
}

test('catalog preserves metadata-only mixes and gives formats one shared mix identity', async (t) => {
  const { source, record } = await fixture(t);
  await record('mixes/work-2026-01-01.md', { song: 'work', date: '2026-01-01' });
  await record('mixes/work-2025-01-01.md', { song: 'work', date: '2025-01-01' });
  const catalog = await buildCatalog(source, ['wav', 'mp3'].map((format) => ({ id: 'work', date: '2026-01-01', file: `work-2026-01-01.${format}`, format })));
  assert.ok(catalog.records.every((record) => Object.hasOwn(record.data, 'created_at')));
  assert.equal(catalog.records.filter((r) => r.type === 'Mix').length, 2);
  assert.equal(catalog.records.filter((r) => r.type === 'MixFile').length, 2);
  assert.deepEqual(catalog.edges.filter((e) => e.relation === 'file-mix').map((e) => e.target), ['Mix:work-2026-01-01', 'Mix:work-2026-01-01']);
  assert.equal(catalog.edges.filter((e) => e.relation === 'mix-song').length, 2);
});

test('exact current paths, explicit branch IDs and legacy history stay distinct', async (t) => {
  const { source, record } = await fixture(t);
  const project = { id: 'work-project', title: 'Work', song: null, root: 'ableton', folder: 'Work Project', main_set: 'original.als', sets: ['original.als', 'unknown.als'] };
  await record('projects/work.md', project);
  await record('set-registry.json', { schema_version: 1, sets: [
    { id: parent, paths: ['~/Ableton/Work Project/old.als', '~/Ableton/Work Project/original.als'], xml_sha256: 'a'.repeat(64) },
    { id: child, parent_set_id: parent, paths: ['~/Ableton/Work Project/child.als'], xml_sha256: 'a'.repeat(64) },
  ] });
  await record('set-snapshots/legacy.json', { schema_version: 1, analyzer_version: 1, analyzed_at: '2026-01-01T00:00:00Z', source: '~/Ableton', sets: [{ set_path: 'Work Project/original.als', source_sha256: 'a', xml_sha256: 'a', plugins: [], warnings: [] }], errors: [] });
  const catalog = await buildCatalog(source);
  assert.deepEqual(catalog.edges.filter((e) => e.relation === 'project-set').map((e) => e.target), [`LiveSet:${parent}`]);
  assert.ok(catalog.edges.some((e) => e.source === `LiveSet:${child}` && e.target === `LiveSet:${parent}`));
  assert.equal(catalog.edges.filter((e) => e.relation === 'snapshot-set').length, 0);
  assert.equal(catalog.unresolved.length, 3);
  assert.equal(catalog.records.find((r) => r.type === 'Snapshot').data.created_at, '2026-01-01T00:00:00Z');
  assert.ok(catalog.records.filter((r) => r.type === 'LiveSet').every((r) => r.data.created_at === null));
  await record('projects/work.md', { ...project, sets: ['old.als'], main_set: 'old.als' });
  assert.equal((await buildCatalog(source)).edges.filter((e) => e.relation === 'project-set').length, 0);
});

test('schema and catalog reject malformed records, dangling references and duplicate album positions', async (t) => {
  const { source, record } = await fixture(t);
  assert.throws(() => validateRecord('Mix', { song: 'work', date: '2026-02-30' }, 'mix.md'), /mix.md.*date/);
  assert.throws(() => validateRecord('Mix', { song: 'work', date: '2026-01-01', bpm: 80, bpm_changes: [80, 90] }, 'mix.md'), /mix.md/);
  await record('album-tracks/one.md', { id: 'one', album: 'missing', track_number: 1 });
  await assert.rejects(buildCatalog(source), /unknown Album missing/);
  await record('albums/album.md', { id: 'missing', title: 'Album' });
  await record('album-tracks/two.md', { id: 'two', album: 'missing', track_number: 1 });
  await assert.rejects(buildCatalog(source), /duplicate album track number/);
});

test('stem export metadata accepts unknowns and validates tempo and key like mixes', () => {
  const stem = { id: 'work-export', title: 'Work export', folder: 'media/stems/raw/work', master: 'work.wav', mixes: [] };
  for (const fields of [{}, { bpm: null, bpm_changes: null, key: null },
    { bpm: 122.6, key: 'D minor' }, { bpm_changes: [71, 83] }]) {
    validateRecord('StemExport', { ...stem, ...fields }, 'stem.md');
  }
  for (const fields of [{ bpm: 0 }, { bpm: -1 }, { bpm: '120' },
    { bpm_changes: [71] }, { bpm_changes: [71, 0] }, { bpm_changes: '71, 83' },
    { bpm: 71, bpm_changes: [71, 83] }, { key: ' ' }, { key: 1 }]) {
    assert.throws(() => validateRecord('StemExport', { ...stem, ...fields }, 'stem.md'), /stem.md/);
  }
});

test('branch lineage rejects cycles without hanging the build', async (t) => {
  const { source, record } = await fixture(t);
  await record('set-registry.json', { schema_version: 1, sets: [
    { id: parent, parent_set_id: child, paths: ['~/Ableton/one.als'], xml_sha256: 'a'.repeat(64) },
    { id: child, parent_set_id: parent, paths: ['~/Ableton/two.als'], xml_sha256: 'a'.repeat(64) },
  ] });
  await assert.rejects(buildCatalog(source), /lineage contains a cycle/);
});

test('snapshot BPM accepts positive numbers, null and historical omission', () => {
  const report = { schema_version: 2, analyzer_version: 2, analyzed_at: '2026-10-30T12:00:00Z',
    source: '~/Ableton', sets: [{ set_id: parent, set_path: 'Work.als', source_sha256: 'a',
      xml_sha256: 'a', plugins: [], warnings: [] }], errors: [] };
  validateRecord('Snapshot', report, 'snapshot.json');
  for (const bpm of [120, 123.5, null]) {
    validateRecord('Snapshot', { ...report, sets: [{ ...report.sets[0], bpm }] }, 'snapshot.json');
  }
  for (const bpm of [0, -1, '120']) {
    assert.throws(() => validateRecord('Snapshot', { ...report, sets: [{ ...report.sets[0], bpm }] }, 'snapshot.json'), /snapshot.json/);
  }
});

test('album tracks link a primary song and multiple secondary songs', async (t) => {
  const { source, record } = await fixture(t);
  await record('albums/album.md', { id: 'album', title: 'Album' });
  for (const id of ['other-work', 'third-work']) await record(`songs/${id}.md`, { id, title: id });
  const track = { id: 'medley', album: 'album', track_number: 1, primary_song: 'work', secondary_songs: ['other-work', 'third-work'] };
  await record('album-tracks/medley.md', track);
  const edges = (await buildCatalog(source)).edges.filter((edge) => edge.source === 'AlbumTrack:medley');
  assert.deepEqual(edges.map(({ relation, target }) => [relation, target]), [
    ['track-album', 'Album:album'],
    ['track-primary-song', 'Song:work'],
    ['track-secondary-song', 'Song:other-work'],
    ['track-secondary-song', 'Song:third-work'],
  ]);
  await record('album-tracks/medley.md', { ...track, secondary_songs: [] });
  assert.equal((await buildCatalog(source)).edges.filter((edge) => edge.target.startsWith('Song:')).length, 1);
  await record('album-tracks/medley.md', { ...track, primary_song: 'missing' });
  await assert.rejects(buildCatalog(source), /primary_song references unknown Song missing/);
  await record('album-tracks/medley.md', { ...track, secondary_songs: ['missing'] });
  await assert.rejects(buildCatalog(source), /secondary_songs references unknown Song missing/);
  await record('album-tracks/medley.md', { ...track, secondary_songs: ['work'] });
  await assert.rejects(buildCatalog(source), /secondary_songs must not include primary_song/);
});

test('album track song fields validate IDs and reject duplicate secondary songs', () => {
  const track = { id: 'track', album: 'album', track_number: 1 };
  validateRecord('AlbumTrack', track, 'track.md');
  for (const fields of [
    { primary_song: '' },
    { primary_song: ['work'] },
    { secondary_songs: 'work' },
    { secondary_songs: ['Invalid ID'] },
    { secondary_songs: ['work', 'work'] },
  ]) {
    assert.throws(() => validateRecord('AlbumTrack', { ...track, ...fields }, 'track.md'), /track.md/);
  }
});


test('all entities inherit timestamp validation and catalog defaults never invent creation times', async (t) => {
  const { source, record } = await fixture(t);
  for (const definition of Object.values(modelSchema.definitions).filter((d) => d['x-model'])) {
    assert.ok(definition.allOf.some((base) => base.$ref === '#/definitions/RecordBase'));
  }
  for (const created_at of ['2026-10-30', 'yesterday', 42, '2026-02-30T00:00:00Z', '2026-10-30T00:00:00']) {
    assert.throws(() => validateRecord('Song', { id: 'work', title: 'Work', created_at }, 'song.md'), /created_at/);
  }
  assert.equal((await buildCatalog(source)).records[0].data.created_at, null);
  assert.equal((await buildCatalog(source)).records[0].data.created_at, null);
  // Unquoted YAML timestamps become Date objects; keep timestamp precision.
  await writeFile(path.join(source, 'data/songs/work.md'), '---\nid: work\ntitle: Work\ncreated_at: 2026-10-30T12:34:56.789Z\nsong_created: 2020-01-01\n---\n');
  let data = (await buildCatalog(source)).records[0].data;
  assert.equal(data.created_at, '2026-10-30T12:34:56.789Z');
  assert.equal(data.song_created, '2020-01-01');
  await record('songs/work.md', { ...data, created_at: null });
  assert.equal((await buildCatalog(source)).records[0].data.created_at, null);
});

test('record creation stamps once and refuses to overwrite an existing record', async (t) => {
  const { source } = await fixture(t);
  const before = Date.now();
  const file = await createInternalRecord('Song', { id: 'new-work', title: 'New Work' }, { source });
  const record = (await buildCatalog(source)).records.find((r) => r.id === 'new-work');
  assert.ok(Date.parse(record.data.created_at) >= before);
  assert.ok(Date.parse(record.data.created_at) <= Date.now());
  const bytes = await readFile(file, 'utf8');
  await assert.rejects(createInternalRecord('Song', { id: 'new-work', title: 'Replacement' }, { source }), /EEXIST/);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.equal((await buildCatalog(source)).records.find((r) => r.id === 'new-work').data.created_at, record.data.created_at);
});

test('member profiles can be created and cataloged by name with validated optional details', async (t) => {
  const { source } = await fixture(t);
  const member = {
    id: 'timothy-butler', name: 'Timothy Butler',
    skills: ['software engineering', 'audio production'],
  };
  const file = await createInternalRecord('Member', member, { source });
  assert.equal(file, path.join(source, 'data/members/timothy-butler.md'));
  const record = (await buildCatalog(source)).records.find((r) => r.key === 'Member:timothy-butler');
  assert.equal(record.title, member.name);
  assert.deepEqual(record.data.skills, member.skills);
  assert.ok(Number.isFinite(Date.parse(record.data.created_at)));
  validateRecord('Member', { id: 'another-member', name: 'Another Member' }, 'member.md');
  validateRecord('Member', { ...member, roles: ['Engineer'], bio: 'Builds software.', email: 'member@example.com', website: 'https://example.com' }, 'member.md');
  for (const fields of [
    { name: ' ' }, { id: '../member' }, { skills: 'engineering' },
    { skills: ['engineering', 'engineering'] }, { skills: [' '] },
    { roles: ['Engineer', 'Engineer'] }, { email: 'invalid' }, { website: 'invalid' },
  ]) {
    assert.throws(() => validateRecord('Member', { ...member, ...fields }, 'member.md'), /member.md/);
  }
  await assert.rejects(createInternalRecord('Member', member, { source }), /EEXIST/);
});

test('horizons can be created and cataloged with the four defined levels', async (t) => {
  const { source } = await fixture(t);
  const horizon = { id: 'contemplation', title: 'Contemplation', level: 1, description: 'Attention to what is true, beautiful, and worth loving.' };
  const file = await createInternalRecord('Horizon', horizon, { source });
  assert.equal(file, path.join(source, 'data/horizons/contemplation.md'));
  const record = (await buildCatalog(source)).records.find((r) => r.key === 'Horizon:contemplation');
  assert.equal(record.title, horizon.title);
  assert.equal(record.data.level, 1);
  assert.equal(record.data.description, horizon.description);
  assert.ok(Number.isFinite(Date.parse(record.data.created_at)));
  for (const level of [1, 2, 3, 4]) {
    validateRecord('Horizon', { ...horizon, level }, 'horizon.md');
  }
  for (const level of [0, -1, 5, 1.5, '1', null]) {
    assert.throws(() => validateRecord('Horizon', { ...horizon, level }, 'horizon.md'), /horizon.md/);
  }
  for (const field of ['id', 'title', 'level', 'description']) {
    const incomplete = { ...horizon };
    delete incomplete[field];
    assert.throws(() => validateRecord('Horizon', incomplete, 'horizon.md'), /horizon.md/);
  }
});

test('policies can be created and cataloged with links to multiple horizons', async (t) => {
  const { source, record } = await fixture(t);
  for (const id of ['creation', 'communion']) {
    await record(`horizons/${id}.md`, { id, title: id, level: 1, description: id });
  }
  const policy = {
    id: 'weekly-gathering', title: 'Weekly Gathering',
    description: 'Gather weekly to share work and spend time together.',
    horizons: ['creation', 'communion'],
  };
  const file = await createInternalRecord('Policy', policy, { source });
  assert.equal(file, path.join(source, 'data/policies/weekly-gathering.md'));
  const catalog = await buildCatalog(source);
  const row = catalog.records.find((r) => r.key === 'Policy:weekly-gathering');
  assert.equal(row.title, policy.title);
  assert.equal(row.data.description, policy.description);
  assert.ok(Number.isFinite(Date.parse(row.data.created_at)));
  assert.deepEqual(catalog.edges.filter((e) => e.source === row.key), [
    { source: row.key, target: 'Horizon:creation', relation: 'policy-horizon' },
    { source: row.key, target: 'Horizon:communion', relation: 'policy-horizon' },
  ]);
  await record('policies/weekly-gathering.md', { ...policy, horizons: ['missing'] });
  await assert.rejects(buildCatalog(source), /horizons references unknown Horizon missing/);
});

test('policies optionally link an album and reject unknown album references', async (t) => {
  const { source, record } = await fixture(t);
  await record('horizons/creation.md', { id: 'creation', title: 'Creation', level: 1, description: 'Create.' });
  await record('albums/album.md', { id: 'album', title: 'Album', description: 'Music with an immersive digital experience.' });
  const policy = { id: 'release', title: 'Release', description: 'Create and release the album.', horizons: ['creation'], album: 'album' };
  await createInternalRecord('Policy', policy, { source });
  const catalog = await buildCatalog(source);
  assert.ok(catalog.edges.some((edge) => edge.source === 'Policy:release' && edge.target === 'Album:album' && edge.relation === 'policy-album'));
  await record('policies/release.md', { ...policy, album: 'missing' });
  await assert.rejects(buildCatalog(source), /album references unknown Album missing/);
  for (const album of ['', 'Invalid ID', ['album'], null]) {
    assert.throws(() => validateRecord('Policy', { ...policy, album }, 'policy.md'), /policy.md/);
  }
  assert.throws(() => validateRecord('Album', { id: 'album', title: 'Album', description: ' ' }, 'album.md'), /album.md/);
});

test('policies require meaningful fields and at least one distinct horizon ID', () => {
  const policy = { id: 'gather', title: 'Gather', description: 'Gather weekly.', horizons: ['communion'] };
  validateRecord('Policy', policy, 'policy.md');
  for (const fields of [
    { id: '../policy' }, { title: ' ' }, { description: ' ' },
    { horizons: [] }, { horizons: 'communion' }, { horizons: ['Invalid ID'] },
    { horizons: ['communion', 'communion'] },
  ]) {
    assert.throws(() => validateRecord('Policy', { ...policy, ...fields }, 'policy.md'), /policy.md/);
  }
  for (const field of ['id', 'title', 'description', 'horizons']) {
    const incomplete = { ...policy };
    delete incomplete[field];
    assert.throws(() => validateRecord('Policy', incomplete, 'policy.md'), /policy.md/);
  }
});

test('Idea records need no title and preserve explicit Song and set references', async (t) => {
  const { source, record } = await fixture(t);
  await record('set-registry.json', { schema_version: 1, sets: [{ id: parent, paths: ['~/Ableton/idea.als'], xml_sha256: 'a'.repeat(64) }] });
  await record('ideas/idea.md', { id: 'idea-20261030-abc', set_id: parent });
  let catalog = await buildCatalog(source);
  assert.ok(catalog.edges.some((edge) => edge.relation === 'idea-set' && edge.target === `LiveSet:${parent}`));
  await record('ideas/idea.md', { id: 'idea-20261030-abc', set_id: parent, song: 'work' });
  catalog = await buildCatalog(source);
  assert.ok(catalog.edges.some((edge) => edge.relation === 'idea-song' && edge.target === 'Song:work'));
  validateRecord('Idea', { id: 'idea' }, 'idea.md');
  validateRecord('Idea', { id: 'idea', project_id: 'work-project' }, 'idea.md');
  assert.throws(() => validateRecord('Idea', { id: 'idea', project_id: 'work-project', set_id: parent }, 'idea.md'), /idea.md/);
  await record('ideas/historical.md', { id: 'historical-idea' });
  catalog = await buildCatalog(source);
  assert.ok(catalog.records.some((record) => record.key === 'Idea:historical-idea'));
  assert.ok(!catalog.edges.some((edge) => edge.source === 'Idea:historical-idea'));
  await record('ideas/idea.md', { id: 'idea-20261030-abc', set_id: parent, song: 'missing' });
  await assert.rejects(buildCatalog(source), /unknown Song missing/);
});
