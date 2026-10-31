const $ = (selector) => document.querySelector(selector);
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
};
let priorSelection = {};
try { priorSelection = JSON.parse(sessionStorage.getItem('seraph-live-selection') || '{}'); } catch { /* Start fresh if browser storage is unavailable. */ }
let sets = [], songs = [], selected = priorSelection?.set ?? null, selectedSong = priorSelection?.song ?? null, busy = false, canCreate = false;
const status = (message, error = false) => {
  $('#status').textContent = message;
  $('#status').className = error ? 'status-error' : 'muted';
};
async function api(route, data) {
  const response = await fetch(`/api/sets${route}`, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Start the local workspace with npm run dev:internal to manage Live Sets.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to complete that operation.');
  return result;
}
const saved = (set) => set?.saved_at ? new Date(set.saved_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Save time unknown';
const byRecent = (a, b) => (Date.parse(b.saved_at) || 0) - (Date.parse(a.saved_at) || 0) || a.id.localeCompare(b.id);
function controls() {
  const set = sets.find((s) => s.id === selected);
  $('#refresh').disabled = busy;
  $('#new-idea').disabled = busy || !canCreate;
  $('#create-idea').disabled = busy;
  $('#cancel-new').disabled = busy;
  $('#open-set').disabled = busy || !set?.available || Boolean(set.archived_at);
  $('#make-branch').disabled = busy || !set?.available || Boolean(set.archived_at);
  $('#branch-name').disabled = $('#make-branch').disabled;
  $('#archive-set').disabled = busy || !set;
  $('#save-association').disabled = busy || !set || Boolean(set.archived_at);
  $('#song-association').disabled = $('#save-association').disabled;
  $('#archive-set').textContent = set?.archived_at ? 'Restore set' : 'Archive set';
  for (const row of document.querySelectorAll('.work-row')) row.disabled = busy;
  $('#new-form').setAttribute('aria-busy', String(busy));
}
function row(title, subtitle, action, active = false) {
  const button = node('button', null, 'work-row');
  button.type = 'button';
  button.setAttribute('aria-pressed', String(active));
  const copy = node('span');
  copy.append(node('strong', title), node('small', subtitle));
  button.append(copy, node('span', '→', 'row-arrow'));
  button.addEventListener('click', action);
  return button;
}
function choose(id, songId = null) {
  selected = id;
  selectedSong = songId;
  $('#branch-name').value = '';
  render();
  if (matchMedia('(max-width: 760px)').matches) $('.work-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderDetail() {
  const set = sets.find((s) => s.id === selected);
  const song = songs.find((s) => s.id === (selectedSong || set?.song));
  const hasSelection = Boolean(set || song);
  $('.work-detail').classList.toggle('is-empty', !hasSelection);
  $('#selection-empty').hidden = hasSelection;
  $('#selection').hidden = !hasSelection;
  $('#selected-set').hidden = !set;
  if (!hasSelection) return;
  $('#selection-kind').textContent = song ? 'Continue a song' : 'Pick up an idea';
  $('#selected-title').textContent = song?.title || set.name;
  $('#selected-subtitle').textContent = set ? song ? set.name : 'A working idea, with no song association yet.' : 'No available set is linked to this song yet. Pick an idea and link it to this song to start here.';
  if (!set) return;
  $('#open-set').textContent = set.archived_at ? 'Restore to open' : set.available ? 'Open in Ableton ↗' : 'Set file is missing';
  $('#saved-time').textContent = `Last saved ${saved(set)}`;
  $('#selected-path').textContent = set.paths.at(-1);
  $('#selected-analysis').textContent = set.analysis ? `${set.analysis.external_plugin_instances} external plugin instances at the last snapshot.` : 'No analysis snapshot yet.';
  $('#association-panel summary').textContent = set.song ? 'Change song association' : 'Link to a song';
  $('#association-help').textContent = set.idea_id ? 'Links this idea and its sets to the song, keeping the original idea record.' : set.project_id && set.song_scope !== 'set' ? 'Links this project and its sets to the song. You can keep exploring without a link.' : 'Links this set to a song. New branches inherit the association.';
  const picker = $('#song-association');
  picker.replaceChildren();
  const blank = node('option', 'Keep as an idea'); blank.value = ''; picker.append(blank);
  for (const song of songs) { const option = node('option', song.title); option.value = song.id; picker.append(option); }
  picker.value = set.song || '';
  $('#related-sets').replaceChildren();
  const related = sets.filter((s) => !s.archived_at && (song ? s.song === song.id : set.idea_id ? s.idea_id === set.idea_id : set.project_id ? s.project_id === set.project_id : s.id === set.id || s.parent_set_id === set.id)).sort(byRecent);
  for (const version of related) $('#related-sets').append(row(version.name, version.available ? `Saved ${saved(version)}` : 'Missing', () => choose(version.id, song?.id), version.id === selected));
  $('#lineage').replaceChildren();
  const parent = sets.find((s) => s.id === set.parent_set_id);
  if (parent) $('#lineage').append(node('p', `Branched from ${parent.name}`, 'muted'));
}
function render() {
  try { sessionStorage.setItem('seraph-live-selection', JSON.stringify({ set: selected, song: selectedSong })); } catch { /* Selection remains usable without storage. */ }
  const search = $('#work-search').value.trim().toLocaleLowerCase();
  const matches = (value) => value.toLocaleLowerCase().includes(search);
  const groups = new Map();
  for (const set of sets.filter((s) => !s.song && !s.archived_at)) {
    const key = set.idea_id || set.project_id || set.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(set);
  }
  const ideas = [...groups.values()].map((group) => group.filter((s) => s.available).sort(byRecent)[0] || group.sort(byRecent)[0]).sort(byRecent);
  const ideaList = $('#idea-list'); ideaList.replaceChildren();
  for (const idea of ideas.filter((s) => matches(s.name))) ideaList.append(row(idea.name, idea.available ? `Saved ${saved(idea)}` : 'Set file missing', () => choose(idea.id), selected === idea.id && !selectedSong));
  if (!ideaList.children.length) ideaList.append(node('p', search ? 'No matching ideas.' : 'Your next idea starts with New Live Set.', 'empty'));
  $('#idea-count').textContent = String(ideas.length);
  const songList = $('#song-list'); songList.replaceChildren();
  for (const song of songs.filter((s) => matches(s.title))) {
    const latest = sets.find((s) => s.id === song.latest_set_id);
    songList.append(row(song.title, latest ? `Saved ${saved(latest)}` : 'No available set linked', () => choose(song.latest_set_id, song.id), selectedSong === song.id));
  }
  if (!songList.children.length) songList.append(node('p', search ? 'No matching songs.' : 'No songs yet.', 'empty'));
  $('#song-count').textContent = String(songs.length);
  const archived = sets.filter((s) => s.archived_at).sort(byRecent);
  $('#archive-count').textContent = `(${archived.length})`;
  $('#archived-list').replaceChildren(...archived.filter((s) => matches(s.name)).map((s) => row(s.name, 'Archived', () => choose(s.id), selected === s.id)));
  renderDetail(); controls();
}
async function load() {
  const data = await api('/workspace');
  sets = data.sets; songs = data.songs; canCreate = data.can_create;
  if (selected && !sets.some((s) => s.id === selected)) selected = null;
  render();
  return data;
}
async function open(id) {
  await api('/open', { set_id: id });
  status('Opening in Ableton. Save your work there; refresh saved sets when you return.');
}
$('#work-search').addEventListener('input', render);
$('#new-idea').addEventListener('click', () => {
  $('#new-error').hidden = true; $('#new-dialog').showModal(); $('#create-idea').focus();
});
$('#cancel-new').addEventListener('click', () => $('#new-dialog').close());
$('#new-dialog').addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
$('#new-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  busy = true; controls(); $('#new-error').hidden = true;
  let created;
  try {
    created = await api('/new', {});
    $('#new-dialog').close();
    // Keep a successful creation visible even if the subsequent refresh fails.
    sets.push({ ...created, name: created.paths.at(-1).split('/').at(-1).replace(/\.als$/i, ''), available: true, song: null });
    selected = created.id; selectedSong = null;
    try { await load(); } catch { render(); }
    status('Idea created. Opening in Ableton…');
    try { await open(created.id); } catch (error) { status(`Idea created and saved. ${error.message} Use Open in Ableton to try again.`, true); }
  } catch (error) {
    $('#new-error').textContent = error.message; $('#new-error').hidden = false;
  } finally { busy = false; controls(); }
});
$('#open-set').addEventListener('click', async () => {
  if (busy || !selected) return;
  busy = true; controls();
  try { await open(selected); } catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
});
$('#refresh').addEventListener('click', async () => {
  if (busy) return;
  busy = true; controls(); status('Checking saved work…');
  try { await api('/scan', {}); await load(); status('Up to date. Songs point to their most recently saved available set.'); }
  catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
});
$('#association-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy || !selected) return;
  busy = true; controls();
  const song = $('#song-association').value || null;
  try { await api('/associate', { set_id: selected, song }); selectedSong = song; await load(); status(song ? 'Linked to the song. You can find this work under Songs now.' : 'Kept as an idea.'); }
  catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
});
$('#branch-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy || !selected) return;
  busy = true; controls();
  try {
    const child = await api('/branch', { parent_id: selected, name: $('#branch-name').value });
    sets.push({ ...child, name: $('#branch-name').value, available: true, song: sets.find((s) => s.id === selected)?.song ?? null });
    selected = child.id;
    try { await load(); } catch { render(); }
    $('#branch-name').value = ''; status('Branch created. Open it in Ableton when you’re ready.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
});
$('#archive-set').addEventListener('click', async () => {
  const set = sets.find((s) => s.id === selected); if (busy || !set) return;
  busy = true; controls();
  try {
    const restored = Boolean(set.archived_at);
    const updated = await api(restored ? '/restore' : '/archive', { set_id: set.id });
    set.archived_at = updated.archived_at;
    await load(); status(restored ? 'Set restored.' : 'Set archived. Files and history are kept.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
});
try { const data = await load(); status(data.can_create ? '' : data.create_help, !data.can_create); }
catch (error) { status(error.message, true); controls(); }
