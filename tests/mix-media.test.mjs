import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { Writable, Readable } from 'node:stream';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { uploadMixes } from '../scripts/upload-mixes.mjs';
import { mixesApi } from '../scripts/mixes-api.mjs';
import { buildInternal } from '../scripts/internal.mjs';
import { readMixManifest } from '../scripts/mix-media.mjs';
import { mediaR2Config } from '../scripts/r2-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-mixes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'apps/internal');
  for (const dir of ['data/songs', 'media/mixes', 'dashboard']) await mkdir(path.join(source, dir), { recursive: true });
  await writeFile(path.join(source, 'dashboard/index.html'), 'Mix library');
  await writeFile(path.join(source, 'data/songs/renamed.md'), '---\nid: song\ntitle: Song\n---\n');
  const file = path.join(source, 'media/mixes/song-2026-01-01.mp3');
  await writeFile(file, '0123456789');
  const objects = new Map();
  const store = { bucket: 'seraph-music-media',
    head: async key => { if (!objects.has(key)) throw Object.assign(new Error('missing'), { name: 'NotFound' }); return objects.get(key); },
    put: async (key, body, metadata, contentType) => { objects.set(key, { ContentLength: body.length, ContentType: contentType, Metadata: metadata, body }); },
    audio: async (remote, { range, head }) => {
      const object = objects.get(remote.key);
      if (!object) throw new Error('offline');
      const bytes = range ? object.body.subarray(2, 6) : object.body;
      return { ContentLength: bytes.length, Body: head ? undefined : Readable.from(bytes) };
    },
  };
  return { root, source, file, store, objects, manifest: path.join(source, 'data/mix-media.json') };
}
async function request(api, { file = 'song-2026-01-01.mp3', method = 'GET', headers = {}, url = `/api/mixes/${file}/audio` } = {}) {
  const chunks = [];
  const res = new Writable({ write(chunk, encoding, cb) { chunks.push(chunk); cb(); } });
  res.writeHead = (status, values) => { res.status = status; res.headers = values; res.headersSent = true; };
  const done = once(res, 'finish');
  await api({ url, method, headers: { host: 'localhost:5175', ...headers } }, res, () => { res.writeHead(404, {}); res.end(); });
  await done;
  return { status: res.status, headers: res.headers, body: Buffer.concat(chunks).toString() };
}

test('mix upload verifies MIME, size and hash, resumes, retains old objects, and builds without local media', async t => {
  const { root, source, file, store, objects, manifest } = await fixture(t);
  assert.deepEqual(await uploadMixes({ root, store }), { uploaded: 1, reused: 0, total: 1 });
  const before = await readFile(manifest, 'utf8');
  const first = JSON.parse(before).files[0];
  assert.equal(first.remote.content_type, 'audio/mpeg');
  assert.deepEqual(await uploadMixes({ root, store }), { uploaded: 0, reused: 1, total: 1 });
  assert.equal(await readFile(manifest, 'utf8'), before);
  await writeFile(file, 'new original');
  await uploadMixes({ root, store });
  assert.equal(objects.size, 2);
  assert.notEqual(JSON.parse(await readFile(manifest, 'utf8')).files[0].remote.key, first.remote.key);
  await rm(path.join(source, 'media'), { recursive: true });
  const output = path.join(root, 'output');
  await buildInternal(source, output);
  const [song] = JSON.parse(await readFile(path.join(output, 'songs.json'), 'utf8'));
  assert.equal(song.mixes.length, 1);
  assert.equal(song.mixes[0].url, 'api/mixes/song-2026-01-01.mp3/audio');
  await assert.rejects(access(path.join(output, 'media')));
  const catalog = JSON.parse(await readFile(path.join(output, 'catalog.json'), 'utf8'));
  assert.equal(catalog.records.find(record => record.type === 'MixFile').data.remote.bucket, store.bucket);
});

