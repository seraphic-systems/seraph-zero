import test from 'node:test';
import assert from 'node:assert/strict';
import { journalThumbnail } from '../scripts/journal-art.mjs';

const colors = { background: '#faf9f6', accent: '#456456' };
const art = (slug, html) => journalThumbnail(slug, html, colors);

test('artwork is deterministic, slug-specific, and responds to document structure', () => {
  const body = '<p>A small beginning.</p>';
  assert.equal(art('first', body), art('first', body));
  assert.notEqual(art('first', body), art('second', body));
  assert.equal(art('first', body), art('first', '<p>A small beginning!</p>'));
  assert.notEqual(art('first', body), art('first', `${body}<h2>Another section</h2>`));
  assert.notEqual(art('first', body), art('first', `<p>${'word '.repeat(200)}</p>`));
});

test('artwork handles empty and large documents without publishing source text or scripts', () => {
  const empty = art('first', '');
  assert.doesNotMatch(empty, /NaN|Infinity|undefined/);
  assert.equal(art('first', '<p>Hello</p>'), art('first', '<!--private--><style>secret</style><script>secret</script><p>Hello</p>'));
  const large = art('first', '<p>Private prose &amp; more.</p>'.repeat(10000));
  assert.ok(large.length < 15000);
  assert.doesNotMatch(large, /Private|prose|NaN|Infinity|undefined/);
  assert.match(large, /fill="#faf9f6"/);
  assert.match(large, /stroke="#456456"/);
});
