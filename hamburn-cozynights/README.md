# Hamburn Cozynights 🔥🛌

Welcome to the **Hamburn Cozynights** house management system! This is where we ensure every burner has a soft spot to land after a long day on the playa. 🏜️✨

## 🚀 Mission Objective

Automate the chaos of house, room, and bed assignments with a sleek, real-time map and booking system. No more double-booked houses! 🛖⚡️

## 🛠 Quick Start

### 1. The House Backend (PocketBase)

Start the backend using Docker:

```bash
npm run db:up
```

Access the Admin UI at [http://localhost:8090/\_/](http://localhost:8090/_/).

### 2. The Frontend Portal

Install dependencies and ignite the dev server:

```bash
npm install
npm run dev
```

Open your browser at [http://localhost:5173](http://localhost:5173).

## 📖 Documentation

For detailed information on how the system works and how to manage it, please refer to our documentation:

- [🛡️ Security Architecture](./docs/SECURITY.md): Encryption, Trusted Proxy, and Rights Management.
- [🛠️ Development & Operations](./docs/DEVELOPMENT.md): Testing, Migrations, and Backups.
- [🎪 Operational Workflow](./docs/WORKFLOW.md): Staging vs. Live modes and the booking lifecycle.

## 🗺 Core Features

- **Laser Design System**: A cohesive high-contrast neon aesthetic with deep blurs and 32px rounded corners across the entire portal. ⚡️💎
- **Interactive Map**: Visualize houses across the camp with real-time occupancy. 🛰️
- **Real-time Booking**: Grab a spot using your unique booking code. 🎫
- **Admin Dashboard**: Drag-and-drop map editor, house management, and global booking toggles. 🛠️
- **Location Template Manager**: Admins can export/import structural JSON layouts to quickly rebuild the playa structure. 💾🌀
- **Privacy First**: Field-level encryption and secure server-side processing for all burner data. 🔐
- **High-Energy UI**:
  - **Ignite Loading**: Digital letter-explosion sequence on landing. 🔥
  - **Disco Hover**: Celebration particle effects and laser gradients on key interactions. 🎰
  - **Hybrid Mouse Trail**: A vibrant rainbow stripe with neon spark spray follows your journey. 🌈✨
  - **Destiny Roulette**: Let the playa decide your burner identity with snappy 2s random name generation. 🎰⚡️

## 📚 Auto-Documentation

This project uses a hybrid auto-documentation system:
- **TypeDoc**: For core TypeScript logic and server-side functions.
- **Svelte-Doc**: For UI component API references (Props, Slots, Events).

To generate the latest documentation locally:
```bash
npm run docs:generate
```
The output will be available in `/docs/generated`.

---

_Made with 🔥 by the Hamburn Crew._