test('failed verification never records an upload', async t => {
  const { root, store, manifest } = await fixture(t);
  let reads = 0;
  store.head = async () => { if (!reads++) throw Object.assign(new Error('missing'), { name: 'NotFound' }); return { ContentLength: 999 }; };
  await assert.rejects(uploadMixes({ root, store }), /verification failed/);
  await assert.rejects(access(manifest));
});

test('mixes stream remotely without local audio, seek, support HEAD, and fall back locally on cloud errors', async t => {
  const { root, source, file, store } = await fixture(t);
  await uploadMixes({ root, store });
  const api = mixesApi(root, { cloud: store });
  const local = mixesApi(root, { cloud: { audio: async () => { throw new Error('offline'); } } });
  assert.equal((await request(local)).body, '0123456789');
  const partial = await request(local, { headers: { range: 'bytes=2-5' } });
  assert.equal(partial.status, 206); assert.equal(partial.body, '2345');
  await rm(file);
  assert.equal((await request(api)).body, '0123456789');
  assert.equal((await request(api)).headers['Content-Type'], 'audio/mpeg');
  const remoteRange = await request(api, { headers: { range: 'bytes=2-5' } });
  assert.equal(remoteRange.status, 206); assert.equal(remoteRange.body, '2345');
  assert.equal(remoteRange.headers['Content-Range'], 'bytes 2-5/10');
  const head = await request(api, { method: 'HEAD' });
  assert.equal(head.body, ''); assert.equal(head.headers['Content-Length'], 10);
  assert.equal((await request(api, { headers: { range: 'bytes=10-' } })).status, 416);
  assert.equal((await request(local)).status, 404);
  // The registered song can have a filename different from its stable ID.
  assert.ok(await readFile(path.join(source, 'data/songs/renamed.md')));
});

test('local-only mixes play and reject cross-site requests, traversal, methods and escaping symlinks', async t => {
  const { root, source, file } = await fixture(t);
  const api = mixesApi(root, { cloud: null });
  assert.equal((await request(api)).body, '0123456789');
  assert.equal((await request(api, { method: 'HEAD' })).body, '');
  assert.equal((await request(api, { headers: { range: 'bytes=100-' } })).status, 416);
  for (const headers of [{ host: 'example.com' }, { origin: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await request(api, { headers })).status, 403);
  assert.equal((await request(api, { method: 'POST' })).status, 405);
  assert.equal((await request(api, { file: '%2e%2e%2fprivate.wav' })).status, 404);
  assert.equal((await request(api, { file: 'unknown-2026-01-01.mp3' })).status, 404);
  // Registered remote entries must not allow fallback symlinks outside media.
  await uploadMixes({ root, store: (await fixture(t)).store });
  await rm(file);
  await writeFile(path.join(root, 'secret.mp3'), 'secret');
  await symlink(path.join(root, 'secret.mp3'), file);
  assert.equal((await request(api)).status, 403);
  const registry = await readMixManifest(source);
  registry.files[0].file = '../secret.mp3';
  await writeFile(path.join(source, 'data/mix-media.json'), JSON.stringify(registry));
  await assert.rejects(readMixManifest(source), /name mixes/);
});

test('media configuration supports shared and separate credentials without changing the fragment bucket', () => {
  assert.equal(mediaR2Config({}), null);
  const env = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'seraph-music-fragments', R2_MEDIA_BUCKET: 'seraph-music-media', R2_ACCESS_KEY_ID: 'shared', R2_SECRET_ACCESS_KEY: 'secret' };
  assert.equal(mediaR2Config(env).bucket, 'seraph-music-media');
  assert.equal(mediaR2Config(env).credentials.accessKeyId, 'shared');
  assert.equal(mediaR2Config({ ...env, R2_MEDIA_ACCESS_KEY_ID: 'media', R2_MEDIA_SECRET_ACCESS_KEY: 'media-secret' }).credentials.accessKeyId, 'media');
  assert.equal(env.R2_BUCKET, 'seraph-music-fragments');
  assert.throws(() => mediaR2Config({ ...env, R2_MEDIA_ACCESS_KEY_ID: 'media' }), /Set both/);
});
