import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const modelSchema = JSON.parse(await readFile(new URL('../apps/internal/model/schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
for (const keyword of ['x-model', 'x-relations', 'x-gaps', 'x-version']) ajv.addKeyword(keyword);
addFormats(ajv);
ajv.addSchema(modelSchema, 'internal');
const sharedDefaults = Object.fromEntries(Object.entries(modelSchema.definitions.RecordBase.properties)
  .filter(([, field]) => Object.hasOwn(field, 'default'))
  .map(([key, field]) => [key, field.default]));
const validators = new Map(Object.keys(modelSchema.definitions).map((type) => [type, ajv.compile({ $ref: `internal#/definitions/${type}` })]));

export function validateRecord(type, data, context) {
  const validate = validators.get(type);
  if (!validate(data)) throw new Error(`${context}: ${type} ${ajv.errorsText(validate.errors, { dataVar: 'record' })}`);
}

// YAML dates are normalized before applying the language-neutral JSON contracts.
function normalize(value, field = '') {
  if (value instanceof Date) return field.endsWith('_at') ? value.toISOString() : value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item, key)]));
  return value;
}
async function files(directory, extension, recursive = false, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && recursive) result.push(...await files(path.join(directory, entry.name), extension, true, `${prefix}${entry.name}/`));
    else if (entry.isFile() && entry.name.endsWith(extension)) result.push(prefix + entry.name);
  }
  return result;
}
function fieldValues(data, field) {
  let values = [data];
  for (const key of field.split('.')) {
    const list = key.endsWith('[]');
    values = values.flatMap((item) => {
      const value = item?.[list ? key.slice(0, -2) : key];
      return value == null ? [] : Array.isArray(value) ? value : [value];
    });
  }
  return values;
}

