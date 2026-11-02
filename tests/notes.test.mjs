import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoteIndex, readingBody, readNoteLocation, noteLocation, neighborhood } from '../apps/internal/dashboard/notes-model.mjs';
import { noteContent } from '../scripts/note-content.mjs';

const record = (id, title, links = [], content = '') => ({ key: `Note:${id}`, type: 'Note', id, title, source: `data/notes/${id}.md`, content, data: { id, title, related_notes: links, visibility: 'private' } });

test('notes derive distinct outgoing links, backlinks, and a bounded deterministic neighborhood', () => {
  const records = [record('a', 'Alpha', ['b', 'b'], 'An intention becomes executable.'), record('b', 'Beta', ['a']), record('c', 'Gamma', ['a']), record('alone', 'Alone', [], 'Quiet thought.'), { type: 'Song', id: 'song', title: 'Not a note', data: {} }];
  const index = createNoteIndex(records);
  assert.equal(index.notes.length, 4);
  assert.equal(index.linkCount, 3);
  assert.deepEqual([...index.outgoing.get('a')], ['b']);
  assert.deepEqual([...index.incoming.get('a')], ['b', 'c']);
  assert.equal(index.degree('a'), 2); // Reciprocal references count as one neighbor.
  assert.deepEqual(index.list({ query: 'intention executable' }).map(n => n.id), ['a']);
  assert.deepEqual(index.list({ query: 'executable quiet' }), []);
  assert.deepEqual(index.list({ scope: 'unlinked' }).map(n => n.id), ['alone']);
  assert.equal(index.sorted[0].id, 'a');
  const map = neighborhood(index, 'a', 1);
  assert.equal(map.length, 1);
  assert.equal(map[0].note.id, 'b');
  assert.equal(map[0].outgoing, true);
  assert.equal(map[0].incoming, true);
  assert.ok(Number.isFinite(map[0].x) && Number.isFinite(map[0].y));
  assert.deepEqual(map, neighborhood(index, 'a', 1));
  assert.deepEqual(neighborhood(index, 'alone'), []);
});

test('the reading pane removes only a terminal standard link list and preserves substantive content', () => {
  assert.equal(readingBody('An idea.\n\n## Related notes\n\n- [Other](./other.md)\n'), 'An idea.');
  const substantive = 'An idea.\n\n## Related notes\n\nA further thought about the relationship.';
  assert.equal(readingBody(substantive), substantive);
  assert.equal(readingBody(''), '');
});

test('note URLs round-trip note selection and filters without leaking source paths', () => {
  const state = { id: 'one', query: 'beauty & community', scope: 'unlinked', sort: 'title' };
  const url = noteLocation(state);
  assert.deepEqual(readNoteLocation(url.slice(url.indexOf('?'))), state);
  assert.deepEqual(readNoteLocation('?sort=unknown&scope=secret'), { id: '', query: '', scope: 'all', sort: 'connections' });
});

test('reading HTML supports Markdown and Note links while rejecting executable markup and remote images', () => {
  const a = record('a', 'Alpha', [], '# Heading\n\nA **thought** with [Beta](./b.md), [an external link](https://example.com/?a=1&b=2), [bad](javascript:alert%281%29), and ![image](https://example.com/tracker.png).\n\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
  const notes = noteContent([a, record('b', 'Beta')]);
  assert.match(notes[0].html, /<h1>Heading<\/h1>/);
  assert.match(notes[0].html, /<strong>thought<\/strong>/);
  assert.match(notes[0].html, /href="notes.html\?note=b" data-note-id="b"/);
  assert.match(notes[0].html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(notes[0].html, /<script|<img|href="javascript:/);
  assert.match(notes[0].html, /&lt;script&gt;/);
  const nested = noteContent([
    { ...record('nested', 'Nested', [], '[Alpha](../a.md)'), source: 'data/notes/local/nested.md' }, a,
  ]);
  assert.match(nested[0].html, /data-note-id="a"/);
});
