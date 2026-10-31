import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContentSource, indexTree } from '../apps/internal/dashboard/orb/content.js';
import { layout } from '../apps/internal/dashboard/orb/engine.js';
import { routeFor, readRoute, routeToNode } from '../apps/internal/dashboard/orb/routes.js';
import { inheritedFields } from '../apps/internal/dashboard/orb/model-view.js';
const schema = JSON.parse(await readFile(new URL('../apps/internal/model/schema.json', import.meta.url)));
const catalog = { records: [{ key: 'Song:test', type: 'Song', data: { id: 'test' } }] };
const tree = createContentSource([], catalog, schema).getRoot();
const initial = { path: ['home', 'model'], arrangement: {}, selection: null };

test('Model adapts schema entities and recorded associations without duplicating tree identities', () => {
  const index = indexTree(tree), model = index.get('model').node;
  assert.deepEqual(model.children.map(child => child.data.type), Object.keys(schema.definitions).filter(key => schema.definitions[key]['x-model']));
  assert.equal(model.relationships.length, schema['x-relations'].length);
  for (const edge of model.relationships) {
    assert.ok(index.has(edge.source)); assert.ok(index.has(edge.target));
  }
  assert.equal(index.has('type-SetAnalysis'), false);
  assert.equal(index.get('type-Song').node.data.records.length, 1);
  assert.ok(inheritedFields(schema.definitions.Song, schema.definitions).properties.created_at);
});

test('selection is URL-addressable, validated in its container, and independent of detail', () => {
  const url = routeFor(initial.path, null, 'relationships', '', 'orb', 'type-Song');
  const route = readRoute(tree, new URL(url, 'http://localhost'));
  assert.equal(route.selection, 'type-Song'); assert.equal(route.detail, null);
  assert.equal(readRoute(tree, new URL('/orb/model/?select=missing', 'http://localhost')).selection, null);
  assert.equal(readRoute(tree, new URL('/orb/music/?select=type-Song', 'http://localhost')).selection, null);
  assert.equal(readRoute(tree, new URL('/orb/model/', 'http://localhost')).selection, null);
  assert.equal(readRoute(tree, new URL(routeToNode(tree, 'type-Song'), 'http://localhost')).selection, 'type-Song');
});

test('relationship selection preserves map geometry, supports self and parallel edges, and filters safely', () => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const viewport = { width, height: 844 }, plain = layout(tree, initial, viewport);
    const selected = layout(tree, { ...initial, selection: 'type-Song' }, viewport);
    assert.equal(selected.detail, undefined);
    assert.equal(selected.connections.length, schema['x-relations'].length);
    assert.deepEqual(selected.circles.map(({ key, x, y, r }) => ({ key, x, y, r })), plain.circles.map(({ key, x, y, r }) => ({ key, x, y, r })));
    for (const circle of selected.circles.filter(circle => circle.role === 'child')) {
      assert.equal(circle.action.type, 'select');
      assert.ok(circle.x - circle.r >= 0 && circle.x + circle.r <= width);
      assert.ok(circle.y + circle.r < selected.height);
      if (width >= 900) assert.ok(circle.x + circle.r < width - 348);
    }
    for (const edge of selected.connections) {
      assert.ok(!/NaN|Infinity/.test(edge.path));
      assert.equal(edge.active, edge.source === 'type-Song' || edge.target === 'type-Song');
    }
    assert.equal(new Set(selected.connections.map(edge => edge.path)).size, selected.connections.length);
    const filtered = layout(tree, { ...initial, selection: 'type-Song', filter: 'not present' }, viewport);
    assert.equal(filtered.count, 1);
    assert.equal(filtered.connections.length, 0);
    const empty = layout(tree, { ...initial, filter: 'not present' }, viewport);
    assert.equal(empty.count, 0);
    assert.equal(empty.connections.length, 0);
  }
});

test('Model declares named layouts with a relationship default and no arrangement overrides', () => {
  for (const [choice, active] of [['relationships', 'relationships'], ['orb', 'free'], ['az', 'az'], ['unknown', 'relationships']]) {
    const route = readRoute(tree, new URL(routeFor(initial.path, null, 'az', '', choice), 'http://localhost'));
    assert.deepEqual(route.arrangement, {});
    const result = layout(tree, route, { width: 1024, height: 844 });
    assert.equal(result.active, active);
    assert.equal(result.presentation, 'orb');
  }
});
