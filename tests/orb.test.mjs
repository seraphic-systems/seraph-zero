import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentSource, indexTree } from '../apps/seraphic-systems/orb/content.js';
import { layout } from '../apps/seraphic-systems/orb/engine.js';
import { availableViews, resolveView, hasFindControls, isFindActive, viewPanelHeight, viewConfiguration, arrangementConfiguration } from '../apps/seraphic-systems/orb/views.js';
import { readRoute, routeFor, routeToNode } from '../apps/seraphic-systems/orb/routes.js';

const songs = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}`, mixes: [], notes: '' }));
const catalog = { records: [
  { type: 'Album', data: { id: 'a', title: 'An album' } },
  { type: 'AlbumTrack', data: { id: 't', album: 'a', track_number: 1 } },
] };
const tree = createContentSource(songs, catalog).getRoot();
const initial = { path: ['home', 'music', 'songs'], detail: null, arrangement: {}, navOpen: false };

test('view inspection preserves preset definitions and reports only effective active settings', () => {
  const node = indexTree(tree).get('songs').node;
  const [orb, player] = availableViews(node);
  const state = { view: { songs: player.id }, arrangement: { songs: 'az' }, filter: 'Song 2' };
  const snapshot = JSON.stringify(node);
  assert.deepEqual(viewConfiguration(node, player, state), {
    page: 'songs', default: false, preset: player, ...arrangementConfiguration(node, player),
    current: { presentation: 'player', arrangement: 'az', filter: {}, query: 'Song 2', ...arrangementConfiguration(node, player, 'az') },
  });
  assert.deepEqual(viewConfiguration(node, orb, state), { page: 'songs', default: true, preset: orb, ...arrangementConfiguration(node, orb) });
  const album = indexTree(tree).get('album-a').node;
  const fixed = resolveView(album);
  assert.deepEqual(viewConfiguration(album, fixed, { arrangement: { 'album-a': 'az' }, filter: 'ignored' }).current,
    { presentation: 'orb', arrangement: 'free', filter: {}, query: '', ...arrangementConfiguration(album, fixed) });
  assert.equal(JSON.stringify(node), snapshot);
});

test('configuration explains grouping, tie breakers, source sorting and spatial placement', () => {
  const index = indexTree(tree);
  const inspect = id => {
    const node = index.get(id).node;
    return arrangementConfiguration(node, resolveView(node));
  };
  const levels = inspect('horizons');
  assert.equal(levels.grouping.field, 'groupLevel');
  assert.equal(levels.grouping.missing, 'last');
  assert.deepEqual(levels.sorting.map(rule => [rule.field, rule.direction]), [['groupLevel', 'ascending'], ['label', 'ascending']]);
  assert.match(inspect('policies').grouping.derivedFrom, /Highest valid level/);
  assert.deepEqual(inspect('album-a').sorting, [{ field: 'track_number', direction: 'ascending', comparison: 'numeric' }]);
  assert.deepEqual(inspect('fragments').sorting.map(rule => rule.field), ['groupLabel', 'label']);
  assert.equal(inspect('fragments').grouping, null);
  assert.match(inspect('songs').placement, /scatter/);
  const node = index.get('songs').node, player = resolveView(node, 'player');
  assert.match(arrangementConfiguration(node, player).placement, /Cards/);
  assert.deepEqual(arrangementConfiguration(node, player, 'az').sorting.map(rule => rule.field), ['label']);
  assert.match(arrangementConfiguration({}, { presentation: 'orb', arrangement: 'relationships' }).placement, /row ascending, then column ascending/);
});

test('Horizons defaults to ascending level groups and preserves filtering and detail order', () => {
  const horizonTree = createContentSource([], { records: [
    { type: 'Horizon', data: { id: 'goal', title: 'Goal', level: 4 } },
    { type: 'Horizon', data: { id: 'value-z', title: 'Z value', level: 1 } },
    { type: 'Horizon', data: { id: 'vision', title: 'Vision', level: 3 } },
    { type: 'Horizon', data: { id: 'value-a', title: 'A value', level: 1 } },
    { type: 'Horizon', data: { id: 'principle', title: 'Principle', level: 2 } },
  ] }).getRoot();
  const route = readRoute(horizonTree, new URL('http://localhost/orb/operations/horizons/'));
  assert.equal(route.view.horizons, 'levels');
  for (const width of [320, 390, 1440]) {
    const viewport = { width, height: 844 };
    const result = layout(horizonTree, route, viewport);
    assert.deepEqual(result.groups.map(group => group.label), ['1 · Values', '2 · Guiding principles', '3 · Long-term vision', '4 · Near-term goals']);
    const children = result.circles.filter(circle => circle.role === 'child');
    assert.deepEqual(children.map(child => child.key), ['horizon-value-a', 'horizon-value-z', 'horizon-principle', 'horizon-vision', 'horizon-goal']);
    for (const circle of children) {
      assert.ok(circle.x - circle.r >= 0 && circle.x + circle.r <= width);
      assert.ok(circle.y + circle.r < result.height);
    }
    assert.ok(children[2].y > children[1].y);
    const filtered = layout(horizonTree, { ...route, filter: 'Goal' }, viewport);
    assert.deepEqual(filtered.groups.map(group => group.label), ['4 · Near-term goals']);
    assert.equal(filtered.count, 1);
    const empty = layout(horizonTree, { ...route, filter: 'missing' }, viewport);
    assert.equal(empty.groups.length, 0);
    assert.equal(empty.circles.at(-1).role, 'empty');
    const detail = layout(horizonTree, { ...route, detail: 'horizon-vision' }, viewport);
    assert.equal(detail.groups.length, 0);
    assert.equal(detail.detail.prev, 'horizon-principle');
    assert.equal(detail.detail.next, 'horizon-goal');
    const scatter = layout(horizonTree, { ...route, view: { horizons: 'orb' } }, viewport);
    assert.equal(scatter.active, 'free');
    assert.equal(scatter.groups.length, 0);
  }
});

test('Policies default to their highest linked Horizon level without adding a level to the record', () => {
  const records = [
    { type: 'Horizon', data: { id: 'goal', title: 'Goal', level: 4 } },
    { type: 'Horizon', data: { id: 'value', title: 'Value', level: 1 } },
    { type: 'Horizon', data: { id: 'principle', title: 'Principle', level: 2 } },
    { type: 'Policy', data: { id: 'goal-only', title: 'Goal only', horizons: ['goal'] } },
    { type: 'Policy', data: { id: 'mixed', title: 'Mixed', horizons: ['goal', 'value', 'principle'] } },
    { type: 'Policy', data: { id: 'principle-only', title: 'Principle only', horizons: ['principle', 'missing'] } },
    { type: 'Policy', data: { id: 'unlinked', title: 'Unlinked', horizons: ['missing'] } },
  ];
  const policyTree = createContentSource([], { records }).getRoot();
  const route = readRoute(policyTree, new URL('http://localhost/orb/operations/policies/'));
  assert.equal(route.view.policies, 'levels');
  assert.ok(records.filter(record => record.type === 'Policy').every(record => !Object.hasOwn(record.data, 'level')));
  for (const width of [320, 1440]) {
    const viewport = { width, height: 844 };
    const result = layout(policyTree, route, viewport);
    assert.deepEqual(result.groups.map(group => group.label), ['2 · Guiding principles', '4 · Near-term goals', 'No linked Horizon level']);
    const children = result.circles.filter(circle => circle.role === 'child');
    assert.deepEqual(children.map(child => child.key), ['policy-principle-only', 'policy-goal-only', 'policy-mixed', 'policy-unlinked']);
    for (const circle of children) assert.ok(Number.isFinite(circle.y) && circle.y + circle.r < result.height);
    const filtered = layout(policyTree, { ...route, filter: 'Mixed' }, viewport);
    assert.deepEqual(filtered.groups.map(group => group.label), ['4 · Near-term goals']);
    const detail = layout(policyTree, { ...route, detail: 'policy-principle-only' }, viewport);
    assert.equal(detail.detail.prev, undefined);
    assert.equal(detail.detail.next, 'policy-goal-only');
    assert.equal(layout(policyTree, { ...route, view: { policies: 'orb' } }, viewport).active, 'free');
  }
});

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
    assert.ok(!result.view.controls.arrangements.includes('ring'));
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

test('page views are explicitly declared, URL-addressable, and fall back safely', () => {
  const songContainer = indexTree(tree).get('songs').node;
  assert.deepEqual(availableViews(songContainer).map(view => view.id), ['orb', 'player']);
  assert.deepEqual(availableViews(tree).map(view => view.id), ['orb']);
  const url = routeFor(initial.path, null, 'az', 'Song 2', 'player');
  const route = readRoute(tree, new URL(url, 'http://localhost'));
  assert.equal(route.view.songs, 'player');
  assert.equal(route.filter, 'Song 2');
  assert.equal(readRoute(tree, new URL('http://localhost/orb/?view=player')).view.home, 'orb');
  assert.equal(readRoute(tree, new URL('http://localhost/orb/music/songs/?view=unknown')).view.songs, 'orb');
  assert.equal(readRoute(tree, new URL('http://localhost/orb/music/songs/')).view.songs, 'orb');
});

test('player layouts preserve actions, ordering, filtering, and detail identity at every size', () => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const state = { ...initial, view: { songs: 'player' }, arrangement: { songs: 'az' } };
    const result = layout(tree, state, viewport);
    assert.deepEqual(result, layout(tree, state, viewport));
    assert.equal(result.items.length, songs.length);
    assert.equal(result.items[0].key, 'song-s0');
    assert.equal(result.items[1].key, 'song-s1');
    assert.equal(result.circles.some(circle => circle.role === 'child'), false);
    for (const item of result.items) {
      assert.ok(item.x >= 0 && item.x + item.width <= viewport.width);
      assert.ok(item.y >= 180 && item.y + item.height <= result.height - 80);
      assert.equal(item.action.id, item.key);
      assert.equal(item.presentation, 'player');
    }
    const filtered = layout(tree, { ...state, filter: 'Song 24' }, viewport);
    assert.deepEqual(filtered.items.map(item => item.key), ['song-s24']);
    const empty = layout(tree, { ...state, filter: 'missing' }, viewport);
    assert.equal(empty.items.length, 0);
    assert.equal(empty.circles.at(-1).role, 'empty');
    const detail = layout(tree, { ...state, detail: 'song-s0' }, viewport);
    assert.equal(detail.items.length, 0);
    assert.equal(detail.detail.id, 'song-s0');
    assert.equal(detail.detail.next, 'song-s1');
  }
});

test('mixed collections use a generic Orb fallback and album tracks support player cards', () => {
  const mixed = { id: 'home', views: { default: 'player', options: [{ id: 'player', label: 'Players', presentation: 'player', arrangement: 'free' }] }, children: [{ id: 'song', kind: 'Song', label: 'Song' }, { id: 'folder', label: 'Folder', children: [] }] };
  const result = layout(mixed, { path: ['home'], view: { home: 'player' } }, { width: 1000, height: 800 });
  assert.deepEqual(result.items.map(item => item.presentation), ['player']);
  const fallback = result.circles.find(circle => circle.key === 'folder');
  assert.equal(fallback.isContainer, true);
  assert.deepEqual(fallback.action, { type: 'navigate', path: ['home', 'folder'] });
  const album = layout(tree, { path: ['home', 'music', 'albums', 'album-a'], view: { 'album-a': 'player' } }, { width: 390, height: 844 });
  assert.equal(album.items[0].key, 'track-t');
  assert.equal(album.items[0].presentation, 'player');
});

test('pages enforce their declared controls in routes and layout, including album track order', () => {
  const albumTree = createContentSource([], { records: [
    { type: 'Album', data: { id: 'ordered', title: 'Ordered' } },
    { type: 'AlbumTrack', data: { id: 'first', album: 'ordered', title: 'Zebra', track_number: 1 } },
    { type: 'AlbumTrack', data: { id: 'second', album: 'ordered', title: 'Apple', track_number: 2 } },
  ] }).getRoot();
  const path = ['home', 'music', 'albums', 'album-ordered'];
  const route = readRoute(albumTree, new URL('http://localhost/orb/music/albums/album-ordered/?view=player&arrange=az&q=missing'));
  assert.equal(route.filter, '');
  assert.deepEqual(route.arrangement, {});
  const result = layout(albumTree, { ...route, filter: 'missing', arrangement: { 'album-ordered': 'az' } }, { width: 1000, height: 800 });
  assert.equal(result.active, 'free');
  assert.deepEqual(result.items.map(item => item.key), ['track-first', 'track-second']);
  const detail = layout(albumTree, { path, detail: 'track-first', arrangement: { 'album-ordered': 'az' } }, { width: 1000, height: 800 });
  assert.equal(detail.detail.next, 'track-second');
  for (const page of ['home', 'music']) {
    const node = indexTree(tree).get(page).node;
    assert.equal(availableViews(node).length, 1);
    assert.deepEqual(resolveView(node).controls, {});
  }
  // Supported item types alone must never expose additional views or controls.
  const undeclared = { id: 'home', children: [{ id: 'song', kind: 'Song', label: 'Song' }] };
  const implicit = layout(undeclared, { path: ['home'], view: { home: 'player' }, filter: 'missing', arrangement: { home: 'az' } }, { width: 1000, height: 800 });
  assert.equal(implicit.presentation, 'orb');
  assert.equal(implicit.active, 'free');
  assert.equal(implicit.count, 1);
});

test('a declared default can use any renderer and view-specific controls', () => {
  const custom = { id: 'home', label: 'Home', views: { default: 'listen', options: [
    { id: 'browse', label: 'Browse', presentation: 'orb', arrangement: 'az', controls: { search: true } },
    { id: 'listen', label: 'Listen', presentation: 'player', arrangement: 'free', controls: {} },
  ] }, children: [{ id: 'song', kind: 'Song', label: 'Song' }] };
  for (const query of ['', '?view=unknown', '?view=listen&arrange=az&q=missing']) {
    const route = readRoute(custom, new URL(`http://localhost/orb/${query}`));
    const result = layout(custom, route, { width: 1000, height: 800 });
    assert.equal(result.view.id, 'listen');
    assert.equal(result.presentation, 'player');
    assert.equal(result.count, 1);
  }
  const route = readRoute(custom, new URL(routeFor(['home'], null, null, 'missing', 'browse'), 'http://localhost'));
  assert.equal(route.view.home, 'browse');
  assert.equal(layout(custom, route, { width: 1000, height: 800 }).count, 0);
});

