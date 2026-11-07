import { createHash } from 'node:crypto';

const number = (value: number) => Number(value.toFixed(1));

// Geometry depends on document structure, never on raw prose embedded in SVG.
// Quantized lengths keep small edits from rearranging the composition.
export function journalThumbnail(slug: string, html: string, colors: { accent: string }) {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const length = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/&[^;\s]+;/g, 'x').trim().split(/\s+/).filter(Boolean).length;
  const blocks = [...clean.matchAll(/<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
    .map(([, tag, body]) => ({ heading: /^h/i.test(tag), words: length(body) }));
  if (!blocks.length) blocks.push({ heading: false, words: length(clean) });
  const seed = createHash('sha256').update(slug).digest();
  const random = (index: number) => seed[index % seed.length] / 255;
  const total = blocks.reduce((sum, block) => sum + Math.floor(block.words / 30), 0);
  const density = Math.min(1, Math.log2(1 + total) / 8);
  const headings = blocks.filter(block => block.heading).length;
  const phase = random(0) * Math.PI * 2;
  const tilt = (random(1) - .5) * .8;
  const rings = 22;
  const parts: string[] = [];
  // A family of nested contours: an offset core opens into a broad, organic seal.
  // Low-frequency waves keep the silhouette legible at the listing's small size.
  for (let ring = 0; ring < rings; ring++) {
    const depth = ring / (rings - 1);
    const radius = 10 + depth * 116;
    const centerX = 240 + (1 - depth) * (22 + random(2) * 18);
    const centerY = 160 - (1 - depth) * (12 + random(3) * 16);
    const points: { x: number; y: number }[] = [];
    for (let step = 0; step < 24; step++) {
      const angle = step / 24 * Math.PI * 2;
      const wave = 1 + (.09 + density * .035) * Math.sin(3 * angle + phase + depth * .7)
        + .045 * Math.cos(2 * angle - phase) + .025 * Math.sin(5 * angle + headings * .3);
      const x = radius * wave * Math.cos(angle);
      const y = radius * wave * Math.sin(angle) * .92;
      points.push({ x: centerX + x * Math.cos(tilt) - y * Math.sin(tilt), y: centerY + x * Math.sin(tilt) + y * Math.cos(tilt) });
    }
    const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      `${number((a.x + b.x) / 2)},${number((a.y + b.y) / 2)}`;
    const start = midpoint(points[points.length - 1]!, points[0]!);
    const curves = points.map((point, index) =>
      `Q${number(point.x)},${number(point.y)} ${midpoint(point, points[(index + 1) % points.length]!)}`).join('');
    // A few deliberate breaks give the contours a fingerprint's interrupted rhythm.
    const broken = ring % 5 === 2;
    parts.push(`<path d="M${start}${curves}Z"${broken ? ` pathLength="100" stroke-dasharray="${number(83 + random(ring + 4) * 9)} 100" stroke-dashoffset="${number(random(ring + 8) * 100)}"` : ''}/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320" fill="none">
<g stroke="${colors.accent}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${parts.join('\n')}</g>
</svg>\n`;
}
