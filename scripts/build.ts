import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJournal } from './journal.ts';
import { readHorizons, readVisualizerRecordIds, publicCatalog } from './model.ts';
import { buildOrb } from './orb.ts';

import { emitBrowserModule } from './typescript.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, ...extra] = process.argv.slice(2);
if (extra.length || (mode !== undefined && mode !== '--drafts' && mode !== '--fixtures')) {
  throw new Error('Usage: node scripts/build.ts [--drafts|--fixtures]');
}
const fixtures = mode === '--fixtures';
const outputDirectory = fixtures ? 'dist/fixtures-preview' : 'dist/seraphic-systems';
const output = path.join(root, outputDirectory);
const records = path.join(root, fixtures ? 'tests/fixtures/content' : 'content');
const source = path.join(root, 'apps/seraphic-systems');
// Read and validate before replacing output; local media and private folders are never traversed.
await readVisualizerRecordIds('Mix', path.join(records, 'mixes'));
await readVisualizerRecordIds('OrganicMemory', path.join(records, 'organic-memories'));
const catalog = publicCatalog(await readHorizons(path.join(records, 'horizons')));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'seraphic.css']) {
  let contents = await readFile(path.join(source, name), 'utf8');
  if (name.endsWith('.html')) contents = contents.replaceAll('../../shared/', '/shared/');
  await writeFile(path.join(output, name), contents);
}
await emitBrowserModule(path.join(source, 'geometry.ts'), path.join(output, 'geometry.js'));
await cp(path.join(root, 'shared'), path.join(output, 'shared'), { recursive: true, filter: file => path.basename(file) !== '.DS_Store' });
await buildJournal(path.join(source, 'journal'), path.join(output, 'journal'), { includeDrafts: mode !== undefined });
await buildOrb(path.join(source, 'orb'), output, catalog);
const horizons = catalog.records.map(({ data, content }) => ({
  id: data.id,
  title: data.title,
  level: data.level,
  description: data.description,
  created_at: data.created_at ?? null,
  content: content ?? '',
}));
const horizonsFeed = 'api/v1/horizons.json';
await mkdir(path.dirname(path.join(output, horizonsFeed)), { recursive: true });
await writeFile(path.join(output, horizonsFeed), JSON.stringify({ horizons }, null, 2) + '\n');
await writeFile(path.join(output, '_headers'), `/${horizonsFeed}\n  Access-Control-Allow-Origin: *\n`);
await writeFile(path.join(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Seraphic Systems</title><h1>Page not found</h1><p><a href="/">Home</a> · <a href="/journal/">Journal</a> · <a href="/orb/">Orb</a></p></html>\n');
console.log(`Built ${outputDirectory}${mode ? ' (includes review drafts; do not deploy)' : ''}`);