test('open view controls reserve space for orbs and players without moving breadcrumbs', () => {
  for (const width of [320, 390, 599, 600, 900, 1440]) for (const view of ['orb', 'player']) {
    const state = { ...initial, view: { songs: view } };
    const viewport = { width, height: 844 };
    const closed = layout(tree, state, viewport);
    const open = layout(tree, { ...state, viewOpen: true }, viewport);
    assert.deepEqual(open.circles.filter(circle => circle.role === 'trail'), closed.circles.filter(circle => circle.role === 'trail'));
    for (const item of [...open.items, ...open.circles.filter(circle => circle.role === 'child')]) {
      const left = item.r ? item.x - item.r : item.x;
      const top = item.r ? item.y - item.r : item.y;
      assert.ok(width < 600 ? top >= 132 + viewPanelHeight(indexTree(tree).get('songs').node) + 24 : left >= 284);
      assert.ok(item.r ? item.x + item.r <= width : item.x + item.width <= width);
    }
    assert.deepEqual(layout(tree, state, viewport), closed);
    // Detail pages hide View, so a stale open flag must not reserve space.
    const detail = { ...state, detail: 'song-s0' };
    assert.deepEqual(layout(tree, { ...detail, viewOpen: true }, viewport), layout(tree, detail, viewport));
  }
});

