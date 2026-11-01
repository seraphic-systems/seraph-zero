import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentationTransition, changesContentView } from '../apps/seraphic-systems/orb/transitions.js';

function setup({ native = false, reduced = false } = {}) {
  const classes = new Set(), transitions = [], animations = [];
  const root = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const node = () => ({ style: { removeProperty() { delete this.viewTransitionName; } } });
  const layers = [0, 1].map(() => ({ animate(frames, options) {
    let resolve;
    const animation = { frames, options, cancelled: false, finished: new Promise(done => { resolve = done; }),
      finish() { resolve(); }, cancel() { this.cancelled = true; resolve(); } };
    animations.push(animation);
    return animation;
  } }));
  const document = native ? { startViewTransition(update) {
    let resolve;
    const transition = { update, finished: new Promise(done => { resolve = done; }), finish() { resolve(); }, skipTransition() { resolve(); } };
    transitions.push(transition);
    return transition;
  } } : {};
  let entries = new Map([['song-a', node()], ['song-b', node()]]);
  const controller = createPresentationTransition({ root, layers, items: () => entries, reduced: { matches: reduced }, document });
  return { controller, transitions, animations, classes, node, get entries() { return entries; }, set entries(value) { entries = value; } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('native morph matches snapshots by identity and clears temporary names', async () => {
  const env = setup({ native: true }), before = env.entries;
  const after = new Map([['song-b', env.node()], ['song-a', env.node()]]);
  env.controller.run(() => { env.entries = after; });
  assert.equal(env.classes.has('presentation-transition'), true);
  env.transitions[0].update();
  for (const [key, element] of before) assert.equal(element.style.viewTransitionName, after.get(key).style.viewTransitionName);
  env.transitions[0].finish();
  await flush();
  assert.equal(env.classes.size, 0);
  for (const element of [...before.values(), ...after.values()]) assert.equal(element.style.viewTransitionName, undefined);
});

test('fallback fades out before replacing content, then fades in; reduced motion avoids morphs', async () => {
  for (const reduced of [false, true]) {
    const env = setup({ native: reduced, reduced });
    let updates = 0;
    env.controller.run(() => updates++);
    assert.equal(env.transitions.length, 0);
    assert.equal(updates, 0);
    assert.deepEqual(env.animations[0].frames, [{ opacity: 1 }, { opacity: 0 }]);
    env.animations.slice().forEach(animation => animation.finish());
    await flush();
    assert.equal(updates, 1);
    assert.deepEqual(env.animations[2].frames, [{ opacity: 0 }, { opacity: 1 }]);
    if (reduced) assert.ok(env.animations.every(animation => animation.options.duration <= 100));
    env.animations.forEach(animation => animation.finish());
    await flush();
    assert.ok(env.animations.every(animation => animation.cancelled));
  }
});

test('interrupting a pending transition cannot apply an obsolete view or clear new snapshot names', async () => {
  for (const native of [false, true]) {
    const env = setup({ native });
    let value = '';
    env.controller.run(() => { value = 'obsolete'; });
    env.controller.run(() => { value = 'latest'; });
    if (native) {
      env.transitions[0].update();
      await flush();
      assert.equal(env.classes.has('presentation-transition'), true);
      assert.equal(value, '');
      env.transitions[1].update();
      assert.equal(value, 'latest');
      env.transitions[1].finish();
    } else {
      env.animations.forEach(animation => animation.finish());
      await flush();
      assert.equal(value, 'latest');
      env.animations.forEach(animation => animation.finish());
    }
    await flush();
    env.controller.cancel();
    assert.equal(env.classes.size, 0);
  }
});

test('same-renderer preset and sorting changes animate, while panel and live search updates retain their own motion', () => {
  const current = { container: { id: 'fragments' }, view: { id: 'all' }, presentation: 'samples', active: 'free' };
  assert.equal(changesContentView(current, { ...current, view: { id: 'group-a' } }), true);
  assert.equal(changesContentView(current, { ...current, active: 'az' }), true);
  assert.equal(changesContentView(current, { ...current, presentation: 'orb' }), true);
  assert.equal(changesContentView(current, { ...current }), false);
  assert.equal(changesContentView(current, { ...current, detail: { id: 'fragment' } }), false);
  assert.equal(changesContentView(null, current), false);
  assert.equal(changesContentView(current, { ...current, container: { id: 'songs' } }), false);
});
