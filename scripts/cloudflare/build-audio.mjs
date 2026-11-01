import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mixIdentity, mixTypes } from '../mix-media.mjs';

export function audioManifest(songs, catalog) {
  const routes = {};
  function add(route, ref, binding, bucket, key, contentType) {
    if (ref.provider !== 'r2' || ref.bucket !== bucket || ref.key !== key || ref.content_type !== contentType ||
        !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || Object.hasOwn(routes, route)) {
      throw new Error(`Invalid hosted audio reference: ${route}`);
    }
    routes[route] = { binding, key, sha256: ref.sha256, bytes: ref.bytes, content_type: contentType };
  }
  for (const song of songs) for (const mix of song.mixes) {
    if (!mix.remote) continue; // Local-only drafts never become hosted audio.
    const identity = mixIdentity(mix.file);
    if (identity.id !== song.id) throw new Error(`Hosted mix belongs to another song: ${mix.file}`);
    add(`/api/mixes/${encodeURIComponent(mix.file)}/audio`, mix.remote, 'MIX_AUDIO', 'seraph-music-media',
      `mixes/${mix.file}/${mix.remote.sha256}`, mixTypes[identity.format.toLowerCase()]);
  }
  for (const { type, data } of catalog.records) {
    if (type !== 'MusicFragment' || !data.preview) continue;
    if (data.root !== 'music-keepers' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id)) throw new Error('Invalid hosted fragment identity.');
    add(`/api/fragments/${data.id}/audio`, data.preview, 'FRAGMENT_AUDIO', 'seraph-music-fragments',
      `music-fragments/${data.id}/${data.preview.sha256}.m4a`, 'audio/mp4');
  }
  return { schema_version: 1, routes };
}

export async function buildAudio(publicOutput, output) {
  const songs = JSON.parse(await readFile(path.join(publicOutput, 'songs.json'), 'utf8'));
  const catalog = JSON.parse(await readFile(path.join(publicOutput, 'catalog.json'), 'utf8'));
  const manifest = audioManifest(songs, catalog);
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'runtime'), { recursive: true });
  await cp(new URL('./audio-worker.mjs', import.meta.url), path.join(output, 'runtime/audio-worker.mjs'));
  await cp(new URL('../audio-range.mjs', import.meta.url), path.join(output, 'audio-range.mjs'));
  await writeFile(path.join(output, 'audio-manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(output, 'worker.mjs'),
    "import { createAudioWorker } from './runtime/audio-worker.mjs';\nimport manifest from './audio-manifest.json';\nexport default createAudioWorker(manifest);\n");
}
