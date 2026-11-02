export const horizonRoute = id => `/orb/horizons/${encodeURIComponent(id)}/`;

// Null is the collection; undefined is an unknown route and must not be intercepted.
export function resolveRoute(pathname, container) {
  if (['/orb/', '/orb', '/orb/horizons/', '/orb/horizons'].includes(pathname)) return null;
  return container.children.find(node => horizonRoute(node.id) === pathname || horizonRoute(node.id).slice(0, -1) === pathname)?.id;
}
