const $ = selector => document.querySelector(selector);
const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
let pages = [];
let state;
function readLocation() {
  const params = new URLSearchParams(location.search);
  state = { id: params.get('page') || '', query: params.get('q') || '' };
  $('#page-search').value = state.query;
}
function pageURL(id) {
  const params = new URLSearchParams();
  if (id) params.set('page', id);
  if (state.query) params.set('q', state.query);
  return `pages.html${params.size ? `?${params}` : ''}`;
}
function renderLibrary() {
  const matches = pages.filter(page => `${page.title}\n${page.content}`.toLowerCase().includes(state.query.toLowerCase()));
  $('#page-list').replaceChildren();
  $('#result-count').textContent = `${matches.length} of ${pages.length} pages`;
  for (const page of matches) {
    const link = el('a', '');
    link.className = 'note-row';
    link.href = pageURL(page.id);
    link.dataset.pageId = page.id;
    link.append(el('strong', page.title));
    if (page.id === state.id) link.setAttribute('aria-current', 'page');
    $('#page-list').append(link);
  }
  if (!matches.length) $('#page-list').append(el('p', pages.length ? 'No pages match your search.' : 'No pages yet.'));
}
function renderReader() {
  const page = pages.find(page => page.id === state.id);
  $('#page-about').hidden = !page;
  $('#page-prose').replaceChildren();
  $('#page-title').textContent = page?.title || (pages.length ? 'Page not found' : 'Your first page');
  $('#page-byline').textContent = page ? `${page.data.visibility === 'public' ? 'Public' : 'Private'} page` : '';
  if (!page) {
    $('#page-prose').append(el('p', pages.length ? 'Choose a page from the library.' : 'Create a Page, then add your title and text in its Markdown file.'));
    return;
  }
  // HTML comes from the restricted Markdown renderer at the internal build boundary.
  $('#page-prose').innerHTML = page.html;
  if (!page.content.trim()) $('#page-prose').append(el('p', 'This page is waiting for its first words.'));
  $('#page-about').open = false;
  $('#page-metadata').replaceChildren();
  for (const [label, value] of [['Record', page.source], ['Created', page.data.created_at || 'Unknown']]) {
    $('#page-metadata').append(el('dt', label), el('dd', value));
  }
}
function selectPage(id) {
  state.id = id;
  history.pushState(null, '', pageURL(id));
  renderLibrary(); renderReader();
  $('#page-title').focus();
}
try {
  const response = await fetch('pages.json');
  if (!response.ok) throw new Error('Page library unavailable');
  pages = (await response.json()).sort((a, b) => a.title.localeCompare(b.title));
  readLocation();
  if (!state.id && pages.length) state.id = pages[0].id;
  history.replaceState(null, '', pageURL(state.id));
  renderLibrary(); renderReader();
  $('#pages-status').textContent = '';
  $('#pages-workspace').hidden = false;
  $('#page-search').addEventListener('input', () => {
    state.query = $('#page-search').value;
    history.replaceState(null, '', pageURL(state.id)); renderLibrary();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-page-id]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); selectPage(link.dataset.pageId);
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault(); $('#page-search').focus();
    }
    if (event.key === 'Escape' && event.target === $('#page-search')) {
      event.preventDefault(); $('#page-search').value = ''; $('#page-search').dispatchEvent(new Event('input'));
    }
  });
  addEventListener('popstate', () => { readLocation(); renderLibrary(); renderReader(); });
} catch {
  $('#pages-status').textContent = 'The page library could not be loaded. Refresh to try again.';
}
