import { createNoteIndex, readNoteLocation, noteLocation, neighborhood } from './notes-model.mjs';

const $ = selector => document.querySelector(selector);
const svgNS = 'http://www.w3.org/2000/svg';
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
let index;
let state = readNoteLocation(location.search);
let trail = [];

function linkTo(note, className) {
  const link = el('a', note.title, className);
  link.href = noteLocation({ ...state, id: note.id });
  link.dataset.noteId = note.id;
  return link;
}
function updateURL(replace = false) {
  const url = noteLocation(state);
  if (location.pathname.split('/').at(-1) + location.search !== url) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  for (const link of document.querySelectorAll('a[data-note-id]')) link.setAttribute('href', noteLocation({ ...state, id: link.dataset.noteId }));
}
function announce(text = '') { $('#notes-status').textContent = text; }

function renderLibrary() {
  const list = $('#note-list');
  const matches = index.list(state);
  list.replaceChildren();
  $('#result-count').textContent = `${plural(matches.length, 'note')}${state.query || state.scope !== 'all' ? ` of ${index.notes.length}` : ' to explore'}`;
  if (!matches.length) {
    const empty = el('div', null, 'library-empty');
    empty.append(el('p', state.scope === 'unlinked' && !state.query ? 'Every note has company. There are no unlinked notes.' : 'No notes match this search. Try a different word.'));
    const reset = el('button', 'Show all notes', 'library-reset');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      state.query = ''; state.scope = 'all'; syncControls(); updateURL(true); renderLibrary(); $('#note-search').focus();
    });
    empty.append(reset); list.append(empty);
  }
  for (const note of matches) {
    const link = linkTo(note, 'note-row');
    link.replaceChildren(el('strong', note.title), el('span', note.excerpt || 'A thought waiting to be written.', 'row-excerpt'), el('span', plural(index.degree(note.id), 'connection'), 'row-count'));
    if (note.id === state.id) link.setAttribute('aria-current', 'true');
    list.append(link);
  }
}

function renderConnections(id, direction, target, count) {
  const container = $(target);
  const links = [...index[direction].get(id)].map(key => index.byId.get(key)).sort((a, b) => a.title.localeCompare(b.title));
  $(count).textContent = links.length;
  container.replaceChildren();
  for (const note of links) {
    const link = linkTo(note, 'connection-link');
    link.replaceChildren(el('span', direction === 'outgoing' ? '↗' : '↙'), el('span', note.title));
    link.firstChild.setAttribute('aria-hidden', 'true');
    container.append(link);
  }
  if (!links.length) container.append(el('p', direction === 'outgoing' ? 'No outgoing links yet.' : 'No other notes link here yet.', 'connection-empty'));
}
function shortLines(title) {
  const words = title.split(/\s+/);
  const result = [''];
  for (const word of words) {
    if ((result.at(-1) + ' ' + word).trim().length > 16 && result.at(-1)) {
      if (result.length === 2) { result[1] = result[1].replace(/…$/, '') + '…'; break; }
      result.push('');
    }
    result[result.length - 1] = (result.at(-1) + ' ' + word).trim();
  }
  return result;
}
function renderMap(id) {
  const container = $('#neighborhood-map');
  container.replaceChildren();
  const neighbors = neighborhood(index, id);
  const total = index.degree(id);
  $('#neighbor-count').textContent = `${plural(total, 'connected thought')}. Each is another way in.`;
  if (!neighbors.length) {
    container.append(el('p', 'Room for a new connection. This thought stands on its own for now.', 'map-empty'));
    $('#map-caption').textContent = '';
    return;
  }
  const map = svg('svg', { viewBox: '0 0 340 320', role: 'group', 'aria-label': `Connected neighborhood of ${index.byId.get(id).title}` });
  map.append(svg('ellipse', { cx: 170, cy: 154, rx: 116, ry: 111, class: 'graph-orbit' }));
  for (const point of neighbors) map.append(svg('line', { x1: 170, y1: 154, x2: point.x, y2: point.y, class: `graph-edge${point.outgoing ? '' : ' incoming'}` }));
  map.append(svg('circle', { cx: 170, cy: 154, r: 20, class: 'graph-center-halo' }), svg('circle', { cx: 170, cy: 154, r: 7, class: 'graph-center' }), svg('text', { x: 170, y: 193, 'text-anchor': 'middle', class: 'graph-center-label' }, 'IN FOCUS'));
  for (const point of neighbors) {
    const description = point.outgoing && point.incoming ? 'Linked both ways' : point.outgoing ? 'Linked from here' : 'Links back here';
    const link = svg('a', { href: noteLocation({ ...state, id: point.note.id }), 'data-note-id': point.note.id, class: `graph-node${point.outgoing ? ' outgoing' : ''}`, 'aria-label': `${point.note.title} · ${description}` });
    link.append(svg('title', {}, `${point.note.title} · ${description}`), svg('circle', { cx: point.x, cy: point.y, r: 6 }));
    const label = svg('text', { x: point.x, y: point.y + 20, 'text-anchor': 'middle', 'aria-hidden': 'true' });
    shortLines(point.note.title).forEach((line, i) => label.append(svg('tspan', { x: point.x, dy: i ? 13 : 0 }, line)));
    link.append(label); map.append(link);
  }
  container.append(map);
  $('#map-caption').textContent = `${total > neighbors.length ? `Showing ${neighbors.length} of ${total}; every connection is listed below. ` : ''}Solid links go out. Dashed links come in.`;
}
function renderTrail() {
  $('#reading-trail').hidden = trail.length < 2;
  $('#trail-links').replaceChildren();
  trail.slice(-5).forEach(id => {
    const link = linkTo(index.byId.get(id));
    if (id === state.id) link.setAttribute('aria-current', 'true');
    $('#trail-links').append(link);
  });
}
function dateTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
function renderReader() {
  const note = index.byId.get(state.id);
  if (!note) return;
  $('#note-title').textContent = note.title;
  const writing = note.data.written_when;
  const date = !writing || writing.certainty === 'unknown' ? 'Writing date unknown' : writing.label;
  $('#note-byline').textContent = `${note.data.visibility === 'public' ? 'Public' : 'Private'} note · ${date}`;
  // HTML is generated by the restricted Markdown renderer at the internal build boundary.
  $('#note-prose').innerHTML = note.html;
  if (!note.body) $('#note-prose').append(el('p', 'This note is still waiting for its first words.', 'muted'));
  $('#note-about').open = false;
  const metadata = $('#note-metadata');
  metadata.replaceChildren();
  const fields = [['Writing date', writing?.label || 'Unknown'], ['Date evidence', writing?.basis], ['Added to the library', dateTime(note.data.created_at)], ['Record', note.source]];
  for (const ref of note.data.sources || []) fields.push(['Source', `${ref.section}\n${ref.file} · lines ${ref.start_line}–${ref.end_line}`]);
  for (const [label, value] of fields) if (value) metadata.append(el('dt', label), el('dd', value));
  renderMap(note.id);
  renderConnections(note.id, 'outgoing', '#outgoing-links', '#outgoing-count');
  renderConnections(note.id, 'incoming', '#incoming-links', '#incoming-count');
  renderTrail();
}
function selectNote(id, { push = true, focus = false } = {}) {
  if (!index.byId.has(id)) return;
  state.id = id;
  if (trail.at(-1) !== id) trail.push(id);
  trail = trail.slice(-20);
  if (push) updateURL();
  announce(); renderLibrary(); renderReader();
  if (focus) {
    $('#note-title').focus({ preventScroll: true });
    if (matchMedia('(max-width: 760px)').matches) $('#note-reader').scrollIntoView({ block: 'start' });
  }
}
function syncControls() {
  $('#note-search').value = state.query;
  $('#note-scope').value = state.scope;
  $('#note-sort').value = state.sort;
}
function navigateFilters() {
  state.query = $('#note-search').value;
  state.scope = $('#note-scope').value;
  state.sort = $('#note-sort').value;
  updateURL(true); renderLibrary();
}

