// Pages opt into named views and controls. Renderer capabilities never add UI choices.
const fallback = { id: 'orb', label: 'Orbs', presentation: 'orb', arrangement: 'free', controls: {} };
export const availableViews = node => node.views?.options?.length ? node.views.options : [fallback];
export const defaultView = node => availableViews(node).find(view => view.id === node.views?.default) || availableViews(node)[0];
export const resolveView = (node, choice) => availableViews(node).find(view => view.id === choice) || defaultView(node);
export const resolveArrangement = (view, choice) => view.controls?.arrangements?.includes(choice) ? choice : view.arrangement;
export const resolveFilter = (view, value) => view.controls?.search ? value || '' : '';
