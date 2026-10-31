const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export const songFor = node => node.kind === 'Song' ? node.data : node.kind === 'Album track' ? node.data?.song : null;
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function playbackControls(song, mix, playback) {
  const root = el('div', null, 'inline-player');
  if (!mix) { root.append(el('p', 'No mixes yet.', 'muted')); return { element: root, dispose() {} }; }
  const button = el('button', 'Play', 'inline-play'); button.type = 'button';
  const seek = el('input'); seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '.1';
  seek.value = '0'; seek.setAttribute('aria-label', `Seek ${song.title}`);
  const elapsed = el('span', '', 'muted');
  button.addEventListener('click', () => playback.toggle(song, mix));
  seek.addEventListener('input', () => playback.seek(mix, Number(seek.value)));
  root.append(button, seek, elapsed);
  const dispose = playback.subscribe(() => {
    const active = playback.matches(mix), playing = active && playback.playing;
    button.textContent = playing ? 'Pause' : 'Play';
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
