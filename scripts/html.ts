export function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

// Double braces escape metadata; triple braces insert trusted, generated HTML.
export function render(template: string, values: Record<string, unknown>) {
  return template.replace(/\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/g, (_, htmlKey, textKey) => {
    const key = htmlKey || textKey;
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown template variable: ${key}`);
    return htmlKey ? String(values[key]) : escapeHtml(values[key]);
  });
}
