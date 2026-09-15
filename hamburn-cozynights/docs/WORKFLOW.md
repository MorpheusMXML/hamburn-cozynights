# 🎪 Operational Workflow

The Hamburn Cozynights app supports two distinct phases of operation to manage the camp setup and the actual event.

## 1. The Staging Mode Phase 🛠️

When the app is in **Staging Mode** (managed via the `app_settings` collection in PocketBase):

- **Admin Control:** Admins have full freedom to modify the map. They can add houses, rename them, and use the drag-and-drop editor to set their coordinates.
- **Template Management:** Use the **Location Template Manager** to export current layouts as JSON or import existing ones to quickly rebuild the playa structure.
- **Guest Access:** Public visitors can see the map but **cannot book beds**. They will see a countdown timer (if configured) indicating when bookings will open.
- **Purpose:** Use this phase to finalize the camp layout without worrying about users grabbing spots before they are ready.

Booking can also be scheduled to open automatically: an admin sets a target
date/time in the Control Center, and booking becomes active on its own once
that moment passes — no need for someone to be watching the clock to flip
the switch by hand. The guest-facing countdown reflects the same target.

## 2. The Live Booking Phase 🎪

Once booking is active (switched on by an admin, or auto-opened by a
scheduled timer):

- **Structure Lockdown:** No admin action that changes the camp's structure
  is allowed — houses and rooms can't be added, renamed, repositioned, or
  deleted, beds can't be added or deleted, and templates can't be imported.
  Switch back to Staging Mode first. This is enforced on the server, not
  just hidden in the UI.
- **Exception — bed locks:** An admin can still lock or unlock an
  individual bed while live (e.g. taking a broken one out of service
  mid-event), since that doesn't change the camp's structure.
- **Public Booking:** Guests can enter their unique booking codes to view
  the map and reserve their beds.

## 3. Booking Lifecycle

1.  **Portal:** User enters a booking code.
2.  **Map:** User visualizes the camp and selects a house.
3.  **House View:** User sees an overview of room occupancy.
4.  **Room View:** User selects an available bed, or lets "Destiny Roulette"
    assign one at random.
5.  **Confirmation:** User sets an optional Burner Name and saves the spot.
6.  **Modification:** User can return to the room (or the Roulette page,
    which shows the current booking once one exists) at any time to update
    their name or release the spot before picking a different one. Destiny
    Roulette only offers a new roll once the previous spot has been
    released — it won't silently rebook someone elsewhere.
