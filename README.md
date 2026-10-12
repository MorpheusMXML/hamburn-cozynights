<div align="center">

<img src="docs/public/swift.png" alt="" width="150" />

# Hamburn CozyNights

**Beds, not spreadsheets.**<br />
Ticket holders pick their own bed on the Hamburn camp map. The crew builds the camp, decides when booking opens and keeps an eye on every spot from one Control Center.

[![Documentation](https://img.shields.io/badge/docs-read%20the%20guide-f472b6?style=for-the-badge&logo=readthedocs&logoColor=white)](https://morpheusmxml.github.io/hamburn-cozynights/)

![SvelteKit](https://img.shields.io/badge/SvelteKit-2-ff3e00?logo=svelte&logoColor=white)
![PocketBase](https://img.shields.io/badge/PocketBase-0.40-b8dbe4?logo=pocketbase&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white)

[How booking works](https://morpheusmxml.github.io/hamburn-cozynights/guide/booking) ·
[Admin guide](https://cozynights.hamburn.de/admin/docs/admin/) ·
[Architecture](docs/reference/architecture.md) ·
[Local development](docs/develop/index.md)

</div>

![The camp map during Live Booking](docs/assets/screenshots/guest-map-live.webp)

## ✨ What it does

|     |                              |                                                                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| 🗺️  | **Interactive camp map**     | Every house sits on the real site plan; guests see at a glance where beds are free.                    |
| 🎫  | **One ticket, one bed**      | No accounts or passwords for guests. The ticket code is the key, and it holds exactly one spot.        |
| 🎰  | **Destiny Roulette**         | A neon slot machine for the undecided: pull the lever for a random free bed, then keep, type or roll a burner name; booked guests can leave no trace and respin. |
| 🎆  | **Booking fireworks**        | Neon rockets rise from your new spot and burst like the cursor does; a fire finale ends the show.      |
| 🧺  | **Make your bed**            | Every booking starts with dressing a neon bed in your own covers (pillow and blanket are provided) and a tick for the rules; the pass and every confirmation repeat what to pack. |
| 🛠️  | **Staging, Live, Closed**    | The crew builds the layout in staging; a booking window opens and closes booking by timer, and closing freezes it. |
| 🔐  | **Google Workspace sign-in** | Admins use their `@mauersegler.art` account. Newcomers request access, a superuser approves.           |
| 💾  | **Layout templates**         | Export the camp as JSON; a file is compared with the camp and only the changes you pick are applied.   |
| 📥  | **Ticket list with review**  | Load the ticket shop's list after a review; fix an address or hand a ticket over in a few clicks.      |
| 🛡️  | **Privacy first**            | Server-side rendering only, encrypted burner names, hashed ticket lookups, strict database rules.      |
| 🔥  | **Burning effigy title**     | Magic balls build rainbow timber letters, then fire eats them letter by letter. Light them yourself.   |
| ⚖️  | **Legal pages**              | Legal notice, privacy policy and booking rules on every page; the operator's details stay out of git.  |
| 📬  | **Booking confirmations**    | E-mail to the ticket holder, Telegram if they like, and a crew group that hears about admin changes.   |
| 🎟️  | **Booking pass**             | A QR code and a short code per booking, the QR right inside every confirmation e-mail; the crew checks it with a phone camera, a PC or a USB scanner. |
| ♿   | **Special-needs spots, project requests & groups** | Guests ask with their ticket code, even before booking opens — for something they need, or for an art project or crew, on their own or as a group; the crew books fitting spots, and ♿ spots only ever go through a request. |
| 🔁  | **Swapping spots**           | During Live Booking a guest asks another for a swap, with a vibe and a few words; hold to swap, both spots change at once. |
| ✉️  | **Message texts**            | Every sentence guests get by e-mail, on Telegram or from the bot is editable in the admin area, with a live preview. |

## 🧭 How it works

```mermaid
flowchart LR
  build["🛠️ Crew builds the camp"] --> open["⏱️ Booking opens"]
  open --> code["🎫 Guest enters ticket code"]
  code --> pick["🛏️ Picks a bed"]
  pick --> night["🔥 Cozy night"]
```

## 🚀 Quick start

You need Node.js 24+ and Docker (with mise, `mise install` in the repository picks it from `mise.toml`).

```bash
git clone https://github.com/MorpheusMXML/hamburn-cozynights.git
cd hamburn-cozynights/hamburn-cozynights
cp .env.example .env     # fill it in, the comments explain every value
docker compose up -d     # PocketBase on 127.0.0.1:8090
npm ci
npm run dev              # http://localhost:5173
```

The full walkthrough, including admin sign-in on your machine, is in [Local development](docs/develop/index.md).

## 📚 Documentation

The documentation lives in [`docs/`](docs/). The **guest guide** is public at **[morpheusmxml.github.io/hamburn-cozynights](https://morpheusmxml.github.io/hamburn-cozynights/)**. The **admin guide** is served by the app itself, behind the admin login, at **[cozynights.hamburn.de/admin/docs](https://cozynights.hamburn.de/admin/docs/)**; *Under the hood* and *Develop* are part of it there. Here on GitHub, their Markdown sources are linked below.

| Guide (public)                                                                              | Admin (sign-in)                                                                        | Under the hood                                         | Develop                                                         |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| [What is CozyNights?](https://morpheusmxml.github.io/hamburn-cozynights/guide/)             | [Control Center](https://cozynights.hamburn.de/admin/docs/admin/)                      | [Architecture](docs/reference/architecture.md)         | [Local development](docs/develop/index.md)                      |
| [Booking a bed](https://morpheusmxml.github.io/hamburn-cozynights/guide/booking)            | [Admin access & roles](https://cozynights.hamburn.de/admin/docs/admin/access)          | [Security & privacy](docs/reference/security.md)       | [Environments & deployment](docs/develop/deployment.md)         |
| [Special-needs spot](https://morpheusmxml.github.io/hamburn-cozynights/guide/special-needs) | [Houses, rooms & spots](https://cozynights.hamburn.de/admin/docs/admin/camp-layout)    | [Data model & templates](docs/reference/data-model.md) | [Working on these docs](docs/develop/docs.md)                   |
| [Staging, Live & Closed](https://morpheusmxml.github.io/hamburn-cozynights/guide/phases)    | [Layout templates](https://cozynights.hamburn.de/admin/docs/admin/templates)           |                                                        | [Landing page title](docs/develop/effigy-title.md)              |
| [FAQ](https://morpheusmxml.github.io/hamburn-cozynights/guide/faq)                          | [Event checklist](https://cozynights.hamburn.de/admin/docs/admin/event-checklist)      |                                                        | [Testing & release checks](docs/develop/testing.md)             |
|                                                                                             | [Tickets & e-mail addresses](https://cozynights.hamburn.de/admin/docs/admin/tickets)   |                                                        | [Branches, integration & releases](docs/develop/integration.md) |
|                                                                                             | [Legal pages](https://cozynights.hamburn.de/admin/docs/admin/legal)                    |                                                        |                                                                 |
|                                                                                             | [Notifications](https://cozynights.hamburn.de/admin/docs/admin/notifications)          |                                                        |                                                                 |
|                                                                                             | [Booking passes](https://cozynights.hamburn.de/admin/docs/admin/passes)                |                                                        |                                                                 |
|                                                                                             | [Special-needs requests](https://cozynights.hamburn.de/admin/docs/admin/special-needs) |                                                        |                                                                 |

## 🗂️ Repository

```text
.
├── docs/                   documentation (VitePress): guest guide → GitHub Pages, admin guide → the app
├── .github/workflows/      staging deploy, docs deploy
└── hamburn-cozynights/     the app: SvelteKit + PocketBase
    ├── src/                routes, components, server logic
    ├── pb_migrations/      database schema and API rules
    ├── pb_hooks/           PocketBase hooks
    ├── scripts/            admin tool, health check, test setup
    ├── deploy/             deploy script, nginx vhost, server runbook
    └── tests/              Vitest and Playwright
```

<div align="center">
<sub>Made with 🔥 for Hamburn by the Mauersegler* crew.</sub>
</div>
