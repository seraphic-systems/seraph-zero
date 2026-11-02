import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPanelState, transitionPanels, panelToDismiss } from '../apps/seraphic-systems/orb/panels.js';

const run = (...events) => events.reduce(transitionPanels, initialPanelState);

test('View and Find replace each other, toggle closed, and coexist with the player', () => {
  const view = run('togglePlayer', 'toggleView');
  assert.deepEqual(view, { panel: 'view', player: 'open' });
  const find = transitionPanels(view, 'toggleFind');
  assert.deepEqual(find, { panel: 'find', player: 'open' });
  assert.deepEqual(transitionPanels(find, 'toggleView'), view);
  assert.deepEqual(transitionPanels(find, 'toggleFind'), { panel: 'none', player: 'open' });
  assert.deepEqual(transitionPanels(view, 'toggleView'), { panel: 'none', player: 'open' });
  assert.deepEqual(transitionPanels(view, 'closePlayer'), { panel: 'view', player: 'closed' });
});

test('navigation closes every other panel and blocks toggles of inert controls', () => {
  for (const primary of ['toggleView', 'toggleFind']) {
    const nav = run('togglePlayer', primary, 'toggleNav');
    assert.deepEqual(nav, { panel: 'nav', player: 'closed' });
    for (const blocked of ['toggleView', 'toggleFind', 'togglePlayer']) {
      assert.equal(transitionPanels(nav, blocked), nav);
    }
    assert.deepEqual(transitionPanels(nav, 'toggleNav'), initialPanelState);
  }
});

test('Escape dismisses Find, then player, then View before leaving detail or selection to the app', () => {
  let state = run('togglePlayer', 'toggleFind');
  assert.equal(panelToDismiss(state), 'find');
  state = transitionPanels(state, 'escape');
  assert.deepEqual(state, { panel: 'none', player: 'open' });
  assert.equal(panelToDismiss(state), 'player');
  assert.deepEqual(transitionPanels(state, 'escape'), initialPanelState);

  state = run('toggleView', 'togglePlayer');
  assert.equal(panelToDismiss(state), 'player');
  state = transitionPanels(state, 'escape');
  assert.deepEqual(state, { panel: 'view', player: 'closed' });
  assert.equal(panelToDismiss(state), 'view');
  state = transitionPanels(state, 'escape');
  assert.equal(panelToDismiss(state), null);
  assert.equal(transitionPanels(state, 'escape'), state);
  assert.equal(panelToDismiss(run('toggleNav')), 'nav');
  assert.deepEqual(run('toggleNav', 'escape'), initialPanelState);
});

test('route changes dismiss the primary panel but preserve the player', () => {
  for (const event of ['toggleView', 'toggleFind']) {
    assert.deepEqual(run(event, 'togglePlayer', 'navigate'), { panel: 'none', player: 'open' });
  }
  assert.deepEqual(run('toggleNav', 'navigate'), initialPanelState);
});

test('outside clicks dismiss only Find and do not alter playback-panel visibility', () => {
  assert.deepEqual(run('toggleFind', 'togglePlayer', 'outsideFind'), { panel: 'none', player: 'open' });
  for (const event of ['toggleView', 'toggleNav', 'togglePlayer']) {
    const state = run(event);
    assert.equal(transitionPanels(state, 'outsideFind'), state);
  }
});

test('all reachable states keep navigation exclusive and snapshots immutable', () => {
  const events = ['toggleNav', 'toggleView', 'toggleFind', 'togglePlayer', 'closePlayer', 'outsideFind', 'navigate', 'escape'];
  const visited = new Map([[JSON.stringify(initialPanelState), initialPanelState]]);
  for (const state of visited.values()) {
    assert.ok(Object.isFrozen(state));
    assert.ok(['none', 'nav', 'view', 'find'].includes(state.panel));
    assert.ok(['open', 'closed'].includes(state.player));
    if (state.panel === 'nav') assert.equal(state.player, 'closed');
    const before = JSON.stringify(state);
    for (const event of events) {
      const next = transitionPanels(state, event);
      visited.set(JSON.stringify(next), next);
      assert.equal(JSON.stringify(state), before);
    }
    assert.equal(transitionPanels(state, 'unknown'), state);
  }
  assert.equal(visited.size, 7);
});
