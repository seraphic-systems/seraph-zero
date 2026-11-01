import { createReadStream } from 'node:fs';
import { realpath, stat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { readMixes, mixTypes } from './mix-media.mjs';
import { audioRange } from './fragments-api.mjs';
import { createR2Store, mediaR2Config } from './r2-store.mjs';

export function mixesApi(root, { cloud = createR2Store(mediaR2Config()) } = {}) {
  const source = path.join(root, 'apps/internal');
  const middleware = async (req, res, next) => {
    const route = req.url?.split('?')[0];
    if (!route?.startsWith('/api/mixes/')) return next();
    const send = (status, error) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error }));
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '') ||
        (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') return send(403, 'Open the mix browser on localhost.');
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed.');
    const match = /^\/api\/mixes\/([^/]+)\/audio$/.exec(route);
    if (!match) return send(404, 'Mix not found.');
    try {
      let filename;
      try { filename = decodeURIComponent(match[1]); } catch { return send(404, 'Mix not found.'); }
      const mix = (await readMixes(source)).find(item => item.file === filename);
      if (!mix) return send(404, 'Mix not found.');
      // Only song-associated mixes are playable, including on a fresh checkout.
      const songs = await Promise.all((await readdir(path.join(source, 'data/songs'))).filter(name => name.endsWith('.md'))
        .map(async name => matter(await readFile(path.join(source, 'data/songs', name), 'utf8')).data));
      if (!songs.some(song => song.id === mix.id)) return send(404, 'Mix not found.');
      const headers = { 'Content-Type': mixTypes[mix.format.toLowerCase()], 'Cache-Control': 'private, no-cache',
        'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
      if (cloud && mix.remote) {
        try {
          const range = audioRange(req.headers.range, mix.remote.bytes);
          if (range === false) {
            res.writeHead(416, { ...headers, 'Content-Range': `bytes */${mix.remote.bytes}` }); return res.end();
          }
          const remote = await cloud.audio(mix.remote, { range: req.headers.range, head: req.method === 'HEAD' });
          const expected = range ? range.end - range.start + 1 : mix.remote.bytes;
          if (remote.ContentLength !== expected) { remote.Body?.destroy(); throw new Error('Unexpected remote size'); }
          const responseHeaders = { ...headers, 'Content-Length': expected };
          if (range) responseHeaders['Content-Range'] = `bytes ${range.start}-${range.end}/${mix.remote.bytes}`;
          res.writeHead(range ? 206 : 200, responseHeaders);
          if (req.method === 'HEAD') return res.end();
          remote.Body.on('error', () => res.destroy());
          res.on('close', () => remote.Body.destroy());
          remote.Body.pipe(res);
          return;
        } catch {
          if (res.headersSent) return res.destroy();
          // Network, permission, or object errors use the local original if available.
        }
      }
      const directory = await realpath(path.join(source, 'media/mixes'));
      const file = await realpath(path.join(directory, mix.file));
      if (!file.startsWith(directory + path.sep)) return send(403, 'Audio must stay inside the mixes folder.');
      const info = await stat(file);
      if (!info.isFile()) return send(404, 'Mix audio not found.');
      const range = audioRange(req.headers.range, info.size);
      if (range === false) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); return res.end();
      }
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
      headers['Content-Length'] = range ? range.end - range.start + 1 : info.size;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(file, range || {});
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      send(error.code === 'ENOENT' ? 404 : 503, 'Mix audio is unavailable. Restore the local file or configure R2 and upload the mix.');
    }
  };
  middleware.close = () => cloud?.close?.();
  return middleware;
}
