# Seraph foundation

One public site with three ways in: the existing Seraphic Systems landing page,
a curated Journal, and a Horizons-only Orb. The schema and source records remain
independent of their presentation. Read [the foundation agreement](docs/FOUNDATION.md)
for the purpose, terminology, and review practice.

## Preservation and review status

The full earlier project is preserved at:

- Tag: `baseline/pre-foundation-2026-11-02`
- Lab branch: `lab/full-project`
- Baseline commit: `24f2b0688617e3e24a065eb4d4591e32459b4303`

The reduced project is prepared on `feature/simple-foundation`, for review before
merging into `master`. The Journal piece is a **review draft**, without a claimed
publication date. Local preview shows it; public and committed production builds
exclude it until its wording is approved and `draft: true` is removed deliberately.
That means a production build currently has an empty Journal listing by design.

These refs preserve tracked source, records, schema, snapshots, and history.
They do **not** back up ignored media, credentials, private scratch documents,
external sample drives, or `~/Ableton`. Those locations remain untouched. Existing
local locations include `apps/internal/media/`, `apps/internal/private/`,
`.env.r2.local`, and external musical files described in the baseline README.
Backup status for these files has not been verified.

The preservation refs were created locally. Their existence on GitHub must be
verified separately before treating them as remote backups; pushing them requires
approval because the full project includes material beyond the reduced public scope.

To inspect the preserved project without moving the current checkout:

```sh
git show baseline/pre-foundation-2026-11-02:README.md
git diff baseline/pre-foundation-2026-11-02..feature/simple-foundation --stat
```

To work in the lab, first save your current work and switch branches:

```sh
git switch lab/full-project
npm ci
```

Return with `git switch feature/simple-foundation` and `npm ci`. The lab has its
original commands and larger dependency set. For simultaneous work, use a separate
checkout/worktree; ignored files and installed dependencies do not automatically
follow to another checkout. Never copy local credentials or raw media into Git.

## Project map

- `apps/seraphic-systems/`: landing page, Journal templates and entries, Orb UI.
- `content/horizons/`: four preserved Markdown Horizon records.
- `schema/records.json`: active `Horizon` and `RecordBase` contracts.
- `shared/`: public tokens, landing styles, icons, and assets.
- `scripts/`: validation, record creation, static build, and committed deployment.
- `tests/`: Node tests for the active foundation.

The records and their schema live outside the site source so they remain independent
of their presentation. Journal entries stay with the site as authored pages.
Ignored local media and private folders retain their existing paths under
`apps/internal/`; they are not part of the active application source.

Music records, the broader schema, Zero's separate blog, connected Notes/Pages,
internal dashboards, Ableton tooling, resampling, and hosted audio live in the
baseline and lab, rather than remaining dormant in the accepted source tree.
No musical originals, remote audio objects, buckets, or hosting settings are deleted.

## Develop and verify

Use Node.js >=22.12 and the committed npm lockfile:

```sh
npm ci
npm run dev
```

Open the printed local URL (normally `http://127.0.0.1:5174`). `dev:seraphic` is an
alias. The preview includes draft Journal entries with an explicit review banner.
Source changes rebuild and reload the site. Private Horizons remain excluded even
in preview. There are no local management or audio APIs.

```sh
npm run typecheck
npm test
npm run build
# Local static review output, including Journal drafts; do not deploy this output:
npm run build -- --drafts
```

Application modules, Node scripts, tests, and Vite configuration use TypeScript
with strict checking. `npm run typecheck` checks all active source; `npm run build`
checks types before building. Node commands use built-in type stripping (including
on Node 22.12); types must remain erasable. The static build uses the TypeScript 6
compiler API to emit browser ES modules at their existing `.js` URLs. No framework,
bundler, TypeScript source, or source maps are added to the public output.
The JSON schema remains the runtime authority for front matter; TypeScript shapes
in `orb/types.ts` describe the validated data used by the application.

The only publish directory is **`dist/seraphic-systems`**. The build copies a
specific set of landing files, public shared assets, rendered Journal pages, Orb
modules, public catalog, and generated route pages. Source Markdown, templates,
private records, and ignored media are not published. Legacy `dist/zero`,
`dist/internal`, or `dist/cloudflare` folders may remain locally from the old
project; never publish `dist/` as a whole.

