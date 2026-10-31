import { isContainer } from './engine.js';
import { indexTree } from './content.js';
export const base = '/orb/';
export function routeFor(path, detail, arrangement, filter = '') {
  const segments = [...path.slice(1), ...(detail ? [detail] : [])];
  const query = new URLSearchParams();
  if (arrangement) query.set('arrange', arrangement);
  if (filter) query.set('q', filter);
  return base + segments.map(encodeURIComponent).join('/') + (segments.length ? '/' : '') + (query.size ? `?${query}` : '');
}
export function readRoute(tree, url) {
  let segments;
  try { segments = url.pathname.slice(base.length).split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return { path: [tree.id], detail: null, arrangement: {}, invalid: true }; }
  let node = tree, path = [tree.id], detail = null;
  for (let i = 0; i < segments.length; i++) {
    const child = node.children?.find(child => child.id === segments[i]);
    if (!child || (!isContainer(child) && i !== segments.length - 1)) return { path: [tree.id], detail: null, arrangement: {}, invalid: true };
    if (isContainer(child)) { path.push(child.id); node = child; } else detail = child.id;
  }
  const choice = url.searchParams.get('arrange');
  return { path, detail, filter: url.searchParams.get('q') || '', arrangement: choice && node.arrangements?.includes(choice) ? { [node.id]: choice } : {} };
}
export function routeToNode(tree, id) {
  const entry = indexTree(tree).get(id);
  return entry ? routeFor(isContainer(entry.node) ? entry.path : entry.path.slice(0, -1), isContainer(entry.node) ? null : id) : base;
}
