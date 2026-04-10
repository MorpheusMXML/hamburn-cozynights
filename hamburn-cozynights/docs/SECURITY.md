# 🛡️ Security Architecture

The Hamburn Cozynights system is designed with a **Privacy-First** approach to protect burner data and prevent unauthorized access to booking information.

## 1. The Trusted Proxy Model

Since the app uses booking codes instead of traditional user accounts for guests, we use a "Trusted Proxy" pattern to manage permissions.

- **Guest Context (`locals.pb`):** Represents an unauthenticated public visitor. This connection has very limited rights and can only see non-sensitive data (like house names and map coordinates).
- **System Context (`locals.adminPb`):** A super-user connection established on the server-side. This connection is authenticated using the `PB_ADMIN_EMAIL` and `PB_ADMIN_PASSWORD` from the `.env` file.

**Why it's safe:** The "Master Key" (`adminPb`) never leaves the server and is never sent to the browser. The browser only receives the final HTML or specific success/error messages.

## 2. Data Protection & Encryption

We use field-level encryption to ensure that even if the database is compromised, personal information remains unreadable.

- **AES-256-GCM Encryption:** Personal data like `burner_name` and `customer_name` are stored as encrypted ciphertext in the `orders` collection.
- **Deterministic Hashing:** We use `order_hash` (a SHA-256 HMAC of the booking code salted with your `ENCRYPTION_KEY`) for database lookups. This allows us to find an order without storing the raw booking code in a searchable way or exposing it in the database schema.
- **GPG Backups:** The local database folder (`pb_data`) is ignored by Git. We use GPG-encrypted archives (`pb_data.tar.gz.gpg`) for backups and sharing the database state between developers.

## 3. Rights Management

| Action | Rights Enforced |
| :--- | :--- |
| **Viewing the Map** | Allowed if a valid `bookingCode` cookie is present. |
| **Booking a Bed** | Server verifies the order exists and that the user doesn't already have another active booking. |
| **Releasing a Spot** | Server performs a strict lookup using the `order_id` from the session cookie. A user can **only** release their own assigned bed. |
| **Admin Actions** | Restricted to users authenticated via the PocketBase Admin/Superuser login (e.g., using GitHub or password). |

## 4. Bed Locking

Admins have the power to **Lock 🔒** individual beds. A locked bed:
- Cannot be selected by regular guests.
- Is visually marked as unavailable on the room detail page.
- Can only be managed (booked/unbooked) by an authenticated admin.
