import { renderModelInspector } from './model-view.js';
import '/shared/components/audio-player/audio-player.js';
import { createContentSource, indexTree } from './content.js';
import { layout, arrangements } from './engine.js';
import { availablePresentations, presentations } from './presentations.js';
import { createPlayback } from './playback.js';
import { createPresentationTransition } from './transitions.js';
import { playbackControls, presentationViews, songFor } from './presentation-views.js';
import { readRoute, routeFor, base } from './routes.js';

const $ = selector => document.querySelector(selector);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const duration = () => reduced.matches ? 100 : 1100;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const date = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const animate = (node, frames, options = {}) => node.animate(frames, { duration: duration(), easing: 'cubic-bezier(.22,.72,.18,1)', fill: 'both', ...options });
const transform = circle => `translate(${circle.x - circle.r}px, ${circle.y - circle.r}px) scale(${circle.r / 50})`;
const saved = key => { try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; } catch { return []; } };
const persist = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be disabled; the session remains usable. */ } };

try {
  const responses = await Promise.all([fetch('/songs.json'), fetch('/catalog.json'), fetch('/model-schema.json')]);
  if (responses.some(response => !response.ok)) throw new Error('Library unavailable');
  const [songs, catalog, schema] = await Promise.all(responses.map(response => response.json()));
  const source = createContentSource(songs, catalog, schema), tree = source.getRoot(), index = indexTree(tree);
  let state = { ...readRoute(tree, new URL(location.href)), navOpen: false, viewOpen: false };
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
  let playerExpanded = false, playerContentAnimation;
  function playerOpen(open) {
    if (open === playerExpanded) return;
    playerExpanded = open;
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
      playerContent.hidden = !playerExpanded;
      animation.cancel();
      playerContentAnimation = null;
    }).catch(() => {});
  }
  playerToggle.addEventListener('click', () => playerOpen(!playerExpanded));
  $('#player-close').addEventListener('click', () => { playerOpen(false); playerToggle.focus(); });
  playback.subscribe(() => {
    const selection = playback.selection;
    $('#player-title').textContent = selection ? selection.song.title : 'Nothing playing yet';
    $('#player-mix').textContent = selection ? `${selection.mix.date} · ${selection.mix.format}` : 'Choose Play on a song to start.';
    playerToggle.textContent = playback.playing ? 'Ⅱ' : '♪';
    playerToggle.setAttribute('aria-label', `${playerExpanded ? 'Close' : 'Open'} player${selection ? ` · ${selection.song.title}` : ''}`);
    $('#player-lens').classList.toggle('playing', playback.playing);
    $('#player-error').textContent = playback.error;
    if (selection) audio.setAttribute('label', `${selection.song.title} audio player`);
  });
  const urlFor = (path, detail, arrangement, filter = '') => routeFor(path, detail, arrangement, filter, state.presentation?.[path.at(-1)] || 'orb', path.join('/') === state.path.join('/') ? state.selection : null);
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

  function navigate(url, push = true) {
    if (push) history.pushState(null, '', url);
    const route = readRoute(tree, new URL(url, location.href));
    state = { ...state, ...route, presentation: { ...state.presentation, ...route.presentation }, arrangement: { ...state.arrangement, ...route.arrangement } };
    // The query is authoritative for the current container, including Back to its default.
    if (!new URL(url, location.href).searchParams.has('arrange')) delete state.arrangement[state.path.at(-1)];
    state.navOpen = false;
    state.viewOpen = false;
    if (current?.container.id !== route.path.at(-1)) window.scrollTo(0, 0);
    render(true);
  }
  function dispatch(action) {
    if (!action) return;
    if (action.type === 'select') { selectNode(action.id); return; }
    const path = action.type === 'navigate' ? action.path : state.path;
    navigate(routeFor(path, action.type === 'openDetail' ? action.id : null, state.arrangement[path.at(-1)], path.join('/') === state.path.join('/') ? state.filter : '', state.presentation?.[path.at(-1)] || 'orb'));
  }
  function selectNode(id) {
    const url = routeFor(state.path, null, state.arrangement[state.path.at(-1)], state.filter, current.presentation, id);
    navigate(url);
    if (id) {
      $('#selection h1')?.focus({ preventScroll: true });
      if (innerWidth < 900) $('#selection').scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
      mounted.get(current.container.id)?.focus({ preventScroll: true });
    }
  }
  function closeDetail() { navigate(urlFor(state.path, null, state.arrangement[state.path.at(-1)], state.filter)); }
  function step(direction) {
    const id = current.detail?.[direction];
    if (id) dispatch({ type: 'openDetail', id });
  }
  function orb(circle) {
    const button = el('button', null, 'orb');
    button.type = 'button';
    button.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49"/><circle class="inner" cx="50" cy="50" r="45"/><circle class="mark" cx="50" cy="1" r="2.5"/></svg><span class="orb-label"></span>';
    button.addEventListener('click', () => dispatch(button.circle.action));
    return button;
  }
  function move(button, circle, entering) {
    const old = button.circle;
    const changed = entering || !old || ['x', 'y', 'r', 'labelPlacement', 'role'].some(key => old[key] !== circle[key]);
    button.circle = circle;
    button.classList.toggle('current', circle.isCurrent);
    button.classList.toggle('small', circle.role === 'child' && circle.r < 30 && circle.labelPlacement === 'inside');
    button.classList.toggle('compact', circle.role === 'child' && circle.r >= 30 && circle.r < 42);
    button.classList.toggle('unrelated', !!circle.unrelated);
    if (circle.selectable) button.setAttribute('aria-pressed', String(circle.isCurrent)); else button.removeAttribute('aria-pressed');
    button.dataset.role = circle.role;
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
    if (changed && !switchingPresentation) animate(button, [{ transform: entering ? from || transform(circle) : from, opacity: entering ? 0 : 1 }, { transform: transform(circle), opacity: 1 }], { delay: entering && !reduced.matches ? 150 + Math.min(circle.order, 30) * 15 : 0 });
    label.getAnimations().forEach(animation => animation.cancel());
    if (changed && !reduced.matches && !switchingPresentation) animate(label, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .65 }, { opacity: 1, offset: 1 }]);
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
    const song = songFor(node);
    if (node.kind === 'Album track') {
      section.append(el('p', `Track ${node.data.track_number}`, 'muted'));
      if (!song) section.append(el('p', 'No song association recorded yet.', 'muted'));
      else section.append(el('p', song.title));
    }
    if (song) {
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
    lens.classList.toggle('open', state.navOpen);
    animate(lens, [{ transform: reduced.matches ? transform(nav) : from }, { transform: transform(nav) }]);
    toggle.setAttribute('aria-expanded', String(state.navOpen));
    toggle.setAttribute('aria-label', state.navOpen ? 'Close your space' : 'Open your space');
    toggle.firstChild.textContent = state.navOpen ? '×' : '✳';
    $('#nav-content').hidden = !state.navOpen;
  }
  function renderView(preserveControls = false) {
    const view = $('#view-lens'), button = $('#view-toggle'), content = $('#view-content');
    const available = !current.detail && (current.container.children.length > 1 || availablePresentations(current.container).length > 1);
    view.hidden = !available;
    view.inert = state.navOpen;
    view.classList.toggle('open', state.viewOpen);
    view.classList.toggle('active', current.active !== (current.container.arrangements?.[0] || 'free') || current.presentation !== 'orb' || !!state.filter);
    button.setAttribute('aria-expanded', String(state.viewOpen));
    button.setAttribute('aria-label', `${state.viewOpen ? 'Close' : 'Open'} view options for ${current.container.label}`);
    button.textContent = state.viewOpen ? '×' : 'View';
    content.hidden = !state.viewOpen;
    if (preserveControls) {
      $('#view-count').textContent = `${current.count} of ${current.container.children.length} items`;
      return;
    }
    content.replaceChildren(el('h2', `${current.container.label} · View`));
    const presentationChoices = el('div', null, 'arrangements');
    presentationChoices.setAttribute('role', 'group');
    presentationChoices.setAttribute('aria-label', 'Item presentation');
    availablePresentations(current.container).forEach(id => {
      const button = el('button', presentations[id].label);
      button.setAttribute('aria-pressed', String(current.presentation === id));
      button.addEventListener('click', () => {
        state.presentation = { ...state.presentation, [current.container.id]: id };
        history.pushState(null, '', urlFor(state.path, state.detail, state.arrangement[current.container.id], state.filter));
        render(false);

      });
      presentationChoices.append(button);
    });
    presentationChoices.id = 'presentation-choices';
    if (availablePresentations(current.container).length > 1) content.append(presentationChoices);
    const choices = el('div', null, 'arrangements arrangement-choices');
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Arrangement');
    (current.container.arrangements || ['free']).forEach(id => {
      const button = el('button', presentations[current.presentation].arrangementLabels?.[id] || arrangements[id].label);
      button.setAttribute('aria-pressed', String(current.active === id));
      button.addEventListener('click', () => {
        state.arrangement[current.container.id] = id;
        history.pushState(null, '', urlFor(state.path, state.detail, id, state.filter));
        render(false);
        $('#view-content .arrangement-choices [aria-pressed="true"]')?.focus({ preventScroll: true });
      }); choices.append(button);
    }); content.append(choices);
    const label = el('label', 'Filter titles', 'filter-label');
    const input = el('input'); input.type = 'search'; input.value = state.filter || ''; input.placeholder = 'Type a title…';
    input.addEventListener('input', () => {
      state.filter = input.value; state.detail = null;
      history.replaceState(null, '', urlFor(state.path, null, state.arrangement[state.path.at(-1)], state.filter));
      render(false, true);
    });
    label.append(input); content.append(label);
    const count = el('p', `${current.count} of ${current.container.children.length} items`, 'muted');
    count.id = 'view-count'; count.setAttribute('role', 'status'); content.append(count);

  }
  function render(focus, preserveNavControls = false) {
    const next = layout(tree, state, { width: innerWidth, height: innerHeight, scrollY: window.scrollY });
    presentationTransition.cancel();
    const switching = current && !current.detail && !next.detail && current.container.id === next.container.id && current.presentation !== next.presentation;
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
    $('#world').classList.toggle('nav-open', state.navOpen);
    document.body.classList.toggle('nav-open', state.navOpen);
    for (const node of document.querySelectorAll('.masthead, #circles, #cards, #detail, #selection, #player-lens, footer')) node.inert = state.navOpen;
    const visible = next.circles.filter(circle => circle.visible !== false);
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
    for (const [key, card] of cards) if (!wanted.has(key)) { card.dispose(); card.element.remove(); cards.delete(key); }
    for (const item of next.items) {
      let card = cards.get(item.key);
      if (!card) {
        const open = () => dispatch(item.action);
        card = presentationViews[item.presentation](item.node, { playback, open });
        cards.set(item.key, card);
      }
      Object.assign(card.element.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
      $('#cards').append(card.element);
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
    document.title = `${subject.label} · Orb · Internal`;
    $('#announcement').textContent = `${subject.label}${state.detail ? '' : `, ${current.count} ${current.count === 1 ? 'item' : 'items'}`}`;
    const recents = [subject.id, ...saved('orb-recents').filter(id => id !== subject.id)].slice(0, 12); persist('orb-recents', recents);
    renderNav();
    renderView(preserveNavControls);
    if (switchingPresentation && state.viewOpen) $('#presentation-choices [aria-pressed="true"]')?.focus({ preventScroll: true });
    clearTimeout(focusTimer);
    if (focus && !current.selection) focusTimer = setTimeout(() => (state.detail ? $('#detail h1') : mounted.get(current.container.id))?.focus({ preventScroll: true }), duration() + 100);
  }
  toggle.addEventListener('click', () => { state.navOpen = !state.navOpen; playerOpen(false); state.viewOpen = false; render(false); toggle.focus({ preventScroll: true }); });
  $('#view-toggle').addEventListener('click', () => { state.viewOpen = !state.viewOpen; render(false); $('#view-toggle').focus({ preventScroll: true }); });
  $('#home-link').addEventListener('click', event => { event.preventDefault(); navigate(base); });
  $('#world').addEventListener('click', event => { if (state.detail && (event.target === $('#world') || event.target === $('#circles'))) closeDetail(); });
  $('#world').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (playerExpanded) { playerOpen(false); playerToggle.focus(); return; }
      if (state.navOpen) { state.navOpen = false; render(false); toggle.focus(); }
      else if (state.viewOpen) { state.viewOpen = false; render(false); $('#view-toggle').focus({ preventScroll: true }); }
      else if (state.detail) closeDetail();
      else if (current.selection) selectNode(null);
    }
    if (event.target.closest('#player-lens,select,input,textarea,seraph-audio-player') || event.target.isContentEditable) return;
    if (!state.navOpen && state.detail && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); step(event.key === 'ArrowDown' ? 'next' : 'prev'); }
  });
  const canScroll = (target, delta) => {
    const section = target.closest('#detail');
    return section && (delta > 0 ? section.scrollTop + section.clientHeight < section.scrollHeight - 2 : section.scrollTop > 0);
  };
  $('#world').addEventListener('wheel', event => {
    if (!state.detail || state.navOpen || event.target.closest('#player-lens,select,seraph-audio-player') || canScroll(event.target, event.deltaY)) return;
    event.preventDefault();
    if (Math.abs(event.deltaY) < 15 || Date.now() - wheelAt < duration()) return;
    wheelAt = Date.now(); step(event.deltaY > 0 ? 'next' : 'prev');
  }, { passive: false });
  $('#world').addEventListener('touchstart', event => { touchY = event.touches[0].clientY; }, { passive: true });
  $('#world').addEventListener('touchend', event => {
    if (touchY == null || !state.detail || state.navOpen) return;
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
  $('#error').hidden = false; $('#error').textContent = 'Unable to load your library. Rebuild the Internal app and refresh to try again.';
  $('#announcement').textContent = $('#error').textContent;
  console.error(error);
}
