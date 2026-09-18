## What

<!-- One paragraph: what changes for guests, admins or operators. Link the Baustelle / issue if there is one. -->

## Checks

- [ ] `npm run check`, `npm test` and `npm run verify` are green locally (see docs/develop/testing.md)
- [ ] Migrations are idempotent and safe on the existing staging database (add, never drop)
- [ ] Docs in `docs/` and the README feature table are up to date
- [ ] No secrets, data or server findings in the diff (the repository is public)
- [ ] Commits are GPG-signed; this PR is merged with a **merge commit** (never squash or rebase)

## Deploy notes

<!-- Anything an operator must do after the deploy: .env keys, server commands, re-sign-ins. "Nothing" is a fine answer. -->
