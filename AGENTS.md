# Repository guidance

## Project map

This repository contains two public static sites and a separate local music workspace.
Read the relevant section of `README.md` before changing a workflow; it documents
content formats, music provenance, local APIs, and operational commands.

- `apps/zero/`: Markdown blog posts and HTML templates.
- `apps/seraphic-systems/`: company site, written in plain HTML, CSS, and JavaScript.
- `apps/internal/dashboard/`: local dashboard, Live Sets, Model viewer, and Orb UI.
- `apps/internal/data/`: persistent Markdown records, set registry, and snapshots.
- `apps/internal/model/schema.json`: catalog model and relationship definitions.
- `shared/`: design tokens, styles, assets, and reusable native Web Components.
- `scripts/`: Node build tools and local APIs, plus Python Ableton tools.
- `tests/`: Node tests (`*.test.mjs`) and Python Ableton tests (`test_ableton*.py`).

## Development and verification

Use Node.js >=22.12 and npm with the committed `package-lock.json`. Install with
`npm ci` when dependencies are needed. Ableton tooling also requires Python 3.

| Task | Command |
| --- | --- |
| Preview Zero | `npm run dev` |
| Preview Seraphic Systems | `npm run dev:seraphic` |
| Preview internal workspace | `npm run dev:internal` |
| Build both public sites | `npm run build` |
| Build internal workspace | `npm run build:internal` |
| Run Node tests | `npm test` |
| Run Ableton Python tests | `python3 -m unittest discover -s tests -p 'test_ableton*.py'` |
| Check project inventory | `npm run lint:projects` |

Choose verification appropriate to the change. Run Node tests for JavaScript or
build behavior changes, Python tests for Ableton tooling changes, and the affected
build for template, schema, or content changes. For UI changes, inspect the affected
page in a browser, including narrow layouts and relevant keyboard interactions.
Documentation-only edits do not require application tests. Report checks run and
any failures or verification limits.

## Implementation conventions

- Keep the existing framework-free architecture: ES modules, plain HTML/CSS,
  native Web Components where useful, and Python for Ableton analysis/branching.
  Vite serves local previews; `scripts/build.mjs` produces deployment output.
- Edit source files, never generated `dist/` output.
- Use semantic tokens from `shared/tokens.css` for shared colors and fonts.
  Keep reusable components in `shared/components/` and application layout in the app.
- Keep the Orb content adapter, pure layout engine, URL routing, presentations,
  and playback coordination separate. Declare available views and controls through
  container policies in `content.js`; see the README's Orb section.
- Update the relevant README section when changing commands, record formats,
  or user-visible workflows. Keep this file concise and current.

## Data and publication boundaries

- The default build publishes only Zero and Seraphic Systems. Keep internal-only
  assets out of `shared/`, which is copied into every site's output.
- Local audio belongs under ignored `media/` directories. Keep R2 credentials in
  the ignored `.env.r2.local`; do not put credentials in source or browser bundles.
- Treat the schema as the catalog model's source of truth. Preserve explicit
  relationships; do not infer song links or production provenance from filenames,
  similar titles, or filesystem timestamps.
- Preserve permanent record IDs, set UUIDs, historical snapshots, and existing
  `created_at` values. Unknown dates stay unknown. Record creation, musical creation,
  mix version dates, and analysis times have different meanings.
- Prefer `npm run create:internal -- <Type> '<JSON front matter>'` for new Markdown
  records; it stamps creation time, validates shape, and refuses overwrites.
  The internal build checks cross-record references.
- Ableton projects and samples live outside the repository under `~/Ableton`.
  Use temporary fixtures for tests; do not use real projects for test mutations.
  Preserve source Live Sets and shared samples when changing branching or archive
  behavior; archiving is a registry operation, not deletion of musical files.
- Zero posts use stable filename slugs, quoted `YYYY-MM-DD` dates, and a title
  supplied by the template. `draft: true` excludes a post; future dates alone do not.
