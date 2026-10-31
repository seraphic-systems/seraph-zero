import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentSource, indexTree } from '../apps/internal/dashboard/orb/content.js';
import { layout } from '../apps/internal/dashboard/orb/engine.js';
import { readRoute, routeFor, routeToNode } from '../apps/internal/dashboard/orb/routes.js';

const songs = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}`, mixes: [], notes: '' }));
const catalog = { records: [
  { type: 'Album', data: { id: 'a', title: 'An album' } },
  { type: 'AlbumTrack', data: { id: 't', album: 'a', track_number: 1 } },
] };
const tree = createContentSource(songs, catalog).getRoot();
const initial = { path: ['home', 'music', 'songs'], detail: null, arrangement: {}, navOpen: false };

test('content adapter preserves identities and does not infer album-song associations', () => {
  const index = indexTree(tree);
  assert.equal(index.get('song-s0').node.data, songs[0]);
  assert.equal(index.get('track-t').node.label, 'Track 1');
  assert.equal(index.get('track-t').node.data.song, undefined);
  assert.throws(() => indexTree({ id: 'home', children: [{ id: 'home' }] }), /Duplicate/);
});
test('routes round-trip every real node, with validated arrangements', () => {
  for (const [id, { node, path }] of indexTree(tree)) {
    const route = readRoute(tree, new URL(routeToNode(tree, id), 'http://localhost'));
    assert.deepEqual(route.path, node.children ? path : path.slice(0, -1));
    assert.equal(route.detail, node.children ? null : id);
  }
  assert.equal(readRoute(tree, new URL('http://localhost/orb/music/songs/?arrange=az')).arrangement.songs, 'az');
  assert.deepEqual(readRoute(tree, new URL('http://localhost/orb/music/songs/?arrange=garbage')).arrangement, {});
  assert.equal(readRoute(tree, new URL('http://localhost/orb/music/bad/')).invalid, true);
  assert.equal(readRoute(tree, new URL('http://localhost/orb/%XX/')).invalid, true);
  assert.equal(routeFor(['home']), '/orb/');
});
test('all arrangements are deterministic, finite, and keep child circles in their page region', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) for (const arrangement of ['free', 'az']) {
    const state = { ...initial, arrangement: { songs: arrangement } };
    const result = layout(tree, state, viewport);
    assert.deepEqual(result, layout(tree, state, viewport));
    assert.equal(new Set(result.circles.map(circle => circle.key)).size, result.circles.length);
    assert.equal(result.circles.filter(circle => circle.role === 'child').length, 25);
    for (const circle of result.circles) {
      assert.ok([circle.x, circle.y, circle.r].every(Number.isFinite));
      assert.ok(circle.r > 0);
      if (circle.role === 'child') {
        assert.ok(circle.x - circle.r >= 0 && circle.x + circle.r <= viewport.width);
        assert.ok(circle.y - circle.r > 100 && circle.y + circle.r <= result.height);
      }
    }
  }
});
test('detail preserves node identity and follows active arrangement order', () => {
  const result = layout(tree, { ...initial, detail: 'song-s0', arrangement: { songs: 'az' } }, { width: 1000, height: 800 });
  assert.equal(result.detail.prev, undefined);
  assert.equal(result.detail.next, 'song-s1');
  assert.equal(result.circles.find(circle => circle.key === 'song-s0').role, 'detail');
  assert.equal(result.circles.filter(circle => circle.role === 'trail' && circle.isCurrent).length, 1);
  assert.equal(layout(tree, { ...initial, path: ['home', 'missing'] }, { width: 1000, height: 800 }).container.id, 'home');
});
test('expanded nav fills the available viewport below the breadcrumb without displacing the library', () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 844 }, { width: 844, height: 390 }]) {
    for (const detail of [null, 'song-s0']) {
      const state = { ...initial, detail };
      const closed = layout(tree, state, viewport);
      const result = layout(tree, { ...state, navOpen: true }, { ...viewport, scrollY: 500 });
      const nav = result.navOrb;
      const top = viewport.width < 600 ? 132 : 112;
      assert.equal(nav.x, viewport.width / 2);
      assert.ok(nav.x - nav.r >= 16 && nav.x + nav.r <= viewport.width - 16);
      assert.ok(nav.y - nav.r >= top && nav.y + nav.r <= viewport.height - 24);
      assert.equal(nav.r * 2, Math.min(viewport.width - 32, viewport.height - top - 24));
      assert.deepEqual(result.circles, closed.circles);
      assert.deepEqual(result.detail, closed.detail);
    }
  }
});
test('empty containers remain containers and get a quiet empty orb', () => {
  const empty = { id: 'home', label: 'Home', children: [] };
  const result = layout(empty, { ...initial, path: ['home'] }, { width: 390, height: 844 });
  assert.equal(result.circles.find(circle => circle.role === 'empty').action, undefined);
});

test('scatter is the default, repeatable, and keeps circles apart', () => {
  for (const width of [357, 390, 900, 1440]) {
    const result = layout(tree, initial, { width, height: 844 });
    assert.equal(result.active, 'free');
    assert.ok(!result.container.arrangements.includes('ring'));
    const children = result.circles.filter(circle => circle.role === 'child');
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
      assert.ok(Math.hypot(children[i].x - children[j].x, children[i].y - children[j].y) > children[i].r + children[j].r + 10);
    }
  }
  const oldRoute = readRoute(tree, new URL('http://localhost/orb/music/songs/?arrange=ring'));
  assert.equal(layout(tree, { ...initial, ...oldRoute }, { width: 1440, height: 900 }).active, 'free');
});
test('title filters round-trip in URLs, match without case sensitivity, and support no matches', () => {
  const url = routeFor(initial.path, null, 'az', 'SONG 2');
  const route = readRoute(tree, new URL(url, 'http://localhost'));
  const result = layout(tree, { ...initial, ...route }, { width: 390, height: 844 });
  assert.equal(route.filter, 'SONG 2');
  assert.equal(result.count, 6);
  assert.ok(result.circles.filter(circle => circle.role === 'child').every(circle => circle.label.toLowerCase().includes('song 2')));
  const empty = layout(tree, { ...initial, filter: 'does not exist' }, { width: 390, height: 844 });
  assert.equal(empty.count, 0);
  assert.equal(empty.circles.find(circle => circle.role === 'empty').label, 'No matches');
});
