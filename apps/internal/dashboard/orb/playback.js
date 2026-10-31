// One media element owns playback; list, detail, and the player Orb are controls.
export function createPlayback(media, origin) {
  let selection = null, error = '';
  media.preload = 'none';
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  for (const event of ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'emptied', 'error']) media.addEventListener(event, notify);
  const matches = mix => !!mix && selection?.mix.url === mix.url;
  function select(song, mix = song.mixes[0]) {
    if (!mix) return false;
    error = '';
    if (!matches(mix)) {
      media.pause();
      selection = { song, mix };
      media.src = new URL('/' + mix.url, origin).href;
      media.load();
    } else selection = { song, mix };
    notify();
    return true;
  }
  return {
    get error() { return error; },
    get selection() { return selection; },
    get playing() { return !media.paused && !media.ended; },
    get time() { return media.currentTime || 0; },
    get duration() { return Number.isFinite(media.duration) ? media.duration : 0; },
    matches,
    select,
    async toggle(song, mix) {
      if (matches(mix || song.mixes[0]) && !media.paused && !media.ended) { media.pause(); return; }
      if (!select(song, mix)) return;
      try { await media.play(); } catch (cause) {
        if (cause.name !== 'AbortError') { error = 'Unable to play this audio. Try again or open the audio file from its detail view.'; notify(); }
      }
    },
    seek(mix, value) { if (matches(mix) && Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(value, media.duration)); },
    subscribe(listener) { listeners.add(listener); listener(); return () => listeners.delete(listener); },
  };
}
