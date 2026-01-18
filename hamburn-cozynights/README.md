# 🔥 Hamburn CozyNights

**A streamlined accommodation booking and camp management tool designed for regional Burning Man events.**

![Status](https://img.shields.io/badge/status-active-success.svg)
![Tech](https://img.shields.io/badge/built%20with-SvelteKit%20%2B%20PocketBase-orange)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 📖 Overview

**Hamburn CozyNights** is a specialized web application built to simplify the chaotic process of assigning sleeping quarters at Burner events. It replaces spreadsheets with an interactive visual interface.

Organizers can map out the event site, define houses/structures, and manage room capacities. Participants (or camp leads) can reserve specific beds using unique booking codes, ensuring everyone has a cozy place to crash after a long night on the playa (or the pasture).

### ✨ Key Features

* **🗺️ Interactive Map Interface:** Visualize the event layout with a custom map (e.g., *Hamburn 2025*).
* **🏠 House & Room Management:** Admins can visually place houses on the map and configure room layouts.
* **🛏️ Bed Reservation System:**
    * Granular control over bed availability.
    * **Booking Codes:** Secure access allows users to claim beds based on generated codes.
* **📱 Modern UI:** Built with **SvelteKit** for a snappy, reactive user experience.
* **💾 Robust Backend:** Powered by **PocketBase** for real-time data and easy administration.

---

## 🛠️ Tech Stack

* **Frontend:** [SvelteKit](https://kit.svelte.dev/) (TypeScript, Vite)
* **Backend & Database:** [PocketBase](https://pocketbase.io/) (SQLite embedded)
* **Styling:** CSS / Svelte native styling
* **Deployment:** Docker & Docker Compose

---

## 🚀 Quick Start Guide

You can get the project up and running quickly using Docker.

### Prerequisites
* [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) installed.
* [Git](https://git-scm.com/) installed.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/morpheusmxml/hamburn-cozynights.git](https://github.com/morpheusmxml/hamburn-cozynights.git)
    cd hamburn-cozynights
    ```

2.  **Start with Docker Compose:**
    The project includes a `docker-compose.yml` for easy orchestration.
    ```bash
    docker-compose up -d
    ```

3.  **Access the Application:**
    * **Web App:** Open `http://localhost:5173` (or the port defined in your docker config).
    * **PocketBase Admin:** Open `http://localhost:8090/_/` to manage the database, booking codes, and map data.

---

## 💻 Local Development

If you prefer to run the frontend and backend manually for development purposes:

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Start PocketBase:**
    Make sure you have the PocketBase executable or run it via the provided scripts if available.
    ```bash
    # Example command (adjust path to your pocketbase binary)
    ./pocketbase serve
    ```

3.  **Start SvelteKit (Dev Mode):**
    ```bash
    npm run dev
    ```

---

## 📂 Project Structure

```text
hamburn-cozynights/
├── src/
│   ├── lib/
│   │   ├── components/    # UI Components (Map, HouseEditor, etc.)
│   │   ├── server/        # Server-side logic (Inventory, etc.)
│   │   └── pocketbase.ts  # PB Client configuration
│   └── routes/            # SvelteKit Pages & API endpoints
├── static/                # Static assets (Maps, Logos, Favicons)
├── pb_data/               # PocketBase database files (SQLite)
├── pb_hooks/              # Server-side PocketBase hooks
├── docker-compose.yml     # Docker orchestration
└── package.json           # Project dependencies