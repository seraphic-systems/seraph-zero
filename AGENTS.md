# Repository guidance

## Current foundation

Read README.md and docs/FOUNDATION.md before changing scope or workflows.
The accepted scope is the existing landing page, one Journal entry, and Horizons
in Orb. The full earlier project is preserved in tag
`baseline/pre-foundation-2026-11-02` and branch `lab/full-project`.
Bring back ideas deliberately through focused PRs, not a whole-lab merge.

- `apps/seraphic-systems/`: landing, Journal, and Orb source.
- `apps/internal/data/horizons/`: persistent Markdown Horizon records.
- `apps/internal/model/schema.json`: active record contracts.
- `shared/`: public tokens, styles, icons, and assets.
- `scripts/`: validation, creation, build, deployment.
- `tests/`: active Node tests.

## Development and verification

Use Node.js >=22.12 and `npm ci` with the committed lockfile.

| Task | Command |
| --- | --- |
| Local preview, including marked Journal drafts | `npm run dev` |
| Public build, excluding drafts | `npm run build` |
| Committed public release build | `npm run build:production` |
| Node tests | `npm test` |
| New Horizon | `npm run create:record -- Horizon '<JSON front matter>'` |
| Committed branch preview deployment | `npm run deploy:preview` |
| Accepted production deployment | `npm run deploy:production` |

Run Node tests for JS/build changes and the affected build for template/schema/content
changes. Inspect UI changes in a browser at desktop and narrow widths, including
keyboard navigation. Report checks and limits. Documentation-only edits need no
application tests. Never deploy as part of an unapproved review task.

## Implementation

- Keep ES modules, plain HTML/CSS, Vite previews, and the static Node build.
- Edit source, never generated `dist/` output. Only `dist/seraphic-systems` ships.
- Keep content policy (`content.js`), pure layout (`engine.js`), URL routing
  (`routes.js`), presentation (`presentations.js`), and DOM coordination (`app.js`)
  separate. Add controls only when the active scope needs them.
- Use semantic tokens from `shared/tokens.css`. Keep application layout in the app.
- The landing copy stays HTML. Journal entries remain authored documents, not
  automatically generated catalog views. Update README when workflows change.
- Official changes use feature PRs into `master`. Production builds committed HEAD;
  deployment checks the accepted origin/master revision. Do not merge or deploy
  without user authorization. Do not assume GitHub protections are enabled.

## Data and preservation

- Preserve existing permanent IDs and `created_at` values exactly. Unknown dates
  stay unknown. Record creation and publication mean different things.
- The schema describes front matter. Define concepts in plain language and evolve
  contracts through actual use. Do not infer relationships or add speculative types.
- New records default to private. Validate all records; publish only public ones.
  Journal drafts and their assets must be excluded from public production builds.
- Use the record helper; it validates, stamps creation, and refuses ID/file reuse.
- Keep ignored media, credentials, local private folders, external Ableton sets,
  and remote audio objects untouched. They are not backed up by a Git tag.
- Keep private assets out of shared/, which is public. Do not introduce credentials
  into source or bundles. Never run destructive clean commands on ignored workspaces.
