import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultVisuals, isVisualSettings, parsePresets, visualProperties } from '../workshop/visual-settings.ts';

const preset = { id: 'quiet', name: 'Quiet cyan', settings: { ...defaultVisuals, glow: .5, timing: 2 } };
test('visual presets round-trip only the supported settings and reject unsafe stored data', () => {
  assert.deepEqual(parsePresets(null), []);
  assert.deepEqual(parsePresets(JSON.stringify({ version: 1, presets: [preset] })), [preset]);
  for (const settings of [
    { ...defaultVisuals, blue: 'url(https://example.com)' },
    { ...defaultVisuals, timing: 0 }, { ...defaultVisuals, glow: 3 },
    { ...defaultVisuals, split: NaN }, { ...defaultVisuals, writing: 'Do not persist' },
  ]) assert.equal(isVisualSettings(settings), false);
  for (const data of [
    '{', JSON.stringify({ version: 2, presets: [preset] }),
    JSON.stringify({ version: 1, presets: [preset, preset] }),
    JSON.stringify({ version: 1, presets: [{ ...preset, name: '' }] }),
    JSON.stringify({ version: 1, presets: [preset, { ...preset, id: 'other', name: 'QUIET CYAN' }] }),
    JSON.stringify({ version: 1, presets: Array.from({length: 51}, (_, i) => ({ ...preset, id: String(i), name: String(i) })) }),
  ]) assert.throws(() => parsePresets(data));
});

test('visual multipliers scale CSS timing and effects, with zero disabling the decorative split', () => {
  const properties = visualProperties({ ...defaultVisuals, glow: 0, split: 0, timing: 2 });
  assert.equal(properties['--effect-rgb-opacity-rest'], '0');
  assert.equal(properties['--effect-rgb-opacity-interactive'], '0');
  assert.equal(properties['--effect-glow-radius-rest'], '0px');
  assert.equal(properties['--effect-glow-opacity-interactive'], '0');
  assert.equal(properties['--motion-pulse'], '960ms');
  assert.equal(properties['--workshop-timing'], '2');
  assert.equal(properties['--color-light-cyan'], defaultVisuals.cyan);
  assert.equal(properties['--color-night-deep'], defaultVisuals.deepFace);
  assert.equal(Object.keys(properties).some(key => /text|font|writing/u.test(key)), false);
});
