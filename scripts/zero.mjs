import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

// Double braces escape metadata; triple braces insert generated HTML.
export function render(template, values) {
  return template.replace(/\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/g, (_, htmlKey, textKey) => {
    const key = htmlKey || textKey;
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown template variable: ${key}`);
    return htmlKey ? String(values[key]) : escapeHtml(values[key]);
  });
}

export async function buildZero(source, output) {
  const posts = [];
  for (const entry of await readdir(path.join(source, 'content/posts'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fail = (message) => { throw new Error(`${entry.name}: ${message}`); };
    const slug = entry.name.slice(0, -3);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('use a lowercase, hyphen-separated filename');
    const { data, content } = matter(await readFile(path.join(source, 'content/posts', entry.name), 'utf8'));
    if (data.draft !== undefined && typeof data.draft !== 'boolean') fail('draft must be true or false');
    if (data.draft === true) continue;
    if (typeof data.title !== 'string' || !data.title.trim()) fail('title is required');
    if (data.description !== undefined && typeof data.description !== 'string') fail('description must be text');
    const date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      fail('date must be a real date in YYYY-MM-DD format');
    }
    posts.push({ slug, title: data.title, description: data.description ?? '', date,
      displayDate: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(date)),
      content: marked.parse(content),
    });
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  const templates = {};
  for (const name of ['layout', 'index', 'post']) {
    templates[name] = await readFile(path.join(source, 'templates', `${name}.html`), 'utf8');
  }
  const page = (values, content) => render(templates.layout, { ...values, content });
  await mkdir(output, { recursive: true });
  const listing = posts.map((post) => `<li class="post-summary">
    <a class="post-card" href="posts/${post.slug}/" aria-labelledby="post-${post.slug}">
      <h2 id="post-${post.slug}">${escapeHtml(post.title)}</h2>
      <time datetime="${post.date}">${escapeHtml(post.displayDate)}</time>
      ${post.description ? `<p>${escapeHtml(post.description)}</p>` : ''}
    </a>
  </li>`).join('\n');
  await writeFile(path.join(output, 'index.html'), page({
    title: 'Seraph Zero', description: 'Posts from Seraph Zero.', shared: 'shared/', home: './',
  }, render(templates.index, { posts: listing || '<li>No posts yet.</li>' })));
  for (const post of posts) {
    const directory = path.join(output, 'posts', post.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), page({
      title: `${post.title} | Seraph Zero`, description: post.description, shared: '../../shared/', home: '../../',
    }, render(templates.post, post)));
  }
  return posts.length;
}
