# Hamburn Cozynights 🔥🛌

Welcome to the **Hamburn Cozynights** house management system! This is where we ensure every burner has a soft spot to land after a long day on the playa. 🏜️✨

## 🚀 Mission Objective
Automate the chaos of house, room, and bed assignments with a sleek, real-time map and booking system. No more double-booked houses! 🛖⚡️

## 🛠 Tech Stack
- **SvelteKit 5**: Frontend magic 🪄
- **PocketBase**: Backend house & database 📂
- **TypeScript**: Ensuring our logic doesn't turn into dust ⌨️
- **GPG**: Protecting our sensitive burner data with local encryption 🔐

## 🗝 Getting Started

### 1. The House Backend (PocketBase)
Start the backend using Docker:
```bash
docker-compose up -d
```
Access the Admin UI at [http://localhost:8090/_/](http://localhost:8090/_/).

### 2. The Frontend Portal
Install dependencies and ignite the dev server:
```bash
npm install
npm run dev
```
Open your browser at [http://localhost:5173](http://localhost:5173).

## 🔐 Sensitive Data Protection
We take privacy seriously. Our database files (`pb_data`) are **ignored by Git** to prevent leakage. Use our custom scripts to manage local encrypted backups:

- **Encrypt**: `./scripts/encrypt_data.sh` (Requires GPG) 🔒
- **Decrypt**: `./scripts/decrypt_data.sh` 🔓

## 🗺 Features
- **Interactive Map**: Visualize houses across the camp. 🛰️
- **Real-time Booking**: Grab a spot using your unique booking code (e.g., `ORD-1770327903423`). 🎫
- **Admin Dashboard**: Manage houses, rooms, and beds with a powerful editor mode. 🛠️
- **Auto-Names**: Get a cool random Burner Name if you're feeling adventurous! 🦎⚡️

## 📜 Principles
- **Leave No Trace**: Keep the code clean and well-documented. 🧹
- **Radical Self-Reliance**: Use the GPG scripts to protect your own data. 🔐
- **Gifting**: This software is a gift to the camp. Enjoy! 🎁

---
*Made with 🔥 by the Hamburn Crew.*
