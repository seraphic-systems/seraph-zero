import type { HorizonRecord } from '../apps/seraphic-systems/orb/types.ts';
import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProduction } from '../scripts/build-production.ts';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-production-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['apps', 'content', 'schema', 'shared', 'scripts', 'workshop', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore']) {
    await cp(path.join(repository, file), path.join(root, file), {
      recursive: true,
      filter: file => !file.split(path.sep).some(part => ['media', 'private', '.DS_Store', '__pycache__'].includes(part)),
    });
  }
  // Publication coverage uses controlled entries, independent of real Journal content.
  const entries = path.join(root, 'apps/seraphic-systems/journal/entries');
  await rm(entries, { recursive: true, force: true });
  for (const [slug, draft] of [['published-fixture', false], ['draft-fixture', true]] as const) {
    const folder = path.join(entries, slug);
    await mkdir(path.join(folder, 'assets'), { recursive: true });
    await writeFile(path.join(folder, 'index.md'), `---\ntitle: ${slug}\ndescription: Publication fixture\ndraft: ${draft}\n---\n${slug} body.\n`);
    await writeFile(path.join(folder, 'assets/example.txt'), `${slug} asset`);
  }
  await writeFile(path.join(root, 'content/horizons/private-fixture.md'), '---\nid: private-fixture\ntitle: Private fixture\nlevel: 1\ndescription: Private description\nvisibility: private\n---\nPrivate body\n');
  const git = async (...args: string[]) => (await exec('git', ['-C', root, ...args])).stdout.trim();
  await git('init'); await git('add', '.');
  const commit = (message: string) => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', message);
  await commit('Official foundation');
  await symlink(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return { root, git, commit };
}
async function outputFiles(directory: string, prefix = '') {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await outputFiles(path.join(directory, entry.name), `${name}/`));
    else result[name] = (await readFile(path.join(directory, entry.name))).toString('base64');
  }
  return result;
}

