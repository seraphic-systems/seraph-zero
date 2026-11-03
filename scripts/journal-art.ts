import { createHash } from 'node:crypto';

const number = (value: number) => Number(value.toFixed(2));

// Geometry depends on document structure, never on raw prose embedded in SVG.
// Quantized lengths keep small edits from rearranging the composition.
export function journalThumbnail(slug: string, html: string, colors: { background: string; accent: string }) {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const length = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/&[^;\s]+;/g, 'x').trim().split(/\s+/).filter(Boolean).length;
  const blocks = [...clean.matchAll(/<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
    .map(([, tag, body]) => ({ heading: /^h/i.test(tag), words: length(body) }));
  if (!blocks.length) blocks.push({ heading: false, words: length(clean) });
  const seed = createHash('sha256').update(slug).digest();
  const random = (index: number) => seed[index % seed.length] / 255;
  const total = blocks.reduce((sum, block) => sum + block.words, 0);
  const density = Math.min(1, Math.log2(1 + total) / 12);
  const rotation = number(random(0) * 180);
  const centerX = number(210 + random(1) * 60);
  const centerY = number(145 + random(2) * 30);
  const parts = [];
  const ellipse = (rx: number, ry: number, angle: number, opacity: number) => `<ellipse cx="${centerX}" cy="${centerY}" rx="${rx}" ry="${ry}" transform="rotate(${angle} ${centerX} ${centerY})" opacity="${opacity}"/>`;
  // A shared orbital skeleton holds together both sparse and dense entries.
  parts.push(ellipse(123, 123, 0, .35));
  parts.push(ellipse(123, number(38 + random(3) * 28), rotation, .65));
  parts.push(ellipse(123, number(38 + random(4) * 28), number(rotation + 60), .4));
  parts.push(`<circle cx="${centerX}" cy="${centerY}" r="${number(69 + density * 30)}" stroke-dasharray="2 7" opacity=".25"/>`);
  // Limit visual complexity and output size even for very long documents.
  const clusters = blocks.slice(0, 16).map((block, index) => {
    const angle = rotation * Math.PI / 180 + index * 2.39996;
    const distance = 42 + random(index + 5) * 65;
    const x = number(centerX + Math.cos(angle) * distance);
    const y = number(centerY + Math.sin(angle) * distance);
    const size = number(12 + Math.min(7, Math.floor(block.words / 30)) * 4);
    return { x, y, size, heading: block.heading };
  });
  parts.push(`<path d="M ${clusters.map(({ x, y }) => `${x} ${y}`).join(' L ')}" opacity=".3"/>`);
  for (const [index, { x, y, size, heading }] of clusters.entries()) {
    parts.push(`<circle cx="${x}" cy="${y}" r="${size}" opacity=".5"/>`);
    if (heading) {
      parts.push(`<path d="M ${x} ${number(y - size)} L ${number(x + size)} ${y} L ${x} ${number(y + size)} L ${number(x - size)} ${y} Z" fill="${colors.accent}" fill-opacity=".12"/>`);
    } else {
      parts.push(`<ellipse cx="${x}" cy="${y}" rx="${number(size * 1.65)}" ry="${number(size * .6)}" transform="rotate(${number(rotation + index * 30)} ${x} ${y})" opacity=".5"/>`);
    }
    parts.push(`<circle cx="${x}" cy="${y}" r="2.5" fill="${colors.accent}" stroke="none"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320" fill="none">
<rect width="480" height="320" fill="${colors.background}"/>
<g stroke="${colors.accent}" stroke-width=".85">${parts.join('\n')}</g>
</svg>\n`;
}
