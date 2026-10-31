import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, stat, realpath, rename, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import matter from 'gray-matter';
import { buildCatalog, validateRecord } from './model.mjs';
import { createR2Store, r2Config } from './r2-store.mjs';

const execute = promisify(execFile);
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function encodePreview(input, output) {
  await execute('ffmpeg', ['-v', 'error', '-nostdin', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', output]);
}

export async function preparePreviews({ root = defaultRoot, library = process.env.SERAPH_FRAGMENT_LIBRARY || '/Volumes/MusicArchive/_keepers', encode = encodePreview, progress = () => {} } = {}) {
  const source = path.join(root, 'apps/internal');
  const catalog = await buildCatalog(source);
  const fragments = catalog.records.filter((r) => r.type === 'MusicFragment');
  const libraryRoot = await realpath(library);
  const directory = path.join(root, 'tmp/music-fragment-previews');
  // Preflight every original before spending time encoding or uploading.
  const inputs = [];
  for (const record of fragments) {
    const input = await realpath(path.join(libraryRoot, record.data.file));
    if (!input.startsWith(libraryRoot + path.sep) || !(await stat(input)).isFile()) throw new Error(`Fragment is outside the sample library: ${record.id}`);
    inputs.push({ record, input, source_sha256: await digest(input) });
  }
  await mkdir(directory, { recursive: true });
  const prepared = [];
  for (const { record, input, source_sha256 } of inputs) {
    const file = path.join(directory, `${record.id}-${source_sha256}.m4a`);
    try { await stat(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const temporary = `${file}.${randomUUID()}.m4a`;
      try { await encode(input, temporary); await rename(temporary, file); }
      finally { await unlink(temporary).catch(() => {}); }
    }
    if (await digest(input) !== source_sha256) throw new Error(`Original changed during encoding; retry: ${record.id}`);
    const bytes = (await stat(file)).size;
    if (!bytes) throw new Error(`Empty preview: ${record.id}`);
    const sha256 = await digest(file);
    prepared.push({ id: record.id, source: record.source, file, source_sha256, sha256, bytes,
      key: `music-fragments/${record.id}/${sha256}.m4a` });
    progress(`Prepared ${prepared.length}/${inputs.length}`);
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(prepared, null, 2) + '\n');
  return prepared;
}

export async function uploadPreviews(prepared, { root = defaultRoot, store, progress = () => {} } = {}) {
  if (!store) throw new Error('R2 is not configured. Fill in .env.r2.local before uploading.');
  let uploaded = 0;
  let reused = 0;
  for (const item of prepared) {
    // Recheck local previews so an old manifest cannot upload different bytes.
    if (await digest(item.file) !== item.sha256) throw new Error(`Preview changed; prepare again: ${item.id}`);
    const filename = path.join(root, 'apps/internal', item.source);
    const original = await readFile(filename, 'utf8');
    const document = matter(original);
    validateRecord('MusicFragment', document.data, filename);
    if (document.data.id !== item.id) throw new Error(`Fragment identity changed: ${item.id}`);
    const valid = (remote) => remote.ContentLength === item.bytes && remote.ContentType === 'audio/mp4' && remote.Metadata?.sha256 === item.sha256;
    let remote;
    try { remote = await store.head(item.key); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404 && !['NotFound', 'NoSuchKey'].includes(error.name)) throw error; }
    if (remote) {
      if (!valid(remote)) throw new Error(`R2 object does not match this preview: ${item.id}`);
      reused++;
    } else {
      await store.put(item.key, await readFile(item.file), { sha256: item.sha256, 'source-sha256': item.source_sha256 });
      remote = await store.head(item.key);
      if (!valid(remote)) throw new Error(`R2 upload verification failed: ${item.id}`);
      uploaded++;
    }
    const previous = document.data.preview;
    const preview = { provider: 'r2', bucket: store.bucket, key: item.key, content_type: 'audio/mp4',
      sha256: item.sha256, source_sha256: item.source_sha256, bytes: item.bytes,
      uploaded_at: previous?.bucket === store.bucket && previous.key === item.key ? previous.uploaded_at : new Date().toISOString() };
    document.data.preview = preview;
    validateRecord('MusicFragment', document.data, filename);
    // Preserve record timestamps, bodies, and intervening manual edits.
    if (JSON.stringify(previous) !== JSON.stringify(preview)) {
      if (await readFile(filename, 'utf8') !== original) throw new Error(`Record changed during upload; rerun: ${item.id}`);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, matter.stringify(document.content, document.data), { flag: 'wx' }); await rename(temporary, filename); }
      finally { await unlink(temporary).catch(() => {}); }
    }
    progress(`Verified ${uploaded + reused}/${prepared.length}`);
  }
  return { uploaded, reused, total: prepared.length };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let store;
  try {
    const flags = new Set(process.argv.slice(2));
    if ([...flags].some((flag) => !['--prepare', '--create-bucket'].includes(flag))) throw new Error('Usage: npm run fragments:prepare OR npm run fragments:upload -- [--create-bucket]');
    if (!flags.has('--prepare')) {
      store = createR2Store(r2Config());
      if (!store) throw new Error('R2 is not configured. Fill in .env.r2.local before uploading.');
    }
    const prepared = await preparePreviews({ progress: (message) => console.log(message) });
    const bytes = prepared.reduce((total, item) => total + item.bytes, 0);
    if (flags.has('--prepare')) console.log(JSON.stringify({ prepared: prepared.length, bytes, manifest: 'tmp/music-fragment-previews/manifest.json' }));
    else {
      if (flags.has('--create-bucket')) await store.createBucket();
      console.log(JSON.stringify(await uploadPreviews(prepared, { store, progress: (message) => console.log(message) })));
    }
  } catch (error) {
    // Do not print SDK request objects, signed URLs, credentials, or response bodies.
    console.error(error.$metadata ? `R2 request failed (${error.name}, HTTP ${error.$metadata.httpStatusCode || 'unknown'}). Check bucket permissions and credentials.` : error.message);
    process.exitCode = 1;
  } finally { store?.close(); }
}
