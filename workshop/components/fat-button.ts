export type FatButtonState = 'ready' | 'loading' | 'disabled';

export function createFatButton({ label = 'Make it happen', loadingLabel = 'Making it happen…' } = {}) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'fat-button';
  const text = document.createElement('span');
  text.className = 'fat-button__label';
  const mark = document.createElement('span');
  mark.className = 'fat-button__mark';
  mark.setAttribute('aria-hidden', 'true');
  // The engraving is decorative; the visible label supplies the accessible name.
  const engravings = [
    '<path d="M15 43V15h28m74 0h28v28m0 74v28h-28m-74 0H15v-28"/>',
    '<circle cx="80" cy="80" r="54"/><circle cx="80" cy="80" r="47"/>',
    '<path d="M80 20v12m0 96v12M20 80h12m96 0h12M38 38l9 9m66 66 9 9m0-84-9 9m-66 66-9 9"/>',
    '<path d="m80 42 10 28 28 10-28 10-10 28-10-28-28-10 28-10Z"/>',
    '<path d="M55 80q25-25 50 0-25 25-50 0Z"/><circle cx="80" cy="80" r="7"/>',
  ];
  const delays = [0, 180, 420, 760, 1100];
  mark.innerHTML = `<span class="fat-button__inscription">Per aspera · ad astra</span>
    <svg viewBox="0 0 160 160" fill="none" focusable="false">
      <g class="fat-button__channel fat-button__channel--red">${engravings.join('')}</g>
      <g class="fat-button__channel fat-button__channel--blue">${engravings.join('')}</g>
      <g class="fat-button__engraving">${engravings.map((lines, index) => `<g class="fat-button__engraving--${index}">${lines}</g>`).join('')}</g>
      <g class="fat-button__energy">${engravings.map((lines, index) => `<g style="--trace-delay: ${delays[index]}ms">${lines.replaceAll('/>', ' pathLength="1"/>')}</g>`).join('')}</g>
      <path class="fat-button__satellites" d="m25 21 4 8-4 8-4-8Zm110 102 4 8-4 8-4-8Z"/>
    </svg>`;
  const streak = document.createElement('span');
  streak.className = 'fat-button__streak';
  streak.setAttribute('aria-hidden', 'true');
  element.append(streak, mark, text);
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
    // Animate only the artwork: both text lines stay outside the light effects.
    pulse = seal.animate([
      { filter: 'brightness(1)' },
      { filter: `brightness(1.65) drop-shadow(0 0 6px ${light})`, offset: 0.3 },
      { filter: 'brightness(1)' },
    ], { duration, easing: 'ease-out' });
  });
  setState('ready');
  return { element, setState };
}
