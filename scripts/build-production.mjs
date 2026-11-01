import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

// Build an immutable source snapshot, never the index or working directory.
// A PR checkout builds its candidate commit; only master should deploy publicly.
export async function buildProduction(root = repository) {
  const git = async (...args) => (await exec('git', ['-C', root, ...args])).stdout.trim();
  const revision = await git('rev-parse', '--verify', 'HEAD^{commit}');
  const committedAt = await git('show', '-s', '--format=%cI', revision);
  const temporary = await mkdtemp(path.join(tmpdir(), 'seraph-release-'));
  try {
    const archive = path.join(temporary, 'source.tar');
    const snapshot = path.join(temporary, 'source');
    await mkdir(snapshot);
    await git('archive', '--format=tar', `--output=${archive}`, revision,
      'apps', 'shared', 'scripts', 'package.json', 'package-lock.json');
    await exec('tar', ['-xf', archive, '-C', snapshot]);
    for (const file of ['package.json', 'package-lock.json']) {
      if (!(await readFile(path.join(root, file))).equals(await readFile(path.join(snapshot, file)))) {
        throw new Error(`${file} differs from HEAD. Commit dependency changes and run npm ci before building production.`);
      }
    }
    await symlink(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
    const { stdout } = await exec(process.execPath, [path.join(snapshot, 'scripts/build.mjs')], { cwd: snapshot });
    for (const site of ['zero', 'seraphic-systems']) {
      const built = path.join(snapshot, 'dist', site);
      await writeFile(path.join(built, 'release.json'), JSON.stringify({ revision, committed_at: committedAt }, null, 2) + '\n');
    }
    // Copy only completed builds, leaving the local internal workspace alone.
    for (const site of ['zero', 'seraphic-systems', 'cloudflare']) {
      const output = path.join(root, 'dist', site);
      await rm(output, { recursive: true, force: true });
      await cp(path.join(snapshot, 'dist', site), output, { recursive: true });
    }
    console.log(stdout.trim());
    console.log(`Production source: ${revision} (committed ${committedAt})`);
    return revision;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildProduction();
}
