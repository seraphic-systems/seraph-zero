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
  for (const file of ['apps', 'content', 'schema', 'shared', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore']) {
    await cp(path.join(repository, file), path.join(root, file), {
      recursive: true,
      filter: file => !file.split(path.sep).some(part => ['media', 'private', '.DS_Store', '__pycache__'].includes(part)),
    });
  }
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

test('production builds only committed public Horizons and reviewed Journal content, excluding every local edit', async t => {
  const { root, git, commit } = await fixture(t);
  const revision = await buildProduction(root);
  const site = path.join(root, 'dist/seraphic-systems');
  const official = await outputFiles(site);
  const catalog = JSON.parse(await readFile(path.join(site, 'catalog.json'), 'utf8'));
  assert.equal(catalog.records.length, 4);
  assert.ok(catalog.records.every((record: HorizonRecord) => record.type === 'Horizon'));
  assert.match(await readFile(path.join(site, 'journal/index.html'), 'utf8'), /first entry is taking shape/);
  for (const file of ['songs.json', 'stems.json', 'notes.json', 'pages.json', 'model-schema.json', 'orb/music', 'orb/model', 'orb/operations', 'journal/a-foundation-to-trust', 'api', 'shared/components/audio-player']) {
    assert.equal(Object.keys(official).some(name => name === file || name.startsWith(`${file}/`)), false, `unexpected public path: ${file}`);
  }
  await writeFile(path.join(root, 'apps/seraphic-systems/index.html'), '<h1>Unstaged draft</h1>');
  await writeFile(path.join(root, 'shared/untracked.txt'), 'Not official');
  await mkdir(path.join(root, 'apps/internal/media'), { recursive: true });
  await writeFile(path.join(root, 'apps/internal/media/private.wav'), 'PRIVATE_AUDIO');
  await mkdir(path.join(root, 'dist/internal'), { recursive: true });
  await writeFile(path.join(root, 'dist/internal/local.txt'), 'Local workspace');
  const horizon = 'content/horizons/new-direction.md';
  await writeFile(path.join(root, horizon), '---\nid: new-direction\ntitle: New direction\nlevel: 4\ndescription: A deliberate addition.\n---\n');
  await git('add', horizon);
  await writeFile(path.join(root, 'scripts/build.ts'), 'throw new Error("Draft build");');
  assert.equal(await buildProduction(root), revision);
  assert.deepEqual(await outputFiles(site), official);
  assert.equal(await readFile(path.join(root, 'dist/internal/local.txt'), 'utf8'), 'Local workspace');
  assert.equal(JSON.parse(await readFile(path.join(site, 'release.json'), 'utf8')).revision, revision);
  await commit('Accept a new Horizon');
  assert.notEqual(await buildProduction(root), revision);
  assert.ok(JSON.parse(await readFile(path.join(site, 'catalog.json'), 'utf8')).records.some((record: HorizonRecord) => record.data.id === 'new-direction'));
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  await assert.rejects(buildProduction(root), /package-lock.json differs from HEAD/);
});
