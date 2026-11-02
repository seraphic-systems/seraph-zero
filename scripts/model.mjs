import { readdir, readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const modelSchema = JSON.parse(await readFile(new URL('../apps/internal/model/schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajv.addSchema(modelSchema, 'foundation');
const validate = ajv.compile({ $ref: 'foundation#/definitions/Horizon' });

export function validateRecord(type, data, context = 'Record') {
  if (type !== 'Horizon') throw new Error('The foundation supports Horizon records only.');
  if (!validate(data)) throw new Error(`${context}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}

// Validate all source records, then publish only the explicit public projection.
export async function readHorizons(directory) {
  const records = [], ids = new Set();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const file = path.join(directory, entry.name);
    const { data, content } = matter(await readFile(file, 'utf8'));
    if (data.created_at instanceof Date) data.created_at = data.created_at.toISOString();
    validateRecord('Horizon', data, entry.name);
    if (ids.has(data.id)) throw new Error(`${entry.name}: duplicate Horizon id ${data.id}`);
    ids.add(data.id);
    records.push({ key: `Horizon:${data.id}`, type: 'Horizon', data: {
      created_at: null, visibility: 'public', ...data,
    }, content: content.trim() });
  }
  return records.sort((a, b) => a.data.level - b.data.level || a.data.id.localeCompare(b.data.id));
}

export function publicCatalog(records) {
  return { records: records.filter(record => record.data.visibility === 'public') };
}
