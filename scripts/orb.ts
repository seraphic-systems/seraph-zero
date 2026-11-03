import type { Catalog } from '../apps/seraphic-systems/orb/types.ts';
import { emitBrowserModule } from './typescript.ts';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { render } from './html.ts';
import { createContentSource } from '../apps/seraphic-systems/orb/content.ts';
import { horizonRoute } from '../apps/seraphic-systems/orb/routes.ts';
import { renderWorld } from '../apps/seraphic-systems/orb/presentations.ts';

export async function buildOrb(source: string, output: string, catalog: Catalog) {
  const publicData = { records: catalog.records.map(record => ({ ...record, contentHtml: marked.parse(record.content ?? '', { async: false }) })) };
  const container = createContentSource(publicData);
  const template = await readFile(path.join(source, 'index.html'), 'utf8');
  await cp(source, path.join(output, 'orb'), { recursive: true, filter: file => !['index.html', '.DS_Store'].includes(path.basename(file)) && !file.endsWith('.ts') });
  for (const name of ['app', 'content', 'engine', 'routes', 'presentations']) {
    await emitBrowserModule(path.join(source, `${name}.ts`), path.join(output, 'orb', `${name}.js`));
  }
  const pages = [{ route: '/orb/', title: 'Horizons', id: null }, { route: '/orb/horizons/', title: 'Horizons', id: null },
    ...container.children.map(node => ({ route: horizonRoute(node.id), title: `${node.label} · Horizons`, id: node.id }))];
  for (const page of pages) {
    const directory = path.join(output, page.route.slice(1));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), render(template, { title: page.title, world: renderWorld(container, page.id) }));
  }
  await writeFile(path.join(output, 'catalog.json'), JSON.stringify(publicData, null, 2) + '\n');
}
