# CozyNights app 🔥🛌

The SvelteKit + PocketBase app behind **Hamburn CozyNights**: ticket holders pick their own bed on the camp map, the crew runs the camp from the Control Center.

📖 **Documentation: [morpheusmxml.github.io/hamburn-cozynights](https://morpheusmxml.github.io/hamburn-cozynights/)** (sources in [`../docs`](../docs))

## Quick start

```bash
cp .env.example .env   # fill it in, the comments explain every value
docker compose up -d   # PocketBase on 127.0.0.1:8090
npm ci
npm run dev            # http://localhost:5173
```

## Commands

| Command                    | What it does                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| `npm run dev`              | Dev server with hot reload, after a health check                  |
| `npm run check`            | Svelte and TypeScript type check                                  |
| `npm run lint`             | Prettier and ESLint                                               |
| `npm test`                 | Vitest unit and security tests                                    |
| `npm run test:integration` | Integration tests against a real, empty PocketBase (Docker)       |
| `npm run test:smoke`       | Smoke tests against the staging Docker image (Docker)             |
| `npm run verify`           | Everything CI runs: type check, unit, integration and smoke tests |
| `npm run smoke:remote`     | Read-only smoke tests against a deployed site                     |
| `npm run test:e2e`         | Playwright end-to-end tests                                       |
| `npm run build`            | Production build (`adapter-node`)                                 |
| `npm run typegen`          | Regenerate PocketBase types from the local schema                 |

## Where to read on

The published site only carries the guest guide. Developer and admin pages are read here in the repository, or in a running app at `/admin/docs/` after the admin sign-in.

| Topic                                   | Page                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| Setup, tests, schema changes            | [Local development](../docs/develop/index.md)              |
| Test layers, test stack, release routine | [Testing & release checks](../docs/develop/testing.md) |
| Staging, production, deploy pipeline    | [Environments & deployment](../docs/develop/deployment.md) |
| Request flow, data model, routes        | [Architecture](../docs/reference/architecture.md)          |
| Collections, integrity rules, templates | [Data model & templates](../docs/reference/data-model.md)  |
| Protections for guests and admins       | [Security & privacy](../docs/reference/security.md)        |
| Google sign-in, access requests, roles  | [Admin access & roles](../docs/admin/access.md)            |
| Writing docs, the two audiences         | [Working on these docs](../docs/develop/docs.md)           |
| Server setup and rollback (German)      | [`deploy/README.md`](deploy/README.md)                     |
