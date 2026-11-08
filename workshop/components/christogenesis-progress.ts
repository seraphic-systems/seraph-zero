import { createMorphProgress } from './morph-progress.ts';

type Point = readonly [number, number];
const samples = 72;

// An artistic reading: dispersed matter, a living sprout, a connected noosphere,
// then an Omega outline centered on a cross. Equal samples keep the morph fluid.
function outline(stage: number, strand: number, step: number): Point {
  const t = step / samples;
  const angle = t * Math.PI * 2;
  const rotation = strand * Math.PI / 3;
  if (stage === 0) {
    return [Math.cos(rotation) * 25 + Math.cos(angle) * 3, Math.sin(rotation) * 25 + Math.sin(angle) * 3];
  }
  if (stage === 1) {
    // A sprout: stem, two broad leaves, a bud, and two spreading roots.
    if (strand === 0) return [Math.sin(angle) * 1.5, Math.cos(angle) * 27];
    if (strand === 3) return [Math.sin(angle) * 5, -25 + Math.cos(angle) * 8];
    if (strand === 1 || strand === 2) {
      const side = strand === 1 ? -1 : 1;
      const reach = (1 - Math.cos(angle)) / 2;
      return [side * (reach * 28), 4 - reach * 26 + Math.sin(angle) * 7];
    }
    const side = strand === 4 ? -1 : 1;
    return [side * (1 - Math.cos(angle)) * 9, 18 + (1 - Math.cos(angle)) * 6 + Math.sin(angle) * 2];
  }
  if (stage === 2) {
    // Six angular neural branches, each terminating in a distinct round node.
    // The return via a neighbor creates a connected web rather than orbital rings.
    const rotate = (x: number, y: number): Point =>
      [x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation)];
    const vertices: Point[] = [[0, 0], [12, -5], [27, 0]];
    for (let i = 0; i <= 18; i++) {
      const a = Math.PI + i / 18 * Math.PI * 2;
      vertices.push([31 + Math.cos(a) * 4, Math.sin(a) * 4]);
    }
    vertices.push([19, 10], [15.5, 26.8], [7, 12], [0, 0]);
    // Sample by distance so long connections and small nodes both stay legible.
    const lengths = vertices.slice(1).map((p, i) => Math.hypot(p[0] - vertices[i][0], p[1] - vertices[i][1]));
    let distance = t * lengths.reduce((sum, length) => sum + length, 0);
    let segment = 0;
    while (segment < lengths.length - 1 && distance > lengths[segment]) distance -= lengths[segment++];
    const start = vertices[segment], end = vertices[segment + 1];
    const fraction = distance / lengths[segment];
    return rotate(start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction);
  }
  // Two joined feet frame the open Omega. Each strand converges on the same
  // contour, retaining a fine layered halo rather than swapping to a text glyph.
  const vertices: Point[] = [[-30, 27], [-13, 27]];
  for (let i = 0; i <= 60; i++) {
    const a = Math.PI * .72 + i / 60 * Math.PI * 1.56;
    vertices.push([Math.cos(a) * 27, Math.sin(a) * 27 - 2]);
  }
  vertices.push([13, 27], [30, 27]);
  const index = t * (vertices.length - 1);
  const first = vertices[Math.floor(index)];
  const last = vertices[Math.min(vertices.length - 1, Math.floor(index) + 1)];
  const fraction = index % 1;
  const halo = 1 + strand * .012;
  return [(first[0] + (last[0] - first[0]) * fraction) * halo, (first[1] + (last[1] - first[1]) * fraction) * halo];
}
const shapes = Array.from({ length: 4 }, (_, stage) =>
  Array.from({ length: 6 }, (_, strand) =>
    Array.from({ length: samples + 1 }, (_, step) => outline(stage, strand, step))));

export function createChristogenesisProgress() {
  return createMorphProgress({
    shapes,
    labels: ['Matter', 'Life', 'Mind', 'Ω · Christ'],
    className: 'christogenesis-progress',
    center: 'cross',
    forward: true,
  });
}
