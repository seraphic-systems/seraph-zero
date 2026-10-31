import '/shared/components/audio-player/audio-player.js';
import { createContentSource, indexTree } from './content.js';
import { layout } from './engine.js';
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
  const responses = await Promise.all([fetch('/songs.json'), fetch('/catalog.json')]);
  if (responses.some(response => !response.ok)) throw new Error('Library unavailable');
  const [songs, catalog] = await Promise.all(responses.map(response => response.json()));
  const source = createContentSource(songs, catalog), tree = source.getRoot(), index = indexTree(tree);
  let state = { ...readRoute(tree, new URL(location.href)), navOpen: false };
  let current, detailId, focusTimer, wheelAt = 0, touchY = null;
  const mounted = new Map();
  const audio = el('seraph-audio-player');
  const lens = $('#lens'), toggle = $('#nav-toggle');
  const trailLinks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  trailLinks.classList.add('trail-links');
  trailLinks.setAttribute('aria-hidden', 'true');
  trailLinks.setAttribute('focusable', 'false');
  $('#trail').prepend(trailLinks);

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
    state = { ...state, ...route, arrangement: { ...state.arrangement, ...route.arrangement } };
    // The query is authoritative for the current container, including Back to its default.
    if (!new URL(url, location.href).searchParams.has('arrange')) delete state.arrangement[state.path.at(-1)];
    state.navOpen = false;
    window.scrollTo(0, 0);
    render(true);
  }
  function dispatch(action) {
    if (!action) return;
    const path = action.type === 'navigate' ? action.path : state.path;
    navigate(routeFor(path, action.type === 'openDetail' ? action.id : null, state.arrangement[path.at(-1)], path.join('/') === state.path.join('/') ? state.filter : ''));
  }
  function closeDetail() { navigate(routeFor(state.path, null, state.arrangement[state.path.at(-1)], state.filter)); }
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
    button.dataset.role = circle.role;
    button.dataset.placement = circle.labelPlacement;
    button.style.setProperty('--inverse', 50 / circle.r);
    button.style.setProperty('--label-width', `${circle.labelWidth || Math.max(55, circle.r * 1.7)}px`);
    button.querySelector('.inner').style.display = circle.isContainer ? '' : 'none';
    const label = button.querySelector('.orb-label');
    label.textContent = circle.role === 'detail' && !state.navOpen ? '' : circle.label;
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
    if (changed) animate(button, [{ transform: entering ? from || transform(circle) : from, opacity: entering ? 0 : 1 }, { transform: transform(circle), opacity: 1 }], { delay: entering && !reduced.matches ? 150 + Math.min(circle.order, 30) * 15 : 0 });
    label.getAnimations().forEach(animation => animation.cancel());
    if (changed && !reduced.matches) animate(label, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .65 }, { opacity: 1, offset: 1 }]);
  }
  function detailContent(node) {
    const section = $('#detail');
    section.replaceChildren();
    const controls = el('div', null, 'detail-controls');
    for (const [label, action, disabled, name] of [['↑', () => step('prev'), !current.detail.prev, 'Previous item'], ['×', closeDetail, false, 'Close detail'], ['↓', () => step('next'), !current.detail.next, 'Next item']]) {
      const button = el('button', label, 'text-button'); button.disabled = disabled; button.setAttribute('aria-label', name); button.addEventListener('click', action); controls.append(button);
    }
    const title = el('h1', node.label); title.tabIndex = -1;
    section.append(controls, el('p', node.kind, 'kind'), title);
    const song = node.kind === 'Song' ? node.data : node.data?.song;
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
        const choose = () => {
          const mix = song.mixes.find(mix => mix.url === select.value);
          audio.src = new URL('/' + mix.url, location.origin).href;
          audio.setAttribute('label', `${song.title} audio player`);
          link.href = '/' + mix.url;
          const tempo = mix.bpm_changes?.join(' → ') || mix.bpm;
          metadata.textContent = [tempo ? `${tempo} BPM` : '', mix.key].filter(Boolean).join(' · ');
          notes.innerHTML = mix.notes || '';
        };
        select.addEventListener('change', choose); choose();
        section.append(label, metadata, audio, link, notes);
      } else section.append(el('p', 'No mixes yet.', 'muted'));
      if (song.notes.trim()) { const notes = el('div', '', 'notes'); notes.innerHTML = song.notes; section.append(el('h2', 'Song notes'), notes); }
    }
  }
  function renderNav(preserveControls = false) {
    const nav = current.navOrb;
    const from = getComputedStyle(lens).transform;
    lens.getAnimations().forEach(animation => animation.cancel());
    lens.style.transform = transform(nav);
    lens.style.setProperty('--inverse', 50 / nav.r);
    lens.style.setProperty('--content-width', `${nav.r * 1.65}px`);
    lens.classList.toggle('open', state.navOpen);
    animate(lens, [{ transform: reduced.matches ? transform(nav) : from }, { transform: transform(nav) }]);
    toggle.setAttribute('aria-expanded', String(state.navOpen));
    toggle.setAttribute('aria-label', state.navOpen ? 'Close sort and filter' : 'Open sort and filter');
    toggle.firstChild.textContent = state.navOpen ? '×' : '✳';
    if (preserveControls) return;
    const content = $('#nav-content'); content.hidden = !state.navOpen; content.replaceChildren();
    content.append(el('h2', 'Sort & view'));
    const choices = el('div', null, 'arrangements');
    nav.arrangements.forEach(id => {
      const button = el('button', id === 'az' ? 'A–Z' : 'Scatter');
      button.setAttribute('aria-pressed', String(current.active === id));
      button.addEventListener('click', () => {
        state.arrangement[current.container.id] = id;
        history.pushState(null, '', routeFor(state.path, state.detail, id, state.filter));
        render(false);
        $('#nav-content').querySelector(`[aria-pressed="true"]`)?.focus({ preventScroll: true });
      }); choices.append(button);
    }); content.append(choices);
    const label = el('label', 'Filter titles', 'filter-label');
    const input = el('input'); input.type = 'search'; input.value = state.filter || ''; input.placeholder = 'Type a title…';
    input.addEventListener('input', () => {
      state.filter = input.value; state.detail = null;
      history.replaceState(null, '', routeFor(state.path, null, state.arrangement[state.path.at(-1)], state.filter));
      render(false, true);
    });
    label.append(input); content.append(label);

  }
  function render(focus, preserveNavControls = false) {
    const next = layout(tree, state, { width: innerWidth, height: innerHeight, scrollY: window.scrollY });
    $('#world').style.minHeight = `${next.height}px`;
    const visible = next.circles.filter(circle => circle.visible !== false);
    renderTrailLinks(visible);
    for (const [key, button] of mounted) if (!visible.some(circle => circle.key === key)) {
      mounted.delete(key);
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
    current = next;
    const section = $('#detail');
    if (current.detail) {
      const { x, y, r, id } = current.detail;
      section.hidden = state.navOpen;
      Object.assign(section.style, { left: `${x - r * .76}px`, top: `${y - r * .72}px`, width: `${r * 1.52}px`, height: `${r * 1.44}px` });
      if (detailId !== id) {
        detailContent(index.get(id).node);
        animate(section, [{ opacity: 0 }, { opacity: 1 }], { delay: reduced.matches ? 0 : 650, duration: 300 });
      }
      detailId = id;
    } else { section.hidden = true; if (detailId) { audio.pause(); audio.remove(); } detailId = null; }
    const subject = index.get(state.detail || current.container.id).node;
    $('#location').textContent = current.path.map(id => index.get(id).node.label).join(' / ');
    $('#hint').textContent = current.detail ? 'Scroll to move through items' : `${current.count} ${current.count === 1 ? 'orb' : 'orbs'} · Open to explore`;
    document.title = `${subject.label} · Orb · Internal`;
    $('#announcement').textContent = `${subject.label}${state.detail ? '' : `, ${current.count} ${current.count === 1 ? 'item' : 'items'}`}`;
    const recents = [subject.id, ...saved('orb-recents').filter(id => id !== subject.id)].slice(0, 12); persist('orb-recents', recents);
    renderNav(preserveNavControls);
    clearTimeout(focusTimer);
    if (focus) focusTimer = setTimeout(() => (state.detail ? $('#detail h1') : mounted.get(current.container.id))?.focus({ preventScroll: true }), duration() + 100);
  }
  toggle.addEventListener('click', () => { state.navOpen = !state.navOpen; render(false); toggle.focus({ preventScroll: true }); });
  $('#home-link').addEventListener('click', event => { event.preventDefault(); navigate(base); });
  $('#world').addEventListener('click', event => { if (state.detail && (event.target === $('#world') || event.target === $('#circles'))) closeDetail(); });
  $('#world').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.navOpen) { state.navOpen = false; render(false); toggle.focus(); }
      else if (state.detail) closeDetail();
    }
    if (event.target.closest('select,input,textarea,seraph-audio-player') || event.target.isContentEditable) return;
    if (state.detail && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); step(event.key === 'ArrowDown' ? 'next' : 'prev'); }
  });
  const canScroll = (target, delta) => {
    const section = target.closest('#detail');
    return section && (delta > 0 ? section.scrollTop + section.clientHeight < section.scrollHeight - 2 : section.scrollTop > 0);
  };
  $('#world').addEventListener('wheel', event => {
    if (!state.detail || state.navOpen || event.target.closest('select,seraph-audio-player') || canScroll(event.target, event.deltaY)) return;
    event.preventDefault();
    if (Math.abs(event.deltaY) < 15 || Date.now() - wheelAt < duration()) return;
    wheelAt = Date.now(); step(event.deltaY > 0 ? 'next' : 'prev');
  }, { passive: false });
  $('#world').addEventListener('touchstart', event => { touchY = event.touches[0].clientY; }, { passive: true });
  $('#world').addEventListener('touchend', event => {
    if (touchY == null || !state.detail || state.navOpen) return;
    const delta = touchY - event.changedTouches[0].clientY; touchY = null;
    if (Math.abs(delta) > 60 && !event.target.closest('#detail,select,seraph-audio-player')) step(delta > 0 ? 'next' : 'prev');
  }, { passive: true });
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
