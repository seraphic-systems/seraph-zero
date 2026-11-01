import test from 'node:test';
import assert from 'node:assert/strict';
import { lintProjectNames } from '../scripts/project-naming.mjs';

const song = { key: 'Song:higher', type: 'Song', id: 'higher', data: { title: "You're Higher" } };
const set = (name, extra = {}) => ({ key: 'LiveSet:one', type: 'LiveSet', source: 'registry.json',
  data: { paths: [`~/Ableton/${name}`], ...extra } });

test('names accept ideas and Song titles/IDs with bounded optional suffixes', () => {
  for (const name of ['idea-piano.als', 'IDEA-piano.als', 'higher.als', 'higher-mix-10-28-26.als',
    "You're Higher alternate.ALS", 'youre_higher-v2.als', 'You’re Higher.als']) {
    assert.deepEqual(lintProjectNames([song, set(name)]), [], name);
  }
  for (const name of ['idea.als', 'idea-.als', 'soundtrack-idea.als', 'higherground.als', 'other-higher.als']) {
    assert.equal(lintProjectNames([song, set(name)]).length, 1, name);
  }
  assert.equal(lintProjectNames([set('higher.als')]).length, 1);
});

test('checks physical names, inventory-only sets and current registry paths once', () => {
  const project = { key: 'Project:permanent', type: 'Project', source: 'project.md', data: {
    id: 'permanent', title: 'An unrelated display title', folder: 'Albums/Higher Project',
    sets: ['higher.als', 'draft.als', 'missing.als'],
  } };
  const registered = set('Albums/Higher Project/draft.als');
  const diagnostics = lintProjectNames([song, project, registered]);
  assert.deepEqual(diagnostics.map((d) => [d.record, d.path]), [
    ['Project:permanent', '~/Ableton/Albums/Higher Project/missing.als'],
    ['LiveSet:one', '~/Ableton/Albums/Higher Project/draft.als'],
  ]);
  assert.deepEqual(lintProjectNames([song, set('ignored', {
    paths: ['~/Ableton/old-invalid.als', '~/Ableton/higher-v2.als'],
  })]), []);
  assert.equal(lintProjectNames([song, { ...project, data: { ...project.data, folder: 'Unknown Project', sets: [] } }]).length, 1);
});
