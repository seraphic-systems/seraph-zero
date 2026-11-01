import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZero } from './zero.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const allSites = ['zero', 'seraphic-systems'];
const args = process.argv.slice(2);
const includeLocalMedia = args.includes('--local-media');
const requestedSite = args.find(arg => !arg.startsWith('--'));
if (args.some(arg => arg.startsWith('--') && arg !== '--local-media') || args.filter(arg => !arg.startsWith('--')).length > 1) {
  throw new Error('Usage: node scripts/build.mjs [zero|seraphic-systems|internal] [--local-media]');
}
if (requestedSite && ![...allSites, 'internal'].includes(requestedSite)) {
  throw new Error(`Unknown site: ${requestedSite}`);
}
const sites = requestedSite ? [requestedSite] : allSites;
const shared = path.join(root, 'shared');

async function rewriteSharedLinks(directory, sourceDirectory, outputRoot) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const source = path.join(sourceDirectory, entry.name);
    if (entry.isDirectory()) {
      await rewriteSharedLinks(target, source, outputRoot);
    } else if (entry.name.endsWith('.html')) {
      const sourcePrefix = path.relative(path.dirname(source), shared).split(path.sep).join('/') + '/';
      const outputPrefix = path.relative(path.dirname(target), path.join(outputRoot, 'shared')).split(path.sep).join('/') + '/';
      const html = await readFile(target, 'utf8');
      await writeFile(target, html.replaceAll(sourcePrefix, outputPrefix));
    }
  }
}

for (const site of sites) {
  const source = path.join(root, 'apps', site);
  const output = path.join(root, 'dist', site);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  if (site === 'zero') {
    await buildZero(source, output);
  } else if (site === 'internal') {
    const { buildInternal } = await import('./internal.mjs');
    await buildInternal(source, output);
  } else {
    await cp(source, output, {
      recursive: true,
      filter: (file) => path.basename(file) !== '.DS_Store' && file !== path.join(source, 'orb'),
    });
    await rewriteSharedLinks(output, source, output);
    const { buildInternal } = await import('./internal.mjs');
    await buildInternal(path.join(root, 'apps/internal'), output, { publicOrb: true, includeLocalMedia });
  }
  await cp(shared, path.join(output, 'shared'), {
    recursive: true,
    filter: (file) => path.basename(file) !== '.DS_Store',
  });
  console.log(`Built dist/${site}`);
}
