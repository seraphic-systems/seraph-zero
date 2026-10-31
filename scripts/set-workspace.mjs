import { readdir, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { homedir } from 'node:os';

async function markdown(directory) {
  const entries = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return Promise.all(entries.filter((name) => name.endsWith('.md')).sort().map(async (name) => matter(await readFile(path.join(directory, name), 'utf8')).data));
}
export async function workspace(root, library, sets, { ensureIdeas = false } = {}) {
  library = await realpath(library).catch(() => path.resolve(library));
  const source = path.join(root, 'apps/internal/data');
  const [songs, projects, ideas] = await Promise.all(['songs', 'projects', 'ideas'].map((directory) => markdown(path.join(source, directory))));
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const knownSongs = new Set(songs.map((s) => s.id));
  const enriched = sets.map((set) => {
    const current = set.paths.at(-1).replace(/^~(?=\/)/, homedir());
    const matches = projects.filter((project) => project.root === 'ableton' && path.dirname(path.resolve(current)) === path.resolve(library, project.folder));
    const project = projectMap.get(set.project_id) || (matches.length === 1 ? matches[0] : null);
    const song = Object.hasOwn(set, 'song') ? set.song : project?.song ?? null;
    return { ...set, project_id: project?.id ?? null, song: knownSongs.has(song) ? song : null, song_scope: Object.hasOwn(set, 'song') ? 'set' : 'project' };
  });
  const ideaByProject = new Map(ideas.filter((idea) => idea.project_id).map((idea) => [idea.project_id, idea]));
  const ideaBySet = new Map(ideas.filter((idea) => idea.set_id).map((idea) => [idea.set_id, idea]));
  const byId = new Map(enriched.map((set) => [set.id, set]));
  const anchor = (set) => {
    const seen = new Set([set.id]);
    while (set.parent_set_id && byId.has(set.parent_set_id) && !seen.has(set.parent_set_id)) {
      const parent = byId.get(set.parent_set_id);
      if (set.song_scope === 'set' && set.song !== parent.song) break;
      set = parent; seen.add(set.id);
    }
    return set.id;
  };
  // Include project inventories even when their files are currently unavailable.
  const candidates = [...projects.filter((project) => !project.song).map((project) => ({ project_id: project.id })),
    ...enriched.filter((set) => !set.song).map((set) => set.project_id && set.song_scope !== 'set'
      ? { project_id: set.project_id } : { set_id: anchor(set) })];
  if (ensureIdeas) for (const candidate of candidates) {
    const map = candidate.project_id ? ideaByProject : ideaBySet;
    const key = candidate.project_id || candidate.set_id;
    if (map.has(key)) continue;
    // Deterministic migration IDs make repeated refreshes and concurrent requests idempotent.
    const idea = { id: `idea-${candidate.project_id ? 'project' : 'set'}-${key}`, ...candidate, song: null, created_at: null };
    await mkdir(path.join(source, 'ideas'), { recursive: true });
    try { await writeFile(path.join(source, 'ideas', `${idea.id}.md`), matter.stringify('', idea), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    map.set(key, idea); ideas.push(idea);
  }
  for (const set of enriched) {
    const idea = ideaBySet.get(set.id) || ideaBySet.get(anchor(set)) || (set.song_scope !== 'set' ? ideaByProject.get(set.project_id) : null);
    set.idea_id = idea?.id ?? null;
    if (idea) {
      set.song = knownSongs.has(idea.song) ? idea.song : null;
      set.song_scope = 'idea';
    }
  }
  const latest = (rows) => rows.filter((s) => s.available && !s.archived_at).sort((a, b) =>
    (Date.parse(b.saved_at) || 0) - (Date.parse(a.saved_at) || 0) || a.id.localeCompare(b.id))[0]?.id ?? null;
  return {
    sets: enriched,
    ideas,
    songs: songs.map((song) => {
      const associated = enriched.filter((s) => s.song === song.id);
      return { id: song.id, title: song.title, set_ids: associated.map((s) => s.id), latest_set_id: latest(associated) };
    }).sort((a, b) => a.title.localeCompare(b.title)),
  };
}
