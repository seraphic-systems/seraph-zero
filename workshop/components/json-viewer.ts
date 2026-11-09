export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonViewerOptions {
  label: string;
  value: JsonValue;
  compact?: boolean;
}

/** A selectable, read-only JSON document. Import json-viewer.css alongside it. */
export function createJsonViewer(options: JsonViewerOptions) {
  const id = `json-viewer-${crypto.randomUUID()}`;
  const element = document.createElement('figure');
  element.className = 'json-viewer';
  const caption = document.createElement('figcaption');
  caption.className = 'json-viewer__caption';
  const mark = document.createElement('span');
  mark.className = 'json-viewer__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '{ ✧ }';
  const label = document.createElement('span');
  label.id = id;
  label.textContent = options.label;
  const badge = document.createElement('span');
  badge.className = 'json-viewer__badge';
  badge.textContent = 'JSON / Read only';
  caption.append(mark, label, badge);

  const pre = document.createElement('pre');
  pre.className = 'json-viewer__document';
  pre.tabIndex = 0;
  pre.setAttribute('role', 'region');
  pre.setAttribute('aria-labelledby', id);
  const code = document.createElement('code');
  pre.append(code);
  const footer = document.createElement('div');
  footer.className = 'json-viewer__footer';
  footer.textContent = 'Select to copy · Scroll to explore';
  element.append(caption, pre, footer);
  let value = options.value;
  let compact = options.compact ?? false;

  function render() {
    const source = JSON.stringify(value, null, compact ? undefined : 2);
    const fragment = document.createDocumentFragment();
    // Tokenize serialized JSON, so escaped quotes stay inside their strings.
    // All supplied content becomes text nodes, never HTML.
    const tokens = /"(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu;
    let offset = 0;
    for (const match of source.matchAll(tokens)) {
      fragment.append(source.slice(offset, match.index));
      const token = document.createElement('span');
      const text = match[0];
      const kind = text.startsWith('"') ? (/^\s*:/u.test(source.slice(match.index + text.length)) ? 'key' : 'string')
        : text === 'null' ? 'null' : text === 'true' || text === 'false' ? 'boolean' : 'number';
      token.className = `json-viewer__${kind}`;
      token.textContent = text;
      fragment.append(token);
      offset = match.index + text.length;
    }
    fragment.append(source.slice(offset));
    code.replaceChildren(fragment);
  }
  render();
  return {
    element,
    setValue(next: JsonValue) { value = next; render(); },
    setCompact(next: boolean) { compact = next; render(); },
  };
}
