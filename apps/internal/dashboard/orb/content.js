const spatialView = (label = 'Orbs', controls = {}) => ({ id: 'orb', label, presentation: 'orb', arrangement: 'free', controls });
const playerView = (controls = {}) => ({ id: 'player', label: 'Players', presentation: 'player', arrangement: 'free', controls });
const pageViews = (options, defaultId = options[0].id) => ({ default: defaultId, options });
const libraryControls = { search: true, arrangements: ['free', 'az'] };

// A small content boundary: the spatial UI never needs to know the catalog format.
export function createContentSource(songs, catalog, schema) {
  const songNodes = songs.map(song => ({ id: `song-${song.id}`, label: song.title, kind: 'Song', data: song }));
  const records = catalog.records || [];
  const albums = records.filter(record => record.type === 'Album').map(({ data: album }) => ({
    id: `album-${album.id}`, label: album.title, kind: 'Album', data: album, views: pageViews([spatialView('Track orbs'), playerView()]),
    children: records.filter(record => record.type === 'AlbumTrack' && record.data.album === album.id)
      .sort((a, b) => a.data.track_number - b.data.track_number)
      .map(({ data: track }) => ({ id: `track-${track.id}`, label: track.title || `Track ${track.track_number}`, kind: 'Album track',
        data: { ...track, song: songs.find(song => song.id === track.primary_song) } })),
  }));
  const root = { id: 'home', label: 'Home', children: [{ id: 'music', label: 'Music', pos: { x: .54, y: .5, size: .25 }, children: [
    { id: 'songs', label: 'Songs', children: songNodes, views: pageViews([spatialView('Orbs', libraryControls), playerView(libraryControls)]), pos: { x: .36, y: .44, size: .22 } },
    { id: 'albums', label: 'Albums', children: albums, views: pageViews([spatialView('Orbs', libraryControls)]), pos: { x: .72, y: .62, size: .16 } },
  ], views: pageViews([spatialView()]) }], views: pageViews([spatialView()]) };
  if (schema) {
    const children = Object.entries(schema.definitions).filter(([, definition]) => definition['x-model']).map(([type, definition]) => ({
      id: `type-${type}`, label: definition.title, kind: 'Schema type',
      data: { type, definition, schema, records: records.filter(record => record.type === type) },
      modelPosition: definition['x-model'].position,
    }));
    root.children.push({ id: 'model', label: 'Model', children, selection: true,
      views: pageViews([
        { id: 'relationships', label: 'Relationships', presentation: 'orb', arrangement: 'relationships', controls: { search: true } },
        spatialView('Scatter', { search: true }),
        { id: 'az', label: 'A–Z', presentation: 'orb', arrangement: 'az', controls: { search: true } },
      ]),
      relationships: schema['x-relations'].map(relation => ({ ...relation, source: `type-${relation.source}`, target: `type-${relation.target}` })),
      gaps: schema['x-gaps'],
    });
    // Keep Home's containers apart when both Music and Model are present.
    delete root.children[0].pos;
  }
  return { getRoot: () => root, getChildren: id => indexTree(root).get(id)?.node.children || [] };
}
export function indexTree(root) {
  const index = new Map();
  function visit(node, path) {
    if (index.has(node.id)) throw new Error(`Duplicate orb identity: ${node.id}`);
    index.set(node.id, { node, path: [...path, node.id] });
    node.children?.forEach(child => visit(child, [...path, node.id]));
  }
  visit(root, []);
  return index;
}
