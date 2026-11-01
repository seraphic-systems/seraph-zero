// Presentation capabilities and geometry stay independent of DOM and catalog data.
export const presentations = {
  orb: { label: 'Orbs', supports: () => true },
  samples: {
    label: 'Sample library',
    arrangementLabels: { free: 'Group order' },
    supports: node => node.kind === 'Music fragment',
    layout(region, children) {
      const height = region.w < 500 ? 194 : 134, gap = 10;
      return { height: children.length * (height + gap),
        items: children.map((node, i) => ({ x: region.x, y: region.y + i * (height + gap), width: region.w, height })) };
    },
  },
  player: {
    label: 'Players',
    arrangementLabels: { free: 'Library order' },
    supports: node => node.kind === 'Song' || node.kind === 'Album track',
    layout(region, children) {
      const columns = Math.max(1, Math.floor((region.w + 20) / 320));
      const width = (region.w - (columns - 1) * 20) / columns, height = 172;
      return { height: Math.ceil(children.length / columns) * (height + 20),
        items: children.map((node, i) => ({ x: region.x + (i % columns) * (width + 20),
          y: region.y + Math.floor(i / columns) * (height + 20), width, height })) };
    },
  },
};
