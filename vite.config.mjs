import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const exec = promisify(execFile);
export default defineConfig(async () => {
  const build = () => exec(process.execPath, [path.join(root, 'scripts/build.mjs'), '--drafts']);
  await build();
  return {
    root: path.join(root, 'dist/seraphic-systems'),
    cacheDir: path.join(root, 'node_modules/.vite'), publicDir: false, appType: 'mpa',
    server: { host: '127.0.0.1', port: 5174, watch: { ignored: ['**/dist/**'] } },
    plugins: [{
      name: 'rebuild-foundation',
      configureServer(server) {
        const sources = ['apps/seraphic-systems', 'apps/internal/data/horizons', 'apps/internal/model', 'shared', 'scripts'].map(name => path.join(root, name));
        server.watcher.add(sources);
        let timer, building = false, pending = false;
        async function rebuild() {
          if (building) return;
          building = true;
          try {
            while (pending) { pending = false; await build(); }
            server.moduleGraph.invalidateAll();
            server.ws.send({ type: 'full-reload' });
          } catch (error) {
            server.config.logger.error(error.stderr || error.message);
            server.ws.send({ type: 'error', err: { message: error.stderr || error.message, stack: '' } });
          } finally {
            building = false;
            if (pending) timer = setTimeout(rebuild, 100);
          }
        }
        function onChange(event, file) {
          if (path.basename(file) === '.DS_Store' || !sources.some(source => file.startsWith(source + path.sep))) return;
          pending = true; clearTimeout(timer); timer = setTimeout(rebuild, 100);
        }
        server.watcher.on('all', onChange);
        server.httpServer?.once('close', () => { clearTimeout(timer); server.watcher.off('all', onChange); });
      },
    }],
  };
});
