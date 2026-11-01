import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';

const buckets = {
  MIX_AUDIO: ['seraph-music-media', 'seraph-music-media-preview'],
  FRAGMENT_AUDIO: ['seraph-music-fragments', 'seraph-music-fragments-preview'],
};

// Production objects are read only. Only the two fixed preview buckets are written.
export async function seedPreview(env, manifest, progress = () => {}) {
  let copied = 0, reused = 0;
  const refs = Object.values(manifest.routes);
  for (const ref of refs) {
    if (!Object.hasOwn(buckets, ref.binding)) throw new Error('Unknown audio binding.');
    const source = env[`${ref.binding}_SOURCE`], destination = env[`${ref.binding}_PREVIEW`];
    const matches = object => object?.size === ref.bytes && object.customMetadata?.sha256 === ref.sha256 &&
      object.httpMetadata?.contentType === ref.content_type;
    const previous = await destination.head(ref.key);
    if (previous) {
      if (!matches(previous)) throw new Error('Preview object differs from the committed reference; refusing overwrite.');
      reused++;
    } else {
      const original = await source.get(ref.key);
      if (!original || !matches(original)) {
        await original?.body?.cancel();
        throw new Error('Source audio is missing or differs from the committed reference.');
      }
      await destination.put(ref.key, original.body, {
        sha256: ref.sha256,
        httpMetadata: { contentType: ref.content_type, cacheControl: 'private, no-cache' },
        customMetadata: { sha256: ref.sha256 },
        onlyIf: { etagDoesNotMatch: '*' },
      });
      if (!matches(await destination.head(ref.key))) throw new Error('Preview audio verification failed.');
      copied++;
    }
    progress({ copied, reused, total: refs.length });
  }
  return { copied, reused, total: refs.length };
}

async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const exec = promisify(execFile);
  const revision = (await exec('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  const release = JSON.parse(await readFile(path.join(root, 'dist/seraphic-systems/release.json'), 'utf8'));
  if (release.revision !== revision) throw new Error('Run npm run build:production before seeding preview audio.');
  const config = JSON.parse((await exec('git', ['-C', root, 'show', 'HEAD:wrangler.json'])).stdout);
  const manifest = JSON.parse(await readFile(path.join(root, 'dist/cloudflare/audio-manifest.json'), 'utf8'));
  const temporary = await mkdtemp(path.join(tmpdir(), 'seraph-preview-audio-'));
  let proxy;
  try {
    const configPath = path.join(temporary, 'wrangler.json');
    await writeFile(configPath, JSON.stringify({ name: 'seraph-preview-audio-seed', account_id: config.account_id,
      compatibility_date: config.compatibility_date,
      r2_buckets: Object.entries(buckets).flatMap(([binding, [source, destination]]) => [
        { binding: `${binding}_SOURCE`, bucket_name: source, remote: true },
        { binding: `${binding}_PREVIEW`, bucket_name: destination, remote: true },
      ]),
    }));
    proxy = await getPlatformProxy({ configPath, persist: false });
    const result = await seedPreview(proxy.env, manifest, ({ copied, reused, total }) => {
      if ((copied + reused) % 10 === 0 || copied + reused === total) console.log(`Preview audio: ${copied} copied, ${reused} reused, ${total} total.`);
    });
    console.log(JSON.stringify(result));
  } finally {
    await proxy?.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
