import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioWorker } from '../scripts/cloudflare/audio-worker.mjs';
import { audioManifest } from '../scripts/cloudflare/build-audio.mjs';
import { seedPreview } from '../scripts/cloudflare/seed-preview.mjs';

const sha256 = 'a'.repeat(64);
const remote = { provider: 'r2', bucket: 'seraph-music-media', key: `mixes/song-2026-01-01.mp3/${sha256}`,
  sha256, bytes: 10, content_type: 'audio/mpeg' };
const songs = [{ id: 'song', mixes: [{ file: 'song-2026-01-01.mp3', remote }] }];
const preview = { ...remote, bucket: 'seraph-music-fragments', key: `music-fragments/fragment-one/${sha256}.m4a`, content_type: 'audio/mp4' };
const catalog = { records: [{ type: 'MusicFragment', data: { id: 'fragment-one', root: 'music-keepers', preview } }] };
const manifest = audioManifest(songs, catalog);
const mixRoute = '/api/mixes/song-2026-01-01.mp3/audio';
const fragmentRoute = '/api/fragments/fragment-one/audio';

function fixture() {
  const gets = [], heads = [];
  const bytes = new TextEncoder().encode('0123456789');
  const metadata = ref => ({ size: ref.bytes, etag: 'storage-etag', customMetadata: { sha256: ref.sha256 },
    httpMetadata: { contentType: ref.content_type } });
  const bucket = ref => ({
    head: async key => { heads.push(key); return metadata(ref); },
    get: async (key, options) => {
      gets.push({ key, options });
      const range = options?.range;
      const body = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
      return { ...metadata(ref), ...(range ? { range } : {}), body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }) };
    },
  });
  const env = { MIX_AUDIO: bucket(remote), FRAGMENT_AUDIO: bucket(preview), ASSETS: { fetch: async () => new Response('Static page') } };
  const worker = createAudioWorker(manifest);
  const request = (route = mixRoute, options = {}) => worker.fetch(new Request(`https://example.test${route}`, options), env);
  return { env, gets, heads, request, metadata };
}

test('manifest exposes only explicit remote references and validates identity, buckets and immutable keys', () => {
  assert.deepEqual(Object.keys(manifest.routes), [mixRoute, fragmentRoute]);
  assert.equal(manifest.routes[mixRoute].binding, 'MIX_AUDIO');
  assert.equal(manifest.routes[fragmentRoute].binding, 'FRAGMENT_AUDIO');
  assert.deepEqual(audioManifest([{ id: 'song', mixes: [{ file: 'local.wav' }] }], { records: [{ type: 'MusicFragment', data: { id: 'unuploaded' } }] }).routes, {});
  for (const changes of [{ bucket: 'another-bucket' }, { key: 'arbitrary-key' }, { bytes: 0 }, { content_type: 'text/html' }]) {
    assert.throws(() => audioManifest([{ id: 'song', mixes: [{ file: songs[0].mixes[0].file, remote: { ...remote, ...changes } }] }], catalog), /Invalid hosted audio/);
  }
  assert.throws(() => audioManifest([{ ...songs[0], id: 'another-song' }], catalog), /another song/);
  const changed = structuredClone(catalog);
  changed.records[0].data.preview.key = `music-fragments/another-id/${sha256}.m4a`;
  assert.throws(() => audioManifest(songs, changed), /Invalid hosted audio/);
});

test('mixes and fragments stream without buffering, with browser MIME and safe cache headers', async () => {
  const { request, gets } = fixture();
  for (const [route, mime] of [[mixRoute, 'audio/mpeg'], [fragmentRoute, 'audio/mp4']]) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), mime);
    assert.equal(response.headers.get('Content-Length'), '10');
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-cache');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(await response.text(), '0123456789');
  }
  assert.equal(gets[0].options.onlyIf.etagMatches, 'storage-etag');
});

test('seeking handles bounded, open-ended, suffix and clipped ranges for both audio types', async () => {
  const { request, gets } = fixture();
  for (const route of [mixRoute, fragmentRoute]) for (const [range, body, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-999', '89', 'bytes 8-9/10'],
  ]) {
    const response = await request(route, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), contentRange);
    assert.equal(response.headers.get('Content-Length'), String(body.length));
    assert.equal(await response.text(), body);
  }
  assert.deepEqual(gets[0].options.range, { offset: 2, length: 4 });
});

