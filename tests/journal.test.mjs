import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildJournal } from '../scripts/journal.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'seraph-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const output = path.join(directory, 'output');
  await cp(new URL('../apps/seraphic-systems/journal', import.meta.url), source, { recursive: true });
  await rm(path.join(source, 'entries'), { recursive: true });
  await mkdir(path.join(source, 'entries'));
  const entry = async (slug, metadata, body = '', format = 'md') => {
    const folder = path.join(source, 'entries', slug);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `index.${format}`), `---\n${metadata}\n---\n${body}`);
    return folder;
  };
  return { source, output, entry };
}

test('journal supports Markdown and bespoke HTML, optional dates, and only publishes public assets', async t => {
  const { source, output, entry } = await fixture(t);
  await entry('undated', "title: 'A <world>'\ndescription: 'A & B'", '## Begin\n\n**Hello**');
  await entry('older', 'title: Older\ndescription: Earlier\ndate: "2026-01-01"');
  const custom = await entry('custom', 'title: Custom\ndescription: Listen\ndate: "2026-11-01"', '<section class="experience">A custom experience</section>', 'html');
  for (const file of ['style.css', 'script.js', 'private-notes.md']) await writeFile(path.join(custom, file), 'fixture');
  await mkdir(path.join(custom, 'assets'));
  await writeFile(path.join(custom, 'assets/art.svg'), '<svg/>');
  const draft = await entry('draft', 'draft: true', 'Secret');
  await writeFile(path.join(draft, 'script.js'), 'Secret script');
  assert.equal(await buildJournal(source, output), 3);
  const index = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.ok(index.indexOf('/journal/custom/') < index.indexOf('/journal/older/'));
  assert.ok(index.indexOf('/journal/older/') < index.indexOf('/journal/undated/'));
  assert.match(index, /A &lt;world&gt;/);
  assert.doesNotMatch(index, /Secret|\/draft\//);
  const markdown = await readFile(path.join(output, 'undated/index.html'), 'utf8');
  assert.match(markdown, /<h2>Begin<\/h2>/);
  assert.match(markdown, /<strong>Hello<\/strong>/);
  assert.match(markdown, /content="A &amp; B"/);
  assert.doesNotMatch(markdown, /<time/);
  const html = await readFile(path.join(output, 'custom/index.html'), 'utf8');
  assert.match(html, /<section class="experience">/);
  assert.match(html, /href="\.\/style.css"/);
  assert.match(html, /src="\.\/script.js"/);
  assert.match(html, /November 1, 2026/);
  await access(path.join(output, 'custom/assets/art.svg'));
  for (const file of ['draft', 'entries', 'templates', 'custom/index.md', 'custom/private-notes.md']) {
    await assert.rejects(access(path.join(output, file)));
  }
});

test('journal rejects invalid publication metadata and ambiguous bodies', async t => {
  const { source, output, entry } = await fixture(t);
  const folder = await entry('invalid', 'title: Test\ndescription: Test\ndraft: "false"');
  await assert.rejects(buildJournal(source, output), /journal\/invalid: draft must be/);
  await entry('invalid', 'title: Test\ndescription: Test\ndate: "2026-02-30"');
  await assert.rejects(buildJournal(source, output), /real YYYY-MM-DD/);
  await entry('invalid', 'title: Test');
  await assert.rejects(buildJournal(source, output), /description is required/);
  await writeFile(path.join(folder, 'index.html'), '<p>Duplicate</p>');
  await assert.rejects(buildJournal(source, output), /exactly one/);
});

test('an empty journal still renders a navigable index', async t => {
  const { source, output } = await fixture(t);
  assert.equal(await buildJournal(source, output), 0);
  assert.match(await readFile(path.join(output, 'index.html'), 'utf8'), /first entry is taking shape/);
});
