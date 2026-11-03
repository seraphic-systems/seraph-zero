import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJournal } from './journal.ts';
import { readHorizons, publicCatalog } from './model.ts';
import { buildOrb } from './orb.ts';

import { emitBrowserModule } from './typescript.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--drafts') || args.length > 1) throw new Error('Usage: node scripts/build.ts [--drafts]');
const output = path.join(root, 'dist/seraphic-systems');
const source = path.join(root, 'apps/seraphic-systems');
// Read and validate before replacing output; local media and private folders are never traversed.
const catalog = publicCatalog(await readHorizons(path.join(root, 'content/horizons')));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'seraphic.css']) {
  let contents = await readFile(path.join(source, name), 'utf8');
  if (name.endsWith('.html')) contents = contents.replaceAll('../../shared/', '/shared/');
  await writeFile(path.join(output, name), contents);
}
await emitBrowserModule(path.join(source, 'geometry.ts'), path.join(output, 'geometry.js'));
await cp(path.join(root, 'shared'), path.join(output, 'shared'), { recursive: true, filter: file => path.basename(file) !== '.DS_Store' });
await buildJournal(path.join(source, 'journal'), path.join(output, 'journal'), { includeDrafts: args.includes('--drafts') });
await buildOrb(path.join(source, 'orb'), output, catalog);
await writeFile(path.join(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Seraphic Systems</title><h1>Page not found</h1><p><a href="/">Home</a> · <a href="/journal/">Journal</a> · <a href="/orb/">Orb</a></p></html>\n');
console.log(`Built dist/seraphic-systems${args.includes('--drafts') ? ' (includes review drafts; do not deploy)' : ''}`);
