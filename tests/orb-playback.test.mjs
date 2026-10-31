import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from '../apps/internal/dashboard/orb/playback.js';

class Media extends EventTarget {
  paused = true;
  ended = false;
  duration = NaN;
  currentTime = 0;
  loads = 0;
  load() { this.loads++; this.currentTime = 0; }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
}
const song = { id: 'first', title: 'First', mixes: [{ url: 'media/latest.mp3' }, { url: 'media/older.mp3' }] };
const other = { id: 'second', title: 'Second', mixes: [{ url: 'media/second.mp3' }] };

test('all controls share one track, retain position, and switch mixes only on explicit playback', async () => {
  const media = new Media(), playback = createPlayback(media, 'http://localhost');
  assert.equal(media.preload, 'none');
  assert.equal(playback.selection, null);
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
  media.play = Media.prototype.play;
  await playback.toggle(song);
  assert.equal(playback.error, '');
  assert.equal(playback.playing, true);
});
