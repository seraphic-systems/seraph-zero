import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { readHorizons, validateRecord } from './model.mjs';

const source = fileURLToPath(new URL('../apps/internal', import.meta.url));
export async function createInternalRecord(type, metadata, directory = path.join(source, 'data/horizons')) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Front matter must be a JSON object.');
  const data = { visibility: 'private', ...metadata, created_at: metadata.created_at ?? new Date().toISOString() };
  validateRecord(type, data, 'New record');
  await mkdir(directory, { recursive: true });
  if ((await readHorizons(directory)).some(record => record.data.id === data.id)) throw new Error(`Horizon id ${data.id} already exists.`);
  const file = path.join(directory, `${data.id}.md`);
  await writeFile(file, matter.stringify('', data), { flag: 'wx' });
  return file;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [type, json, ...extra] = process.argv.slice(2);
    if (!type || !json || extra.length) throw new Error('Usage: npm run create:record -- Horizon \'<JSON front matter>\'');
    console.log(`Created ${await createInternalRecord(type, JSON.parse(json))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
