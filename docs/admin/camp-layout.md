# Houses, rooms & spots

The camp is a simple tree: **houses** on the map contain **rooms**, and rooms contain **spots**, one per bed.

> [!IMPORTANT] Staging only
> All structural changes need Staging Mode. During Live Booking the server refuses them. Only locking and unlocking spots still works. See [Staging & Live Booking](../guide/phases).

## Houses

### Create a house

- **Map view:** click an empty place on the map. In the *GENERATE SANCTUARY* sidebar enter a name (**UNIT DESIGNATION**) and the **INITIAL CAPACITY (BEDS)**, then press <kbd>IGNITE HOUSE ✨</kbd>.
- **List view:** click **Ignite New House**. CozyNights switches to the map view and opens the same sidebar. The house starts in the middle of the map; drag it into place afterwards.

CozyNights creates the house, a first room called **Main Module** (#1), and spots **B1 … Bn** for the capacity you entered. These first spots are **active right away**.

### Move, rename, delete

| Task | How |
| --- | --- |
| Move | Drag the pin in map view. Saved when you let go. Houses keep a small distance from each other. |
| Rename | Click the house in map view, or <kbd>RENAME ✏️</kbd> on its card in list view → change the name → <kbd>SYNC MODULE ✨</kbd>. |
| Delete | <kbd>VANISH FROM PLAYA 🌪️</kbd> in the sidebar or <kbd>VANISH 🌪️</kbd> on the card, then confirm. |

> [!CAUTION] Deleting is final
> Deleting a house deletes all its rooms and spots too. Any test bookings on them are released first, and ticket codes stay valid. Not sure? [Export a template](./templates) before you delete.

## Rooms

Open a house with <kbd>MANAGE ROOMS ⚙️</kbd>, by clicking its card, or via <kbd>EXPAND ➕</kbd> in the red alert panel.

![House page with the add-room form and room cards](../assets/screenshots/admin-house.webp)

### Add a room

Fill in **ADD ROOM ➕**:

| Field | Example | Note |
| --- | --- | --- |
| ROOM DESIGNATION (NAME) | *Skyline Sanctuary* | Shown to guests. Required. |
| ROOM # | *101* | Rooms are sorted by this number. |
| BED CAPACITY 🛌 | *4* | Creates spots *Spot 1 … Spot 4* right away. |

Press <kbd>IGNITE ROOM ✨</kbd>.

> [!WARNING] New spots start inactive
> Spots created together with a room, and spots you add one by one, are **inactive** until you activate them, so nobody can book a half-finished room. Activate each spot with ⚡️ on the room page. Only the spots that come with a brand-new house are active from the start.

### Room cards

Each card under **ACTIVE ROOMS 🚪** shows the room number, name and **SPOTS CLAIMED 📊** (taken / active). Click a card to manage its spots. <kbd>VANISH ROOM 🌪️</kbd> deletes the room **with all its spots and any bookings on them**. Ticket codes stay valid.

## Spots

Open a room by clicking its card on the house page.

![Room page with spots in every state](../assets/screenshots/admin-room.webp)

**LOGISTICS 📊** counts taken versus active spots. **ADD SPOT ➕** adds a single spot: give it a label such as *B1* or *Top Bunk* and press <kbd>IGNITE ⚡️</kbd>.

### Spot states

| Admin card | Guests see |
| --- | --- |
| 🟢 **VACANT ✨** | *Available*: they can book it. |
| 🔴 **CLAIMED 👥** | *Occupied* with the guest's burner name. |
| **LOCKED 🔒** | *Not available · Reserved by the crew*. It still counts as a spot, but never as a free one. |
| ⚪️ **INACTIVE 🧊** | *Not available · Reserved by the crew* in its room. It isn't counted in any occupancy numbers (map, Control Center, house pages), the roulette never picks it, and nobody can book it. |

### Spot actions

| Button | Action | During Live Booking |
| :---: | --- | :---: |
| 🔒 / 🔓 | **Lock** (block guests) / unlock | <span class="yes">✓</span> allowed |
| ❄️ / ⚡️ | **Deactivate** / activate | <span class="no">✗</span> |
| 🔄 | **Toggle occupancy**: mark as taken or free without a ticket | <span class="no">✗</span> |
| 🗑 | **Delete** the spot | <span class="no">✗</span> |

::: tip Lock or deactivate?
**Lock** a spot that exists but must not be booked by guests: a broken bed, or a bed kept for the crew. Guests see it as reserved. An admin who is signed in can still book a locked spot through the normal booking pages with a ticket code.

**Deactivate** a spot that isn't in use at all (yet). It no longer counts as a spot anywhere, and not even an admin can book it.
:::

::: details Marking a spot as taken without a ticket
🔄 flips a spot between taken and free without attaching a ticket, for example to hold a bed during testing. Guests see it as *Occupied* by a *Mystery Burner*. **Clear all bookings** frees these spots too. For beds that should stay unavailable, locking is the better choice.
:::
