import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildInternal } from '../scripts/internal.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-internal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  for (const directory of ['data/songs', 'media/mixes', 'dashboard']) await mkdir(path.join(source, directory), { recursive: true });
  await writeFile(path.join(source, 'dashboard/index.html'), '<h1>Library</h1>');
  const song = (file, id, title = 'Renamed song') => writeFile(path.join(source, 'data/songs', `${file}.md`), `---\nid: ${id}\ntitle: ${title}\nsong_created: 2020-06-08\n---\nA **note**.`);
  const mix = (name) => writeFile(path.join(source, 'media/mixes', name), 'fixture audio');
  return { source, output, song, mix };
}

test('links versions by stable id despite renamed title and filename, newest first', async (t) => {
  const { source, output, song, mix } = await fixture(t);
  await song('new-title', 'original-id');
  await song('no-audio', 'no-audio', 'No audio');
  await mix('original-id-2025-01-01.wav');
  await mix('original-id-2026-01-01.mp3');
  assert.equal(await buildInternal(source, output), 2);
  const songs = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
  const renamed = songs.find((song) => song.id === 'original-id');
  assert.deepEqual(renamed.mixes.map((mix) => mix.date), ['2026-01-01', '2025-01-01']);
  assert.match(renamed.notes, /<strong>note<\/strong>/);
  assert.equal(songs.find((song) => song.id === 'no-audio').mixes.length, 0);
  await access(path.join(output, renamed.mixes[0].url));
  await assert.rejects(access(path.join(output, 'songs')));
});

test('missing local media is allowed; duplicate ids and unmatched mixes are actionable errors', async (t) => {
  const { source, output, song, mix } = await fixture(t);
  await song('first', 'first');
  await rm(path.join(source, 'media'), { recursive: true });
  await buildInternal(source, output);
  await song('second', 'first');
  await assert.rejects(buildInternal(source, output), /duplicate song id first/);
  await song('second', 'second');
  await mkdir(path.join(source, 'media/mixes'), { recursive: true });
  await mix('unknown-2026-01-01.wav');
  await assert.rejects(buildInternal(source, output), /no song with id unknown/);
  await rm(path.join(source, 'media/mixes/unknown-2026-01-01.wav'));
  await mix('first-2026-02-30.wav');
  await assert.rejects(buildInternal(source, output), /use a real YYYY-MM-DD date/);
});

test('songs without official mixes allow unknown creation dates but reject invalid dates', async (t) => {
  const { source, output } = await fixture(t);
  const file = path.join(source, 'data/songs/in-progress.md');
  for (const metadata of ['song_created:', '']) {
    await writeFile(file, `---\nid: in-progress\ntitle: In progress\n${metadata}\n---\nIn progress; no official mix yet.`);
    await buildInternal(source, output);
    const [song] = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
    assert.equal(song.created, null);
    assert.deepEqual(song.mixes, []);
    assert.match(song.notes, /no official mix yet/);
  }
  for (const value of ['"2026-02-30"', '"unknown"', 'false', '42', '""']) {
    await writeFile(file, `---\nid: in-progress\ntitle: In progress\nsong_created: ${value}\n---\n`);
    await assert.rejects(buildInternal(source, output), /in-progress.md: use a real YYYY-MM-DD date/);
  }
});

test('optional mix notes follow the selected version and survive missing local audio', async (t) => {
  const { source, output, song, mix } = await fixture(t);
  await song('higher', 'higher');
  await mix('higher-2026-04-27.wav');
  await mix('higher-2026-04-27.mp3');
  await mix('higher-2025-01-01.wav');
  const directory = path.join(source, 'data/mixes');
  await mkdir(directory);
  const note = path.join(directory, 'higher-2026-04-27.md');
  await writeFile(note, '---\nsong: higher\ndate: "2026-04-27"\n---\nBring the **vocals** forward.');
  await buildInternal(source, output);
  const [result] = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
  for (const mix of result.mixes.filter((mix) => mix.date === '2026-04-27')) {
    assert.match(mix.notes, /<strong>vocals<\/strong>/);
  }
  assert.equal(result.mixes.find((mix) => mix.date === '2025-01-01').notes, '');
  await rm(path.join(source, 'media'), { recursive: true });
  await buildInternal(source, output);
  await assert.rejects(access(path.join(output, 'mixes')));
  await writeFile(note, '---\nsong: missing\ndate: "2026-04-27"\n---\nNotes');
  await assert.rejects(buildInternal(source, output), /mixes\/higher-2026-04-27.md: song must match/);
  await writeFile(note, '---\nsong: higher\ndate: "2026-04-28"\n---\nNotes');
  await assert.rejects(buildInternal(source, output), /filename must be higher-2026-04-28.md/);
});

