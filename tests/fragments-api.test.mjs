import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable, Readable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, rm, symlink, copyFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { fragmentsApi, audioRange } from '../scripts/fragments-api.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-audio-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = path.join(root, 'library');
  const records = path.join(root, 'apps/internal/data/music-fragments');
  await mkdir(library);
  await mkdir(records, { recursive: true });
  async function record(id, file, extra = {}) {
    await writeFile(path.join(records, `${id}.md`), matter.stringify('', { id, root: 'music-keepers', file, ...extra }));
  }
  await writeFile(path.join(library, 'sample.wav'), '0123456789');
  await record('sample', 'sample.wav');
  return { root, library, record };
}

async function request(api, url, { method = 'GET', headers = {} } = {}) {
  const chunks = [];
  const res = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
  res.writeHead = (status, values) => { res.status = status; res.headers = values; res.headersSent = true; };
  const done = once(res, 'finish');
  await api({ url, method, headers: { host: '127.0.0.1:5175', ...headers } }, res, () => { res.writeHead(404, {}); res.end(); });
  await done;
  return { status: res.status, headers: res.headers, body: Buffer.concat(chunks).toString() };
}

test('audio ranges support seeking and reject unsatisfiable or multipart ranges', () => {
  assert.equal(audioRange(undefined, 10), null);
  assert.deepEqual(audioRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(audioRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(audioRange('bytes=-3', 10), { start: 7, end: 9 });
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'other']) assert.equal(audioRange(range, 10), false);
});

test('hosted previews play and seek without the archive drive, while cloud errors fall back to the original', async (t) => {
  const { root, library, record } = await fixture(t);
  const preview = { provider: 'r2', bucket: 'seraph-music-fragments', key: `music-fragments/hosted/${'a'.repeat(64)}.m4a`,
    content_type: 'audio/mp4', sha256: 'a'.repeat(64), source_sha256: 'b'.repeat(64), bytes: 10, uploaded_at: '2026-10-31T20:00:00Z' };
  await record('hosted', 'missing.wav', { preview });
  const calls = [];
  const api = fragmentsApi(root, { library: path.join(root, 'disconnected'), cloud: {
    async audio(value, options) {
      calls.push(options);
      assert.equal(value.key, preview.key);
      return { ContentLength: options.range ? 4 : 10, Body: options.head ? undefined : Readable.from(options.range ? '2345' : '0123456789') };
    },
  } });
  t.after(() => api.close());
  assert.equal((await request(api, '/api/fragments/hosted/audio')).body, '0123456789');
  const range = await request(api, '/api/fragments/hosted/audio', { headers: { range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers['Content-Range'], 'bytes 2-5/10');
  assert.equal(range.body, '2345');
  assert.equal((await request(api, '/api/fragments/hosted/audio', { method: 'HEAD' })).body, '');
  assert.equal((await request(api, '/api/fragments/hosted/audio', { headers: { range: 'bytes=100-' } })).status, 416);
  assert.equal(calls.length, 3);
  await record('sample', 'sample.wav', { preview });
  const fallback = fragmentsApi(root, { library, cloud: { audio: async () => { throw new Error('offline'); } } });
  t.after(() => fallback.close());
  assert.equal((await request(fallback, '/api/fragments/sample/audio')).body, '0123456789');
});

test('fragment audio streams registered files with range and HEAD support', async (t) => {
  const { root, library } = await fixture(t);
  const api = fragmentsApi(root, { library });
  t.after(() => api.close());
  const full = await request(api, '/api/fragments/sample/audio');
  assert.equal(full.status, 200);
  assert.equal(full.body, '0123456789');
  assert.equal(full.headers['Content-Type'], 'audio/wav');
  const partial = await request(api, '/api/fragments/sample/audio', { headers: { range: 'bytes=2-5' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.body, '2345');
  assert.equal(partial.headers['Content-Range'], 'bytes 2-5/10');
  const head = await request(api, '/api/fragments/sample/audio', { method: 'HEAD' });
  assert.equal(head.body, '');
  assert.equal(head.headers['Content-Length'], 10);
  const invalid = await request(api, '/api/fragments/sample/audio', { headers: { range: 'bytes=10-' } });
  assert.equal(invalid.status, 416);
});

test('fragment audio rejects remote requests, unknown IDs, missing audio, and escaping symlinks', async (t) => {
  const { root, library, record } = await fixture(t);
  const api = fragmentsApi(root, { library });
  t.after(() => api.close());
  for (const headers of [{ host: 'example.com' }, { origin: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await request(api, '/api/fragments/sample/audio', { headers })).status, 403);
  }
  assert.equal((await request(api, '/api/fragments/sample/audio', { method: 'POST' })).status, 405);
  assert.equal((await request(api, '/api/fragments/missing/audio')).status, 404);
  assert.equal((await request(api, '/api/fragments/../sample/audio')).status, 404);
  await record('missing-file', 'missing.wav');
  assert.match((await request(api, '/api/fragments/missing-file/audio')).body, /Connect the MusicArchive drive/);
  await writeFile(path.join(root, 'outside.wav'), 'private');
  await symlink(path.join(root, 'outside.wav'), path.join(library, 'escape.wav'));
  await record('escape', 'escape.wav');
  assert.equal((await request(api, '/api/fragments/escape/audio')).status, 403);
});

test('AIF previews convert once across concurrent plays, cache results, and retry conversion failures', async (t) => {
  const { root, library, record } = await fixture(t);
  await writeFile(path.join(library, 'sample.aif'), 'converted audio');
  await record('aif', 'sample.aif');
  let conversions = 0;
  const api = fragmentsApi(root, { library, convert: async (input, output) => { conversions++; await copyFile(input, output); } });
  t.after(() => api.close());
  const plays = await Promise.all([request(api, '/api/fragments/aif/audio'), request(api, '/api/fragments/aif/audio')]);
  assert.ok(plays.every((r) => r.status === 200 && r.body === 'converted audio' && r.headers['Content-Type'] === 'audio/wav'));
  assert.equal(conversions, 1);
  let attempts = 0;
  const retry = fragmentsApi(root, { library, convert: async (input, output) => {
    if (++attempts === 1) throw new Error('conversion failed');
    await copyFile(input, output);
  } });
  t.after(() => retry.close());
  assert.equal((await request(retry, '/api/fragments/aif/audio')).status, 503);
  assert.equal((await request(retry, '/api/fragments/aif/audio')).status, 200);
});
