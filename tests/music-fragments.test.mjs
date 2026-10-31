import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { importMusicFragments } from '../scripts/import-music-fragments.mjs';
import { buildCatalog, validateRecord } from '../scripts/model.mjs';

async function fixture(t) {
  const source = await mkdtemp(path.join(tmpdir(), 'seraph-fragments-'));
  t.after(() => rm(source, { recursive: true, force: true }));
  const library = path.join(source, 'audio');
  await mkdir(library);
  for (const file of ['first.wav', 'second.aif']) await writeFile(path.join(library, file), 'test audio');
  const row = (file, group, number) => ({ sheet: 'Aug 2018', sheet_id: 810000, row: number, values: [file, '8/3/2018', file, 'Bb major/G minor', '128.47', 'keys, warm, keys', group, 'loop', 'FALSE', 'TRUE', 'needs edit', 'Warp BPM to 128', 'Melody', 'smooth', 'lead', 'A memory'] });
  return { source, library, snapshot: { spreadsheet_id: 'test-sheet', rows: [row('first.wav', 'Genesis ', 2), row('second.aif', 'Orphan', 3)] } };
}

test('fragment imports preserve annotations, associate groups with Ideas, and retain edits on repeat imports', async (t) => {
  const { source, library, snapshot } = await fixture(t);
  assert.deepEqual(await importMusicFragments(snapshot, { source, library }), { fragments: 2, groups: 1, orphaned: 1, skipped: 0, created: 2, ideas_created: 1 });
  const catalog = await buildCatalog(source);
  const fragments = catalog.records.filter((r) => r.type === 'MusicFragment');
  const idea = catalog.records.find((r) => r.type === 'Idea');
  assert.equal(idea.title, 'Genesis');
  assert.equal(idea.data.project_id, undefined);
  assert.equal(idea.data.set_id, undefined);
  assert.equal(catalog.edges.filter((e) => e.relation === 'fragment-idea').length, 1);
  const first = fragments.find((r) => r.data.file === 'first.wav');
  assert.equal(first.data.bpm, 128.47);
  assert.equal(first.data.key, 'Bb major/G minor');
  assert.deepEqual(first.data.tags, ['keys', 'warm']);
  assert.equal(first.data.memories, 'A memory');
  assert.equal(first.data.needs_review, true);
  assert.equal(first.data.source.row, 2);
  assert.ok(first.data.created_at);
  assert.equal(fragments.find((r) => r.data.file === 'second.aif').data.idea, undefined);
  const filename = path.join(source, first.source);
  await writeFile(filename, matter.stringify('', { ...first.data, notes: 'Reviewed manually' }));
  const before = await readFile(filename, 'utf8');
  const repeated = await importMusicFragments(snapshot, { source, library });
  assert.equal(repeated.created, 0);
  assert.equal(repeated.ideas_created, 0);
  assert.equal(await readFile(filename, 'utf8'), before);
});

test('imports preflight files before writing and skip incomplete or excluded rows', async (t) => {
  const { source, library, snapshot } = await fixture(t);
  snapshot.rows[1].values[2] = 'missing.wav';
  await assert.rejects(importMusicFragments(snapshot, { source, library }), /ENOENT/);
  assert.deepEqual(await readdir(source), ['audio']);
  snapshot.rows[1].values[8] = 'TRUE';
  snapshot.rows.push({ ...snapshot.rows[0], row: 4, values: ['unclassified.wav'] });
  const result = await importMusicFragments(snapshot, { source, library });
  assert.equal(result.fragments, 1);
  assert.equal(result.skipped, 2);
});

test('fragment metadata allows unavailable audio and unknown musical details, but rejects malformed values and dangling Ideas', async (t) => {
  const { source } = await fixture(t);
  const fragment = { id: 'fragment-test', root: 'music-keepers', file: 'old/missing.wav' };
  validateRecord('MusicFragment', fragment, 'fragment.md');
  for (const invalid of [{ file: '../escape.wav' }, { file: '/absolute.wav' }, { file: 'old/../../escape.wav' }, { bpm: 0 }, { bpm: '128' }, { key: ' ' }, { idea: null }]) {
    assert.throws(() => validateRecord('MusicFragment', { ...fragment, ...invalid }, 'fragment.md'), /fragment.md/);
  }
  await mkdir(path.join(source, 'data/music-fragments'), { recursive: true });
  const filename = path.join(source, 'data/music-fragments/fragment-test.md');
  await writeFile(filename, matter.stringify('', fragment));
  assert.equal((await buildCatalog(source)).records.length, 1);
  await writeFile(filename, matter.stringify('', { ...fragment, idea: 'missing' }));
  await assert.rejects(buildCatalog(source), /unknown Idea missing/);
});
