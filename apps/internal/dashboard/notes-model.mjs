// Notes remain the source of truth; these indexes are derived navigation only.
export function readingBody(content = '') {
  // Hide only a terminal, link-only section; prose with that heading survives.
  const section = /^## Related notes[ \t]*\r?\n([\s\S]*)$/m.exec(content);
  if (section && section[1].split(/\r?\n/).every(line => !line.trim() || /^- \[[^\]]+\]\([^)]+\)[ \t]*$/.test(line))) {
    return content.slice(0, section.index).trim();
  }
  return content.trim();
}

export function createNoteIndex(records = []) {
  const notes = records.filter(record => record.type === 'Note').map(record => ({
    ...record, body: readingBody(record.content),
    excerpt: readingBody(record.content).split(/\n\s*\n/)[0].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>]/g, '').trim(),
  }));
  const byId = new Map(notes.map(note => [note.id, note]));
  const outgoing = new Map(notes.map(note => [note.id, new Set()]));
  const incoming = new Map(notes.map(note => [note.id, new Set()]));
  for (const note of notes) for (const id of note.data.related_notes || []) {
    if (!byId.has(id)) continue;
    outgoing.get(note.id).add(id);
    incoming.get(id).add(note.id);
  }
  const neighbors = id => [...new Set([...(outgoing.get(id) || []), ...(incoming.get(id) || [])])].filter(other => other !== id);
  const degree = id => neighbors(id).length;
  const order = (a, b) => degree(b.id) - degree(a.id) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  const sorted = [...notes].sort(order);
  return {
    notes, byId, outgoing, incoming, neighbors, degree, sorted,
    linkCount: [...outgoing.values()].reduce((sum, links) => sum + links.size, 0),
    list({ query = '', scope = 'all', sort = 'connections' } = {}) {
      const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      return notes.filter(note => {
        const text = `${note.title} ${note.body}`.toLocaleLowerCase();
        return words.every(word => text.includes(word)) && (scope !== 'unlinked' || degree(note.id) === 0);
      }).sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id) : order);
    },
  };
}

export function readNoteLocation(search) {
  const params = new URLSearchParams(search);
  return { id: params.get('note') || '', query: params.get('q') || '',
    scope: params.get('scope') === 'unlinked' ? 'unlinked' : 'all',
    sort: params.get('sort') === 'title' ? 'title' : 'connections' };
}

export function noteLocation(state) {
  const params = new URLSearchParams();
  if (state.id) params.set('note', state.id);
  if (state.query) params.set('q', state.query);
  if (state.scope === 'unlinked') params.set('scope', 'unlinked');
  if (state.sort === 'title') params.set('sort', 'title');
  return 'notes.html' + (params.size ? `?${params}` : '');
}

export function neighborhood(index, id, limit = 8) {
  return index.neighbors(id).map(other => index.byId.get(other))
    .sort((a, b) => Number(index.outgoing.get(id).has(b.id)) - Number(index.outgoing.get(id).has(a.id)) || a.title.localeCompare(b.title))
    .slice(0, limit).map((note, i, items) => {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / items.length;
      return { note, x: 170 + Math.cos(angle) * 116, y: 154 + Math.sin(angle) * 111,
        outgoing: index.outgoing.get(id).has(note.id), incoming: index.incoming.get(id).has(note.id) };
    });
}
