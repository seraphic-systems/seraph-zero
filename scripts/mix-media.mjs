import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const mixTypes = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' };
export function mixIdentity(file) {
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4}-\d{2}-\d{2})\.(wav|mp3|m4a|ogg|flac|aac)$/i.exec(file);
  if (!match || match[1] !== match[1].toLowerCase()) throw new Error(`${file}: name mixes <song-id>-YYYY-MM-DD.<extension>`);
  const [, id, date, extension] = match;
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error(`${file}: use a real YYYY-MM-DD date`);
  return { id, date, file, format: extension.toUpperCase(), url: `api/mixes/${encodeURIComponent(file)}/audio` };
}
export async function readMixManifest(source) {
  const registry = await readFile(path.join(source, 'data/mix-media.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { schema_version: 1, files: [] };
    throw error;
  });
  if (registry?.schema_version !== 1 || !Array.isArray(registry.files)) throw new Error('Invalid data/mix-media.json registry.');
  const seen = new Set();
  for (const item of registry.files) {
    const mix = mixIdentity(item.file);
    const remote = item.remote;
    if (seen.has(item.file) || !remote || remote.provider !== 'r2' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(remote.bucket) ||
        !/^[a-f0-9]{64}$/.test(remote.sha256) || remote.key !== `mixes/${item.file}/${remote.sha256}` ||
        remote.content_type !== mixTypes[mix.format.toLowerCase()] || !Number.isSafeInteger(remote.bytes) || remote.bytes <= 0 ||
        typeof remote.uploaded_at !== 'string' || !Number.isFinite(Date.parse(remote.uploaded_at))) throw new Error(`Invalid media reference: ${item.file}`);
    seen.add(item.file);
  }
  return registry;
}
export async function readMixes(source) {
  const registry = await readMixManifest(source);
  const mixes = new Map(registry.files.map(item => [item.file, { ...mixIdentity(item.file), remote: item.remote }]));
  const entries = await readdir(path.join(source, 'media/mixes'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.isFile() && /\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(entry.name) && !mixes.has(entry.name)) mixes.set(entry.name, mixIdentity(entry.name));
  }
  return [...mixes.values()].sort((a, b) => a.file.localeCompare(b.file));
}
