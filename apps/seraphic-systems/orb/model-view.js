const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export function inheritedFields(definition, definitions) {
  const properties = {}, required = new Set();
  for (const parent of definition.allOf || []) {
    const inherited = inheritedFields(parent.$ref ? definitions[parent.$ref.split('/').at(-1)] : parent, definitions);
    Object.assign(properties, inherited.properties);
    inherited.required.forEach(key => required.add(key));
  }
  Object.assign(properties, definition.properties);
  (definition.required || []).forEach(key => required.add(key));
  return { properties, required };
}
function fieldType(field, definitions) {
  if (field.$ref) return definitions[field.$ref.split('/').at(-1)]?.title || field.$ref;
  if (field.const != null) return JSON.stringify(field.const);
  if (field.enum) return field.enum.join(' | ');
  if (field.anyOf) return field.anyOf.map(value => fieldType(value, definitions)).join(' | ');
  if (field.type === 'array') return `${fieldType(field.items, definitions)}[]`;
  return `${Array.isArray(field.type) ? field.type.join(' | ') : field.type || 'value'}${field.format ? ` · ${field.format}` : ''}`;
}
function fields(definition, definitions) {
  const { properties, required } = inheritedFields(definition, definitions), list = el('dl', null, 'schema-fields');
  for (const [name, property] of Object.entries(properties)) {
    list.append(el('dt', `${name}${required.has(name) ? ' · required' : ''}`));
    const value = el('dd', fieldType(property, definitions));
    if (property.description) value.append(el('p', property.description, 'muted'));
    list.append(value);
  }
  return list;
}
export function renderModelInspector(section, container, selected, { select, close }) {
  section.replaceChildren();
  const heading = el('h1', selected?.label || container.label); heading.tabIndex = -1;
  if (!selected) {
    section.append(heading, el('p', 'Select a type to explore its fields, relationships, and real records.', 'muted'));
    section.append(el('p', 'Arrows follow the recorded relationship direction. Dashed connections are derived path joins.', 'muted'));
  } else {
    const button = el('button', '×', 'text-button'); button.type = 'button'; button.setAttribute('aria-label', 'Clear selection'); button.addEventListener('click', close);
    section.append(button, el('p', 'Schema type', 'kind'), heading);
    const { definition, schema, records } = selected.data;
    section.append(el('p', definition.description), el('p', `${records.length} records · schema v${schema['x-version']}`, 'muted'));
    section.append(el('p', `Identity: ${definition['x-model'].identity}`, 'muted'), el('p', `Source: ${definition['x-model'].source}`, 'muted'));
    section.append(el('h2', 'Relationships'));
    const connected = container.relationships.filter(edge => edge.source === selected.id || edge.target === selected.id);
    if (!connected.length) section.append(el('p', 'No recorded relationships.', 'muted'));
    for (const edge of connected) {
      const row = el('div', null, 'schema-relation');
      const other = container.children.find(child => child.id === (edge.source === selected.id ? edge.target : edge.source));
      const link = el('button', other.label, 'schema-link'); link.type = 'button'; link.addEventListener('click', () => select(other.id));
      row.append(el('span', edge.source === selected.id ? `${selected.label} ${edge.label} → ` : `← ${edge.label} · `), link, el('p', edge.cardinality, 'muted'), el('p', edge.description, 'muted'));
      section.append(row);
    }
    const fieldSection = el('details'); fieldSection.open = true; fieldSection.append(el('summary', 'Fields'), fields(definition, schema.definitions)); section.append(fieldSection);
    // Referenced embedded values are inspectable without giving them catalog identities.
    const references = new Set();
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (value.$ref) references.add(value.$ref.split('/').at(-1));
      Object.values(value).forEach(visit);
    };
    visit(inheritedFields(definition, schema.definitions).properties);
    for (const key of references) {
      const embedded = schema.definitions[key];
      if (!embedded || embedded['x-model']) continue;
      const details = el('details'); details.append(el('summary', `${embedded.title} · embedded value`), el('p', embedded.description, 'muted'), fields(embedded, schema.definitions)); section.append(details);
      visit(embedded.properties);
    }
    section.append(el('h2', 'Real records'));
    if (records.length) {
      const label = el('label', 'Explore a record'), picker = el('select'), data = el('pre', null, 'schema-json'), source = el('p', null, 'muted');
      picker.setAttribute('aria-label', 'Explore a record');
      records.forEach(record => { const option = el('option', record.title); option.value = record.key; picker.append(option); });
      const show = () => { const record = records.find(record => record.key === picker.value); data.textContent = JSON.stringify(record.data, null, 2); source.textContent = record.source; };
      picker.addEventListener('change', show); label.append(picker); section.append(label, source, data); show();
    } else section.append(el('p', 'No records yet.', 'muted'));
  }
  const gaps = el('details'); gaps.append(el('summary', 'Model gaps'));
  for (const gap of container.gaps || []) gaps.append(el('h2', gap.title), el('p', gap.description, 'muted'));
  section.append(gaps);
  if (selected) {
    const back = el('button', 'Back to map', 'schema-link'); back.type = 'button'; back.addEventListener('click', close); section.append(back);
  }
}
