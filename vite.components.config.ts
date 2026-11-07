import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const directory = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// A source preview only: the public static build never reads this directory.
export default defineConfig({
  root: directory('./workshop'),
  publicDir: false,
  cacheDir: directory('./node_modules/.vite-components'),
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    fs: { allow: [directory('./workshop'), directory('./shared')] },
  },
});
