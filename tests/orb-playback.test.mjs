import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from '../apps/seraphic-systems/orb/playback.js';

class Media extends EventTarget {
  paused = true;
  ended = false;
  duration = NaN;
  currentTime = 0;
  loads = 0;
  error = null;
  load() { this.loads++; this.currentTime = 0; this.ended = false; this.error = null; }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  async play() { this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); }
}
const song = { id: 'first', title: 'First', mixes: [{ url: 'media/latest.mp3' }, { url: 'media/older.mp3' }] };
const other = { id: 'second', title: 'Second', mixes: [{ url: 'media/second.mp3' }] };

test('all controls share one track, retain position, and switch mixes only on explicit playback', async () => {
  const media = new Media(), playback = createPlayback(media, 'http://localhost');
  assert.equal(media.preload, 'none');
  assert.equal(playback.selection, null);
  assert.equal(playback.state.status, 'empty');
  await playback.toggle(song);
  assert.equal(playback.selection.mix, song.mixes[0]);
  assert.equal(media.src, 'http://localhost/media/latest.mp3');
  assert.equal(playback.playing, true);
  media.duration = 200;
  media.currentTime = 42;
  await playback.toggle(song);
  assert.equal(playback.playing, false);
  await playback.toggle(song);
  assert.equal(media.currentTime, 42);
  assert.equal(media.loads, 1);
  playback.seek(song.mixes[1], 90);
  assert.equal(media.currentTime, 42);
  playback.seek(song.mixes[0], 999);
  assert.equal(media.currentTime, 200);
  await playback.toggle(song, song.mixes[1]);
  assert.equal(media.loads, 2);
  assert.equal(media.currentTime, 0);
  assert.equal(playback.matches(song.mixes[0]), false);
  await playback.toggle(other);
  assert.equal(playback.selection.song, other);
  assert.equal(media.loads, 3);
});

test('subscriptions can unmount without interrupting playback and missing mixes do not replace it', async () => {
  const media = new Media(), playback = createPlayback(media, 'http://localhost');
  let notifications = 0;
  const unsubscribe = playback.subscribe(() => notifications++);
  await playback.toggle(song);
  unsubscribe();
  const before = notifications;
  media.dispatchEvent(new Event('timeupdate'));
  assert.equal(notifications, before);
  await playback.toggle({ title: 'No mixes', mixes: [] });
  assert.equal(playback.selection.song, song);
  assert.equal(playback.playing, true);
});

test('play failures are observable and a later attempt can recover', async () => {
  const media = new Media(), playback = createPlayback(media, 'http://localhost');
  media.play = async () => { throw new Error('Unavailable'); };
  await playback.toggle(song);
  assert.match(playback.error, /Unable to play/);
  assert.equal(playback.state.status, 'error');
  media.play = Media.prototype.play;
  await playback.toggle(song);
  assert.equal(playback.error, '');
  assert.equal(playback.playing, true);
  assert.equal(playback.state.status, 'playing');
});

function deferredMedia() {
  const media = new Media(), attempts = [];
  media.play = () => {
    media.paused = false;
    media.ended = false;
    media.dispatchEvent(new Event('play'));
    return new Promise((resolve, reject) => attempts.push({ resolve, reject }));
  };
  return { media, attempts, playback: createPlayback(media, 'http://localhost') };
}

test('native player events drive preparing, buffering, playing, paused, ended, and error states', () => {
  const media = new Media(), playback = createPlayback(media, 'http://localhost');
  const statuses = [];
  playback.subscribe(() => statuses.push(playback.state.status));
  playback.select(song);
  assert.equal(playback.state.status, 'ready');
  media.paused = false;
  for (const event of ['play', 'waiting', 'playing']) media.dispatchEvent(new Event(event));
  media.pause();
  media.ended = true;
  media.dispatchEvent(new Event('ended'));
  media.error = { code: 3 };
  media.dispatchEvent(new Event('error'));
  assert.deepEqual(statuses, ['empty', 'ready', 'preparing', 'buffering', 'playing', 'paused', 'ended', 'error']);
  assert.match(playback.error, /Unable to play/);
  assert.equal(playback.playing, false);
  media.dispatchEvent(new Event('pause'));
  assert.equal(playback.state.status, 'error');
  playback.select(other);
  assert.equal(playback.state.status, 'ready');
  assert.equal(playback.error, '');
});

test('a failed obsolete play request cannot overwrite a newer track or notify its subscribers', async () => {
  const { media, attempts, playback } = deferredMedia();
  const first = playback.toggle(song);
  const second = playback.toggle(other);
  media.dispatchEvent(new Event('playing'));
  attempts[1].resolve();
  await second;
  let notifications = 0;
  playback.subscribe(() => notifications++);
  attempts[0].reject(new Error('Old track unavailable'));
  await first;
  assert.equal(playback.selection.song, other);
  assert.equal(playback.state.status, 'playing');
  assert.equal(playback.error, '');
  assert.equal(notifications, 1);
});

test('obsolete successes and failures cannot overwrite the latest failure', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const { attempts, playback } = deferredMedia();
    const first = playback.toggle(song);
    const second = playback.toggle(other);
    attempts[1].reject(new Error('Current track unavailable'));
    await second;
    const failed = playback.state;
    attempts[0][outcome](new Error('Old track unavailable'));
    await first;
    assert.equal(playback.state, failed);
    assert.equal(playback.selection.song, other);
    assert.equal(playback.state.status, 'error');
  }
});

test('pausing or selecting another track invalidates a pending failure', async () => {
  for (const cancel of ['toggle', 'native-pause', 'select']) {
    const { media, attempts, playback } = deferredMedia();
    const pending = playback.toggle(song);
    assert.equal(playback.state.status, 'preparing');
    if (cancel === 'toggle') await playback.toggle(song);
    else if (cancel === 'native-pause') media.pause();
    else playback.select(other);
    attempts[0].reject(new Error('Cancelled request failed'));
    await pending;
    assert.equal(playback.state.status, cancel === 'select' ? 'ready' : 'paused');
    assert.equal(playback.error, '');
  }
});

test('delayed source reset and pause events do not cancel current playback or hide its failure', async () => {
  const { media, attempts, playback } = deferredMedia();
  const pending = playback.toggle(song);
  media.dispatchEvent(new Event('emptied'));
  media.dispatchEvent(new Event('pause')); // Queued pause from the old source; current media is unpaused.
  assert.equal(playback.state.status, 'preparing');
  attempts[0].reject(new Error('Current request failed'));
  await pending;
  assert.equal(playback.state.status, 'error');
});

test('an aborted current request returns to paused without an error and can retry', async () => {
  const { media, attempts, playback } = deferredMedia();
  const pending = playback.toggle(song);
  media.paused = true;
  attempts[0].reject(new DOMException('Interrupted', 'AbortError'));
  await pending;
  assert.equal(playback.state.status, 'paused');
  assert.equal(playback.error, '');
  const retry = playback.toggle(song);
  media.dispatchEvent(new Event('playing'));
  attempts[1].resolve();
  await retry;
  assert.equal(playback.state.status, 'playing');
  assert.equal(media.loads, 1);
});

test('retrying a native media failure reloads the same source and clears the error', async () => {
  const media = new Media(), playback = createPlayback(media, 'http://localhost');
  await playback.toggle(song);
  media.error = { code: 2 };
  media.dispatchEvent(new Event('error'));
  assert.equal(playback.state.status, 'error');
  await playback.toggle(song);
  assert.equal(media.loads, 2);
  assert.equal(playback.state.status, 'playing');
  assert.equal(playback.error, '');
});
