// Pages opt into named views and controls. Renderer capabilities never add UI choices.
const fallback = { id: 'orb', label: 'Orbs', presentation: 'orb', arrangement: 'free', controls: {} };
export const availableViews = node => node.views?.options?.length ? node.views.options : [fallback];
export const defaultView = node => availableViews(node).find(view => view.id === node.views?.default) || availableViews(node)[0];
export const resolveView = (node, choice) => availableViews(node).find(view => view.id === choice) || defaultView(node);
export const resolveArrangement = (view, choice) => view.controls?.arrangements?.includes(choice) ? choice : view.arrangement;
export const resolveFilter = (view, value) => view.controls?.search ? value || '' : '';

const alphabetical = field => ({ field, direction: 'ascending', comparison: 'localeCompare (runtime locale)' });
export function arrangementConfiguration(node, view, arrangement = view.arrangement) {
  const sourceOrder = node.childOrder || [{ field: 'source order', direction: 'as supplied' }];
  if (arrangement === 'level') return {
    grouping: { field: 'groupLevel', derivedFrom: node.kind === 'Policy' ? 'Highest valid level among linked Horizons' : 'Horizon level', direction: 'ascending (1–4)', missing: 'last' },
    sorting: [{ field: 'groupLevel', direction: 'ascending', missing: 'last' }, alphabetical('label')],
    placement: 'Rows within each level, left to right, then top to bottom',
  };
  if (arrangement === 'relationships') return {
    grouping: null,
    sorting: sourceOrder,
    placement: 'Schema modelPosition: row ascending, then column ascending; missing coordinates use 0. Wide maps preserve schema slots; narrow maps pack in that order. Shared slots advance to the next free slot.',
  };
  return {
    grouping: null,
    sorting: arrangement === 'az' ? [alphabetical('label')] : sourceOrder,
    placement: view.presentation === 'samples' ? 'List, top to bottom'
      : view.presentation === 'player' ? 'Cards, left to right, then top to bottom'
        : arrangement === 'az' ? 'Columns, top to bottom, then left to right'
          : 'Repeatable scatter seeded by item ID; explicit item positions take priority. Spatial position does not indicate sort order.',
  };
}

export const viewConfiguration = (node, view, state) => ({
  page: node.id,
  default: defaultView(node).id === view.id,
  preset: view,
  ...arrangementConfiguration(node, view),
  ...(resolveView(node, state.view?.[node.id]).id === view.id ? { current: {
    presentation: view.presentation,
    arrangement: resolveArrangement(view, state.arrangement?.[node.id]),
    filter: view.filter || {},
    query: resolveFilter(view, state.filter),
    ...arrangementConfiguration(node, view, resolveArrangement(view, state.arrangement?.[node.id])),
  } } : {}),
});

// A preset owns its filters; search and sorting are separate, opt-in controls.
export const matchesView = (view, node) => Object.entries(view.filter || {}).every(([key, value]) => node[key] === value);
export const viewPanelHeight = node => availableViews(node).length > 3 ? 300 : 220;

export const hasFindControls = view => !!(view.controls?.search || view.controls?.arrangements?.length > 1);
export const isFindActive = (view, state, id) => !!resolveFilter(view, state.filter).trim() || resolveArrangement(view, state.arrangement?.[id]) !== view.arrangement;
