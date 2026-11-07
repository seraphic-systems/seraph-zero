export type LoadingKind = 'ring' | 'dots' | 'orbit';

const svgNamespace = 'http://www.w3.org/2000/svg';
function celestialGeometry(): SVGSVGElement {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '-370 -370 740 740');
  svg.setAttribute('focusable', 'false');
  const shape = (name: 'circle' | 'ellipse' | 'g' | 'path', attributes: Record<string, string>) => {
    const element = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  // The landing page's golden-ratio circles and six radial ellipses, simplified
  // for small sizes. No IDs: multiple loaders can coexist on the same page.
  for (const radius of [300, 185.41, 114.59]) {
    svg.append(shape('circle', { r: String(radius), class: 'loading__orbit-circle' }));
  }
  const wings = shape('g', { class: 'loading__wings' });
  for (let wing = 0; wing < 6; wing++) {
    const orientation = shape('g', { transform: `rotate(${wing * 60})` });
    orientation.append(shape('ellipse', { rx: '185', ry: '185', class: 'loading__wing' }));
    wings.append(orientation);
  }
  svg.append(wings);
  const phi = (1 + Math.sqrt(5)) / 2;
  const turns = 2.1;
  const points = Array.from({ length: 161 }, (_, index) => {
    const angle = index / 160 * turns * Math.PI * 2;
    const radius = 345 * phi ** ((angle - turns * Math.PI * 2) / (Math.PI / 2));
    return `${index ? 'L' : 'M'}${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`;
  });
  svg.append(shape('path', { d: points.join(' '), class: 'loading__golden-thread' }));
  return svg;
}

/** One accessible status; the animated geometry is decorative. */
export function createLoadingIndicator(kind: LoadingKind, label = 'Loading…'): HTMLElement {
  const status = document.createElement('span');
  status.className = 'loading';
  status.setAttribute('role', 'status');
  const mark = document.createElement('span');
  mark.className = `loading__mark loading__mark--${kind}`;
  mark.setAttribute('aria-hidden', 'true');
  if (kind === 'orbit') {
    mark.append(celestialGeometry());
  } else {
    for (let index = 0; index < (kind === 'dots' ? 3 : 1); index++) {
      mark.append(document.createElement('span'));
    }
  }
  const text = document.createElement('span');
  text.className = 'loading__label';
  text.textContent = label;
  status.append(mark, text);
  return status;
}
