// Navigation, View, and Find are mutually exclusive. The player may coexist
// with View or Find, but opening navigation closes it without stopping audio.
export const initialPanelState = Object.freeze({ panel: 'none', player: 'closed' });

const toggles = {
  none: { toggleNav: 'nav', toggleView: 'view', toggleFind: 'find' },
  nav: { toggleNav: 'none' },
  view: { toggleNav: 'nav', toggleView: 'none', toggleFind: 'find' },
  find: { toggleNav: 'nav', toggleView: 'view', toggleFind: 'none' },
};

// Escape dismisses one layer before the app handles detail/model selection.
export function panelToDismiss(state) {
  if (state.panel === 'find') return 'find';
  if (state.player === 'open') return 'player';
  return state.panel === 'none' ? null : state.panel;
}

export function transitionPanels(state, event) {
  let { panel, player } = state;
  const target = toggles[panel]?.[event];
  if (target) {
    panel = target;
    if (panel === 'nav') player = 'closed';
  } else switch (event) {
    case 'togglePlayer':
      if (panel !== 'nav') player = player === 'open' ? 'closed' : 'open';
      break;
    case 'closePlayer': player = 'closed'; break;
    case 'outsideFind':
      if (panel === 'find') panel = 'none';
      break;
    case 'navigate': panel = 'none'; break;
    case 'escape':
      if (panelToDismiss(state) === 'player') player = 'closed';
      else if (panelToDismiss(state)) panel = 'none';
      break;
  }
  return panel === state.panel && player === state.player
    ? state : Object.freeze({ panel, player });
}
