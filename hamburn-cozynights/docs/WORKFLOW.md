# 🎪 Operational Workflow

The Hamburn Cozynights app supports two distinct phases of operation to manage the camp setup and the actual event.

## 1. The Staging Mode Phase 🛠️

When the app is in **Staging Mode** (managed via the `app_settings` collection in PocketBase):

- **Admin Control:** Admins have full freedom to modify the map. They can add houses, rename them, and use the drag-and-drop editor to set their coordinates.
- **Guest Access:** Public visitors can see the map but **cannot book beds**. They will see a countdown timer (if configured) indicating when bookings will open.
- **Purpose:** Use this phase to finalize the camp layout without worrying about users grabbing spots before they are ready.

## 2. The Live Booking Phase 🎪

Once the global "Live Booking" switch is flipped:

- **Map Lockdown:** The houses and their positions are locked. This prevents accidental map changes during the event.
- **Public Booking:** Guests can enter their unique booking codes to view the map and reserve their beds.
- **Safeguards:** Houses and rooms with active bookings **cannot be deleted**. This protects the integrity of the data while the camp is live.

## 3. Booking Lifecycle

1.  **Portal:** User enters a booking code.
2.  **Map:** User visualizes the camp and selects a house.
3.  **House View:** User sees an overview of room occupancy.
4.  **Room View:** User selects an available bed.
5.  **Confirmation:** User sets an optional Burner Name (or lets the "Destiny Roulette" decide) and saves the spot.
6.  **Modification:** User can return to the room at any time to update their name or release the spot to pick a different one.
