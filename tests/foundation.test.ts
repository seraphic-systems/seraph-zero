import type { Catalog, HorizonData } from '../apps/seraphic-systems/orb/types.ts';
import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ajv } from 'ajv';
import formats from 'ajv-formats';
import matter from 'gray-matter';
import { readHorizons, publicCatalog, modelSchema } from '../scripts/model.ts';
import { createRecord } from '../scripts/create-record.ts';
import { buildOrb } from '../scripts/orb.ts';
import { createContentSource } from '../apps/seraphic-systems/orb/content.ts';
import { resolveRoute, horizonRoute } from '../apps/seraphic-systems/orb/routes.ts';
import { layout } from '../apps/seraphic-systems/orb/engine.ts';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'seraph-foundation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const metadata: HorizonData = { id: 'creation', title: 'Creation', level: 1, description: 'Giving form.', created_at: '2026-10-30T23:33:11.000Z' };

test('Horizon contracts reject invalid shape, timestamps and duplicate permanent identities', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'first.md'), matter.stringify('A body.', metadata));
  let records = await readHorizons(directory);
  assert.equal(records[0].data.created_at, metadata.created_at);
  assert.equal(records[0].content, 'A body.');
  assert.deepEqual(Object.keys(modelSchema.definitions).sort(), ['Horizon', 'Mix', 'OrganicMemory', 'RecordBase']);
  await writeFile(path.join(directory, 'renamed.md'), matter.stringify('', metadata));
  await assert.rejects(readHorizons(directory), /duplicate Horizon id/);
  await rm(path.join(directory, 'renamed.md'));
  for (const changes of [{ level: 5 }, { title: ' ' }, { created_at: 'yesterday' }, { visibility: 'maybe' }]) {
    await writeFile(path.join(directory, 'first.md'), matter.stringify('', { ...metadata, ...changes }));
    await assert.rejects(readHorizons(directory));
  }
});

test('visualizer inputs validate their identities and require explicit visibility', () => {
  const ajv = new Ajv();
  formats.default(ajv);
  ajv.addSchema(modelSchema, 'foundation');
  const validateMemory = ajv.compile({ $ref: 'foundation#/definitions/OrganicMemory' });
  const validateMix = ajv.compile({ $ref: 'foundation#/definitions/Mix' });
  const memory = { id: 'first-snow', title: 'First snow' };
  const mixIdentity = { song: 'coldness', date: '2026-04-04' };
  const mix = { ...mixIdentity, audio_file: 'mixes/coldness/2026-04-04.wav' };
  const privateMetadata = { visibility: 'private', created_at: null };

  assert.equal(validateMemory({ ...memory, ...privateMetadata }), true);
  assert.equal(validateMix({ ...mix, ...privateMetadata }), true);
  assert.equal(validateMix({ ...mixIdentity, ...privateMetadata }), false);
  for (const invalidKey of [
    ' ',
    '/audio/coldness.wav',
    '../audio/coldness.wav',
    'mixes/../coldness.wav',
    's3://audio/coldness.wav',
    'https://example.com/coldness.wav?signature=example',
  ]) {
    assert.equal(validateMix({ ...mix, ...privateMetadata, audio_file: invalidKey }), false, invalidKey);
  }
  assert.equal(validateMemory(memory), false);
  assert.equal(validateMix(mix), false);
  assert.equal(validateMemory({ ...memory, ...privateMetadata, id: 'First Snow' }), false);
  assert.equal(validateMemory({ ...memory, ...privateMetadata, title: ' ' }), false);
  assert.equal(validateMix({ ...mix, ...privateMetadata, date: '2026-02-30' }), false);
  assert.equal(validateMix({ ...mix, ...privateMetadata, created_at: '2026-04-04' }), false);
});

test('creation is private by default, preserves supplied dates, and refuses IDs even after filename changes', async t => {
  const directory = await fixture(t);
  const file = await createRecord('Horizon', metadata, directory);
  const before = await readFile(file, 'utf8');
  const data = matter(before).data;
  assert.equal(data.visibility, 'private');
  assert.equal(data.created_at, metadata.created_at);
  assert.deepEqual(publicCatalog(await readHorizons(directory)), { records: [] });
  await assert.rejects(createRecord('Horizon', metadata, directory), /already exists/);
  assert.equal(await readFile(file, 'utf8'), before);
  await writeFile(path.join(directory, 'another-filename.md'), before);
  await rm(file);
  await assert.rejects(createRecord('Horizon', metadata, directory), /already exists/);
  await assert.rejects(createRecord('Song', metadata, directory), /Choose Horizon, Mix, or OrganicMemory/);
});

