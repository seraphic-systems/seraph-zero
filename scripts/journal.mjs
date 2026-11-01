import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { escapeHtml, render } from './zero.mjs';

// Entries share a document frame, but own their body and optional assets.
export async function buildJournal(source, output) {
  const entries = [];
  const entriesRoot = path.join(source, 'entries');
  for (const directory of await readdir(entriesRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const slug = directory.name;
    const fail = message => { throw new Error(`journal/${slug}: ${message}`); };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('use a lowercase, hyphen-separated directory name');
    const folder = path.join(entriesRoot, slug);
    const files = await readdir(folder);
    const bodies = files.filter(file => ['index.md', 'index.html'].includes(file));
    if (bodies.length !== 1) fail('provide exactly one index.md or index.html');
    const { data, content } = matter(await readFile(path.join(folder, bodies[0]), 'utf8'));
    if (data.draft !== undefined && typeof data.draft !== 'boolean') fail('draft must be true or false');
    if (data.draft === true) continue;
    for (const field of ['title', 'description']) {
      if (typeof data[field] !== 'string' || !data[field].trim()) fail(`${field} is required`);
    }
    const date = data.date;
    if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      fail('date must be a quoted, real YYYY-MM-DD date, or omitted');
    }
    entries.push({ slug, folder, title: data.title, description: data.description, date,
      content: bodies[0].endsWith('.md') ? marked.parse(content) : content,
      styles: files.includes('style.css') ? '<link rel="stylesheet" href="./style.css">' : '',
      scripts: files.includes('script.js') ? '<script type="module" src="./script.js"></script>' : '',
    });
  }
  entries.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.slug.localeCompare(b.slug));
  const layout = await readFile(path.join(source, 'templates/layout.html'), 'utf8');
  const index = await readFile(path.join(source, 'templates/index.html'), 'utf8');
  const entryTemplate = await readFile(path.join(source, 'templates/entry.html'), 'utf8');
  const dateHtml = entry => entry.date ? `<time datetime="${entry.date}">${new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long', timeZone: 'UTC',
  }).format(new Date(entry.date))}</time>` : '';
  const page = (values, content) => render(layout, { styles: '', scripts: '', entry: '', current: values.entry ? 'location' : 'page', ...values, content });
  await mkdir(output, { recursive: true });
  await cp(path.join(source, 'journal.css'), path.join(output, 'journal.css'));
  const listing = entries.map(entry => `<li><a class="entry-link" href="/journal/${entry.slug}/">
    <div class="entry-meta">${dateHtml(entry) || '<span>Journal</span>'}</div>
    <div><h2>${escapeHtml(entry.title)}</h2><p>${escapeHtml(entry.description)}</p></div>
    <span class="entry-arrow" aria-hidden="true">↗</span>
  </a></li>`).join('\n');
  await writeFile(path.join(output, 'index.html'), page({ title: 'Journal',
    description: 'Stories, notes, and experiences from Seraphic Systems.',
  }, render(index, { entries: listing || '<li class="empty-state">The first entry is taking shape. Come back soon.</li>' })));
  for (const entry of entries) {
    const target = path.join(output, entry.slug);
    await mkdir(target, { recursive: true });
    // Only an explicit public assets directory and the page's style/module ship.
    for (const file of await readdir(entry.folder)) {
      if (['assets', 'style.css', 'script.js'].includes(file)) {
        await cp(path.join(entry.folder, file), path.join(target, file), { recursive: true });
      }
    }
    await writeFile(path.join(target, 'index.html'), page({ ...entry, entry: entry.slug,
      title: entry.title, description: entry.description,
    }, render(entryTemplate, { ...entry, date: dateHtml(entry) })));
  }
  return entries.length;
}