const fragmentTree = createContentSource([], { records: [
  { type: 'Idea', data: { id: 'dream', title: 'Dream' } },
  { type: 'MusicFragment', data: { id: 'loop', file: 'Dream/loop.aif', idea: 'dream', key: 'Am', bpm: 98, tags: ['warm'] } },
  { type: 'MusicFragment', data: { id: 'hit', title: 'Hit', file: 'hit.wav', notes: 'Metallic' } },
] }).getRoot();
const fragmentPath = ['home', 'music', 'fragments'];
test('fragments default to a playable sample list with real Idea groups and safe URL presets', () => {
  const index = indexTree(fragmentTree), container = index.get('fragments').node;
  assert.equal(resolveView(container).id, 'samples');
  assert.deepEqual(availableViews(container).map(view => view.label), ['All fragments', 'Dream', 'Unassociated / Orphan']);
  assert.ok(availableViews(container).every(view => view.presentation === 'samples'));
  assert.ok(availableViews(container).every(view => view.controls.search && view.controls.arrangements.length === 2));
  assert.equal(index.get('fragment-loop').node.audio.mixes[0].url, 'api/fragments/loop/audio');
  for (const width of [320, 390, 600, 1440]) {
    const result = layout(fragmentTree, { path: fragmentPath, viewOpen: true }, { width, height: 844 });
    assert.equal(result.items.length, 2);
    assert.equal(result.circles.some(circle => circle.role === 'child'), false);
    for (const item of result.items) {
      assert.ok(item.x >= 0 && item.x + item.width <= width);
      assert.ok(item.y >= (width < 600 ? 132 + viewPanelHeight(container) + 24 : 180));
      assert.ok(item.y + item.height < result.height);
    }
  }
  const url = routeFor(fragmentPath, null, 'az', 'warm', 'group-dream');
  const route = readRoute(fragmentTree, new URL(url, 'http://localhost'));
  assert.equal(route.view.fragments, 'group-dream');
  assert.ok(!url.includes('group='));
  const result = layout(fragmentTree, route, { width: 390, height: 844 });
  assert.deepEqual(result.items.map(item => item.key), ['fragment-loop']);
  const detailRoute = readRoute(fragmentTree, new URL(routeToNode(fragmentTree, 'fragment-loop'), 'http://localhost'));
  const detail = layout(fragmentTree, detailRoute, { width: 390, height: 844 });
  assert.equal(detail.detail.id, 'fragment-loop');
  assert.equal(detail.items.length, 0);
  const orphan = layout(fragmentTree, { path: fragmentPath, view: { fragments: 'group-unassociated' } }, { width: 1000, height: 800 });
  assert.deepEqual(orphan.items.map(item => item.key), ['fragment-hit']);
  assert.equal(layout(fragmentTree, { ...route, filter: 'Metallic' }, { width: 390, height: 844 }).count, 0);
  const invalid = readRoute(fragmentTree, new URL('http://localhost/orb/music/fragments/?group=bad&view=bad'));
  assert.equal(invalid.view.fragments, 'samples');
  const legacy = readRoute(fragmentTree, new URL('http://localhost/orb/music/fragments/?view=samples&group=dream'));
  assert.equal(legacy.view.fragments, 'group-dream');
  const unsupportedView = layout(fragmentTree, { path: fragmentPath, view: { fragments: 'orb' } }, { width: 1000, height: 800 });
  assert.equal(unsupportedView.view.id, 'samples');
  assert.equal(unsupportedView.items.length, 2);
  const unsupported = readRoute(fragmentTree, new URL('http://localhost/orb/music/?group=dream'));
  assert.equal(unsupported.view.music, 'orb');
});

