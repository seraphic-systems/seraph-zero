const playbackError = 'Unable to play this audio. Try again or open the audio file from its detail view.';
const activeStates = new Set(['preparing', 'playing', 'buffering']);

// One media element owns playback; list, detail, and the player Orb are controls.
// Commands and native media events enter the same machine, including controls
// in the persistent player's shadow DOM. Only the current play request may fail.
export function createPlayback(media, origin) {
  let state = Object.freeze({ status: 'empty', selection: null, error: '' });
  let request = 0, changingSource = false;
  media.preload = 'none';
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  function transition(event, selection = state.selection) {
    let status = state.status;
    switch (event) {
      case 'select': status = 'ready'; break;
      case 'play': status = 'preparing'; break;
      case 'playing': status = 'playing'; break;
      case 'waiting':
        if (!activeStates.has(status)) return;
        status = 'buffering'; break;
      case 'pause': status = media.ended ? 'ended' : 'paused'; break;
      case 'ended': status = 'ended'; break;
      case 'error': status = 'error'; break;
      case 'retry':
        if (status === 'error') status = 'paused';
        break;
      default: return;
    }
    if (!selection) status = 'empty';
    state = Object.freeze({ status, selection, error: status === 'error' ? playbackError : '' });
    notify();
  }
  for (const event of ['play', 'playing', 'waiting', 'pause', 'ended', 'error']) {
    media.addEventListener(event, () => {
      if (changingSource) return;
      // Media events are queued: a previous source's pause can arrive after the
      // next source has already started. Check the element's current condition.
      if (['play', 'playing', 'waiting'].includes(event) && media.paused) return;
      if (event === 'pause' && (!media.paused || state.status === 'error')) return;
      if (event === 'ended' && !media.ended) return;
      if (event === 'error' && !media.error) return;
      if (['pause', 'ended', 'error'].includes(event)) request++;
      transition(event);
    });
  }
  // load() queues emptied even when a subsequent play() is already pending.
  // Source selection, rather than this delayed event, resets the machine.
  for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'emptied']) media.addEventListener(event, notify);
  const matches = mix => !!mix && state.selection?.mix.url === mix.url;
  function select(song, mix = song.mixes[0]) {
    if (!mix) return false;
    if (!matches(mix) || media.error) {
      request++;
      changingSource = true;
      try {
        media.pause();
        media.src = new URL('/' + mix.url, origin).href;
        media.load();
      } finally { changingSource = false; }
      transition('select', { song, mix });
    } else transition('retry', { song, mix });
    return true;
  }
  return {
    get state() { return state; },
    get error() { return state.error; },
    get selection() { return state.selection; },
    // Preparing/buffering retain the pause action while playback is requested.
    get playing() { return activeStates.has(state.status); },
    get time() { return media.currentTime || 0; },
    get duration() { return Number.isFinite(media.duration) ? media.duration : 0; },
    matches,
    select,
    async toggle(song, mix) {
      if (matches(mix || song.mixes[0]) && activeStates.has(state.status)) {
        request++;
        media.pause();
        transition('pause');
        return;
      }
      if (!select(song, mix)) return;
      const ticket = ++request;
      transition('play');
      try { await media.play(); } catch (cause) {
        if (ticket !== request) return;
        transition(cause.name === 'AbortError' ? 'pause' : 'error');
      }
    },
    seek(mix, value) { if (matches(mix) && Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(value, media.duration)); },
    subscribe(listener) { listeners.add(listener); listener(); return () => listeners.delete(listener); },
  };
}
