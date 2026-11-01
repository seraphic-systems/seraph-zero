import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { validateRecord } from './model.mjs';
import { createR2Store, r2Config } from './r2-store.mjs';
import { audioRange } from './audio-range.mjs';
export { audioRange } from './audio-range.mjs';

const execute = promisify(execFile);
async function convertAudio(input, output) {
  if (process.platform === 'darwin') await execute('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', input, output]);
  else await execute('ffmpeg', ['-v', 'error', '-nostdin', '-i', input, '-vn', '-c:a', 'pcm_s16le', '-y', output]);
}

export function fragmentsApi(root, { library = process.env.SERAPH_FRAGMENT_LIBRARY || '/Volumes/MusicArchive/_keepers', convert = convertAudio, cloud = createR2Store(r2Config()) } = {}) {
  let cache;
  const conversions = new Map();
  const middleware = async (req, res, next) => {
    const route = req.url?.split('?')[0];
    if (!route?.startsWith('/api/fragments/')) return next();
    const send = (status, error) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error }));
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '') ||
        (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
        req.headers['sec-fetch-site'] === 'cross-site') return send(403, 'Open the fragment browser on localhost.');
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed.');
    const match = /^\/api\/fragments\/([a-z0-9]+(?:-[a-z0-9]+)*)\/audio$/.exec(route);
    if (!match) return send(404, 'Fragment not found.');
    try {
      let document;
      try { document = await readFile(path.join(root, 'apps/internal/data/music-fragments', `${match[1]}.md`), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return send(404, 'Fragment not found.'); throw error; }
      const fragment = matter(document).data;
      validateRecord('MusicFragment', fragment, match[1]);
      if (fragment.id !== match[1] || fragment.root !== 'music-keepers') return send(404, 'Fragment not found.');
      if (cloud && fragment.preview) {
        try {
          const requested = audioRange(req.headers.range, fragment.preview.bytes);
          if (requested === false) {
            res.writeHead(416, { 'Content-Range': `bytes */${fragment.preview.bytes}`, 'Cache-Control': 'no-store' });
            return res.end();
          }
          const remote = await cloud.audio(fragment.preview, { range: req.headers.range, head: req.method === 'HEAD' });
          const headers = { 'Content-Type': 'audio/mp4', 'Cache-Control': 'private, no-cache', 'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
          if (remote.ContentLength != null) headers['Content-Length'] = remote.ContentLength;
          if (remote.ContentRange) headers['Content-Range'] = remote.ContentRange;
          else if (requested) headers['Content-Range'] = `bytes ${requested.start}-${requested.end}/${fragment.preview.bytes}`;
          res.writeHead(headers['Content-Range'] ? 206 : 200, headers);
          if (req.method === 'HEAD') return res.end();
          remote.Body.on('error', () => res.destroy());
          res.on('close', () => remote.Body.destroy());
          remote.Body.pipe(res);
          return;
        } catch (error) {
          if (res.headersSent) return res.destroy();
          if (error.$metadata?.httpStatusCode === 416) {
            res.writeHead(416, { 'Content-Range': `bytes */${fragment.preview.bytes}`, 'Cache-Control': 'no-store' });
            return res.end();
          }
          // A disconnected network or unavailable object can use the original.
        }
      }
      const libraryPath = await realpath(library);
      let file = await realpath(path.join(libraryPath, fragment.file));
      if (!file.startsWith(libraryPath + path.sep)) return send(403, 'Audio must stay inside the sample library.');
      const original = await stat(file);
      if (!original.isFile()) return send(404, 'Audio file not found.');
      const extension = path.extname(file).toLowerCase();
      if (['.aif', '.aiff'].includes(extension)) {
        // Convert on first listen; cache only browser-compatible previews in temp.
        const key = createHash('sha256').update(`${file}:${original.mtimeMs}:${original.size}`).digest('hex');
        if (!conversions.has(key)) {
          const pending = (async () => {
            cache ??= mkdtemp(path.join(tmpdir(), 'seraph-fragment-audio-'));
            const output = path.join(await cache, `${key}.wav`);
            await convert(file, output);
            return output;
          })();
          conversions.set(key, pending);
          pending.catch(() => conversions.delete(key));
        }
        file = await conversions.get(key);
      }
      const { size } = await stat(file);
      const range = audioRange(req.headers.range, size);
      const headers = {
        'Content-Type': ({ '.wav': 'audio/wav', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' })[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      };
      if (range === false) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      headers['Content-Length'] = range ? range.end - range.start + 1 : size;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(file, range || {});
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      return send(error.code === 'ENOENT' ? 404 : 503, error.code === 'ENOENT'
        ? 'Audio is unavailable. Connect the MusicArchive drive, or configure R2 and upload this fragment’s preview.'
        : 'Unable to prepare audio. Check the local server and try again.');
    }
  };
  middleware.close = async () => {
    cloud?.close?.();
    await Promise.allSettled(conversions.values());
    if (cache) await rm(await cache, { recursive: true, force: true });
  };
  return middleware;
}
