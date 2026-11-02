import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { render } from './html.mjs';
import { createContentSource } from '../apps/seraphic-systems/orb/content.js';
import { horizonRoute } from '../apps/seraphic-systems/orb/routes.js';
import { renderWorld } from '../apps/seraphic-systems/orb/presentations.js';

export async function buildOrb(source, output, catalog) {
  const publicData = { records: catalog.records.map(record => ({ ...record, contentHtml: marked.parse(record.content) })) };
  const container = createContentSource(publicData);
  const template = await readFile(path.join(source, 'index.html'), 'utf8');
  await cp(source, path.join(output, 'orb'), { recursive: true, filter: file => !['index.html', '.DS_Store'].includes(path.basename(file)) });
  const pages = [{ route: '/orb/', title: 'Horizons', id: null }, { route: '/orb/horizons/', title: 'Horizons', id: null },
    ...container.children.map(node => ({ route: horizonRoute(node.id), title: `${node.label} · Horizons`, id: node.id }))];
  for (const page of pages) {
    const directory = path.join(output, page.route.slice(1));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), render(template, { title: page.title, world: renderWorld(container, page.id) }));
  }
  await writeFile(path.join(output, 'catalog.json'), JSON.stringify(publicData, null, 2) + '\n');
}
