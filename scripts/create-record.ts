import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { readHorizons, readVisualizerRecordIds, validateRecord, visualizerRecordId } from './model.ts';

const source = fileURLToPath(new URL('../content', import.meta.url));
const directories = { Horizon: 'horizons', Mix: 'mixes', OrganicMemory: 'organic-memories' };

export async function createRecord(type: string, metadata: unknown, directory?: string) {
  if (type !== 'Horizon' && type !== 'Mix' && type !== 'OrganicMemory') throw new Error('Choose Horizon, Mix, or OrganicMemory.');
  directory ??= path.join(source, directories[type]);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Front matter must be a JSON object.');
  const fields = metadata as Record<string, unknown>;
  const data = { visibility: 'private', ...fields, created_at: fields.created_at === undefined ? new Date().toISOString() : fields.created_at };
  let id: string;
  if (type === 'Horizon') {
    validateRecord(type, data, 'New record');
    id = data.id;
  } else {
    id = visualizerRecordId(type, data, 'New record');
  }
  await mkdir(directory, { recursive: true });
  const exists = type === 'Horizon'
    ? (await readHorizons(directory)).some(record => record.data.id === id)
    : (await readVisualizerRecordIds(type, directory)).has(id);
  if (exists) throw new Error(`${type} id ${id} already exists.`);
  const file = path.join(directory, `${id}.md`);
  await writeFile(file, matter.stringify('', data), { flag: 'wx' });
  return file;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [type, json, ...extra] = process.argv.slice(2);
    if (!type || !json || extra.length) throw new Error('Usage: npm run create:record -- <Horizon|Mix|OrganicMemory> \'<JSON front matter>\'');
    console.log(`Created ${await createRecord(type, JSON.parse(json))}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
