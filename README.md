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
- `tests/fixtures/content/`: synthetic Horizon records for local development.
- `schema/records.json`: `Horizon`, `OrganicMemory`, and `Mix` front-matter contracts and shared record fields.
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

### Local component workshop

Run `npm run dev:components` and open `http://127.0.0.1:5175` to develop UI
pieces in isolation. This separate Vite preview serves `workshop/` directly,
refreshes as source changes, and uses the public shared design tokens. It does
not build the site or read content records. Workshop files are outside the public
build's inputs and are never copied to `dist/seraphic-systems`.

The button and textbox opt into the shared light tokens in `shared/tokens.css`:
`--color-light-*` defines the RGB/cyan/white palette, `--color-night*` and
`--color-on-night*` define dark surfaces and readable text, `--effect-rgb-*` and
`--effect-glow-*` control decorative intensity, and `--motion-*` defines durations.
Durations use milliseconds, including the script-driven button pulse. Components
keep their own layout, animation choreography, and accessibility rules. Apply split
and glow to artwork and edges, keeping text crisp; respect reduced motion and forced
colors. These tokens are opt-in and do not restyle the public site automatically.

The first studies are loading indicators: ring, dots, and orbit. Preview controls
change surface, size, tempo, pause state, and reduced motion. System reduced-motion
preferences always disable animation. Each indicator includes a readable status
label; animation is decorative. The context panel uses the same implementation.

The angel procession study morphs from a point through seraph, cherub, and throne
geometry while traveling back and forth. It shares the fat button’s dark face,
cyan outlines, mint accents, and rose/blue split edges through the shared light
and effect tokens. Text stays crisp, and forced colors use system colors. Its
position is indeterminate, not a completion percentage. Use **Finish loading** to settle at the end, then
**Restart loading** to replay. It respects the same preview controls; reduced
motion shows a stationary form. `createAngelProgress()` exposes completion,
restart, preview settings, and disposal for its animation loop.

The Christogenesis companion (`createChristogenesisProgress()`) interprets Teilhard
de Chardin’s movement from matter through life and consciousness toward Christ
Omega as particles, a rooted sprout, a branching neural web, and an Omega
surrounding a cross. Each stage rests briefly so its silhouette can be read.
Convergence brightens the contours into white with a cyan halo and radiant ring;
the light is confined to the artwork and remains static with reduced motion.
This is an artistic sequence, not a scientific timeline or a completion measure.
It moves forward, holds at convergence, and fades into a new loading cycle.
Both studies share `morph-progress.ts` and `morph-progress.css`, with the same
size, tempo, pause, reduced-motion, completion, restart, and disposal controls.

Reusable examples live in `workshop/components/`; `workshop.ts` mounts them and
wires the preview controls, while `workshop.css` styles the surrounding workshop.
Add future studies here and move components into application source when they
are ready for integration. No component is added to the public UI automatically.

The multiline textbox study includes a visible label, linked helper/error text,
native vertical resizing, and word/character counts (words are separated by
whitespace). Switch between editable, error, read-only, and disabled states without
replacing the text, or insert sample copy. Text is held in the page only, with no
storage or submission. `createTextbox()` exposes the textarea, value updates, and
state changes. The surface selector previews both component families in light/dark.
An optional seraph seal sits in the lower corner. The textbox shares the button's
dark surface, cyan/rose split edges, mint accents, and luminous hover/focus frame.
Focusing opens the paired wings and divided halo with a brief RGB glow, then settles
into a quiet watermark. Blurring closes the seal. Text, labels, and helper messages
remain unfiltered, without text shadows or simulated engraving. Error styling stays
red; disabled fields lose the RGB effects. Reduced motion shows the resting/open
states without animation. Toggle **Angel watermark** to compare it with the plain
field. The decorative SVG adapts the site's seraph geometry and ignores pointer
input. Sealing is visual: it does not save text, prevent editing, or imply successful
validation.

The fat button study explores a square digital seal with a six-winged seraph,
a manuscript-inspired border of curling vines, leaves, and small stars, and
a flat dark surface with RGB contour separation and luminous activation light.
The border remains visible at rest and lights on hover and keyboard focus;
its tighter color separation and glow keep the fine ornament clear.
Vector outlines supply the edge treatment;
no image post-processing is needed. Hover and press change color
without moving the button or simulating physical depth. Changing Disabled to Ready sends a brief light trace
through the frame, orbital rings, halo, six seraph wings, and central eye, with an RGB edge glow,
a brief diagonal light streak, and increased chromatic separation. Reduced motion
suppresses the animations while retaining the static contour treatment. The top engraving reads **Ne timeas** (Latin: “Fear not”). Hover and
keyboard focus gently spread the six wings and strengthen the RGB split and halo.
The wings stay still with reduced motion, while loading, and while disabled. Clicking (or pressing Space or
Enter) adds a brief artwork-only light pulse; both text lines remain unfiltered. Use **Button state** to preview ready, loading, and disabled states;
ready presses only update a local counter. Loading sends a slow light arc around
the outer ring while the seal and text stay still; reduced motion keeps the arc static.
Loading keeps keyboard focus and ignores
activation; disabled uses the native button state. `createFatButton()` returns the
button and `setState()`. Surface and reduced-motion controls also apply here.

The pill button study is a compact companion to the fat button: a rounded dark
face, crisp label, mint signal mark, and cyan/rose edges. Hover and keyboard focus
light the contour; pressing changes the face without moving it. **Pill state**
previews ready, loading, and native disabled states. Loading retains focus and
ignores activation, replacing the star with a rotating ring. Reduced motion keeps
the ring static, and Pause animation pauses it. Ready presses update a local counter
only. `createPillButton()` accepts `label` and `loadingLabel`, and returns the native
button as `element` plus `setState()`. Shared surface and motion controls apply.

### Preview with fixture records

Run `npm run dev:fixtures` to preview Orb with the Markdown records in
`tests/fixtures/content/`. The preview rebuilds when those records change and
writes to `dist/fixtures-preview`. Public fixture Horizons appear in Orb and its
local feed. Private fixture records are validated and stay out of both. Regular
preview and public builds read `content/`, and the fixture output is local only.

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

## Visualizer input contracts

`OrganicMemory` uses a permanent `id` and a `title`, with the recollection
in the Markdown body. `Mix` keeps the lab's identity of `song` plus version
`date` (YYYY-MM-DD). Both require explicit `visibility`. Use `private` for
new inputs. The shared `created_at` is record creation time and can be null
when unknown. A mix requires a stable object key in `audio_file`, such as
`mixes/coldness/2026-04-04.wav`. The key is relative to the configured private
audio bucket. Bucket settings and credentials belong in the renderer's
configuration. The renderer checks object availability at render time.

Use `npm run create:record -- Mix '<JSON front matter>'` to add a mix or
`npm run create:record -- OrganicMemory '<JSON front matter>'` to start a
memory, then write the recollection in its Markdown body. The helper defaults
to private and preserves an explicit null creation time when importing an
older record. The helper creates the appropriate directory under `content/`
when needed. The fixture preview also validates any local Mix and OrganicMemory
records in `tests/fixtures/content/mixes/` and
`tests/fixtures/content/organic-memories/`. Keep personal recollections and
private audio object keys out of the public repository. Public Orb pages and
feeds are generated from Horizons only.

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
