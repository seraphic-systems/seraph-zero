// Compatible point counts keep every transition a geometric morph, rather than
// swapping icons. These are studies of the site's seraph, cherub, and throne.
type Point = readonly [number, number];
type Form = 'point' | 'seraph' | 'cherub' | 'throne';
const ns = 'http://www.w3.org/2000/svg';
const samples = 48;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

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
  const element = document.createElement('div');
  element.className = 'angel-progress';
  element.innerHTML = `<div class="angel-progress__field" role="progressbar" aria-label="Loading" aria-valuetext="Loading; duration unknown"><div class="angel-progress__rail"><div class="angel-progress__trail"></div><div class="angel-progress__traveler"><svg viewBox="-42 -42 84 84" fill="none" aria-hidden="true" focusable="false"><g class="angel-progress__forms"></g><path class="angel-progress__eye" d="M-8 0Q0-7 8 0Q0 7-8 0Z"/><circle class="angel-progress__point" r="1.8"/></svg></div></div></div><div class="angel-progress__legend" aria-hidden="true"><span>Point</span><span>Seraph</span><span>Cherub</span><span>Throne</span></div><p class="angel-progress__status" role="status">Loading…</p>`;
  const field = element.querySelector<HTMLElement>('.angel-progress__field')!;
  const traveler = element.querySelector<HTMLElement>('.angel-progress__traveler')!;
  const trail = element.querySelector<HTMLElement>('.angel-progress__trail')!;
  const eye = element.querySelector<SVGElement>('.angel-progress__eye')!;
  const status = element.querySelector<HTMLElement>('.angel-progress__status')!;
  const group = element.querySelector('.angel-progress__forms')!;
  const paths = Array.from({ length: 6 }, () => {
    const path = document.createElementNS(ns, 'path');
    group.append(path);
    return path;
  });
  let elapsed = 0, previous: number | undefined, frame = 0;
  let paused = false, reduced = false, completed = false, disposed = false;
  let duration = 1.4;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function draw(position: number) {
    traveler.style.left = `${position * 100}%`;
    trail.style.width = `${position * 100}%`;
    const stops = [0, .32, .65, 1];
    let index = 0;
    while (index < 2 && position > stops[index + 1]) index++;
    const t = ease((position - stops[index]) / (stops[index + 1] - stops[index]));
    paths.forEach((path, wing) => {
      const points = shapes[index][wing].map(([x, y], step) => {
        const target = shapes[index + 1][wing][step];
        return `${step ? 'L' : 'M'}${mix(x, target[0], t).toFixed(2)},${mix(y, target[1], t).toFixed(2)}`;
      });
      path.setAttribute('d', points.join(' ') + 'Z');
    });
    eye.style.opacity = String(Math.min(1, position * 5));
  }
  function tick(now: number) {
    if (previous !== undefined) elapsed += Math.min(now - previous, 100);
    previous = now;
    // A complete outward-and-return journey takes 14 seconds at steady tempo.
    const phase = elapsed / (duration * 5000) % 2;
    draw(ease(phase <= 1 ? phase : 2 - phase));
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    previous = undefined;
    if (disposed) return;
    if (completed) draw(1);
    else if (reduced || motion.matches) draw(.65);
    else if (!paused) frame = requestAnimationFrame(tick);
  }
  motion.addEventListener('change', sync);
  draw(0);
  sync();
  return {
    element,
    setPaused(value: boolean) { paused = value; sync(); },
    setReducedMotion(value: boolean) { reduced = value; sync(); },
    setTempo(value: number) { if (Number.isFinite(value) && value > 0) duration = value; },
    setSize(value: number) { element.style.setProperty('--angel-size', `${value * 2}px`); },
    finish() {
      completed = true;
      element.dataset.complete = '';
      field.setAttribute('aria-label', 'Loading complete');
      field.setAttribute('aria-valuenow', '100');
      field.setAttribute('aria-valuetext', 'Complete');
      status.textContent = 'Loaded. Ready when you are.';
      sync();
    },
    restart() {
      completed = false;
      elapsed = 0;
      delete element.dataset.complete;
      field.setAttribute('aria-label', 'Loading');
      field.removeAttribute('aria-valuenow');
      field.setAttribute('aria-valuetext', 'Loading; duration unknown');
      status.textContent = 'Loading…';
      draw(0);
      sync();
    },
    dispose() { disposed = true; cancelAnimationFrame(frame); motion.removeEventListener('change', sync); },
  };
}
