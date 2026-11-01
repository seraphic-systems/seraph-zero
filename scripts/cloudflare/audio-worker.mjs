import { audioRange } from '../audio-range.mjs';

// This manifest is bundled at build time, never read from a client request or R2.
export function createAudioWorker(manifest) {
  return {
    async fetch(request, env) {
      const pathname = new URL(request.url).pathname;
      if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      const error = (status, message, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: message }), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
      });
      if (!['GET', 'HEAD'].includes(request.method)) return error(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      const ref = Object.hasOwn(manifest.routes, pathname) ? manifest.routes[pathname] : null;
      if (!ref) return error(404, 'Audio not found in this release.');
      const bucket = env[ref.binding];
      if (!bucket) return error(503, 'Audio storage is unavailable.', { 'Retry-After': '30' });
      const etag = `"sha256-${ref.sha256}"`;
      const headers = new Headers({ 'Content-Type': ref.content_type, 'Accept-Ranges': 'bytes',
        ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin' });
      try {
        const metadata = await bucket.head(ref.key);
        if (!metadata) return error(404, 'Audio is unavailable in storage.');
        const valid = object => object.size === ref.bytes && object.customMetadata?.sha256 === ref.sha256 &&
          object.httpMetadata?.contentType === ref.content_type;
        if (!valid(metadata)) return error(503, 'Stored audio does not match this release.');
        const condition = request.headers.get('If-None-Match');
        if (condition?.split(',').some(value => ['*', etag].includes(value.trim().replace(/^W\//, '')))) {
          return new Response(null, { status: 304, headers });
        }
        // Range is defined for GET. HEAD always describes the full representation.
        const ifRange = request.headers.get('If-Range');
        const range = request.method === 'GET' && (!ifRange || ifRange === etag) ? audioRange(request.headers.get('Range'), ref.bytes) : null;
        if (range === false) return error(416, 'Requested range is unavailable.', { 'Content-Range': `bytes */${ref.bytes}`, 'Accept-Ranges': 'bytes' });
        const length = range ? range.end - range.start + 1 : ref.bytes;
        headers.set('Content-Length', String(length));
        if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${ref.bytes}`);
        if (request.method === 'HEAD') return new Response(null, { headers });
        const object = await bucket.get(ref.key, {
          onlyIf: { etagMatches: metadata.etag },
          ...(range ? { range: { offset: range.start, length } } : {}),
        });
        if (!object) return error(404, 'Audio is unavailable in storage.');
        if (!object.body || !valid(object) || object.etag !== metadata.etag ||
            (range && (object.range?.offset !== range.start || object.range?.length !== length))) {
          await object.body?.cancel();
          return error(503, 'Stored audio changed. Please retry.');
        }
        // Pass the R2 stream through without buffering large mixes in Worker memory.
        return new Response(object.body, { status: range ? 206 : 200, headers });
      } catch {
        return error(503, 'Audio streaming is temporarily unavailable.', { 'Retry-After': '30' });
      }
    },
  };
}
