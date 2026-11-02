import { renderModelInspector } from './model-view.js';
import '/shared/components/audio-player/audio-player.js';
import { createContentSource, indexTree, horizonLevels } from './content.js';
import { layout, arrangements } from './engine.js';
import { presentations } from './presentations.js';
import { availableViews, defaultView, viewPanelHeight, hasFindControls, isFindActive, viewConfiguration } from './views.js';
import { createPlayback } from './playback.js';
import { initialPanelState, transitionPanels, panelToDismiss } from './panels.js';
import { createPresentationTransition, changesContentView } from './transitions.js';
import { playbackControls, presentationViews, songFor } from './presentation-views.js';
import { routeToNode, base } from './routes.js';
import { readNavigation, transitionNavigation } from './navigation.js';

const $ = selector => document.querySelector(selector);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const duration = () => reduced.matches ? 100 : 1100;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const date = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const animate = (node, frames, options = {}) => node.animate(frames, { duration: duration(), easing: 'cubic-bezier(.22,.72,.18,1)', fill: 'both', ...options });
// Keep closing content mounted until its fade completes, including interrupted toggles.
const panelAnimations = new Map();
function panelOpen(content, open) {
  if (content.dataset.open === String(open)) return;
  content.dataset.open = String(open);
  const opacity = content.hidden ? '0' : getComputedStyle(content).opacity;
  panelAnimations.get(content)?.cancel();
  content.hidden = false;
  content.inert = !open;
  const animation = animate(content, [{ opacity }, { opacity: open ? 1 : 0 }], {
    duration: reduced.matches ? 70 : open ? 260 : 140,
    delay: open && !reduced.matches ? 140 : 0,
  });
  panelAnimations.set(content, animation);
  animation.finished.then(() => {
    if (panelAnimations.get(content) !== animation) return;
    content.hidden = !open;
    animation.cancel(); panelAnimations.delete(content);
  }).catch(() => {});
}
const transform = circle => `translate(${circle.x - circle.r}px, ${circle.y - circle.r}px) scale(${circle.r / 50})`;
const saved = key => { try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; } catch { return []; } };
const persist = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be disabled; the session remains usable. */ } };

