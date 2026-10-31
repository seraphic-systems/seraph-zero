import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

async function recordFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      files.push(...await recordFiles(path.join(directory, entry.name), `${relative}/`));
    } else if (entry.isFile() && entry.name.endsWith('.md')) files.push(relative);
  }
  return files;
}

// Relationships live on the export record. Mix and song backlinks are derived.
export async function readStems(source, songs, mixSongs) {
  const directory = path.join(source, 'data/stems');
  const songIds = new Set(songs.map((song) => song.id));
  const records = [];
  const ids = new Set();
  for (const file of await recordFiles(directory)) {
    const context = `data/stems/${file}`;
    const { data, content } = matter(await readFile(path.join(directory, file), 'utf8'));
    if (typeof data.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id) || path.basename(file) !== `${data.id}.md`) {
      throw new Error(`${context}: id must be lowercase hyphenated words matching the filename`);
    }
    if (ids.has(data.id)) throw new Error(`${context}: duplicate stem id ${data.id}`);
    ids.add(data.id);
    if (typeof data.title !== 'string' || !data.title.trim()) throw new Error(`${context}: title is required`);
    if (data.song != null && !songIds.has(data.song)) throw new Error(`${context}: song must match an existing song id or be blank`);
    if (typeof data.folder !== 'string' || !/^media\/stems\/(raw|cleaned)\/.+/.test(data.folder) ||
        data.folder.includes('\\') || data.folder.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`${context}: folder must be a relative path inside media/stems/raw or media/stems/cleaned`);
    }
    if (typeof data.master !== 'string' || !/\.wav$/i.test(data.master) || /[/\\]/.test(data.master)) {
      throw new Error(`${context}: master must be a WAV filename within the export folder`);
    }
    if (!Array.isArray(data.mixes) || new Set(data.mixes).size !== data.mixes.length) {
      throw new Error(`${context}: mixes must be a list of unique mix ids (or [])`);
    }
    for (const mix of data.mixes) {
      if (!mixSongs.has(mix)) throw new Error(`${context}: unknown mix ${mix}`);
      if (!data.song || mixSongs.get(mix) !== data.song) throw new Error(`${context}: linked mix ${mix} must belong to the same song`);
    }
    records.push({ id: data.id, title: data.title.trim(), song: data.song ?? null,
      folder: data.folder, master: data.master, mixes: data.mixes,
      bpm: data.bpm ?? null, bpm_changes: data.bpm_changes ?? null,
      key: data.key?.trim() ?? null, notes: content.trim() });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}
