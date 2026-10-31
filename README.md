# Seraph sites

Two static sites share CSS, favicons, and images from `shared/`.
Zero's blog is generated from Markdown; Seraphic Systems remains plain HTML.

Site source lives in `apps/seraphic-systems/` and `apps/zero/`. Shared assets,
build scripts, and tests stay at the repository root.

## Build and deploy

Use Node.js 22.12 or later. Install dependencies once:

```sh
npm ci
```

Build both sites:

```sh
npm run build
```

`node scripts/build.mjs` also works after dependencies are installed.
Configure two hosting projects using the same repository with the repository
root as the build working directory. Use `npm ci && npm run build` as the
build command and assign each its own domain:

| Site             | Publish directory       |
| ---------------- | ----------------------- |
| Zero             | `dist/zero`             |
| Seraphic Systems | `dist/seraphic-systems` |

Each output includes its own copy of `shared/`. Generated output is ignored by
Git and rebuilt from source. Zero's Markdown and templates are not published.

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

Vite is used only for local serving and browser refresh. Deployment still uses
`npm run build` and the same `dist/` directories.

Run the build checks with `npm test`.

## Internal song workspace

`apps/internal/` is a separate local dashboard. It is excluded from the default
`npm run build` and has no link from either public site.

```sh
npm run dev:internal
```

Open http://127.0.0.1:5175 (or the printed URL). Sort songs, select a
song, and choose a dated mix for playback. Song notes come from the Markdown
body. Edit source files to update the song library. The Live Sets page also
supports creating branches through the local development server.
`npm run build:internal` generates a separate `dist/internal/` including local
audio. It does not publish anything. Keep public hosting pointed at `dist/zero`
or `dist/seraphic-systems`, as above.

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
song metadata and dashboard code can be built in public. An internal build
copies matched audio into its output, so deploying that output would make those
files accessible too. Keep any internal-only assets out of `shared/`, which is
copied into both public sites.

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
against `#/definitions/<Type>`. The ten catalog entities are Member, Album, AlbumTrack,
Song, Mix, MixFile, StemExport, Project, LiveSet, and Snapshot. SetAnalysis and
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
the dashboard. The catalog contains front matter, set registry records, and analysis
reports, and belongs only in the internal output. The default public build neither
loads nor publishes it. The Python analyzer retains its existing registry and
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
and a random suffix; no working title is required. Backfilled Ideas use stable
project/set IDs and leave unknown creation dates as null. Existing project names are
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
