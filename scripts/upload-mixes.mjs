import { readFile, writeFile, realpath, stat, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readMixes, readMixManifest, mixTypes } from './mix-media.mjs';
import { buildCatalog } from './model.mjs';
import { createR2Store, mediaR2Config } from './r2-store.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
export async function uploadMixes({ root = defaultRoot, store, progress = () => {} } = {}) {
  if (!store) throw new Error('Set R2_MEDIA_BUCKET and R2 credentials in .env.r2.local before uploading.');
  const source = path.join(root, 'apps/internal');
  const mixes = await readMixes(source);
  await buildCatalog(source, mixes); // Validate song associations before uploading anything.
  const manifest = await readMixManifest(source);
  const manifestFile = path.join(source, 'data/mix-media.json');
  let original = await readFile(manifestFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const directory = await realpath(path.join(source, 'media/mixes'));
  const inputs = [];
  for (const mix of mixes) {
    let file;
    try { file = await realpath(path.join(directory, mix.file)); }
    catch (error) { if (error.code === 'ENOENT' && mix.remote) continue; throw error; }
    if (!file.startsWith(directory + path.sep) || !(await stat(file)).isFile()) throw new Error(`Mix must stay inside the mixes folder: ${mix.file}`);
    inputs.push({ mix, file });
  }
  let uploaded = 0, reused = 0;
  for (const { mix, file } of inputs) {
    const body = await readFile(file);
    if (!body.length) throw new Error(`Empty mix: ${mix.file}`);
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = `mixes/${mix.file}/${sha256}`;
    const content_type = mixTypes[mix.format.toLowerCase()];
    const valid = remote => remote.ContentLength === body.length && remote.ContentType === content_type && remote.Metadata?.sha256 === sha256;
    let remote;
    try { remote = await store.head(key); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404 && !['NotFound', 'NoSuchKey'].includes(error.name)) throw error; }
    if (remote) {
      if (!valid(remote)) throw new Error(`R2 object does not match mix: ${mix.file}`);
      reused++;
    } else {
      await store.put(key, body, { sha256 }, content_type);
      if (!valid(await store.head(key))) throw new Error(`R2 upload verification failed: ${mix.file}`);
      uploaded++;
    }
    const previous = manifest.files.find(item => item.file === mix.file);
    const entry = { file: mix.file, remote: { provider: 'r2', bucket: store.bucket, key, content_type, sha256, bytes: body.length,
      uploaded_at: previous?.remote.bucket === store.bucket && previous.remote.key === key ? previous.remote.uploaded_at : new Date().toISOString() } };
    if (JSON.stringify(entry) !== JSON.stringify(previous)) {
      const current = await readFile(manifestFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (current !== original) throw new Error('Mix manifest changed during upload; rerun.');
      manifest.files = manifest.files.filter(item => item.file !== mix.file).concat(entry).sort((a, b) => a.file.localeCompare(b.file));
      const updated = JSON.stringify(manifest, null, 2) + '\n';
      const temporary = `${manifestFile}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, updated, { flag: 'wx' }); await rename(temporary, manifestFile); }
      finally { await unlink(temporary).catch(() => {}); }
      original = updated;
    }
    progress(`Verified ${uploaded + reused}/${inputs.length}: ${mix.file}`);
  }
  return { uploaded, reused, total: inputs.length };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let store;
  try {
    const flags = process.argv.slice(2);
    if (flags.some(flag => flag !== '--create-bucket')) throw new Error('Usage: npm run mixes:upload -- [--create-bucket]');
    store = createR2Store(mediaR2Config());
    if (!store) throw new Error('Set R2_MEDIA_BUCKET and R2 credentials in .env.r2.local before uploading.');
    if (flags.includes('--create-bucket')) await store.createBucket();
    console.log(JSON.stringify(await uploadMixes({ store, progress: console.log })));
  } catch (error) {
    console.error(error.$metadata ? `R2 request failed (${error.name}, HTTP ${error.$metadata.httpStatusCode || 'unknown'}). Check media bucket permissions and credentials.` : error.message);
    process.exitCode = 1;
  } finally { store?.close(); }
}
