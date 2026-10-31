import { indexTree } from './content.js';

export const isContainer = node => Array.isArray(node.children);
export const orderedChildren = (node, arrangement) => arrangement === 'az'
  ? [...node.children].sort((a, b) => a.label.localeCompare(b.label)) : node.children;
const point = (x, y, r, labelPlacement = 'inside') => ({ x, y, r, labelPlacement });

export const arrangements = {
  free: { label: 'Scatter', layout(region, children) {
    // Seeded best-candidate placement keeps the space organic and repeatable.
    const placed = new Map();
    const hash = text => [...text].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
    const columns = Math.max(1, Math.floor(region.w / 140));
    const rows = Math.max(1, Math.ceil(children.length / columns));
    for (const node of [...children].sort((a, b) => hash(a.id) - hash(b.id))) {
      if (node.pos) {
        placed.set(node.id, point(region.x + region.w * node.pos.x, region.y + region.h * node.pos.y, Math.min(region.w, region.h) * node.pos.size));
        continue;
      }
      let seed = hash(node.id);
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const r = Math.min(72, region.w / columns * .34, region.h / rows * .34) * (.86 + random() * .22);
      let best, clearance = -Infinity;
      for (let attempt = 0; attempt < 240; attempt++) {
        const candidate = point(region.x + r + random() * (region.w - r * 2), region.y + r + random() * (region.h - r * 2), r);
        const gap = Math.min(...[...placed.values()].map(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) - r - other.r));
        if (!best || gap > clearance) { best = candidate; clearance = gap; }
      }
      placed.set(node.id, best);
    }
    return children.map(node => placed.get(node.id));
  } },
  az: { label: 'A–Z', layout(region, children) {
    const rows = Math.max(1, Math.floor(region.h / 64)), columns = Math.ceil(children.length / rows) || 1;
    return children.map((node, i) => point(region.x + region.w / columns * Math.floor(i / rows) + 24,
      region.y + (i % rows + .5) * region.h / Math.min(rows, children.length), Math.min(18, region.w / columns * .15), 'side')).map(position => ({ ...position, labelWidth: Math.max(100, region.w / columns - 65) }));
  } },
};

export function resolveState(tree, state) {
  const index = indexTree(tree);
  let node = tree, path = [tree.id];
  const requested = state.path || [tree.id];
  if (requested[0] !== tree.id) return { node: tree, path: [tree.id], detail: null };
  for (const id of requested.slice(1)) {
    const child = node.children?.find(child => child.id === id && isContainer(child));
    if (!child) return { node: tree, path: [tree.id], detail: null };
    node = child; path.push(id);
  }
  return { node, path, detail: node.children?.some(child => child.id === state.detail && !isContainer(child)) ? state.detail : null, index };
}

