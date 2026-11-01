import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProduction } from './build-production.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

export function deploymentArgs(mode, revision, officialRevision, previewName) {
  if (mode === 'production') {
    if (revision !== officialRevision) throw new Error('Production must deploy the accepted origin/master commit. Merge the pull request first.');
    return ['deploy'];
  }
  if (mode !== 'preview') throw new Error('Choose production or preview.');
  if (!previewName || previewName === 'HEAD' || previewName === 'master') {
    throw new Error('Preview requires a feature branch or an explicit --name.');
  }
  return ['preview', '--name', previewName];
}

async function deploy() {
  const [mode, ...options] = process.argv.slice(2);
  if (options.length && (options.length !== 2 || options[0] !== '--name' || mode !== 'preview')) {
    throw new Error('Usage: node scripts/deploy-cloudflare.mjs production|preview [--name preview-name]');
  }
  const git = async (...args) => (await exec('git', ['-C', root, ...args])).stdout.trim();
  const revision = await git('rev-parse', 'HEAD');
  const official = mode === 'production' ? (await git('ls-remote', 'origin', 'refs/heads/master')).split(/\s/)[0] : null;
  const previewName = mode === 'preview' ? options[1] || await git('branch', '--show-current') : null;
  const args = deploymentArgs(mode, revision, official, previewName);
  // Deployment routing, like content, comes from this exact committed revision.
  const config = JSON.parse(await git('show', `${revision}:wrangler.json`));
  if (await buildProduction(root) !== revision) throw new Error('HEAD changed during deployment preparation. Retry.');
  const release = JSON.parse(await readFile(path.join(root, 'dist/seraphic-systems/release.json'), 'utf8'));
  if (release.revision !== revision) throw new Error('Build revision does not match deployment revision.');
  config.assets.directory = path.join(root, 'dist/seraphic-systems');
  if (config.main) config.main = path.resolve(root, config.main);
  delete config.$schema;
  const temporary = await mkdtemp(path.join(tmpdir(), 'seraph-deploy-'));
  try {
    const configPath = path.join(temporary, 'wrangler.json');
    await writeFile(configPath, JSON.stringify(config));
    const cli = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
    const child = spawn(process.execPath, [cli, ...args, '--config', configPath], { cwd: root, stdio: 'inherit' });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Wrangler exited with ${code}.`)));
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await deploy();