test('a preset combines its renderer, filters, ordering and explicit controls', () => {
  const custom = { id: 'home', label: 'Home', views: { default: 'selected', options: [
    { id: 'all', label: 'All', presentation: 'orb', arrangement: 'free', controls: { search: true, arrangements: ['free', 'az'] } },
    { id: 'selected', label: 'Selected group', presentation: 'player', arrangement: 'az', filter: { group: 'a' } },
  ] }, children: [
    { id: 'z', label: 'Zebra', kind: 'Song', group: 'a' },
    { id: 'b', label: 'Banana', kind: 'Song', group: 'b' },
    { id: 'a', label: 'Apple', kind: 'Song', group: 'a' },
  ] };
  const route = readRoute(custom, new URL('http://localhost/orb/?q=missing&arrange=free'));
  const result = layout(custom, route, { width: 1000, height: 800 });
  assert.equal(result.view.id, 'selected');
  assert.equal(route.filter, '');
  assert.deepEqual(route.arrangement, {});
  assert.equal(result.presentation, 'player');
  assert.deepEqual(result.items.map(item => item.key), ['a', 'z']);
  const all = readRoute(custom, new URL('http://localhost/orb/?view=all&arrange=az&q=Banana'));
  assert.deepEqual(layout(custom, all, { width: 1000, height: 800 }).circles.filter(circle => circle.role === 'child').map(circle => circle.key), ['b']);
});

