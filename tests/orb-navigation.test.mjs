import test from 'node:test';
import assert from 'node:assert/strict';
import { readNavigation, navigationUrl, transitionNavigation } from '../apps/seraphic-systems/orb/navigation.js';
import { layout } from '../apps/seraphic-systems/orb/engine.js';

const controls = { search: true, arrangements: ['free', 'az'] };
const tree = { id: 'home', label: 'Home', children: [
  { id: 'songs', label: 'Songs', views: { default: 'orb', options: [
    { id: 'orb', presentation: 'orb', arrangement: 'free', controls },
    { id: 'player', presentation: 'player', arrangement: 'free', controls },
  ] }, children: [
    { id: 'b', label: 'Beta' }, { id: 'a', label: 'Alpha' }, { id: 'c', label: 'Gamma' },
  ] },
  { id: 'model', label: 'Model', selection: true, children: [
    { id: 'type-Song', label: 'Song' }, { id: 'type-Album', label: 'Album' },
  ] },
] };
const url = path => new URL(path, 'https://example.com');
const at = path => readNavigation(tree, url(path));
const send = (state, event) => transitionNavigation(tree, state, event);

test('navigation moves between browsing, detail, and selection with exclusive subjects', () => {
  let state = at('/orb/');
  assert.equal(state.status, 'browsing');
  state = send(state, { type: 'navigate', path: ['home', 'songs'] }).state;
  const opened = send(state, { type: 'openDetail', id: 'b' });
  assert.equal(opened.state.status, 'detail');
  assert.equal(opened.state.selection, null);
  assert.equal(opened.history, 'push');
  assert.equal(opened.resetPanels, true);
  assert.equal(send(opened.state, { type: 'dismiss' }).state.status, 'browsing');
  state = send(opened.state, { type: 'navigate', path: ['home', 'model'] }).state;
  assert.equal(state.detail, null);
  state = send(state, { type: 'select', id: 'type-Song' }).state;
  assert.equal(state.status, 'selection');
  assert.equal(state.detail, null);
  assert.match(navigationUrl(state), /select=type-Song/);
  const reloaded = readNavigation(tree, url(navigationUrl(state)));
  assert.equal(reloaded.status, 'selection');
  assert.equal(reloaded.selection, state.selection);
  assert.deepEqual(reloaded.path, state.path);
  state = send(state, { type: 'dismiss' }).state;
  assert.equal(state.selection, null);
  assert.equal(state.status, 'browsing');
});

test('subject actions are guarded by container policy and reject unrelated IDs', () => {
  const songs = at('/orb/songs/'), model = at('/orb/model/');
  for (const event of [{ type: 'select', id: 'a' }, { type: 'openDetail', id: 'type-Song' }, { type: 'dismiss' }, { type: 'step', direction: 'next' }, { type: 'unknown' }]) {
    assert.equal(send(songs, event).state, songs);
  }
  for (const event of [{ type: 'openDetail', id: 'type-Song' }, { type: 'select', id: 'a' }]) {
    assert.equal(send(model, event).state, model);
  }
});

test('detail stepping matches rendered order, filters, and boundaries at every width', () => {
  for (const width of [390, 1440]) for (const query of ['arrange=az', 'arrange=az&q=Alpha', 'q=a']) {
    const state = at(`/orb/songs/a/?${query}`);
    const scene = layout(tree, state, { width, height: 844 });
    for (const direction of ['prev', 'next']) {
      const result = send(state, { type: 'step', direction });
      if (scene.detail[direction]) assert.equal(result.state.detail, scene.detail[direction]);
      else assert.equal(result.state, state);
    }
  }
});

test('Back/Forward restore URL defaults and do not push another history entry', () => {
  const initial = at('/orb/songs/');
  const sorted = send(initial, { type: 'setArrangement', id: 'az' });
  const players = send(sorted.state, { type: 'setView', id: 'player' });
  assert.equal(players.state.arrangement.songs, undefined);
  const back = send(players.state, { type: 'restore', url: url(sorted.url) });
  assert.equal(back.history, 'none');
  assert.equal(back.resetPanels, true);
  assert.equal(back.state.view.songs, 'orb');
  assert.equal(back.state.arrangement.songs, 'az');
  const home = send(back.state, { type: 'restore', url: url('/orb/songs/') });
  assert.equal(home.state.arrangement.songs, undefined);
  const forward = send(home.state, { type: 'restore', url: url(players.url) });
  assert.deepEqual(forward.state, players.state);
});

test('search replaces history and preserves open controls; presets reset sort overrides', () => {
  const state = at('/orb/songs/a/?arrange=az');
  const search = send(state, { type: 'setFilter', value: 'Beta' });
  assert.equal(search.history, 'replace');
  assert.equal(search.resetPanels, false);
  assert.equal(search.state.status, 'browsing');
  assert.equal(search.state.detail, null);
  assert.equal(search.state.filter, 'Beta');
  const preset = send(search.state, { type: 'setView', id: 'player' });
  assert.equal(preset.history, 'push');
  assert.equal(preset.resetPanels, false);
  assert.equal(preset.state.filter, 'Beta');
  assert.equal(preset.state.arrangement.songs, undefined);
  assert.equal(send(preset.state, { type: 'setView', id: 'unknown' }).state, preset.state);
  assert.equal(send(preset.state, { type: 'setArrangement', id: 'unknown' }).state, preset.state);
});

test('container navigation remembers per-container settings but clears cross-container search and subjects', () => {
  const state = at('/orb/songs/a/?view=player&arrange=az&q=Alpha');
  const model = send(state, { type: 'navigate', path: ['home', 'model'] }).state;
  assert.equal(model.status, 'browsing');
  assert.equal(model.filter, '');
  assert.equal(model.view.songs, 'player');
  assert.equal(model.arrangement.songs, 'az');
  const songs = send(model, { type: 'navigate', path: ['home', 'songs'] }).state;
  assert.equal(songs.view.songs, 'player');
  assert.equal(songs.arrangement.songs, 'az');
  assert.equal(songs.filter, '');
  for (const event of [{ type: 'setFilter', value: 'ignored' }, { type: 'setArrangement', id: 'az' }]) {
    assert.equal(send(model, event).state, model);
  }
});

test('malformed and unknown routes fall back to browsing Home without stale detail, selection, or search', () => {
  const previous = at('/orb/songs/a/?q=Alpha');
  for (const path of ['/orb/missing/', '/orb/%ZZ/']) {
    const state = send(previous, { type: 'visit', url: url(path) }).state;
    assert.equal(state.invalid, true);
    assert.equal(state.status, 'browsing');
    assert.deepEqual(state.path, ['home']);
    assert.equal(state.detail, null);
    assert.equal(state.selection, null);
    assert.equal(state.filter, '');
  }
  assert.equal(at('/orb/model/type-Song/').status, 'selection');
});

test('navigation snapshots and their setting maps cannot be mutated by transitions', () => {
  const state = at('/orb/songs/?arrange=az');
  const before = JSON.stringify(state);
  for (const item of [state, state.path, state.view, state.arrangement]) assert.ok(Object.isFrozen(item));
  send(state, { type: 'setView', id: 'player' });
  send(state, { type: 'setFilter', value: 'new' });
  assert.equal(JSON.stringify(state), before);
});
