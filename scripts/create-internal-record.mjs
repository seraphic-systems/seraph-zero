import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { validateRecord } from './model.mjs';

const directories = { Member: 'members', Horizon: 'horizons', Policy: 'policies', Album: 'albums', AlbumTrack: 'album-tracks', Song: 'songs', Idea: 'ideas', Note: 'notes', Page: 'pages', MusicFragment: 'music-fragments', Mix: 'mixes', StemExport: 'stems', Project: 'projects' };
const defaultSource = fileURLToPath(new URL('../apps/internal/', import.meta.url));

// The creation boundary stamps once. Loading, editing and rebuilding never stamp.
export async function createInternalRecord(type, metadata, { source = defaultSource } = {}) {
  if (!Object.hasOwn(directories, type)) throw new Error(`Choose a Markdown record type: ${Object.keys(directories).join(', ')}`);
  if (['Note', 'Page'].includes(type) && metadata === undefined) {
    const noun = type.toLowerCase();
    metadata = { id: `${noun}-${randomUUID()}`, title: `Untitled ${noun}`, ...(type === 'Note' ? { related_notes: [] } : {}) };
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Front matter must be a JSON object.');
  const data = { visibility: 'private', ...metadata, created_at: metadata.created_at ?? new Date().toISOString() };
  validateRecord(type, data, 'New record');
  const id = type === 'Mix' ? `${data.song}-${data.date}` : data.id;
  const stage = type === 'StemExport' ? data.folder.split('/')[2] : '';
  const file = path.join(source, 'data', directories[type], stage, `${id}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  // Never replace an existing record or reset its creation time.
  await writeFile(file, matter.stringify('', data), { flag: 'wx' });
  return file;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [type, json, ...extra] = process.argv.slice(2);
    if (!type || (json === undefined && !['Note', 'Page'].includes(type)) || extra.length) throw new Error('Usage: npm run create:internal -- Note|Page OR npm run create:internal -- <Type> \'<JSON front matter>\'');
    console.log(`Created ${await createInternalRecord(type, json === undefined ? undefined : JSON.parse(json))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
