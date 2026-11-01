# Seraph sites

Two static sites share CSS, favicons, and images from `shared/`.
Zero's blog is generated from Markdown. Seraphic Systems combines the plain HTML
landing page at `/`, the curated Journal at `/journal/`, and the public Orb app
at `/orb/` in one deployment.

Site source lives in `apps/seraphic-systems/` and `apps/zero/`. Shared assets,
build scripts, and tests stay at the repository root.

## Build and deploy

Use Node.js 22.12 or later. Install dependencies once:

```sh
npm ci
```

Build both sites from the working directory to check unpublished edits:

```sh
npm run build
```

`node scripts/build.mjs` also works after dependencies are installed.
This public build uses registered mix references only; ignored local mixes do
not enter the catalog. For deployment, build the committed revision instead:

```sh
npm run build:production
```

The production command exports `HEAD` into a temporary directory and runs the
committed build code against committed content, schema, and assets. Staged edits,
unstaged edits, untracked files, ignored media, and local credentials are excluded.
It requires Git and `tar`, plus dependencies installed with `npm ci` against the
committed package files. Uncommitted package changes cause an actionable error.
The completed public outputs replace `dist/zero` and `dist/seraphic-systems`;
`dist/internal` is left alone. Each site includes `/release.json` with its full
source commit and commit time. This is the source revision time, not a content
creation date or deployment time.

Configure two hosting projects using the same repository with the repository
root as the build working directory. Use `npm ci && npm run build:production`
as the build command and assign each its own domain:

| Site             | Publish directory       |
| ---------------- | ----------------------- |
| Zero             | `dist/zero`             |
| Seraphic Systems | `dist/seraphic-systems` |

Each output includes its own copy of `shared/`. Generated output is ignored by
Git and rebuilt from source. Zero's Markdown and templates are not published.

### Shared source of truth and publication

GitHub's protected `master` branch is the official version of code, records, schema,
relationships, and verified media references. R2 stores the referenced audio bytes.
Production is a build of an accepted commit; editing a local file or uploading an
R2 object does not publish it. Ableton projects and other working originals remain
local and need their own backups.

1. Start from current `master` and create a short-lived `feature/` branch.
2. Edit locally and use `npm run dev:seraphic` or `npm run dev:internal` to preview.
   Use `npm run create:internal -- <Type> '<JSON front matter>'` for new records.
3. Upload new mixes with `npm run mixes:upload`, or prepare and upload fragment
   previews with `npm run fragments:prepare` and `npm run fragments:upload`.
   Commit the resulting `data/mix-media.json` entries or fragment `preview` fields
   with the corresponding records and notes. Keep credentials and audio out of Git.
4. Commit and open a pull request. A hosted preview must build that candidate's
   committed revision with `npm run build:production`. Inspect the preview before
   merging. The PR template records the checks and preview link.
5. Merge after validation passes. Only `master` should deploy to the public domain.
   Feature branches may deploy to protected preview addresses. A separate
   long-lived `develop` branch is optional.

`.github/workflows/validate.yml` runs Node and Python tests, project naming checks,
the internal build, and the committed production build on PRs and pushes to `master`.
Configure a GitHub branch rule/ruleset for `master` requiring pull requests and the
**Repository validation** status check, blocking force pushes and branch deletion,
and applying the rule to administrators without routine bypasses. While solo,
leave required approving reviews disabled so you can merge your own checked PRs.
These protections are GitHub settings; adding the workflow file alone does not
enable them, and availability depends on repository visibility and GitHub plan.
The intended configuration is saved in `.github/branch-protection.json`. An
administrator can apply it on an eligible plan with:

```sh
gh api --method PUT repos/seraphic-systems/seraph-zero/branches/master/protection \
  --input .github/branch-protection.json
```

For private repositories, GitHub may require a paid plan before allowing branch
protection or repository rulesets. The JSON file does not enforce protection by
itself.

Cloudflare branch routing, protected previews, and production deployment must be
connected in the hosting account as described below. Cloudflare's production
branch must be `master`. For rollback, revert
the accepted change through a PR and deploy the resulting commit. Keep old
checksum-addressed R2 objects so historical content references remain valid.

Production includes only mix files registered in the committed manifest. Mix
notes and fragment records without uploaded audio remain legitimate metadata;
they do not acquire a remote audio reference from a local filename. Existing
schema and manifest checks validate reference structure without contacting R2.
The uploaders verify bytes before recording references; CI does not need storage
credentials and cannot verify that remote objects are still present. Hosted
playback uses the Worker audio API described below.

### Cloudflare production and branch previews

`wrangler.json` defines the existing `seraphic-systems-website` Worker and account,
its static assets directory,
the production Custom Domain `seraphicsystems.com`, and isolated Worker Previews.
Wrangler is pinned in the lockfile. Production and previews serve static assets
from `dist/seraphic-systems` and run the generated Worker in `dist/cloudflare`;
Zero remains a separate hosting project. Orb deep links are generated as real
files, and unknown paths return 404 rather than the landing page. Only `/api/*`
requests run the Worker first; ordinary static assets retain direct asset serving.
Local Ableton management endpoints are never deployed.

After committing changes and authenticating with `npx wrangler login`:

```sh
# Build and deploy this committed feature branch to a Preview:
npm run deploy:preview
# A detached checkout needs an explicit Preview name:
npm run deploy:preview -- --name pr-2

# After merging, deploy the accepted origin/master revision:
npm run deploy:production
```

These commands rebuild the committed revision, read deployment routing from its
committed `wrangler.json`, and send only that build to Cloudflare. The production
command checks the live `origin/master` SHA and refuses an unmerged revision.
Preview commands never promote a revision to production. An OAuth login or
appropriately scoped `CLOUDFLARE_API_TOKEN` is required; `.env.r2.local` contains
S3 credentials for local upload/playback, not Worker deployment credentials.
Wrangler state and `.dev.vars` files are ignored by Git.

For automatic deployments, connect this repository to **Workers Builds** in
Cloudflare (Worker → Settings → Builds → Connect). Authorize the Cloudflare
GitHub App for this repository and use these settings:

| Setting | Value |
| --- | --- |
| Repository | `seraphic-systems/seraph-zero` |
| Root directory | repository root |
| Production branch | `master` |
| Build command (production and previews) | `npm ci && npm test && npm run build:production` |
| Production deploy command | `npx wrangler deploy --config wrangler.json` |
| Preview command | `npx wrangler preview` |
| Preview builds | enabled for feature branches |
| Build Node version | `22` (`NODE_VERSION` build variable) |

Workers Builds runs the build command before its deploy/Preview command. Its Git
integration supplies Preview links on pull requests and updates the same branch
Preview on later pushes. Configure only this one deployment integration to avoid
duplicate builds; GitHub Actions continues to provide required validation.
Deploying production for the first time attaches the configured Custom Domain;
check the domain's existing DNS and hosting before replacing an existing site.
The zone must be active in the selected Cloudflare account. The Worker also has
a `workers.dev` production address for smoke checks.

**Protect previews before publishing unpublished content.** Preview URLs are
public by default; a `previews` block does not enable authentication. Enable
Cloudflare Zero Trust, then select the Worker's **Access** tab → protect this
Worker → **Previews only**, using an allow policy for your email or team. This
scope protects branch and individual deployment URLs while leaving production
public. Check that an unauthenticated request is redirected to Access or denied.
Preview audio bindings use separate private buckets rather than production
storage; see the hosted audio setup below.

