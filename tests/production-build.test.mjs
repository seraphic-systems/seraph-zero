import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProduction } from '../scripts/build-production.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'seraph-production-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['apps', 'shared', 'scripts', 'package.json', 'package-lock.json', '.gitignore']) {
    await cp(path.join(repository, file), path.join(root, file), {
      recursive: true,
      filter: file => !file.split(path.sep).includes('media') && !file.endsWith('.DS_Store'),
    });
  }
  const git = async (...args) => (await exec('git', ['-C', root, ...args])).stdout.trim();
  await git('init');
  await git('add', '.');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Official content');
  await symlink(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return { root, git };
}

async function outputFiles(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await outputFiles(path.join(directory, entry.name), `${name}/`));
    else result[name] = (await readFile(path.join(directory, entry.name))).toString('base64');
  }
  return result;
}

test('production builds HEAD, excluding staged, unstaged, untracked and ignored content', async t => {
  const { root, git } = await fixture(t);
  const revision = await buildProduction(root);
  const official = await outputFiles(path.join(root, 'dist'));
  await writeFile(path.join(root, 'apps/seraphic-systems/index.html'), '<h1>Unstaged draft</h1>');
  await writeFile(path.join(root, 'shared/untracked.txt'), 'Not official');
  await writeFile(path.join(root, 'apps/internal/data/mix-media.json'), '{broken draft manifest');
  await mkdir(path.join(root, 'dist/internal'), { recursive: true });
  await writeFile(path.join(root, 'dist/internal/local.txt'), 'Local workspace');
  await mkdir(path.join(root, 'apps/internal/media/mixes'), { recursive: true });
  await writeFile(path.join(root, 'apps/internal/media/mixes/not-a-valid-mix.wav'), 'local audio');
  await writeFile(path.join(root, 'apps/internal/data/songs/unpublished.md'), '---\nid: unpublished\ntitle: Unpublished\n---\n');
  await git('add', 'apps/internal/data/songs/unpublished.md');
  // A locally broken build script must not change the committed build either.
  await writeFile(path.join(root, 'scripts/build.mjs'), 'throw new Error("Draft build");');
  assert.equal(await buildProduction(root), revision);
  for (const site of ['zero', 'seraphic-systems']) {
    const rebuilt = await outputFiles(path.join(root, 'dist', site), `${site}/`);
    const expected = Object.fromEntries(Object.entries(official).filter(([file]) => file.startsWith(`${site}/`)));
    assert.deepEqual(rebuilt, expected);
  }
  assert.equal(await readFile(path.join(root, 'dist/internal/local.txt'), 'utf8'), 'Local workspace');
  const release = JSON.parse(await readFile(path.join(root, 'dist/seraphic-systems/release.json'), 'utf8'));
  assert.equal(release.revision, await git('rev-parse', 'HEAD'));
  // Accepting the content into a commit makes it appear in the next release.
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Accept new song');
  assert.notEqual(await buildProduction(root), revision);
  const songs = JSON.parse(await readFile(path.join(root, 'dist/seraphic-systems/songs.json'), 'utf8'));
  assert.ok(songs.some(song => song.id === 'unpublished'));
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  await assert.rejects(buildProduction(root), /package-lock.json differs from HEAD/);
});
