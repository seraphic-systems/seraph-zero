import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { createInternalRecord } from './create-internal-record.mjs';
import { validateRecord } from './model.mjs';

const defaultSource = fileURLToPath(new URL('../apps/internal/', import.meta.url));
const defaultLibrary = '/Volumes/MusicArchive/_keepers';
// Stable import identities make repeated snapshots safe; titles remain editable.
const identity = (prefix, ...parts) => `${prefix}-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)}`;
const text = (value) => String(value ?? '').trim();

export async function importMusicFragments(snapshot, { source = defaultSource, library = defaultLibrary } = {}) {
  if (!snapshot?.spreadsheet_id || !Array.isArray(snapshot.rows)) throw new Error('Expected spreadsheet_id and rows from a verified sheet read.');
  const records = new Map();
  const paths = new Set();
  const root = await realpath(library);
  let skipped = 0;
  let orphaned = 0;
  for (const row of snapshot.rows) {
    const values = row.values || [];
    const key = text(values[3]);
    const tempo = text(values[4]);
    const group = text(values[6]);
    // Delete is a catalog exclusion only; this importer never deletes audio.
    if (!key || !tempo || !group || text(values[8]).toLowerCase() === 'true') { skipped++; continue; }
    const file = values[2]; // Preserve leading spaces in actual filenames.
    const fragment = {
      id: identity('fragment', snapshot.spreadsheet_id, file), root: 'music-keepers', file,
      key, bpm: Number(tempo),
      source: { spreadsheet_id: snapshot.spreadsheet_id, sheet_id: row.sheet_id, sheet: row.sheet, row: row.row, group },
    };
    if (text(values[1])) fragment.source.date = text(values[1]);
    if (group.toLowerCase() !== 'orphan') {
      const id = identity('idea', snapshot.spreadsheet_id, group.toLowerCase());
      fragment.idea = id;
      records.set(`Idea:${id}`, { type: 'Idea', directory: 'ideas', data: { id, title: group, song: null } });
    } else orphaned++;
    const tags = [...new Set(text(values[5]).split(',').map(text).filter(Boolean))];
    if (tags.length) fragment.tags = tags;
    for (const [field, index] of [['sample_type', 7], ['review_reason', 10], ['notes', 11], ['melody_sound', 12], ['character', 13], ['role', 14], ['memories', 15]]) {
      if (text(values[index])) fragment[field] = text(values[index]);
    }
    if (text(values[9])) {
      if (!['true', 'false'].includes(text(values[9]).toLowerCase())) throw new Error(`Invalid review flag at ${row.sheet}:${row.row}`);
      fragment.needs_review = text(values[9]).toLowerCase() === 'true';
    }
    validateRecord('MusicFragment', fragment, `${row.sheet}:${row.row}`);
    if (paths.has(file)) throw new Error(`Duplicate source path: ${file}`);
    paths.add(file);
    const actual = await realpath(path.join(root, file));
    if (!actual.startsWith(root + path.sep) || !(await stat(actual)).isFile()) throw new Error(`Audio must be a file inside the library: ${file}`);
    records.set(`MusicFragment:${fragment.id}`, { type: 'MusicFragment', directory: 'music-fragments', data: fragment });
  }
  // Preflight every record and file before creating anything. Existing records
  // are retained, including manual edits and their original creation timestamps.
  const pending = [];
  for (const record of records.values()) {
    validateRecord(record.type, record.data, record.data.id);
    const filename = path.join(source, 'data', record.directory, `${record.data.id}.md`);
    const existing = await readFile(filename, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing !== null) {
      const data = matter(existing).data;
      validateRecord(record.type, data, filename);
      if (data.id !== record.data.id || (record.type === 'MusicFragment' && (data.file !== record.data.file || data.root !== record.data.root))) throw new Error(`Import identity conflict: ${filename}`);
    } else pending.push(record);
  }
  for (const record of pending) await createInternalRecord(record.type, record.data, { source });
  return {
    fragments: paths.size, groups: [...records.values()].filter((r) => r.type === 'Idea').length,
    orphaned, skipped, created: pending.filter((r) => r.type === 'MusicFragment').length,
    ideas_created: pending.filter((r) => r.type === 'Idea').length,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [input, ...extra] = process.argv.slice(2);
    if (!input || extra.length) throw new Error('Usage: node scripts/import-music-fragments.mjs <snapshot.json>');
    console.log(JSON.stringify(await importMusicFragments(JSON.parse(await readFile(input, 'utf8'))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
