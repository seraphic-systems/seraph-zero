import path from 'node:path';
import { marked } from 'marked';
import { readingBody } from '../apps/internal/dashboard/notes-model.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function noteContent(records, type = 'Note') {
  const isPage = type === 'Page';
  const route = isPage ? 'pages.html?page' : 'notes.html?note';
  const attribute = isPage ? 'data-page-id' : 'data-note-id';
  const notes = records.filter(record => record.type === type);
  const bySource = new Map(notes.map(note => [note.source, note]));
  return notes.map(note => {
    const renderer = new marked.Renderer();
    renderer.html = ({ text }) => escape(text);
    renderer.image = ({ text }) => escape(text); // Reading never loads remote tracking images.
    renderer.link = function ({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const target = bySource.get(path.posix.normalize(path.posix.join(path.posix.dirname(note.source), href.split(/[?#]/)[0])));
      if (target) return `<a href="${route}=${encodeURIComponent(target.id)}" ${attribute}="${escape(target.id)}">${label}</a>`;
      try {
        const url = new URL(href);
        if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return `<a href="${escape(url.href)}" rel="noreferrer">${label}</a>`;
      } catch { /* Unresolved local source references remain readable text. */ }
      return label;
    };
    return { ...note, html: marked.parse(isPage ? note.content : readingBody(note.content), { renderer, gfm: true }) };
  });
}
