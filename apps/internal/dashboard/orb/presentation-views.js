const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export const songFor = node => node.kind === 'Music fragment' ? node.audio : node.kind === 'Song' ? node.data : node.kind === 'Album track' ? node.data?.song : null;
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function playbackControls(song, mix, playback) {
  const root = el('div', null, 'inline-player');
  if (!mix) { root.append(el('p', 'No mixes yet.', 'muted')); return { element: root, dispose() {} }; }
  const button = el('button', null, 'inline-play'); button.type = 'button';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="play-icon" d="m9 5 11 7-11 7Z"/><path class="pause-icon" d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
  const seek = el('input'); seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '.1';
  seek.value = '0'; seek.setAttribute('aria-label', `Seek ${song.title}`);
  const elapsed = el('span', '', 'muted');
  button.addEventListener('click', () => playback.toggle(song, mix));
  seek.addEventListener('input', () => playback.seek(mix, Number(seek.value)));
  root.append(button, seek, elapsed);
  const dispose = playback.subscribe(() => {
    const active = playback.matches(mix), playing = active && playback.playing;
    button.classList.toggle('playing', playing);
    button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${song.title}`);
    seek.disabled = !active || !playback.duration;
    seek.max = String(active ? playback.duration : 0);
    seek.value = String(active ? playback.time : 0);
    const text = active ? `${time(playback.time)} / ${time(playback.duration)}` : 'Ready to play';
    if (elapsed.textContent !== text) elapsed.textContent = text;
  });
  return { element: root, dispose };
}

export const presentationViews = {
  samples(node, { playback, open }) {
    const root = el('article', null, 'player-card sample-row');
    const title = el('button', node.label, 'card-title'); title.type = 'button'; title.addEventListener('click', open);
    const data = node.data;
    root.append(title, el('p', [node.groupLabel, data.key, data.bpm ? `${data.bpm} BPM` : '', data.sample_type, data.role, ...(data.tags || [])].filter(Boolean).join(' · '), 'sample-meta muted'));
    const controls = playbackControls(node.audio, node.audio.mixes[0], playback);
    root.append(controls.element);
    return { element: root, dispose: controls.dispose };
  },
  player(node, { playback, open }) {
    const root = el('article', null, 'player-card');
    const title = el('button', node.label, 'card-title'); title.type = 'button'; title.addEventListener('click', open);
    const song = songFor(node), mix = song?.mixes[0];
    root.append(el('p', node.kind, 'kind'), title);
    let controls;
    if (song) {
      root.append(el('p', mix ? `Latest mix · ${mix.date} · ${mix.format}` : 'Song', 'muted'));
      controls = playbackControls(song, mix, playback); root.append(controls.element);
    } else root.append(el('p', 'No song association recorded yet.', 'muted'));
    return { element: root, dispose() { controls?.dispose(); } };
  },
};
