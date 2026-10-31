// Pages opt into named views and controls. Renderer capabilities never add UI choices.
const fallback = { id: 'orb', label: 'Orbs', presentation: 'orb', arrangement: 'free', controls: {} };
export const availableViews = node => node.views?.options?.length ? node.views.options : [fallback];
export const defaultView = node => availableViews(node).find(view => view.id === node.views?.default) || availableViews(node)[0];
export const resolveView = (node, choice) => availableViews(node).find(view => view.id === choice) || defaultView(node);
export const resolveArrangement = (view, choice) => view.controls?.arrangements?.includes(choice) ? choice : view.arrangement;
export const resolveFilter = (view, value) => view.controls?.search ? value || '' : '';

// A preset owns its filters; search and sorting are separate, opt-in controls.
export const matchesView = (view, node) => Object.entries(view.filter || {}).every(([key, value]) => node[key] === value);
export const viewPanelHeight = node => availableViews(node).length > 3 ? 300 : 220;

export const hasFindControls = view => !!(view.controls?.search || view.controls?.arrangements?.length > 1);
export const isFindActive = (view, state, id) => !!resolveFilter(view, state.filter).trim() || resolveArrangement(view, state.arrangement?.[id]) !== view.arrangement;
