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

| Command            | What it does                                      |
| ------------------ | ------------------------------------------------- |
| `npm run dev`      | Dev server with hot reload, after a health check  |
| `npm run check`    | Svelte and TypeScript type check                  |
| `npm run lint`     | Prettier and ESLint                               |
| `npm test`         | Vitest unit and security tests                    |
| `npm run test:e2e` | Playwright end-to-end tests                       |
| `npm run build`    | Production build (`adapter-node`)                 |
| `npm run typegen`  | Regenerate PocketBase types from the local schema |

## Where to read on

| Topic                                  | Page                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Setup, tests, schema changes           | [Local development](https://morpheusmxml.github.io/hamburn-cozynights/develop/)                   |
| Staging, production, deploy pipeline   | [Environments & deployment](https://morpheusmxml.github.io/hamburn-cozynights/develop/deployment) |
| Request flow, data model, routes       | [Architecture](https://morpheusmxml.github.io/hamburn-cozynights/reference/architecture)          |
| Collections, integrity rules, templates | [Data model & templates](https://morpheusmxml.github.io/hamburn-cozynights/reference/data-model) |
| Protections for guests and admins      | [Security & privacy](https://morpheusmxml.github.io/hamburn-cozynights/reference/security)        |
| Google sign-in, access requests, roles | [Admin access & roles](https://morpheusmxml.github.io/hamburn-cozynights/admin/access)            |
| Server setup and rollback (German)     | [`deploy/README.md`](deploy/README.md)                                                            |
