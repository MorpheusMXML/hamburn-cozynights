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

## 🛡️ Security Hardening & Data Privacy
We have implemented field-level encryption and a secure server-side middleman to protect all personal data (Customer Names, Burner Names, and Booking Codes).

### 1. Setup Security Environment
Before running the system, you must configure your private environment variables in `.env`:
```bash
# Generate a 32-byte encryption key (64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Add the following to your `.env` file (see `.env.example` for reference):
- `ENCRYPTION_KEY`: Your generated 32-byte key.
- `PB_ADMIN_EMAIL` & `PB_ADMIN_PASSWORD`: Your PocketBase admin credentials.

### 2. Update Database & Migrate Data
If you are upgrading an existing installation, run these scripts to secure your data:
- **Update Schema**: `npx tsx scripts/add_security_fields.ts` 🛠️
  *(Adds `order_hash` for secure lookups and `is_locked` for admin control)*
- **Encrypt Existing Data**: `npx tsx scripts/encrypt_db_migration.ts` 🔐
  *(Converts all plaintext names to AES-encrypted ciphertext)*

### 3. Secure Architecture
- **API Lockdown**: The `orders` and `users` collections are now **Admin-only**. No public API access is allowed.
- **SvelteKit Middleman**: All booking lookups are handled server-side via a secure `adminPb` instance.
- **Bed Locking**: Admins can now **Lock 🔒** specific beds (e.g., for maintenance or special guests), preventing them from being booked by regular users.

### 4. Interactive Testing
Verify the security of your installation using the built-in test suite:
```bash
npm run test       # Run all security tests
npm run test:ui    # Open interactive test dashboard 📊
```

## 🔐 Sensitive Data Protection
We take privacy seriously. Our database files (`pb_data`) are **ignored by Git** to prevent leakage. Use our custom scripts to manage local encrypted backups:

- **Encrypt**: `./scripts/encrypt_data.sh` (Requires GPG) 🔒
- **Decrypt**: `./scripts/decrypt_data.sh` 🔓

## 🗺 Features
- **Interactive Map**: Visualize houses across the camp. 🛰️
- **Real-time Booking**: Grab a spot using your unique booking code. 🎫
- **Admin Dashboard**:
  - **🛠 Staging Mode Phase**: Full freedom to add, rename, and drag-and-drop houses on the map.
  - **🎪 Live Booking Phase**: Global switch to enable public bookings and lock the map layout for consistency.
  - **Safeguards**: Prevention of house/room deletion if active bookings exist. 🛡️
- **Auto-Names**: Get a cool random Burner Name! 🦎⚡️

## 📜 Principles
- **Leave No Trace**: Keep the code clean and well-documented. 🧹
- **Radical Self-Reliance**: Use the GPG scripts to protect your own data. 🔐
- **Gifting**: This software is a gift to the camp. Enjoy! 🎁

---
*Made with 🔥 by the Hamburn Crew.*
