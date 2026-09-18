# Security policy

CozyNights holds ticket codes, e-mail addresses and, for special-needs requests, health data of festival guests. Please handle findings with care.

## Reporting a vulnerability

- Preferred: **GitHub → Security → Report a vulnerability** (private, only the maintainer sees it).
- Or e-mail the association that runs the event: **wir@mauersegler.art**, subject "CozyNights security".

Please include what you found, how to reproduce it and which version or branch you looked at. Do not test against the live staging or production sites with real guests' data; the repository's `npm run verify` stack gives you an empty instance to try things on.

We answer within a few days and fix confirmed problems before the next deploy. Reports are credited in the release notes if you like.

## Scope and known limits

- The app and its PocketBase hooks and migrations in this repository.
- The staging server itself is **not** in scope for public testing; server-side findings are tracked privately.
- What the app deliberately does *not* protect against is written down in the docs: [Security & privacy](https://morpheusmxml.github.io/hamburn-cozynights/reference/security).

## Supported versions

Only `main` and the current `integration/staging` branch receive fixes.