test('Find is opt-in, highlights only effective queries, and overlays without changing layout', () => {
  const songsNode = indexTree(tree).get('songs').node;
  const view = resolveView(songsNode);
  assert.equal(hasFindControls(view), true);
  assert.equal(hasFindControls(resolveView(tree)), false);
  assert.equal(hasFindControls({ controls: { arrangements: ['free', 'az'] } }), true);
  assert.equal(hasFindControls({ controls: { arrangements: ['free'] } }), false);
  assert.equal(isFindActive(view, initial, 'songs'), false);
  assert.equal(isFindActive(view, { filter: '   ' }, 'songs'), false);
  assert.equal(isFindActive(view, { filter: 'Song' }, 'songs'), true);
  assert.equal(isFindActive(view, { arrangement: { songs: 'az' } }, 'songs'), true);
  assert.equal(isFindActive(view, { arrangement: { songs: 'bad' } }, 'songs'), false);
  const fixed = { presentation: 'orb', arrangement: 'az' };
  assert.equal(isFindActive(fixed, { filter: 'ignored', arrangement: { songs: 'free' } }, 'songs'), false);
  for (const width of [320, 390, 900, 1440]) for (const presentation of ['orb', 'player']) {
    const state = { ...initial, view: { songs: presentation }, filter: 'Song 2', arrangement: { songs: 'az' } };
    const closed = layout(tree, state, { width, height: 844 });
    assert.deepEqual(layout(tree, { ...state, findOpen: true }, { width, height: 844 }), closed);
  }
  const onlyFind = { id: 'home', children: [{ id: 'a', label: 'A' }], views: { options: [
    { id: 'only', presentation: 'orb', arrangement: 'free', controls: { search: true } },
  ] } };
  const state = { path: ['home'] }, viewport = { width: 390, height: 844 };
  assert.deepEqual(layout(onlyFind, { ...state, viewOpen: true }, viewport), layout(onlyFind, state, viewport));
});
