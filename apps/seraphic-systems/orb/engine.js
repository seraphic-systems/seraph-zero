import { horizonLevels } from './content.js';

// Pure grouping and ordering; rendering and URL navigation live elsewhere.
export function layout(container) {
  return horizonLevels.flatMap((label, index) => {
    const level = index + 1;
    const nodes = container.children.filter(node => node.level === level)
      .sort((a, b) => a.id.localeCompare(b.id));
    return nodes.length ? [{ level, label, nodes }] : [];
  });
}