test('HEAD has no audio read; validators and If-Range avoid returning bytes from a different representation', async () => {
  const { request, gets } = fixture();
  const head = await request(mixRoute, { method: 'HEAD', headers: { Range: 'bytes=2-5' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '10');
  assert.equal(await head.text(), '');
  assert.equal(gets.length, 0);
  const etag = head.headers.get('ETag');
  const cached = await request(mixRoute, { headers: { 'If-None-Match': `"another", W/${etag}` } });
  assert.equal(cached.status, 304);
  assert.equal(gets.length, 0);
  const mismatch = await request(mixRoute, { headers: { Range: 'bytes=2-5', 'If-Range': '"old"' } });
  assert.equal(mismatch.status, 200);
  assert.equal(await mismatch.text(), '0123456789');
  const matching = await request(mixRoute, { headers: { Range: 'bytes=2-5', 'If-Range': etag } });
  assert.equal(matching.status, 206);
  assert.equal(await matching.text(), '2345');
});

test('invalid ranges are 416 and cannot cause full object reads', async () => {
  const { request, gets } = fixture();
  for (const range of ['bytes=10-', 'bytes=7-2', 'bytes=-0', 'bytes=', 'bytes=1-2,4-5', 'bytes=999999999999999999999999999999-']) {
    const response = await request(mixRoute, { headers: { Range: range } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('Content-Range'), 'bytes */10');
  }
  assert.equal(gets.length, 0);
});

test('unknown routes, alternate object paths and writes never access storage; static pages pass through', async () => {
  const { request, heads } = fixture();
  for (const route of ['/api/mixes/unknown.mp3/audio', '/api/fragments/missing/audio', '/api/r2/list', '/api/mixes/%2Fprivate/audio', '/api/__proto__']) {
    assert.equal((await request(route)).status, 404);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await request(mixRoute, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
  assert.equal(heads.length, 0);
  assert.equal(await (await request('/orb/')).text(), 'Static page');
});

test('missing objects, bindings, corrupt metadata, storage failures and read races fail closed', async () => {
  const { env, request, metadata, gets } = fixture();
  env.MIX_AUDIO.head = async () => null;
  assert.equal((await request()).status, 404);
  for (const changes of [{ size: 9 }, { customMetadata: {} }, { httpMetadata: { contentType: 'text/html' } }]) {
    env.MIX_AUDIO.head = async () => ({ ...metadata(remote), ...changes });
    assert.equal((await request()).status, 503);
  }
  assert.equal(gets.length, 0);
  env.MIX_AUDIO.head = async () => { throw new Error('private storage details'); };
  const unavailable = await request();
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private storage details/);
  env.MIX_AUDIO.head = async () => metadata(remote);
  env.MIX_AUDIO.get = async () => metadata(remote); // R2 precondition failed: no body.
  assert.equal((await request()).status, 503);
  delete env.MIX_AUDIO;
  assert.equal((await request()).status, 503);
});

test('preview seeding only writes preview objects, verifies checksums and resumes without overwrites', async () => {
  const objects = new Map();
  let reads = 0, writes = 0;
  const metadata = { size: 10, customMetadata: { sha256 }, httpMetadata: { contentType: 'audio/mpeg' } };
  const env = {
    MIX_AUDIO_SOURCE: { get: async () => { reads++; return { ...metadata, body: 'audio-stream' }; } },
    MIX_AUDIO_PREVIEW: {
      head: async key => objects.get(key),
      put: async (key, body, options) => {
        writes++;
        assert.equal(body, 'audio-stream');
        assert.equal(options.sha256, sha256);
        assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' });
        objects.set(key, metadata);
      },
    },
  };
  const selected = { routes: { [mixRoute]: manifest.routes[mixRoute] } };
  assert.deepEqual(await seedPreview(env, selected), { copied: 1, reused: 0, total: 1 });
  assert.deepEqual(await seedPreview(env, selected), { copied: 0, reused: 1, total: 1 });
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  objects.set(remote.key, { ...metadata, size: 11 });
  await assert.rejects(seedPreview(env, selected), /refusing overwrite/);
  assert.equal(writes, 1);
});
