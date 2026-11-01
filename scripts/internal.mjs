import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import { readMixes } from './mix-media.mjs';
import { readStems } from './stems.mjs';
import { buildCatalog, modelSchema } from './model.mjs';
import { createContentSource, indexTree } from '../apps/seraphic-systems/orb/content.js';

function dateString(value, context) {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error(`${context}: use a real YYYY-MM-DD date`);
  }
  return date;
}

export async function buildInternal(source, output, {
  publicOrb = false,
  includeLocalMedia = true,
  orbSource = fileURLToPath(new URL('../apps/seraphic-systems/orb/', import.meta.url)),
} = {}) {
  const songs = [];
  const ids = new Set();
  const mixes = await readMixes(source, { includeLocalMedia });
  for (const entry of await readdir(path.join(source, 'data/songs'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const { data, content } = matter(await readFile(path.join(source, 'data/songs', entry.name), 'utf8'));
    if (typeof data.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id)) {
      throw new Error(`${entry.name}: id must be lowercase words separated by hyphens`);
    }
    if (ids.has(data.id)) throw new Error(`${entry.name}: duplicate song id ${data.id}`);
    ids.add(data.id);
    if (typeof data.title !== 'string' || !data.title.trim()) throw new Error(`${entry.name}: title is required`);
    songs.push({ id: data.id, title: data.title, created: data.song_created == null ? null : dateString(data.song_created, entry.name),
      notes: marked.parse(content), mixes: mixes.filter((mix) => mix.id === data.id)
        .sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file)) });
  }
  for (const mix of mixes) {
    if (!ids.has(mix.id)) throw new Error(`${mix.file}: no song with id ${mix.id}`);
    mix.notes = '';
  }
  const noteDirectory = path.join(source, 'data/mixes');
  const mixSongs = new Map(mixes.map((mix) => [`${mix.id}-${mix.date}`, mix.id]));
  const noteFiles = await readdir(noteDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of noteFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const context = `data/mixes/${entry.name}`;
    const { data, content } = matter(await readFile(path.join(noteDirectory, entry.name), 'utf8'));
    if (!ids.has(data.song)) throw new Error(`${context}: song must match an existing song id`);
    const date = dateString(data.date, context);
    if (entry.name !== `${data.song}-${date}.md`) {
      throw new Error(`${context}: filename must be ${data.song}-${date}.md`);
    }
    mixSongs.set(`${data.song}-${date}`, data.song);
    if (data.bpm != null && (typeof data.bpm !== 'number' || !Number.isFinite(data.bpm) || data.bpm <= 0)) {
      throw new Error(`${context}: bpm must be a positive number or blank`);
    }
    if (data.bpm_changes != null) {
      if (!Array.isArray(data.bpm_changes) || data.bpm_changes.length < 2 ||
          !data.bpm_changes.every((bpm) => typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0)) {
        throw new Error(`${context}: bpm_changes must list at least two positive tempos in playback order`);
      }
      if (data.bpm != null) throw new Error(`${context}: use bpm or bpm_changes, not both`);
    }
    if (data.key != null && (typeof data.key !== 'string' || !data.key.trim())) {
      throw new Error(`${context}: key must be text or blank`);
    }
    // Notes can be committed without local audio; formats of the same mix share notes.
    for (const mix of mixes.filter((mix) => mix.id === data.song && mix.date === date)) {
      mix.notes = marked.parse(content);
      mix.bpm = data.bpm ?? null;
      mix.bpm_changes = data.bpm_changes ?? null;
      mix.key = data.key?.trim() ?? null;
    }
  }
  const stems = await readStems(source, songs, mixSongs);
  for (const song of songs) {
    song.stems = stems.filter((stem) => stem.song === song.id).map((stem) => stem.id);
    for (const mix of song.mixes) {
      mix.stems = stems.filter((stem) => stem.mixes.includes(`${song.id}-${mix.date}`)).map((stem) => stem.id);
    }
  }
  const catalog = await buildCatalog(source, mixes);
  const creationTimes = new Map(catalog.records.map((record) => [record.key, record.data.created_at]));
  for (const song of songs) {
    song.created_at = creationTimes.get(`Song:${song.id}`);
    for (const mix of song.mixes) mix.created_at = creationTimes.get(`Mix:${song.id}-${mix.date}`);
  }
  for (const stem of stems) stem.created_at = creationTimes.get(`StemExport:${stem.id}`);
  songs.sort((a, b) => a.title.localeCompare(b.title));
  await mkdir(output, { recursive: true });
  if (!publicOrb) {
    await cp(path.join(source, 'dashboard'), output, { recursive: true });
  }
  await cp(orbSource, path.join(output, 'orb'), { recursive: true });
  // Materialize route entry points so deep links also work on a plain static server.
  let orbTemplate = await readFile(path.join(orbSource, 'index.html'), 'utf8');
  if (orbTemplate) {
    if (publicOrb) {
      orbTemplate = orbTemplate
        .replace('data-site-name="Internal"', 'data-site-name="Seraphic Systems"')
        .replace('A spatial view of your internal music library.', 'Explore the Seraphic Systems music library.')
        .replace('Orb · Internal', 'Orb · Seraphic Systems')
        .replace('internal <span>/ orb</span>', 'Seraphic Systems <span>/ orb</span>')
        .replace('<a href="/">Classic workspace ↗</a>', '<a href="/journal/">Journal ↗</a><a href="/">Seraphic Systems ↗</a>');
    }
    // dist is ignored by Vite's watcher. A new filename prevents its CSS transform
    // cache (and browser caches) from pairing a rebuilt page with an older style.
    if (/\/orb\/orb\.css(?:\?[^"']*)?["']/.test(orbTemplate)) {
      const css = await readFile(path.join(orbSource, 'orb.css'));
      const filename = `orb.${createHash('sha256').update(css).digest('hex').slice(0, 16)}.css`;
      await writeFile(path.join(output, 'orb', filename), css);
      orbTemplate = orbTemplate.replace(/\/orb\/orb\.css(?:\?[^"']*)?/g, `/orb/${filename}`);
    }
    const tree = createContentSource(songs, catalog, modelSchema).getRoot();
    for (const { path: nodePath } of indexTree(tree).values()) {
      const directory = path.join(output, 'orb', ...nodePath.slice(1));
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'index.html'), orbTemplate);
    }
  }
  await writeFile(path.join(output, 'model-schema.json'), JSON.stringify(modelSchema));
  await writeFile(path.join(output, 'catalog.json'), JSON.stringify(catalog));
  await writeFile(path.join(output, 'songs.json'), JSON.stringify(songs));
  await writeFile(path.join(output, 'stems.json'), JSON.stringify(stems));
  // Mixes stream through the private local API; audio never enters static output.
  return songs.length;
}
