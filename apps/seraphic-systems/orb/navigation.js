import { isContainer, visibleChildren } from './engine.js';
import { indexTree } from './content.js';
import { base, readRoute, routeFor } from './routes.js';
import { availableViews, resolveView, resolveFilter } from './views.js';

// The URL adapter validates locations. Every transition produces one of three
// modes, with detail and selection mutually exclusive. Browser effects stay in
// app.js; restoring history never creates another history entry.
export function readNavigation(tree, url, previous = {}) {
  let route = readRoute(tree, url);
  if (route.invalid) route = { ...readRoute(tree, new URL(base, url)), invalid: true };
  const arrangement = { ...previous.arrangement, ...route.arrangement };
  const id = route.path.at(-1);
  // Absence in a restored URL means the default, not a remembered override.
  if (!route.arrangement[id]) delete arrangement[id];
  return Object.freeze({
    ...route,
    status: route.detail ? 'detail' : route.selection ? 'selection' : 'browsing',
    path: Object.freeze([...route.path]),
    view: Object.freeze({ ...previous.view, ...route.view }),
    arrangement: Object.freeze(arrangement),
  });
}

export function navigationUrl(state) {
  const id = state.path.at(-1);
  return routeFor(state.path, state.detail, state.arrangement[id], state.filter, state.view[id], state.selection);
}

export function transitionNavigation(tree, state, event) {
  const unchanged = { state, history: 'none', resetPanels: false };
  const node = indexTree(tree).get(state.path.at(-1))?.node;
  let path = state.path, detail = state.detail, selection = state.selection;
  let view = state.view[node.id], arrangement = state.arrangement[node.id], filter = state.filter;
  let history = 'push', resetPanels = true;
  switch (event.type) {
    case 'visit':
    case 'restore': {
      const next = readNavigation(tree, event.url, state);
      return { state: next, url: event.url.href, history: event.type === 'restore' ? 'none' : 'push', resetPanels: true };
    }
    case 'navigate':
      path = event.path;
      view = state.view[path.at(-1)];
      arrangement = state.arrangement[path.at(-1)];
      filter = path.join('/') === state.path.join('/') ? filter : '';
      detail = selection = null;
      break;
    case 'openDetail':
      if (node.selection || !node.children.some(child => child.id === event.id && !isContainer(child))) return unchanged;
      detail = event.id; selection = null;
      break;
    case 'select':
      if (!node.selection || (event.id != null && !node.children.some(child => child.id === event.id))) return unchanged;
      detail = null; selection = event.id;
      break;
    case 'dismiss':
      if (state.status === 'browsing') return unchanged;
      detail = selection = null;
      break;
    case 'step': {
      if (state.status !== 'detail' || !['prev', 'next'].includes(event.direction)) return unchanged;
      const children = visibleChildren(node, state).filter(child => !isContainer(child));
      const position = children.findIndex(child => child.id === detail);
      const target = children[position + (event.direction === 'next' ? 1 : -1)];
      if (!target) return unchanged;
      detail = target.id;
      break;
    }
    case 'setView': {
      const option = availableViews(node).find(option => option.id === event.id);
      if (!option) return unchanged;
      view = option.id; arrangement = undefined; filter = resolveFilter(option, filter);
      resetPanels = false;
      break;
    }
    case 'setArrangement':
      if (!resolveView(node, view).controls?.arrangements?.includes(event.id)) return unchanged;
      arrangement = event.id; resetPanels = false;
      break;
    case 'setFilter':
      if (!resolveView(node, view).controls?.search) return unchanged;
      filter = event.value; detail = null;
      history = 'replace'; resetPanels = false;
      break;
    default: return unchanged;
  }
  const url = routeFor(path, detail, arrangement, filter, view, selection);
  // Routing reads only path/query, so relative command URLs need no browser origin.
  return { state: readNavigation(tree, new URL(url, 'https://orb.invalid'), state), url, history, resetPanels };
}