test('fixture preview uses separate Horizons and keeps them out of the public build', async t => {
  const { root } = await fixture(t);
  const fixtures = 'tests/fixtures/content/horizons';
  await cp(path.join(repository, fixtures), path.join(root, fixtures), { recursive: true });
  const build = (...args: string[]) => exec(process.execPath, ['--experimental-strip-types', 'scripts/build.ts', ...args], { cwd: root });
  const site = path.join(root, 'dist/seraphic-systems');
  const preview = path.join(root, 'dist/fixtures-preview');
  const feed = 'api/v1/horizons.json';
  const routes = 'orb/horizons';

  await build('--fixtures');
  const fixtureFeed = await readFile(path.join(preview, feed), 'utf8');
  assert.match(fixtureFeed, /"id": "fixture-curiosity"/);
  assert.doesNotMatch(fixtureFeed, /"id": "(creation|fixture-private-workshop-notes)"/);
  assert.match(await readFile(path.join(preview, routes, 'fixture-curiosity/index.html'), 'utf8'), /Curiosity/);
  await assert.rejects(readdir(site), { code: 'ENOENT' });

  await build();
  const publicFeed = await readFile(path.join(site, feed), 'utf8');
  assert.match(publicFeed, /"id": "creation"/);
  assert.doesNotMatch(publicFeed, /"id": "fixture-/);
  assert.doesNotMatch(await readFile(path.join(site, 'catalog.json'), 'utf8'), /"id": "fixture-/);
  assert.equal((await readdir(path.join(site, routes))).some(name => name.startsWith('fixture-')), false);
  assert.equal(await readFile(path.join(preview, feed), 'utf8'), fixtureFeed);
});

test('production builds only committed public Horizons and reviewed Journal content, excluding every local edit', async t => {
  const { root, git, commit } = await fixture(t);
  const revision = await buildProduction(root);
  const site = path.join(root, 'dist/seraphic-systems');
  const official = await outputFiles(site);
  const catalog = JSON.parse(await readFile(path.join(site, 'catalog.json'), 'utf8'));
  assert.equal(catalog.records.length, 4);
  assert.ok(catalog.records.every((record: HorizonRecord) => record.type === 'Horizon'));
  const feed = 'api/v1/horizons.json';
  assert.deepEqual(JSON.parse(await readFile(path.join(site, feed), 'utf8')), {
    horizons: catalog.records.map(({ data, content }: HorizonRecord) => ({
      id: data.id, title: data.title, level: data.level, description: data.description,
      created_at: data.created_at, content,
    })),
  });
  assert.deepEqual(Object.keys(official).filter(name => name.startsWith('api/')), [feed]);
  assert.equal(await readFile(path.join(site, '_headers'), 'utf8'), `/${feed}\n  Access-Control-Allow-Origin: *\n`);
  const journal = await readFile(path.join(site, 'journal/index.html'), 'utf8');
  assert.match(journal, /href="\/journal\/published-fixture\/"/);
  assert.doesNotMatch(journal, /draft-fixture/);
  assert.match(await readFile(path.join(site, 'journal/published-fixture/index.html'), 'utf8'), /published-fixture body\./);
  assert.equal(await readFile(path.join(site, 'journal/published-fixture/assets/example.txt'), 'utf8'), 'published-fixture asset');
  for (const file of ['workshop', 'components', 'workshop.ts', 'workshop.css', 'songs.json', 'stems.json', 'notes.json', 'pages.json', 'model-schema.json', 'orb/music', 'orb/model', 'orb/operations', 'journal/draft-fixture', 'shared/components/audio-player']) {
    assert.equal(Object.keys(official).some(name => name === file || name.startsWith(`${file}/`)), false, `unexpected public path: ${file}`);
  }
  await writeFile(path.join(root, 'apps/seraphic-systems/index.html'), '<h1>Unstaged draft</h1>');
  await writeFile(path.join(root, 'apps/seraphic-systems/journal/entries/published-fixture/index.md'), 'Uncommitted Journal edit');
  await writeFile(path.join(root, 'shared/untracked.txt'), 'Not official');
  await mkdir(path.join(root, 'apps/internal/media'), { recursive: true });
  await writeFile(path.join(root, 'apps/internal/media/private.wav'), 'PRIVATE_AUDIO');
  await mkdir(path.join(root, 'dist/internal'), { recursive: true });
  await writeFile(path.join(root, 'dist/internal/local.txt'), 'Local workspace');
  const horizon = 'content/horizons/new-direction.md';
  await writeFile(path.join(root, horizon), '---\nid: new-direction\ntitle: New direction\nlevel: 4\ndescription: A deliberate addition.\nextra_field: Extra metadata\n---\n');
  await git('add', horizon);
  await writeFile(path.join(root, 'scripts/build.ts'), 'throw new Error("Draft build");');
  assert.equal(await buildProduction(root), revision);
  assert.deepEqual(await outputFiles(site), official);
  assert.equal(await readFile(path.join(root, 'dist/internal/local.txt'), 'utf8'), 'Local workspace');
  assert.equal(JSON.parse(await readFile(path.join(site, 'release.json'), 'utf8')).revision, revision);
  await commit('Accept a new Horizon');
  assert.notEqual(await buildProduction(root), revision);
  assert.ok(JSON.parse(await readFile(path.join(site, 'catalog.json'), 'utf8')).records.some((record: HorizonRecord) => record.data.id === 'new-direction'));
  const updatedFeed = JSON.parse(await readFile(path.join(site, feed), 'utf8'));
  assert.deepEqual(updatedFeed.horizons.find((item: { id: string }) => item.id === 'new-direction'), {
    id: 'new-direction', title: 'New direction', level: 4, description: 'A deliberate addition.',
    created_at: null, content: '',
  });
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  await assert.rejects(buildProduction(root), /package-lock.json differs from HEAD/);
});
