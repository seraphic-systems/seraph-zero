import type { ContentSource } from "./types.ts";
import { layout } from "./engine.ts";
import { horizonLevels } from "./content.ts";
import { horizonRoute } from "./routes.ts";

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

export function renderWorld(
  container: ContentSource,
  selectedId: string | null,
) {
  const selected = container.children.find((node) => node.id === selectedId);
  const groups = layout(container)
    .map(
      (
        group,
      ) => `<section class="horizon-group" aria-labelledby="level-${group.level}">
    <h2 id="level-${group.level}" class="group-label">${group.level} <span> / </span> ${escape(group.label)}</h2>
    <ul class="orbs">${group.nodes
      .map(
        (
          node,
        ) => `<li><a class="orb${selectedId === node.id ? " current" : ""}" href="${horizonRoute(node.id)}" data-horizon="${node.id}"${selectedId === node.id ? ' aria-current="page"' : ""}>
      <svg viewBox="0 0 140 140" fill="none" aria-hidden="true"><circle cx="70" cy="70" r="67"/><circle class="inner" cx="70" cy="70" r="59"/><circle class="mark" cx="70" cy="119" r="2"/></svg>
      <span>${escape(node.label)}</span></a></li>`,
      )
      .join("")}</ul>
  </section>`,
    )
    .join("");
  const detail = selected
    ? `<article id="detail" aria-labelledby="detail-title">
    <a href="/orb/" class="close-detail" data-close>← All Horizons <span class="key-hint">Esc</span></a>
    <p class="eyebrow">${escape(horizonLevels[selected.level - 1])}</p>
    <h2 id="detail-title" tabindex="-1">${escape(selected.label)}</h2>
    <p class="description">${escape(selected.description)}</p>
    <div class="record-body">${selected.contentHtml || ""}</div>
    <details><summary>About this record</summary><dl><dt>Permanent ID</dt><dd>${escape(selected.id)}</dd><dt>Record created</dt><dd>${escape(selected.createdAt || "Unknown")}</dd></dl></details>
  </article>`
    : `<aside class="orientation"><h2>What gives the work direction?</h2><p>Horizons describe the values, principles, visions, and goals that guide the practice.</p><p>Open an orb to read a Horizon.</p></aside>`;
  return `<div class="orb-layout"><div class="horizon-library" aria-label="Horizons">${groups || "<p>No public Horizons yet.</p>"}</div>${detail}</div>`;
}
