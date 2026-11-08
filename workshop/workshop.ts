import { createLoadingIndicator, type LoadingKind } from './components/loading.ts';
import { createChristogenesisProgress } from './components/christogenesis-progress.ts';
import { createAngelProgress } from './components/angel-progress.ts';
import { createTextbox } from './components/textbox.ts';
import { createFatButton } from './components/fat-button.ts';
import { createPillButton } from './components/pill-button.ts';

const pillButton = createPillButton();
document.querySelector('#pill-button-example')!.append(pillButton.element);
const pillState = document.querySelector<HTMLSelectElement>('#pill-state')!;
const pillFeedback = document.querySelector<HTMLElement>('#pill-feedback')!;
let pillPresses = 0;
pillButton.element.addEventListener('click', () => {
  pillPresses += 1;
  pillFeedback.textContent = `${pillPresses} ${pillPresses === 1 ? 'press' : 'presses'}. Nothing submitted; just trying the feel.`;
});
pillState.addEventListener('change', () => {
  const state = pillState.value;
  if (state !== 'ready' && state !== 'loading' && state !== 'disabled') return;
  pillButton.setState(state);
  pillFeedback.textContent = state === 'loading' ? 'Loading preview. Further presses are ignored.'
    : state === 'disabled' ? 'Disabled preview. The pill is unavailable.'
    : 'Ready. Try another press.';
});

const fatButton = createFatButton();
document.querySelector('#fat-button-example')!.append(fatButton.element);
const buttonState = document.querySelector<HTMLSelectElement>('#button-state')!;
const buttonFeedback = document.querySelector<HTMLElement>('#button-feedback')!;
let presses = 0;
fatButton.element.addEventListener('click', () => {
  presses += 1;
  buttonFeedback.textContent = `${presses} ${presses === 1 ? 'press' : 'presses'}. Nothing submitted; just trying the feel.`;
});
buttonState.addEventListener('change', () => {
  const state = buttonState.value;
  if (state !== 'ready' && state !== 'loading' && state !== 'disabled') return;
  fatButton.setState(state);
  buttonFeedback.textContent = state === 'loading' ? 'Loading preview. Further presses are ignored.'
    : state === 'disabled' ? 'Disabled preview. The button is unavailable.'
    : 'Ready. Try another press.';
});

const textbox = createTextbox({
  label: 'Your thoughts',
  hint: 'A rough idea, a question, or something worth returning to.',
  placeholder: 'Start wherever you are…',
  watermark: true,
});
document.querySelector('#textbox-example')!.append(textbox.element);
const watermark = document.querySelector<HTMLInputElement>('#textbox-watermark')!;
watermark.addEventListener('change', () => textbox.setWatermark(watermark.checked));
const textboxState = document.querySelector<HTMLSelectElement>('#textbox-state')!;
textboxState.addEventListener('change', () => {
  const state = textboxState.value;
  if (state === 'editable' || state === 'error' || state === 'readonly' || state === 'disabled') textbox.setState(state);
});
document.querySelector('#textbox-sample')!.addEventListener('click', () => {
  textbox.setValue('Make room for the thought before deciding what it needs to become.\n\nA small space to notice, gather, and begin again.');
});

const christogenesis = createChristogenesisProgress();
document.querySelector('#christogenesis-progress')!.append(christogenesis.element);
const finishGenesis = document.querySelector<HTMLButtonElement>('#finish-christogenesis')!;
let genesisFinished = false;
finishGenesis.addEventListener('click', () => {
  genesisFinished = !genesisFinished;
  if (genesisFinished) christogenesis.finish(); else christogenesis.restart();
  finishGenesis.textContent = genesisFinished ? 'Restart loading' : 'Finish loading';
});
window.addEventListener('pagehide', () => christogenesis.dispose(), { once: true });

const angel = createAngelProgress();
document.querySelector('#angel-progress')!.append(angel.element);
const finish = document.querySelector<HTMLButtonElement>('#finish-loading')!;
let finished = false;
finish.addEventListener('click', () => {
  finished = !finished;
  if (finished) angel.finish(); else angel.restart();
  finish.textContent = finished ? 'Restart loading' : 'Finish loading';
});
window.addEventListener('pagehide', () => angel.dispose(), { once: true });

for (const stage of document.querySelectorAll<HTMLElement>('.stage')) {
  stage.append(createLoadingIndicator(stage.dataset.kind as LoadingKind));
}
document.querySelector('#context-loading')!.append(createLoadingIndicator('orbit', 'Gathering Horizons…'));

const surface = document.querySelector<HTMLSelectElement>('#surface')!;
const size = document.querySelector<HTMLSelectElement>('#size')!;
const tempo = document.querySelector<HTMLSelectElement>('#tempo')!;
const reduced = document.querySelector<HTMLInputElement>('#reduced')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
surface.addEventListener('change', () => { document.body.dataset.surface = surface.value; });
function updateIndicators() {
  for (const progress of [angel, christogenesis]) {
    progress.setSize(Number(size.value));
    progress.setTempo(Number(tempo.value));
  }
  for (const indicator of document.querySelectorAll<HTMLElement>('.loading')) {
    indicator.style.setProperty('--loading-size', `${size.value}px`);
    indicator.style.setProperty('--loading-duration', `${tempo.value}s`);
  }
}
size.addEventListener('change', updateIndicators);
tempo.addEventListener('change', updateIndicators);
reduced.addEventListener('change', () => {
  document.body.toggleAttribute('data-reduced-motion', reduced.checked);
  for (const progress of [angel, christogenesis]) progress.setReducedMotion(reduced.checked);
});
pause.addEventListener('click', () => {
  const paused = document.body.toggleAttribute('data-paused');
  for (const progress of [angel, christogenesis]) progress.setPaused(paused);
  pause.setAttribute('aria-pressed', String(paused));
  pause.textContent = paused ? 'Resume animation' : 'Pause animation';
});
const motion = matchMedia('(prefers-reduced-motion: reduce)');
function updateMotionNote() {
  document.querySelector('#motion-note')!.textContent = motion.matches
    ? 'Your system requests reduced motion. All indicators are shown without animation.'
    : 'System reduced-motion preferences are always respected.';
}
motion.addEventListener('change', updateMotionNote);
updateMotionNote();