After setup, verify `/`, `/orb/`, an Orb deep link, and `/release.json` on both
production and a Preview. The production release must match `origin/master`;
the Preview release must match its branch commit. Verify an unknown URL is 404,
and confirm preview authentication before considering the setup complete.
See Cloudflare's [Worker Previews](https://developers.cloudflare.com/workers/previews/get-started/),
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
and [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
documentation.

### Hosted audio streaming

Production listening is intentionally public for audio referenced by the committed
catalog. Keeping R2 buckets private prevents direct bucket access; the public
Worker endpoints still let visitors listen to and download approved audio. Preview
Access protects the entire preview, including audio routes. CORS/CORP headers are
browser embedding controls, not authentication for public production audio.

`scripts/cloudflare/build-audio.mjs` derives an allowlist from validated song mix
references and fragment `preview` fields. Public builds emit the Worker runtime
and allowlist in **`dist/cloudflare`**, outside both public static directories.
The committed production build snapshots this code and content together; no
working-tree or local-only audio enters the deployed Worker. Do not publish
`dist/` as a whole. Deploy through Wrangler with `dist/seraphic-systems` as assets.

| Binding | Production bucket | Preview bucket |
| --- | --- | --- |
| `MIX_AUDIO` | `seraph-music-media` | `seraph-music-media-preview` |
| `FRAGMENT_AUDIO` | `seraph-music-fragments` | `seraph-music-fragments-preview` |

Keep public bucket access disabled on all four buckets. Native R2 bindings use
Cloudflare authorization; no S3 key, `.env.r2.local`, or signed audio URL goes into
the browser or Worker bundle. The Worker only calls `head` and `get`. It accepts:

- `GET /api/mixes/<registered-filename>/audio` for registered remote mix files.
- `GET /api/fragments/<fragment-id>/audio` for uploaded M4A listening copies.
- `HEAD` on either route for full-object metadata without reading the audio body.

Only the exact committed object key for each route is accessible. Arbitrary keys,
unknown records, local-only mixes, and fragments without uploaded previews return
404. Writes return 405. Missing objects return 404; missing bindings, storage
errors, or size/MIME/SHA metadata mismatches return 503 without exposing storage
details. There is no hosted fallback to a local filesystem or archive drive.

GET supports one byte range (bounded, open-ended, or suffix) with 206 and
`Content-Range`; malformed, multipart, and unsatisfiable ranges return 416. HEAD
ignores Range and returns full-object headers. Strong content ETags support
`If-None-Match` revalidation and `If-Range` seeking; a mismatched If-Range sends
the full representation. The Worker streams R2 bodies without buffering mixes,
and uses an R2 ETag precondition to detect an object changing between head/get.
Private, revalidated browser caching prevents public CDN caching of preview audio
and avoids stale audio when the committed manifest changes.

Create the preview buckets once, then seed committed listening assets before
testing a branch that adds audio:

```sh
npx wrangler r2 bucket create seraph-music-media-preview
npx wrangler r2 bucket create seraph-music-fragments-preview
npm run audio:seed-preview
```

The seed command requires Wrangler login, rebuilds HEAD, and uses Wrangler remote
bindings to read production objects and write only the two named preview buckets.
It copies the exact committed keys, verifies checksums during R2 upload and checks
remote size/MIME/SHA metadata afterward. Matching objects are reused; conflicting
objects cause an error rather than being overwritten. It preserves production
objects, source records, dates, and historical objects. Interrupted runs can be
repeated, and old preview objects are retained. This is a manual storage operation,
not a CI step; CI and normal builds never copy audio or require R2 credentials.
New preview references return 404 until their objects have been seeded.

For release checks, test a mix and a fragment with HEAD, a small Range GET,
seeking in Orb, and an invalid range/unknown ID. Verify preview audio redirects
unauthenticated requests to Access while production audio is publicly playable.

## Write a Zero post

Create a Markdown file in `apps/zero/content/posts/`, for example `first-signal.md`:

```markdown
---
title: The first signal
date: "2026-10-30"
description: How Seraph Zero began.
draft: false
---

Something is beginning to take shape.

## An opening

Write paragraphs, **bold text**, lists, links, and images in Markdown.
```

The filename is the URL slug: this example generates
`dist/zero/posts/first-signal/index.html`, served at `/posts/first-signal/`.
Use lowercase letters, numbers, and hyphens in filenames. Keep the date in
front matter so editing a date doesn't change the URL. Use a quoted
`YYYY-MM-DD` date and a title; the description is optional plain text.

Set `draft: true` to exclude a post from both the homepage and post output.
Posts with `draft: false` (or no draft field) are published, including future-dated
posts. The homepage lists published posts newest first; same-day posts sort by slug.
Do not repeat the title as an H1 in the body: the template provides it.
The migrated `post-1.md` retains the original placeholder title and URL; its
initial publication date is October 30, 2026 and can be edited.

For images, add files to `shared/assets/` and reference them in posts with
`![Description](../../shared/assets/filename.png)`. Link to another post with
`[Another post](../another-post/)`. Paths are relative to the generated post URL.
Markdown may include HTML, so only build content you trust.

## Write a Journal entry

The Seraphic Systems app has three layers: the landing page introduces the studio,
the Journal offers curated stories and bespoke experiences, and Orb explores the
underlying catalog. The Journal starts as a reading experience; individual entries
can grow their own layouts and interactions without changing Orb or Zero's blog.

Create `apps/seraphic-systems/journal/entries/<slug>/index.md`:

```markdown
---
title: A title
description: A short introduction for the index and page.
date: "2026-11-01"
draft: true
---

Write the entry in Markdown, with HTML where useful.
```

The directory name is the stable URL slug, for example `/journal/first-signal/`.
Use lowercase letters, numbers, and hyphens. Title and description are required
plain text. The shared frame supplies the H1, description, navigation, and footer.
The date is an optional publication date, independent of catalog creation dates;
omit it when unknown. Dated entries sort newest first, followed by undated entries,
with slug breaking ties. Future dates do not hide entries. Set `draft: true` to
exclude the entire entry, including its assets; remove it when ready for review.

For a bespoke experience, use `index.html` with the same front matter instead of
`index.md` (exactly one body file per entry). It supplies the HTML inside the shared
article body, not a second document. Optional `style.css` and module `script.js` in
the entry directory are loaded only for that page. Scope custom CSS to
`body[data-entry="<slug>"]` or unique component classes. Put public page assets and
supporting modules in the entry's `assets/` directory; reference them with
`./assets/...` and import modules from `./assets/...`. Only these assets, `style.css`,
`script.js`, and the rendered page are copied, so keep private notes outside assets.
Markdown and HTML are trusted authored source, including scripts.

Journal templates and shared layout live under `journal/templates/` and
`journal/journal.css`; they use the shared design tokens. Custom pages can read
`/catalog.json` and `/songs.json` or link to explicit Orb routes without duplicating
catalog records or inferring relationships. The initial Seraph Zero entry reuses
existing landing-page copy and intentionally has no invented publication date.

Preview with `npm run dev:seraphic`; entries rebuild on save. `npm run build`
generates the Journal alongside the landing page and Orb, excluding templates,
Markdown source, and drafts. Publication follows the same committed PR workflow
as the rest of Seraphic Systems.

## Templates and styles

- `apps/zero/templates/layout.html`: document head, shared assets, navigation, footer.
- `apps/zero/templates/index.html`: blog homepage, with a generated post list.
- `apps/zero/templates/post.html`: post title, date, and rendered Markdown body.
- `shared/tokens.css`: shared semantic color and font tokens.
- `shared/styles.css`: imports the tokens and styles both sites; `.blog` rules apply only to Zero.

Template variables use `{{ title }}` for escaped text and `{{{ content }}}`
for generated HTML. Rebuild after editing posts, templates, or shared assets.

### Design tokens

Use `var(--color-accent)`, `var(--font-body)`, and the other custom properties
from `shared/tokens.css` for shared visual choices. Token names describe their
role so their values can change without rewriting component rules. Keep
page layout, responsive sizes, and individual spacing in `styles.css`.

Both sites load the tokens through the import in `styles.css`; the build copies
both files into each deployment. Another site can load `tokens.css` on its own
and use the values with its own styles. Font tokens specify font stacks;
consuming sites still need to load the fonts (these sites use Google Fonts).

Keep the tokens here while the design develops. When another repository uses
them, extract this file into a small versioned package for explicit updates
across repositories.

### Shared components

Keep reusable UI in `shared/components/<component>/`, alongside the shared
tokens. Use scoped CSS for simple elements and native Web Components for
interactive controls. Components should consume semantic tokens, own their
styles and behavior, and leave song data and page layout to the application.
All builds already copy this directory into each site's `shared/` folder.
When another repository needs the library, extract the tokens and components
into a versioned package with explicit exports; a separate package or framework
is unnecessary while the consumers live here.

The first component is `<seraph-audio-player>`. Load the tokens once on the
page, import its module once, and provide an audio URL and accessible label:

```html
<link rel="stylesheet" href="shared/tokens.css">
<script type="module" src="shared/components/audio-player/audio-player.js"></script>
<seraph-audio-player src="media/example.mp3" label="Example song audio player"></seraph-audio-player>
```

Adjust paths for the page's location. Its shadow DOM isolates the controls from
page styles while inheriting the design tokens. It includes play/pause, a seek
slider, elapsed and total time, mute, volume, and playback error messages.
Buttons work with Enter/Space and sliders with arrow keys. The native audio
engine handles playback and format support; JavaScript is required for the UI.
Metadata loads to show duration, but playback never starts automatically.

Set `.src` (or the `src` attribute) to switch tracks and reset playback; call
`.pause()` to stop playback temporarily. Removing the element pauses it too.
The internal dashboard keeps mix selection, notes, and its direct audio-file
link outside the reusable player. Audio files remain in the app's media folder.

## Preview and verify

Start Zero locally:

```sh
npm run dev
```

Open http://127.0.0.1:5173 (or the URL printed in the terminal).
For the company site, run `npm run dev:seraphic` on port 5174.
The dev server builds on startup, watches posts, templates, shared assets,
and build scripts, then rebuilds and refreshes the browser after edits.
Build errors appear in the terminal; fix the source and save to retry.
Draft posts remain excluded, matching deployment behavior. Stop with Ctrl+C.

Vite is used only for local serving and browser refresh. Deployment uses
`npm run build:production` and the same `dist/` directories. Local previews use
working content and discover ignored audio. `npm run build` checks working
content with registered mix references only; `npm run build:internal` retains
local discovery. To inspect unpublished content, use these working-directory
builds before committing; production deliberately builds the previous commit
until those edits are committed.

Run the build checks with `npm test`.

## Internal song workspace

`apps/internal/` holds the catalog and local management tools. Orb source lives
in `apps/seraphic-systems/orb/` and is reused by both builds. The Seraphic Systems build publishes Orb and the
current catalog; the classic dashboard and Ableton tools remain local-only.

```sh
npm run dev:internal
```

Open http://127.0.0.1:5175 (or the printed URL). Sort songs, select a
song, and choose a dated mix for playback. Song notes come from the Markdown
body. Edit source files to update the song library. The Live Sets page also
supports creating branches through the local development server.
`npm run build:internal` generates a separate `dist/internal/` without audio.
It does not publish anything. Public hosting uses `dist/zero` or
`dist/seraphic-systems`; the latter includes the landing page, Orb, and catalog.
`npm run dev:seraphic` previews both on port 5174 and provides the local mix and
fragment streaming APIs. Ableton management APIs remain exclusive to `dev:internal`.
Plain static hosting supports catalog browsing. The Cloudflare Worker adds hosted
`/api/mixes/` and `/api/fragments/` playback using committed R2 references.
Local upload/playback credentials remain server-side in `.env.r2.local`.

Source records live in `apps/internal/data/`, grouped by type. This directory also
contains `set-registry.json` and `set-snapshots/`. Dashboard code lives in
`dashboard/`, the record schema in `model/`, and local audio in `media/`, all
relative to `apps/internal/`.

Each song in `apps/internal/data/songs/` needs front matter:

```yaml
---
id: higher
title: Higher
song_created: "2019-11-03"
---
```

Use a unique, permanent, lowercase hyphenated `id`. Starting with the song's
current slug is enough; leave the ID unchanged if the title or Markdown filename
changes. An opaque UUID is unnecessary for this file-based library.

Create a song record even before an official mix exists; it can own stem exports
while its mix list is empty. Keep its in-progress status in the Markdown notes.
Leave `song_created` blank or omit it when the creation date is unknown; do not
substitute a stem export date. The dashboard shows “Creation date unknown” and
places undated songs after dated songs when sorting by creation date. A populated
creation date must still be a valid `YYYY-MM-DD` date.

Put audio in `apps/internal/media/mixes/<id>-YYYY-MM-DD.<extension>`:
`higher-2026-04-27.wav`, for example. The date represents the mix version, not
the song's creation date. WAV, MP3, M4A, OGG, FLAC, and AAC are recognized;
playback support depends on the browser. All matching mixes appear in the
version selector, newest first. Different formats on the same date are allowed.
Use distinct dates for successive versions in the same format. If you later
need multiple same-day revisions or arbitrary filenames, introduce explicit
mix records rather than changing song IDs.

The build reports duplicate IDs, malformed dates, and unmatched audio filenames.
Missing media is fine: songs remain visible without playback, including on a
fresh checkout. `**/media/` is ignored by Git, so local audio stays untracked;
song metadata and Orb code are public in the Seraphic Systems build. Both builds
include mix metadata and local API URLs, but never copy mix audio into their
output. Local listening works with `npm run dev:internal` or `npm run dev:seraphic`. Keep any internal-only assets out of `shared/`, which is
copied into both public sites.

### Local plugin resampling

`scripts/resample.py` captures ordered VST3/Audio Unit effect chains, auditions a
loop through the full chain while native editors are open, and renders files or
folders without Ableton. This is an optional local Python tool, independent of
the public sites and catalog. Use Python 3.12 on macOS for the tested setup:

```sh
python3 -m venv apps/internal/media/resampling/.venv
source apps/internal/media/resampling/.venv/bin/activate
python -m pip install -r scripts/requirements-resample.txt
python scripts/resample.py devices
python scripts/resample.py probe \
  "/Library/Audio/Plug-Ins/Components/Decapitator.component" \
  "/Library/Audio/Plug-Ins/VST3/ValhallaRoom.vst3"
```

Capture a chain using an audio file you choose. Both plugins process the loop
throughout the session; close one editor to open the next. Afterward, enter a
plugin number to reopen it, `s` to save the whole chain, or `q` to discard changes.
An interrupted session does not replace the previous saved revision.

```sh
python scripts/resample.py capture grit \
  "/Library/Audio/Plug-Ins/Components/Decapitator.component" \
  "/Library/Audio/Plug-Ins/VST3/ValhallaRoom.vst3" \
  --audio "/path/to/source.wav" --start 10 --duration 8
python scripts/resample.py edit grit --audio "/path/to/source.wav"
python scripts/resample.py audition grit --audio "/path/to/source.wav" --seconds 20
python scripts/resample.py list
python scripts/resample.py render "/path/to/stems" "/path/to/renders" \
  --chains grit --tail 8 --trim -70 --normalize -1 --recursive
```

`--start` and `--duration` select the audition excerpt only (default: first eight
seconds). Loops wrap without resetting effects, preserving delay/reverb state.
Playback runs on a background thread while native editors stay on the main thread.
`--device` selects a name from `devices`. Monitoring defaults to -12 dB and has a
hard ceiling at 0.98; `--monitor-db` changes only listening gain. Rendering never
uses that monitor gain or ceiling. Mono is duplicated to stereo by default; use
`--mono preserve` for chains that accept mono. Only mono/stereo audio effects are
supported. This is not a DAW transport, automation, MIDI, sidechain, or ARA host;
verify any tempo-synced effects against your intended result.

Capture requires an audio file, and render accepts either one audio file or a
folder. Render preserves source sample rates, appends four seconds of silence by
default, and writes 24-bit WAVs. `--trim` removes trailing audio below its threshold
without shortening the source duration. `--normalize` is optional peak normalization,
not loudness normalization. Without it, peaks above 0 dBFS are reported in the worker
log and clip when encoded to integer WAV. Files are currently decoded/processed in
memory, so use shorter sources for large batches or long tails.

Output must be outside the input folder. Each chain gets a readable folder with a
name hash; source extensions are retained (`kick.aif.wav`, `kick.wav.wav`) to avoid
collisions. Existing outputs are skipped unless `--overwrite` is supplied. Each
file/chain render uses a fresh subprocess, with a default 600-second `--timeout`.
Crashes, timeouts, and Python exceptions are recorded and do not stop subsequent
jobs; any failure gives the batch a nonzero exit status. Complete WAVs are published
atomically, so interrupted writes never become final outputs. A forcibly killed
worker can leave a hidden `.resample-*.wav` temporary file beside its destination;
these can be removed after the batch has stopped.

The default workspace is `apps/internal/media/resampling/`: `chains.json` points
to immutable `presets/<revision>/` states, and `jobs/<batch>/` contains manifests,
requests, results, and worker logs. Manifests include source/output hashes, exact
chain revisions and state hashes, processing settings, plugin bundle versions,
and Python/tool versions. Missing, empty, or changed state fails explicitly;
changed plugin bundle versions require recapture. Decapitator AU must be prepared
with audio before it exposes parameters/state; the tool does this before capture
and restoration. Render workers use fresh plugin instances and do not reset
them again after restoring state: Decapitator AU otherwise resets to its factory
settings. Plugin updates and random/modulated effects can still change
results; a recipe is not a guarantee of bit-identical audio across machines.

All workspace files are ignored by Git and excluded from public builds; back them
up separately. Original audio and installed plugin presets are never overwritten,
and renders do not automatically create catalog records. To use another workspace,
put `--workspace /path/to/workspace` **before** the command. Concurrent capture/edit
sessions in the same workspace are refused; old revisions are retained so ongoing
render jobs keep their original preset state. `capture --force` replaces a chain's
current revision while preserving previous state files.

Run the fixture tests with the optional environment activated:

```sh
python -m unittest discover -s tests -p 'test_resample.py'
```

`probe` performs an isolated non-default state round trip and a short synthetic
render for each installed plugin, without opening editors or playing audio.
Native plugin licensing, architecture, editor behavior, and audio-device access
must be checked locally; fixture tests do not establish plugin compatibility.

### Horizons

`apps/internal/data/horizons/` holds values and guiding perspectives for the
practice. Each `Horizon` has a permanent `id`, `title`, `level` from 1 through 4,
and `description`. The schema defines these levels:

| Level | Kind | Meaning | Example |
| --- | --- | --- | --- |
| 1 | Values | Enduring goods that give the practice its purpose. | Contemplation, Creation, Communion |
| 2 | Guiding principles | Ongoing commitments that shape decisions and how the values are practiced. | Integrity, Embodied Practice |
| 3 | Long-term vision | The future way of life, community, or organization the practice seeks to bring about. | A Network of Creative Homes |
| 4 | Near-term goals | Concrete outcomes or milestones pursued to advance the vision. | Release the first First Light experience |

Lower numbers are more foundational; higher numbers move toward concrete action.
Classify by role, not importance or deadline: a long-term vision remains level 3
even when it becomes closer in time. Examples above illustrate the categories;
the three level-1 values and the level-4 goal Establish the Creative Foundation
are currently recorded.
Horizons appear in the Model viewer and use the shared `created_at` field.

### Policies

A `Policy` describes a chosen course of action or ongoing practice that supports
one or more Horizons. Horizons express what is valued or desired; policies
describe how to pursue it and can change as you learn what works. A guiding
principle such as integrity is a Horizon; a concrete practice for upholding it
is a Policy.

Records live in `apps/internal/data/policies/` and require `id`, `title`,
`description`, and `horizons` (a nonempty list of distinct existing Horizon IDs).
They inherit `created_at` and appear with their Horizon links in the Model viewer.
An optional `album` field links a policy to the existing Album ID it concerns.
Use the Markdown body for supporting rationale or review notes. For example,
this command creates a policy supporting Communion:

```sh
npm run create:internal -- Policy '{"id":"weekly-gathering","title":"Weekly Gathering","description":"Hold a weekly gathering to share work and spend time together.","horizons":["communion"]}'
```

### Ableton project inventory

`apps/internal/data/projects/` contains one Markdown record per Ableton project
folder. The working projects remain in `~/Ableton`; no Live Sets, samples,
or backups are copied into this repository. These records are an inventory
only for now; the dashboard and build do not yet consume them.

Each record has a permanent `id`, a `title`, and a `song` referencing an
existing song ID (blank when unresolved). `root: ableton` means `~/Ableton`;
`folder` is relative to that root. `sets` lists the non-backup `.als` paths
relative to the project folder, and `main_set` identifies the main Live Set.
Keep the ID unchanged if the folder or set is renamed, and update the paths.
Multiple projects can reference the same song. Backup sets are not separate
records. Dates in names are labels, not verified song creation or mix dates.

The October 30, 2026 inventory found 24 projects with one main Live Set each.
Twenty-two match existing song IDs by name. Two remain unassigned:

- [Catch Me](apps/internal/data/projects/catch-me-10-30-26.md)
- [Soundtrack Idea](apps/internal/data/projects/soundtrack-idea.md)

No project name matched `anyone`, `gold`, or `need-someone` in this folder.
Project-to-mix and project-to-stem relationships have not been inferred.

Run `npm run lint:projects` to check inventoried project folders, inventory-only
sets, and the current paths in the set registry. Names must start with
`idea-<name>` or an existing Song title or ID. Matching ignores case, apostrophes,
and differences between spaces, underscores, and hyphens; any suffix must be
separated from the Song name. For example, `idea-piano-sketch.als` and
`higher-mix-10-28-26.als` pass; `higherground.als` does not match `higher`.
The `.als` extension and Ableton's trailing ` Project` folder label are ignored.
The command exits with status 1 on violations. The catalog also includes these
diagnostics, shown with the affected record in the model inspector, without
blocking builds or imports. This check reads repository metadata; refresh the
set registry with `analyze:sets` to include newly discovered files. It never
renames files, changes permanent IDs, or infers Song associations.

### Analyze Live Sets and save history

With Python 3 installed, scan the current sets in `~/Ableton`:

```sh
npm run analyze:sets
```

Analyze one set or another folder by passing its path. Folder scans recurse
and skip `Backup` directories; an explicitly supplied backup file can still be
analyzed. The script decompresses `.als` XML without opening Live or loading
plugins, and never writes to the source files.

```sh
python3 scripts/ableton.py "~/Ableton/higher-mix-10-28-26 Project/higher-mix-10-28-26.als" --json
python3 scripts/ableton.py --snapshot apps/internal/data/set-snapshots
```

The count is saved external `PluginDevice` instances, including nested racks,
return/master tracks, and switched-off devices. It excludes stock Live devices,
Max for Live devices, and external hardware. It is a dependency inventory, not
a count of plugins currently processing audio. VST2, VST3, and AU descriptors
are recognized; unrecognized descriptors still count and produce warnings.
VST2/VST3 were verified against local sets; AU support is fixture-tested only.
Distinct plugins are grouped by format, name, and saved plugin ID, so VST2 and
VST3 editions count separately. This does not check installation or licensing.

`--json` prints per-plugin counts and format totals for every scanned set.
`--snapshot` saves only sets whose decompressed XML or analyzer version differs
from their latest saved snapshot. If all sets are unchanged, no file is written.
Gzip metadata changes alone do not create a snapshot. A changed set is captured
even when its plugin count stays the same, including when reverting to an older
state. Reports include a UTC scan time, schema/analyzer versions,
permanent set IDs, relative set paths, and hashes of source bytes and XML.
Each set also includes numeric `bpm` from the saved main/master track tempo,
or `null` when unavailable. This is the saved tempo value; it does not describe
tempo automation or scene tempo changes. Analyzer version 2 adds this field:
the next scan captures a new snapshot even for unchanged sets, while historical
snapshots remain intact and may omit `bpm`.
Snapshots contain analysis results, not copies of sets or plugin state, and
are not backups. They can be tracked in Git. Scans are manual; nothing runs
automatically. Invalid sets produce errors and a nonzero exit status; partial
reports retain both successful results and errors.

Set IDs are UUIDs stored in `apps/internal/data/set-registry.json`, independently of
project IDs and filenames. Track this registry in Git alongside snapshots.
Paths under your home directory use `~/` so they work under another username.
The script updates this registry on ordinary scans too. Use `--registry PATH`
for a separate library. Concurrent runs using one registry are rejected;
registry updates are atomic. A persistent `.lock` file is ignored by Git.

An unchanged renamed/moved set keeps its ID automatically when its former paths
are absent and the XML match is unambiguous. Copies get separate IDs. For a
rename plus edits, explicitly relink **before scanning the new path**:

```sh
python3 scripts/ableton.py --relink "~/Ableton/old Project/old.als" "~/Ableton/new Project/new.als" --snapshot apps/internal/data/set-snapshots
```

The old path must be missing and the new path must not already have an ID.
If both the name and content changed, or several identical files moved, the
script assigns a new ID unless explicitly relinked. Project inventory paths
still need updating separately after renames. No IDs are written into `.als`
files. Old schema-1 snapshots remain intact; the first new run creates a
schema-2 baseline with IDs. Snapshot files contain changes, so reconstruct a
set's history by ID rather than assuming each file is a complete library scan.
A pure rename updates the registry without duplicating an unchanged snapshot.

Keep hashes and analyzer versions when comparing snapshots. Future analyzers
can add more results with explicit schema versions. The dashboard does not
consume snapshots yet. Run analyzer checks with
`python3 -m unittest discover -s tests -p 'test_ableton.py'`.

### Branch a Live Set

Run `npm run dev:internal` and choose **Live Sets** in the navigation, or open
http://127.0.0.1:5175/sets.html. Select an idea or song, expand **Versions & set details**, enter a descriptive
branch name, and click **Make branch**. Save in Ableton first: this copies the latest
saved file, not unsaved changes in an open session. Open the newly created
`.als` file in Ableton to work on the branch.

The new set lives alongside its parent in the same project and shares its
samples. The original remains untouched. Each branch gets a permanent ID,
`parent_set_id`, a creation time, and `branch_origin` linking to an exact parent
analysis snapshot and source/XML hashes. Both parent and child states are
captured at creation, even if the parent changed since its last scan. Nested
branches appear under their parents in the UI. No filename convention is
required. Existing files and registered historical paths are never overwritten.

**Refresh sets** scans `~/Ableton` and saves changed analyses. Branch creation
and scans use the same registry lock. These controls require the loopback-only
development server; static builds cannot perform local file operations. No
public site includes this API. Project Markdown inventories remain the original
inventory; the set registry tracks new branches and their lineage.

CLI equivalent (using a parent's permanent ID from `set-registry.json`):

```sh
python3 scripts/ableton_branch.py list
python3 scripts/ableton_branch.py create --parent PARENT-UUID --name "Quieter ending"
```

Creation copies a set; it does not attach an already-existing alternate file.
Snapshots preserve analysis and lineage rather than recoverable plugin state.
Keep normal Ableton backups. Run all Python analyzer and branch checks with
`python3 -m unittest discover -s tests -p 'test_ableton*.py'` and the local API
checks with `npm test` (requires loopback networking).

Use **Archive set** to hide an unwanted or missing set while preserving its
registry ID, lineage, snapshots, and any file still on disk. **Show archived**
reveals archived entries and **Restore set** brings them back. Archiving does
not delete files or stop analysis of files that remain in the Ableton folder;
to discard a test file, move just that `.als` file to Trash in Finder, then
archive its entry. Do not delete the project folder or shared samples. Archived
sets cannot be branched until restored. Children remain visible if their parent
is archived. CLI equivalents are `python3 scripts/ableton_branch.py archive
--set-id UUID` and the same command with `restore`.

### Metadata and notes for a mix

Each current mix has `apps/internal/data/mixes/<id>-YYYY-MM-DD.md`, using the same filename
stem as the audio. For example, `data/mixes/higher-2026-04-27.md`:

```markdown
---
song: higher
date: "2026-04-27"
bpm:
key:
---

Listening notes for this version go here.
```

The `song` field references the permanent song ID; `date` is the mix date.
Fill in `bpm` with a positive number (such as `120` or `123.5`) and `key` with
text (such as `"F# minor"`). Leave either blank when unknown. Populated values
appear below the mix selector and update when you switch versions.
Both must agree with the filename. The Markdown body appears beneath the player
when that mix is selected. Empty or absent notes add no extra interface.
Formats of the same dated mix (such as WAV and MP3) share metadata and notes.
For new mixes, add both the audio and its Markdown file. Audio without Markdown
still works, so you can fill in metadata later.

Keep lyrics and general ideas in the song's Markdown file; keep version-specific
feedback in the mix's Markdown file. Mix notes are tracked by Git separately
from ignored audio and remain valid when audio is absent on another checkout.

For a mix that changes tempo, leave `bpm` blank and list the tempos in playback
order instead:

```yaml
bpm:
bpm_changes: [71, 83]
```

The dashboard displays `71 → 83 BPM`. Use `bpm` for constant tempo, or
`bpm_changes` for variable tempo, never both. Add section names or transition
timestamps in the Markdown notes if useful; this list does not specify timing.

### Private R2 mixes

Mix originals use the private `seraph-music-media` bucket, separate from fragment
previews. Keep public access disabled. `npm run dev:internal` serves
`/api/mixes/<filename>/audio` on localhost, trying the verified R2 object first,
then the original in `apps/internal/media/mixes/` if R2 is unconfigured or
unavailable. Both paths support GET, HEAD, and byte ranges for seeking. Credentials
stay on the server; the browser receives no signed URLs or R2 keys.

Set `R2_MEDIA_BUCKET=seraph-music-media` in the ignored `.env.r2.local`. Shared
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are reused unless
`R2_MEDIA_ACCESS_KEY_ID` and `R2_MEDIA_SECRET_ACCESS_KEY` specify a separate key.
Use a bucket-scoped **Object Read & Write** key for upload; playback can use an
Object Read key. Existing fragment-only credentials cannot access this bucket.
Create the private bucket in Cloudflare first, or use `--create-bucket` with
credentials that already permit bucket creation.

```sh
npm run mixes:upload
# Only with existing bucket-creation permission:
npm run mixes:upload -- --create-bucket
```

Uploads preserve original formats and bytes. Objects use
`mixes/<filename>/<sha256>` keys with the correct audio content type, private cache
headers, and an upload transport checksum. The uploader verifies remote size,
content type, and SHA-256 metadata before atomically updating the tracked
`apps/internal/data/mix-media.json` manifest. Rerunning reuses matching objects and
resumes interrupted uploads; changed files receive new objects, and old remote
versions are retained. Local originals and mix Markdown notes are never modified.

Local previews and the internal build merge registered remote files with locally
discovered files. Public builds use only registered references, and production
reads those references from the committed snapshot. Registered mixes remain in
the dashboard and model catalog without the local media folder.
Static output contains metadata only; Cloudflare serves registered audio through
the hosted Worker, while local previews can use the local server. Keep a separate backup of
original audio. Stem uploads are not included in this command.

### Stem exports and their mixes

Keep one Markdown record per export set in `apps/internal/data/stems/raw/` or
`apps/internal/data/stems/cleaned/`, mirroring the ignored audio in
`media/stems/raw/` and `media/stems/cleaned/`. The build reads Markdown records
recursively under `data/stems/`; export IDs must be unique across all subdirectories.
A song can have multiple export sets, and an export set can reference multiple
dated mixes. For example, `data/stems/raw/epoch-stems-01.md`:

```yaml
---
id: epoch-stems-01
title: epoch_stems_122.6_Dmin
song: epoch
folder: media/stems/raw/epoch
master: epoch_stems_122.6_Dmin.wav
mixes: [epoch-2021-04-25]
bpm: 122.6
bpm_changes:
key: D minor
---
```

The permanent export `id` matches the Markdown filename. Keep it unchanged if
the export folder or project name changes; give each new export its own record
and ID. Keep raw exports when adding cleaned versions: create a separate record
and folder for each cleaned export so its mix associations and review notes can
be tracked independently. Put the new record in `data/stems/cleaned/` and the audio
in `media/stems/cleaned/<export-folder>/`. `folder` is relative to
`apps/internal/`; `master` is the project-named
full mix export within that folder, not an individual instrument stem. Preserve
the original audio filenames. Use a known mix date where possible. If a project
date is explicitly chosen for a mix with no verified date, document that source
and uncertainty in the mix record.

Existing exports were cataloged after export and have no verified source Live
Set snapshot. Raw and cleaned describe processing stage, not whether the source
is verified. Mix associations were recorded afterward through audio comparison
or review; they do not establish export provenance. Capturing a reference to the
exact source Live Set and snapshot at export time is future work.

Optional `bpm`, `bpm_changes`, and `key` describe the export as a whole and use
the same rules as mix metadata: a positive constant BPM or a list of at least
two positive tempos in playback order, never both, and a free-text musical key.
Initial values are copied from explicitly linked mixes where available and
consistent; unresolved or conflicting values stay blank. These are stored on
the export and can be corrected independently; the build does not inherit later
mix edits automatically. An unlinked export stays blank even if its song has
other mixes with metadata.

`song` references an existing song ID and can be blank for an export without a
song record. `mixes` records clear shared-core audio associations,
using the mix Markdown filename without `.md`. Formats of the same dated mix
share the association. A link means a clear shared core arrangement in the same
version family, not necessarily an identical master, export length, or common
source Live Set snapshot. Raw exports
can include additional content; record those differences in their notes.
Use `mixes: []` for unresolved exports; keep
candidate mix links, comparison evidence, and differences in the Markdown body.
From a record in `data/stems/raw/` or `data/stems/cleaned/`, use a relative Markdown link
such as `[Epoch mix](../../mixes/epoch-2021-04-25.md)`.
The initial comparison established 11 clear links. Listening review on October
30, 2026 added Dream and Won't Let You Go as shared-core matches, bringing the
total to 13. A subsequent listening review confirmed Bury the Sun, bringing the
total to 14. All the Things You Love links to a separate older mix copied from
its export master, bringing the total to 15. Its July 8, 2025 date comes from
the project name, as explicitly chosen during review. Coldness also links to
an earlier mix copied from its clean export master, bringing the total to 16;
its January 19, 2026 date comes from the project name using the same approach.
Higher links to the supplied July 10, 2024 mix after listening review, bringing
the total to 17.
Stars remains an alternate version with an unresolved mix link. Mania was
confirmed as a different mix, with creation of a separate mix record on hold.
Reason was confirmed as a different, later mix; further review and creation of
a separate mix record are deferred.
Who I Am and Because You're You have in-progress song records and linked raw
stem exports, with unknown creation dates and no official mixes yet.

The internal build validates song and mix references and rejects cross-song
links. References work without local audio when the mix Markdown exists.
It generates `stems.json` for the entire export inventory, plus derived `stems`
ID lists on each song and each available mix in `songs.json`. This gives both
directions of lookup without maintaining duplicate relationships in mix files.
The dashboard does not yet display these relationships. Stem audio is not
copied by the build, and its absence does not break metadata validation.

### Explore the internal model

Choose **Model** in the internal dashboard, or open
[the Model page](http://127.0.0.1:5175/model.html) while `npm run dev:internal`
is running. Select a type to highlight its references, inspect its fields and
relationship cardinalities, and explore real records. Record links navigate to
the related type and select that record. The layout also works on narrow screens.
Unresolved associations and relationships not yet modeled are labeled explicitly.

[`apps/internal/model/schema.json`](apps/internal/model/schema.json) is the
canonical JSON Schema (draft 7) collection for source records. Validate a record
against `#/definitions/<Type>`. Catalog entities include Member, Horizon, Policy,
Album, AlbumTrack, Song, Idea, MusicFragment, Mix, MixFile, StemExport, Project,
LiveSet, and Snapshot. SetAnalysis and
PluginUsage are embedded values; SetRegistry describes the registry envelope.
Markdown contracts cover front matter, not Markdown bodies. Unknown fields are
allowed for additive evolution. YAML dates are normalized to JSON date strings;
`*_at` timestamps retain their full time and timezone.

Member profiles live in `apps/internal/data/members/*.md` with a permanent `id` and
required `name`. Optional `skills` and `roles` are lists of unique, nonblank strings;
`bio`, `email`, and `website` hold profile and contact details when known. The
Model viewer displays each member by name. Omit unknown details. The first member
is Timothy Butler, with software engineering and audio production skills.

AlbumTrack song associations use an optional `primary_song` Song ID for the main
work and an optional `secondary_songs` array of additional Song IDs for medleys or
tracks combining several works. Secondary IDs must be unique and exclude the
primary song. For example, `primary_song: work` with `secondary_songs: [other-work]`
links one track to both songs. Leave associations absent until known; names alone
do not establish a link.

### Music fragments and historical Ideas

`MusicFragment` records live in `apps/internal/data/music-fragments/*.md`. Each
has a permanent generated `id`, `root: music-keepers`, and an audio `file` path
relative to `/Volumes/MusicArchive/_keepers`. Audio remains on the external drive;
the catalog can build while that drive is disconnected. Key and positive numeric
BPM are optional in the general model. Tags, loop/one-shot classification,
melody/sound, character, role, notes, memories, and review flags are preserved
when recorded.

The optional `idea` reference identifies the musical Idea the fragment came from.
One Idea can have many fragments; reuse elsewhere does not change this origin.
Ideas can have an optional working `title` without changing their permanent ID.
Historical Ideas need neither a project nor a Live Set. Song associations remain
explicit; a matching group name alone does not establish one.

The initial import uses [Samples Part II](https://docs.google.com/spreadsheets/d/16NC9GygRWgXcIFXm7h-0d49B1cp2n9J8Ss9GD-XtC60/edit).
It includes 102 distinct files with Key, BPM, and Group filled in across the dated
tabs, creating 21 Ideas from the named groups. Eight fragments labeled `Orphan`
have no Idea association. The untagged `Sheet1` inventory contributes no records.
Each fragment retains its source spreadsheet ID, tab ID/name, row, Group, and
date label. Imported record timestamps describe this import, not musical creation.

For later imports, read the live workbook and save a JSON snapshot containing
`spreadsheet_id` and `rows`. Each row contains `sheet`, `sheet_id`, `row` (the
1-based worksheet row), and `values` (columns A–P in their original order).
Run `node scripts/import-music-fragments.mjs <snapshot.json>`. The importer selects
rows with Key, BPM, and Group, excludes rows marked Delete, validates metadata,
and checks all selected audio paths before writing. It never deletes or edits
audio. IDs derive from source identity rather than mutable working titles;
reimporting the same file creates no duplicates and preserves existing metadata
and creation timestamps. This is an additive import, not a live spreadsheet sync.
The Model page exposes fragments and their Idea links; the Sets workspace still
lists Ideas through associated Live Sets.

Choose **Fragments** in the dashboard navigation, or open
`http://127.0.0.1:5175/fragments.html` with `npm run dev:internal` running.
Browse all fragments grouped by Idea, select one Idea, or choose
**Unassociated / Orphan**. Search covers filenames, Idea names, keys, BPM, tags,
notes, and memories. Each row includes musical metadata and expandable notes with
a link to the original spreadsheet row. The shared player supports pause and seeking
and plays one fragment at a time.

Playback uses the local `/api/fragments/<id>/audio` endpoint. Uploaded R2 previews
play without the sample drive. If R2 is not configured or the remote object is
unavailable, the endpoint tries the original file. Set `SERAPH_FRAGMENT_LIBRARY`
before starting the server to override the library root. Only cataloged files
inside that root can stream. For local playback, WAV and other browser audio
formats stream directly; AIF/AIFF files get a temporary PCM WAV preview on first
listen, using macOS `afconvert` or `ffmpeg` on other platforms. These local previews
are cached for the server session and cleaned up on shutdown. The static build
includes the browser and metadata; Cloudflare playback uses uploaded R2 previews
through the hosted Worker. Sample audio and credentials are never bundled into
the build.

#### Private Cloudflare R2 previews

The intended bucket is `seraph-music-fragments`. Keep public access disabled.
The local server authenticates to R2 and proxies audio, including byte-range
requests for seeking; the browser receives neither R2 credentials nor signed URLs.
No bucket CORS rule is needed for this server-to-server path.

1. Create the private bucket in your Cloudflare account. For upload and playback,
   create an R2 S3 access key with **Object Read & Write** permissions scoped to
   this bucket. These are R2 Access Key ID / Secret Access Key credentials, not
   a general Cloudflare bearer API token.
2. Copy `.env.r2.local.example` to `.env.r2.local` and fill in the Cloudflare
   account ID and R2 credentials locally. The file is ignored by Git. Never put
   these values into fragment records, frontend code, or `VITE_*` variables.
3. With MusicArchive connected and `ffmpeg` installed, run
   `npm run fragments:prepare` to generate 192 kbps AAC/M4A listening copies in
   the ignored `tmp/music-fragment-previews/` directory. Original files stay intact.
4. Run `npm run fragments:upload`. It reuses prepared files, uploads new objects,
   verifies their size/content type/checksum metadata via R2, then records the
   object reference under each fragment's optional `preview` field. Existing
   creation timestamps and notes are preserved. Repeating the command reuses
   matching remote objects. Interruptions can be resumed by rerunning it.
5. Restart `npm run dev:internal`, which automatically reads `.env.r2.local`.
   Uploaded previews now play without the archive drive. Internet access is still
   required for R2; offline downloads are not implemented.

If using credentials that already have bucket-creation permission, the upload
command also accepts `-- --create-bucket` to create the private bucket through
the S3 API. Bucket-scoped object credentials cannot create buckets; creating the
bucket in the Cloudflare dashboard first avoids needing broader credentials.
An optional `R2_ENDPOINT` supports EU/FedRAMP jurisdiction endpoints.

Remote object names include the permanent fragment ID and preview SHA-256, so
changed audio gets a new object rather than replacing the previous version. A
record receives `preview` metadata only after a verified upload. Preparation alone
does not change records. Old remote versions are retained; there is no automatic
deletion. After uploading, playback can use separate bucket-scoped read-only R2
credentials. Configuration follows the [Cloudflare R2 S3 SDK documentation](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

The documented schema extensions are:

- `x-version`: version of the model definition, independent of analyzer/report versions.
- `x-model` on entity definitions: source location, identity rule, and diagram
  position as `[column, row]`. Definitions without it are embedded values or envelopes.
- `x-relations`: source/target types, owning field, label, cardinality, meaning,
  and lookup kind. `reference` resolves an ID; `path-join` matches a project's
  original inventory against exact current registry paths. Field selectors support
  dotted paths and array traversal, e.g. `sets[].set_id`.
- `x-gaps`: relationships that have not been recorded; these are explanatory notes,
  never generated links.

`scripts/model.mjs` validates source records with Ajv and derives the catalog and
backlinks. The internal build uses the same schema as the viewer, rejects dangling
ID references, duplicate identities/album positions, invalid main-set references,
and branch cycles, and preserves unresolved optional associations. Existing media
and stem checks remain in place. Mix identity is song + date, with separate MixFile
records for each available audio format. Metadata-only mixes remain in the catalog.
Legacy schema-1 snapshot reports remain readable but have no inferred set-ID links.

`npm run build:internal` generates `model-schema.json` and `catalog.json` alongside
the dashboard. The Seraphic Systems build also publishes these files for Orb.
The catalog contains front matter, derived set registry records, and analysis
reports; the current catalog is intentionally public. Raw source records, registry
files, snapshots, and local audio are not copied into public output. The Python analyzer retains its existing registry and
snapshot formats; this model does not rewrite history. The viewer reflects the
last build; after scanning or branching, rebuild/restart the internal server to
refresh it. Schema and Markdown edits already trigger development rebuilds.


### Shared record creation time

Every catalog entity inherits `created_at` from `RecordBase` through JSON Schema
`allOf`. It is an ISO 8601 date-time with a timezone, or `null` when unknown. It
means **when the workspace record was created**. Keep musical creation dates in
`song_created`, mix version dates in `date`, and analysis times in `analyzed_at`.
A rebuild, rename, copy of the checkout, or metadata edit must never reset it.
Embedded analysis values and the registry envelope are not independent records.

Existing Markdown records explicitly store `created_at: null`; existing set
registry rows use null unless a recorded `branched_at` establishes their creation.
Historical snapshot files are preserved unchanged: their catalog entries use the
recorded `analyzed_at` when no `created_at` was stored. Explicit nulls are preserved.
Generated mix-file entries and audio-only mix records use null when no persistent
creation metadata exists. Filesystem creation/modification times and filename
dates are never used to fill unknowns. Shared defaults are materialized by the
catalog loader because JSON Schema defaults alone do not write values.

Create new Markdown records with the timestamped helper, for example:

```sh
npm run create:internal -- Member '{"id":"new-member","name":"New Member","skills":[]}'
npm run create:internal -- Song '{"id":"new-song","title":"New Song"}'
npm run create:internal -- Mix '{"song":"new-song","date":"2026-10-30"}'
```

The helper supports Member, Song, Mix, StemExport, Project, Album, and AlbumTrack. Supply
the type's required front matter (shown on the Model page); it stamps `created_at`
once, validates the record shape, and refuses to overwrite existing files.
The internal build then checks all cross-record references. For hand-authored
records, include a quoted timestamp such as `created_at: "2026-10-30T14:00:00-04:00"`.
Missing fields on legacy records remain accepted and normalize to null.
Newly registered Live Sets, branches, and snapshot reports receive timestamps
from their Python creation paths automatically. Existing record timestamps survive
rescans and branching. No analyzer/report version bump is needed for this additive field.

For aligned records going forward, keep the same stable Song ID on projects,
mixes, and stem exports, and record confirmed mix associations on the stem
export. Record creation time alone does not establish production provenance.


### Start an idea or continue a song

The **Live Sets** page is the entry point for working in Ableton:

1. **New Live Set** automatically assigns an ID like `idea-20261030-a1b2c3d4e5f6`,
   creates a persistent Idea record, an unassigned project and blank set, registers its permanent UUID and `created_at`, saves an initial
   analysis snapshot, and opens the file in Ableton. The Idea, project record, set,
   and report are created together; failures roll back newly created files.
2. **Ideas** lists active work without a song association, grouped by persistent Idea.
   Select an idea and choose **Open in Ableton** to pick it up. Use **Link to a
   song** when it develops into an existing song. This saves `Idea.song`, retains
   the original Idea record, and applies to its project sets and branches. Unlinked
   projects and standalone set lineages receive Idea records on workspace refresh.
3. **Songs** selects the most recently saved, available, non-archived associated
   set, across that song's projects and branches. Latest means the file's saved
   modification time, independent of record `created_at`. Missing or archived
   files never become the default. Equal save times are ordered by stable set ID.

**Versions & set details** keeps alternate sets, branching, paths, plugin analysis,
and archiving available without putting them in the main flow. Songs without
linked, available sets are shown explicitly. Search covers idea names and song
titles. Use **Refresh saved sets** after saving or renaming files in Ableton.
The page reads live registry/project data through the local API; it does not wait
for a static catalog rebuild.

New ideas live at `~/Ableton/<idea-id> Project/<idea-id>.als`, with
Idea metadata under `apps/internal/data/ideas/<idea-id>.md` and a separate project
record under `apps/internal/data/projects/`. The generated ID uses the UTC date
and a random suffix; no working title is required. Historical Ideas may omit both
`project_id` and `set_id` when the association is unknown or not applicable, or
reference one when known; an Idea cannot reference both. Unknown creation dates
remain null. The Sets workspace lists Ideas through their associated sets.
Existing project names are
never reused or overwritten. The default blank template is detected from an
installed Ableton application. Set `SERAPH_LIVE_TEMPLATE` to a blank `.als` file
before starting the server to override it. The macOS `open` command uses the
system's associated Ableton application. Open actions accept only registered,
non-archived `.als` files whose resolved paths remain inside the Ableton library.
No template file or existing Live Set is modified during idea creation.

New set registry rows record `project_id`; new branches inherit this ownership.
For older inventory, the workspace matches the current set's containing folder to
an exact project folder under the Ableton root. This is a path-based ownership
lookup, not a song-name guess. The canonical song link for a project remains on
its Markdown record. An optional set-level `song` is used for independently
registered sets and inherited by their newly created branches.

### Orb music interface

A separate spatial interface is available at
[http://127.0.0.1:5175/orb/](http://127.0.0.1:5175/orb/) with the same
`npm run dev:internal` command. The existing dashboard, Live Sets, and Model
pages remain at their original URLs. The same Orb source is included in
`npm run build:internal` and the public Seraphic Systems build. On the public
site, the landing page links to the Journal and Orb; Orb links back to both. The
Journal links to the catalog in Orb. There is no
separate Orb deployment or duplicate implementation. Both builds copy the same
`apps/seraphic-systems/orb/` source, and both development servers watch that
directory for changes.

Open Home → Music → Songs or Albums. The UI reads the existing `songs.json`
and `catalog.json`; it does not modify source records. Songs retain mix
selection, tempo/key metadata, playback, and notes. Albums show their ordered
track records. Tracks without explicit titles display their track number;
only recorded `primary_song` relationships provide associated song playback.
No title or song association is inferred from a filename.

Each page declares its default view, optional named alternatives, and the
controls available within each view. Home and Music use a spatial view without
view controls. Songs offers Orbs and Players with title search and Scatter / A–Z
ordering; Albums offers Orbs with search and ordering. Individual albums offer
Track orbs and Players with fixed track order and no search or ordering controls.
The View orb appears only when a page has alternatives or exposed controls.

Views, ordering, and search are included in the URL. Unknown views fall back to
the page default; undeclared controls are ignored by both routing and layout.
Player cards show latest-mix controls; tracks without a linked song or songs
without mixes show an explicit empty state. Switching presentations morphs
matching items where browser view transitions are supported, with a
fade-out/fade-in fallback.
Reduced-motion preferences use a brief fade without movement.

The music-note Orb beside the navigation Orb opens the shared audio player.
List and detail controls use that same player, so only one mix plays at a time.
Playback continues while navigating within Orb, filtering, switching views,
or closing the player. Audio loads only after choosing Play; leaving Orb or
reloading the page ends the playback session. Selecting a mix in detail changes
the controls shown there; choosing Play switches the shared player to that mix.

Recent locations are stored in this browser only. Routes and arrangement
queries support reload, sharing, and browser back/forward. Static builds emit
an HTML entry point for every current content route. Use Escape to close the
nav orb or detail, and up/down arrows or scroll to step between detail items.
Scrollable notes and playback controls retain their native interactions.
Reduced-motion preferences replace morphs with short fades.

Home also includes a Model container generated from the schema’s `x-model`
definitions and `x-relations`. Select a type to highlight its incoming and
outgoing relationships without moving the map. The inspector shows inherited
fields, embedded values, cardinalities, real records, and model gaps. Relationship
buttons follow related types; Escape or the Model breadcrumb clears selection.
Selection is addressable with `/orb/model/?select=type-Song` and participates in
browser history. The default Relationships view uses stable schema groupings;
Scatter and A–Z are named alternatives, each with title search. On smaller screens the inspector follows the
map; selecting a type scrolls to it, and clearing selection returns to the map.

The framework-free modules in `apps/seraphic-systems/orb/` separate the
content adapter (`content.js`), pure arrangement/layout engine (`engine.js`),
URL mapping (`routes.js`), and DOM renderer (`app.js`). Container declarations in
`content.js` specify `views.default` and `views.options`; each option defines an
`id`, `label`, `presentation`, `arrangement`, and optional `controls` (`search`
and/or an `arrangements` allowlist). `views.js` resolves those policies for both
routing and layout. Renderer support alone never exposes views or controls.
Presentation capabilities
and geometry live in `presentations.js`; type-specific DOM views and inline
playback controls live in `presentation-views.js`. New presentations declare
supported node types and layout geometry, then provide a DOM renderer with a
`dispose` hook for subscriptions. Unsupported types retain the standard Orb.
`playback.js` coordinates a single media element owned by the persistent player. Add or change records
in the existing data directories and rebuild to update this view.
