// Associations connect identities without changing containment or navigation paths.
export function relationshipGeometry(relationships, circles, selection) {
  const nodes = new Map(circles.map(circle => [circle.key, circle]));
  const groups = new Map();
  for (const edge of relationships) {
    const key = [edge.source, edge.target].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  return relationships.flatMap(edge => {
    const a = nodes.get(edge.source), b = nodes.get(edge.target);
    if (!a || !b) return [];
    const group = groups.get([edge.source, edge.target].sort().join('|'));
    const offset = (group.indexOf(edge) - (group.length - 1) / 2) * 34;
    let path, label;
    if (a === b) {
      const x = a.x, y = a.y - a.r;
      path = `M ${x - a.r * .6} ${y + a.r * .2} C ${x - a.r * 1.9} ${y - 85}, ${x + a.r * 1.9} ${y - 85}, ${x + a.r * .6} ${y + a.r * .2}`;
      label = { x, y: y - 55 };
    } else {
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const sign = edge.source < edge.target ? 1 : -1;
      let cx = (a.x + b.x) / 2 - dy / length * offset * sign;
      let cy = (a.y + b.y) / 2 + dx / length * offset * sign;
      // Bend long connections around intervening siblings rather than through them.
      let offsetCandidate;
      const obstacles = circles.filter(circle => circle !== a && circle !== b);
      const clearance = (x, y) => Math.min(Infinity, ...obstacles.flatMap(circle =>
        [.2, .35, .5, .65, .8].map(t => Math.hypot((1-t)**2*a.x + 2*(1-t)*t*x + t*t*b.x - circle.x, (1-t)**2*a.y + 2*(1-t)*t*y + t*t*b.y - circle.y) - circle.r - 12)));
      if (clearance(cx, cy) < 0) {
        let best = clearance(cx, cy);
        for (const bend of [120, -120, 220, -220]) {
          const x = cx - dy / length * bend, y = cy + dx / length * bend;
          const gap = clearance(x, y);
          if (gap > best) { best = gap; offsetCandidate = { x, y }; }
          if (best >= 0) break;
        }
        if (offsetCandidate) { cx = offsetCandidate.x; cy = offsetCandidate.y; }
      }
      const startLength = Math.hypot(cx - a.x, cy - a.y) || 1, endLength = Math.hypot(cx - b.x, cy - b.y) || 1;
      const start = { x: a.x + (cx - a.x) / startLength * (a.r + 3), y: a.y + (cy - a.y) / startLength * (a.r + 3) };
      const end = { x: b.x + (cx - b.x) / endLength * (b.r + 6), y: b.y + (cy - b.y) / endLength * (b.r + 6) };
      path = `M ${start.x} ${start.y} Q ${cx} ${cy}, ${end.x} ${end.y}`;
      const t = group.length > 1 ? .3 + group.indexOf(edge) / (group.length - 1) * .4 : .5;
      label = { x: (1-t)**2 * start.x + 2*(1-t)*t * cx + t*t * end.x, y: (1-t)**2 * start.y + 2*(1-t)*t * cy + t*t * end.y - 7 };
    }
    return [{ ...edge, path, labelPosition: label, active: !!selection && (edge.source === selection || edge.target === selection) }];
  });
}