test('mix BPM and key are validated and attached to the matching version', async (t) => {
  const { source, output, song, mix } = await fixture(t);
  await song('higher', 'higher');
  await mix('higher-2026-04-27.wav');
  await mix('higher-2019-11-03.wav');
  const directory = path.join(source, 'data/mixes');
  await mkdir(directory);
  const file = path.join(directory, 'higher-2026-04-27.md');
  const writeMetadata = (metadata) => writeFile(file, `---\nsong: higher\ndate: "2026-04-27"\n${metadata}\n---\nExisting notes`);
  await writeMetadata('bpm: 123.5\nkey: F# minor');
  await buildInternal(source, output);
  const [result] = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
  assert.equal(result.mixes[0].bpm, 123.5);
  assert.equal(result.mixes[0].key, 'F# minor');
  assert.match(result.mixes[0].notes, /Existing notes/);
  assert.equal(result.mixes[1].bpm, undefined);
  await writeMetadata('bpm:\nkey:');
  await buildInternal(source, output);
  const [blank] = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
  assert.equal(blank.mixes[0].bpm, null);
  assert.equal(blank.mixes[0].key, null);
  await writeMetadata('bpm: -10');
  await assert.rejects(buildInternal(source, output), /bpm must be a positive number or blank/);
  await writeMetadata('key: 42');
  await assert.rejects(buildInternal(source, output), /key must be text or blank/);
});

test('variable-tempo mixes retain tempo order and reject ambiguous or invalid metadata', async (t) => {
  const { source, output, song, mix } = await fixture(t);
  await song('mania', 'mania');
  await mix('mania-2024-04-27.mp3');
  await mkdir(path.join(source, 'data/mixes'));
  const file = path.join(source, 'data/mixes/mania-2024-04-27.md');
  const writeMetadata = (metadata) => writeFile(file, `---\nsong: mania\ndate: "2024-04-27"\n${metadata}\n---\n`);
  await writeMetadata('bpm:\nbpm_changes: [71, 83]');
  await buildInternal(source, output);
  const [result] = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
  assert.equal(result.mixes[0].bpm, null);
  assert.deepEqual(result.mixes[0].bpm_changes, [71, 83]);
  await writeMetadata('bpm: 71\nbpm_changes: [71, 83]');
  await assert.rejects(buildInternal(source, output), /use bpm or bpm_changes, not both/);
  for (const value of ['[71]', '[71, 0]', '[71, "83"]', '71-83']) {
    await writeMetadata(`bpm_changes: ${value}`);
    await assert.rejects(buildInternal(source, output), /bpm_changes must list at least two positive tempos/);
  }
});

test('raw and cleaned stem records link mixes across formats and survive absent audio', async (t) => {
  const { source, output, song, mix } = await fixture(t);
  await song('renamed', 'epoch');
  await mkdir(path.join(source, 'data/mixes'));
  for (const date of ['2021-04-25', '2022-01-01']) {
    await writeFile(path.join(source, 'data/mixes', `epoch-${date}.md`), `---\nsong: epoch\ndate: "${date}"\n---\n`);
  }
  await mix('epoch-2021-04-25.wav');
  await mix('epoch-2021-04-25.mp3');
  await mix('epoch-2020-01-01.wav');
  for (const stage of ['raw', 'cleaned']) await mkdir(path.join(source, 'data/stems', stage), { recursive: true });
  const record = (id, song, mixes, stage = 'raw', metadata = '') => writeFile(path.join(source, 'data/stems', stage, `${id}.md`),
    `---\nid: ${id}\ntitle: Export ${id}\nsong: ${song}\nfolder: media/stems/${stage}/Original Folder\nmaster: Original Master.wav\nmixes: ${JSON.stringify(mixes)}\n${metadata}\n---\nComparison notes.\n`);
  await record('epoch-export-01', 'epoch', ['epoch-2021-04-25', 'epoch-2022-01-01'], 'raw', 'bpm: 122.6\nkey: D minor');
  await record('epoch-export-02', 'epoch', ['epoch-2021-04-25'], 'cleaned', 'bpm:\nbpm_changes: [71, 83]\nkey:');
  await record('unmatched-export', '', []);
  await buildInternal(source, output);
  const [result] = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
  assert.deepEqual(result.stems, ['epoch-export-01', 'epoch-export-02']);
  for (const mix of result.mixes.filter((mix) => mix.date === '2021-04-25')) {
    assert.deepEqual(mix.stems, result.stems);
  }
  assert.deepEqual(result.mixes.find((mix) => mix.date === '2020-01-01').stems, []);
  await rm(path.join(source, 'media'), { recursive: true });
  await buildInternal(source, output);
  const inventory = JSON.parse(await readFile(path.join(output, 'stems.json'), 'utf8'));
  assert.equal(inventory.length, 3);
  assert.deepEqual(inventory[0].mixes, ['epoch-2021-04-25', 'epoch-2022-01-01']);
  assert.equal(inventory[1].folder, 'media/stems/cleaned/Original Folder');
  assert.equal(inventory[2].song, null);
  assert.equal(inventory[0].bpm, 122.6);
  assert.equal(inventory[0].key, 'D minor');
  assert.equal(inventory[0].bpm_changes, null);
  assert.deepEqual(inventory[1].bpm_changes, [71, 83]);
  assert.equal(inventory[1].bpm, null);
  assert.equal(inventory[1].key, null);
  for (const field of ['bpm', 'bpm_changes', 'key']) assert.equal(inventory[2][field], null);
  await assert.rejects(access(path.join(output, 'media/stems')));
  await record('epoch-export-01', 'epoch', [], 'cleaned');
  await assert.rejects(buildInternal(source, output), /duplicate stem id epoch-export-01/);
});

