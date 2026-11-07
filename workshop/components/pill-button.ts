export type PillButtonState = 'ready' | 'loading' | 'disabled';

export function createPillButton({ label = 'Keep exploring', loadingLabel = 'Gathering…' } = {}) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'pill-button';
  const mark = document.createElement('span');
  mark.className = 'pill-button__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" focusable="false"><circle class="pill-button__ring" cx="12" cy="12" r="9"/><path class="pill-button__star" d="m12 5 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/></svg>';
  const text = document.createElement('span');
  text.className = 'pill-button__label';
  element.append(mark, text);

  function setState(state: PillButtonState) {
    element.dataset.state = state;
    element.disabled = state === 'disabled';
    // Busy buttons retain focus while suppressing all activation.
    element.setAttribute('aria-disabled', String(state !== 'ready'));
    element.setAttribute('aria-busy', String(state === 'loading'));
    text.textContent = state === 'loading' ? loadingLabel : label;
  }
  element.addEventListener('click', (event) => {
    if (element.dataset.state === 'ready') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  setState('ready');
  return { element, setState };
}
