import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const exec = promisify(execFile);
export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const fixtures = mode === 'fixtures';
  const build = () => exec(process.execPath, ['--experimental-strip-types', path.join(root, 'scripts/build.ts'), fixtures ? '--fixtures' : '--drafts']);
  await build();
  return {
    root: path.join(root, fixtures ? 'dist/fixtures-preview' : 'dist/seraphic-systems'),
    cacheDir: path.join(root, 'node_modules/.vite'), publicDir: false, appType: 'mpa',
    server: { host: '127.0.0.1', port: 5174, watch: { ignored: ['**/dist/**'] } },
    plugins: [{
      name: 'rebuild-foundation',
      configureServer(server) {
        const records = fixtures ? 'tests/fixtures/content' : 'content';
        const sources = ['apps/seraphic-systems', records, 'schema', 'shared', 'scripts'].map(name => path.join(root, name));
        server.watcher.add(sources);
        let timer: ReturnType<typeof setTimeout> | undefined, building = false, pending = false;
        async function rebuild() {
          if (building) return;
          building = true;
          try {
            while (pending) { pending = false; await build(); }
            server.moduleGraph.invalidateAll();
            server.ws.send({ type: 'full-reload' });
          } catch (error) {
            const message = error instanceof Error ? ('stderr' in error ? String(error.stderr) : error.message) : String(error);
            server.config.logger.error(message);
            server.ws.send({ type: 'error', err: { message, stack: '' } });
          } finally {
            building = false;
            if (pending) timer = setTimeout(rebuild, 100);
          }
        }
        function onChange(event: string, file: string) {
          if (path.basename(file) === '.DS_Store' || !sources.some(source => file.startsWith(source + path.sep))) return;
          pending = true; clearTimeout(timer); timer = setTimeout(rebuild, 100);
        }
        server.watcher.on('all', onChange);
        server.httpServer?.once('close', () => { clearTimeout(timer); server.watcher.off('all', onChange); });
      },
    }],
  };
});