try {
  const responses = await Promise.all([fetch('/songs.json'), fetch('/catalog.json'), fetch('/model-schema.json')]);
  if (responses.some(response => !response.ok)) throw new Error('Library unavailable');
  const [songs, catalog, schema] = await Promise.all(responses.map(response => response.json()));
  const source = createContentSource(songs, catalog, schema), tree = source.getRoot(), index = indexTree(tree);
  let state = readNavigation(tree, new URL(location.href));
  let panels = initialPanelState;
  let current, detailId, focusTimer, wheelAt = 0, touchY = null;
  const mounted = new Map();
  const audio = el('seraph-audio-player');
  $('#player-content').append(audio);
  const playback = createPlayback(audio.audio, location.origin);
  const cards = new Map();
  let switchingPresentation = false;
  const presentationTransition = createPresentationTransition({
    root: document.documentElement,
    layers: [$('#circles'), $('#cards')],
    reduced,
    items: () => [
      ...[...mounted].filter(([, button]) => button.circle?.role === 'child'),
      ...[...cards].map(([key, card]) => [key, card.element]),
    ],
  });
  let disposeDetail = () => {};
  const playerToggle = $('#player-toggle'), playerContent = $('#player-content');
  let playerContentAnimation;
  function sendPanel(event) {
    const previous = panels;
    panels = transitionPanels(panels, event);
    if (panels.player !== previous.player) renderPlayer();
  }
  function renderPlayer() {
    const open = panels.player === 'open';
    const opacity = getComputedStyle(playerContent).opacity;
    playerContentAnimation?.cancel();
    playerContent.hidden = false;
    playerContent.inert = !open;
    $('#player-lens').classList.toggle('open', open);
    playerToggle.setAttribute('aria-expanded', String(open));
    playerToggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} player${playback.selection ? ` · ${playback.selection.song.title}` : ''}`);
    // Keep the mounted player alive while the shell morphs. Closing removes
    // controls from keyboard navigation immediately, then hides them after fading.
    const animation = animate(playerContent, [{ opacity }, { opacity: open ? 1 : 0 }], {
      duration: reduced.matches ? 100 : open ? 260 : 140,
      delay: open && !reduced.matches ? 240 : 0,
    });
    playerContentAnimation = animation;
    animation.finished.then(() => {
      if (playerContentAnimation !== animation) return;
      playerContent.hidden = panels.player !== 'open';
      animation.cancel();
      playerContentAnimation = null;
    }).catch(() => {});
  }
  playerToggle.addEventListener('click', () => sendPanel('togglePlayer'));
  $('#player-close').addEventListener('click', () => { sendPanel('closePlayer'); playerToggle.focus(); });
  playback.subscribe(() => {
    const selection = playback.selection;
    $('#player-title').textContent = selection ? selection.song.title : 'Nothing playing yet';
    $('#player-mix').textContent = selection ? [selection.mix.label || selection.mix.date, selection.mix.format].filter(Boolean).join(' · ') : 'Choose Play on a song or fragment to start.';
    playerToggle.textContent = playback.playing ? 'Ⅱ' : '♪';
    playerToggle.setAttribute('aria-label', `${panels.player === 'open' ? 'Close' : 'Open'} player${selection ? ` · ${selection.song.title}` : ''}`);
    $('#player-lens').classList.toggle('playing', playback.playing);
    $('#player-error').textContent = playback.error;
    if (selection) audio.setAttribute('label', `${selection.song.title} audio player`);
  });
  const lens = $('#lens'), toggle = $('#nav-toggle');
  const trailLinks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  trailLinks.classList.add('trail-links');
  trailLinks.setAttribute('aria-hidden', 'true');
  trailLinks.setAttribute('focusable', 'false');
  $('#trail').prepend(trailLinks);

  function renderConnections(scene) {
    const svg = $('#relationships'), ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attributes) => {
      const node = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      return node;
    };
    svg.replaceChildren();
    svg.style.height = `${scene.height}px`;
    svg.classList.toggle('selected', !!scene.selection);
    const defs = make('defs', {});
    for (const [id, color] of [['relationship-arrow', 'var(--hairline)'], ['relationship-active', 'var(--accent)']]) {
      const marker = make('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' });
      marker.append(make('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color })); defs.append(marker);
    }
    svg.append(defs);
    for (const edge of [...scene.connections].sort((a, b) => Number(a.active) - Number(b.active))) {
      const group = make('g', { class: `relationship${edge.active ? ' active' : ''}${edge.kind === 'path-join' ? ' derived' : ''}` });
      group.append(make('path', { d: edge.path, 'marker-end': `url(#${edge.active ? 'relationship-active' : 'relationship-arrow'})` }));
      if (edge.active) {
        const text = make('text', { x: edge.labelPosition.x, y: edge.labelPosition.y, 'text-anchor': 'middle' });
        text.textContent = edge.label; group.append(text);
      }
      svg.append(group);
    }
  }

  function renderTrailLinks(circles) {
    const trail = circles.filter(circle => circle.role === 'trail').sort((a, b) => a.order - b.order);
    const segments = trail.slice(1).map((circle, i) => {
      const previous = trail[i];
      // The visible ring has radius 49 in each orb's 100-unit SVG.
      const start = previous.x + previous.r * .98, end = circle.x - circle.r * .98;
      return `M ${start} ${circle.y} H ${end}`;
    }).join(' ');
    if (trailLinks.firstChild?.getAttribute('d') === segments) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', segments);
    trailLinks.replaceChildren(path);
    trailLinks.getAnimations().forEach(animation => animation.cancel());
    animate(trailLinks, [{ opacity: 0 }, { opacity: 1 }], { delay: reduced.matches ? 0 : 650, duration: reduced.matches ? 100 : 450 });
  }

  function sendNavigation(event, preserveControls = false) {
    const result = transitionNavigation(tree, state, event);
    if (result.state === state) return false;
    state = result.state;
    if (result.history === 'push') history.pushState(null, '', result.url);
    else if (result.history === 'replace') history.replaceState(null, '', result.url);
    if (result.resetPanels) {
      sendPanel('navigate');
      if (current?.container.id !== state.path.at(-1)) window.scrollTo(0, 0);
    }
    render(result.resetPanels, preserveControls);
    return true;
  }
  function navigate(url, push = true) {
    sendNavigation({ type: push ? 'visit' : 'restore', url: new URL(url, location.href) });
  }
  function dispatch(action) {
    if (!action) return;
    if (action.type === 'select') selectNode(action.id);
    else sendNavigation(action);
  }
  function selectNode(id) {
    if (!sendNavigation({ type: 'select', id })) return;
    if (id) {
      $('#selection h1')?.focus({ preventScroll: true });
      if (innerWidth < 900) $('#selection').scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
      mounted.get(current.container.id)?.focus({ preventScroll: true });
    }
  }
  function closeDetail() { sendNavigation({ type: 'dismiss' }); }
  function step(direction) { sendNavigation({ type: 'step', direction }); }
  function orb(circle) {
    const button = el('button', null, 'orb');
    button.type = 'button';
    button.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49"/><circle class="inner" cx="50" cy="50" r="45"/><circle class="mark" cx="50" cy="1" r="2.5"/></svg><span class="orb-label"></span>';
    button.addEventListener('click', () => dispatch(button.circle.action));
    return button;
  }
  function move(button, circle, entering) {
    const old = button.circle;
    const viewReflow = $('#view-lens').classList.contains('open') !== (panels.panel === 'view');
    const changed = entering || !old || ['x', 'y', 'r', 'labelPlacement', 'role'].some(key => old[key] !== circle[key]);
    button.circle = circle;
    button.classList.toggle('current', circle.isCurrent);
    button.classList.toggle('small', circle.role === 'child' && circle.r < 30 && circle.labelPlacement === 'inside');
    button.classList.toggle('compact', circle.role === 'child' && circle.r >= 30 && circle.r < 42);
    button.classList.toggle('unrelated', !!circle.unrelated);
    if (circle.selectable) button.setAttribute('aria-pressed', String(circle.isCurrent)); else button.removeAttribute('aria-pressed');
    button.dataset.role = circle.role;
    const node = index.get(circle.key === 'trail-detail' ? circle.action?.id : circle.key)?.node;
    button.dataset.category = node?.data?.type || node?.kind || node?.id || '';
    button.dataset.placement = circle.labelPlacement;
    button.style.setProperty('--inverse', 50 / circle.r);
    button.style.setProperty('--label-width', `${circle.labelWidth || Math.max(55, circle.r * 1.7)}px`);
    button.querySelector('.inner').style.display = circle.isContainer ? '' : 'none';
    const label = button.querySelector('.orb-label');
    label.textContent = circle.role === 'detail' ? '' : circle.label;
    button.querySelectorAll('circle:not(.mark)').forEach(ring => { ring.style.strokeWidth = String(50 / circle.r); });
    button.querySelector('.mark').setAttribute('r', String(2.5 * 50 / circle.r));
    button.setAttribute('aria-label', `${circle.label}${circle.isContainer ? ', container' : ''}`);
    if (circle.isCurrent && circle.role === 'trail') button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    button.disabled = !circle.action;
    const host = current?.circles.find(item => item.key === circle.host);
    const from = reduced.matches ? transform(circle) : entering && host ? transform({ ...host, r: 1 }) : getComputedStyle(button).transform;
    // Commit interrupted animation positions before replacing the animation.
    button.getAnimations().forEach(animation => animation.cancel());
    button.style.transform = transform(circle);
    if (changed && !switchingPresentation) animate(button, [{ transform: entering ? from || transform(circle) : from, opacity: entering ? 0 : 1 }, { transform: transform(circle), opacity: 1 }], { duration: viewReflow && !reduced.matches ? 650 : duration(), delay: entering && !reduced.matches ? 150 + Math.min(circle.order, 30) * 15 : 0 });
    label.getAnimations().forEach(animation => animation.cancel());
    if (changed && !reduced.matches && !switchingPresentation && !viewReflow) animate(label, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .65 }, { opacity: 1, offset: 1 }]);
  }
  function detailContent(node) {
    const section = $('#detail');
    disposeDetail();
    disposeDetail = () => {};
    section.replaceChildren();
    const controls = el('div', null, 'detail-controls');
    for (const [label, action, disabled, name] of [['↑', () => step('prev'), !current.detail.prev, 'Previous item'], ['×', closeDetail, false, 'Close detail'], ['↓', () => step('next'), !current.detail.next, 'Next item']]) {
      const button = el('button', label, 'text-button'); button.disabled = disabled; button.setAttribute('aria-label', name); button.addEventListener('click', action); controls.append(button);
    }
    const title = el('h1', node.label); title.tabIndex = -1;
    section.append(controls, el('p', node.kind, 'kind'), title);
    if (node.kind === 'Horizon' || node.kind === 'Policy') {
      if (node.kind === 'Horizon') {
        section.append(el('p', horizonLevels[node.data.level - 1], 'muted'));
      }
      section.append(el('p', node.data.description, 'fragment-detail-text'));
      const related = node.kind === 'Policy'
        ? (node.data.horizons || []).map(id => index.get(`horizon-${id}`)?.node).filter(Boolean)
        : source.getChildren('policies').filter(policy => policy.data.horizons?.includes(node.data.id));
      const album = node.kind === 'Policy' && index.get(`album-${node.data.album}`)?.node;
      const relatedLinks = (label, nodes) => {
        if (!nodes.length) return;
        section.append(el('h2', label));
        for (const related of nodes) {
          const link = el('a', related.label, 'file-link');
          link.href = routeToNode(tree, related.id);
          link.addEventListener('click', event => {
            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); navigate(link.href);
          });
          const paragraph = el('p'); paragraph.append(link); section.append(paragraph);
        }
      };
      relatedLinks(node.kind === 'Policy' ? 'Supports horizons' : 'Supporting policies', related);
      if (album) relatedLinks('Album', [album]);
    }
    const song = songFor(node);
    if (node.kind === 'Album track') {
      section.append(el('p', `Track ${node.data.track_number}`, 'muted'));
      if (!song) section.append(el('p', 'No song association recorded yet.', 'muted'));
      else section.append(el('p', song.title));
    }
    if (node.kind === 'Music fragment') {
      section.append(el('p', node.groupLabel, 'muted'));
      for (const [label, value] of [['Key', node.data.key], ['Tempo', node.data.bpm ? `${node.data.bpm} BPM` : ''], ['Type', node.data.sample_type], ['Role', node.data.role], ['Tags', node.data.tags?.join(', ')], ['Notes', node.data.notes], ['Memories', node.data.memories], ['Character', node.data.character], ['Material', node.data.melody_sound], ['File', node.data.file]]) {
        if (value) section.append(el('p', `${label}: ${value}`, 'fragment-detail-text'));
      }
      const controls = playbackControls(song, song.mixes[0], playback);
      section.append(controls.element);
      disposeDetail = controls.dispose;
      const link = el('a', 'Open audio file ↗', 'file-link');
      link.href = '/' + song.mixes[0].url; link.target = '_blank'; link.rel = 'noopener'; section.append(link);
    } else if (song) {
      section.append(el('p', song.created ? `Created ${date(song.created)}` : 'Creation date unknown', 'muted'));
      if (song.mixes.length) {
        const label = el('label', 'Mix version'), select = el('select');
        song.mixes.forEach((mix, i) => { const option = el('option', `${date(mix.date)} · ${mix.format}${i === 0 ? ' · Latest' : ''}`); option.value = mix.url; select.append(option); });
        label.append(select);
        const metadata = el('p', '', 'muted'), link = el('a', 'Open audio file ↗', 'file-link'), notes = el('div', '', 'notes');
        link.target = '_blank'; link.rel = 'noopener';
        if (playback.selection?.song.id === song.id) select.value = playback.selection.mix.url;
        const choose = () => {
          const mix = song.mixes.find(mix => mix.url === select.value);
          disposeDetail();
          const controls = playbackControls(song, mix, playback);
          inline.replaceChildren(controls.element);
          disposeDetail = controls.dispose;
          link.href = '/' + mix.url;
          const tempo = mix.bpm_changes?.join(' → ') || mix.bpm;
          metadata.textContent = [tempo ? `${tempo} BPM` : '', mix.key].filter(Boolean).join(' · ');
          notes.innerHTML = mix.notes || '';
        };
        const inline = el('div');
        select.addEventListener('change', choose); choose();
        section.append(label, metadata, inline, link, notes);
      } else section.append(el('p', 'No mixes yet.', 'muted'));
      if (song.notes.trim()) { const notes = el('div', '', 'notes'); notes.innerHTML = song.notes; section.append(el('h2', 'Song notes'), notes); }
    }
  }
  function renderNav() {
    const nav = current.navOrb;
    const from = getComputedStyle(lens).transform;
    lens.getAnimations().forEach(animation => animation.cancel());
    lens.style.transform = transform(nav);
    lens.style.setProperty('--inverse', 50 / nav.r);
    lens.style.setProperty('--content-width', `${Math.min(420, nav.r * 1.65)}px`);
    lens.classList.toggle('open', panels.panel === 'nav');
    animate(lens, [{ transform: reduced.matches ? transform(nav) : from }, { transform: transform(nav) }]);
    toggle.setAttribute('aria-expanded', String(panels.panel === 'nav'));
    toggle.setAttribute('aria-label', panels.panel === 'nav' ? 'Close your space' : 'Open your space');
    toggle.firstChild.textContent = panels.panel === 'nav' ? '×' : '✳';
    $('#nav-content').hidden = panels.panel !== 'nav';
  }
  const configDialog = el('dialog', null, 'view-config');
  configDialog.setAttribute('aria-labelledby', 'view-config-title');
  document.body.append(configDialog);
  configDialog.addEventListener('click', event => { if (event.target === configDialog) configDialog.close(); });
  function inspectView(option) {
    const heading = el('h2', `${option.label} · Configuration`);
    heading.id = 'view-config-title';
    const close = el('button', 'Close', 'text-button'); close.type = 'button';
    close.addEventListener('click', () => configDialog.close());
    const code = el('code', JSON.stringify(viewConfiguration(current.container, option, state), null, 2));
    const pre = el('pre'); pre.append(code);
    configDialog.replaceChildren(close, heading, el('p', 'Preset definition, grouping, sorting (in priority order), and placement. Current settings include any active arrangement override.', 'muted'), pre);
    configDialog.showModal();
  }
  function renderView(preserveControls = false) {
    const view = $('#view-lens'), button = $('#view-toggle'), content = $('#view-content');
    const options = availableViews(current.container);
    const available = !current.detail && options.length > 1;
    view.style.setProperty('--view-panel-height', `${viewPanelHeight(current.container)}px`);
    view.hidden = !available;
    view.inert = panels.panel === 'nav';
    view.classList.toggle('open', panels.panel === 'view');
    view.classList.toggle('active', current.view.id !== defaultView(current.container).id);
    button.setAttribute('aria-expanded', String(panels.panel === 'view'));
    button.setAttribute('aria-label', `${panels.panel === 'view' ? 'Close' : 'Open'} view options for ${current.container.label}`);
    button.textContent = panels.panel === 'view' ? '×' : 'View';
    panelOpen(content, panels.panel === 'view' && available);
    if (preserveControls) return;
    content.replaceChildren(el('h2', `${current.container.label} · View`));
    const presentationChoices = el('div', null, 'view-presets');
    presentationChoices.setAttribute('role', 'group');
    presentationChoices.setAttribute('aria-label', 'View presets');
    options.forEach(option => {
      const row = el('div', null, 'view-preset-row');
      const button = el('button'); button.type = 'button';
      button.append(el('span', option.label, 'preset-label'));
      if (option.description) button.append(el('small', option.description, 'preset-description'));
      button.setAttribute('aria-pressed', String(current.view.id === option.id));
      button.addEventListener('click', () => {
        sendNavigation({ type: 'setView', id: option.id });
        $('#presentation-choices [aria-pressed="true"]')?.focus({ preventScroll: true });
      });
      const inspect = el('button', '{}', 'view-config-button'); inspect.type = 'button';
      inspect.setAttribute('aria-label', `Show configuration for ${option.label}`);
      inspect.title = `Show configuration for ${option.label}`;
      inspect.setAttribute('aria-haspopup', 'dialog');
      inspect.addEventListener('click', () => inspectView(option));
      row.append(button, inspect);
      presentationChoices.append(row);
    });
    presentationChoices.id = 'presentation-choices';
    if (options.length > 1) content.append(presentationChoices);
  }
  function renderFind(preserveControls = false) {
    const find = $('#find-lens'), button = $('#find-toggle'), content = $('#find-content');
    const controls = current.view.controls || {};
    const available = !current.detail && hasFindControls(current.view);
    find.hidden = !available;
    find.inert = panels.panel === 'nav';
    find.classList.toggle('beside-view', !$('#view-lens').hidden);
    find.classList.toggle('view-open', panels.panel === 'view' && !$('#view-lens').hidden);
    find.style.setProperty('--view-panel-height', `${viewPanelHeight(current.container)}px`);
    find.classList.toggle('open', panels.panel === 'find' && available);
    const active = isFindActive(current.view, state, current.container.id);
    find.classList.toggle('active', active);
    button.setAttribute('aria-expanded', String(panels.panel === 'find' && available));
    button.setAttribute('aria-label', `${panels.panel === 'find' ? 'Close' : 'Open'} Find for ${current.container.label}${active ? ' · Search or custom sort active' : ''}`);
    button.textContent = panels.panel === 'find' ? '×' : 'Find';
    panelOpen(content, panels.panel === 'find' && available);
    if (preserveControls) {
      if ($('#find-count')) $('#find-count').textContent = `${current.count} of ${current.container.children.length} items`;
      return;
    }
    content.replaceChildren(el('h2', `${current.container.label} · Find`, 'sr-only'));
    if (controls.arrangements?.length > 1) {
      const label = el('label', null, 'find-sort');
      label.append(el('span', 'Sort', 'sr-only'));
      const select = el('select'); select.id = 'find-sort';
      for (const id of controls.arrangements) {
        const option = el('option', presentations[current.presentation].arrangementLabels?.[id] || arrangements[id].label);
        option.value = id; select.append(option);
      }
      select.value = current.active;
      select.addEventListener('change', () => {
        sendNavigation({ type: 'setArrangement', id: select.value }); $('#find-sort')?.focus({ preventScroll: true });
      });
      label.append(select); content.append(label);
    }
    if (controls.search) {
      const label = el('label', null, 'find-search');
      label.append(el('span', current.presentation === 'samples' ? 'Search fragments' : 'Search titles', 'sr-only'));
      const input = el('input'); input.type = 'search'; input.value = state.filter || ''; input.placeholder = current.presentation === 'samples' ? 'Title, key, tags, notes…' : 'Type a title…';
      input.addEventListener('input', () => {
        sendNavigation({ type: 'setFilter', value: input.value }, true);
      });
      label.append(input); content.insertBefore(label, content.querySelector('.find-sort'));
    }
    const count = el('p', `${current.count} of ${current.container.children.length} items`, 'muted');
    count.id = 'find-count'; count.setAttribute('role', 'status'); content.append(count);

  }
  function render(focus, preserveNavControls = false) {
    const next = layout(tree, { ...state, panel: panels.panel }, { width: innerWidth, height: innerHeight, scrollY: window.scrollY });
    presentationTransition.cancel();
    const switching = changesContentView(current, next);
    if (switching) {
      presentationTransition.run(() => {
        switchingPresentation = true;
        try { renderScene(next, focus, preserveNavControls); }
        finally { switchingPresentation = false; }
      });
    } else renderScene(next, focus, preserveNavControls);
  }
  function renderScene(next, focus, preserveNavControls) {
    $('#world').classList.toggle('has-selection-map', !!next.container.selection);
    $('#world').style.minHeight = `${next.height}px`;
    $('#world').classList.toggle('nav-open', panels.panel === 'nav');
    document.body.classList.toggle('nav-open', panels.panel === 'nav');
    for (const node of document.querySelectorAll('.masthead, #circles, #cards, #detail, #selection, #player-lens, footer')) node.inert = panels.panel === 'nav';
    const visible = next.circles.filter(circle => circle.visible !== false);
    $('#circles').querySelectorAll('.orb-group-heading').forEach(heading => heading.remove());
    for (const group of next.groups) {
      const heading = el('h2', group.label, 'orb-group-heading');
      Object.assign(heading.style, { left: `${group.x}px`, top: `${group.y}px`, width: `${group.width}px` });
      $('#circles').append(heading);
    }
    renderTrailLinks(visible);
    for (const [key, button] of mounted) if (!visible.some(circle => circle.key === key)) {
      mounted.delete(key);
      if (switchingPresentation) { button.remove(); continue; }
      const from = getComputedStyle(button).transform;
      button.getAnimations().forEach(animation => animation.cancel());
      const host = next.circles.find(circle => circle.key === button.circle.host);
      const animation = animate(button, [{ transform: from, opacity: 1 }, { transform: !reduced.matches && host ? transform({ ...host, r: 1 }) : from, opacity: 0 }], { duration: reduced.matches ? 100 : 300 });
      button.disabled = true; animation.finished.then(() => button.remove()).catch(() => button.remove());
    }
    visible.sort((a, b) => a.order - b.order).forEach(circle => {
      let button = mounted.get(circle.key); const entering = !button;
      if (!button) { button = orb(circle); mounted.set(circle.key, button); }
      (circle.role === 'trail' ? $('#trail') : $('#circles')).append(button);
      move(button, circle, entering);
    });
    const wanted = new Set(next.items.map(item => item.key));
    for (const [key, card] of cards) if (!wanted.has(key)) {
      card.dispose(); cards.delete(key);
      if (switchingPresentation) { card.element.remove(); continue; }
      card.element.inert = true;
      const animation = animate(card.element, [{ opacity: getComputedStyle(card.element).opacity }, { opacity: 0 }], { duration: reduced.matches ? 70 : 180 });
      animation.finished.then(() => card.element.remove()).catch(() => card.element.remove());
    }
    for (const item of next.items) {
      let card = cards.get(item.key);
      const entering = !card;
      if (!card) {
        const open = () => dispatch(item.action);
        card = presentationViews[item.presentation](item.node, { playback, open });
        cards.set(item.key, card);
      }
      Object.assign(card.element.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
      // Reinserting a mounted element interrupts its CSS geometry transition.
      if (switchingPresentation || card.element.parentElement !== $('#cards')) $('#cards').append(card.element);
      if (entering && !switchingPresentation) animate(card.element, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced.matches ? 70 : 300 });
    }
    current = next;
    renderConnections(next);
    const inspector = $('#selection');
    inspector.hidden = !next.container.selection;
    if (!inspector.hidden) {
      if (inspector.dataset.subject !== (next.selection || next.container.id)) {
        renderModelInspector(inspector, next.container, index.get(next.selection)?.node, { select: selectNode, close: () => selectNode(null) });
        inspector.dataset.subject = next.selection || next.container.id;
        inspector.scrollTop = 0;
      }
      inspector.style.top = `${innerWidth < 900 ? next.height - 70 : 160}px`;
      if (innerWidth < 900) $('#world').style.minHeight = `${next.height + inspector.offsetHeight}px`;
    }
    const section = $('#detail');
    if (current.detail) {
      const { x, y, r, id } = current.detail;
      section.hidden = false;
      Object.assign(section.style, { left: `${x - r * .76}px`, top: `${y - r * .72}px`, width: `${r * 1.52}px`, height: `${r * 1.44}px` });
      if (detailId !== id) {
        detailContent(index.get(id).node);
        animate(section, [{ opacity: 0 }, { opacity: 1 }], { delay: reduced.matches ? 0 : 650, duration: 300 });
      }
      detailId = id;
    } else { section.hidden = true; if (detailId) disposeDetail(); detailId = null; }
    const subject = index.get(current.selection || state.detail || current.container.id).node;
    $('#hint').textContent = current.container.selection ? `${current.count} types · Select to explore relationships` : current.detail ? 'Scroll to move through items' : `${current.count} ${current.count === 1 ? 'item' : 'items'} · Open to explore`;
    document.title = `${subject.label} · Orb · ${document.documentElement.dataset.siteName || 'Internal'}`;
    $('#announcement').textContent = `${subject.label}${state.detail ? '' : `, ${current.count} ${current.count === 1 ? 'item' : 'items'}`}`;
    const recents = [subject.id, ...saved('orb-recents').filter(id => id !== subject.id)].slice(0, 12); persist('orb-recents', recents);
    renderNav();
    renderView(preserveNavControls);
    renderFind(preserveNavControls);
    if (switchingPresentation && panels.panel === 'view') $('#presentation-choices [aria-pressed="true"]')?.focus({ preventScroll: true });
    clearTimeout(focusTimer);
    if (focus && !current.selection) focusTimer = setTimeout(() => (state.detail ? $('#detail h1') : mounted.get(current.container.id))?.focus({ preventScroll: true }), duration() + 100);
  }
  toggle.addEventListener('click', () => { sendPanel('toggleNav'); render(false); toggle.focus({ preventScroll: true }); });
  $('#view-toggle').addEventListener('click', () => { sendPanel('toggleView'); render(false); $('#view-toggle').focus({ preventScroll: true }); });
  $('#find-toggle').addEventListener('click', () => {
    sendPanel('toggleFind');
    render(false);
    (panels.panel === 'find' ? ($('#find-content input') || $('#find-content select')) : $('#find-toggle'))?.focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', event => {
    if (panels.panel !== 'find' || event.target.closest('#find-lens')) return;
    sendPanel('outsideFind'); renderFind();
  });
  $('#home-link').addEventListener('click', event => { event.preventDefault(); navigate(base); });
  $('#world').addEventListener('click', event => { if (state.detail && (event.target === $('#world') || event.target === $('#circles'))) closeDetail(); });
  $('#world').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const dismissed = panelToDismiss(panels);
      if (dismissed) {
        sendPanel('escape');
        if (dismissed === 'find') renderFind();
        else if (dismissed !== 'player') render(false);
        $({ find: '#find-toggle', player: '#player-toggle', nav: '#nav-toggle', view: '#view-toggle' }[dismissed]).focus({ preventScroll: true });
        event.preventDefault();
        return;
      }
      if (state.status === 'detail') closeDetail();
      else if (state.status === 'selection') selectNode(null);
    }
    if (event.target.closest('#player-lens,select,input,textarea,seraph-audio-player') || event.target.isContentEditable) return;
    if (panels.panel !== 'nav' && state.detail && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); step(event.key === 'ArrowDown' ? 'next' : 'prev'); }
  });
  const canScroll = (target, delta) => {
    const section = target.closest('#detail');
    return section && (delta > 0 ? section.scrollTop + section.clientHeight < section.scrollHeight - 2 : section.scrollTop > 0);
  };
  $('#world').addEventListener('wheel', event => {
    if (!state.detail || panels.panel === 'nav' || event.target.closest('#player-lens,select,seraph-audio-player') || canScroll(event.target, event.deltaY)) return;
    event.preventDefault();
    if (Math.abs(event.deltaY) < 15 || Date.now() - wheelAt < duration()) return;
    wheelAt = Date.now(); step(event.deltaY > 0 ? 'next' : 'prev');
  }, { passive: false });
  $('#world').addEventListener('touchstart', event => { touchY = event.touches[0].clientY; }, { passive: true });
  $('#world').addEventListener('touchend', event => {
    if (touchY == null || !state.detail || panels.panel === 'nav') return;
    const delta = touchY - event.changedTouches[0].clientY; touchY = null;
    if (Math.abs(delta) > 60 && !event.target.closest('#detail,#player-lens,select,seraph-audio-player')) step(delta > 0 ? 'next' : 'prev');
  }, { passive: true });
  new ResizeObserver(() => {
    if (current?.container.selection && innerWidth < 900) $('#world').style.minHeight = `${current.height + $('#selection').offsetHeight + 100}px`;
  }).observe($('#selection'));
  window.addEventListener('popstate', () => navigate(location.href, false));
  let resizeFrame;
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => render(false)); });
  render(false);
  if (state.invalid) $('#announcement').textContent = 'Location not found. Showing Home.';
} catch (error) {
  $('#error').hidden = false; $('#error').textContent = 'Unable to load your library. Refresh to try again.';
  $('#announcement').textContent = $('#error').textContent;
  console.error(error);
}
