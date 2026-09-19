---
layout: home
title: Hamburn CozyNights
titleTemplate: Beds, not spreadsheets

hero:
  name: CozyNights
  text: Beds, not spreadsheets.
  tagline: Ticket holders pick their own bed on the Hamburn camp map. The crew builds the camp, decides when booking opens and keeps an eye on every spot from one Control Center.
  image:
    src: /swift.png
    alt: Mauersegler swift
  actions:
    - theme: brand
      text: How booking works
      link: /guide/booking
    - theme: alt
      text: Admin guide
      link: /admin/
    - theme: alt
      text: What is CozyNights?
      link: /guide/

features:
  - icon: 🗺️
    title: Interactive camp map
    details: Every house sits on the real site plan. Guests see at a glance where beds are still free.
    link: /guide/booking
    linkText: Book a bed
  - icon: 🎫
    title: One ticket, one bed
    details: No accounts and no passwords. A ticket code is all a guest needs, and it holds exactly one spot.
    link: /guide/booking#step-by-step
    linkText: The booking flow
  - icon: 🎰
    title: Destiny Roulette
    details: Can't decide? Roll for a random free bed and a burner name to go with it.
    link: /guide/booking#destiny-roulette
    linkText: Feeling lucky
  - icon: 📬
    title: Booking confirmations
    details: Guests hear about every change of their spot by e-mail, and on Telegram if they like. No address to type in.
    link: /guide/booking#confirmations
    linkText: Confirmations
  - icon: 🎟️
    title: Booking pass
    details: Every booking comes with a QR code and a short code. The crew checks it at arrival with a phone camera.
    link: /guide/booking#your-booking-pass
    linkText: The pass
  - icon: ♿
    title: Special-needs spots
    details: Need a lower bunk, step-free access or a quiet room? Ask the crew with your ticket code, even before booking opens.
    link: /guide/special-needs
    linkText: Ask for a spot
  - icon: 🛠️
    title: Staging, Live, Closed
    details: The crew builds the layout in staging, then a timer opens booking and closes it again. A countdown on every page shows when.
    link: /guide/phases
    linkText: The booking window
  - icon: 🔐
    title: Google Workspace sign-in
    details: Admins sign in with their @mauersegler.art Google account. Newcomers request access and a superuser approves.
    link: /admin/access
    linkText: Admin access
  - icon: 💾
    title: Layout templates
    details: Export the whole camp as JSON. A file is compared with the camp first, and only the changes you pick are applied.
    link: /admin/templates
    linkText: Templates
---

## How it works

```mermaid
flowchart LR
  build["🛠️ Crew builds the camp<br/><small>houses · rooms · spots</small>"]
  open["⏱️ Booking opens<br/><small>on the timer, closes on it too</small>"]
  code["🎫 Guest enters<br/>ticket code"]
  pick["🛏️ Picks a bed<br/><small>or rolls the roulette</small>"]
  night["🔥 Cozy night<br/>at Hamburn"]
  build --> open --> code --> pick --> night
```

<div class="home-shots">
<div>

![Guests pick a house on the live camp map](./assets/screenshots/guest-map-live.webp)

<p class="shot-caption">🎫 Guests pick a house on the live camp map</p>
</div>
<!-- audience:admin -->
<div>

![Admins run everything from the Control Center](./assets/screenshots/admin-control-center.webp)

<p class="shot-caption">🛠️ The crew runs the camp from the Control Center</p>
</div>
<!-- /audience -->
</div>

## Find your way

<!-- audience:public -->

| I am… | Start here |
| --- | --- |
| 🎫 **A guest** with a ticket | [Booking a bed](./guide/booking): ticket code, map, spot, done. |
| ♿ **In need of a special spot** | [Special-needs spot](./guide/special-needs): ask the crew, even before booking opens. |
| 🤔 **Stuck** somewhere | [FAQ & troubleshooting](./guide/faq), or ask the Hamburn crew. |
| 🛠️ **On the crew** | The admin guide is part of the app and opens for signed-in admins only: `/admin/docs/` on the CozyNights site. |

<!-- /audience -->
<!-- audience:admin -->

| I am… | Start here |
| --- | --- |
| 🎫 **A guest** with a ticket | [Booking a bed](./guide/booking): ticket code, map, spot, done. |
| 🛠️ **On the crew** and need admin access | [Admin access & roles](./admin/access), then [the Control Center](./admin/). |
| 📋 **Organizing** the next burn | [Event checklist](./admin/event-checklist) from first layout to after the event. |
| ♿ **Deciding special-needs requests** | [Special-needs requests](./admin/special-needs): mark spots, decide, book. |
| 🎟️ **At the entrance**, checking guests in | [Booking passes & check-in](./admin/passes): phone camera, check-in page or USB scanner. |
| 💻 **A developer** | [Local development](./develop/) and [Architecture](./reference/architecture). |

<!-- /audience -->
