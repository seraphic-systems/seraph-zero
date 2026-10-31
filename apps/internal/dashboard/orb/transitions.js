// Match presentation snapshots by content identity, without involving playback.
export function createPresentationTransition({ root, layers, items, reduced, document = globalThis.document }) {
  let active, generation = 0;
  const animations = new Set(), named = new Set();
  function clear() {
    root.classList.remove('presentation-transition');
    for (const node of named) node.style.removeProperty('view-transition-name');
    named.clear();
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
  function cancel() {
    generation++;
    active?.skipTransition();
    active = null;
    clear();
  }
  async function fade(from, to, duration) {
    await Promise.all(layers.map(node => {
      const animation = node.animate([{ opacity: from }, { opacity: to }], { duration, fill: 'both', easing: 'ease-in-out' });
      animations.add(animation);
      return animation.finished.catch(() => {});
    }));
  }
  function run(update) {
    cancel();
    const ticket = generation;
    if (!reduced.matches && typeof document.startViewTransition === 'function') {
      const names = new Map();
      function nameItems() {
        for (const [key, node] of items()) {
          if (!names.has(key)) names.set(key, `orb-item-${names.size}`);
          node.style.viewTransitionName = names.get(key);
          named.add(node);
        }
      }
      root.classList.add('presentation-transition');
      nameItems();
      active = document.startViewTransition(() => {
        if (ticket !== generation) return;
        update();
        nameItems();
      });
      // A skipped snapshot still applies its update; rejected transitions must not
      // leave names behind or disturb the next user choice.
      active.finished.catch(() => {}).finally(() => {
        if (ticket === generation) { active = null; clear(); }
      });
    } else {
      (async () => {
        await fade(1, 0, reduced.matches ? 70 : 160);
        if (ticket !== generation) return;
        update();
        await fade(0, 1, reduced.matches ? 70 : 220);
        if (ticket === generation) clear();
      })();
    }
  }
  return { run, cancel };
}