Orb starts at `/orb/` (also `/orb/horizons/`). Each public Horizon has a stable
`/orb/horizons/<id>/` route, with complete HTML even without JavaScript. Open an orb
to read it; Tab and Enter navigate links, Escape returns to all Horizons, and
browser Back/Forward retraces navigation. The same content adapter and renderer
serve static pages and enhanced in-place navigation. Layout, routes, content
policy, and rendering remain separate. There is one presentation and no view,
search, model, operations, or playback panels.

Unknown paths use `404.html`. The former music/model routes and audio endpoints
are absent, not simply hidden in navigation. Tests verify the reduced build boundary.

## Horizon records

The schema is the source of truth for front matter; the agreement explains the
meaning. Existing records retain their exact IDs and timestamps. Create new ones
with the helper, which validates shape, stamps record creation, and refuses reuse
of an ID or overwrite of a file:

```sh
npm run create:record -- Horizon '{"id":"embodied-practice","title":"Embodied Practice","level":2,"description":"Make room for work grounded in shared, lived experience."}'
```

New records explicitly default to `visibility: private`. Read and review them in
the source file, then set `visibility: public` when intended for publication.
Existing Horizons without a visibility field keep their established public default.
The build validates public and private records, rejects duplicate IDs, and emits
only public records and their routes. Changing a title or filename does not change
identity. Do not infer creation dates, invent relationships, or renumber levels
based on deadlines. No relationships are needed by this initial collection.

### Public Horizons feed

Fetch `/api/v1/horizons.json` with a plain, unauthenticated GET. The static build
generates the feed from the same validated public Horizons as Orb. On Cloudflare,
the feed allows cross-origin browser reads. For local development, run
`npm run dev` and use `http://127.0.0.1:5174/api/v1/horizons.json`.

The response is an object with a `horizons` array sorted by level, then by ID.
Each item has `id`, `title`, `level` (1–4), `description`, `created_at`
(a timestamp or `null` if unknown), and `content` (Markdown, or an empty
string when the record has no body). Use `id` as the stable identifier.
The feed updates with each site release.

## Journal

Entries live at `apps/seraphic-systems/journal/entries/<stable-slug>/index.md`:

```markdown
---
title: An entry
description: A short introduction.
draft: true
---

Write below the front matter. The template supplies the title.
```

The directory establishes `/journal/<slug>/`. Title and description are required.
A quoted, real `date: "YYYY-MM-DD"` is optional; omit unknown publication dates.
Future dates do not hide entries. Drafts and their assets are excluded from public
builds. Preview is an editorial review surface; remove `draft: true` only after
accepting the wording. The initial draft was prepared from the reset discussion
and awaits author review.

The existing renderer also supports an `index.html` body (exactly one body file),
optional `style.css` and module `script.js`, and a public `assets/` folder. Scope
entry CSS to its page. Markdown/HTML are trusted authored content, including any
scripts. Keep private notes outside public asset folders. Deterministic thumbnails
come from document structure and shared color tokens; no external generation service
is needed. Journal links can point to explicit Orb routes without duplicating records.

## Acceptance and deployment

`master` is the accepted version. Experiment in the lab; promote one coherent idea
at a time through a short-lived `feature/` branch and PR. Keep schema changes,
necessary record migrations, code, and validation together. Review the diff and
rendered pages before merging. The lab is not merged wholesale by default.

```sh
# Build the committed HEAD, excluding all local edits and review-only drafts:
npm run build:production
# Deploy a committed feature branch to an isolated preview, when authorized:
npm run deploy:preview
# Deploy only an accepted commit matching the live origin/master:
npm run deploy:production
```

These retain the committed-source build and production revision guard. The archived
source is type-checked before building. Dependency files must match HEAD and dependencies must be installed. `/release.json` identifies
the source commit and commit time, not content publication time.

`wrangler.json` retains the existing Worker identity and production Custom Domain,
serving static assets only. An empty `previews: {}` block is retained because
`wrangler preview` requires it, even without storage bindings. There is no generated Worker runtime, audio allowlist,
or R2 binding. No hosting changes occur until deployment. Legacy audio routes would
stop serving from this site if this reduction is deployed; remote objects remain
untouched in their private buckets. Review this behavior before accepting deployment.

CI runs `npm ci`, strict type checking, Node tests, the committed production build,
and a Wrangler dry run.
`.github/branch-protection.json` describes the intended PR and Repository validation
requirements, but does not enable GitHub protections by itself. Actual protection
settings and Cloudflare preview authentication have not been verified here.
Continue using protected previews for unpublished work, as described in the baseline
README. Production should track only `master`; never deploy the lab to production.