export async function buildCatalog(source, audioMixes = []) {
  const records = [];
  const byKey = new Map();
  function add(type, id, data, file) {
    const hasCreatedAt = Object.hasOwn(data, 'created_at');
    // JSON Schema defaults are annotations; materialize shared defaults explicitly.
    data = { ...structuredClone(sharedDefaults), ...data };
    if (!hasCreatedAt && type === 'Snapshot') data.created_at = data.analyzed_at ?? null;
    if (!hasCreatedAt && type === 'LiveSet') data.created_at = data.branched_at ?? null;
    validateRecord(type, data, file);
    const key = `${type}:${id}`;
    if (byKey.has(key)) throw new Error(`${file}: duplicate ${type} id ${id}`);
    const record = { key, type, id, title: data.name || data.title || data.file || (type === 'LiveSet' ? path.basename(data.paths.at(-1), '.als') : id), source: file, data };
    records.push(record);
    byKey.set(key, record);
    return record;
  }
  for (const [type, directory] of [['Member', 'members'], ['Horizon', 'horizons'], ['Policy', 'policies'], ['Album', 'albums'], ['AlbumTrack', 'album-tracks'], ['Song', 'songs'], ['Idea', 'ideas'], ['Mix', 'mixes'], ['StemExport', 'stems'], ['Project', 'projects']]) {
    for (const name of await files(path.join(source, 'data', directory), '.md', type === 'StemExport')) {
      const file = `data/${directory}/${name}`;
      const data = normalize(matter(await readFile(path.join(source, file), 'utf8')).data);
      const id = type === 'Mix' ? `${data.song}-${data.date}` : data.id;
      add(type, id, data, file);
    }
  }
  for (const audio of audioMixes) {
    const mixId = `${audio.id}-${audio.date}`;
    if (!byKey.has(`Mix:${mixId}`)) add('Mix', mixId, { song: audio.id, date: audio.date }, `media/mixes/${audio.file}`);
    add('MixFile', audio.file, { mix: mixId, file: audio.file, format: audio.format }, `media/mixes/${audio.file}`);
  }
  const registry = await readFile(path.join(source, 'data/set-registry.json'), 'utf8').then(JSON.parse).catch((error) => {
    if (error.code === 'ENOENT') return { schema_version: 1, sets: [] };
    throw error;
  });
  validateRecord('SetRegistry', registry, 'data/set-registry.json');
  for (const row of registry.sets) add('LiveSet', row.id, row, 'data/set-registry.json');
  for (const file of await files(path.join(source, 'data/set-snapshots'), '.json')) {
    const relative = `data/set-snapshots/${file}`;
    const data = JSON.parse(await readFile(path.join(source, relative), 'utf8'));
    // Version 2 snapshots establish permanent identity; never infer IDs for v1.
    if (data.schema_version === 2 && data.sets.some((row) => !row.set_id)) throw new Error(`${relative}: schema 2 analyses require set_id`);
    add('Snapshot', file, data, relative);
  }
  const edges = [];
  const unresolved = [];
  const pathOwners = new Map();
  for (const row of records.filter((r) => r.type === 'LiveSet')) {
    const current = row.data.paths.at(-1);
    if (pathOwners.has(current)) throw new Error(`data/set-registry.json: duplicate current set path ${current}`);
    pathOwners.set(current, row.id);
  }
  for (const relation of modelSchema['x-relations']) {
    for (const record of records.filter((row) => row.type === relation.source)) {
      let values = fieldValues(record.data, relation.field);
      if (relation.kind === 'path-join') values = record.data.sets.map((set) => {
        const location = path.posix.join('~/Ableton', record.data.folder, set);
        return pathOwners.get(location) || { path: location };
      });
      if (!values.length && ['stem-song', 'project-song'].includes(relation.id)) unresolved.push({ record: record.key, relation: relation.id, reason: 'Song association is unresolved.' });
      if (relation.id === 'stem-mix' && !values.length) unresolved.push({ record: record.key, relation: relation.id, reason: 'No clear mix association has been recorded for this export.' });
      if (relation.id === 'snapshot-set' && record.data.schema_version === 1) unresolved.push({ record: record.key, relation: relation.id, reason: 'Legacy schema 1 report has no permanent set IDs.' });
      for (const value of values) {
        if (typeof value === 'object') {
          unresolved.push({ record: record.key, relation: relation.id, reason: `Unregistered inventory path: ${value.path}` });
          continue;
        }
        const target = `${relation.target}:${value}`;
        if (!byKey.has(target)) throw new Error(`${record.source}: ${relation.field} references unknown ${relation.target} ${value}`);
        edges.push({ source: record.key, target, relation: relation.id });
      }
    }
  }
  // Additional invariants span fields and cannot be expressed as simple references.
  const albumPositions = new Set();
  for (const row of records) {
    if (row.type === 'StemExport') {
      for (const id of row.data.mixes) if (byKey.get(`Mix:${id}`).data.song !== row.data.song) throw new Error(`${row.source}: linked mix ${id} must belong to the same song`);
    }
    if (row.type === 'Project' && !row.data.sets.includes(row.data.main_set)) throw new Error(`${row.source}: main_set must appear in sets`);
    if (row.type === 'AlbumTrack') {
      if (row.data.secondary_songs?.includes(row.data.primary_song)) throw new Error(`${row.source}: secondary_songs must not include primary_song`);
      const position = `${row.data.album}:${row.data.track_number}`;
      if (albumPositions.has(position)) throw new Error(`${row.source}: duplicate album track number ${row.data.track_number}`);
      albumPositions.add(position);
    }
    if (row.type === 'LiveSet') {
      const seen = new Set([row.id]);
      let parent = row.data.parent_set_id;
      while (parent) {
        if (seen.has(parent)) throw new Error(`${row.source}: branch lineage contains a cycle`);
        seen.add(parent);
        parent = byKey.get(`LiveSet:${parent}`).data.parent_set_id;
      }
    }
  }
  return { schema_version: 1, records, edges, unresolved };
}
