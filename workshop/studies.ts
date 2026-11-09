import { createLoadingIndicator } from './components/loading.ts';
import { createChristogenesisProgress } from './components/christogenesis-progress.ts';
import { createAngelProgress } from './components/angel-progress.ts';
import { createTextbox } from './components/textbox.ts';
import { createFatButton } from './components/fat-button.ts';
import { createPillButton } from './components/pill-button.ts';
import { createJsonViewer } from './components/json-viewer.ts';
import type { JsonValue } from './components/json-viewer.ts';

export const studies = [
  { id: 'composition', title: 'A place to begin', category: 'Composition', mark: '✳', description: 'Writing area, a quiet action, and a ceremonial seal.', question: 'How much ceremony does a place for a thought need?' },
  { id: 'pill', title: 'Pill button', category: 'Component', mark: '↗', description: 'A small invitation with a luminous edge.', question: 'Can a small action feel inviting without asking for too much attention?' },
  { id: 'seal', title: 'Fat button', category: 'Component', mark: '✧', description: 'Six wings, fine ornament, a moment of ceremony.', question: 'What makes an action feel like a deliberate beginning?' },
  { id: 'textbox', title: 'Writing area', category: 'Component', mark: '¶', description: 'Crisp writing within an illuminated frame.', question: 'Can the frame feel alive while leaving the writing quiet?' },
  { id: 'json', title: 'JSON viewer', category: 'Component', mark: '{ }', description: 'Structured data inside an illuminated frame.', question: 'Can structure feel clear without losing a little ceremony?' },
  { id: 'angel', title: 'Angel procession', category: 'Motion', mark: '⋈', description: 'From a point into wings, outward and back.', question: 'How does a repeating journey change the experience of waiting?' },
  { id: 'christogenesis', title: 'Christogenesis', category: 'Motion', mark: 'Ω', description: 'Matter, life, thought, and convergence.', question: 'Can each silhouette rest long enough to be understood?' },
  { id: 'ring', title: 'Ring', category: 'Loading', mark: '◌', description: 'A familiar, continuous turn.', question: 'How quiet can a waiting signal become and still be legible?' },
  { id: 'dots', title: 'Dots', category: 'Loading', mark: '···', description: 'Three points, gently breathing.', question: 'Which rhythm feels patient rather than restless?' },
  { id: 'orbit', title: 'Orbit', category: 'Loading', mark: '◎', description: 'Six wings around a golden spiral.', question: 'How much detail can a small loading indicator hold?' },
] as const;
export type StudyId = typeof studies[number]['id'];
export type StudyValues = Record<string, string>;
export type Study = ReturnType<typeof mountStudy>;

