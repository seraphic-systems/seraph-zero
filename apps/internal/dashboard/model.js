const $ = (selector) => document.querySelector(selector);
const svgNS = 'http://www.w3.org/2000/svg';
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function svg(tag, attributes = {}) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
async function json(file) {
  const response = await fetch(file);
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status}).`);
  return response.json();
}
try {
  const [schema, catalog] = await Promise.all([json('model-schema.json'), json('catalog.json')]);
  const definitions = schema.definitions;
  const types = Object.entries(definitions).filter(([, definition]) => definition['x-model']);
  const relations = schema['x-relations'];
  const nodes = new Map();
  const records = new Map(catalog.records.map((record) => [record.key, record]));
  const counts = Object.fromEntries(types.map(([type]) => [type, catalog.records.filter((record) => record.type === type).length]));
  let selected = 'Song';
  $('#type-map').style.height = `${Math.max(...types.map(([, definition]) => definition['x-model'].position[1])) * 122 + 134}px`;
  function typeLink(type, label = definitions[type].title) {
    const button = el('button', label, 'type-link');
    button.type = 'button';
    button.addEventListener('click', () => select(type));
    return button;
  }
  for (const [type, definition] of types) {
    const button = el('button', null, 'type-node');
    const [column, row] = definition['x-model'].position;
    button.style.left = `${column * 35 + 1.5}%`;
    button.style.top = `${row * 122 + 20}px`;
    button.type = 'button';
    button.append(el('strong', definition.title), el('span', `${counts[type]} ${counts[type] === 1 ? 'record' : 'records'}`));
    button.addEventListener('click', () => select(type));
    nodes.set(type, button);
    $('#type-nodes').append(button);
  }
  function drawConnections() {
    const canvas = $('#connections');
    canvas.replaceChildren();
    const defs = svg('defs');
    for (const [id, color] of [['arrow', '#456456'], ['arrow-muted', '#dedfd8']]) {
      const marker = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
      marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }));
      defs.append(marker);
    }
    canvas.append(defs);
    const bounds = $('#type-map').getBoundingClientRect();
    // Draw the selected relationships last so their paths remain visible.
    const ordered = [...relations].sort((a, b) => Number(a.source === selected || a.target === selected) - Number(b.source === selected || b.target === selected));
    for (const relation of ordered) {
      const a = nodes.get(relation.source).getBoundingClientRect();
      const b = nodes.get(relation.target).getBoundingClientRect();
      const active = relation.source === selected || relation.target === selected;
      let d;
      if (relation.source === relation.target) {
        const x = a.right - bounds.left, y = a.top - bounds.top;
        d = `M ${x - 12} ${y} C ${x + 20} ${y - 38}, ${x + 30} ${y + 28}, ${x} ${y + 28}`;
      } else {
        const vertical = Math.abs(a.left - b.left) < 10;
        const ax = (vertical ? a.left + a.width / 2 : a.left < b.left ? a.right : a.left) - bounds.left;
        const bx = (vertical ? b.left + b.width / 2 : a.left < b.left ? b.left : b.right) - bounds.left;
        const ay = (vertical ? a.top < b.top ? a.bottom : a.top : a.top + a.height / 2) - bounds.top;
        const by = (vertical ? a.top < b.top ? b.top : b.bottom : b.top + b.height / 2) - bounds.top;
        d = vertical ? `M ${ax} ${ay} C ${ax} ${(ay + by) / 2}, ${bx} ${(ay + by) / 2}, ${bx} ${by}` : `M ${ax} ${ay} C ${(ax + bx) / 2} ${ay}, ${(ax + bx) / 2} ${by}, ${bx} ${by}`;
      }
      const line = svg('path', { d, class: `connection${active ? ' active' : ''}${relation.kind === 'path-join' ? ' derived' : ''}`, 'marker-end': `url(#${active ? 'arrow' : 'arrow-muted'})` });
      line.append(svg('title'));
      line.firstChild.textContent = `${definitions[relation.source].title} ${relation.label} ${definitions[relation.target].title}`;
      canvas.append(line);
    }
  }
  function fieldType(field) {
    if (field.$ref) return definitions[field.$ref.split('/').at(-1)]?.title || field.$ref;
    if (field.const != null) return JSON.stringify(field.const);
    if (field.enum) return field.enum.join(' | ');
    if (field.anyOf) return field.anyOf.map(fieldType).join(' | ');
    if (field.type === 'array') return `${fieldType(field.items)}[]`;
    return `${Array.isArray(field.type) ? field.type.join(' | ') : field.type || 'value'}${field.format ? ` · ${field.format}` : ''}`;
  }
  function inheritedFields(definition) {
    const properties = {};
    const required = new Set();
    for (const parent of definition.allOf || []) {
      const base = inheritedFields(parent.$ref ? definitions[parent.$ref.split('/').at(-1)] : parent);
      Object.assign(properties, base.properties);
      for (const key of base.required) required.add(key);
    }
    Object.assign(properties, definition.properties);
    for (const key of definition.required || []) required.add(key);
    return { properties, required: [...required] };
  }
  function fieldTable(definition) {
    definition = inheritedFields(definition);
    const wrapper = el('div', null, 'table-scroll');
    const table = el('table', null, 'field-table');
    const head = el('thead');
    const headings = el('tr');
    for (const title of ['Field', 'Value', 'Required']) headings.append(el('th', title));
    head.append(headings);
    table.append(head);
    const body = el('tbody');
    for (const [name, property] of Object.entries(definition.properties)) {
      const row = el('tr');
      const cell = el('td', null, 'field-name');
      cell.append(el('code', name));
      const value = el('td', fieldType(property));
      if (property.description) value.append(el('span', property.description, 'field-description'));
      const required = definition.required?.includes(name);
      row.append(cell, value, el('td', required ? 'Yes' : 'Optional', required ? '' : 'field-optional'));
      body.append(row);
    }
    table.append(body);
    wrapper.append(table);
    return wrapper;
  }
  function showExample(record, container) {
    container.replaceChildren();
    if (!record) { container.append(el('p', 'No records yet.', 'muted')); return; }
    container.append(el('p', record.source, 'example-source'));
    const links = el('div', null, 'example-edges');
    for (const edge of catalog.edges.filter((edge) => edge.source === record.key || edge.target === record.key)) {
      const relation = relations.find((r) => r.id === edge.relation);
      const target = records.get(edge.source === record.key ? edge.target : edge.source);
      const line = el('p', edge.source === record.key ? `${relation.label} → ` : `← ${relation.label} · `);
      const button = typeLink(target.type, target.title);
      button.addEventListener('click', () => {
        const picker = $('#example-record');
        picker.value = target.key;
        picker.dispatchEvent(new Event('change'));
      });
      line.append(button);
      links.append(line);
    }
    container.append(links);
    for (const item of catalog.unresolved.filter((item) => item.record === record.key)) container.append(el('p', item.reason, 'unresolved-note'));
    for (const item of (catalog.lint || []).filter((item) => item.record === record.key)) container.append(el('p', `${item.path}: ${item.message}`, 'unresolved-note'));
    container.append(el('pre', JSON.stringify(record.data, null, 2), 'example-json'));
  }
  function select(type, updateHash = true) {
    selected = type;
    if (updateHash) history.replaceState(null, '', `#${type}`);
    const definition = definitions[type];
    const connected = relations.filter((r) => r.source === type || r.target === type);
    const related = new Set(connected.flatMap((r) => [r.source, r.target]));
    for (const [key, node] of nodes) {
      node.setAttribute('aria-pressed', String(key === type));
      node.classList.toggle('unrelated', key !== type && !related.has(key));
    }
    const strip = $('#map-relations');
    strip.replaceChildren();
    for (const relation of connected) {
      const line = el('p');
      line.append(typeLink(relation.source), ` ${relation.label} → `, typeLink(relation.target));
      strip.append(line);
    }
    const inspector = $('#type-inspector');
    inspector.replaceChildren(el('p', `${counts[type]} records · schema v${schema['x-version']}`, 'eyebrow'), el('h2', definition.title), el('p', definition.description, 'muted'));
    const identity = el('div', null, 'identity-note');
    identity.append(el('span', 'Identity: '), definition['x-model'].identity, el('br'), el('span', 'Source: '), definition['x-model'].source);
    inspector.append(identity, el('h3', 'Fields'), fieldTable(definition));
    if (type === 'Snapshot') for (const key of ['SetAnalysis', 'PluginUsage']) {
      const details = el('details', null, 'embedded-type');
      details.append(el('summary', `${definitions[key].title} · embedded value`), el('p', definitions[key].description, 'muted'), fieldTable(definitions[key]));
      inspector.append(details);
    }
    inspector.append(el('h3', 'Relationships'));
    for (const relation of connected) {
      const block = el('div', null, 'type-relation');
      block.append(typeLink(relation.source), ` ${relation.label} → `, typeLink(relation.target), el('small', relation.cardinality), el('p', relation.description, 'muted'));
      inspector.append(block);
    }
    inspector.append(el('h3', 'Real records'));
    const label = el('label', 'Explore a record', 'example-select');
    const picker = el('select');
    picker.id = 'example-record';
    for (const record of catalog.records.filter((record) => record.type === type)) {
      const option = el('option', record.title);
      option.value = record.key;
      picker.append(option);
    }
    picker.disabled = !picker.options.length;
    label.append(picker);
    const example = el('div');
    picker.addEventListener('change', () => showExample(records.get(picker.value), example));
    inspector.append(label, example);
    showExample(records.get(picker.value), example);
    requestAnimationFrame(drawConnections);
  }
  for (const gap of schema['x-gaps']) {
    const block = el('article');
    block.append(el('h3', gap.title), el('p', gap.description));
    $('#model-gaps').append(block);
  }
  $('#model-status').textContent = `${types.length} types · ${catalog.records.length} records · ${catalog.edges.length} links · ${catalog.unresolved.length} unresolved associations`;
  $('#model-status').className = 'muted';
  $('#model-content').hidden = false;
  const fromHash = () => select(nodes.has(location.hash.slice(1)) ? location.hash.slice(1) : 'Song', false);
  fromHash();
  window.addEventListener('hashchange', fromHash);
  new ResizeObserver(drawConnections).observe($('#type-map'));
} catch (error) {
  $('#model-status').textContent = `${error.message} Rebuild the internal workspace and reload.`;
  $('#model-status').className = 'status-error';
}
