# Working on these docs

This site is built with [VitePress](https://vitepress.dev) from the Markdown files in [`docs/`](https://github.com/MorpheusMXML/hamburn-cozynights/tree/main/docs). One source tree produces two sites, one per audience.

## Two audiences

| | **public** | **admin** |
| --- | --- | --- |
| For | guests, anyone | the crew: approved admins |
| Contains | home page and the guide (booking, phases, guest FAQ) | everything: guide, admin guide, under the hood, develop |
| In the app | `/docs/`, no sign-in | `/admin/docs/`, only with an admin session |
| On GitHub Pages | **[morpheusmxml.github.io/hamburn-cozynights](https://morpheusmxml.github.io/hamburn-cozynights/)**, rebuilt with every version tag | never |

The environment variable `DOCS_AUDIENCE` (`public` or `admin`, default `admin`) selects the build. The public build leaves out the folders `admin/`, `reference/` and `develop/` completely: their pages are not rendered, not linked from navigation, sidebar or home page, and not part of the search index. Which section belongs to which audience is defined in one place, [`.vitepress/audience.ts`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/docs/.vitepress/audience.ts).

The app serves both builds itself. The admin build sits behind the same Google sign-in as the Control Center: without an approved admin session, pages redirect to the admin login and scripts, styles and the search index are refused. A pending access request doesn't count.

> [!WARNING] Hidden on the site, not secret
> The repository is public, so the Markdown sources of the admin guide stay readable on GitHub. The audience switch controls what the published site and the app show, nothing more. Making the admin guide confidential would need a private repository, or a private docs repository that is pulled in at build time. The rules under [What doesn't belong here](#what-doesn-t-belong-here) apply to every page, whatever its audience.

## Preview locally

```bash
cd docs
npm ci
npm run dev            # everything (admin audience)
npm run dev:public     # what guests get
```

VitePress prints the local address, usually `http://localhost:5173/hamburn-cozynights/`, or the next free port if the app's dev server is already running. Pages reload as you type.

| Command | Builds | Into |
| --- | --- | --- |
| `npm run build` | the full site | `.vitepress/dist/admin` |
| `npm run build:public` | the public site, as published on GitHub Pages | `.vitepress/dist/public` |
| `npm run build:app` | both, with the paths the app serves them under (`/docs/`, `/admin/docs/`) | `.vitepress/dist/app/public` and `…/admin` |

Every build **fails on broken internal links**, and a link from a guide page into the admin guide is broken in the public build. `npm run preview` and `npm run preview:public` serve the finished builds.

Three more variables exist for special cases: `DOCS_BASE` is the path the site is served under (default `/hamburn-cozynights/`), `DOCS_SITE_URL` its full public address for the sitemap and link previews (only known for GitHub Pages), and `DOCS_APP_URL` the address of the app, whose legal pages every page links (see [Legal links](#legal-links)).

## Pages for both audiences

Guide pages are read by guests and admins alike. Where a guide page points into the admin guide, or explains something only admins can do, wrap those lines in an audience block:

```md
Guests can then no longer book. **Existing bookings stay.**

<!-- audience:admin -->
See [Admin access & roles](../admin/access) for who may do this.
<!-- /audience -->

<!-- audience:public -->
Questions? Ask the Hamburn crew.
<!-- /audience -->
```

The markers are HTML comments on lines of their own, so GitHub shows nothing of them (but does show both blocks). A block is dropped before the page is parsed: its text reaches neither the page, nor the link check, nor the search index of the other audience. Blocks can't be nested, and a misspelled marker fails the build instead of leaking text.

On the home page, hero buttons and feature cards that link into a hidden section disappear on their own.

## Where things live

```text
docs/
├── index.md                  home page (hero, features)
├── guide/                    for everyone: overview, booking, phases, FAQ
├── admin/                    admins only: Control Center, bookings, access, tickets, notifications, passes, special needs, layout, templates, checklist, legal
├── reference/                admins only: architecture, data model, security
├── develop/                  admins only: local setup, testing, layout, states, effigy title, integration, deployment, this page
├── assets/screenshots/       app screenshots (WebP)
├── public/                   logo, favicons, social preview image
└── .vitepress/
    ├── audience.ts           who sees which section: navigation, sidebar, audience blocks
    ├── config.mts            site metadata, search, Markdown extensions
    └── theme/                colours, Mermaid diagrams, zoomable images, checklists
```

## Writing toolbox

Everything below renders on this site. GitHub alerts, Mermaid diagrams, tables and task lists also render when the files are viewed on GitHub.

| You want | Write |
| --- | --- |
| A callout | `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]` |
| A collapsible block | `::: details Title` … `:::` |
| Tabs for alternatives | `::: code-group` with several fenced code blocks labelled `[Tab name]` |
| A diagram | a fenced code block with the language `mermaid` |
| A UI button name | `<kbd>SIGN IN WITH GOOGLE ⚡️</kbd>` |
| A role or phase label | `<Badge type="tip" text="superuser" />` |
| Numbered steps | a numbered list inside `<div class="steps">` … `</div>` |
| A checklist | `- [ ] item` |
| A screenshot | `![What it shows](../assets/screenshots/name.webp)`, click-to-zoom is automatic |

> [!TIP] Button names
> Write UI labels exactly as the app shows them, emoji included, so readers can find them on screen.

## Screenshots

Screenshots show demo data only, never real guests or tickets. Take them from a local stack at 1280 × 800, save them as WebP (quality around 80, under about 250 KB), and reference them with a relative path so they work on GitHub too.

## Publishing

Two copies, two purposes. **GitHub Pages** hosts the public guide for anyone, and is rebuilt on every [version tag](./deployment#versions-and-releases) as well as on every push to `main` that touches `docs/`, so it is as current as the version on staging. **The app** serves the admin guide behind the admin login at `/admin/docs/` — and, for now, the public guide at `/docs/` too — built into its Docker image with every deployment, so what an admin reads matches the version they are running. Both copies carry the line *this guide is rebuilt with every release* in their footer.

**GitHub Pages** gets the public build only. The workflow [`.github/workflows/docs.yml`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/.github/workflows/docs.yml) runs whenever something in `docs/` changes, and for every version tag:

- **Pull requests** build both audiences, so broken links or Markdown in either fail the check before merging.
- **Pushes to `main`** build the public audience and deploy it to GitHub Pages.
- **Version tags** (`v0.18.1`, made by `scripts/release.sh` on the state that is deployed) check out that tag, build the public audience from it and deploy it — so the Pages site describes the deployed state even while the release PR is still open. The paths filter doesn't apply to tags: every tag builds.

Two settings in the repository, once: the Pages source has to be **GitHub Actions** (Settings → Pages), and the `github-pages` environment has to allow deployments from tags (Settings → Environments → *github-pages* → *Deployment branches and tags* → add the tag pattern `v*`; the environment starts with `main` only, and a tag run would otherwise be refused with *not allowed to deploy to github-pages due to environment protection rules*).

**The app** gets both builds with every [deployment](./deployment): the Docker image build runs `npm run build:app` and copies the result into the image, where the app serves it at `/docs/` and `/admin/docs/`. A docs change therefore reaches the app with the next deploy, not with the merge. "Last updated" dates only appear on GitHub Pages and in local builds, because the image is built without the git history.

## Legal links

Every page links the app's legal notice, privacy policy and booking rules: the home page in its footer, doc pages under their content (`.vitepress/theme/LegalLinks.vue`, because VitePress shows its footer only on pages without a sidebar). The pages themselves belong to the app, see [Legal pages](../admin/legal).

- **Served by the app** (`/docs/`, `/admin/docs/`), the links point to `/legal-notice`, `/privacy` and `/booking-rules` on the same domain.
- **On GitHub Pages** they need the app's address. The Pages build reads it from the repository variable `DOCS_APP_URL`; without it they point to staging. Once production has its domain:

  ```bash
  gh variable set DOCS_APP_URL --body "https://<production-domain>"
  ```

  The next docs deploy (a version tag, a push to `main` that touches `docs/`, or **Run workflow** on *Docs*) picks it up.

## What doesn't belong here

The sources are public, whatever the audience of a page. Keep out credentials, server addresses beyond the public domains, internal procedures for handling secrets, and anything about real guests. Operator-only details go into [the runbook next to the deploy script](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/hamburn-cozynights/deploy/README.md).
