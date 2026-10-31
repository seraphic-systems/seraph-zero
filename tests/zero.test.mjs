import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, readdir, access, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildZero } from '../scripts/zero.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'seraph-blog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'apps', 'zero');
  const output = path.join(directory, 'dist');
  await mkdir(path.join(source, 'content/posts'), { recursive: true });
  await cp(new URL('../apps/zero/templates', import.meta.url), path.join(source, 'templates'), { recursive: true });
  const post = (slug, metadata, body = '') => writeFile(path.join(source, 'content/posts', `${slug}.md`),
    `---\n${metadata}\n---\n${body}`);
  return { source, output, post };
}

test('generates Markdown posts, sorts homepage, escapes metadata, and excludes drafts', async (t) => {
  const { source, output, post } = await fixture(t);
  await post('older', 'title: Older\ndate: "2026-01-01"');
  await post('newer', 'title: \'New <signal> & "news"\'\ndate: "2026-10-30"\ndescription: \'A <summary>\'',
    '## Opening\n\n**Hello**, world.\n\n- One\n- Two\n\n![Angel](../../shared/assets/angel-icon.png)');
  await post('draft', 'title: Secret\ndate: "2026-10-31"\ndraft: true');
  assert.equal(await buildZero(source, output), 2);
  const home = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.ok(home.indexOf('posts/newer/') < home.indexOf('posts/older/'));
  assert.doesNotMatch(home, /Secret|posts\/draft/);
  assert.match(home, /New &lt;signal&gt; &amp; &quot;news&quot;/);
  const html = await readFile(path.join(output, 'posts/newer/index.html'), 'utf8');
  assert.match(html, /<h2>Opening<\/h2>/);
  assert.match(html, /<strong>Hello<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /October 30, 2026/);
  assert.match(html, /href="\.\.\/\.\.\/shared\/styles.css"/);
  assert.match(html, /src="\.\.\/\.\.\/shared\/assets\/angel-icon.png"/);
  await assert.rejects(access(path.join(output, 'posts/draft/index.html')));
  await assert.rejects(access(path.join(output, 'content')));
  await assert.rejects(access(path.join(output, 'templates')));
});

test('invalid metadata gives an actionable filename and error', async (t) => {
  const { source, output, post } = await fixture(t);
  await post('bad', 'title: Bad\ndate: "2026-02-30"');
  await assert.rejects(buildZero(source, output), /bad.md: date must be a real date/);
  await post('bad', 'title: Bad\ndate: "2026-01-01"\ndraft: "false"');
  await assert.rejects(buildZero(source, output), /bad.md: draft must be true or false/);
  await post('bad', 'date: "2026-01-01"');
  await assert.rejects(buildZero(source, output), /bad.md: title is required/);
});

test('an empty blog still generates a homepage', async (t) => {
  const { source, output } = await fixture(t);
  assert.equal(await buildZero(source, output), 0);
  assert.match(await readFile(path.join(output, 'index.html'), 'utf8'), /No posts yet/);
});

test('full build keeps deployments self-contained and removes unpublished or deleted posts', async (t) => {
  const { source, output, post } = await fixture(t);
  const root = path.dirname(path.dirname(source));
  for (const directory of ['scripts', 'shared', 'apps/seraphic-systems']) {
    await cp(new URL(`../${directory}`, import.meta.url), path.join(root, directory), { recursive: true });
  }
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'), 'dir');
  await mkdir(path.join(root, 'apps/internal/media/mixes'), { recursive: true });
  await writeFile(path.join(root, 'apps/internal/media/mixes/internal-only.wav'), 'local audio');
  const build = () => promisify(execFile)(process.execPath, [path.join(root, 'scripts/build.mjs')]);
  await post('published', 'title: Published\ndate: "2026-10-30"');
  await post('removed', 'title: Removed\ndate: "2026-10-29"');
  await build();
  const dist = path.join(root, 'dist');
  assert.deepEqual((await readdir(dist)).sort(), ['seraphic-systems', 'zero']);
  await access(path.join(dist, 'zero/posts/published/index.html'));
  await post('published', 'title: Published\ndate: "2026-10-30"\ndraft: true');
  await rm(path.join(source, 'content/posts/removed.md'));
  await build();
  await assert.rejects(access(path.join(dist, 'zero/posts/published/index.html')));
  await assert.rejects(access(path.join(dist, 'zero/posts/removed/index.html')));
  await assert.rejects(access(path.join(dist, 'zero/content')));
  await assert.rejects(access(path.join(dist, 'zero/templates')));
  for (const site of ['zero', 'seraphic-systems']) {
    assert.equal(await readFile(path.join(dist, site, 'shared/styles.css'), 'utf8'),
      await readFile(path.join(root, 'shared/styles.css'), 'utf8'));
    await access(path.join(dist, site, 'shared/favicon.ico'));
    assert.match(await readFile(path.join(dist, site, 'index.html'), 'utf8'), /href="shared\/styles.css"/);
  }
});
