import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { setsApi } from './scripts/sets-api.mjs';
import { fragmentsApi } from './scripts/fragments-api.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(async ({ mode }) => {
  const site = ['seraphic-systems', 'internal'].includes(mode) ? mode : 'zero';
  const build = () => promisify(execFile)(process.execPath, [path.join(root, 'scripts/build.mjs'), site]);
  await build();

  return {
    root: path.join(root, 'dist', site),
    cacheDir: path.join(root, 'node_modules/.vite'),
    publicDir: false,
    appType: 'mpa',
    server: { host: '127.0.0.1', port: site === 'internal' ? 5175 : site === 'zero' ? 5173 : 5174, watch: { ignored: ['**/dist/**'] } },
    plugins: [{
      name: 'rebuild-static-sites',
      configureServer(server) {
        if (site === 'internal') {
          server.middlewares.use(setsApi(root));
          const fragments = fragmentsApi(root);
          server.middlewares.use(fragments);
          server.httpServer?.once('close', () => { void fragments.close(); });
        }
        const sources = [`apps/${site}`, 'shared', 'scripts'].map((name) => path.join(root, name));
        server.watcher.add(sources);
        let timer;
        let building = false;
        let pending = false;
        async function rebuild() {
          if (building) return;
          building = true;
          try {
            while (pending) {
              pending = false;
              await build();
            }
            server.moduleGraph.invalidateAll();
            server.ws.send({ type: 'full-reload' });
            server.config.logger.info('Sites rebuilt.');
          } catch (error) {
            server.config.logger.error(error.stderr || error.message);
          } finally {
            building = false;
            if (pending) timer = setTimeout(rebuild, 100);
          }
        }
        function onChange(event, file) {
          if (path.basename(file) === '.DS_Store' || file.endsWith('.lock') || file.includes('__pycache__') ||
              path.basename(file).startsWith('.set-registry.json.') ||
              file.includes('/set-snapshots/') || file.endsWith('/set-registry.json') ||
              !sources.some((source) => file.startsWith(source + path.sep))) return;
          pending = true;
          clearTimeout(timer);
          timer = setTimeout(rebuild, 100);
        }
        server.watcher.on('all', onChange);
        server.httpServer?.once('close', () => {
          clearTimeout(timer);
          server.watcher.off('all', onChange);
        });
      },
    }],
  };
});
