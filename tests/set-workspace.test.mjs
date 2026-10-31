import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workspace } from '../scripts/set-workspace.mjs';

test('songs use exact project ownership and the newest saved available non-archived set', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const internal = path.join(root, 'apps/internal/data');
  await mkdir(path.join(internal, 'songs'), { recursive: true });
  await mkdir(path.join(internal, 'projects'));
  await writeFile(path.join(internal, 'songs/song.md'), '---\nid: song\ntitle: A song\n---\n');
  await writeFile(path.join(internal, 'projects/project.md'), '---\nid: project\nsong: song\nroot: ableton\nfolder: Work Project\n---\n');
  const library = path.join(root, 'Ableton');
  const set = (id, date, extra = {}) => ({ id, paths: [path.join(library, 'Work Project', `${id}.als`)], saved_at: date, available: true, ...extra });
  const data = await workspace(root, library, [
    set('old', '2026-01-01T00:00:00Z', { created_at: '2026-10-01T00:00:00Z' }),
    set('latest', '2026-02-01T00:00:00Z'),
    set('missing', '2026-03-01T00:00:00Z', { available: false }),
    set('archived', '2026-04-01T00:00:00Z', { archived_at: '2026-04-02T00:00:00Z' }),
    set('idea', '2026-05-01T00:00:00Z', { song: null }),
    { ...set('lookalike', '2026-06-01T00:00:00Z'), paths: [path.join(library, 'Work Project copy', 'song.als')] },
  ]);
  assert.equal(data.songs[0].latest_set_id, 'latest');
  assert.equal(data.sets.find((s) => s.id === 'lookalike').song, null);
  assert.equal(data.sets.find((s) => s.id === 'idea').song, null);
  assert.equal(data.sets.find((s) => s.id === 'latest').project_id, 'project');
});

test('ideas backfill once, keep branch identity, and retain a later Song association', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-ideas-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'apps/internal/data');
  await mkdir(path.join(source, 'projects'), { recursive: true });
  await mkdir(path.join(source, 'songs'));
  await writeFile(path.join(source, 'projects/work.md'), '---\nid: work\nroot: ableton\nfolder: Work\nsong: null\n---\n');
  await writeFile(path.join(source, 'songs/song.md'), '---\nid: song\ntitle: Song\n---\n');
  const library = path.join(root, 'Ableton');
  const sets = [
    { id: 'parent', paths: [path.join(library, 'Work/main.als')] },
    { id: 'child', parent_set_id: 'parent', paths: [path.join(library, 'Work/branch.als')] },
    { id: 'orphan', paths: [path.join(library, 'standalone.als')] },
    { id: 'orphan-child', parent_set_id: 'orphan', paths: [path.join(library, 'alternate.als')] },
  ];
  const data = await workspace(root, library, sets, { ensureIdeas: true });
  assert.equal(data.ideas.length, 2);
  assert.equal(data.sets[0].idea_id, data.sets[1].idea_id);
  assert.equal(data.sets[2].idea_id, data.sets[3].idea_id);
  assert.ok(data.ideas.every((idea) => idea.created_at === null));
  const idea = data.ideas.find((idea) => idea.project_id === 'work');
  await writeFile(path.join(source, 'ideas', `${idea.id}.md`), `---\n${JSON.stringify({ ...idea, song: 'song' })}\n---\n`);
  const linked = await workspace(root, library, sets, { ensureIdeas: true });
  assert.equal(linked.ideas.length, 2);
  assert.equal(linked.sets[0].idea_id, idea.id);
  assert.equal(linked.sets[0].song, 'song');
  assert.equal(linked.sets[1].song, 'song');
});
