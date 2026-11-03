import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deploymentArgs } from '../scripts/deploy-cloudflare.ts';

test('production can only deploy the accepted remote master revision', () => {
  assert.deepEqual(deploymentArgs('production', 'accepted', 'accepted'), ['deploy']);
  assert.throws(() => deploymentArgs('production', 'draft', 'accepted'), /Merge the pull request first/);
});

test('preview deployment stays separate from production and requires a branch name', () => {
  assert.deepEqual(deploymentArgs('preview', 'draft', null, 'feature/cloudflare'), ['preview', '--name', 'feature/cloudflare']);
  for (const name of ['', 'HEAD', 'master']) assert.throws(() => deploymentArgs('preview', 'draft', null, name), /Preview requires/);
  assert.throws(() => deploymentArgs('typo', 'draft', null), /Choose production or preview/);
});

// Workers Builds uses `wrangler preview` for feature branches. The production
// dry run does not catch its mandatory preview opt-in.
test('the checked-in configuration enables previews without audio bindings', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8'));
  assert.ok(config.previews && typeof config.previews === 'object' && !Array.isArray(config.previews), 'wrangler preview requires a previews block, even for a static site');
  assert.equal(config.r2_buckets, undefined);
  assert.equal(config.previews.r2_buckets, undefined);
});
