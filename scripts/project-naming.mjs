import path from 'node:path';

// Accept display titles and filename-friendly Song IDs without changing identity.
function normalize(name) {
  return name.normalize('NFKC').toLowerCase().replace(/['’]/gu, '')
    .replace(/[\s_-]+/gu, '-');
}

export function lintProjectNames(records) {
  const prefixes = records.filter((row) => row.type === 'Song')
    .flatMap((row) => [row.id, row.data.title]).map(normalize).filter(Boolean);
  const diagnostics = [];
  const currentSets = new Map(records.filter((row) => row.type === 'LiveSet')
    .map((row) => [path.posix.normalize(row.data.paths.at(-1)), row]));
  function check(row, location, kind) {
    const basename = path.posix.basename(location);
    const name = normalize(kind === 'set' ? basename.replace(/\.als$/iu, '')
      : basename.replace(/ Project$/iu, ''));
    if ((name.startsWith('idea-') && name.length > 5) || prefixes.some((prefix) =>
      name === prefix || (name.startsWith(prefix + '-') && name.length > prefix.length + 1))) return;
    diagnostics.push({ rule: 'project-set-name', record: row.key, source: row.source,
      path: location, message: `${kind === 'set' ? 'Set' : 'Project'} name must start with idea-<name> or an existing Song title/ID (followed by a separator before any suffix).` });
  }
  for (const row of records) {
    if (row.type === 'Project') {
      const folder = path.posix.join('~/Ableton', row.data.folder);
      check(row, folder, 'project');
      for (const set of row.data.sets) {
        const location = path.posix.join(folder, set);
        // Registered paths belong to their LiveSet diagnostic; inventory-only sets
        // still need checking when the library is offline or not yet scanned.
        if (!currentSets.has(location)) check(row, location, 'set');
      }
    }
    if (row.type === 'LiveSet') check(row, row.data.paths.at(-1), 'set');
  }
  return diagnostics;
}
