import { defaultVisuals, parsePresets, presetStorageKey, visualProperties, visualRanges, type VisualSettings, type VisualPreset } from './visual-settings.ts';

const libraryChanged = new EventTarget();
export function createVisualControls(surface: HTMLElement, canvas: string, onTiming: (scale: number) => void) {
  let settings = { ...defaultVisuals };
  const element = document.createElement('details');
  element.className = 'visual-editor';
  const summary = document.createElement('summary');
  summary.textContent = 'Visual controls & presets';
  const body = document.createElement('div');
  body.className = 'visual-editor__body';
  const hint = document.createElement('p');
  hint.className = 'visual-hint';
  hint.textContent = 'Tune this canvas. Hover or focus the artwork to see interactive effects. Timing scales durations; higher is slower.';
  const inputs = new Map<keyof VisualSettings, HTMLInputElement>();
  const outputs = new Map<string, HTMLOutputElement>();
  const colors = document.createElement('fieldset');
  const colorLegend = document.createElement('legend');
  colorLegend.textContent = `Palette ${canvas}`;
  const colorGrid = document.createElement('div');
  colorGrid.className = 'visual-colors';
  colors.append(colorLegend, colorGrid);
  for (const [key, label] of [['red', 'Rose edge'], ['green', 'Mint accent'], ['blue', 'Blue edge'], ['cyan', 'Cyan outline'], ['face', 'Face on light'], ['deepFace', 'Face on dark']] as const) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement('input');
    input.type = 'color'; input.value = settings[key];
    input.setAttribute('aria-label', `${label} ${canvas}`);
    input.addEventListener('input', () => { settings[key] = input.value; apply(); });
    inputs.set(key, input);
    wrapper.append(input); colorGrid.append(wrapper);
  }
  const ranges = document.createElement('div');
  ranges.className = 'visual-ranges';
  for (const [key, label] of [['glow', 'Glow'], ['split', 'RGB split'], ['timing', 'Timing']] as const) {
    const wrapper = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = label;
    const input = document.createElement('input');
    const output = document.createElement('output');
    const [min, max, step] = visualRanges[key];
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    input.id = `visual-${key}-${canvas}`; output.htmlFor = input.id;
    input.setAttribute('aria-label', `${label} ${canvas}`);
    input.addEventListener('input', () => { settings[key] = Number(input.value); apply(); });
    inputs.set(key, input); outputs.set(key, output);
    wrapper.append(caption, output, input); ranges.append(wrapper);
  }
  const presetArea = document.createElement('div');
  presetArea.className = 'visual-presets';
  const presetLabel = document.createElement('label');
  presetLabel.textContent = `Saved presets ${canvas}`;
  const presets = document.createElement('select');
  presets.setAttribute('aria-label', `Saved presets ${canvas}`);
  presetLabel.append(presets);
  const nameLabel = document.createElement('label');
  nameLabel.textContent = `Preset name ${canvas}`;
  const name = document.createElement('input');
  name.type = 'text'; name.maxLength = 60; name.placeholder = 'e.g. Quiet cyan';
  name.setAttribute('aria-label', `Preset name ${canvas}`);
  nameLabel.append(name);
  const actions = document.createElement('div');
  actions.className = 'preset-actions';
  const status = document.createElement('p');
  status.className = 'visual-status'; status.setAttribute('role', 'status');
  function button(label: string, handler: () => void) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.addEventListener('click', handler); actions.append(button);
    return button;
  }
  function read() { return parsePresets(localStorage.getItem(presetStorageKey)); }
  function fail() { status.textContent = 'Preset storage is unavailable or unreadable. Visual controls still work; saved data has not been changed.'; }
  function refresh() {
    const selected = presets.value;
    presets.replaceChildren(new Option('Choose a preset…', ''));
    try {
      for (const preset of read()) presets.add(new Option(preset.name, preset.id));
      presets.value = selected;
    } catch { fail(); }
    if (!presets.value) presets.value = '';
    updateButtons();
  }
  function write(library: VisualPreset[], message: string) {
    try {
      localStorage.setItem(presetStorageKey, JSON.stringify({ version: 1, presets: library }));
      libraryChanged.dispatchEvent(new Event('change'));
      status.textContent = message;
      return true;
    } catch { fail(); return false; }
  }
  const load = button('Load preset', () => {
    try {
      const preset = read().find(preset => preset.id === presets.value);
      if (!preset) { refresh(); return; }
      settings = { ...preset.settings }; name.value = preset.name; apply();
      status.textContent = `Loaded “${preset.name}” on canvas ${canvas}.`;
    } catch { fail(); }
  });
  button('Save new preset', () => {
    const title = name.value.trim();
    if (!title) { status.textContent = 'Give your preset a name first.'; name.focus(); return; }
    try {
      const library = read();
      if (library.some(preset => preset.name.toLowerCase() === title.toLowerCase())) { status.textContent = 'That name is already saved. Choose a new name or replace the selected preset.'; return; }
      if (library.length >= 50) { status.textContent = 'Your library holds 50 presets. Remove one before saving another.'; return; }
      const id = crypto.randomUUID();
      if (write([...library, { id, name: title, settings: { ...settings } }], `Saved “${title}” in this browser.`)) { presets.value = id; updateButtons(); }
    } catch { fail(); }
  });
  const replace = button('Replace selected', () => {
    try {
      const library = read();
      const selected = library.find(preset => preset.id === presets.value);
      if (!selected) { refresh(); return; }
      selected.settings = { ...settings };
      write(library, `Replaced the visual settings in “${selected.name}”.`);
    } catch { fail(); }
  });
  const remove = button('Delete selected', () => {
    try {
      const library = read();
      const selected = library.find(preset => preset.id === presets.value);
      if (!selected) { refresh(); return; }
      write(library.filter(preset => preset.id !== selected.id), `Deleted “${selected.name}”. The current canvas is unchanged.`);
    } catch { fail(); }
  });
  button('Reset visuals', () => {
    settings = { ...defaultVisuals }; apply();
    presets.value = ''; name.value = ''; updateButtons();
    status.textContent = 'Restored the original visual settings. Saved presets are unchanged.';
  });
  function updateButtons() { for (const button of [load, replace, remove]) button.disabled = !presets.value; }
  presets.addEventListener('change', updateButtons);
  const storageNote = document.createElement('p');
  storageNote.className = 'visual-hint';
  storageNote.textContent = 'Presets are shared by both canvases and saved in this browser at this workshop address. Only visual settings are saved, never your writing or study state.';
  presetArea.append(presetLabel, nameLabel, actions, status, storageNote);
  body.append(hint, colors, ranges, presetArea); element.append(summary, body);
  function apply() {
    for (const [property, value] of Object.entries(visualProperties(settings))) surface.style.setProperty(property, value);
    for (const [key, input] of inputs) input.value = String(settings[key]);
    for (const [key, output] of outputs) output.value = `${Number(settings[key as 'glow' | 'split' | 'timing']).toFixed(2)}×`;
    onTiming(settings.timing);
  }
  libraryChanged.addEventListener('change', refresh);
  window.addEventListener('storage', event => { if (event.key === presetStorageKey || event.key === null) refresh(); });
  apply(); refresh();
  return { element, get timing() { return settings.timing; } };
}