try {
  const response = await fetch('notes.json');
  if (!response.ok) throw new Error('Could not load the note library.');
  const records = await response.json();
  index = createNoteIndex(records);
  $('#collection-count').textContent = `${plural(index.notes.length, 'note')} · ${plural(index.linkCount, 'link')}`;
  $('#notes-workspace').hidden = false;
  $('#another-note').disabled = index.notes.length < 2;
  syncControls();
  if (!index.notes.length) {
    renderLibrary();
    $('#note-prose').append(el('p', 'Your library starts with a thought. Add a Note to begin.', 'muted'));
    $('.note-context').hidden = true; $('#note-about').hidden = true;
  } else {
    const requested = state.id;
    const start = index.byId.has(requested) ? requested : index.list(state)[0]?.id || index.sorted[0].id;
    selectNote(start, { push: false }); updateURL(true);
    if (requested && requested !== start) announce('That note could not be found. Another thought is open below.');
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[data-note-id]');
    if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); selectNote(anchor.dataset.noteId, { focus: true });
  });
  $('#note-search').addEventListener('input', navigateFilters);
  $('#note-scope').addEventListener('change', navigateFilters);
  $('#note-sort').addEventListener('change', navigateFilters);
  $('#note-search').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); $('#note-search').value = ''; navigateFilters(); }
  });
  $('#note-list').addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const links = [...$('#note-list').querySelectorAll('.note-row')];
    const current = links.indexOf(document.activeElement);
    if (current < 0) return;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : Math.max(0, Math.min(links.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    event.preventDefault(); links[target]?.focus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault(); $('#note-search').focus();
    }
  });
  $('#back-to-library').addEventListener('click', () => { $('#note-library').scrollIntoView({ block: 'start' }); $('#note-search').focus({ preventScroll: true }); });
  $('#another-note').addEventListener('click', () => {
    const choices = index.notes.filter(note => note.id !== state.id);
    if (choices.length) selectNote(choices[Math.floor(Math.random() * choices.length)].id, { focus: true });
  });
  addEventListener('popstate', () => {
    state = readNoteLocation(location.search); syncControls();
    const id = index.byId.has(state.id) ? state.id : index.list(state)[0]?.id || index.sorted[0]?.id;
    if (id) selectNote(id, { push: false }); else renderLibrary();
  });
} catch (error) {
  announce('The note library could not be loaded. Refresh to try again.');
  $('#collection-count').textContent = 'Library unavailable';
}
