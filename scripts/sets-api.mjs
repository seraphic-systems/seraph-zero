import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { access, readFile, readdir, realpath, rename, writeFile, unlink } from 'node:fs/promises';
import matter from 'gray-matter';
import { workspace } from './set-workspace.mjs';

const execute = promisify(execFile);

export function setsApi(root, { library = path.join(homedir(), 'Ableton'), template = process.env.SERAPH_LIVE_TEMPLATE,
  openSet = (file) => execute('open', [file]) } = {}) {
  const registry = path.join(root, 'apps/internal/data/set-registry.json');
  const snapshots = path.join(root, 'apps/internal/data/set-snapshots');
  const branch = (args) => execute('python3', [path.join(root, 'scripts/ableton_branch.py'),
    ...args, '--registry', registry, '--snapshots', snapshots, '--library', library], { maxBuffer: 8 * 1024 * 1024 });
  const list = async () => JSON.parse((await branch(['list'])).stdout).sets;
  async function blankTemplate() {
    if (template) { await access(template); return template; }
    const apps = (await readdir('/Applications').catch(() => [])).filter((name) => /^Ableton Live .*\.app$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of apps) {
      const candidate = path.join('/Applications', name, 'Contents/App-Resources/Builtin/Templates/DefaultLiveSet.als');
      try { await access(candidate); return candidate; } catch { /* Try another installed edition. */ }
    }
    throw new Error('No blank Ableton template found. Set SERAPH_LIVE_TEMPLATE to a blank .als template and restart the workspace.');
  }
  async function currentWorkspace() {
    const data = await workspace(root, library, await list(), { ensureIdeas: true });
    try { await blankTemplate(); data.can_create = true; } catch (error) { data.can_create = false; data.create_help = error.message; }
    return data;
  }
  return async (req, res, next) => {
    const route = req.url?.split('?')[0];
    if (!route?.startsWith('/api/sets')) return next();
    const send = (status, result) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    };
    // Only the loopback dashboard can invoke local file operations.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '') ||
        (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
        (req.method !== 'GET' && req.headers.origin !== `http://${req.headers.host}`)) {
      return send(403, { error: 'Open this dashboard on localhost to manage sets.' });
    }
    try {
      if (route === '/api/sets/workspace' && req.method === 'GET') return send(200, await currentWorkspace());
      if (route === '/api/sets' && req.method === 'GET') {
        return send(200, JSON.parse((await branch(['list'])).stdout));
      }
      if (req.method !== 'POST') return send(405, { error: 'Method not allowed.' });
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'Expected JSON.' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) return send(413, { error: 'Request too large.' });
      }
      let input;
      try { input = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON.' }); }
      if (route === '/api/sets/new') {
        if (!input || typeof input !== 'object' || (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 100))) return send(400, { error: 'Invalid idea request.' });
        const created = JSON.parse((await branch(['new', ...(input.name === undefined ? [] : ['--name', input.name]), '--template', await blankTemplate()])).stdout);
        return send(201, created);
      }
      if (route === '/api/sets/open' || route === '/api/sets/associate') {
        if (typeof input?.set_id !== 'string') return send(400, { error: 'Choose a set first.' });
        const data = await currentWorkspace();
        const set = data.sets.find((row) => row.id === input.set_id);
        if (!set) return send(404, { error: 'Set not found. Refresh the list.' });
        if (route.endsWith('/open')) {
          if (set.archived_at || !set.available) return send(400, { error: 'Restore this set before opening it.' });
          const file = await realpath(set.paths.at(-1).replace(/^~(?=\/)/, homedir()));
          const relative = path.relative(await realpath(library), file);
          if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) || !file.toLowerCase().endsWith('.als')) return send(400, { error: 'Only Live Sets inside the Ableton library can be opened.' });
          await openSet(file);
          return send(200, { opened: set.id });
        }
        if (input.song !== null && !data.songs.some((song) => song.id === input.song)) return send(400, { error: 'Choose an existing song.' });
        if (set.idea_id) {
          const file = path.join(root, 'apps/internal/data/ideas', `${set.idea_id}.md`);
          const document = matter(await readFile(file, 'utf8'));
          document.data.song = input.song;
          const temporary = `${file}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, matter.stringify(document.content, document.data), { flag: 'wx' });
            await rename(temporary, file);
          } finally { await unlink(temporary).catch(() => {}); }
          return send(200, { idea_id: set.idea_id, song: input.song });
        }
        if (!set.project_id || set.song_scope === 'set') {
          return send(200, JSON.parse((await branch(['associate', '--set-id', set.id, ...(input.song ? ['--song', input.song] : [])])).stdout));
        }
        const directory = path.join(root, 'apps/internal/data/projects');
        for (const name of await readdir(directory)) {
          if (!name.endsWith('.md')) continue;
          const file = path.join(directory, name);
          const document = matter(await readFile(file, 'utf8'));
          if (document.data.id !== set.project_id) continue;
          document.data.song = input.song;
          const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
          try {
            await writeFile(temporary, matter.stringify(document.content, document.data), { flag: 'wx' });
            await rename(temporary, file);
          } finally { await unlink(temporary).catch(() => {}); }
          return send(200, { project_id: set.project_id, song: input.song });
        }
        return send(400, { error: 'Project record is missing. Refresh and try again.' });
      }
      if (route === '/api/sets/archive' || route === '/api/sets/restore') {
        if (typeof input?.set_id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.set_id)) {
          return send(400, { error: 'Choose a set first.' });
        }
        return send(200, JSON.parse((await branch([route.endsWith('/restore') ? 'restore' : 'archive', '--set-id', input.set_id])).stdout));
      }
      if (route === '/api/sets/branch') {
        if (typeof input?.parent_id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.parent_id) ||
            typeof input?.name !== 'string' || input.name.length > 104) {
          return send(400, { error: 'Choose a parent set and enter a branch name.' });
        }
        return send(201, JSON.parse((await branch(['create', '--parent', input.parent_id, '--name', input.name])).stdout));
      }
      if (route === '/api/sets/scan') {
        await execute('python3', [path.join(root, 'scripts/ableton.py'), library, '--registry', registry,
          '--snapshot', snapshots, '--json'], { maxBuffer: 8 * 1024 * 1024 });
        return send(200, await currentWorkspace());
      }
      return send(404, { error: 'Unknown sets operation.' });
    } catch (error) {
      return send(400, { error: error.stderr?.trim() || error.message || 'Set operation failed. Check the local server.' });
    }
  };
}
