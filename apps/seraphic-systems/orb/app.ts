import { createContentSource } from './content.ts';
import { resolveRoute } from './routes.ts';
import { renderWorld } from './presentations.ts';

// Pages are complete HTML without this enhancement. The same renderer adds
// in-place navigation when the public catalog is available.
async function enhance() {
  const response = await fetch('/catalog.json');
  if (!response.ok) return;
  const container = createContentSource(await response.json());
  const world = document.querySelector<HTMLElement>('#world')!;
  const announce = document.querySelector<HTMLElement>('#announcement')!;
  function render(focus = true) {
    const id = resolveRoute(location.pathname, container);
    if (id === undefined) { location.reload(); return; }
    const previous = world.querySelector<HTMLElement>('[aria-current="page"]')?.dataset.horizon;
    world.innerHTML = renderWorld(container, id);
    const title = container.children.find(node => node.id === id)?.label;
    document.title = `${title ? `${title} · ` : ''}Horizons · Orb`;
    announce.textContent = title || 'All Horizons';
    if (focus) {
      const target = id ? world.querySelector<HTMLElement>('#detail-title') : [...world.querySelectorAll<HTMLElement>('[data-horizon]')].find(link => link.dataset.horizon === previous);
      (target || document.querySelector<HTMLElement>('#page-title')!).focus();
    }
  }
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-horizon], a[data-close]') : null;
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
