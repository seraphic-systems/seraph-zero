export interface TextboxOptions {
  label: string;
  hint?: string;
  placeholder?: string;
  value?: string;
  rows?: number;
  watermark?: boolean;
}

export function createTextbox(options: TextboxOptions) {
  const id = `textbox-${crypto.randomUUID()}`;
  const element = document.createElement('div');
  element.className = 'textbox';
  const label = document.createElement('label');
  label.className = 'textbox__label';
  label.htmlFor = id;
  label.textContent = options.label;
  const hint = document.createElement('p');
  hint.className = 'textbox__hint';
  hint.id = `${id}-hint`;
  hint.textContent = options.hint ?? '';
  hint.hidden = !options.hint;
  const input = document.createElement('textarea');
  input.className = 'textbox__input';
  input.id = id;
  input.name = 'writing';
  input.rows = options.rows ?? 7;
  input.placeholder = options.placeholder ?? '';
  input.value = options.value ?? '';
  input.spellcheck = true;
  const field = document.createElement('div');
  field.className = 'textbox__field';
  field.append(input);
  const seal = document.createElement('div');
  seal.className = 'textbox__seal';
  seal.setAttribute('aria-hidden', 'true');
  // Paired wings and a divided halo open with focus, then meet again on blur.
  seal.innerHTML = `<svg viewBox="-10 -10 60 60" fill="none" focusable="false">
    <path class="textbox__halo textbox__halo--left" d="M20-5A25 25 0 0 0 20 45"/>
    <path class="textbox__halo textbox__halo--right" d="M20-5A25 25 0 0 1 20 45"/>
    <g class="textbox__wings textbox__wings--left"><path d="M18 18C10 17 7 11 8 4C15 6 19 11 18 18Z M15 21C8 24 3 20 2 13C9 13 13 16 15 21Z M18 25C10 24 7 29 10 37C17 34 19 30 18 25Z"/></g>
    <g class="textbox__wings textbox__wings--right"><path d="M22 18C30 17 33 11 32 4C25 6 21 11 22 18Z M25 21C32 24 37 20 38 13C31 13 27 16 25 21Z M22 25C30 24 33 29 30 37C23 34 21 30 22 25Z"/></g>
    <ellipse cx="20" cy="3" rx="4" ry="1.5"/><path class="textbox__seal-eye" d="M14 21Q20 15 26 21Q20 27 14 21Z"/><circle cx="20" cy="21" r="1.5"/>
  </svg>`;
  field.append(seal);
  input.addEventListener('focus', () => { delete element.dataset.sealing; });
  input.addEventListener('blur', () => {
    if (!input.disabled && !input.readOnly) element.dataset.sealing = '';
  });
  element.toggleAttribute('data-watermark', options.watermark ?? false);
  const footer = document.createElement('div');
  footer.className = 'textbox__footer';
  const message = document.createElement('p');
  message.className = 'textbox__message';
  message.id = `${id}-message`;
  message.setAttribute('aria-live', 'polite');
  const count = document.createElement('p');
  count.className = 'textbox__count';
  // A visual count, without announcing a new status on every keystroke.
  function updateCount() {
    const value = input.value;
    const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
    const characters = Array.from(value).length;
    count.textContent = `${words} ${words === 1 ? 'word' : 'words'} · ${characters} ${characters === 1 ? 'character' : 'characters'}`;
  }
  function describe() {
    const ids = [options.hint ? hint.id : '', message.textContent ? message.id : ''].filter(Boolean);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }
  input.addEventListener('input', updateCount);
  footer.append(message, count);
  element.append(label, hint, field, footer);
  describe();
  updateCount();
  return {
    element,
    input,
    setWatermark(value: boolean) { element.toggleAttribute('data-watermark', value); },
    setValue(value: string) { input.value = value; updateCount(); },
    setState(state: 'editable' | 'error' | 'readonly' | 'disabled') {
      input.disabled = state === 'disabled';
      input.readOnly = state === 'readonly';
      element.dataset.state = state;
      if (state === 'error') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      message.textContent = state === 'error' ? 'Example error: add a little more detail before continuing.'
        : state === 'readonly' ? 'Read only. You can select and copy this text.'
        : state === 'disabled' ? 'This writing area is currently unavailable.' : '';
      describe();
    },
  };
}
