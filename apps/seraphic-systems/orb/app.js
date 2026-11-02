import { createContentSource } from './content.js';
import { resolveRoute } from './routes.js';
import { renderWorld } from './presentations.js';

// Pages are complete HTML without this enhancement. The same renderer adds
// in-place navigation when the public catalog is available.
async function enhance() {
  const response = await fetch('/catalog.json');
  if (!response.ok) return;
  const container = createContentSource(await response.json());
  const world = document.querySelector('#world');
  const announce = document.querySelector('#announcement');
  function render(focus = true) {
    const id = resolveRoute(location.pathname, container);
    if (id === undefined) { location.reload(); return; }
    const previous = world.querySelector('[aria-current="page"]')?.dataset.horizon;
    world.innerHTML = renderWorld(container, id);
    const title = container.children.find(node => node.id === id)?.label;
    document.title = `${title ? `${title} · ` : ''}Horizons · Orb`;
    announce.textContent = title || 'All Horizons';
    if (focus) {
      const target = id ? world.querySelector('#detail-title') : [...world.querySelectorAll('[data-horizon]')].find(link => link.dataset.horizon === previous);
      (target || document.querySelector('#page-title')).focus();
    }
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-horizon], a[data-close]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || resolveRoute(url.pathname, container) === undefined) return;
    event.preventDefault();
    if (url.pathname !== location.pathname) history.pushState(null, '', url.pathname);
    render();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !world.querySelector('[data-close]')) return;
    event.preventDefault();
    history.pushState(null, '', '/orb/');
    render();
  });
  window.addEventListener('popstate', () => render());
}
enhance().catch(() => { /* Static pages remain fully navigable if loading fails. */ });
