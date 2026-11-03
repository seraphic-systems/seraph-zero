import type { ContentSource } from './types.ts';

export const horizonRoute = (id: string) => `/orb/horizons/${encodeURIComponent(id)}/`;

// Null is the collection; undefined is an unknown route and must not be intercepted.
export function resolveRoute(pathname: string, container: ContentSource): string | null | undefined {
  if (['/orb/', '/orb', '/orb/horizons/', '/orb/horizons'].includes(pathname)) return null;
  return container.children.find(node => horizonRoute(node.id) === pathname || horizonRoute(node.id).slice(0, -1) === pathname)?.id;
}
