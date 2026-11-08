export const defaultVisuals = {
  red: '#ff3d6e', green: '#5fffb0', blue: '#4fd1ff', cyan: '#9ae6ff',
  face: '#0b0f1e', deepFace: '#020309', glow: 1, split: 1, timing: 1,
};
export type VisualSettings = typeof defaultVisuals;
export interface VisualPreset { id: string; name: string; settings: VisualSettings }
export const presetStorageKey = 'seraph-workshop:visual-presets:v1';
export const visualRanges = { glow: [0, 2, .05], split: [0, 3, .05], timing: [.25, 3, .05] } as const;

export function isVisualSettings(value: unknown): value is VisualSettings {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  for (const key of ['red', 'green', 'blue', 'cyan', 'face', 'deepFace'] as const) {
    if (typeof record[key] !== 'string' || !/^#[0-9a-f]{6}$/iu.test(record[key])) return false;
  }
  for (const key of ['glow', 'split', 'timing'] as const) {
    const number = record[key];
    const [min, max] = visualRanges[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) return false;
  }
  return Object.keys(record).length === Object.keys(defaultVisuals).length;
}

// Persist visual choices only. Reject malformed data rather than applying arbitrary CSS.
export function parsePresets(raw: string | null): VisualPreset[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('presets' in data) || !Array.isArray(data.presets) || data.presets.length > 50) throw new Error('Invalid preset library');
  const ids = new Set<string>();
  const names = new Set<string>();
  return data.presets.map((preset: unknown) => {
    if (!preset || typeof preset !== 'object' || !('id' in preset) || typeof preset.id !== 'string' || !preset.id || preset.id.length > 100 || ids.has(preset.id)
      || !('name' in preset) || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 60 || names.has(preset.name.toLowerCase())
      || !('settings' in preset) || !isVisualSettings(preset.settings)) throw new Error('Invalid preset library');
    ids.add(preset.id); names.add(preset.name.toLowerCase());
    return { id: preset.id, name: preset.name, settings: { ...preset.settings } };
  });
}

export function visualProperties(settings: VisualSettings): Record<string, string> {
  const { glow, split, timing } = settings;
  const properties: Record<string, string> = {
    '--color-light-red': settings.red, '--color-light-green': settings.green,
    '--color-light-blue': settings.blue, '--color-light-cyan': settings.cyan,
    '--color-night': settings.face, '--color-night-deep': settings.deepFace,
    '--workshop-glow': String(glow), '--workshop-split': String(split), '--workshop-timing': String(timing),
    '--effect-rgb-opacity-rest': String(split === 0 ? 0 : .75),
    '--effect-rgb-opacity-interactive': String(split === 0 ? 0 : .95),
    '--effect-glow-opacity-interactive': String(Math.min(1, .45 * glow)),
  };
  for (const [key, base] of Object.entries({rest: 1.7, interactive: 2.6, peak: 3.5})) properties[`--effect-rgb-split-${key}`] = `${base * split}px`;
  for (const [key, base] of Object.entries({rest: 2, interactive: 4, aura: 26})) properties[`--effect-glow-radius-${key}`] = `${base * glow}px`;
  for (const [key, base] of Object.entries({feedback: 180, hover: 220, pulse: 480, unfold: 1100, settle: 1400, trace: 1500, reveal: 1800, awaken: 2800})) properties[`--motion-${key}`] = `${base * timing}ms`;
  return properties;
}
