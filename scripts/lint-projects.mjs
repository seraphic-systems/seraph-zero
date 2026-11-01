import { fileURLToPath } from 'node:url';
import { buildCatalog } from './model.mjs';

try {
  const source = fileURLToPath(new URL('../apps/internal/', import.meta.url));
  const { lint } = await buildCatalog(source);
  for (const item of lint) console.error(`${item.source} (${item.record})\n  ${item.path}: ${item.message}`);
  console.log(`${lint.length} Project/Set naming violation${lint.length === 1 ? '' : 's'}.`);
  process.exitCode = lint.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