test('stem links reject unknown versions, cross-song references, and invalid export paths', async (t) => {
  const { source, output, song, mix } = await fixture(t);
  await song('epoch', 'epoch');
  await song('higher', 'higher');
  await mix('higher-2026-04-27.wav');
  await mkdir(path.join(source, 'data/stems/raw'), { recursive: true });
  const file = path.join(source, 'data/stems/raw/epoch-export.md');
  const valid = { id: 'epoch-export', title: 'Epoch export', song: 'epoch',
    folder: 'media/stems/raw/epoch', master: 'epoch.wav', mixes: [] };
  const writeRecord = (changes) => writeFile(file, `---\n${JSON.stringify({ ...valid, ...changes })}\n---\n`);
  for (const [changes, message] of [
    [{ mixes: ['epoch-2020-01-01'] }, /unknown mix/],
    [{ mixes: ['higher-2026-04-27'] }, /must belong to the same song/],
    [{ mixes: ['higher-2026-04-27', 'higher-2026-04-27'] }, /unique mix ids/],
    [{ song: 'missing' }, /song must match/],
    [{ folder: 'media/stems/raw/../other' }, /folder must be a relative path/],
    [{ folder: 'media/stems/other/epoch' }, /folder must be a relative path/],
    [{ master: '../epoch.wav' }, /master must be a WAV filename/],
    [{ id: 'different-id' }, /matching the filename/],
  ]) {
    await writeRecord(changes);
    await assert.rejects(buildInternal(source, output), message);
  }
});

test('orb UI gets static deep links alongside the unchanged classic dashboard', async (t) => {
  const { source, output, song } = await fixture(t);
  await song('higher', 'higher', 'Higher');
  await mkdir(path.join(source, 'dashboard/orb'));
  await writeFile(path.join(source, 'dashboard/orb/index.html'), '<script type="module" src="/orb/app.js"></script>');
  await buildInternal(source, output);
  assert.equal(await readFile(path.join(output, 'index.html'), 'utf8'), '<h1>Library</h1>');
  for (const route of ['orb', 'orb/music', 'orb/music/songs', 'orb/music/songs/song-higher', 'orb/music/albums', 'orb/model', 'orb/model/type-Song']) {
    assert.match(await readFile(path.join(output, route, 'index.html'), 'utf8'), /src="\/orb\/app.js"/);
  }
});

test('Orb deep links use a content-versioned stylesheet after every CSS change', async (t) => {
  const { source, output, song } = await fixture(t);
  await song('higher', 'higher', 'Higher');
  await mkdir(path.join(source, 'dashboard/orb'));
  await writeFile(path.join(source, 'dashboard/orb/index.html'), '<link rel="stylesheet" href="/orb/orb.css?v=old">');
  const stylesheet = path.join(source, 'dashboard/orb/orb.css');
  const hrefFor = async route => (await readFile(path.join(output, route, 'index.html'), 'utf8')).match(/href="([^"]+)"/)[1];
  await writeFile(stylesheet, '#view-lens { border-radius: 50%; }');
  await buildInternal(source, output);
  const first = await hrefFor('orb');
  assert.match(first, /^\/orb\/orb\.[a-f0-9]{16}\.css$/);
  assert.equal(await hrefFor('orb/music/songs/song-higher'), first);
  assert.equal(await readFile(path.join(output, first), 'utf8'), '#view-lens { border-radius: 50%; }');
  await writeFile(stylesheet, '#find-lens { position: fixed; }');
  await buildInternal(source, output);
  const next = await hrefFor('orb');
  assert.notEqual(next, first);
  assert.equal(await hrefFor('orb/music/songs/song-higher'), next);
  assert.equal(await readFile(path.join(output, next), 'utf8'), '#find-lens { position: fixed; }');
  await buildInternal(source, output);
  assert.equal(await hrefFor('orb'), next);
});