export function layout(tree, state, viewport) {
  const { width: w, height: h } = viewport;
  const index = indexTree(tree), resolved = resolveState(tree, state), { node, path, detail } = resolved;
  const active = node.arrangements?.includes(state.arrangement?.[node.id]) ? state.arrangement[node.id] : node.arrangements?.[0] || 'free';
  const filter = (state.filter || '').trim().toLocaleLowerCase();
  const children = orderedChildren(node, active).filter(child => !filter || child.id === detail || child.label.toLocaleLowerCase().includes(filter)), circles = [];
  const narrow = w < 600, margin = narrow ? 28 : 60, step = narrow ? 68 : 96, trailY = narrow ? 76 : 56;
  const trail = path.map((id, i) => ({ key: id, ...point(margin + i * step, trailY, i === 0 ? 15 : 19, 'top'),
    label: index.get(id).node.label, role: 'trail', isContainer: true, isCurrent: !detail && i === path.length - 1,
    host: path[i - 1], order: i, action: { type: 'navigate', path: path.slice(0, i + 1) } }));
  circles.push(...trail);
  if (path.length > 1) {
    const parent = index.get(path.at(-2)).node;
    parent.children.filter(child => isContainer(child) && child.id !== node.id).forEach((child, i) => circles.push({
      key: child.id, ...point(margin + (path.length - 2) * step, 125 + i * 63, 13, 'side'), label: child.label,
      role: 'sibling', isContainer: true, isCurrent: false, host: parent.id, order: path.length + i,
      action: { type: 'navigate', path: [...path.slice(0, -1), child.id] },
    }));
  }
  // A–Z can extend vertically on small screens; the renderer exposes that scroll region.
  const region = { x: narrow ? 28 : Math.min(230, w * .21), y: 180, w: w - (narrow ? 56 : Math.min(230, w * .21) + 50), h: Math.max(190, h - 295) };
  if (active === 'free' && children.length > 2) region.h = Math.max(region.h, Math.ceil(children.length / Math.max(1, Math.floor(region.w / 140))) * 150);
  if (active === 'az' && narrow) region.h = Math.max(region.h, children.length * 64);
  const positions = arrangements[active].layout(region, children);
  children.forEach((child, i) => circles.push({ key: child.id, ...positions[i], label: child.label,
    role: 'child', isContainer: isContainer(child), isCurrent: false, host: node.id, order: 20 + i,
    action: isContainer(child) ? { type: 'navigate', path: [...path, child.id] } : { type: 'openDetail', id: child.id } }));
  if (!children.length) circles.push({ key: `empty-${node.id}`, ...point(region.x + region.w / 2, region.y + region.h / 2, 65),
    label: filter ? 'No matches' : 'Nothing here yet', role: 'empty', isContainer: false, isCurrent: false, host: node.id, order: 20 });
  let detailLayout;
  if (detail) {
    const things = children.filter(child => !isContainer(child)), current = things.findIndex(child => child.id === detail);
    const r = Math.min(narrow ? w * .44 : w * .29, h * .35, 310), x = narrow ? w / 2 : w * .57, y = Math.max(205 + r * .45, h * .51);
    for (const circle of circles.filter(circle => circle.role === 'child')) {
      const offset = things.findIndex(child => child.id === circle.key) - current;
      Object.assign(circle, point(x, offset === 0 ? y : offset < 0 ? y - r - 48 + (offset + 1) * 160 : y + r + 105 + (offset - 1) * 180,
        offset === 0 ? r : offset < 0 ? 22 : 65), { role: offset === 0 ? 'detail' : 'detail-neighbour', isCurrent: offset === 0, visible: Math.abs(offset) <= 1 });
    }
    circles.push({ key: 'trail-detail', ...point(margin + path.length * step, trailY, 9, 'top'), label: index.get(detail).node.label,
      role: 'trail', isContainer: false, isCurrent: true, order: path.length, action: { type: 'openDetail', id: detail } });
    detailLayout = { id: detail, x, y, r, prev: things[current - 1]?.id, next: things[current + 1]?.id };
  }
  const navOrb = { x: 46, y: h - 48, r: 23, arrangements: node.arrangements || ['free'] };
  if (state.navOpen) {
    const scrollY = viewport.scrollY || 0;
    const min = Math.min(110, w * .28), max = Math.min(175, w * .32, h * .25);
    let best = { score: -Infinity, x: w / 2, y: h / 2, r: min };
    for (let x = min + 16; x <= w - min - 16; x += 24) for (let y = min + 115; y <= h - min - 20; y += 24) {
      const clearance = Math.min(x - 16, w - x - 16, y - 110, h - y - 20,
        ...circles.filter(circle => circle.visible !== false).map(circle => Math.hypot(x - circle.x, y - (circle.y - scrollY)) - circle.r - 18));
      const score = Math.min(max, clearance) - .045 * Math.hypot(x, h - y);
      if (score > best.score) best = { score, x, y, r: Math.max(min, Math.min(max, clearance)) };
    }
    Object.assign(navOrb, best);
    for (const circle of circles.filter(circle => circle.role !== 'trail' && circle.visible !== false)) {
      const dx = circle.x - navOrb.x, dy = circle.y - scrollY - navOrb.y, distance = Math.hypot(dx, dy);
      if (distance < navOrb.r + circle.r + 24) {
        circle.r *= .55;
        const target = navOrb.r + circle.r + 24;
        circle.x = navOrb.x + (distance ? dx / distance : 1) * target;
        circle.y = navOrb.y + scrollY + (distance ? dy / distance : 0) * target;
      }
    }
  }
  return { circles, navOrb, detail: detailLayout, container: node, count: children.length, active, path, height: detail ? h : Math.max(h, region.y + region.h + 90) };
}
