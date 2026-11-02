import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal custom-element surface: exercise transport requests without a browser
// decoder or real audio files. Rendering and keyboard behavior are checked in UI.
class Control extends EventTarget {
  textContent = '';
  value = '0';
  attributes = new Map();
  classList = { toggle() {} };
  style = { setProperty() {} };
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
}
class Element extends Control {
  attachShadow() {
    const controls = new Map();
    return { set innerHTML(value) {}, querySelector(selector) {
      if (!controls.has(selector)) controls.set(selector, new Control());
      return controls.get(selector);
    } };
  }
}
const originalElement = globalThis.HTMLElement;
const originalRegistry = globalThis.customElements;
globalThis.HTMLElement = Element;
globalThis.customElements = { get() { return true; } };
const { SeraphAudioPlayer } = await import('../shared/components/audio-player/audio-player.js');
globalThis.HTMLElement = originalElement;
globalThis.customElements = originalRegistry;

function setup() {
  const player = new SeraphAudioPlayer(), attempts = [];
  Object.assign(player.audio, {
    paused: true, ended: false, duration: NaN, currentTime: 0, volume: 1, src: 'first.mp3',
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
    load() {},
    play() { return new Promise((resolve, reject) => attempts.push({ resolve, reject })); },
  });
  return { player, attempts, click: () => player.ui.play.dispatchEvent(new Event('click')) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('the shared transport ignores failures superseded by a new request, source, or pause', async () => {
  for (const supersede of ['request', 'source', 'attribute', 'pause', 'detach']) {
    const { player, attempts, click } = setup();
    click();
    if (supersede === 'request') { click(); attempts[1].resolve(); }
    else if (supersede === 'source') player.audio.src = 'second.mp3';
    else if (supersede === 'attribute') {
      player.setAttribute('src', 'second.mp3');
      player.attributeChangedCallback('src');
    } else if (supersede === 'detach') player.disconnectedCallback();
    else player.pause();
    attempts[0].reject(new Error('Obsolete failure'));
    await flush();
    assert.equal(player.ui.status.textContent, '', supersede);
  }
});

test('the shared transport still reports current failures and ignores AbortError', async () => {
  for (const error of [new Error('Unavailable'), new DOMException('Interrupted', 'AbortError')]) {
    const { player, attempts, click } = setup();
    click();
    attempts[0].reject(error);
    await flush();
    assert.equal(Boolean(player.ui.status.textContent), error.name !== 'AbortError');
  }
});
