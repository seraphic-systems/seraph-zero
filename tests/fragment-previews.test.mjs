import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { preparePreviews, uploadPreviews } from '../scripts/upload-fragment-previews.mjs';
import { r2Config } from '../scripts/r2-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-preview-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = path.join(root, 'audio');
  const directory = path.join(root, 'apps/internal/data/music-fragments');
  await mkdir(library);
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'fragment-one.md');
  await writeFile(path.join(library, 'one.wav'), 'original audio');
  await writeFile(filename, matter.stringify('My notes\n', { id: 'fragment-one', root: 'music-keepers', file: 'one.wav', created_at: '2026-01-01T00:00:00Z' }));
  const objects = new Map();
  const store = { bucket: 'seraph-music-fragments',
    head: async (key) => { if (!objects.has(key)) throw Object.assign(new Error('Not found'), { name: 'NotFound' }); return objects.get(key); },
    put: async (key, body, metadata) => { objects.set(key, { ContentLength: body.length, ContentType: 'audio/mp4', Metadata: metadata }); },
  };
  return { root, library, filename, objects, store };
}

test('preview uploads verify remote objects before recording them, reuse objects, and preserve timestamps and notes', async (t) => {
  const { root, library, filename, store, objects } = await fixture(t);
  let encodes = 0;
  const encode = async (input, output) => { encodes++; await copyFile(input, output); };
  const prepared = await preparePreviews({ root, library, encode });
  assert.equal(prepared.length, 1);
  await preparePreviews({ root, library, encode });
  assert.equal(encodes, 1);
  assert.deepEqual(await uploadPreviews(prepared, { root, store }), { total: 1, uploaded: 1, reused: 0 });
  assert.equal(objects.size, 1);
  const first = await readFile(filename, 'utf8');
  const document = matter(first);
  assert.equal(document.data.preview.bucket, store.bucket);
  assert.equal(document.data.created_at, '2026-01-01T00:00:00Z');
  assert.equal(document.content.trim(), 'My notes');
  assert.deepEqual(await uploadPreviews(prepared, { root, store }), { total: 1, uploaded: 0, reused: 1 });
  assert.equal(await readFile(filename, 'utf8'), first);
  await writeFile(path.join(library, 'one.wav'), 'changed source');
  const changed = await preparePreviews({ root, library, encode });
  assert.notEqual(changed[0].key, prepared[0].key);
  assert.equal(changed[0].id, prepared[0].id);
});

test('failed verification and tampered previews never mark a fragment as uploaded', async (t) => {
  const { root, library, filename } = await fixture(t);
  const prepared = await preparePreviews({ root, library, encode: copyFile });
  const before = await readFile(filename, 'utf8');
  const store = { bucket: 'seraph-music-fragments', head: async () => ({ ContentLength: 100 }), put: async () => {} };
  await assert.rejects(uploadPreviews(prepared, { root, store }), /does not match/);
  assert.equal(await readFile(filename, 'utf8'), before);
  let reads = 0;
  store.head = async () => { if (!reads++) throw Object.assign(new Error('missing'), { name: 'NotFound' }); return { ContentLength: 1 }; };
  await assert.rejects(uploadPreviews(prepared, { root, store }), /verification failed/);
  assert.equal(await readFile(filename, 'utf8'), before);
  await writeFile(prepared[0].file, 'tampered');
  await assert.rejects(uploadPreviews(prepared, { root, store }), /Preview changed/);
});

test('R2 configuration stays server-side and restricts credentials to Cloudflare endpoints', () => {
  assert.equal(r2Config({}), null);
  assert.throws(() => r2Config({ R2_BUCKET: 'seraph-music-fragments' }), /Missing R2 configuration/);
  const env = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'seraph-music-fragments', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret' };
  assert.equal(r2Config(env).endpoint, `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  assert.throws(() => r2Config({ ...env, R2_ENDPOINT: 'https://example.com' }), /Cloudflare R2/);
  assert.equal(r2Config({ ...env, R2_ENDPOINT: `https://${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com` }).bucket, env.R2_BUCKET);
});
