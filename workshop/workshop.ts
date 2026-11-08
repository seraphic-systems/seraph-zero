import { createVisualControls } from './visual-controls.ts';
import { mountStudy, selectControl, studies, type Study, type StudyId, type StudyValues } from './studies.ts';

const query = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const gallery = query<HTMLElement>('#gallery');
const workbench = query<HTMLElement>('#workbench');
const canvases = query<HTMLElement>('#canvases');
const compareButton = query<HTMLButtonElement>('#compare');
const reduced = query<HTMLInputElement>('#reduced');
const pause = query<HTMLButtonElement>('#pause');
let comparing = false;
let comparisonStarted = false;
let paused = false;
let active: StudyId | undefined;

// Each canvas keeps its own settings and writing while moving between studies.
function createCanvas(name: string, initial: StudyId) {
  const element = document.createElement('section');
  element.className = 'canvas-panel';
  element.setAttribute('aria-label', `Canvas ${name}`);
  const header = document.createElement('div');
  header.className = 'canvas-header';
  const badge = document.createElement('span');
  badge.className = 'canvas-badge';
  badge.textContent = name;
  const selection = selectControl(`Study ${name}`, studies.map(study => [study.id, study.title]), initial, value => {
    const study = studies.find(study => study.id === value);
    if (!study) return;
    if (name === 'A') location.hash = study.id;
    else show(study.id);
  });
  header.append(badge, selection);
  const environment = document.createElement('div');
  environment.className = 'canvas-environment';
  const viewport = document.createElement('div');
  viewport.className = 'canvas-viewport';
  const surface = document.createElement('div');
  surface.className = 'canvas-surface';
  surface.dataset.surface = 'light';
  const stage = document.createElement('div');
  stage.className = 'canvas-stage';
  surface.append(stage);
  viewport.append(surface);
  environment.append(
    selectControl(`Surface ${name}`, [['light', 'Light'], ['dark', 'Dark']], 'light', value => { surface.dataset.surface = value; }),
    selectControl(`Width ${name}`, [['fluid', 'Fill canvas'], ['360', 'Narrow · 360'], ['720', 'Wide · 720']], 'fluid', value => {
      surface.style.maxWidth = value === 'fluid' ? 'none' : `${value}px`;
    }),
  );
  const settings = document.createElement('div');
  settings.className = 'canvas-settings';
  const memory = new Map<StudyId, StudyValues>();
  let current: Study | undefined;
  const visuals = createVisualControls(surface, name, scale => current?.setTiming(scale));
  element.append(header, environment, visuals.element, viewport, settings);
  let currentId = initial;
  function show(id: StudyId) {
    current?.dispose();
    currentId = id;
    if (!memory.has(id)) memory.set(id, {});
    current = mountStudy(id, memory.get(id)!);
    current.setMotion(paused, reduced.checked);
    current.setTiming(visuals.timing);
    stage.replaceChildren(current.element);
    settings.replaceChildren(current.controls, current.feedback);
    selection.querySelector('select')!.value = id;
  }
  return {
    element,
    show,
    syncMotion() { current?.setMotion(paused, reduced.checked); },
    suspend() { current?.dispose(); current = undefined; },
    resume() { if (!current) show(currentId); },
  };
}
const left = createCanvas('A', 'composition');
const right = createCanvas('B', 'composition');
right.element.hidden = true;
canvases.append(left.element, right.element);

for (const study of studies) {
  const link = document.createElement('a');
  link.href = `#${study.id}`;
  link.dataset.study = study.id;
  const title = document.createElement('span');
  title.textContent = study.title;
  const category = document.createElement('small');
  category.textContent = study.category;
  link.append(title, category);
  query('#study-links').append(link);
  const card = document.createElement('a');
  card.className = `study-card study-card--${study.id}`;
  card.href = link.href;
  const mark = document.createElement('span');
  mark.className = 'study-card__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = study.mark;
  const kind = document.createElement('p');
  kind.className = 'eyebrow';
  kind.textContent = study.category;
  const heading = document.createElement('h2');
  heading.textContent = study.title;
  const description = document.createElement('p');
  description.textContent = study.description;
  card.append(mark, kind, heading, description);
  query('#study-gallery').append(card);
}
function navigate() {
  const id = location.hash.slice(1);
  const study = studies.find(study => study.id === id);
  gallery.hidden = !!study;
  workbench.hidden = !study;
  for (const link of document.querySelectorAll<HTMLElement>('[data-study]')) {
    if (link.dataset.study === study?.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (!study) {
    left.suspend(); right.suspend(); active = undefined;
    document.title = 'Workshop · Seraphic Systems';
    return;
  }
  if (active !== study.id) left.show(study.id);
  left.resume();
  active = study.id;
  if (comparing) right.resume();
  query('#workbench-title').textContent = study.title;
  query('#study-question').textContent = study.question;
  document.title = `${study.title} · Workshop`;
  if (document.activeElement instanceof HTMLAnchorElement && document.activeElement.hash === `#${study.id}`) {
    query<HTMLElement>('#workbench-title').focus();
  }
}
compareButton.addEventListener('click', () => {
  comparing = !comparing;
  right.element.hidden = !comparing;
  canvases.classList.toggle('is-comparing', comparing);
  compareButton.setAttribute('aria-pressed', String(comparing));
  compareButton.textContent = comparing ? 'Return to one canvas' : 'Compare side by side';
  if (comparing) {
    if (!comparisonStarted) right.show(active ?? 'composition');
    else right.resume();
    comparisonStarted = true;
  } else right.suspend();
});
query<HTMLAnchorElement>('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  query<HTMLElement>('#workspace').focus();
});
reduced.addEventListener('change', () => {
  workbench.toggleAttribute('data-reduced-motion', reduced.checked);
  if (reduced.checked) for (const animation of scriptAnimations()) animation.cancel();
  left.syncMotion(); right.syncMotion();
});
function scriptAnimations() {
  return workbench.getAnimations({ subtree: true }).filter(animation => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition));
}
workbench.addEventListener('click', () => {
  if (paused) for (const animation of scriptAnimations()) animation.pause();
});
pause.addEventListener('click', () => {
  paused = !paused;
  workbench.toggleAttribute('data-paused', paused);
  // Script-driven button pulses also need pausing, including newly started pulses.
  for (const animation of scriptAnimations()) {
    if (paused) animation.pause(); else animation.play();
  }
  left.syncMotion(); right.syncMotion();
  pause.setAttribute('aria-pressed', String(paused));
  pause.textContent = paused ? 'Resume animation' : 'Pause animation';
});
const motion = matchMedia('(prefers-reduced-motion: reduce)');
function updateMotionNote() {
  if (motion.matches) for (const animation of scriptAnimations()) animation.cancel();
  query('#motion-note').textContent = motion.matches ? 'System reduced motion is on. Animation stays still.' : 'System motion preferences are respected.';
}
motion.addEventListener('change', updateMotionNote);
window.addEventListener('hashchange', navigate);
// Suspend animation loops while the page is in the back-forward cache.
window.addEventListener('pagehide', () => { left.suspend(); right.suspend(); });
window.addEventListener('pageshow', navigate);
updateMotionNote();
navigate();
