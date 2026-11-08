type Point = readonly [number, number];
const ns = 'http://www.w3.org/2000/svg';
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

type MorphProgressOptions = {
  shapes: readonly (readonly (readonly Point[])[])[];
  labels: readonly [string, string, string, string];
  className: string;
  center?: 'eye' | 'cross';
  forward?: boolean;
};

// Both studies share animation, accessibility, preview controls, and RGB styling.
export function createMorphProgress({ shapes, labels, className, center = 'eye', forward = false }: MorphProgressOptions) {
  const element = document.createElement('div');
  element.className = `morph-progress ${className}`;
  element.innerHTML = `<div class="morph-progress__field" role="progressbar" aria-label="Loading" aria-valuetext="Loading; duration unknown"><div class="morph-progress__rail"><div class="morph-progress__trail"></div><div class="morph-progress__traveler"><svg viewBox="-42 -42 84 84" fill="none" aria-hidden="true" focusable="false">${center === 'cross' ? '<g class="christogenesis-progress__radiance"><circle r="36"/><path d="M0-40V-35M0 35V40M-40 0H-35M35 0H40M-28-28L-25-25M25 25L28 28M-28 28L-25 25M25-25L28-28"/></g>' : ''}<g class="morph-progress__channel morph-progress__channel--red"></g><g class="morph-progress__channel morph-progress__channel--blue"></g><g class="morph-progress__forms"></g><path class="morph-progress__eye" d="${center === 'cross' ? 'M0-12V12M-9-3H9' : 'M-8 0Q0-7 8 0Q0 7-8 0Z'}"/><circle class="morph-progress__point" r="1.8"/></svg></div></div></div><div class="morph-progress__legend" aria-hidden="true">${labels.map(label => `<span>${label}</span>`).join('')}</div><p class="morph-progress__status" role="status">Loading…</p>`;
  const field = element.querySelector<HTMLElement>('.morph-progress__field')!;
  const traveler = element.querySelector<HTMLElement>('.morph-progress__traveler')!;
  const trail = element.querySelector<HTMLElement>('.morph-progress__trail')!;
  const eye = element.querySelector<SVGElement>('.morph-progress__eye')!;
  const status = element.querySelector<HTMLElement>('.morph-progress__status')!;
  // Share the morph geometry across the crisp outline and decorative RGB edges.
  const layers = Array.from(element.querySelectorAll('.morph-progress__forms, .morph-progress__channel'), group =>
    Array.from({ length: 6 }, () => {
      const path = document.createElementNS(ns, 'path');
      group.append(path);
      return path;
    }));
  let elapsed = 0, previous: number | undefined, frame = 0;
  let paused = false, reduced = false, completed = false, disposed = false;
  let duration = 1.4;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function draw(position: number) {
    traveler.style.left = `${position * 100}%`;
    trail.style.width = `${position * 100}%`;
    if (center === 'cross') element.style.setProperty('--christogenesis-light', String(ease(Math.max(0, (position - .7) / .3))));
    const stops = [0, .32, .65, 1];
    let index = 0;
    while (index < 2 && position > stops[index + 1]) index++;
    const t = ease((position - stops[index]) / (stops[index + 1] - stops[index]));
    shapes[index].forEach((shape, wing) => {
      const points = shape.map(([x, y], step) => {
        const target = shapes[index + 1][wing][step];
        return `${step ? 'L' : 'M'}${mix(x, target[0], t).toFixed(2)},${mix(y, target[1], t).toFixed(2)}`;
      });
      const outline = points.join(' ') + (center === 'cross' && index === 2 ? '' : 'Z');
      for (const paths of layers) paths[wing].setAttribute('d', outline);
    });
    eye.style.opacity = String(center === 'cross' ? ease(Math.max(0, (position - .7) / .3)) : Math.min(1, position * 5));
  }
  function tick(now: number) {
    if (previous !== undefined) elapsed += Math.min(now - previous, 100);
    previous = now;
    // A complete outward-and-return journey takes 14 seconds at steady tempo.
    const phase = elapsed / (duration * 5000) % 2;
    if (forward) {
      // Hold at convergence, then fade and begin a new decorative loading cycle.
      const cycle = elapsed / (duration * 9000) % 1;
      // Give each silhouette a readable resting moment between morphs.
      const stops = [[0, 0], [.07, 0], [.27, .32], [.39, .32], [.59, .65], [.71, .65], [.9, 1], [1, 1]] as const;
      let segment = 0;
      while (segment < stops.length - 2 && cycle > stops[segment + 1][0]) segment++;
      const [startTime, start] = stops[segment];
      const [endTime, end] = stops[segment + 1];
      draw(mix(start, end, ease((cycle - startTime) / (endTime - startTime))));
      traveler.style.opacity = String(cycle > .94 ? (1 - cycle) / .06 : Math.min(1, cycle / .04));
    } else draw(ease(phase <= 1 ? phase : 2 - phase));
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    previous = undefined;
    if (disposed) return;
    traveler.style.opacity = '1';
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
    setSize(value: number) { element.style.setProperty('--morph-size', `${value * 2}px`); },
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
