import './shared/components/audio-player/audio-player.js';

const $ = (selector) => document.querySelector(selector);
const date = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
let songs = [];
let selected;
const audio = document.createElement('seraph-audio-player');
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function selectSong(song) {
  selected = song.id;
  audio.pause();
  audio.removeAttribute('src');
  audio.setAttribute('label', `${song.title} audio player`);
  const detail = $('#detail');
  detail.replaceChildren(element('h2', song.title), element('p', song.created ? 'Created ' + date(song.created) : 'Creation date unknown', 'muted'));
  if (song.mixes.length) {
    const label = element('label', 'Mix version');
    const versions = element('select');
    versions.id = 'mix-version';
    song.mixes.forEach((mix, index) => {
      const option = element('option', `${date(mix.date)} · ${mix.format}${index === 0 ? ' · Latest' : ''}`);
      option.value = mix.url;
      versions.append(option);
    });
    label.append(versions);
    const link = element('a', 'Open audio file ↗', 'file-link');
    link.target = '_blank';
    link.rel = 'noopener';
    const mixNotes = element('section');
    mixNotes.setAttribute('aria-label', 'Mix notes');
    const mixMetadata = element('p', '', 'muted');
    const chooseMix = () => {
      audio.pause();
      audio.src = versions.value;
      link.href = versions.value;
      const mix = song.mixes.find((mix) => mix.url === versions.value);
      const tempo = mix.bpm_changes?.length ? mix.bpm_changes.join(' → ') : mix.bpm;
      mixMetadata.textContent = [tempo != null ? `${tempo} BPM` : '', mix.key ? `Key: ${mix.key}` : ''].filter(Boolean).join(' · ');
      mixMetadata.hidden = !mixMetadata.textContent;
      mixNotes.replaceChildren();
      mixNotes.hidden = !mix.notes?.trim();
      if (!mixNotes.hidden) {
        const notes = element('div', '', 'notes');
        notes.innerHTML = mix.notes;
        mixNotes.append(element('h3', 'Mix notes'), notes);
      }
    };
    versions.addEventListener('change', chooseMix);
    chooseMix();
    detail.append(label, mixMetadata, audio, link, mixNotes);
  } else detail.append(element('p', 'No mixes yet.', 'muted'));
  if (song.notes.trim()) {
    detail.append(element('h3', 'Song notes'));
    const notes = element('div', '', 'notes');
    // Markdown is authored locally by the repository owner, like Zero posts.
    notes.innerHTML = song.notes;
    detail.append(notes);
  }
  for (const row of document.querySelectorAll('.song')) {
    row.setAttribute('aria-pressed', String(row.dataset.id === selected));
  }
}
function renderList() {
  const sort = $('#sort').value;
  const sorted = [...songs].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) :
    (sort === 'mix' ? (b.mixes[0]?.date || '').localeCompare(a.mixes[0]?.date || '') : (b.created || '').localeCompare(a.created || '')) || a.title.localeCompare(b.title));
  $('#songs').replaceChildren(...sorted.map((song) => {
    const row = $('#song-row').content.firstElementChild.cloneNode(true);
    row.querySelector('strong').textContent = song.title;
    row.dataset.id = song.id;
    row.querySelector('.mix-date').textContent = song.mixes.length ? date(song.mixes[0].date) : 'No mixes';
    row.setAttribute('aria-pressed', String(selected === song.id));
    row.addEventListener('click', () => selectSong(song));
    return row;
  }));
  $('#empty').hidden = songs.length > 0;
}
$('#sort').addEventListener('change', renderList);
try {
  const response = await fetch('songs.json');
  if (!response.ok) throw new Error('Library unavailable');
  songs = await response.json();
  const mixes = songs.reduce((count, song) => count + song.mixes.length, 0);
  $('#summary').textContent = `${songs.length} songs / ${mixes} mixes`;
  renderList();
  if (songs.length) selectSong(songs[0]);
} catch {
  $('#summary').textContent = 'Unable to load library. Rebuild and refresh to try again.';
}
