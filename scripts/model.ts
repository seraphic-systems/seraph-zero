import type { HorizonData, HorizonRecord } from '../apps/seraphic-systems/orb/types.ts';
import { readdir, readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import path from 'node:path';
import { Ajv } from 'ajv';
import formats from 'ajv-formats';
const addFormats = formats.default;

export const modelSchema = JSON.parse(await readFile(new URL('../schema/records.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajv.addSchema(modelSchema, 'foundation');
const validate = ajv.compile<HorizonData>({ $ref: 'foundation#/definitions/Horizon' });
const validateMixData = ajv.compile<{ song: string; date: string }>({ $ref: 'foundation#/definitions/Mix' });
const validateMemoryData = ajv.compile<{ id: string }>({ $ref: 'foundation#/definitions/OrganicMemory' });

type VisualizerRecordType = 'Mix' | 'OrganicMemory';

export function validateRecord(type: string, data: unknown, context = 'Record'): asserts data is HorizonData {
  if (type !== 'Horizon') throw new Error('The foundation supports Horizon records only.');
  if (!validate(data)) throw new Error(`${context}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}

export function visualizerRecordId(type: VisualizerRecordType, data: unknown, context: string = type) {
  if (type === 'Mix') {
    if (!validateMixData(data)) throw new Error(`${context}: ${ajv.errorsText(validateMixData.errors, { separator: '; ' })}`);
    return `${data.song}-${data.date}`;
  }
  if (!validateMemoryData(data)) throw new Error(`${context}: ${ajv.errorsText(validateMemoryData.errors, { separator: '; ' })}`);
  return data.id;
}

async function* readMarkdownRecords(directory: string, allowMissingDirectory = false) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (allowMissingDirectory && error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const { data, content } = matter(await readFile(path.join(directory, entry.name), 'utf8'));
    if (data.created_at instanceof Date) data.created_at = data.created_at.toISOString();
    yield { name: entry.name, data, content };
  }
}

export async function readVisualizerRecordIds(type: VisualizerRecordType, directory: string) {
  const ids = new Set<string>();
  for await (const { name, data } of readMarkdownRecords(directory, true)) {
    const id = visualizerRecordId(type, data, name);
    if (ids.has(id)) throw new Error(`${name}: duplicate ${type} id ${id}`);
    ids.add(id);
  }
  return ids;
}

// Validate all source records, then publish only the explicit public projection.
export async function readHorizons(directory: string) {
  const records: HorizonRecord[] = [], ids = new Set<string>();
  for await (const { name, data, content } of readMarkdownRecords(directory)) {
    validateRecord('Horizon', data, name);
    if (ids.has(data.id)) throw new Error(`${name}: duplicate Horizon id ${data.id}`);
    ids.add(data.id);
    records.push({ key: `Horizon:${data.id}`, type: 'Horizon', data: {
      created_at: null, visibility: 'public', ...data,
    }, content: content.trim() });
  }
  return records.sort((a, b) => a.data.level - b.data.level || a.data.id.localeCompare(b.data.id));
}

export function publicCatalog(records: HorizonRecord[]) {
  return { records: records.filter(record => record.data.visibility === 'public') };
}
