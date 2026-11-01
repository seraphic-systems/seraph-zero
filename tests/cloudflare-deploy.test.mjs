import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentArgs } from '../scripts/deploy-cloudflare.mjs';

test('production can only deploy the accepted remote master revision', () => {
  assert.deepEqual(deploymentArgs('production', 'accepted', 'accepted'), ['deploy']);
  assert.throws(() => deploymentArgs('production', 'draft', 'accepted'), /Merge the pull request first/);
});

test('preview deployment stays separate from production and requires a branch name', () => {
  assert.deepEqual(deploymentArgs('preview', 'draft', null, 'feature/cloudflare'), ['preview', '--name', 'feature/cloudflare']);
  for (const name of ['', 'HEAD', 'master']) assert.throws(() => deploymentArgs('preview', 'draft', null, name), /Preview requires/);
  assert.throws(() => deploymentArgs('typo', 'draft', null), /Choose production or preview/);
});
