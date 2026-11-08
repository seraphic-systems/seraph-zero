import { createMorphProgress } from './morph-progress.ts';

// Compatible point counts keep every transition a geometric morph, rather than
// swapping icons. These are studies of the site's seraph, cherub, and throne.
type Point = readonly [number, number];
type Form = 'point' | 'seraph' | 'cherub' | 'throne';
const samples = 48;

function outline(form: Form, wing: number, step: number): Point {
  if (form === 'point') return [0, 0];
  const angle = step / samples * Math.PI * 2;
  if (form === 'throne') {
    const rotation = [0, 0, Math.PI / 4, -Math.PI / 4, 0, Math.PI / 2][wing];
    const rx = [34, 25, 14, 14, 6, 6][wing];
    const ry = [34, 25, 34, 34, 34, 34][wing];
    const x = Math.cos(angle) * rx, y = Math.sin(angle) * ry;
    return [x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation)];
  }
  if (form === 'cherub' && wing > 3) return [0, 0];
  const rotation = form === 'seraph' ? wing * Math.PI / 3 - Math.PI / 2 : wing * Math.PI / 2 - Math.PI / 4;
  const x = 16 * (1 - Math.cos(angle));
  const y = Math.sin(angle) * (form === 'seraph' ? 9 : 12);
  return [x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation)];
}
const forms: Form[] = ['point', 'seraph', 'cherub', 'throne'];
const shapes = forms.map(form => Array.from({ length: 6 }, (_, wing) =>
  Array.from({ length: samples + 1 }, (_, step) => outline(form, wing, step))));

export function createAngelProgress() {
  return createMorphProgress({ shapes, labels: ['Point', 'Seraph', 'Cherub', 'Throne'], className: 'angel-progress' });
}
