const $ = (selector) => document.querySelector(selector);
const audio = $('#fragment-audio');
let fragments = [];
let ideas = new Map();
let selected = 'all';
let current = null;
let request = 0;
const orphan = 'unassociated';
const groupId = (fragment) => fragment.data.idea || orphan;
const groupTitle = (id) => id === orphan ? 'Unassociated / Orphan' : ideas.get(id)?.title || id;
const filename = (fragment) => fragment.data.title || fragment.data.file.split('/').at(-1);
function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function matches(fragment, query) {
  const data = fragment.data;
  const fields = [filename(fragment), data.file, groupTitle(groupId(fragment)), data.key, data.bpm,
    ...(data.tags || []), data.notes, data.memories, data.character, data.role, data.melody_sound, data.sample_type];
  return fields.join(' ').toLowerCase().includes(query);
}
function playbackState() {
  for (const row of document.querySelectorAll('.fragment-row')) {
    const playing = row.dataset.id === current?.id && !audio.paused;
    row.classList.toggle('is-playing', playing);
    const button = row.querySelector('.fragment-play');
    button.textContent = playing ? 'Ⅱ' : '▶';
    button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${row.dataset.name}`);
  }
}
async function play(fragment) {
  if (current?.id === fragment.id && !audio.paused) { audio.pause(); return; }
  const token = ++request;
  if (current?.id !== fragment.id || audio.error) {
    audio.pause();
    current = fragment;
    audio.src = `/api/fragments/${encodeURIComponent(fragment.id)}/audio`;
  }
  $('#fragment-player').hidden = false;
  $('#playing-title').textContent = filename(fragment);
  $('#playing-meta').textContent = [groupTitle(groupId(fragment)), fragment.data.key, fragment.data.bpm ? `${fragment.data.bpm} BPM` : ''].filter(Boolean).join(' · ');
  $('#playback-status').textContent = 'Preparing audio…';
  try { await audio.play(); }
  catch (error) {
    if (token !== request || error.name === 'AbortError') return;
    $('#playback-status').textContent = 'Audio unavailable. Check your connection and R2 setup, or connect MusicArchive. Then press Play to retry.';
  }
}
audio.addEventListener('playing', () => { $('#playback-status').textContent = ''; playbackState(); });
audio.addEventListener('pause', playbackState);
audio.addEventListener('ended', playbackState);
audio.addEventListener('error', () => {
  $('#playback-status').textContent = 'Audio unavailable. Check your connection and R2 setup, or connect MusicArchive. Then press Play to retry.';
  playbackState();
});
function fragmentRow(fragment) {
  const data = fragment.data;
  const row = el('article', null, 'fragment-row');
  row.dataset.id = fragment.id;
  row.dataset.name = filename(fragment);
  const button = el('button', '▶', 'fragment-play');
  button.type = 'button';
  button.addEventListener('click', () => play(fragment));
  const info = el('div');
  info.append(el('strong', filename(fragment), 'fragment-name'));
  const badges = el('div', null, 'fragment-badges');
  for (const value of [data.key, data.bpm ? `${data.bpm} BPM` : null]) if (value) badges.append(el('span', value, 'musical'));
  for (const value of [data.sample_type, data.role, ...(data.tags || []), data.needs_review ? 'Needs review' : null]) if (value) badges.append(el('span', value));
  info.append(badges);
  const details = el('details');
  details.append(el('summary', 'Notes & source'));
  const list = el('dl');
  for (const [label, value] of [['Notes', data.notes], ['Memories', data.memories], ['Character', data.character], ['Material', data.melody_sound], ['Review', data.review_reason], ['Source date', data.source?.date], ['File', data.file]]) {
    if (value) list.append(el('dt', label), el('dd', value));
  }
  if (data.source) {
    const source = data.source;
    const cell = `A${source.row}:P${source.row}`;
    const link = el('a', `${source.sheet} · row ${source.row}`);
    link.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(source.spreadsheet_id)}/edit#gid=${source.sheet_id}&range=${encodeURIComponent(cell)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const description = el('dd');
    description.append(link);
    list.append(el('dt', 'Sheet'), description);
  }
  details.append(list);
  info.append(details);
  row.append(button, info);
  return row;
}
function render(focusGroup) {
  const query = $('#fragment-search').value.trim().toLowerCase();
  const matching = fragments.filter((fragment) => matches(fragment, query));
  const groupIds = [...new Set(fragments.map(groupId))].sort((a, b) => a === orphan ? 1 : b === orphan ? -1 : groupTitle(a).localeCompare(groupTitle(b)));
  const groups = $('#fragment-groups');
  groups.replaceChildren();
  let focusTarget;
  for (const id of ['all', ...groupIds]) {
    const count = matching.filter((fragment) => id === 'all' || groupId(fragment) === id).length;
    const button = el('button', null, 'group-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected === id));
    button.append(el('span', id === 'all' ? 'All fragments' : groupTitle(id)), el('span', count));
    button.addEventListener('click', () => { selected = id; render(id); });
    groups.append(button);
    if (id === focusGroup) focusTarget = button;
  }
  const visible = matching.filter((fragment) => selected === 'all' || groupId(fragment) === selected);
  $('#fragment-summary').textContent = `${visible.length} of ${fragments.length} fragments`;
  const results = $('#fragment-results');
  results.replaceChildren();
  results.setAttribute('aria-busy', 'false');
  for (const id of groupIds) {
    const rows = visible.filter((fragment) => groupId(fragment) === id);
    if (!rows.length) continue;
    const section = el('section', null, 'fragment-group');
    const heading = el('div', null, 'fragment-group-heading');
    heading.append(el('h2', groupTitle(id)), el('span', `${rows.length} fragment${rows.length === 1 ? '' : 's'}`));
    section.append(heading, ...rows.map(fragmentRow));
    results.append(section);
  }
  if (!visible.length) results.append(el('p', fragments.length ? 'No fragments match. Try another idea or clear your search.' : 'No fragments have been cataloged yet.', 'empty'));
  playbackState();
  focusTarget?.focus({ preventScroll: true });
}
$('#fragment-search').addEventListener('input', () => render());
try {
  const response = await fetch('catalog.json');
  if (!response.ok) throw new Error('Catalog unavailable');
  const catalog = await response.json();
  ideas = new Map(catalog.records.filter((record) => record.type === 'Idea').map((record) => [record.id, record]));
  fragments = catalog.records.filter((record) => record.type === 'MusicFragment').sort((a, b) => a.data.file.localeCompare(b.data.file));
  render();
} catch {
  $('#fragment-summary').textContent = 'Unable to load fragments. Refresh the dashboard to try again.';
  $('#fragment-results').setAttribute('aria-busy', 'false');
}
