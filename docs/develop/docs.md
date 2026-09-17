# Working on these docs

This site is built with [VitePress](https://vitepress.dev) from the Markdown files in [`docs/`](https://github.com/MorpheusMXML/hamburn-cozynights/tree/main/docs) and published on GitHub Pages at **[morpheusmxml.github.io/hamburn-cozynights](https://morpheusmxml.github.io/hamburn-cozynights/)**.

## Preview locally

```bash
cd docs
npm ci
npm run dev
```

VitePress prints the local address, usually `http://localhost:5173/hamburn-cozynights/`, or the next free port if the app's dev server is already running. Pages reload as you type.

`npm run build` produces the static site in `docs/.vitepress/dist` and **fails on broken internal links**; `npm run preview` serves that build.

## Where things live

```text
docs/
├── index.md                  home page (hero, features)
├── guide/                    for everyone: overview, booking, phases, FAQ
├── admin/                    for the crew: Control Center, access, layout, templates, checklist
├── reference/                architecture, security
├── develop/                  local setup, deployment, this page
├── assets/screenshots/       app screenshots (WebP)
├── public/                   logo, favicons, social preview image
└── .vitepress/
    ├── config.mts            navigation, sidebar, search, site metadata
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

The workflow [`.github/workflows/docs.yml`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/.github/workflows/docs.yml) runs whenever something in `docs/` changes:

- **Pull requests** build the site, so broken links or Markdown fail the check before merging.
- **Pushes to `main`** build and deploy to GitHub Pages.

The repository's Pages source has to be set to **GitHub Actions** (Settings → Pages) once.

## What doesn't belong here

This site is public. Keep out credentials, server addresses beyond the public domains, internal procedures for handling secrets, and anything about real guests. Operator-only details go into the runbook next to the deploy script.
