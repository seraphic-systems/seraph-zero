const stylesheet = new URL('./audio-player.css', import.meta.url).href;

function time(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Token-themed controls over the browser's native audio engine. */
export class SeraphAudioPlayer extends HTMLElement {
  static observedAttributes = ['src', 'label'];

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <link rel="stylesheet" href="${stylesheet}">
      <div class="player" role="group" aria-label="Audio player">
        <audio preload="metadata"></audio>
        <div class="transport">
          <button class="play" type="button" aria-label="Play" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="m9 5 11 7-11 7Z"/><path class="pause-icon" d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>
          </button>
          <div class="timeline">
            <div class="time"><span class="elapsed">0:00</span><span class="duration">0:00</span></div>
            <input class="seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="Seek" disabled>
          </div>
        </div>
        <div class="secondary">
          <p class="status" role="status"></p>
          <div class="volume-controls">
            <button class="mute" type="button" aria-label="Mute" aria-pressed="false">Mute</button>
            <input class="volume" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
          </div>
        </div>
      </div>`;
    this.audio = root.querySelector('audio');
    this.playRequest = 0;
    this.ui = Object.fromEntries(['player', 'play', 'seek', 'elapsed', 'duration', 'status', 'mute', 'volume'].map((name) => [name, root.querySelector(`.${name}`)]));
    this.ui.play.addEventListener('click', async () => {
      if (!this.audio.paused) return this.audio.pause();
      const request = ++this.playRequest;
      const source = this.audio.src;
      try {
        await this.audio.play();
      } catch (error) {
        // Changing tracks or detaching cancels pending playback normally.
        if (request === this.playRequest && source === this.audio.src && error.name !== 'AbortError') this.ui.status.textContent = 'Unable to play this audio. Try opening the file directly.';
      }
    });
    this.ui.seek.addEventListener('input', () => {
      if (Number.isFinite(this.audio.duration)) this.audio.currentTime = Number(this.ui.seek.value);
      this.update();
    });
    this.ui.mute.addEventListener('click', () => { this.audio.muted = !this.audio.muted; });
    this.ui.volume.addEventListener('input', () => {
      this.audio.volume = Number(this.ui.volume.value);
      this.audio.muted = this.audio.volume === 0;
    });
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'emptied', 'volumechange']) {
      this.audio.addEventListener(event, () => this.update());
    }
    this.audio.addEventListener('pause', () => { if (this.audio.paused) this.playRequest++; });
    this.audio.addEventListener('waiting', () => { this.ui.status.textContent = 'Buffering…'; });
    this.audio.addEventListener('playing', () => { this.ui.status.textContent = ''; });
    this.audio.addEventListener('canplay', () => { this.ui.status.textContent = ''; });
    this.audio.addEventListener('error', () => {
      if (!this.audio.getAttribute('src')) return;
      this.update();
      this.ui.status.textContent = 'Unable to play this audio. Try opening the file directly.';
    });
  }

  attributeChangedCallback(name) {
    if (name === 'label') {
      this.ui.player.setAttribute('aria-label', this.getAttribute('label') || 'Audio player');
      return;
    }
    this.playRequest++;
    this.audio.pause();
    const source = this.getAttribute('src');
    if (source) this.audio.setAttribute('src', source);
    else this.audio.removeAttribute('src');
    this.ui.status.textContent = '';
    this.audio.load();
    this.update();
  }

  disconnectedCallback() { this.pause(); }

  get src() { return this.getAttribute('src') || ''; }
  set src(value) {
    if (value) this.setAttribute('src', value);
    else this.removeAttribute('src');
  }
  pause() { this.playRequest++; this.audio.pause(); }

  update() {
    const { audio, ui } = this;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const current = duration ? Math.min(audio.currentTime, duration) : 0;
    const playing = !audio.paused && !audio.ended;
    ui.play.disabled = !audio.getAttribute('src') || Boolean(audio.error);
    ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    ui.play.classList.toggle('playing', playing);
    ui.seek.disabled = !duration || Boolean(audio.error);
    ui.seek.max = duration;
    ui.seek.value = current;
    ui.seek.setAttribute('aria-valuetext', `${time(current)} of ${time(duration)}`);
    ui.seek.style.setProperty('--progress', `${duration ? current / duration * 100 : 0}%`);
    ui.elapsed.textContent = time(current);
    ui.duration.textContent = time(duration);
    const muted = audio.muted || audio.volume === 0;
    ui.mute.textContent = muted ? 'Unmute' : 'Mute';
    ui.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    ui.mute.setAttribute('aria-pressed', String(muted));
    ui.volume.value = audio.muted ? 0 : audio.volume;
    ui.volume.setAttribute('aria-valuetext', `${Math.round(Number(ui.volume.value) * 100)} percent`);
  }
}

if (!customElements.get('seraph-audio-player')) customElements.define('seraph-audio-player', SeraphAudioPlayer);
