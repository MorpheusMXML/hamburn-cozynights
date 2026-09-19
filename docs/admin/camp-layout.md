# Houses, rooms & spots

The camp is a simple tree: **houses** on the map contain **rooms**, and rooms contain **spots**, one per bed.

> [!IMPORTANT] Staging only
> All structural changes need Staging Mode. During Live Booking and after booking closed the server refuses them. Only locking/unlocking 🔒 and marking spots ♿ special or normal still work. See [Staging, Live Booking & Closed](../guide/phases).

## Houses

### Create a house

- **Map view:** click an empty place on the map. In the *GENERATE SANCTUARY* sidebar enter a name (**UNIT DESIGNATION**) and the **INITIAL CAPACITY (BEDS)**, then press <kbd>IGNITE HOUSE ✨</kbd>.
- **List view:** click **Ignite New House**. CozyNights switches to the map view and opens the same sidebar. The house starts in the middle of the map; drag it into place afterwards.

CozyNights creates the house, a first room called **Main Module** (#1), and spots **B1 … Bn** for the capacity you entered. Like every new spot, they are **active right away**. Every house needs a name of its own; a camp holds up to 200 houses.

### Move, rename, delete

| Task | How |
| --- | --- |
| Move | Drag the pin in map view, or move a selected pin with the arrow keys (<kbd>Shift</kbd> for bigger steps). For an exact place, type the **MAP POSITION 📍** in the sidebar (X 0–1000, Y 0–700) and press <kbd>MOVE PIN</kbd>. Every move is saved right away. Houses keep a small distance from each other. |
| Rename | Click the house in map view, or <kbd>RENAME ✏️</kbd> on its card in list view → change the name → <kbd>SYNC MODULE ✨</kbd>. |
| Delete | <kbd>VANISH FROM PLAYA 🌪️</kbd> in the sidebar or <kbd>VANISH 🌪️</kbd> on the card, then confirm. |

> [!CAUTION] Deleting is final
> Deleting a house deletes all its rooms and spots too. Any test bookings on them are released first, and ticket codes stay valid. Not sure? [Export a template](./templates) before you delete.

## Rooms

Open a house with <kbd>MANAGE ROOMS ⚙️</kbd>, by clicking its card, or via <kbd>ADD ROOMS ➕</kbd> in the red alert panel.

![House page with the add-room form and room cards](../assets/screenshots/admin-house.webp)

### Add a room

Fill in **ADD ROOM ➕**:

| Field | Example | Note |
| --- | --- | --- |
| ROOM DESIGNATION (NAME) | *Skyline Sanctuary* | Shown to guests. Required. |
| ROOM # | *101* | Required: a whole number from 1 to 9999, used only once in the house. Rooms are sorted by this number. |
| BED CAPACITY 🛌 | *4* | Creates spots *Spot 1 … Spot 4* right away. |

A house holds up to 50 rooms, a room up to 50 spots.

Press <kbd>IGNITE ROOM ✨</kbd>.

> [!NOTE] New spots are active
> Every new spot, whether it comes with a house, with a room or on its own, is **active**: guests can book it as soon as booking opens. Lock 🔒 or deactivate ❄️ the spots that shouldn't be booked, see [Spot actions](#spot-actions).

### Room cards

Each card under **ACTIVE ROOMS 🚪** shows the room number, name and **SPOTS CLAIMED 📊** (taken / active). Click a card or <kbd>MANAGE SPOTS 🛌</kbd> to manage its spots. <kbd>VANISH ROOM 🌪️</kbd> deletes the room **with all its spots and any bookings on them**; the guests get a *spot was released* message, and their ticket codes stay valid.

## Spots

Open a room by clicking its card on the house page.

![Room page with spots in every state](../assets/screenshots/admin-room.webp)

**LOGISTICS 📊** counts taken versus active spots. **ADD SPOT ➕** adds a single spot: give it a label such as *B1* or *Top Bunk* (each label only once per room) and press <kbd>IGNITE ⚡️</kbd>.

### Spot states

| Admin card | Guests see |
| --- | --- |
| 🟢 **VACANT ✨** | *Available*: they can book it. |
| 🔴 **CLAIMED 👥** | *Occupied* with the guest's burner name. |
| **LOCKED 🔒** | *Not available · Reserved by the crew*. It still counts as a spot, but never as a free one. The label hides whether it is also claimed or inactive; the dot still shows it. |
| **SPECIAL NEEDS ♿** | Like a locked spot: *Not available · Reserved by the crew* while it's free, never counted as free. The crew books it for approved [special-needs requests](./special-needs). Once booked, guests see the burner name, not the mark. |
| ⚪️ **INACTIVE 🧊** | *Not available · Reserved by the crew* in its room. It isn't counted in any occupancy numbers (map, Control Center, house pages), the roulette never picks it, and nobody can book it. |

### Spot actions

| Button | Action | Live Booking or Closed |
| :---: | --- | :---: |
| 🔒 LOCK / 🔓 UNLOCK | Block guests / let them book again | <span class="yes">✓</span> allowed |
| ♿ SPECIAL / NORMAL | Keep the spot for [special-needs requests](./special-needs), or give it back to all guests | <span class="yes">✓</span> allowed |
| ❄️ DEACTIVATE / ⚡️ ACTIVATE | Take the spot out of use / back in | <span class="no">✗</span> |
| 🔄 TAKEN / FREE | Mark the spot as taken without a ticket, or free it | <span class="no">✗</span> |
| 🗑 DELETE | Delete the spot | <span class="no">✗</span> |

::: tip Lock or deactivate?
**Lock** a spot that exists but must not be booked by guests: a broken bed, or a bed kept for the crew. Guests see it as reserved. An admin who is signed in can still book a locked (or ♿) spot during Live Booking through the normal booking pages with a ticket code.

**Deactivate** a spot that isn't in use at all (yet). It no longer counts as a spot anywhere, and not even an admin can book it.
:::

::: details Marking a spot as taken without a ticket
🔄 TAKEN marks a free spot as taken without attaching a ticket, for example to hold a bed during testing. Guests see it as *Occupied* by a *Mystery Burner*. **Clear all bookings** and a superuser's switch back to Staging free these spots too. For beds that should stay unavailable, locking is the better choice.

🔄 FREE on a spot that a guest booked cancels that booking: the dialog *Cancel this guest's booking?* asks first (<kbd>Free the spot</kbd> / <kbd>Keep booking</kbd>), the guest gets a *spot was released* message, and their ticket code stays valid.
:::