// Native controls keep the workshop usable with keyboard and assistive technology.
export function selectControl(label: string, options: readonly (readonly [string, string])[], value: string, change: (value: string) => void) {
  const wrapper = document.createElement('label');
  wrapper.className = 'select-control';
  const caption = document.createElement('span');
  caption.textContent = label;
  const select = document.createElement('select');
  for (const [value, text] of options) select.add(new Option(text, value));
  select.value = value;
  select.addEventListener('change', () => change(select.value));
  wrapper.append(caption, select);
  return wrapper;
}
function action(label: string, handler: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

export function mountStudy(id: StudyId, values: StudyValues) {
  const element = document.createElement('div');
  element.className = `specimen specimen--${id}`;
  const controls = document.createElement('div');
  controls.className = 'study-controls';
  const feedback = document.createElement('p');
  feedback.className = 'study-feedback';
  feedback.setAttribute('role', 'status');
  const defaults = (key: string, value: string) => values[key] ??= value;
  const choice = (key: string, label: string, options: readonly (readonly [string, string])[], initial: string, update: (value: string) => void) => {
    const value = defaults(key, initial);
    controls.append(selectControl(label, options, value, next => { values[key] = next; update(next); }));
    update(value);
  };
  const buttons = [] as ReturnType<typeof createPillButton>[];
  if (id === 'json') {
    const samples: Record<string, JsonValue> = {
      object: { title: 'A place to begin', visibility: 'private', ready: true, count: 3, created_at: null, palette: ['cyan', 'mint', 'rose'], details: { note: 'Make room for what comes next.', saved: false } },
      array: [{ id: 'notice', label: 'Notice what is here' }, { id: 'gather', label: 'Gather a few thoughts' }, { id: 'begin', label: 'Begin again' }],
      strings: { message: 'A quote: "Fear not". A path: C:\\workshop', markup: '<strong>This stays text.</strong>', lines: 'First line\nSecond line', long: 'A longer thought, held in one continuous line so the document can be explored with horizontal scrolling on a narrow canvas.' },
      empty: {},
      scalar: null,
    };
    const viewer = createJsonViewer({ label: 'Specimen data', value: samples.object });
    choice('sample', 'Sample data', [['object', 'Nested object'], ['array', 'Array'], ['strings', 'Strings & escapes'], ['empty', 'Empty object'], ['scalar', 'Null value']], 'object', value => viewer.setValue(samples[value] ?? null));
    choice('format', 'Formatting', [['pretty', 'Indented'], ['compact', 'Compact']], 'pretty', value => viewer.setCompact(value === 'compact'));
    element.append(viewer.element);
    feedback.textContent = 'Read only. Tab into the document and use the arrow keys to scroll. Select text to copy; sample data stays in this preview.';
  }
  if (id === 'pill' || id === 'seal' || id === 'composition') {
    const button = id === 'seal' ? createFatButton() : createPillButton({ label: id === 'composition' ? 'Try a quiet action' : 'Keep exploring' });
    buttons.push(button);
    if (id === 'composition') buttons.push(createFatButton({ label: 'Try the seal' }));
    const states = [['ready', 'Ready'], ['loading', 'Loading'], ['disabled', 'Disabled']] as const;
    choice('buttonState', id === 'composition' ? 'Actions' : 'Button state', states, 'ready', value => {
      if (value === 'ready' || value === 'loading' || value === 'disabled') for (const button of buttons) button.setState(value);
    });
    let presses = 0;
    for (const button of buttons) button.element.addEventListener('click', () => {
      feedback.textContent = `${++presses} ${presses === 1 ? 'press' : 'presses'} in this preview. Nothing saved or submitted.`;
    });
    feedback.textContent = 'Try hover, Tab, Space, or Enter. Actions only count presses.';
  }
  if (id === 'textbox' || id === 'composition') {
    const textbox = createTextbox({ label: 'Your thoughts', hint: 'A rough idea, a question, or something worth returning to.', placeholder: 'Start wherever you are…', value: defaults('writing', ''), watermark: true });
    textbox.input.addEventListener('input', () => { values.writing = textbox.input.value; });
    choice('fieldState', 'Field state', [['editable', 'Editable'], ['error', 'Error'], ['readonly', 'Read only'], ['disabled', 'Disabled']], 'editable', value => {
      if (value === 'editable' || value === 'error' || value === 'readonly' || value === 'disabled') textbox.setState(value);
    });
    choice('watermark', 'Angel watermark', [['on', 'On'], ['off', 'Off']], 'on', value => textbox.setWatermark(value === 'on'));
    controls.append(action('Insert sample', () => {
      values.writing = 'Make room for the thought before deciding what it needs to become.\n\nA small space to notice, gather, and begin again.';
      textbox.setValue(values.writing);
    }));
    if (id === 'composition') {
      const heading = document.createElement('div');
      heading.className = 'composition-heading';
      heading.innerHTML = '<p class="eyebrow">A writing room / Composition study</p><h2>Something worth returning to.</h2><p>No finished thought required. Leave a little room for what comes next.</p>';
      element.append(heading);
    }
    element.append(textbox.element);
  }
  if (buttons.length) {
    const row = document.createElement('div');
    row.className = 'specimen-actions';
    row.append(...buttons.map(button => button.element));
    element.append(row);
  }
  let progress: ReturnType<typeof createAngelProgress> | undefined;
  let timing = 1;
  function syncTempo() {
    const duration = Number(values.tempo ?? '1.4') * timing;
    element.querySelector<HTMLElement>('.loading')?.style.setProperty('--loading-duration', `${duration}s`);
    progress?.setTempo(duration);
  }
  if (id === 'angel' || id === 'christogenesis') {
    progress = id === 'angel' ? createAngelProgress() : createChristogenesisProgress();
    element.append(progress.element);
    const finish = action('Finish loading', () => {
      values.finished = values.finished === 'yes' ? 'no' : 'yes';
      syncFinished();
    });
    function syncFinished() {
      if (values.finished === 'yes') progress!.finish(); else progress!.restart();
      finish.textContent = values.finished === 'yes' ? 'Restart loading' : 'Finish loading';
    }
    syncFinished();
    controls.append(finish);
    feedback.textContent = id === 'angel' ? 'Point → Seraph → Cherub → Throne, then back. Position is not a completion percentage.' : 'Matter → Life → Thought → Christ Omega. An artistic reading of Teilhard’s Christogenesis; position is not a completion percentage.';
  }
  if (id === 'ring' || id === 'dots' || id === 'orbit') {
    element.append(createLoadingIndicator(id, 'Gathering…'));
    feedback.textContent = 'The animation is decorative. The readable status remains available with reduced motion.';
  }
  if (progress || id === 'ring' || id === 'dots' || id === 'orbit') {
    choice('size', 'Size', [['24', 'Small · 24'], ['36', 'Medium · 36'], ['56', 'Large · 56']], '36', value => {
      element.style.setProperty('--loading-size', `${value}px`);
      // Loading components define defaults on their own root.
      element.querySelector<HTMLElement>('.loading')?.style.setProperty('--loading-size', `${value}px`);
      progress?.setSize(Number(value));
    });
    choice('tempo', 'Tempo', [['2.4', 'Slow'], ['1.4', 'Steady'], ['0.8', 'Quick']], '1.4', value => {
      syncTempo();
    });
  }
  return {
    element, controls, feedback,
    setTiming(scale: number) { timing = scale; syncTempo(); },
    setMotion(paused: boolean, reduced: boolean) { progress?.setPaused(paused); progress?.setReducedMotion(reduced); },
    dispose() {
      progress?.dispose();
      // Cancel Web Animations API pulses as well as CSS animations on unmount.
      for (const animation of element.getAnimations({ subtree: true })) animation.cancel();
    },
  };
}