test('mix creation preserves an unknown creation time and refuses duplicate song versions', async t => {
  const directory = await fixture(t);
  const mix = { song: 'coldness', date: '2026-04-04', audio_file: 'mixes/coldness.wav', created_at: null };
  const file = await createRecord('Mix', mix, directory);
  assert.equal(path.basename(file), 'coldness-2026-04-04.md');
  const saved = await readFile(file, 'utf8');
  assert.deepEqual(matter(saved).data, { ...mix, visibility: 'private' });
  await writeFile(path.join(directory, 'renamed.md'), saved);
  await rm(file);
  await assert.rejects(createRecord('Mix', mix, directory), /already exists/);
});

test('memory creation uses its stable ID and defaults to private', async t => {
  const directory = await fixture(t);
  const memory = { id: 'first-snow', title: 'First snow' };
  const file = await createRecord('OrganicMemory', memory, directory);
  assert.equal(path.basename(file), 'first-snow.md');
  const { data } = matter(await readFile(file, 'utf8'));
  assert.equal(data.visibility, 'private');
  assert.equal(data.id, memory.id);
  await assert.rejects(createRecord('OrganicMemory', { ...memory, title: 'First snow again' }, directory), /already exists/);
});

test('public Orb includes only public Horizons, with complete HTML and no private routes or catalog bodies', async t => {
  const directory = await fixture(t);
  const source = path.join(directory, 'horizons');
  const output = path.join(directory, 'output');
  await mkdir(source);
  await writeFile(path.join(source, 'public.md'), matter.stringify('## More\n\nThe public body.', metadata));
  await writeFile(path.join(source, 'private.md'), matter.stringify('PRIVATE_BODY', { ...metadata, id: 'secret-horizon', title: 'PRIVATE_TITLE', visibility: 'private' }));
  const catalog = publicCatalog(await readHorizons(source));
  await buildOrb(new URL('../apps/seraphic-systems/orb', import.meta.url).pathname, output, catalog);
  const modules = await readdir(path.join(output, 'orb'));
  assert.equal(modules.some(name => name.endsWith('.ts') || name.endsWith('.map')), false);
  const app = await readFile(path.join(output, 'orb/app.js'), 'utf8');
  assert.match(app, /from ['"]\.\/content\.js['"]/);
  assert.doesNotMatch(app, /from ['"][^'"]+\.ts['"]/);
  const exported = await readFile(path.join(output, 'catalog.json'), 'utf8');
  assert.doesNotMatch(exported, /PRIVATE|secret-horizon/);
  assert.equal(JSON.parse(exported).records.length, 1);
  const html = await readFile(path.join(output, 'orb/horizons/creation/index.html'), 'utf8');
  assert.match(html, /Giving form\./);
  assert.match(html, /<h2>More<\/h2>/);
  assert.match(html, /The public body/);
  assert.match(html, /aria-current="page"/);
  assert.equal((await readdir(path.join(output, 'orb/horizons'))).includes('secret-horizon'), false);
  const container = createContentSource(catalog);
  assert.equal(resolveRoute('/orb/', container), null);
  assert.equal(resolveRoute(horizonRoute('creation'), container), 'creation');
  for (const route of ['/orb/music/', '/orb/model/', '/orb/operations/', '/orb/horizons/secret-horizon/']) assert.equal(resolveRoute(route, container), undefined);
});

test('one layout groups by the meaning of Horizon levels without mutating source order', () => {
  const catalog: Catalog = { records: [
    { type: 'Horizon', data: { ...metadata, id: 'goal', level: 4 } },
    { type: 'Horizon', data: metadata },
  ] };
  const container = createContentSource(catalog);
  assert.deepEqual(layout(container).map(group => [group.level, group.label]), [[1, 'Values'], [4, 'Near-term goals']]);
  assert.equal(container.children[0].id, 'goal');
});
