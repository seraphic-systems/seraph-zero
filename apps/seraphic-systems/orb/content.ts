import type { Catalog, ContentSource } from './types.ts';

export const horizonLevels = ['Values', 'Guiding principles', 'Long-term vision', 'Near-term goals'];

// The adapter owns content policy. Only Horizons and one presentation are active.
export function createContentSource(catalog: Catalog): ContentSource {
  return {
    id: 'horizons', label: 'Horizons',
    views: { default: 'orb', options: [{ id: 'orb', presentation: 'orb', arrangement: 'level', controls: {} }] },
    children: catalog.records.filter(record => record.type === 'Horizon').map(record => ({
      id: record.data.id, label: record.data.title, level: record.data.level,
      description: record.data.description, createdAt: record.data.created_at,
      content: record.content, contentHtml: record.contentHtml,
    })),
  };
}
