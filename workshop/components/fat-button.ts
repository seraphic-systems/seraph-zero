export type FatButtonState = 'ready' | 'loading' | 'disabled';

export function createFatButton({ label = 'Begin', loadingLabel = 'Beginning…' } = {}) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'fat-button';
  const text = document.createElement('span');
  text.className = 'fat-button__label';
  const mark = document.createElement('span');
  mark.className = 'fat-button__mark';
  mark.setAttribute('aria-hidden', 'true');
  // Adapt shared/assets/angels/seraph.svg to the seal's coordinate system.
  // Keep every contour in the same layers so RGB separation and tracing follow
  // the wings and halo as well as the frame. The visible label names the button.
  const engravings = [
    '<circle cx="80" cy="80" r="54"/><circle cx="80" cy="80" r="47"/>',
    '<ellipse cx="80" cy="40" rx="10" ry="3.75"/><path d="M80 20v7m0 106v7M20 80h7m106 0h7"/>',
    [
      ['-5deg', '-2px', 'M75 75C55 72.5 47.5 57.5 50 40C67.5 45 77.5 57.5 75 75Z', 'M55 47.5Q57.5 62.5 75 75'],
      ['5deg', '2px', 'M85 75C105 72.5 112.5 57.5 110 40C92.5 45 82.5 57.5 85 75Z', 'M105 47.5Q102.5 62.5 85 75'],
      ['-2deg', '-4px', 'M67.5 82.5C50 90 37.5 80 35 62.5C52.5 62.5 62.5 70 67.5 82.5Z', 'M42.5 67.5Q50 80 67.5 82.5'],
      ['2deg', '4px', 'M92.5 82.5C110 90 122.5 80 125 62.5C107.5 62.5 97.5 70 92.5 82.5Z', 'M117.5 67.5Q110 80 92.5 82.5'],
      ['5deg', '-2px', 'M75 92.5C55 90 47.5 102.5 55 122.5C72.5 115 77.5 105 75 92.5Z', 'M57.5 115Q57.5 100 75 92.5'],
      ['-5deg', '2px', 'M85 92.5C105 90 112.5 102.5 105 122.5C87.5 115 82.5 105 85 92.5Z', 'M102.5 115Q102.5 100 85 92.5'],
    ].map(([turn, shift, outline, feather]) => `<g class="fat-button__wing" style="--wing-turn: ${turn}; --wing-shift: ${shift}"><path d="${outline}"/><path d="${feather}"/></g>`).join(''),
    '<path d="M65 82.5Q80 67.5 95 82.5Q80 97.5 65 82.5Z"/><circle cx="80" cy="82.5" r="4.25"/>',
  ];
  const delays = [180, 420, 760, 1100];
  mark.innerHTML = `<span class="fat-button__inscription" lang="la">Ne timeas</span>
    <svg viewBox="0 0 160 160" fill="none" focusable="false">
      <g class="fat-button__channel fat-button__channel--red">${engravings.join('')}</g>
      <g class="fat-button__channel fat-button__channel--blue">${engravings.join('')}</g>
      <g class="fat-button__engraving">${engravings.map((lines, index) => `<g class="fat-button__engraving--${index}">${lines}</g>`).join('')}</g>
      <g class="fat-button__energy">${engravings.map((lines, index) => `<g style="--trace-delay: ${delays[index]}ms">${lines.replaceAll('/>', ' pathLength="1"/>')}</g>`).join('')}</g>
      <circle class="fat-button__loading-orbit" cx="80" cy="80" r="54" pathLength="100"/>
    </svg>`;
  const streak = document.createElement('span');
  streak.className = 'fat-button__streak';
  streak.setAttribute('aria-hidden', 'true');
  // A manuscript-inspired vine turns each corner of the illuminated frame.
  // Inline copies share the seal's color channels without SVG IDs.
  const corner = `<path d="M13 73V33Q13 13 33 13H73
    M18 57V34Q18 18 34 18H57
    M13 46C27 42 34 31 29 26C24 21 19 28 24 32C30 37 39 28 43 13"/>
    <path d="M15 40C5 34 7 25 13 23C19 27 21 33 15 40Z
    M40 15C34 5 25 7 23 13C27 19 33 21 40 15Z
    M18 55C25 52 28 45 25 40C19 42 16 48 18 55Z
    M55 18C52 25 45 28 40 25C42 19 48 16 55 18Z"/>
    <path d="m25 17 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>`;
  const borderLines = [0, 90, 180, 270].map(angle => `<g transform="rotate(${angle} 120 120)">${corner}</g>`).join('')
    + '<path d="M77 13h28m30 0h28M77 227h28m30 0h28M13 77v28m0 30v28m214-86v28m0 30v28"/>'
    + '<path d="m120 9 4 4-4 4-4-4Zm0 214 4 4-4 4-4-4ZM9 120l4-4 4 4-4 4Zm214 0 4-4 4 4-4 4Z"/>';
  const border = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  border.setAttribute('class', 'fat-button__border');
  border.setAttribute('viewBox', '0 0 240 240');
  border.setAttribute('preserveAspectRatio', 'none');
  border.setAttribute('fill', 'none');
  border.setAttribute('aria-hidden', 'true');
  border.setAttribute('focusable', 'false');
  border.innerHTML = `<g class="fat-button__channel fat-button__channel--red">${borderLines}</g>
    <g class="fat-button__channel fat-button__channel--blue">${borderLines}</g>
    <g class="fat-button__engraving">${borderLines}</g>
    <g class="fat-button__energy"><g style="--trace-delay: 0ms">${borderLines.replaceAll('/>', ' pathLength="1"/>')}</g></g>`;
  element.append(border, streak, mark, text);
  const seal = mark.querySelector('svg')!;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let pulse: Animation | undefined;

  function setState(state: FatButtonState) {
    const awakening = element.dataset.state === 'disabled' && state === 'ready';
    element.toggleAttribute('data-awakening', awakening);
    element.dataset.state = state;
    if (state !== 'ready') pulse?.cancel();
    element.disabled = state === 'disabled';
    // Keep focus while busy, but suppress pointer and keyboard activation.
    element.setAttribute('aria-disabled', String(state !== 'ready'));
    element.setAttribute('aria-busy', String(state === 'loading'));
    text.textContent = state === 'loading' ? loadingLabel : label;
  }
  element.addEventListener('animationend', (event) => {
    if (event.animationName === 'fat-button-awaken') element.removeAttribute('data-awakening');
  });
  element.addEventListener('click', (event) => {
    if (element.dataset.state !== 'ready') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    pulse?.cancel();
    if (reducedMotion.matches || element.closest('[data-reduced-motion]')) return;
    const style = getComputedStyle(element);
    const light = style.getPropertyValue('--color-light-blue').trim();
    const duration = Number.parseFloat(style.getPropertyValue('--motion-pulse'));
    const glow = Number.parseFloat(style.getPropertyValue('--workshop-glow') || '1');
    // Animate only the artwork: both text lines stay outside the light effects.
    pulse = seal.animate([
      { filter: 'brightness(1)' },
      { filter: `brightness(1.65) drop-shadow(0 0 ${6 * glow}px ${light})`, offset: 0.3 },
      { filter: 'brightness(1)' },
    ], { duration, easing: 'ease-out' });
  });
  setState('ready');
  return { element, setState };
}
